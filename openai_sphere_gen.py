"""
Alternative sphere-generation path via OpenAI gpt-image-2 + fal.ai ESRGAN.

Faster + cheaper than the Blockade path. Used by the "Re-roll fast" button on
the reroll modal. Initial sphere creation still goes through Blockade
(`sphere_gen.py`) because Blockade handles outdoor / sky / horizon scenes
correctly (proper polar projection), where gpt-image-2 falls back to a flat
cylindrical photo.

Public contract mirrors sphere_gen.generate_sphere_from_prompt() so the server
reroll handler can swap modules with no other plumbing changes.
"""

import asyncio
import base64
import io
import os
from typing import Callable, Literal, Optional

import httpx
import pyvips
from openai import AsyncOpenAI
from PIL import Image

from cost_tracker import log_fal_esrgan, log_openai_imagegen


OPENAI_MODEL = "gpt-image-2"
OPENAI_SIZE = "3840x1920"
OPENAI_QUALITY = "high"

Feature = Literal["initial_gen", "bg_reroll", "variants_preview"]

# Two jobs in order of importance:
# 1. Anchor projection so the result wraps + domes correctly as an equirect.
# 2. Anchor photographic quality so the model pulls from photo-trained weights.
# Mirrors SEAM_PROMPT_PREFIX in openai_sphere_test.py; keep both in sync.
#
# The previous "Composition: keep mid-ground clean / no fragmented mechanical
# micro-detail" steer was removed — it was demoting the user's central subject
# (mixing console, lab gear, etc.) and hurting outputs where the user actually
# wanted that gear rendered. Detail steering belongs in the rewriter now.
EQUIRECT_PROMPT_PREFIX = (
    # 1. Projection
    "Generate a 360-degree equirectangular (cylindrical equidistant projection) "
    "image in 2:1 aspect ratio, for direct mapping onto a VR sphere. Seamless "
    "panorama: the left and right edges must wrap continuously, with no warping "
    "at the zenith or nadir poles. "
    # 2. Photographic quality anchor
    "Ultra-hd photographic quality. Captured on a professional 360 panoramic "
    "camera with real-camera color, exposure, and depth. Materials and finishes "
    "are photographically faithful. "
    # Anti-text
    "No text, letters, words, signs, labels, logos, watermarks, or typography. "
    "Scene: "
)


async def generate_openai_raw(
    prompt: str,
    *,
    on_progress: Optional[Callable[[str], None]] = None,
    generation_id: Optional[str] = None,
    feature: Feature = "bg_reroll",
    rewrite: bool = True,
) -> bytes:
    """Generate a 3840x1920 JPEG via gpt-image-2. Returns raw bytes.

    When rewrite=True (default), the user prompt is first expanded via Claude
    Haiku into a photographic scene description that steers gpt-image-2 away
    from its weak modes (dense mechanical detail hallucination).
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    if rewrite:
        if on_progress:
            on_progress("rewriting_prompt")
        from prompt_rewriter import rewrite_user_prompt
        scene_prompt = await rewrite_user_prompt(prompt, generation_id=generation_id)
    else:
        scene_prompt = prompt

    if on_progress:
        on_progress("openai_generating")

    client = AsyncOpenAI(api_key=api_key)
    full_prompt = EQUIRECT_PROMPT_PREFIX + scene_prompt

    result = await client.images.generate(
        model=OPENAI_MODEL,
        prompt=full_prompt,
        size=OPENAI_SIZE,
        quality=OPENAI_QUALITY,
        output_format="jpeg",
    )

    log_openai_imagegen(
        operation="image_generate",
        generation_id=generation_id,
        feature=feature,
        model=OPENAI_MODEL,
        size=OPENAI_SIZE,
        quality=OPENAI_QUALITY,
        prompt=prompt,
    )

    if on_progress:
        on_progress("openai_done")

    return base64.b64decode(result.data[0].b64_json)


async def upscale_with_fal(
    img_bytes: bytes,
    *,
    on_progress: Optional[Callable[[str], None]] = None,
    generation_id: Optional[str] = None,
    feature: Feature = "bg_reroll",
) -> bytes:
    """4x upscale via fal.ai ESRGAN. 3840x1920 -> ~14142x7071. Returns JPEG bytes.

    Mirrors server.upscale_image_fal() but lives here so this module is the
    single contract surface for OpenAI-path generation.
    """
    fal_key = os.environ.get("FAL_KEY", "")
    if not fal_key:
        raise RuntimeError("FAL_KEY not set")

    if on_progress:
        on_progress("upscaling")

    img = Image.open(io.BytesIO(img_bytes))
    if img.mode == "RGBA":
        img = img.convert("RGB")
    input_w, input_h = img.size
    output_megapixels = (input_w * input_h * 16) / 1_000_000

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data_uri = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"

    headers = {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=120.0) as client:
        submit = await client.post(
            "https://queue.fal.run/fal-ai/esrgan",
            headers=headers,
            json={"image_url": data_uri, "scale": 4},
        )
        submit.raise_for_status()
        request_id = submit.json().get("request_id")
        if not request_id:
            raise RuntimeError(f"No request_id in fal response: {submit.json()}")

        while True:
            status_resp = await client.get(
                f"https://queue.fal.run/fal-ai/esrgan/requests/{request_id}/status",
                headers=headers,
            )
            status = status_resp.json()
            state = status.get("status")
            if state == "COMPLETED":
                break
            if state in ("FAILED", "CANCELLED"):
                raise RuntimeError(f"fal upscale failed: {status}")
            await asyncio.sleep(1.0)

        result_resp = await client.get(
            f"https://queue.fal.run/fal-ai/esrgan/requests/{request_id}",
            headers=headers,
        )
        result = result_resp.json()
        image_url = result.get("image", {}).get("url") or result.get("output", {}).get("url", "")
        if not image_url:
            raise RuntimeError(f"No image URL in fal result: {result}")

        upscaled = (await client.get(image_url)).content

    log_fal_esrgan(
        output_megapixels=output_megapixels,
        generation_id=generation_id,
        feature=feature,
        image_kind="sphere_equirect",
    )

    if on_progress:
        on_progress("upscale_done")

    # fal returns PNG by default; transcode to JPEG to keep storage costs reasonable.
    up_img = Image.open(io.BytesIO(upscaled)).convert("RGB")
    out = io.BytesIO()
    up_img.save(out, format="JPEG", quality=92)
    return out.getvalue()


async def generate_sphere_from_prompt_openai(
    prompt: str,
    on_progress: Optional[Callable[[str], None]] = None,
    *,
    generation_id: Optional[str] = None,
    feature: Feature = "bg_reroll",
) -> pyvips.Image:
    """OpenAI + fal ESRGAN path. Returns a pyvips.Image ready for tile generation.

    Mirrors sphere_gen.generate_sphere_from_prompt's contract: returns a
    pyvips.Image that the server then feeds to generate_tiles().
    """
    raw = await generate_openai_raw(
        prompt,
        on_progress=on_progress,
        generation_id=generation_id,
        feature=feature,
    )
    upscaled = await upscale_with_fal(
        raw,
        on_progress=on_progress,
        generation_id=generation_id,
        feature=feature,
    )

    img = pyvips.Image.new_from_buffer(upscaled, "")
    if img.bands == 4:
        img = img[:3]
    print(f"  OpenAI sphere: {img.width}x{img.height}")
    return img


if __name__ == "__main__":
    import sys

    prompt = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "a cozy mountain cabin at sunset, warm golden light, snow-capped peaks in the distance"
    )

    def on_progress(status):
        print(f"  Status: {status}")

    print(f"Prompt: {prompt}")
    canvas = asyncio.run(generate_sphere_from_prompt_openai(prompt, on_progress=on_progress))
    print(f"Result: {canvas.width}x{canvas.height}")
    canvas.write_to_file("test_sphere_openai_path.jpg[Q=93]")
    print("Saved to test_sphere_openai_path.jpg")
