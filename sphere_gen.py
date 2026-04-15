"""
AI-powered sphere generation from text prompts via Blockade Labs Skybox AI.
Generates 8K equirectangular panoramas with perfect seams.
"""

import asyncio
import os
import time

import httpx
import pyvips


BLOCKADE_API_KEY = os.environ.get("BLOCKADE_API_KEY", "")
BLOCKADE_API_URL = "https://backend.blockadelabs.com/api/v1"


async def get_skybox_styles() -> list[dict]:
    """Get available skybox styles from Blockade Labs."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{BLOCKADE_API_URL}/skybox/styles?model_version=4",
            headers={"x-api-key": BLOCKADE_API_KEY},
        )
        resp.raise_for_status()
        return resp.json()


async def generate_skybox(prompt: str, style_id: int = None, on_progress=None) -> bytes:
    """Generate a 360° skybox via Blockade Labs API.

    Returns the equirectangular image bytes (8192x4096 JPEG).
    """
    payload = {
        "prompt": prompt,
        "enhance_prompt": True,
    }
    if style_id:
        payload["skybox_style_id"] = style_id

    async with httpx.AsyncClient(timeout=120.0) as client:
        # Start generation
        resp = await client.post(
            f"{BLOCKADE_API_URL}/skybox",
            headers={
                "x-api-key": BLOCKADE_API_KEY,
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        result = resp.json()

        gen_id = result.get("id")
        if not gen_id:
            raise Exception(f"No generation ID in response: {result}")

        print(f"  Skybox generation started: {gen_id}")

        # Poll for completion
        while True:
            status_resp = await client.get(
                f"{BLOCKADE_API_URL}/imagine/requests/{gen_id}",
                headers={"x-api-key": BLOCKADE_API_KEY},
            )
            status_resp.raise_for_status()
            status = status_resp.json()

            request = status.get("request", status)
            current_status = request.get("status", "")

            if on_progress:
                on_progress(current_status)

            if current_status == "complete":
                file_url = request.get("file_url", "")
                if not file_url:
                    raise Exception(f"No file_url in completed response: {request}")

                print(f"  Skybox complete, downloading from {file_url[:60]}...")
                img_resp = await client.get(file_url)
                img_resp.raise_for_status()
                return img_resp.content

            elif current_status in ("error", "failed"):
                error = request.get("error_message", "Unknown error")
                raise Exception(f"Skybox generation failed: {error}")

            await asyncio.sleep(2)


async def generate_sphere_from_prompt(prompt: str, on_progress=None) -> pyvips.Image:
    """Generate a 16K equirectangular panorama from a text prompt.

    Uses Blockade Labs Skybox AI for 8K generation, then upscales to 16K.
    """
    global BLOCKADE_API_KEY
    BLOCKADE_API_KEY = os.environ.get("BLOCKADE_API_KEY", "")

    if not BLOCKADE_API_KEY:
        raise Exception("BLOCKADE_API_KEY not set")

    # Generate 8K skybox
    img_bytes = await generate_skybox(prompt, on_progress=on_progress)

    # Load into pyvips
    img = pyvips.Image.new_from_buffer(img_bytes, "")
    if img.bands == 4:
        img = img[:3]
    print(f"  Skybox image: {img.width}x{img.height}")

    # Upscale to 16K if needed
    if img.width < 16384:
        canvas = img.resize(
            16384 / img.width,
            kernel=pyvips.enums.Kernel.LANCZOS3,
            vscale=8192 / img.height,
        )
    else:
        canvas = img

    print(f"  Final canvas: {canvas.width}x{canvas.height}")
    return canvas


# CLI test
if __name__ == "__main__":
    import sys
    prompt = sys.argv[1] if len(sys.argv) > 1 else "a cozy mountain cabin at sunset, warm golden light, snow-capped peaks in the distance"

    print(f"Prompt: {prompt}")

    def on_progress(status):
        print(f"  Status: {status}")

    canvas = asyncio.run(generate_sphere_from_prompt(prompt, on_progress=on_progress))
    print(f"Result: {canvas.width}x{canvas.height}")

    canvas.write_to_file("test_sphere_blockade.jpg[Q=93]")
    print(f"Saved to test_sphere_blockade.jpg")
