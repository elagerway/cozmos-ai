"""
Sphere generation pipeline server.
Scrapes brand images, upscales via fal.ai GPU API, composes 16K equirectangular
panorama with pyvips, generates tile pyramid for progressive loading.

Usage (local):
    FAL_KEY=... DYLD_LIBRARY_PATH=/opt/homebrew/lib python3 pipeline/server.py
"""

from dotenv import load_dotenv
load_dotenv()
import os
import sys
import time
import uuid
from datetime import datetime, timezone
import shutil
import asyncio
import base64
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pyvips
# Limit vips memory usage and concurrency for Railway
pyvips.cache_set_max_mem(100 * 1024 * 1024)  # 100MB cache max
pyvips.cache_set_max(50)
import httpx
from cost_tracker import log_fal_esrgan, log_gemini_imagegen
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
BLOCKADE_API_KEY = os.environ.get("BLOCKADE_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")

# Get git commit hash at startup
import subprocess
try:
    COMMIT_HASH = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
except Exception:
    COMMIT_HASH = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown")[:7]
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

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

# Variant-picker state: job_id -> {
#   gen_id, prompt, style_id, negative_text, high_res, status,
#   variants: [{ id, obfuscated_id, preview_url, status, error? }]
# }
# In-memory only — dropped on restart (accepted tradeoff for PR #2).
variants_cache: dict[str, dict] = {}


async def crawl_internal_links(url: str) -> list[str]:
    """Find internal page links on a site to scrape more content."""
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, urlparse

    base_domain = urlparse(url).netloc
    pages = [url]

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        ) as client:
            resp = await client.get(url)
            soup = BeautifulSoup(resp.text, "html.parser")

            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("/") and not href.startswith("//"):
                    href = urljoin(url, href)
                parsed = urlparse(href)
                if parsed.netloc == base_domain and href not in pages:
                    # Skip anchors, assets, auth pages
                    if any(x in href for x in ["#", ".pdf", ".zip", "login", "signup", "auth"]):
                        continue
                    pages.append(href)
                    if len(pages) >= 8:
                        break
    except Exception as e:
        print(f"  Crawl failed: {e}")

    return pages


async def screenshot_pages(urls: list[str]) -> list[bytes]:
    """Take screenshots of multiple pages using headless Chromium via Playwright.

    For each page: dismiss cookie banners, scroll through the page,
    and capture screenshots at different scroll positions.
    """
    from playwright.async_api import async_playwright

    images = []

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            )

            for page_url in urls:
                if len(images) >= 12:
                    break
                try:
                    page = await context.new_page()
                    await page.goto(page_url, wait_until="networkidle", timeout=15000)

                    # Dismiss cookie/consent banners
                    for selector in [
                        "button:has-text('Accept')",
                        "button:has-text('Accept All')",
                        "button:has-text('Got it')",
                        "button:has-text('OK')",
                        "button:has-text('Agree')",
                        "[class*='cookie'] button",
                        "[class*='consent'] button",
                        "[id*='cookie'] button",
                    ]:
                        try:
                            btn = page.locator(selector).first
                            if await btn.is_visible(timeout=500):
                                await btn.click()
                                await page.wait_for_timeout(300)
                                break
                        except Exception:
                            continue

                    # Get total page height
                    total_height = await page.evaluate("document.body.scrollHeight")
                    viewport_h = 800

                    # Screenshot at different scroll positions
                    positions = list(range(0, min(total_height, 8000), viewport_h))
                    for scroll_y in positions:
                        if len(images) >= 12:
                            break
                        await page.evaluate(f"window.scrollTo(0, {scroll_y})")
                        await page.wait_for_timeout(300)
                        screenshot = await page.screenshot(type="png")
                        if len(screenshot) > 5000:
                            images.append(screenshot)
                            print(f"  Screenshot: {page_url[:50]} scroll={scroll_y} ({len(screenshot)} bytes)")

                    await page.close()
                except Exception as e:
                    print(f"  Screenshot failed for {page_url[:50]}: {e}")
                    continue

            await browser.close()
    except Exception as e:
        print(f"  Playwright error: {e}")

    return images


async def scrape_youtube_thumbnails(handle: str) -> list[bytes]:
    """Scrape high-res video thumbnails from a YouTube channel.

    YouTube thumbnails are always available at 1920x1080 (maxresdefault)
    or 1280x720 (hqdefault). This is the best source for influencer content.
    """
    import re

    channel_urls = [
        f"https://www.youtube.com/@{handle}/videos",
        f"https://www.youtube.com/c/{handle}/videos",
        f"https://www.youtube.com/{handle}/videos",
    ]

    video_ids = set()

    async with httpx.AsyncClient(
        follow_redirects=True, timeout=15.0,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
    ) as client:
        for channel_url in channel_urls:
            try:
                resp = await client.get(channel_url)
                if resp.status_code != 200:
                    continue
                # Extract video IDs from the page
                ids = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', resp.text)
                video_ids.update(ids)
                if video_ids:
                    print(f"  Found {len(video_ids)} videos on {channel_url}")
                    break
            except Exception:
                continue

    if not video_ids:
        return []

    # Download maxresdefault thumbnails (1920x1080)
    images = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for vid in list(video_ids)[:20]:
            for quality in ["maxresdefault", "hqdefault"]:
                try:
                    url = f"https://img.youtube.com/vi/{vid}/{quality}.jpg"
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.content) > 5000:
                        # Skip the default gray placeholder (very small file)
                        if len(resp.content) > 10000:
                            images.append(resp.content)
                            print(f"  YouTube thumbnail: {vid} ({quality}, {len(resp.content)} bytes)")
                            break
                except Exception:
                    continue
            if len(images) >= 12:
                break

    return images


async def scrape_images_from_url(url: str) -> list[bytes]:
    """Scrape images from any URL. Falls back to screenshots if no images found."""
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, unquote

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=15.0,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
    ) as client:
        resp = await client.get(url)
        html = resp.text

    soup = BeautifulSoup(html, "html.parser")
    img_tags = soup.find_all("img")

    candidates = []
    for img in img_tags:
        src = img.get("src") or img.get("data-src") or img.get("data-lazy-src") or ""
        if not src or "data:" in src or "icon" in src.lower():
            continue
        # Skip tiny SVGs but allow SVG URLs (they might be large illustrations)
        if src.endswith(".svg") or "svg" in src.split("?")[0].split("/")[-1]:
            continue
        # Handle Next.js /_next/image URLs — extract the original URL
        if "/_next/image" in src:
            import re
            match = re.search(r'url=([^&]+)', src)
            if match:
                src = unquote(match.group(1))
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = urljoin(url, src)
        if not src.startswith("http"):
            continue
        candidates.append(src)

    # Also grab from srcset (common in Next.js, responsive images)
    for tag in soup.find_all(attrs={"srcset": True}):
        srcset = tag.get("srcset", "")
        for part in srcset.split(","):
            src = part.strip().split(" ")[0]
            if "/_next/image" in src:
                import re
                match = re.search(r'url=([^&]+)', src)
                if match:
                    src = unquote(match.group(1))
            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                src = urljoin(url, src)
            if src.startswith("http") and not src.endswith(".svg"):
                candidates.append(src)

    # Also check og:image and meta images
    for meta in soup.find_all("meta", attrs={"property": True}):
        if "image" in (meta.get("property") or ""):
            src = meta.get("content", "")
            if src.startswith("http"):
                candidates.append(src)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    candidates = unique

    images = []
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "Mozilla/5.0"},
    ) as client:
        for img_url in candidates[:30]:
            try:
                resp = await client.get(img_url)
                if resp.status_code != 200:
                    continue
                data = resp.content
                if len(data) < 5000:
                    continue
                try:
                    img = Image.open(BytesIO(data))
                    if img.width < 200 or img.height < 200:
                        continue
                except Exception:
                    continue
                images.append(data)
                if len(images) >= 12:
                    break
            except Exception:
                continue

    # Fallback: if not enough images, crawl internal pages and screenshot them
    # Never screenshot social platforms that require auth
    auth_domains = ["instagram.com", "facebook.com", "tiktok.com", "linkedin.com", "twitter.com", "x.com"]
    is_auth_site = any(d in url for d in auth_domains)

    if len(images) < 6 and not is_auth_site:
        print(f"  Only {len(images)} images found, crawling site pages for screenshots...")
        pages = await crawl_internal_links(url)
        print(f"  Found {len(pages)} pages to screenshot")
        screenshots = await screenshot_pages(pages)
        images.extend(screenshots)

    return images


async def is_real_website(url: str) -> bool:
    """Check if a URL leads to a real website (not parked, error, or forsale page)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0,
            headers={"User-Agent": "Mozilla/5.0"}) as client:
            resp = await client.get(url)
            if resp.status_code >= 400:
                return False
            text = resp.text.lower()
            # Detect parked/forsale/error pages
            parked_signals = [
                "godaddy", "forsale", "this domain", "buy this domain",
                "parked", "domain for sale", "access denied", "403 forbidden",
                "squarespace.com/buy", "namecheap", "dan.com",
                "sign up for instagram", "log in to instagram", "profile isn't available",
                "sign in", "log in", "create an account", "sign up",
                "page not found", "404", "this page isn't available",
                "verify your identity", "confirm your identity",
                "suspicious activity", "unusual login",
            ]
            for signal in parked_signals:
                if signal in text:
                    return False
            return True
    except Exception:
        return False


async def scrape_brand_images(brand: str) -> list[bytes]:
    """Scrape product images from a brand's website or social profiles.

    For known brands, tries their website first.
    For unknown names (likely people/influencers), tries social platforms first.
    Skips parked domains and error pages.
    """
    known_urls = {
        "nike": "https://www.nike.com",
        "starbucks": "https://www.starbucks.com",
        "apple": "https://www.apple.com",
        "gucci": "https://www.gucci.com",
        "redbull": "https://www.redbull.com",
    }

    # Try known URL first
    if brand in known_urls:
        images = await scrape_images_from_url(known_urls[brand])
        if images:
            return images

    # For known brands, try website first; for unknown names, try socials first
    is_known_brand = brand in known_urls

    if is_known_brand:
        # Try website
        for url in [f"https://www.{brand}.com", f"https://{brand}.com"]:
            if await is_real_website(url):
                images = await scrape_images_from_url(url)
                if images:
                    return images

    # Try YouTube thumbnails first — best source for influencers (always hi-res)
    print(f"  Trying YouTube thumbnails for {brand}...")
    images = await scrape_youtube_thumbnails(brand)
    if images:
        return images

    # Try other social platforms
    social_urls = [
        f"https://www.instagram.com/{brand}/",
        f"https://x.com/{brand}",
        f"https://www.tiktok.com/@{brand}",
        f"https://www.linkedin.com/in/{brand}/",
    ]

    for social_url in social_urls:
        print(f"  Trying {social_url}...")
        images = await scrape_images_from_url(social_url)
        if images:
            return images

    # Last resort for unknown names: try website (might work for some)
    if not is_known_brand:
        for url in [f"https://www.{brand}.com", f"https://{brand}.com"]:
            if await is_real_website(url):
                images = await scrape_images_from_url(url)
                if images:
                    return images

    # YouTube search — handles typos, alternate names, etc.
    # This is the most resilient source because YouTube search is fuzzy
    from profile_scraper import search_youtube_handle, scrape_youtube_channel
    print(f"  Trying YouTube search for '{brand}'...")
    # Convert slug back to searchable name (marquesBrownlee → marques brownlee)
    import re as _re
    search_name = _re.sub(r'([a-z])([A-Z])', r'\1 \2', brand)
    search_name = search_name.replace("_", " ").replace(".", " ")
    yt_handle = await search_youtube_handle(search_name)
    if yt_handle:
        yt_data = await scrape_youtube_channel(yt_handle)
        if yt_data and yt_data.videos:
            from profile_scraper import download_thumbnails
            images = await download_thumbnails(yt_data.videos)
            if images:
                print(f"  YouTube search found {len(images)} thumbnails via @{yt_handle}")
                return images

    # Google Images search — last resort, scrape image results
    print(f"  Trying Google Images for '{search_name}'...")
    google_url = f"https://www.google.com/search?q={search_name.replace(' ', '+')}&tbm=isch"
    images = await scrape_images_from_url(google_url)
    if images:
        print(f"  Google Images found {len(images)} images")
        return images

    return []


async def upscale_image_fal(
    img_bytes: bytes,
    *,
    generation_id: str | None = None,
    feature: str = "initial_gen",
    image_kind: str | None = None,
) -> bytes:
    """4x upscale a single image via fal.ai API.

    Logs cost attributed to generation_id/feature based on output megapixels
    (input w*h * 16 for 4x upscale).
    """
    # Convert to PNG for upload
    img = Image.open(BytesIO(img_bytes))
    if img.mode == "RGBA":
        img = img.convert("RGB")
    input_w, input_h = img.size
    output_megapixels = (input_w * input_h * 16) / 1_000_000
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
        log_fal_esrgan(
            output_megapixels=output_megapixels,
            generation_id=generation_id,
            feature=feature,  # type: ignore[arg-type]
            image_kind=image_kind,
        )
        return img_resp.content


async def upscale_all_parallel(
    images: list[bytes],
    on_progress=None,
    *,
    generation_id: str | None = None,
    feature: str = "initial_gen",
    image_kind: str | None = None,
) -> list[bytes]:
    """Upscale all images via fal.ai, 4 at a time to limit memory."""
    results: list[bytes] = []
    completed = 0
    sem = asyncio.Semaphore(4)

    async def upscale_one(img):
        async with sem:
            return await upscale_image_fal(
                img,
                generation_id=generation_id,
                feature=feature,
                image_kind=image_kind,
            )

    tasks = [upscale_one(img) for img in images]

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


def compose_on_environment(images: list[bytes], environment: pyvips.Image) -> pyvips.Image:
    """Composite upscaled images onto a Blockade-generated environment.

    Images are placed as small framed photos scattered in the equatorial band.
    Sized to ~15-20% of canvas width so the environment dominates.
    """
    PAD = 200
    canvas = environment

    n = len(images)
    if n == 0:
        return canvas

    def load_img(data: bytes) -> pyvips.Image:
        img = pyvips.Image.new_from_buffer(data, "")
        if img.bands == 4:
            img = img[:3]
        return img

    # Use only 4-6 images max, placed as small frames scattered around
    # The environment should dominate — images are accents, not wallpaper
    BAND_TOP = int(CANVAS_H * 0.30)
    BAND_BOT = int(CANVAS_H * 0.70)
    BAND_H = BAND_BOT - BAND_TOP

    # Limit to 6 images, no hero/product distinction — all same small size
    display_images = images[:6]

    # Each image is ~15% of canvas width — small framed photos, not billboards
    frame_max_w = int(CANVAS_W * 0.12)
    frame_max_h = int(BAND_H * 0.35)

    # Scatter positions — evenly spaced around the panorama
    positions = [
        (int(CANVAS_W * 0.08), BAND_TOP + int(BAND_H * 0.15)),
        (int(CANVAS_W * 0.25), BAND_TOP + int(BAND_H * 0.55)),
        (int(CANVAS_W * 0.42), BAND_TOP + int(BAND_H * 0.20)),
        (int(CANVAS_W * 0.58), BAND_TOP + int(BAND_H * 0.50)),
        (int(CANVAS_W * 0.75), BAND_TOP + int(BAND_H * 0.15)),
        (int(CANVAS_W * 0.88), BAND_TOP + int(BAND_H * 0.55)),
    ]

    for i, img_bytes in enumerate(display_images):
        if i >= len(positions):
            break
        px, py = positions[i]
        img = load_img(img_bytes)
        scale = min(frame_max_w / img.width, frame_max_h / img.height)
        resized = img.resize(scale, kernel=pyvips.enums.Kernel.LANCZOS3)

        # Dark frame border
        frame_pad = 8
        frame = pyvips.Image.black(resized.width + frame_pad * 2, resized.height + frame_pad * 2, bands=3) + [25, 25, 25]
        fx = max(0, px - frame_pad)
        fy = max(0, py - frame_pad)
        if fx + frame.width <= canvas.width and fy + frame.height <= canvas.height:
            canvas = canvas.insert(frame, fx, fy)
        if px + resized.width <= canvas.width and py + resized.height <= canvas.height:
            canvas = canvas.insert(resized, px, py)

    return canvas


def compose_panorama(images: list[bytes], bg_color: list[int]) -> pyvips.Image:
    """Compose upscaled images into a 16K equirectangular panorama.

    Images are placed in the equatorial band (middle 70% of canvas height)
    to avoid pole distortion. Poles are filled with the background color.
    """
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

    # Keep images in the equatorial band: 15%-85% of canvas height
    # This avoids the pole regions where equirectangular stretching is worst
    BAND_TOP = int(CANVAS_H * 0.15)     # ~1229px from top
    BAND_BOT = int(CANVAS_H * 0.85)     # ~6963px from top
    BAND_H = BAND_BOT - BAND_TOP        # ~5734px usable height

    heroes = images[:3] if n >= 3 else images
    products = images[3:] if n > 3 else []

    # Top row: heroes (upper half of the band)
    top_h = BAND_H // 2 - PAD
    top_cell_w = (CANVAS_W - PAD * (len(heroes) + 1)) // max(len(heroes), 1)

    for i, img_bytes in enumerate(heroes):
        img = load_img(img_bytes)
        scale = min(top_cell_w / img.width, top_h / img.height)
        resized = img.resize(scale, kernel=pyvips.enums.Kernel.LANCZOS3)
        x = PAD + i * (top_cell_w + PAD) + (top_cell_w - resized.width) // 2
        y = BAND_TOP + PAD + (top_h - resized.height) // 2
        canvas = canvas.insert(resized, x, y)

    # Bottom: products (lower half of the band)
    if products:
        bot_start = BAND_TOP + BAND_H // 2 + PAD // 2
        bot_h_total = BAND_BOT - bot_start - PAD
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


def upload_to_supabase(path: str, data: bytes, content_type: str = "image/jpeg"):
    """Upload a file to Supabase Storage 'spheres' bucket."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None
    import requests
    url = f"{SUPABASE_URL}/storage/v1/object/spheres/{path}"
    resp = requests.post(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=data,
    )
    if resp.status_code in (200, 201):
        return f"{SUPABASE_URL}/storage/v1/object/public/spheres/{path}"
    else:
        print(f"  Upload failed for {path}: {resp.status_code} {resp.text[:200]}")
        return None


def save_generation_record(gen_id: str, data: dict):
    """Save a generation record to Supabase. Includes pipeline commit hash."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return
    import requests
    # Inject commit hash into step_label
    if "step_label" in data:
        data["step_label"] = f"{data['step_label']} [{COMMIT_HASH}]"
    url = f"{SUPABASE_URL}/rest/v1/generations"
    resp = requests.post(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={"id": gen_id, **data},
    )
    if resp.status_code not in (200, 201, 204):
        print(f"  DB save failed: {resp.status_code} {resp.text[:200]}")


def update_generation_status(gen_id: str, data: dict):
    """Update an existing generation record in Supabase."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return
    import requests
    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/generations?id=eq.{gen_id}",
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json=data,
    )
    if resp.status_code not in (200, 204):
        print(f"  DB update failed: {resp.status_code} {resp.text[:200]}")


def generate_tiles(canvas: pyvips.Image, sphere_id: str, upload: bool = True, on_progress=None, high_res: bool = False) -> str:
    """Generate tile pyramid and optionally upload to Supabase Storage.

    high_res=False (default) skips the 16K level (level index 3). That drops the
    tile count from 170 → 42 and makes generation + upload roughly 4× faster,
    with no visual difference at normal viewing distance. Set True to keep 16K
    for extreme zoom-in sharpness.
    """
    sphere_tiles_dir = TILES_DIR / sphere_id
    if sphere_tiles_dir.exists():
        shutil.rmtree(sphere_tiles_dir)
    sphere_tiles_dir.mkdir(parents=True, exist_ok=True)

    levels = LEVELS if high_res else LEVELS[:3]

    # Base image
    base = canvas.resize(
        2048 / canvas.width,
        kernel=pyvips.enums.Kernel.LANCZOS3,
        vscale=1024 / canvas.height,
    )
    buf = base.write_to_buffer(".jpg[Q=82]")
    (sphere_tiles_dir / "base.jpg").write_bytes(buf)
    if upload:
        upload_to_supabase(f"tiles/{sphere_id}/base.jpg", buf)

    # Tile levels
    total_tiles = sum(l["cols"] * l["rows"] for l in levels)
    tiles_done = 0
    for li, level in enumerate(levels):
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
                if upload:
                    upload_to_supabase(f"tiles/{sphere_id}/{li}/{c}_{r}.jpg", buf)
                tiles_done += 1
                if on_progress and tiles_done % 10 == 0:
                    on_progress(tiles_done, total_tiles)

    # 8K JPEG (within JPEG limits)
    img_8k = canvas.resize(8192 / canvas.width, kernel=pyvips.enums.Kernel.LANCZOS3, vscale=4096 / canvas.height)
    buf = img_8k.write_to_buffer(".jpg[Q=93]")
    full_path = SPHERES_DIR / f"{sphere_id}.jpg"
    full_path.write_bytes(buf)
    if upload:
        upload_to_supabase(f"{sphere_id}.jpg", buf)

    # Small thumbnail for gallery cards (~30-50KB)
    thumb = canvas.resize(600 / canvas.width, kernel=pyvips.enums.Kernel.LANCZOS3, vscale=300 / canvas.height)
    thumb_buf = thumb.write_to_buffer(".jpg[Q=60]")
    (SPHERES_DIR / f"{sphere_id}_thumb.jpg").write_bytes(thumb_buf)
    if upload:
        upload_to_supabase(f"{sphere_id}_thumb.jpg", thumb_buf)

    return sphere_id


def run_pipeline(gen_id: str, brand: str, source_url: str = ""):
    """Run the full pipeline."""
    start = time.time()

    def update(step: str, pct: int, label: str):
        generations[gen_id].update({"step": step, "pct": pct, "label": label})

    try:
        # Step 1: Scrape
        loop = asyncio.new_event_loop()
        if source_url:
            update("scrape", 5, f"Scanning {source_url[:50]}...")
            raw_images = loop.run_until_complete(scrape_images_from_url(source_url))
        else:
            update("scrape", 5, f"Scanning @{brand}...")
            raw_images = loop.run_until_complete(scrape_brand_images(brand))
        update("scrape", 10, f"Found {len(raw_images)} images")

        if not raw_images:
            # No images found via scraping — fall through to pure AI generation
            print(f"  No images found for {brand or source_url}, falling through to AI generation")
            update("scrape", 10, "No scrapeable content found, generating AI environment...")
            if BLOCKADE_API_KEY:
                from sphere_gen import generate_sphere_from_prompt
                from style_analyzer import build_blockade_prompt
                prompt_text = generations[gen_id].get("prompt", brand or "modern studio")
                def on_ai_progress(status):
                    if status == "processing":
                        update("upscale", 40, "AI rendering 360° environment...")
                    elif status == "exporting_16k":
                        update("upscale", 55, "Exporting 16K...")
                canvas = loop.run_until_complete(
                    generate_sphere_from_prompt(
                        prompt_text,
                        on_progress=on_ai_progress,
                        generation_id=gen_id,
                    )
                )
                update("compose", 70, "AI environment generated")
                loop.close()
                # Skip upscale/compose, go straight to tiles
                def on_tile_progress(done, total):
                    pct = 72 + int(23 * (done / total))
                    update("tiles", pct, f"Generating tiles ({done}/{total})...")
                update("tiles", 72, "Generating tile pyramid...")
                generate_tiles(canvas, gen_id, on_progress=on_tile_progress)
                update("tiles", 95, "Tiles generated")
                update("save", 96, "Saving to cloud...")
                duration = int(time.time() - start)
                if SUPABASE_URL:
                    tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
                    image_url = f"{tile_base_url}/{gen_id}.jpg"
                else:
                    tile_base_url = ""
                    image_url = f"/spheres/{gen_id}.jpg"
                update_generation_status(gen_id, {
                    "status": "done", "step": "done",
                    "step_label": f"Your sphere is ready [{COMMIT_HASH}]",
                    "image_url": image_url, "tile_stem": gen_id,
                    "tile_base_url": tile_base_url, "duration_s": duration,
                })
                generations[gen_id].update({
                    "status": "done", "step": "done", "pct": 100,
                    "label": "Your sphere is ready",
                    "image_url": image_url, "tile_stem": gen_id,
                    "tile_base_url": tile_base_url, "duration_s": duration,
                })
                print(f"AI fallback complete: {gen_id} in {duration}s")
                return
            else:
                generations[gen_id].update({"status": "failed", "error": "No content found and AI generation unavailable"})
                update_generation_status(gen_id, {"status": "failed", "error": "No content found"})
                loop.close()
                return

        # Check source image quality
        max_dim = 0
        for img_bytes in raw_images:
            try:
                img = Image.open(BytesIO(img_bytes))
                max_dim = max(max_dim, img.width, img.height)
            except Exception:
                pass
        low_res = max_dim < 2000
        if low_res:
            generations[gen_id]["low_res_warning"] = True
            print(f"  Warning: max source image dimension is {max_dim}px (low res)")

        # Step 2: Analyze style + generate environment (if Blockade available)
        use_blockade = bool(BLOCKADE_API_KEY)

        if use_blockade:
            from style_analyzer import build_blockade_prompt
            from sphere_gen import generate_sphere_from_prompt

            update("upscale", 12, "Analyzing brand style...")
            blockade_prompt = build_blockade_prompt(brand or "brand", raw_images, source_url)
            update("upscale", 15, "Generating branded 360° environment...")

            def on_env_progress(status):
                if status == "pending":
                    update("upscale", 18, "Queued for environment generation...")
                elif status == "dispatched":
                    update("upscale", 25, "AI rendering branded environment...")
                elif status == "processing":
                    update("upscale", 35, "Rendering 360° panorama...")
                elif status == "exporting_16k":
                    update("upscale", 50, "Exporting 16K environment...")
                elif status.startswith("export_"):
                    update("upscale", 55, "Processing 16K export...")

            environment = loop.run_until_complete(
                generate_sphere_from_prompt(
                    blockade_prompt,
                    on_progress=on_env_progress,
                    generation_id=gen_id,
                )
            )
            update("upscale", 58, "16K environment ready")

            # Upscale the scraped images
            def on_upscale_progress(done, total):
                pct = 58 + int(7 * (done / total))
                update("upscale", pct, f"Enhancing image {done}/{total}...")

            update("upscale", 58, f"Enhancing {len(raw_images)} images...")
            upscaled = loop.run_until_complete(
                upscale_all_parallel(
                    raw_images,
                    on_progress=on_upscale_progress,
                    generation_id=gen_id,
                    image_kind="scraped_thumbnail",
                )
            )
            update("upscale", 65, f"Enhanced {len(upscaled)} images")

            # Composite images onto the AI environment
            update("compose", 68, "Compositing images onto environment...")
            canvas = compose_on_environment(upscaled, environment)
            update("compose", 80, "Branded sphere composed")
        else:
            # Fallback: original dark background compose
            def on_upscale_progress(done, total):
                pct = 10 + int(55 * (done / total))
                update("upscale", pct, f"Enhancing image {done}/{total}...")

            update("upscale", 12, f"Enhancing {len(raw_images)} images (GPU)...")
            upscaled = loop.run_until_complete(
                upscale_all_parallel(
                    raw_images,
                    on_progress=on_upscale_progress,
                    generation_id=gen_id,
                    image_kind="scraped_thumbnail",
                )
            )
            update("upscale", 65, f"Enhanced {len(upscaled)} images")

            update("compose", 70, "Composing sphere panorama...")
            bg_color = [17, 17, 17]
            canvas = compose_panorama(upscaled, bg_color)
            update("compose", 80, "Panorama composed")

        loop.close()

        # Step 4: Tiles
        def on_tile_progress(done, total):
            pct = 82 + int(13 * (done / total))
            update("tiles", pct, f"Generating tiles ({done}/{total})...")

        update("tiles", 82, "Generating tile pyramid...")
        generate_tiles(canvas, gen_id, on_progress=on_tile_progress)
        update("tiles", 95, "Tiles generated")

        # Step 5: Save to Supabase
        update("save", 96, "Saving to cloud...")
        duration = int(time.time() - start)

        if SUPABASE_URL:
            tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
            image_url = f"{tile_base_url}/{gen_id}.jpg"
        else:
            tile_base_url = ""
            image_url = f"/spheres/{gen_id}.jpg"

        update_generation_status(gen_id, {
            "brand": brand,
            "prompt": generations[gen_id].get("prompt", ""),
            "status": "done",
            "step": "done",
            "step_label": "Your sphere is ready",
            "image_url": image_url,
            "tile_stem": gen_id,
            "tile_base_url": tile_base_url,
            "duration_s": duration,
            "image_count": len(upscaled),
            "cost_usd": round(len(upscaled) * 0.003, 4),
        })

        # Done
        generations[gen_id].update({
            "status": "done",
            "step": "done",
            "pct": 100,
            "label": "Your sphere is ready",
            "image_url": image_url,
            "tile_stem": gen_id,
            "tile_base_url": tile_base_url,
            "duration_s": duration,
            "image_count": len(upscaled),
        })
        print(f"Pipeline complete: {gen_id} in {duration}s")

    except Exception as e:
        print(f"Pipeline error: {e}")
        import traceback
        traceback.print_exc()
        generations[gen_id].update({"status": "failed", "error": str(e)})
        update_generation_status(gen_id, {"status": "failed", "error": str(e)})


def extract_brand_from_prompt(prompt: str) -> tuple[str, str]:
    """Try to extract a brand/person name and potential URL from a natural language prompt.

    Returns (brand_slug, source_url) — either or both may be empty.
    """
    import re
    prompt_lower = prompt.lower()

    # Check for URLs in the prompt
    url_match = re.search(r'https?://[^\s]+', prompt)
    if url_match:
        return "", url_match.group(0)

    # Check for @handle
    handle_match = re.search(r'@(\w+)', prompt)
    if handle_match:
        return handle_match.group(1).lower(), ""

    # Common patterns: "based on X's socials", "inspired by X", "from X", "for X"
    patterns = [
        r"(?:based on|inspired by|from|for|of|showcase for|sphere for|about)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*?)(?:'s|\s+socials|\s+social|\s+brand|\s+style|\s+aesthetic|\s+content|\s+page|\s+profile|\s+website|\s+site|$|\s*[,.])",
        r"(?:based on|inspired by|from|for|of)\s+(\w+(?:\s+\w+)?)\s*$",
    ]

    for pattern in patterns:
        match = re.search(pattern, prompt, re.IGNORECASE)
        if match:
            name = match.group(1).strip().rstrip("'s").strip()
            if len(name) > 2 and name.lower() not in ("a", "an", "the", "my", "our", "your", "this", "that"):
                # Convert name to slug for URL guessing
                slug = name.lower().replace(" ", "")
                return slug, ""

    return "", ""


@app.post("/generate-about-me")
async def generate_about_me(body: dict):
    """Generate an interactive About Me sphere for an influencer."""
    name = body.get("name", "").strip()
    prompt = body.get("prompt", "")
    high_res = bool(body.get("high_res", False))

    if not name:
        return JSONResponse({"error": "name is required"}, status_code=400)

    if not BLOCKADE_API_KEY:
        return JSONResponse({"error": "AI sphere generation not configured"}, status_code=503)

    gen_id = f"gen-biosphere-{uuid.uuid4().hex[:8]}"
    generations[gen_id] = {
        "id": gen_id,
        "brand": name.lower().replace(" ", ""),
        "prompt": prompt or f"About Me sphere for {name}",
        "status": "running",
        "step": "init",
        "pct": 0,
        "label": "Starting...",
    }

    def run_about_me_pipeline(gen_id, name):
        start = time.time()
        def update(step, pct, label):
            generations[gen_id].update({"step": step, "pct": pct, "label": label})

        try:
            from profile_scraper import scrape_influencer_profile, build_about_me_prompt, build_markers
            from sphere_gen import generate_sphere_from_prompt

            # Step 1: Scrape profile
            update("scrape", 3, f"Discovering {name}'s digital presence...")
            loop = asyncio.new_event_loop()
            profile = loop.run_until_complete(scrape_influencer_profile(name))
            update("scrape", 10, f"Found {len(profile.youtube.videos) if profile.youtube else 0} videos")

            if not profile.youtube and not profile.twitter:
                # No profile data found — still generate a sphere from the prompt
                print(f"  No profile data for {name}, generating generic AI environment")
                update("scrape", 10, "No profile found, generating AI environment...")
                profile.bio = f"Content creator"
                profile.name = name

            # Step 2: Generate branded environment
            blockade_prompt = build_about_me_prompt(profile)
            update("upscale", 15, f"Generating {name}'s personalized environment...")

            def on_env_progress(status):
                if status == "pending":
                    update("upscale", 18, "Queued for environment generation...")
                elif status == "dispatched":
                    update("upscale", 22, "AI rendering personalized studio...")
                elif status == "processing":
                    update("upscale", 35, "Rendering 360° environment...")
                elif status == "exporting_16k":
                    update("upscale", 48, "Exporting 16K environment...")
                elif status.startswith("export_"):
                    update("compose", 52, "Processing 16K export...")

            environment = loop.run_until_complete(
                generate_sphere_from_prompt(
                    blockade_prompt,
                    on_progress=on_env_progress,
                    generation_id=gen_id,
                )
            )
            update("compose", 55, "Environment ready, analyzing scene...")

            # Analyze the scene to find TV screens and picture frames
            from scene_analyzer import detect_scene_elements, assign_content_to_positions
            env_jpg = environment.resize(4096 / environment.width, kernel=pyvips.enums.Kernel.LANCZOS3, vscale=2048 / environment.height).write_to_buffer(".jpg[Q=80]")
            scene_elements = loop.run_until_complete(detect_scene_elements(env_jpg, generation_id=gen_id))
            update("compose", 62, f"Found {len(scene_elements)} display surfaces")

            # All content displayed via interactive markers — no compositing.
            # Everything is moveable in edit mode.
            canvas = environment

            loop.close()
            update("compose", 70, "Sphere composed")

            # Step 4: Tiles
            def on_tile_progress(done, total):
                pct = 72 + int(23 * (done / total))
                update("tiles", pct, f"Generating tiles ({done}/{total})...")

            update("tiles", 72, "Generating tile pyramid...")
            generate_tiles(canvas, gen_id, on_progress=on_tile_progress, high_res=high_res)
            update("tiles", 95, "Tiles generated")

            # Step 5: Build markers — use detected scene positions if available
            if scene_elements:
                # Build video data list
                video_data = []
                if profile.youtube:
                    for v in profile.youtube.videos[:6]:
                        video_data.append({
                            "video_id": v.id,
                            "title": v.title,
                            "thumbnail_url": v.thumbnail_url,
                            "view_count": v.view_count,
                            "url": v.url,
                        })
                # Build image URLs — Instagram posts + YouTube thumbnails
                ig_images = profile.instagram.post_images[:4] if profile.instagram else []
                # Add YouTube thumbnails as images too
                if profile.youtube:
                    for v in profile.youtube.videos[:6]:
                        ig_images.append(v.thumbnail_url)
                # Build profile data
                profile_data = {
                    "name": profile.name,
                    "handle": profile.handle,
                    "bio": (profile.bio or "")[:200],
                    "profile_image": profile.profile_image_url,
                    "subscriber_count": profile.youtube.subscriber_count if profile.youtube else "",
                    "twitter_handle": profile.twitter.handle if profile.twitter else "",
                    "instagram_handle": profile.instagram.handle if profile.instagram else "",
                    "instagram_followers": profile.instagram.follower_count if profile.instagram else 0,
                    "tiktok_handle": profile.tiktok.handle if profile.tiktok else "",
                    "tiktok_followers": profile.tiktok.follower_count if profile.tiktok else "",
                    "channel_url": profile.youtube.channel_url if profile.youtube else "",
                }
                markers = assign_content_to_positions(scene_elements, video_data, ig_images, profile_data)
                print(f"  Markers from scene analysis: {len(markers)}")
            else:
                # Fallback to hardcoded positions
                markers = build_markers(profile)

            # Step 6: Save
            update("save", 96, "Saving to cloud...")
            duration = int(time.time() - start)

            if SUPABASE_URL:
                tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
                image_url = f"{tile_base_url}/{gen_id}.jpg"
            else:
                tile_base_url = ""
                image_url = f"/spheres/{gen_id}.jpg"

            # Save with markers and profile data
            import json as json_mod
            update_generation_status(gen_id, {
                "brand": name.lower().replace(" ", ""),
                "prompt": generations[gen_id].get("prompt", ""),
                "status": "done",
                "step": "done",
                "step_label": "Your sphere is ready",
                "image_url": image_url,
                "tile_stem": gen_id,
                "tile_base_url": tile_base_url,
                "duration_s": duration,
                "image_count": len(profile.thumbnail_images),
                "cost_usd": 0.25,
            })

            # Save markers separately via direct Supabase update
            if SUPABASE_URL and SUPABASE_SERVICE_KEY:
                import requests
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/generations?id=eq.{gen_id}",
                    headers={
                        "apikey": SUPABASE_SERVICE_KEY,
                        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    json={"environment": json_mod.dumps({"markers": markers, "profile": {
                        "name": profile.name,
                        "handle": profile.handle,
                        "bio": profile.bio,
                        "profile_image": profile.profile_image_url,
                    }})},
                )

            generations[gen_id].update({
                "status": "done",
                "step": "done",
                "pct": 100,
                "label": "Your sphere is ready",
                "image_url": image_url,
                "tile_stem": gen_id,
                "tile_base_url": tile_base_url,
                "duration_s": duration,
                "image_count": len(profile.thumbnail_images),
                "markers": markers,
            })
            print(f"About Me pipeline complete: {gen_id} for {name} in {duration}s")

        except Exception as e:
            print(f"About Me pipeline error: {e}")
            import traceback
            traceback.print_exc()
            generations[gen_id].update({"status": "failed", "error": str(e)})
            update_generation_status(gen_id, {"status": "failed", "error": str(e)})

    # Save running state to Supabase immediately so it survives restarts
    save_generation_record(gen_id, {
        "prompt": prompt or f"About Me sphere for {name}",
        "status": "running",
        "step": "init",
        "step_label": "Starting...",
    })
    executor.submit(run_about_me_pipeline, gen_id, name)
    return {"id": gen_id}


@app.post("/generate")
async def generate(body: dict):
    """Start sphere generation from a brand handle, URL, or natural language prompt."""
    brand = body.get("brand", "").strip().lower().replace("@", "")
    prompt = body.get("prompt", "")
    source_url = body.get("url", "").strip()
    high_res = bool(body.get("high_res", False))

    # Detect "about me" intent — route to about-me pipeline
    prompt_lower = prompt.lower()
    if any(phrase in prompt_lower for phrase in ["about me", "bio sphere", "bio for", "create bio", "create a bio", "influencer showcase", "creator showcase", "link in bio", "personal sphere"]):
        # Extract the person's name — look for "for [Name]" or "based on [Name]"
        import re as re_mod
        name_match = re_mod.search(
            r'(?:for|about|of|based on|featuring)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)',
            prompt,
            re_mod.IGNORECASE,
        )
        about_me_name = name_match.group(1).strip() if name_match else brand
        # Filter out noise words
        noise = {"a", "an", "the", "my", "our", "your", "this", "that", "new", "sphere"}
        if about_me_name and about_me_name.lower() not in noise:
            return await generate_about_me({"name": about_me_name, "prompt": prompt, "high_res": high_res})

    # If no explicit brand or URL, try to extract from the prompt
    if not brand and not source_url and prompt:
        extracted_brand, extracted_url = extract_brand_from_prompt(prompt)
        if extracted_brand:
            brand = extracted_brand
            print(f"  Extracted brand from prompt: '{brand}'")
        elif extracted_url:
            source_url = extracted_url
            print(f"  Extracted URL from prompt: '{source_url}'")

    # If still nothing to scrape, use pure AI generation
    if not brand and not source_url:
        if not prompt:
            return JSONResponse({"error": "brand, url, or prompt is required"}, status_code=400)
        return await generate_from_prompt({"prompt": prompt})

    slug = brand or "custom"
    gen_id = f"gen-{slug}-{uuid.uuid4().hex[:8]}"
    generations[gen_id] = {
        "id": gen_id,
        "brand": brand,
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "pct": 0,
        "label": "Starting...",
    }

    save_generation_record(gen_id, {
        "brand": brand,
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "step_label": "Starting...",
    })
    executor.submit(run_pipeline, gen_id, brand, source_url)
    return {"id": gen_id}


@app.post("/generate-from-prompt")
async def generate_from_prompt(body: dict):
    """Generate a sphere from a text prompt using AI image generation."""
    prompt = body.get("prompt", "")

    if not prompt:
        return JSONResponse({"error": "prompt is required"}, status_code=400)

    if not BLOCKADE_API_KEY:
        return JSONResponse({"error": "AI sphere generation not configured"}, status_code=503)

    gen_id = f"gen-ai-{uuid.uuid4().hex[:8]}"
    generations[gen_id] = {
        "id": gen_id,
        "brand": "",
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "pct": 0,
        "label": "Starting AI generation...",
    }

    def run_prompt_pipeline(gen_id, prompt):
        start = time.time()
        def update(step, pct, label):
            generations[gen_id].update({"step": step, "pct": pct, "label": label})

        try:
            from sphere_gen import generate_sphere_from_prompt

            update("scrape", 5, "Generating 360° environment from prompt...")

            def on_skybox_progress(status):
                if status == "pending":
                    update("scrape", 10, "Queued for generation...")
                elif status == "dispatched":
                    update("scrape", 20, "AI rendering 360° panorama...")
                elif status == "processing":
                    update("upscale", 40, "Rendering 8K panorama...")
                elif status == "exporting_16k":
                    update("upscale", 55, "Exporting native 16K resolution...")
                elif status.startswith("export_"):
                    update("compose", 60, "Processing 16K export...")

            loop = asyncio.new_event_loop()
            canvas = loop.run_until_complete(
                generate_sphere_from_prompt(
                    prompt,
                    on_progress=on_skybox_progress,
                    generation_id=gen_id,
                )
            )
            loop.close()
            update("compose", 70, "16K panorama ready")

            # Tiles
            def on_tile_progress(done, total):
                pct = 72 + int(23 * (done / total))
                update("tiles", pct, f"Generating tiles ({done}/{total})...")

            update("tiles", 72, "Generating tile pyramid...")
            generate_tiles(canvas, gen_id, on_progress=on_tile_progress)
            update("tiles", 95, "Tiles generated")

            # Save
            update("save", 96, "Saving to cloud...")
            duration = int(time.time() - start)

            if SUPABASE_URL:
                tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
                image_url = f"{tile_base_url}/{gen_id}.jpg"
            else:
                tile_base_url = ""
                image_url = f"/spheres/{gen_id}.jpg"

            update_generation_status(gen_id, {
                "brand": "",
                "prompt": prompt,
                "status": "done",
                "step": "done",
                "step_label": "Your sphere is ready",
                "image_url": image_url,
                "tile_stem": gen_id,
                "tile_base_url": tile_base_url,
                "duration_s": duration,
                "image_count": 1,
                "cost_usd": 0.20,
            })

            generations[gen_id].update({
                "status": "done",
                "step": "done",
                "pct": 100,
                "label": "Your sphere is ready",
                "image_url": image_url,
                "tile_stem": gen_id,
                "tile_base_url": tile_base_url,
                "duration_s": duration,
                "image_count": 1,
            })
            print(f"Prompt pipeline complete: {gen_id} in {duration}s")

        except Exception as e:
            print(f"Prompt pipeline error: {e}")
            import traceback
            traceback.print_exc()
            generations[gen_id].update({"status": "failed", "error": str(e)})
            update_generation_status(gen_id, {"status": "failed", "error": str(e)})

    save_generation_record(gen_id, {
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "step_label": "Starting...",
    })
    executor.submit(run_prompt_pipeline, gen_id, prompt)
    return {"id": gen_id}


@app.post("/reroll-background")
async def reroll_background(body: dict):
    """Regenerate just the background for an existing generation.

    Markers, scene analysis, and all other generation state are preserved —
    only the Skybox background (and its tile pyramid) is replaced.

    Uses a versioned tile_stem so old tiles remain accessible during the swap
    and are only updated atomically once all new uploads complete.

    Body:
        generation_id: str — existing gen id to reroll
        prompt: str        — new Skybox prompt
        style_id: int?     — Blockade Labs style id (default 119 = M3 Photoreal)
        negative_text: str? — override negative prompt
        high_res: bool?    — if true, emit 16K tile tier (slower, sharper on extreme zoom)
        model: str?        — "blockade" (default, ~3 min, best quality + correct
                              poles) or "openai" (~30s, cheaper, interiors only —
                              outdoor scenes regress at the poles).

    Returns { "job_id": "<generation_id>" } — poll /generate/<id> for progress,
    same as /generate-from-prompt.
    """
    gen_id = body.get("generation_id", "").strip()
    prompt = body.get("prompt", "").strip()
    style_id = body.get("style_id")
    negative_text = body.get("negative_text")
    high_res = bool(body.get("high_res", False))
    model = body.get("model", "blockade").strip().lower()
    if model not in ("blockade", "openai"):
        return JSONResponse({"error": f"unknown model: {model}"}, status_code=400)
    # OpenAI path produces a ~14K upscaled image — always tile to the 16K tier
    # so the viewer can serve that resolution. Otherwise the 14K source gets
    # downsampled into the 8K cap and looks soft on /g/<id> compared to the
    # raw equirect (which is why /test-sphere always looked sharper).
    if model == "openai":
        high_res = True

    if not gen_id:
        return JSONResponse({"error": "generation_id required"}, status_code=400)
    if not prompt:
        return JSONResponse({"error": "prompt required"}, status_code=400)

    # Versioned stem → old tiles stay in storage during swap and as rollback point.
    new_stem = f"{gen_id}-rr{int(time.time())}"

    generations[gen_id] = generations.get(gen_id, {"id": gen_id})
    generations[gen_id].update({
        "status": "running",
        "step": "scrape",
        "pct": 2,
        "label": "Queuing background reroll...",
    })

    def run_reroll(gen_id: str, prompt: str, new_stem: str):
        start = time.time()

        def update(step: str, pct: int, label: str):
            generations[gen_id].update({"step": step, "pct": pct, "label": label})
            update_generation_status(gen_id, {"step": step, "step_label": label})

        try:
            update("scrape", 5, "Preparing reroll...")

            # Progress translations for both gen paths so the modal's polling
            # surface stays the same regardless of model.
            def on_skybox_progress(status):
                # Blockade statuses
                if status == "pending":
                    update("scrape", 10, "Queued for generation...")
                elif status == "dispatched":
                    update("scrape", 20, "AI rendering new background...")
                elif status == "processing":
                    update("upscale", 40, "Rendering 8K panorama...")
                elif status == "exporting_16k":
                    update("upscale", 55, "Exporting native 16K...")
                elif status.startswith("export_"):
                    update("compose", 60, "Processing 16K export...")
                # OpenAI path statuses
                elif status == "rewriting_prompt":
                    update("scrape", 10, "Rewriting prompt for optimal output...")
                elif status == "openai_generating":
                    update("scrape", 20, "Generating with gpt-image-2...")
                elif status == "openai_done":
                    update("scrape", 45, "Base image ready, upscaling...")
                elif status == "upscaling":
                    update("upscale", 50, "Upscaling 4x via fal ESRGAN...")
                elif status == "upscale_done":
                    update("compose", 65, "Upscale complete")

            loop = asyncio.new_event_loop()
            if model == "openai":
                from openai_sphere_gen import generate_sphere_from_prompt_openai
                canvas = loop.run_until_complete(
                    generate_sphere_from_prompt_openai(
                        prompt,
                        on_progress=on_skybox_progress,
                        generation_id=gen_id,
                        feature="bg_reroll",
                    )
                )
            else:
                from sphere_gen import generate_sphere_from_prompt
                canvas = loop.run_until_complete(
                    generate_sphere_from_prompt(
                        prompt,
                        on_progress=on_skybox_progress,
                        generation_id=gen_id,
                        feature="bg_reroll",
                        style_id=style_id,
                        negative_text=negative_text,
                    )
                )
            loop.close()
            update("compose", 70, "Panorama ready")

            # Tile pyramid to a NEW versioned stem — old tiles untouched.
            def on_tile_progress(done, total):
                pct = 72 + int(23 * (done / total))
                update("tiles", pct, f"Generating tiles ({done}/{total})...")

            update("tiles", 72, "Generating tile pyramid...")
            generate_tiles(canvas, new_stem, on_progress=on_tile_progress, high_res=high_res)
            update("tiles", 95, "Tiles generated")

            # Atomic swap: single PATCH updates tile_stem + image_url together.
            update("save", 96, "Swapping in new background...")
            if SUPABASE_URL:
                tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
                image_url = f"{tile_base_url}/{new_stem}.jpg"
            else:
                tile_base_url = ""
                image_url = f"/spheres/{new_stem}.jpg"

            duration = int(time.time() - start)

            update_generation_status(gen_id, {
                "status": "done",
                "step": "done",
                "step_label": "Background rerolled",
                "image_url": image_url,
                "tile_stem": new_stem,
                "tile_base_url": tile_base_url,
                "background_prompt": prompt,
                "high_res": high_res,
                "reroll_count": (generations[gen_id].get("reroll_count", 0) + 1),
                "last_rerolled_at": datetime.now(timezone.utc).isoformat(),
                "duration_s": duration,
            })

            generations[gen_id].update({
                "status": "done",
                "step": "done",
                "pct": 100,
                "label": "Background rerolled",
                "image_url": image_url,
                "tile_stem": new_stem,
                "tile_base_url": tile_base_url,
            })
            print(f"Reroll complete: {gen_id} → {new_stem} in {duration}s")

        except Exception as e:
            print(f"Reroll error: {e}")
            import traceback
            traceback.print_exc()
            generations[gen_id].update({"status": "failed", "error": str(e)})
            update_generation_status(gen_id, {
                "status": "failed",
                "step_label": "Reroll failed",
                "error": str(e),
            })

    executor.submit(run_reroll, gen_id, prompt, new_stem)
    return {"job_id": gen_id, "new_stem": new_stem}


@app.post("/upload-as-markers")
async def upload_as_markers(body: dict):
    """Composite upload, done the right way.

    Takes base64-encoded user images, upscales each via fal.ai ESRGAN, uploads
    the upscaled copies to Supabase storage at `uploads/{gen_id}/`, and
    returns a set of `image` markers harmony-packed against the existing
    marker set. The caller persists the combined marker list via
    onMarkersChanged — no new generation is created, the sphere's `gen_id`
    stays the same so analytics / copilot / category exclusion all keep
    working against the same row.

    Body:
      generation_id: str        — existing sphere id (markers get attached here)
      images: list[str]         — data URIs or raw base64 of user uploads
      current_markers: list[{id, type, yaw, pitch, scene_width?}]
      view_yaw: float?          — centre the new markers around this yaw (defaults 0)
      view_pitch: float?        — defaults 0
      strictness: float?        — 0..1, anchor-pull strength during repack

    Returns:
      {
        new_markers: [{id, type, yaw, pitch, data: {url, title}}],
        repacked_existing: [{id, yaw, pitch}]  — updated positions for existing markers
      }
    """
    gen_id = body.get("generation_id", "").strip()
    images_b64: list[str] = body.get("images") or []
    current_markers = body.get("current_markers") or []
    view_yaw = float(body.get("view_yaw", 0))
    view_pitch = float(body.get("view_pitch", 0))
    strictness = float(body.get("strictness", 0.55))

    if not gen_id:
        return JSONResponse({"error": "generation_id required"}, status_code=400)
    if not images_b64:
        return JSONResponse({"error": "images required"}, status_code=400)

    # Decode base64 images (accept data URIs or raw).
    def strip_prefix(s: str) -> str:
        if s.startswith("data:") and "," in s:
            return s.split(",", 1)[1]
        return s

    try:
        raw_bytes = [base64.b64decode(strip_prefix(s)) for s in images_b64]
    except Exception as e:
        return JSONResponse({"error": f"decode failed: {e}"}, status_code=400)

    # Upscale via fal.ai ESRGAN (cost-logged under feature=upload_markers).
    loop = asyncio.new_event_loop()
    try:
        upscaled = loop.run_until_complete(
            upscale_all_parallel(
                raw_bytes,
                generation_id=gen_id,
                feature="upload_markers",
                image_kind="user_upload",
            )
        )
    finally:
        loop.close()

    # Upload each upscaled image under uploads/{gen_id}/ for permanence.
    new_marker_records = []
    n = len(upscaled)
    spacing_deg = 25.0 if n > 1 else 0
    for i, img_bytes in enumerate(upscaled):
        image_id = uuid.uuid4().hex[:10]
        path = f"uploads/{gen_id}/{image_id}.jpg"
        upload_to_supabase(path, img_bytes)
        url = (
            f"{SUPABASE_URL}/storage/v1/object/public/spheres/{path}"
            if SUPABASE_URL
            else f"/spheres/{path}"
        )
        # Initial placement — spread along an arc centred on the user's view.
        offset = (i - (n - 1) / 2.0) * spacing_deg
        init_yaw = view_yaw + offset
        while init_yaw > 180:
            init_yaw -= 360
        while init_yaw <= -180:
            init_yaw += 360
        new_marker_records.append({
            "id": f"image-upload-{image_id}",
            "type": "image",
            "yaw": init_yaw,
            "pitch": view_pitch,
            "scene_width": 300,
            "url": url,
        })

    # Harmony-pack: combine existing + new, let the packer resolve collisions.
    def default_width(t: str) -> float:
        return {"profile": 320, "video": 360, "image": 160, "audio": 280, "bio-links": 300}.get(t, 300)

    packer_input = [
        {
            "id": str(m.get("id", "")),
            "type": str(m.get("type", "")),
            "yaw": float(m.get("yaw", 0)),
            "pitch": float(m.get("pitch", 0)),
            "scene_width": float(m.get("scene_width") or default_width(str(m.get("type", "")))),
        }
        for m in current_markers
    ] + [
        {
            "id": m["id"],
            "type": m["type"],
            "yaw": m["yaw"],
            "pitch": m["pitch"],
            "scene_width": m["scene_width"],
        }
        for m in new_marker_records
    ]

    from scene_analyzer import _pack_harmonically
    _pack_harmonically(packer_input, strictness=strictness)
    pos_by_id = {p["id"]: p for p in packer_input}

    return {
        "new_markers": [
            {
                "id": m["id"],
                "type": "image",
                "yaw": pos_by_id[m["id"]]["yaw"],
                "pitch": pos_by_id[m["id"]]["pitch"],
                "data": {"url": m["url"], "title": ""},
            }
            for m in new_marker_records
        ],
        "repacked_existing": [
            {
                "id": str(m.get("id", "")),
                "yaw": pos_by_id[str(m.get("id", ""))]["yaw"],
                "pitch": pos_by_id[str(m.get("id", ""))]["pitch"],
            }
            for m in current_markers
            if str(m.get("id", "")) in pos_by_id
        ],
    }


@app.post("/repack-markers")
async def repack_markers(body: dict):
    """Category exclusion + harmony repack (patent US '666).

    Takes a set of markers, removes ones matching the excluded categories,
    then re-runs the harmony packer on what's left so the remaining markers
    spread into the freed space with anchor-pull + collision resolution.

    Body:
      markers: list of { id, type, yaw, pitch, scene_width?, platform?, tags? }
      excluded_types: list[str] — e.g. ["audio", "bio-links"]
      excluded_platforms: list[str] — e.g. ["vimeo"] (applies to type=video)
      excluded_tags: list[str] — e.g. ["sponsored"] (matches against marker.tags)
      strictness: float 0..1, defaults 0.55

    Returns:
      { kept: [{ id, yaw, pitch }...], removed_ids: [...] }
    """
    markers_in = body.get("markers") or []
    excluded_types = set(body.get("excluded_types") or [])
    excluded_platforms = set(body.get("excluded_platforms") or [])
    excluded_tags = set(body.get("excluded_tags") or [])
    strictness = float(body.get("strictness", 0.55))

    if not isinstance(markers_in, list):
        return JSONResponse({"error": "markers must be an array"}, status_code=400)

    # Split into kept vs removed based on the exclusion rules.
    kept: list[dict] = []
    removed_ids: list[str] = []
    for m in markers_in:
        mtype = str(m.get("type", ""))
        mplatform = str(m.get("platform", ""))
        mtags = m.get("tags") or []
        if mtype in excluded_types:
            removed_ids.append(str(m.get("id", "")))
            continue
        if mtype == "video" and mplatform in excluded_platforms:
            removed_ids.append(str(m.get("id", "")))
            continue
        if isinstance(mtags, list) and any(t in excluded_tags for t in mtags):
            removed_ids.append(str(m.get("id", "")))
            continue
        kept.append({
            "id": str(m.get("id", "")),
            "type": mtype,
            "yaw": float(m.get("yaw", 0)),
            "pitch": float(m.get("pitch", 0)),
            "scene_width": float(m.get("scene_width", 300)),
        })

    # Re-pack the kept set. `_pack_harmonically` mutates in place.
    if kept:
        from scene_analyzer import _pack_harmonically
        _pack_harmonically(kept, strictness=strictness)

    return {
        "kept": [{"id": m["id"], "yaw": m["yaw"], "pitch": m["pitch"]} for m in kept],
        "removed_ids": removed_ids,
        "strictness": strictness,
    }


@app.post("/reroll-variants")
async def reroll_variants(body: dict):
    """Generate N 8K skybox previews for the user to pick from.

    No 16K export, no tile pyramid — those only happen when the user commits
    a variant via /reroll-variants/{job_id}/commit. Each 8K call is one
    Blockade Labs skybox_generate charge (~$0.30).

    Body:
      generation_id: str   — existing gen to reroll
      prompt: str          — shared prompt across all variants
      style_id: int?       — defaults to 119 (M3 Photoreal)
      negative_text: str?  — override default negative
      count: int?          — 1..4, defaults to 4
      high_res: bool?      — used when committing (stored for later)

    Returns { "job_id": str } — poll GET /reroll-variants/{job_id}.
    """
    gen_id = body.get("generation_id", "").strip()
    prompt = body.get("prompt", "").strip()
    if not gen_id or not prompt:
        return JSONResponse({"error": "generation_id and prompt required"}, status_code=400)

    style_id = body.get("style_id")
    negative_text = body.get("negative_text")
    high_res = bool(body.get("high_res", False))
    count = max(1, min(4, int(body.get("count", 4))))
    job_id = f"vr-{uuid.uuid4().hex[:8]}"

    variants_cache[job_id] = {
        "job_id": job_id,
        "gen_id": gen_id,
        "prompt": prompt,
        "style_id": style_id,
        "negative_text": negative_text,
        "high_res": high_res,
        "status": "running",
        "committed_variant_id": None,
        "variants": [
            {"id": f"v{i}", "status": "pending", "obfuscated_id": None, "preview_url": None}
            for i in range(count)
        ],
    }

    def run_variants():
        from sphere_gen import generate_skybox_8k

        async def one(variant_idx: int):
            try:
                result = await generate_skybox_8k(
                    prompt,
                    style_id=style_id,
                    generation_id=gen_id,
                    feature="variants_preview",
                    negative_text=negative_text,
                )
                variants_cache[job_id]["variants"][variant_idx].update({
                    "status": "ready",
                    "obfuscated_id": result["obfuscated_id"],
                    "preview_url": result["file_url"],
                })
            except Exception as exc:
                variants_cache[job_id]["variants"][variant_idx].update({
                    "status": "failed",
                    "error": str(exc),
                })

        async def run_all():
            await asyncio.gather(*(one(i) for i in range(count)))

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(run_all())
        finally:
            loop.close()
        # Mark the job done only once every variant has a terminal state.
        ready = sum(1 for v in variants_cache[job_id]["variants"] if v["status"] == "ready")
        variants_cache[job_id]["status"] = "done" if ready > 0 else "failed"

    executor.submit(run_variants)
    return {"job_id": job_id}


@app.get("/reroll-variants/{job_id}")
async def get_reroll_variants(job_id: str):
    """Return current state of a variant job (for polling)."""
    job = variants_cache.get(job_id)
    if not job:
        return JSONResponse({"error": "not found"}, status_code=404)
    return job


@app.post("/reroll-variants/{job_id}/commit")
async def commit_reroll_variant(job_id: str, body: dict):
    """User picked a variant — do the 16K export + tile pyramid swap."""
    variant_id = body.get("variant_id", "")
    job = variants_cache.get(job_id)
    if not job:
        return JSONResponse({"error": "job not found"}, status_code=404)
    if job.get("committed_variant_id"):
        return JSONResponse({"error": "already committed"}, status_code=409)

    variant = next((v for v in job["variants"] if v["id"] == variant_id), None)
    if not variant or variant["status"] != "ready":
        return JSONResponse({"error": "variant not ready"}, status_code=400)

    gen_id = job["gen_id"]
    new_stem = f"{gen_id}-rr{int(time.time())}"
    obfuscated_id = variant["obfuscated_id"]
    prompt = job["prompt"]
    style_id = job["style_id"]
    high_res = job["high_res"]

    job["committed_variant_id"] = variant_id
    job["commit_status"] = "running"

    generations[gen_id] = generations.get(gen_id, {"id": gen_id})
    generations[gen_id].update({
        "status": "running",
        "step": "upscale",
        "pct": 55,
        "label": "Exporting chosen variant at 16K...",
    })

    def run_commit():
        from sphere_gen import export_skybox_16k
        start = time.time()

        def update(step: str, pct: int, label: str):
            generations[gen_id].update({"step": step, "pct": pct, "label": label})
            update_generation_status(gen_id, {"step": step, "step_label": label})

        try:
            def on_export_progress(status):
                if "complete" not in status:
                    update("upscale", 60, "Exporting 16K...")

            loop = asyncio.new_event_loop()
            img_bytes = loop.run_until_complete(
                export_skybox_16k(
                    obfuscated_id,
                    generation_id=gen_id,
                    feature="bg_reroll",
                    prompt=prompt,
                    style_id=style_id,
                    on_progress=on_export_progress,
                )
            )
            loop.close()
            update("compose", 68, "Building 16K canvas...")

            img = pyvips.Image.new_from_buffer(img_bytes, "")
            if img.bands == 4:
                img = img[:3]
            if img.width != 16384 or img.height != 8192:
                canvas = img.resize(
                    16384 / img.width,
                    kernel=pyvips.enums.Kernel.LANCZOS3,
                    vscale=8192 / img.height,
                )
            else:
                canvas = img
            update("compose", 72, "16K canvas ready")

            def on_tile_progress(done, total):
                pct = 72 + int(23 * (done / total))
                update("tiles", pct, f"Generating tiles ({done}/{total})...")

            generate_tiles(canvas, new_stem, on_progress=on_tile_progress, high_res=high_res)
            update("save", 96, "Swapping in new background...")

            if SUPABASE_URL:
                tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
                image_url = f"{tile_base_url}/{new_stem}.jpg"
            else:
                tile_base_url = ""
                image_url = f"/spheres/{new_stem}.jpg"

            duration = int(time.time() - start)
            update_generation_status(gen_id, {
                "status": "done",
                "step": "done",
                "step_label": "Background rerolled",
                "image_url": image_url,
                "tile_stem": new_stem,
                "tile_base_url": tile_base_url,
                "background_prompt": prompt,
                "high_res": high_res,
                "reroll_count": (generations[gen_id].get("reroll_count", 0) + 1),
                "last_rerolled_at": datetime.now(timezone.utc).isoformat(),
                "duration_s": duration,
            })
            generations[gen_id].update({
                "status": "done",
                "step": "done",
                "pct": 100,
                "label": "Background rerolled",
                "image_url": image_url,
                "tile_stem": new_stem,
                "tile_base_url": tile_base_url,
            })
            job["commit_status"] = "done"
            job["new_stem"] = new_stem
            print(f"Reroll (variant {variant_id}) complete: {gen_id} → {new_stem} in {duration}s")

        except Exception as exc:
            print(f"Variant commit error: {exc}")
            import traceback
            traceback.print_exc()
            job["commit_status"] = "failed"
            job["commit_error"] = str(exc)
            generations[gen_id].update({"status": "failed", "error": str(exc)})
            update_generation_status(gen_id, {
                "status": "failed",
                "step_label": "Reroll commit failed",
                "error": str(exc),
            })

    executor.submit(run_commit)
    return {"ok": True, "job_id": job_id, "new_stem": new_stem}


@app.post("/generate-from-uploads")
async def generate_from_uploads(body: dict):
    """Start sphere generation from base64-encoded uploaded images.

    If composite_tile_stem and composite_tile_base_url are provided,
    composites the images onto the existing environment instead of
    generating a new sphere from scratch.
    """
    prompt = body.get("prompt", "Upload sphere")
    images_b64 = body.get("images", [])
    composite_tile_stem = body.get("composite_tile_stem", "")
    composite_tile_base_url = body.get("composite_tile_base_url", "")

    if not images_b64:
        return JSONResponse({"error": "No images provided"}, status_code=400)

    gen_id = f"gen-upload-{uuid.uuid4().hex[:8]}"
    generations[gen_id] = {
        "id": gen_id,
        "brand": "",
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "pct": 0,
        "label": "Starting...",
        "composite_tile_stem": composite_tile_stem,
        "composite_tile_base_url": composite_tile_base_url,
    }

    # Decode images
    raw_images = []
    for b64 in images_b64:
        try:
            # Strip data URI prefix if present
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            raw_images.append(base64.b64decode(b64))
        except Exception:
            continue

    def run_upload_pipeline(gen_id, raw_images):
        run_pipeline_with_images(gen_id, raw_images)

    save_generation_record(gen_id, {
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "step_label": "Starting...",
    })
    executor.submit(run_upload_pipeline, gen_id, raw_images)
    return {"id": gen_id}


@app.post("/generate-from-bg-upload")
async def generate_from_bg_upload(body: dict):
    """Accept a single equirectangular image and use it directly as the sphere
    background. No AI generation, no marker composite. Tile pyramid is sized
    to the source — high_res (4 tiers) when width >= 12288, else 3 tiers.
    """
    prompt = (body.get("prompt") or "").strip() or "Uploaded 360° background"
    img_b64 = body.get("image", "")
    brand = (body.get("brand") or "").strip() or None

    if not img_b64:
        return JSONResponse({"error": "No image provided"}, status_code=400)

    if "," in img_b64:
        img_b64 = img_b64.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(img_b64)
    except Exception as e:
        return JSONResponse({"error": f"Invalid base64: {e}"}, status_code=400)

    try:
        with Image.open(BytesIO(raw_bytes)) as probe:
            w, h = probe.size
    except Exception as e:
        return JSONResponse({"error": f"Not a valid image: {e}"}, status_code=400)

    if w < 1024:
        return JSONResponse(
            {"error": f"Image too small ({w}×{h}). Need at least 1024 px wide."},
            status_code=400,
        )

    ratio = w / h
    is_equirect = 1.8 <= ratio <= 2.2

    gen_id = f"gen-bg-upload-{uuid.uuid4().hex[:8]}"
    # high_res is best-effort — we only know source dim; Gemini path produces
    # ~6336 wide, which is below the 12288 threshold, so it'll stay 3-tier.
    high_res = is_equirect and w >= 12288

    generations[gen_id] = {
        "id": gen_id,
        "brand": brand or "",
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "pct": 0,
        "label": "Processing upload...",
        "high_res": high_res,
    }

    save_generation_record(gen_id, {
        "brand": brand,
        "prompt": prompt,
        "status": "running",
        "step": "init",
        "step_label": "Processing upload...",
        "high_res": high_res,
    })

    executor.submit(run_bg_upload_pipeline, gen_id, raw_bytes, high_res, is_equirect)
    return {"id": gen_id}


@app.post("/scrape-profile")
async def scrape_profile(body: dict):
    """Fetch public profile data for a single handle on a single platform.
    No tile generation, no sphere side-effects — just scrape + return.

    Used by the copilot's add_social_profile_marker tool so a user can say
    "my handle is @x on instagram" and the copilot drops a profile marker
    with the scraped name / bio / avatar / follower count.

    Request:  { "handle": "elagerway", "platform": "instagram" }
                platform ∈ {"instagram", "youtube", "twitter", "tiktok"}
    Response: {
        "handle": "elagerway",
        "platform": "instagram",
        "name": "...",
        "bio": "...",
        "profile_image": "https://...",
        "followers": 1234,          # platform-native count when available
        "channel_url": "",          # youtube only
        "twitter_handle": "",
        "instagram_handle": "",
        "tiktok_handle": "",
    }
    """
    handle = (body.get("handle") or "").strip().lstrip("@")
    platform = (body.get("platform") or "").strip().lower()
    if not handle:
        return JSONResponse({"error": "handle required"}, status_code=400)
    if platform not in {"instagram", "youtube", "twitter", "tiktok"}:
        return JSONResponse(
            {"error": f"platform must be one of instagram/youtube/twitter/tiktok, got '{platform}'"},
            status_code=400,
        )

    from profile_scraper import (
        scrape_instagram_profile,
        scrape_youtube_channel,
        scrape_twitter_profile,
        scrape_tiktok_profile,
    )

    try:
        if platform == "instagram":
            data = await scrape_instagram_profile(handle)
            if not data:
                return JSONResponse({"error": f"Instagram lookup failed for @{handle}"}, status_code=404)
            return {
                "handle": data.handle,
                "platform": platform,
                "name": data.name,
                "bio": data.bio,
                "profile_image": data.profile_pic_url,
                "followers": data.follower_count,
                "instagram_handle": data.handle,
                "instagram_followers": data.follower_count,
            }
        if platform == "youtube":
            data = await scrape_youtube_channel(handle)
            if not data:
                return JSONResponse({"error": f"YouTube lookup failed for @{handle}"}, status_code=404)
            return {
                "handle": data.handle or handle,
                "platform": platform,
                "name": data.channel_name,
                "bio": data.description,
                "profile_image": data.profile_pic_url,
                "followers": data.subscriber_count,
                "channel_url": data.channel_url,
            }
        if platform == "twitter":
            data = await scrape_twitter_profile(handle)
            if not data:
                return JSONResponse({"error": f"Twitter lookup failed for @{handle}"}, status_code=404)
            return {
                "handle": data.handle,
                "platform": platform,
                "name": data.name,
                "bio": data.bio,
                "profile_image": data.profile_pic_url,
                "followers": data.follower_count,
                "twitter_handle": data.handle,
            }
        # tiktok
        data = await scrape_tiktok_profile(handle)
        if not data:
            return JSONResponse({"error": f"TikTok lookup failed for @{handle}"}, status_code=404)
        return {
            "handle": data.handle,
            "platform": platform,
            "name": data.name,
            "bio": data.bio,
            "profile_image": data.profile_pic_url,
            "followers": data.follower_count,
            "tiktok_handle": data.handle,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": f"scrape failed: {e}"}, status_code=500)


@app.post("/scrape-linktree")
async def scrape_linktree(body: dict):
    """Scrape a public Linktree page and return its link list.

    Powers the bio-links marker's "Import from Linktree" affordance so users
    can paste linktr.ee/handle and have all titles + URLs pulled in at once.

    Request:  { "url": "linktr.ee/handle" | "https://linktr.ee/handle" | "handle" }
    Response: {
        "username": "handle",
        "profile_image": "https://...",
        "page_title": "Display Name",
        "links": [{ "title": "...", "url": "https://..." }, ...]   # empty/header rows filtered
    }
    """
    raw = (body.get("url") or "").strip()
    if not raw:
        return JSONResponse({"error": "url required"}, status_code=400)

    # Accept "linktr.ee/x", "https://linktr.ee/x", "@x", or bare "x"
    handle = raw
    for prefix in ("https://", "http://", "linktree.com/", "linktr.ee/", "www.linktr.ee/", "www.linktree.com/", "@"):
        if handle.startswith(prefix):
            handle = handle[len(prefix):]
    handle = handle.split("/")[0].split("?")[0].strip()
    if not handle:
        return JSONResponse({"error": "could not parse handle from url"}, status_code=400)

    import re
    import json as json_mod
    import httpx

    page_url = f"https://linktr.ee/{handle}"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            r = await client.get(
                page_url,
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
            )
        if r.status_code != 200:
            return JSONResponse({"error": f"Linktree returned HTTP {r.status_code} for @{handle}"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": f"Linktree fetch failed: {e}"}, status_code=502)

    m = re.search(r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
    if not m:
        return JSONResponse({"error": "Linktree page format unrecognised (no __NEXT_DATA__)"}, status_code=500)
    try:
        data = json_mod.loads(m.group(1))
    except Exception:
        return JSONResponse({"error": "Linktree __NEXT_DATA__ JSON parse failed"}, status_code=500)

    pp = (data.get("props") or {}).get("pageProps") or {}
    raw_links = pp.get("links") or []
    cleaned = []
    for item in raw_links:
        if not isinstance(item, dict):
            continue
        # HEADER rows (and similar dividers) have no URL — skip. Coerce defensively because
        # Linktree's schema isn't a contract: non-string values would crash .strip().
        url_raw = item.get("url")
        title_raw = item.get("title")
        url = url_raw.strip() if isinstance(url_raw, str) else ""
        title = title_raw.strip() if isinstance(title_raw, str) else ""
        if not url:
            continue
        cleaned.append({"title": title or url, "url": url})

    acc = pp.get("account") or {}
    return {
        "username": pp.get("username") or acc.get("username") or handle,
        "profile_image": acc.get("profilePictureUrl") or "",
        "page_title": pp.get("pageTitle") or acc.get("pageTitle") or "",
        "links": cleaned,
    }


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


def _gemini_outpaint_to_equirect(raw_bytes: bytes) -> bytes:
    """Send an arbitrary image to Gemini 3 Pro Image with an outpaint prompt
    to produce a 360° equirectangular panorama. Returns JPEG bytes."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set on the pipeline")

    import json
    import urllib.request
    b64 = base64.b64encode(raw_bytes).decode()
    prompt = (
        "Convert this image into a seamless 360-degree equirectangular panorama. "
        "Use the original scene as the primary forward view, then naturally extend "
        "the environment outward the full 360 degrees around the camera — complete "
        "the sides, behind the camera, the ceiling/sky above, and the ground below. "
        "Keep the style, lighting, and content consistent with the source. "
        "The left and right edges must wrap seamlessly. The image should cover a "
        "full 360x180 field of view as a true equirectangular projection."
    )
    body = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
            ],
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": "21:9", "imageSize": "4K"},
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-3-pro-image-preview:generateContent?key={GEMINI_API_KEY}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        payload = json.loads(resp.read())

    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline:
                return base64.b64decode(inline["data"])
    raise RuntimeError("Gemini returned no image")


def run_bg_upload_pipeline(gen_id: str, raw_bytes: bytes, high_res: bool, is_equirect: bool):
    start = time.time()

    def update(step: str, pct: int, label: str):
        generations[gen_id].update({"step": step, "pct": pct, "label": label})

    try:
        if not is_equirect:
            update("upscale", 15, "Extending image into a 360° environment...")
            raw_bytes = _gemini_outpaint_to_equirect(raw_bytes)
            log_gemini_imagegen(
                model="gemini-3-pro-image-preview",
                generation_id=gen_id,
                feature="background",
                operation="bg_upload_outpaint",
            )
            update("compose", 55, "360° environment ready")

        update("compose", 60, "Loading image...")
        canvas = pyvips.Image.new_from_buffer(raw_bytes, "")

        w, h = canvas.width, canvas.height
        target_h = w // 2

        if h != target_h:
            update("compose", 65, f"Normalizing to 2:1 ({w}×{target_h})...")
            canvas = canvas.resize(
                1.0,
                kernel=pyvips.enums.Kernel.LANCZOS3,
                vscale=target_h / canvas.height,
            )

        update("tiles", 70, "Generating tile pyramid...")

        def on_tile_progress(done, total):
            pct = 30 + int(60 * (done / total))
            update("tiles", pct, f"Generating tiles ({done}/{total})...")

        generate_tiles(canvas, gen_id, on_progress=on_tile_progress, high_res=high_res)
        update("tiles", 92, "Tiles generated")

        duration = int(time.time() - start)
        if SUPABASE_URL:
            tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
            image_url = f"{tile_base_url}/{gen_id}.jpg"
        else:
            tile_base_url = ""
            image_url = f"/spheres/{gen_id}.jpg"

        update_generation_status(gen_id, {
            "status": "done",
            "step": "done",
            "step_label": f"Your HD sphere is ready [{COMMIT_HASH}]",
            "image_url": image_url,
            "tile_stem": gen_id,
            "tile_base_url": tile_base_url,
            "duration_s": duration,
            "image_count": 1,
            "cost_usd": 0,
            "high_res": high_res,
        })

        generations[gen_id].update({
            "status": "done", "step": "done", "pct": 100,
            "label": "Your HD sphere is ready",
            "image_url": image_url,
            "tile_stem": gen_id,
            "tile_base_url": tile_base_url,
            "duration_s": duration,
        })
        print(f"BG upload complete: {gen_id} in {duration}s (high_res={high_res})")
    except Exception as e:
        import traceback
        traceback.print_exc()
        generations[gen_id].update({"status": "failed", "error": str(e)})
        update_generation_status(gen_id, {"status": "failed", "error": str(e)})


def run_pipeline_with_images(gen_id: str, raw_images: list[bytes]):
    """Run pipeline with pre-provided images (skip scraping)."""
    start = time.time()

    def update(step: str, pct: int, label: str):
        generations[gen_id].update({"step": step, "pct": pct, "label": label})

    try:
        update("scrape", 10, f"Processing {len(raw_images)} uploaded images")

        # Upscale
        loop = asyncio.new_event_loop()
        def on_upscale_progress(done, total):
            pct = 10 + int(55 * (done / total))
            update("upscale", pct, f"Enhancing image {done}/{total}...")

        update("upscale", 12, f"Enhancing {len(raw_images)} images (GPU)...")
        upscaled = loop.run_until_complete(
            upscale_all_parallel(
                raw_images,
                on_progress=on_upscale_progress,
                generation_id=gen_id,
                image_kind="scraped_thumbnail",
            )
        )
        loop.close()
        update("upscale", 65, f"Enhanced {len(upscaled)} images")

        # Compose — composite onto existing environment or create new
        composite_stem = generations[gen_id].get("composite_tile_stem", "")
        composite_base = generations[gen_id].get("composite_tile_base_url", "")

        if composite_stem and composite_base:
            # Download the existing environment's full image
            update("compose", 68, "Loading existing environment...")
            env_url = f"{composite_base}/{composite_stem}.jpg"
            print(f"  Downloading environment from {env_url[:60]}...")
            import requests as req
            env_resp = req.get(env_url, timeout=30)
            if env_resp.status_code == 200:
                environment = pyvips.Image.new_from_buffer(env_resp.content, "")
                if environment.bands == 4:
                    environment = environment[:3]
                # Resize to 16K if needed
                if environment.width != CANVAS_W:
                    environment = environment.resize(
                        CANVAS_W / environment.width,
                        kernel=pyvips.enums.Kernel.LANCZOS3,
                        vscale=CANVAS_H / environment.height,
                    )
                update("compose", 70, "Compositing images onto environment...")
                canvas = compose_on_environment(upscaled, environment)
            else:
                print(f"  Failed to load environment ({env_resp.status_code}), using dark bg")
                update("compose", 70, "Composing sphere panorama...")
                canvas = compose_panorama(upscaled, [17, 17, 17])
        else:
            update("compose", 70, "Composing sphere panorama...")
            canvas = compose_panorama(upscaled, [17, 17, 17])

        update("compose", 80, "Panorama composed")

        # Tiles
        def on_tile_progress(done, total):
            pct = 82 + int(13 * (done / total))
            update("tiles", pct, f"Generating tiles ({done}/{total})...")

        update("tiles", 82, "Generating tile pyramid...")
        generate_tiles(canvas, gen_id, on_progress=on_tile_progress)
        update("tiles", 95, "Tiles generated")

        # Save
        update("save", 96, "Saving to cloud...")
        duration = int(time.time() - start)

        if SUPABASE_URL:
            tile_base_url = f"{SUPABASE_URL}/storage/v1/object/public/spheres"
            image_url = f"{tile_base_url}/{gen_id}.jpg"
        else:
            tile_base_url = ""
            image_url = f"/spheres/{gen_id}.jpg"

        update_generation_status(gen_id, {
            "brand": "",
            "prompt": generations[gen_id].get("prompt", ""),
            "status": "done",
            "step": "done",
            "step_label": "Your sphere is ready",
            "image_url": image_url,
            "tile_stem": gen_id,
            "tile_base_url": tile_base_url,
            "duration_s": duration,
            "image_count": len(upscaled),
            "cost_usd": round(len(upscaled) * 0.003, 4),
        })

        generations[gen_id].update({
            "status": "done",
            "step": "done",
            "pct": 100,
            "label": "Your sphere is ready",
            "image_url": image_url,
            "tile_stem": gen_id,
            "tile_base_url": tile_base_url,
            "duration_s": duration,
            "image_count": len(upscaled),
        })
        print(f"Upload pipeline complete: {gen_id} in {duration}s")

    except Exception as e:
        print(f"Upload pipeline error: {e}")
        import traceback
        traceback.print_exc()
        generations[gen_id].update({"status": "failed", "error": str(e)})
        update_generation_status(gen_id, {"status": "failed", "error": str(e)})


@app.get("/status/{gen_id}")
async def status(gen_id: str):
    """Poll generation status."""
    if gen_id not in generations:
        return JSONResponse({"error": "not found"}, status_code=404)
    return generations[gen_id]


@app.get("/health")
async def health():
    return {"status": "ok", "fal_key_set": bool(FAL_KEY)}


@app.post("/regenerate-markers-from-analytics")
async def regenerate_markers_from_analytics(body: dict):
    """
    Patent GB '934 / WO '623: automatic generation of spheres using data-platform
    data. Reads sphere_events for the given sphere, ranks markers by total dwell,
    and rewrites the generation's environment JSON so the top-engaged markers:

      - get a bigger scene_scale (patent US '455/565/580: scale by characteristic)
      - move toward the viewer's "home" yaw (0°) — prime position

    No Blockade regeneration, no new tile pyramid — we only re-rank the existing
    markers. Cheap and practices the claim.

    Request:  { "sphere_id": "gen-biosphere-xxx", "days": 30 (optional) }
    Response: { "updated": true, "markers_touched": N, "top_ranked": [...] }
    """
    import json as json_mod

    sphere_id = (body.get("sphere_id") or "").strip()
    days = int(body.get("days", 30))
    if not sphere_id:
        return JSONResponse({"error": "sphere_id required"}, status_code=400)
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return JSONResponse({"error": "Supabase not configured"}, status_code=503)

    # 1. Read the current generation row
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/generations",
            params={"id": f"eq.{sphere_id}", "select": "environment,brand,status"},
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            },
        )
    if resp.status_code != 200 or not resp.json():
        return JSONResponse({"error": "sphere not found"}, status_code=404)
    row = resp.json()[0]
    if row.get("status") != "done":
        return JSONResponse({"error": "sphere not ready"}, status_code=409)

    env_raw = row.get("environment") or "{}"
    try:
        env = json_mod.loads(env_raw)
    except Exception:
        env = {}
    markers = list(env.get("markers") or [])
    if not markers:
        return JSONResponse({"error": "no markers to re-rank"}, status_code=400)

    # 2. Read engagement events for the sphere (last N days)
    since_iso = (
        __import__("datetime").datetime.utcnow()
        - __import__("datetime").timedelta(days=days)
    ).isoformat() + "Z"
    async with httpx.AsyncClient(timeout=15.0) as client:
        ev_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/sphere_events",
            params={
                "sphere_id": f"eq.{sphere_id}",
                "event_type": "eq.marker_dwell",
                "created_at": f"gte.{since_iso}",
                "select": "marker_id,meta",
            },
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            },
        )
    dwell_totals: dict[str, int] = {}
    for ev in ev_resp.json() if ev_resp.status_code == 200 else []:
        mid = ev.get("marker_id")
        meta = ev.get("meta") or {}
        d = meta.get("duration_ms") if isinstance(meta, dict) else None
        if mid and isinstance(d, (int, float)) and d > 0:
            dwell_totals[mid] = dwell_totals.get(mid, 0) + int(d)

    if not dwell_totals:
        return JSONResponse(
            {"error": "no engagement data for this sphere in window", "days": days},
            status_code=400,
        )

    # 3. Rank markers by dwell. Same IDs as in InteractiveSphereViewer.markerIdFor.
    def marker_id(m: dict, i: int) -> str:
        t = m.get("type")
        data = m.get("data") or {}
        if t == "profile":
            return "profile-card"
        if t == "video":
            return f"video-{data.get('video_id', '')}"
        if t == "audio":
            url_slice = (data.get("url") or "")[:24]
            from urllib.parse import quote
            return f"audio-{i}-{quote(url_slice, safe='')}"
        if t == "bio-links":
            return f"bio-links-{i}"
        return f"image-{i}"

    ranked = sorted(
        enumerate(markers),
        key=lambda pair: dwell_totals.get(marker_id(pair[1], pair[0]), 0),
        reverse=True,
    )
    # 4. Promote the top 3 most-engaged markers: bump scene_scale + nudge toward yaw 0.
    top_ranked_ids: list[str] = []
    touched = 0
    for rank, (i, m) in enumerate(ranked[:3]):
        mid = marker_id(m, i)
        if dwell_totals.get(mid, 0) <= 0:
            continue
        top_ranked_ids.append(mid)
        # scale bump based on rank (rank 0 = most engaged → 1.35x)
        m["scene_scale"] = round(1.35 - rank * 0.1, 2)
        # yaw nudge: pull ±30% of the way toward 0 each regen
        cur_yaw = float(m.get("yaw", 0))
        m["yaw"] = round(cur_yaw * 0.7, 2)
        markers[i] = m
        touched += 1

    # 5. Write back
    env["markers"] = markers
    async with httpx.AsyncClient(timeout=10.0) as client:
        up_resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/generations?id=eq.{sphere_id}",
            json={"environment": json_mod.dumps(env)},
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
    if up_resp.status_code >= 300:
        return JSONResponse(
            {"error": f"failed to update: {up_resp.status_code} {up_resp.text}"},
            status_code=500,
        )

    return {
        "updated": True,
        "markers_touched": touched,
        "top_ranked": top_ranked_ids,
        "dwell_totals": {k: v for k, v in dwell_totals.items() if k in top_ranked_ids},
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8100))
    print(f"Starting pipeline server on port {port}")
    print(f"FAL_KEY: {'set' if FAL_KEY else 'NOT SET'}")
    uvicorn.run(app, host="0.0.0.0", port=port)
