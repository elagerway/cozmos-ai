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

    Generates at 8K, then exports at native 16K (16384x8192).
    Returns the 16K equirectangular image bytes.
    """
    payload = {
        "prompt": prompt,
        "enhance_prompt": True,
    }
    if style_id:
        payload["skybox_style_id"] = style_id

    async with httpx.AsyncClient(timeout=180.0) as client:
        # Step 1: Generate 8K skybox
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
        obfuscated_id = result.get("obfuscated_id", "")
        if not gen_id:
            raise Exception(f"No generation ID in response: {result}")

        print(f"  Skybox generation started: {gen_id}")

        # Poll for 8K completion
        while True:
            status_resp = await client.get(
                f"{BLOCKADE_API_URL}/imagine/requests/{gen_id}",
                headers={"x-api-key": BLOCKADE_API_KEY},
            )
            status_resp.raise_for_status()
            status = status_resp.json()

            request = status.get("request", status)
            current_status = request.get("status", "")
            obfuscated_id = request.get("obfuscated_id", obfuscated_id)

            if on_progress:
                on_progress(current_status)

            if current_status == "complete":
                print(f"  8K generation complete, requesting 16K export...")
                break
            elif current_status in ("error", "failed"):
                error = request.get("error_message", "Unknown error")
                raise Exception(f"Skybox generation failed: {error}")

            await asyncio.sleep(2)

        # Step 2: Export at 16K (resolution_id=7)
        if on_progress:
            on_progress("exporting_16k")

        export_resp = await client.post(
            f"{BLOCKADE_API_URL}/skybox/export",
            headers={
                "x-api-key": BLOCKADE_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "skybox_id": obfuscated_id,
                "type_id": 2,
                "resolution_id": 7,
            },
        )
        export_resp.raise_for_status()
        export_result = export_resp.json()

        export_id = export_result.get("id")
        print(f"  16K export started: {export_id}")

        # Poll for 16K export completion
        while True:
            exp_status_resp = await client.get(
                f"{BLOCKADE_API_URL}/skybox/export/{export_id}",
                headers={"x-api-key": BLOCKADE_API_KEY},
            )
            exp_status_resp.raise_for_status()
            exp_status = exp_status_resp.json()

            exp_current = exp_status.get("status", "")

            if on_progress:
                on_progress(f"export_{exp_current}")

            if exp_current == "complete":
                file_url = exp_status.get("file_url", "")
                if not file_url:
                    raise Exception(f"No file_url in export response: {exp_status}")

                print(f"  16K export complete, downloading...")
                img_resp = await client.get(file_url)
                img_resp.raise_for_status()
                return img_resp.content

            elif exp_current in ("error", "failed"):
                # Fall back to 8K if 16K export fails
                print(f"  16K export failed, falling back to 8K...")
                file_url = request.get("file_url", "")
                if file_url:
                    img_resp = await client.get(file_url)
                    img_resp.raise_for_status()
                    return img_resp.content
                raise Exception(f"Export failed and no 8K fallback: {exp_status}")

            await asyncio.sleep(2)


async def generate_sphere_from_prompt(prompt: str, on_progress=None) -> pyvips.Image:
    """Generate a 16K equirectangular panorama from a text prompt.

    Uses Blockade Labs Skybox AI for native 16K generation.
    """
    global BLOCKADE_API_KEY
    BLOCKADE_API_KEY = os.environ.get("BLOCKADE_API_KEY", "")

    if not BLOCKADE_API_KEY:
        raise Exception("BLOCKADE_API_KEY not set")

    # Generate skybox (16K on Business plan, 8K on Standard)
    img_bytes = await generate_skybox(prompt, on_progress=on_progress)

    # Load into pyvips
    img = pyvips.Image.new_from_buffer(img_bytes, "")
    if img.bands == 4:
        img = img[:3]
    print(f"  Skybox image: {img.width}x{img.height}")

    # Ensure 16384x8192 canvas
    if img.width != 16384 or img.height != 8192:
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
