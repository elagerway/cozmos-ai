"""
Sphere generation pipeline server.
Scrapes brand images, upscales with Real-ESRGAN, composes 16K equirectangular panorama,
generates tile pyramid for progressive loading.

Usage:
    DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 pipeline/server.py
"""

import os
import sys
import types
import time
import json
import uuid
import shutil
import asyncio
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

# Patch torchvision import before anything else
import torchvision.transforms.functional as F
fake = types.ModuleType("torchvision.transforms.functional_tensor")
fake.rgb_to_grayscale = F.rgb_to_grayscale
sys.modules["torchvision.transforms.functional_tensor"] = fake

import cv2
import numpy as np
import torch
import pyvips
import httpx
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from realesrgan import RealESRGANer
from basicsr.archs.rrdbnet_arch import RRDBNet

# --- Config ---
# On Railway, use /data for persistent storage; locally, use public/spheres
DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent.parent / "public" / "spheres")))
SPHERES_DIR = DATA_DIR
TILES_DIR = SPHERES_DIR / "tiles"
SPHERES_DIR.mkdir(parents=True, exist_ok=True)
TILES_DIR.mkdir(parents=True, exist_ok=True)
TILE_SIZE = 1024
CANVAS_W = 16384
CANVAS_H = 8192
LEVELS = [
    {"width": 2048, "cols": 2, "rows": 1},
    {"width": 4096, "cols": 4, "rows": 2},
    {"width": 8192, "cols": 8, "rows": 4},
    {"width": 16384, "cols": 16, "rows": 8},
]

# --- Upscaler setup ---
print("Loading Real-ESRGAN model...")
model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)

model_path = os.path.expanduser("~/.cache/realesrgan/RealESRGAN_x4plus.pth")
os.makedirs(os.path.dirname(model_path), exist_ok=True)

if not os.path.exists(model_path):
    print("Downloading model weights...")
    import urllib.request
    url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
    urllib.request.urlretrieve(url, model_path)

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Using device: {device}")

upsampler = RealESRGANer(
    scale=4,
    model_path=model_path,
    model=model,
    tile=512,
    tile_pad=10,
    pre_pad=0,
    half=False,
    device=device,
)
print("Model loaded.")

# --- FastAPI app ---
app = FastAPI(title="Cozmos Sphere Pipeline")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated tiles as static files
from fastapi.staticfiles import StaticFiles
app.mount("/spheres", StaticFiles(directory=str(SPHERES_DIR)), name="spheres")

# Track generation status
generations: dict[str, dict] = {}
executor = ThreadPoolExecutor(max_workers=2)


async def scrape_brand_images(brand: str) -> list[tuple[str, bytes]]:
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

    # Extract image URLs from HTML
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    img_tags = soup.find_all("img")

    candidates = []
    for img in img_tags:
        src = img.get("src") or img.get("data-src") or ""
        if not src or "svg" in src or "data:" in src or "icon" in src.lower():
            continue
        # Make absolute
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            from urllib.parse import urljoin
            src = urljoin(base_url, src)
        if not src.startswith("http"):
            continue
        # Try to request higher res for Nike CDN
        if "static.nike.com" in src:
            src = src.replace("dpr_1.0", "dpr_2.0").replace("h_600", "h_1200")
        candidates.append(src)

    # Download top 12 images, filter by minimum size
    images = []
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "Mozilla/5.0"},
    ) as client:
        for url in candidates[:20]:  # Try up to 20, keep best 12
            try:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue
                data = resp.content
                if len(data) < 10000:  # Skip tiny images
                    continue
                # Check dimensions
                arr = np.frombuffer(data, np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is None or img.shape[0] < 300 or img.shape[1] < 300:
                    continue
                images.append((url, data))
                if len(images) >= 12:
                    break
            except Exception:
                continue

    return images


def upscale_image(img_bytes: bytes) -> np.ndarray:
    """4x upscale a single image with Real-ESRGAN."""
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img.shape[2] == 4:
        img = img[:, :, :3]
    output, _ = upsampler.enhance(img, outscale=4)
    return output


def compose_panorama(images: list[np.ndarray], bg_color: list[int]) -> pyvips.Image:
    """Compose upscaled images into a 16K equirectangular panorama."""
    PAD = 60

    canvas = pyvips.Image.black(CANVAS_W, CANVAS_H, bands=3) + bg_color

    n = len(images)
    if n == 0:
        return canvas

    # Layout: top row = first 3 (heroes), bottom rows = rest
    heroes = images[:3] if n >= 3 else images
    products = images[3:] if n > 3 else []

    # Top row: heroes
    top_h = CANVAS_H // 2 - PAD
    top_cell_w = (CANVAS_W - PAD * (len(heroes) + 1)) // max(len(heroes), 1)

    for i, img_np in enumerate(heroes):
        img = pyvips.Image.new_from_memory(
            img_np.tobytes(), img_np.shape[1], img_np.shape[0], 3, "uchar"
        )
        scale = min(top_cell_w / img.width, top_h / img.height)
        resized = img.resize(scale, kernel=pyvips.enums.Kernel.LANCZOS3)
        x = PAD + i * (top_cell_w + PAD) + (top_cell_w - resized.width) // 2
        y = PAD + (top_h - resized.height) // 2
        canvas = canvas.insert(resized, x, y)

    # Bottom: products in rows
    if products:
        bot_start = CANVAS_H // 2 + PAD // 2
        bot_h_total = CANVAS_H - bot_start - PAD
        cols = min(len(products), 5)
        rows = (len(products) + cols - 1) // cols
        row_h = (bot_h_total - PAD * (rows - 1)) // rows
        cell_w = (CANVAS_W - PAD * (cols + 1)) // cols

        for idx, img_np in enumerate(products):
            r = idx // cols
            c = idx % cols
            img = pyvips.Image.new_from_memory(
                img_np.tobytes(), img_np.shape[1], img_np.shape[0], 3, "uchar"
            )
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

    # Also save the full-res JPEG
    full_path = SPHERES_DIR / f"{sphere_id}.jpg"
    buf = canvas.write_to_buffer(".jpg[Q=95]")
    full_path.write_bytes(buf)

    return sphere_id


def run_pipeline(gen_id: str, brand: str):
    """Run the full pipeline synchronously (called in thread pool)."""
    start = time.time()

    def update(step: str, pct: int, label: str):
        generations[gen_id].update({"step": step, "pct": pct, "label": label})

    try:
        # Step 1: Scrape
        update("scrape", 5, f"Scanning @{brand}...")
        loop = asyncio.new_event_loop()
        raw_images = loop.run_until_complete(scrape_brand_images(brand))
        loop.close()
        update("scrape", 10, f"Found {len(raw_images)} images")

        if not raw_images:
            generations[gen_id].update({"status": "failed", "error": "No images found"})
            return

        # Step 2: Upscale
        upscaled = []
        for i, (url, data) in enumerate(raw_images):
            pct = 10 + int(60 * (i / len(raw_images)))
            update("upscale", pct, f"Enhancing image {i+1}/{len(raw_images)}...")
            try:
                up = upscale_image(data)
                upscaled.append(up)
            except Exception as e:
                print(f"  Upscale failed for image {i}: {e}")
                # Use original if upscale fails
                arr = np.frombuffer(data, np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is not None:
                    upscaled.append(img)

        update("upscale", 70, f"Enhanced {len(upscaled)} images")

        # Step 3: Compose
        update("compose", 75, "Composing sphere panorama...")
        bg_color = [17, 17, 17]  # Default dark
        canvas = compose_panorama(upscaled, bg_color)
        update("compose", 85, "Panorama composed")

        # Step 4: Tiles
        update("tiles", 88, "Generating tile pyramid...")
        sphere_id = gen_id
        generate_tiles(canvas, sphere_id)
        update("tiles", 95, "Tiles generated")

        # Done
        duration = int(time.time() - start)
        generations[gen_id].update({
            "status": "done",
            "step": "done",
            "pct": 100,
            "label": "Your sphere is ready",
            "image_url": f"/spheres/{sphere_id}.jpg",
            "tile_stem": sphere_id,
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
async def generate(body: dict, background_tasks: BackgroundTasks):
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

    # Run pipeline in background thread
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
    return {"status": "ok", "device": device}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8100))
    uvicorn.run(app, host="0.0.0.0", port=port)
