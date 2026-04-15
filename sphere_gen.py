"""
AI-powered sphere generation from text prompts.

Two approaches:
1. Direct equirectangular — generate a single panoramic image with Flux
2. Cubemap faces — generate 6 perspective images and convert to equirectangular

Both use fal.ai Flux Pro for image generation and ESRGAN for upscaling.
"""

import asyncio
import base64
import math
import struct
from io import BytesIO

import httpx
import pyvips
from PIL import Image


FAL_KEY = ""  # Set from environment


async def generate_image_fal(prompt: str, width: int = 1024, height: int = 512, seed: int = None) -> bytes:
    """Generate an image via fal.ai Flux Pro."""
    payload = {
        "prompt": prompt,
        "image_size": {"width": width, "height": height},
        "num_images": 1,
    }
    if seed is not None:
        payload["seed"] = seed

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            "https://queue.fal.run/fal-ai/flux-pro/v1.1",
            headers={
                "Authorization": f"Key {FAL_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        result = resp.json()

        # Handle queue-based response
        request_id = result.get("request_id")
        if request_id:
            while True:
                status_resp = await client.get(
                    f"https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/{request_id}/status",
                    headers={"Authorization": f"Key {FAL_KEY}"},
                )
                status = status_resp.json()
                if status.get("status") == "COMPLETED":
                    result_resp = await client.get(
                        f"https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/{request_id}",
                        headers={"Authorization": f"Key {FAL_KEY}"},
                    )
                    result = result_resp.json()
                    break
                elif status.get("status") in ("FAILED", "CANCELLED"):
                    raise Exception(f"Generation failed: {status}")
                await asyncio.sleep(1)

        # Download image
        images = result.get("images", [])
        if not images:
            raise Exception(f"No images in response: {result}")
        image_url = images[0].get("url", "")

        img_resp = await client.get(image_url)
        return img_resp.content


# =============================================================================
# Approach 1: Direct equirectangular generation
# =============================================================================

async def generate_equirect_direct(prompt: str, seed: int = None) -> bytes:
    """Generate a 360° equirectangular panorama directly with Flux.

    Prepends panorama-specific keywords to the prompt and generates
    at 2:1 aspect ratio.
    """
    equirect_prompt = (
        f"360 degree equirectangular panorama photograph, seamless wrap-around, "
        f"HDR high dynamic range, immersive environment, {prompt}"
    )

    # Generate at max practical resolution (2:1 ratio)
    img_bytes = await generate_image_fal(equirect_prompt, width=1536, height=768, seed=seed)
    return img_bytes


# =============================================================================
# Approach 2: Cubemap faces → equirectangular conversion
# =============================================================================

CUBEMAP_FACES = {
    "front":  {"yaw": 0,   "pitch": 0,   "desc": "looking straight ahead"},
    "right":  {"yaw": 90,  "pitch": 0,   "desc": "looking to the right"},
    "back":   {"yaw": 180, "pitch": 0,   "desc": "looking behind"},
    "left":   {"yaw": 270, "pitch": 0,   "desc": "looking to the left"},
    "up":     {"yaw": 0,   "pitch": 90,  "desc": "looking straight up at the ceiling or sky"},
    "down":   {"yaw": 0,   "pitch": -90, "desc": "looking straight down at the floor or ground"},
}


async def generate_cubemap_faces(prompt: str, face_size: int = 1024, seed: int = 42) -> dict[str, bytes]:
    """Generate 6 cubemap face images from a scene prompt."""
    faces = {}

    async def gen_face(name: str, info: dict) -> tuple[str, bytes]:
        face_prompt = (
            f"A photograph {info['desc']} in this scene: {prompt}. "
            f"Consistent lighting and style. Photorealistic, high detail."
        )
        img = await generate_image_fal(face_prompt, width=face_size, height=face_size, seed=seed)
        return name, img

    # Generate all 6 faces in parallel
    tasks = [gen_face(name, info) for name, info in CUBEMAP_FACES.items()]
    results = await asyncio.gather(*tasks)

    for name, img_bytes in results:
        faces[name] = img_bytes
        print(f"  Cubemap face '{name}': {len(img_bytes)} bytes")

    return faces


def cubemap_to_equirectangular(faces: dict[str, pyvips.Image], output_w: int = 4096, output_h: int = 2048) -> pyvips.Image:
    """Convert 6 cubemap face images to an equirectangular panorama.

    Uses pyvips coordinate math for the projection — no Python pixel loops.
    """
    face_size = faces["front"].width

    # Build coordinate grids for the output
    xy = pyvips.Image.xyz(output_w, output_h)
    x_coords = xy.extract_band(0)  # 0..output_w-1
    y_coords = xy.extract_band(1)  # 0..output_h-1

    # Convert pixel coords to spherical angles
    # longitude: -pi to pi, latitude: pi/2 to -pi/2
    lon = (x_coords / output_w - 0.5) * 2 * math.pi
    lat = (0.5 - y_coords / output_h) * math.pi

    # Convert spherical to 3D unit vector
    cos_lat = lat.cos()
    x3d = cos_lat * lon.sin()  # right
    y3d = lat.sin()            # up
    z3d = cos_lat * lon.cos()  # forward

    # For each pixel, determine which cubemap face to sample from
    # and the UV coordinates within that face
    abs_x = x3d.abs()
    abs_y = y3d.abs()
    abs_z = z3d.abs()

    # Start with a black canvas, composite each face
    canvas = pyvips.Image.black(output_w, output_h, bands=3)

    # Process each face using conditional masks
    # This is complex with pyvips ops, so we'll use a simpler row-by-row approach
    # with numpy-free math

    # Actually, the cleanest pyvips approach: build the full mapim for each face,
    # mask where that face is dominant, and composite.
    # But this gets very complex. Let's use a practical hybrid:
    # render at moderate res with per-pixel Python, then upscale with pyvips.

    # For performance, render at 2048x1024 then upscale
    render_w, render_h = 2048, 1024
    half_face = face_size / 2.0

    # Pre-load faces as numpy-like arrays via pyvips
    # We'll write pixels directly
    import struct as st

    # Build output buffer
    out_data = bytearray(render_w * render_h * 3)

    # Convert faces to raw bytes for fast pixel lookup
    face_data = {}
    for name, img in faces.items():
        if img.bands == 4:
            img = img[:3]
        raw = img.write_to_memory()
        face_data[name] = (raw, img.width, img.height)

    def sample_face(face_raw, fw, fh, u, v):
        """Sample a pixel from a face. u,v in [0,1]."""
        px = min(int(u * fw), fw - 1)
        py = min(int(v * fh), fh - 1)
        idx = (py * fw + px) * 3
        return face_raw[idx], face_raw[idx+1], face_raw[idx+2]

    for py in range(render_h):
        latitude = math.pi * (0.5 - py / render_h)
        cos_la = math.cos(latitude)
        sin_la = math.sin(latitude)

        for px in range(render_w):
            longitude = 2 * math.pi * (px / render_w - 0.5)

            # 3D direction
            dx = cos_la * math.sin(longitude)
            dy = sin_la
            dz = cos_la * math.cos(longitude)

            ax, ay, az = abs(dx), abs(dy), abs(dz)

            # Determine face and UV
            if az >= ax and az >= ay:
                if dz > 0:  # front
                    u = (dx / dz + 1) / 2
                    v = (-dy / dz + 1) / 2
                    face = "front"
                else:  # back
                    u = (dx / dz + 1) / 2
                    v = (dy / dz + 1) / 2
                    face = "back"
            elif ax >= ay and ax >= az:
                if dx > 0:  # right
                    u = (-dz / dx + 1) / 2
                    v = (-dy / dx + 1) / 2
                    face = "right"
                else:  # left
                    u = (-dz / dx + 1) / 2
                    v = (dy / dx + 1) / 2
                    face = "left"
            else:
                if dy > 0:  # up
                    u = (dx / dy + 1) / 2
                    v = (dz / dy + 1) / 2
                    face = "up"
                else:  # down
                    u = (-dx / dy + 1) / 2
                    v = (dz / dy + 1) / 2
                    face = "down"

            u = max(0.0, min(0.999, u))
            v = max(0.0, min(0.999, v))

            raw, fw, fh = face_data[face]
            r, g, b = sample_face(raw, fw, fh, u, v)

            idx = (py * render_w + px) * 3
            out_data[idx] = r
            out_data[idx+1] = g
            out_data[idx+2] = b

    # Convert to pyvips image
    result = pyvips.Image.new_from_memory(bytes(out_data), render_w, render_h, 3, "uchar")

    # Upscale to output size
    if render_w != output_w:
        result = result.resize(
            output_w / render_w,
            kernel=pyvips.enums.Kernel.LANCZOS3,
            vscale=output_h / render_h,
        )

    return result


async def generate_sphere_from_prompt(prompt: str, method: str = "direct") -> pyvips.Image:
    """Generate a 16K equirectangular panorama from a text prompt.

    Args:
        prompt: Scene description
        method: "direct" for single equirectangular, "cubemap" for 6-face approach

    Returns:
        pyvips.Image at 16384x8192
    """
    import os
    global FAL_KEY
    FAL_KEY = os.environ.get("FAL_KEY", "")

    if method == "direct":
        print(f"  Generating equirectangular panorama...")
        img_bytes = await generate_equirect_direct(prompt)
        img = pyvips.Image.new_from_buffer(img_bytes, "")
        if img.bands == 4:
            img = img[:3]
        # Upscale to 16K
        canvas = img.resize(
            16384 / img.width,
            kernel=pyvips.enums.Kernel.LANCZOS3,
            vscale=8192 / img.height,
        )
        return canvas

    elif method == "cubemap":
        print(f"  Generating 6 cubemap faces...")
        face_bytes = await generate_cubemap_faces(prompt, face_size=1024)

        # Load as pyvips images
        faces = {}
        for name, data in face_bytes.items():
            img = pyvips.Image.new_from_buffer(data, "")
            if img.bands == 4:
                img = img[:3]
            faces[name] = img

        print(f"  Converting cubemap to equirectangular...")
        canvas = cubemap_to_equirectangular(faces, output_w=4096, output_h=2048)

        # Upscale to 16K
        print(f"  Upscaling to 16K...")
        canvas = canvas.resize(
            16384 / canvas.width,
            kernel=pyvips.enums.Kernel.LANCZOS3,
            vscale=8192 / canvas.height,
        )
        return canvas

    else:
        raise ValueError(f"Unknown method: {method}")


# CLI test
if __name__ == "__main__":
    import sys
    prompt = sys.argv[1] if len(sys.argv) > 1 else "a cozy mountain cabin at sunset, warm golden light, snow-capped peaks in the distance"
    method = sys.argv[2] if len(sys.argv) > 2 else "direct"

    print(f"Prompt: {prompt}")
    print(f"Method: {method}")

    canvas = asyncio.run(generate_sphere_from_prompt(prompt, method))
    print(f"Result: {canvas.width}x{canvas.height}")

    canvas.write_to_file(f"test_sphere_{method}.jpg[Q=93]")
    print(f"Saved to test_sphere_{method}.jpg")
