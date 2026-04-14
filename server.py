"""
Sphere generation pipeline server.
Scrapes brand images, upscales via fal.ai GPU API, composes 16K equirectangular
panorama with pyvips, generates tile pyramid for progressive loading.

Usage (local):
    FAL_KEY=... DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 pipeline/server.py
"""

import os
import sys
import time
import uuid
import shutil
import asyncio
import base64
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pyvips
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from PIL import Image

# --- Config ---
DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent.parent / "public" / "spheres")))
SPHERES_DIR = DATA_DIR
TILES_DIR = SPHERES_DIR / "tiles"
SPHERES_DIR.mkdir(parents=True, exist_ok=True)
TILES_DIR.mkdir(parents=True, exist_ok=True)

FAL_KEY = os.environ.get("FAL_KEY", "")

TILE_SIZE = 1024
CANVAS_W = 16384
CANVAS_H = 8192
LEVELS = [
    {"width": 2048, "cols": 2, "rows": 1},
    {"width": 4096, "cols": 4, "rows": 2},
    {"width": 8192, "cols": 8, "rows": 4},
    {"width": 16384, "cols": 16, "rows": 8},
]

# --- FastAPI app ---
app = FastAPI(title="Cozmos Sphere Pipeline")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated tiles as static files
app.mount("/spheres", StaticFiles(directory=str(SPHERES_DIR)), name="spheres")

# Track generation status
generations: dict[str, dict] = {}
executor = ThreadPoolExecutor(max_workers=2)


async def scrape_brand_images(brand: str) -> list[bytes]:
    """Scrape product images from a brand's website."""
    urls_to_try = {
        "nike": "https://www.nike.com",
        "starbucks": "https://www.starbucks.com",
        "apple": "https://www.apple.com",
        "gucci": "https://www.gucci.com",
        "redbull": "https://www.redbull.com",
    }

    base_url = urls_to_try.get(brand, f"https://www.{brand}.com")

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=15.0,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
    ) as client:
        resp = await client.get(base_url)
        html = resp.text

    from bs4 import BeautifulSoup
    from urllib.parse import urljoin

    soup = BeautifulSoup(html, "html.parser")
    img_tags = soup.find_all("img")

    candidates = []
    for img in img_tags:
        src = img.get("src") or img.get("data-src") or ""
        if not src or "svg" in src or "data:" in src or "icon" in src.lower():
            continue
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = urljoin(base_url, src)
        if not src.startswith("http"):
            continue
        # Request higher res for Nike CDN
        if "static.nike.com" in src:
            src = src.replace("dpr_1.0", "dpr_2.0").replace("h_600", "h_1200")
        candidates.append(src)

    # Download top 12 images
    images = []
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "Mozilla/5.0"},
    ) as client:
        for url in candidates[:20]:
            try:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue
                data = resp.content
                if len(data) < 10000:
                    continue
                try:
                    img = Image.open(BytesIO(data))
                    if img.width < 300 or img.height < 300:
                        continue
                except Exception:
                    continue
                images.append(data)
                if len(images) >= 12:
                    break
            except Exception:
                continue

    return images


async def upscale_image_fal(img_bytes: bytes) -> bytes:
    """4x upscale a single image via fal.ai API."""
    # Convert to PNG for upload
    img = Image.open(BytesIO(img_bytes))
    if img.mode == "RGBA":
        img = img.convert("RGB")
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    data_uri = f"data:image/png;base64,{b64}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://queue.fal.run/fal-ai/esrgan",
            headers={
                "Authorization": f"Key {FAL_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "image_url": data_uri,
                "scale": 4,
            },
        )
        resp.raise_for_status()
        result = resp.json()

        # Poll for result
        request_id = result.get("request_id")
        if request_id:
            # Queue-based — poll status
            while True:
                status_resp = await client.get(
                    f"https://queue.fal.run/fal-ai/esrgan/requests/{request_id}/status",
                    headers={"Authorization": f"Key {FAL_KEY}"},
                )
                status = status_resp.json()
                if status.get("status") == "COMPLETED":
                    result_resp = await client.get(
                        f"https://queue.fal.run/fal-ai/esrgan/requests/{request_id}",
                        headers={"Authorization": f"Key {FAL_KEY}"},
                    )
                    result = result_resp.json()
                    break
                elif status.get("status") in ("FAILED", "CANCELLED"):
                    raise Exception(f"fal.ai upscale failed: {status}")
                await asyncio.sleep(0.5)

    # Download the upscaled image
    image_url = result.get("image", {}).get("url") or result.get("output", {}).get("url", "")
    if not image_url:
        raise Exception(f"No image URL in fal.ai response: {result}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        img_resp = await client.get(image_url)
        return img_resp.content


async def upscale_all_parallel(images: list[bytes], on_progress=None) -> list[bytes]:
    """Upscale all images in parallel via fal.ai."""
    results: list[bytes] = []
    tasks = [upscale_image_fal(img) for img in images]
    completed = 0

    for coro in asyncio.as_completed(tasks):
        try:
            upscaled_bytes = await coro
            results.append(upscaled_bytes)
        except Exception as e:
            print(f"  Upscale failed: {e}")
        completed += 1
        if on_progress:
            on_progress(completed, len(images))

    # If some upscales failed, fill with originals
    if len(results) < len(images):
        for i in range(len(results), len(images)):
            results.append(images[i])

    return results


def compose_panorama(images: list[bytes], bg_color: list[int]) -> pyvips.Image:
    """Compose upscaled images into a 16K equirectangular panorama."""
    PAD = 80
    canvas = pyvips.Image.black(CANVAS_W, CANVAS_H, bands=3) + bg_color

    n = len(images)
    if n == 0:
        return canvas

    def load_img(data: bytes) -> pyvips.Image:
        img = pyvips.Image.new_from_buffer(data, "")
        if img.bands == 4:
            img = img[:3]
        return img

    heroes = images[:3] if n >= 3 else images
    products = images[3:] if n > 3 else []

    # Top row: heroes
    top_h = CANVAS_H // 2 - PAD
    top_cell_w = (CANVAS_W - PAD * (len(heroes) + 1)) // max(len(heroes), 1)

    for i, img_bytes in enumerate(heroes):
        img = load_img(img_bytes)
        scale = min(top_cell_w / img.width, top_h / img.height)
        resized = img.resize(scale, kernel=pyvips.enums.Kernel.LANCZOS3)
        x = PAD + i * (top_cell_w + PAD) + (top_cell_w - resized.width) // 2
        y = PAD + (top_h - resized.height) // 2
        canvas = canvas.insert(resized, x, y)

    # Bottom: products
    if products:
        bot_start = CANVAS_H // 2 + PAD // 2
        bot_h_total = CANVAS_H - bot_start - PAD
        cols = min(len(products), 5)
        rows = (len(products) + cols - 1) // cols
        row_h = (bot_h_total - PAD * (rows - 1)) // max(rows, 1)
        cell_w = (CANVAS_W - PAD * (cols + 1)) // cols

        for idx, img_bytes in enumerate(products):
            r = idx // cols
            c = idx % cols
            img = load_img(img_bytes)
            scale = min(cell_w / img.width, row_h / img.height)
            resized = img.resize(scale, kernel=pyvips.enums.Kernel.LANCZOS3)
            x = PAD + c * (cell_w + PAD) + (cell_w - resized.width) // 2
            y = bot_start + r * (row_h + PAD) + (row_h - resized.height) // 2
            canvas = canvas.insert(resized, x, y)

    return canvas


def generate_tiles(canvas: pyvips.Image, sphere_id: str) -> str:
    """Generate tile pyramid from panorama canvas."""
    sphere_tiles_dir = TILES_DIR / sphere_id
    if sphere_tiles_dir.exists():
        shutil.rmtree(sphere_tiles_dir)
    sphere_tiles_dir.mkdir(parents=True, exist_ok=True)

    # Base image
    base = canvas.resize(
        2048 / canvas.width,
        kernel=pyvips.enums.Kernel.LANCZOS3,
        vscale=1024 / canvas.height,
    )
    buf = base.write_to_buffer(".jpg[Q=82]")
    (sphere_tiles_dir / "base.jpg").write_bytes(buf)

    # Tile levels
    for li, level in enumerate(LEVELS):
        level_dir = sphere_tiles_dir / str(li)
        level_dir.mkdir(exist_ok=True)
        lh = level["width"] // 2
        limg = canvas.resize(
            level["width"] / canvas.width,
            kernel=pyvips.enums.Kernel.LANCZOS3,
            vscale=lh / canvas.height,
        )
        for r in range(level["rows"]):
            for c in range(level["cols"]):
                tile = limg.crop(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                buf = tile.write_to_buffer(".jpg[Q=93]")
                (level_dir / f"{c}_{r}.jpg").write_bytes(buf)

    # Full-res JPEG
    full_path = SPHERES_DIR / f"{sphere_id}.jpg"
    buf = canvas.write_to_buffer(".jpg[Q=95]")
    full_path.write_bytes(buf)

    return sphere_id


def run_pipeline(gen_id: str, brand: str):
    """Run the full pipeline."""
    start = time.time()

    def update(step: str, pct: int, label: str):
        generations[gen_id].update({"step": step, "pct": pct, "label": label})

    try:
        # Step 1: Scrape
        update("scrape", 5, f"Scanning @{brand}...")
        loop = asyncio.new_event_loop()
        raw_images = loop.run_until_complete(scrape_brand_images(brand))
        update("scrape", 10, f"Found {len(raw_images)} images")

        if not raw_images:
            generations[gen_id].update({"status": "failed", "error": "No images found"})
            loop.close()
            return

        # Step 2: Upscale via fal.ai (parallel)
        def on_upscale_progress(done, total):
            pct = 10 + int(55 * (done / total))
            update("upscale", pct, f"Enhancing image {done}/{total}...")

        update("upscale", 12, f"Enhancing {len(raw_images)} images (GPU)...")
        upscaled = loop.run_until_complete(
            upscale_all_parallel(raw_images, on_progress=on_upscale_progress)
        )
        loop.close()
        update("upscale", 65, f"Enhanced {len(upscaled)} images")

        # Step 3: Compose
        update("compose", 70, "Composing sphere panorama...")
        bg_color = [17, 17, 17]
        canvas = compose_panorama(upscaled, bg_color)
        update("compose", 80, "Panorama composed")

        # Step 4: Tiles
        update("tiles", 82, "Generating tile pyramid...")
        generate_tiles(canvas, gen_id)
        update("tiles", 95, "Tiles generated")

        # Done
        duration = int(time.time() - start)
        generations[gen_id].update({
            "status": "done",
            "step": "done",
            "pct": 100,
            "label": "Your sphere is ready",
            "image_url": f"/spheres/{gen_id}.jpg",
            "tile_stem": gen_id,
            "duration_s": duration,
            "image_count": len(upscaled),
        })
        print(f"Pipeline complete: {gen_id} in {duration}s")

    except Exception as e:
        print(f"Pipeline error: {e}")
        import traceback
        traceback.print_exc()
        generations[gen_id].update({"status": "failed", "error": str(e)})


@app.post("/generate")
async def generate(body: dict):
    """Start sphere generation from a brand handle."""
    brand = body.get("brand", "").strip().lower().replace("@", "")
    prompt = body.get("prompt", "")

    if not brand:
        return JSONResponse({"error": "brand is required"}, status_code=400)

    gen_id = f"gen-{brand}-{uuid.uuid4().hex[:8]}"
    generations[gen_id] = {
        "id": gen_id,
        "brand": brand,
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "pct": 0,
        "label": "Starting...",
    }

    executor.submit(run_pipeline, gen_id, brand)
    return {"id": gen_id}


@app.get("/status/{gen_id}")
async def status(gen_id: str):
    """Poll generation status."""
    if gen_id not in generations:
        return JSONResponse({"error": "not found"}, status_code=404)
    return generations[gen_id]


@app.get("/health")
async def health():
    return {"status": "ok", "fal_key_set": bool(FAL_KEY)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8100))
    print(f"Starting pipeline server on port {port}")
    print(f"FAL_KEY: {'set' if FAL_KEY else 'NOT SET'}")
    uvicorn.run(app, host="0.0.0.0", port=port)
