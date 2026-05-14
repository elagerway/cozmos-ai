"""
Prove-out: can OpenAI gpt-image-2 stand in for Blockade Skybox?

Generates a 360° panorama at gpt-image-2's largest valid 2:1 size (3840x1920),
then upscales via pyvips to 16384x8192 — the canvas the rest of the sphere
pipeline expects.

Standalone scratch test. Not wired into the pipeline, not cost-logged.

    pip install openai
    python openai_sphere_test.py "your prompt here" [output-slug]

Output (slug defaults to "openai"):
    test_sphere_<slug>_raw.jpg   — raw 3840x1920 from OpenAI
    test_sphere_<slug>.jpg       — upscaled to 16384x8192 for sphere comparison
    test_sphere_<slug>_seam.jpg  — raw tiled twice horizontally; any seam at the
                                   left/right wrap shows up as a vertical
                                   discontinuity in the middle of this image

Compare visually against test_sphere_blockade.jpg from sphere_gen.py. The
questions this script answers:
  1. Is there a visible seam where the left and right edges meet?
  2. Are the poles (top/bottom rows) warped or pinched?
  3. After the 4.27x upscale, how does sharpness compare to native 16K Blockade?
"""

import base64
import io
import os
import sys
import time

import httpx
from openai import OpenAI
from PIL import Image

try:
    import pyvips
    HAS_PYVIPS = True
except (ImportError, OSError):
    # pyvips needs libvips installed system-wide; only the Docker pipeline has it.
    # Without it we skip the 16K upscale step. The raw + seam-tile outputs
    # (Pillow-based) are enough to answer the format-viability question.
    HAS_PYVIPS = False


# Prefix has three jobs, in order of importance:
# 1. Anchor projection: "cylindrical equidistant projection" + "360 VR viewer"
#    is the EvoLink/pixelsham (May 2026) recipe that flips gpt-image-2 from a
#    flat cylindrical photo to a true equirect with dome ceiling + wrap.
# 2. Anchor photographic quality: real-camera language (AD-style, 360 panoramic
#    camera, real-camera exposure) pulls the model toward photo-trained weights
#    instead of stylized illustration weights.
# 3. Steer away from dense-mechanical-detail hallucinations. gpt-image-2's
#    weakest mode is rows of small buttons / readouts (mixing desks, lab gear,
#    cockpits) where it averages into "rocks-in-glass" noise. Telling it
#    explicitly to find detail in materials/light/form instead of in
#    mechanical micro-features measurably reduces the garbage.
SEAM_PROMPT_PREFIX = (
    # 1. Projection
    "Generate a 360-degree equirectangular (cylindrical equidistant projection) "
    "image in 2:1 aspect ratio, for direct mapping onto a VR sphere. Seamless "
    "panorama: the left and right edges must wrap continuously, with no warping "
    "at the zenith or nadir poles. "
    # 2. Photographic quality anchor
    "Photographic style: high-end architectural interior photography in the "
    "manner of Architectural Digest. Captured on a professional 360 panoramic "
    "camera with natural ambient and key lighting. Real-camera color, exposure, "
    "and depth. Materials and finishes are photographically faithful. "
    # 3. Detail-reduction steer
    "Composition: keep mid-ground and background surfaces clean and "
    "uncluttered. Detail should come from materials, light, and form — not "
    "from dense rows of small controls, illegible readouts, busy rack gear, "
    "or fragmented mechanical micro-detail. "
    # Anti-text
    "No text, letters, words, signs, labels, logos, watermarks, or typography. "
    "Scene: "
)


def generate_openai_equirect(prompt: str, *, rewrite: bool = True) -> bytes:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY not set")

    # LLM rewrite step: expand the short user prompt into a photographic
    # scene description that steers gpt-image-2 away from its weak modes.
    if rewrite:
        from prompt_rewriter import rewrite_user_prompt_sync
        scene_prompt = rewrite_user_prompt_sync(prompt)
    else:
        scene_prompt = prompt

    client = OpenAI(api_key=api_key)
    full_prompt = SEAM_PROMPT_PREFIX + scene_prompt

    print("  Calling gpt-image-2 at 3840x1920 (max 2:1 the API allows)...")
    result = client.images.generate(
        model="gpt-image-2",
        prompt=full_prompt,
        size="3840x1920",
        quality="high",
        output_format="jpeg",
    )
    return base64.b64decode(result.data[0].b64_json)


def save_seam_tile(img_bytes: bytes, out_path: str) -> None:
    """Tile the raw image twice horizontally so the wrap seam sits in the middle.

    A perfectly seamless equirectangular panorama will look continuous across
    the join. Anything visibly different — a hard edge, a jump in colour, a
    misaligned object — is the seam we care about.
    """
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    tiled = Image.new("RGB", (img.width * 2, img.height))
    tiled.paste(img, (0, 0))
    tiled.paste(img, (img.width, 0))
    tiled.save(out_path, "JPEG", quality=90)
    print(f"  Seam-check tile ({tiled.width}x{tiled.height}) saved to {out_path}")


def upscale_to_16k(img_bytes: bytes):
    img = pyvips.Image.new_from_buffer(img_bytes, "")
    if img.bands == 4:
        img = img[:3]
    print(f"  OpenAI image: {img.width}x{img.height}")

    canvas = img.resize(
        16384 / img.width,
        kernel=pyvips.enums.Kernel.LANCZOS3,
        vscale=8192 / img.height,
    )
    print(f"  Upscaled canvas: {canvas.width}x{canvas.height}")
    return canvas


def upscale_via_fal_4x(img_bytes: bytes) -> bytes:
    """4x upscale via fal.ai ESRGAN. 3840x1920 -> ~14142x7071. Returns JPEG bytes."""
    fal_key = os.environ.get("FAL_KEY", "")
    if not fal_key:
        raise SystemExit("FAL_KEY not set")

    endpoint = "fal-ai/esrgan"
    payload_extras = {"scale": 4}

    img = Image.open(io.BytesIO(img_bytes))
    if img.mode == "RGBA":
        img = img.convert("RGB")

    print(f"  Submitting {img.width}x{img.height} -> fal.ai ESRGAN x4...")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data_uri = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"

    headers = {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=300.0) as client:
        submit = client.post(
            f"https://queue.fal.run/{endpoint}",
            headers=headers,
            json={"image_url": data_uri, **payload_extras},
        )
        submit.raise_for_status()
        request_id = submit.json().get("request_id")
        if not request_id:
            raise RuntimeError(f"No request_id in fal response: {submit.json()}")

        # Poll status (fal queue API)
        while True:
            status = client.get(
                f"https://queue.fal.run/{endpoint}/requests/{request_id}/status",
                headers=headers,
            ).json()
            state = status.get("status")
            if state == "COMPLETED":
                break
            if state in ("FAILED", "CANCELLED"):
                raise RuntimeError(f"fal upscale failed: {status}")
            time.sleep(1.0)

        result = client.get(
            f"https://queue.fal.run/{endpoint}/requests/{request_id}",
            headers=headers,
        ).json()
        image_url = result.get("image", {}).get("url") or result.get("output", {}).get("url", "")
        if not image_url:
            raise RuntimeError(f"No image URL in fal result: {result}")

        upscaled = client.get(image_url).content

    # fal returns PNG by default; transcode to JPEG to keep file sizes sane
    up_img = Image.open(io.BytesIO(upscaled)).convert("RGB")
    out_buf = io.BytesIO()
    up_img.save(out_buf, format="JPEG", quality=92)
    print(f"  Upscaled to {up_img.width}x{up_img.height} ({len(out_buf.getvalue()) // 1024} KB)")
    return out_buf.getvalue()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    flag_set = {f.split("=", 1)[0] for f in flags}
    flag_vals = {f.split("=", 1)[0]: (f.split("=", 1)[1] if "=" in f else "") for f in flags}

    prompt = (
        args[0]
        if len(args) > 0
        else "a cozy mountain cabin at sunset, warm golden light, snow-capped peaks in the distance"
    )
    slug = args[1] if len(args) > 1 else "openai"
    do_upscale = "--upscale" in flag_set
    do_skip_gen = "--skip-gen" in flag_set  # reuse existing raw for upscale-only iterations
    do_rewrite = "--no-rewrite" not in flag_set  # LLM rewrite on by default

    raw_path = f"test_sphere_{slug}_raw.jpg"
    seam_path = f"test_sphere_{slug}_seam.jpg"
    upscaled_path = f"test_sphere_{slug}_upscaled.jpg"
    canvas_path = f"test_sphere_{slug}.jpg"

    print(f"Prompt: {prompt}")
    print(f"Slug: {slug}")
    print(f"Flags: upscale={do_upscale} skip-gen={do_skip_gen}")

    if do_skip_gen and os.path.exists(raw_path):
        with open(raw_path, "rb") as f:
            raw = f.read()
        print(f"  Reusing existing {raw_path}")
    else:
        raw = generate_openai_equirect(prompt, rewrite=do_rewrite)
        with open(raw_path, "wb") as f:
            f.write(raw)
        print(f"  Raw 3840x1920 saved to {raw_path}")
        save_seam_tile(raw, seam_path)

    if do_upscale:
        upscaled = upscale_via_fal_4x(raw)
        with open(upscaled_path, "wb") as f:
            f.write(upscaled)
        print(f"  Upscaled 4x (ESRGAN) saved to {upscaled_path}")

    if HAS_PYVIPS:
        canvas = upscale_to_16k(raw)
        canvas.write_to_file(f"{canvas_path}[Q=93]")
        print(f"  Pyvips 16K saved to {canvas_path}")

    print()
    print("Compare against test_sphere_blockade.jpg (run sphere_gen.py with the same prompt).")
    print("Inspect: horizontal seam? Pole pinching? Sharpness after upscale?")
