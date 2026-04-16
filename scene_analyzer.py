"""
Analyze a Blockade-generated equirectangular panorama to detect
TV screens, picture frames, and display surfaces using Claude Vision.

Converts detected pixel positions to yaw/pitch coordinates for
placing interactive markers exactly on the scene elements.
"""

import asyncio
import base64
import json
import os
from io import BytesIO

import httpx
import pyvips
from PIL import Image

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


def panorama_to_yaw_pitch(x: float, y: float, width: int, height: int) -> dict:
    """Convert equirectangular pixel coordinates to yaw/pitch degrees."""
    yaw = (x / width - 0.5) * 360
    pitch = (0.5 - y / height) * 180
    return {"yaw": round(yaw, 1), "pitch": round(pitch, 1)}


def estimate_marker_width(obj_width: float, img_width: int) -> int:
    """Estimate a reasonable marker pixel width based on the object's size in the panorama."""
    # Object width as fraction of panorama → approximate screen size
    fraction = obj_width / img_width
    # Scale: a TV taking up ~15% of panorama width ≈ 640px marker
    return max(280, min(700, int(fraction * 4200)))


async def detect_scene_elements(panorama_bytes: bytes) -> list[dict]:
    """Use Claude Vision to detect TVs, screens, and picture frames in a panorama.

    Returns a list of detected elements with positions and types.
    """
    if not ANTHROPIC_API_KEY:
        print("  Scene analysis: ANTHROPIC_API_KEY not set, using default positions")
        return []

    # Resize panorama to ~2048px wide for analysis (save tokens)
    img = Image.open(BytesIO(panorama_bytes))
    orig_w, orig_h = img.size
    analysis_w = 2048
    analysis_h = 1024
    img = img.resize((analysis_w, analysis_h), Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=80)
    b64_image = base64.b64encode(buf.getvalue()).decode()

    prompt = """Analyze this equirectangular 360° panorama of a room/studio.

Find ALL of the following elements and give me their exact pixel positions:
1. TV screens / monitors (dark rectangular screens, may be wall-mounted or on stands)
2. Picture frames (framed images on walls)
3. Display screens / digital signage
4. Blank walls or surfaces that would be good for mounting a display

For each element found, respond with a JSON array. Each item should have:
- "type": "tv" or "frame" or "display"
- "x": center x coordinate (0 to 2048)
- "y": center y coordinate (0 to 1024)
- "width": approximate width in pixels
- "height": approximate height in pixels
- "confidence": 0.0 to 1.0

IMPORTANT:
- The image is equirectangular (360°), so objects may appear stretched near the top/bottom
- x=0 is the left edge, x=2048 is the right edge (wraps around)
- y=0 is the top (ceiling), y=512 is eye level, y=1024 is the floor
- TVs are usually between y=300 and y=600 (wall-mounted above or at eye level)
- Look carefully at dark rectangular shapes — those are likely screens
- Include ALL screens you can find, even if they're small or partially visible

Respond with ONLY the JSON array, no other text."""

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": b64_image,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }],
            },
        )

        if resp.status_code != 200:
            print(f"  Scene analysis failed: {resp.status_code} {resp.text[:200]}")
            return []

        result = resp.json()
        content = result.get("content", [{}])[0].get("text", "")

        # Parse JSON from response
        try:
            # Strip markdown code fences if present
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1]
                content = content.rsplit("```", 1)[0]
            elements = json.loads(content)
        except json.JSONDecodeError:
            print(f"  Scene analysis: failed to parse response: {content[:200]}")
            return []

    # Convert pixel positions to yaw/pitch
    results = []
    for el in elements:
        if el.get("confidence", 0) < 0.3:
            continue
        pos = panorama_to_yaw_pitch(el["x"], el["y"], analysis_w, analysis_h)
        marker_width = estimate_marker_width(el.get("width", 200), analysis_w)
        results.append({
            "type": el["type"],
            "yaw": pos["yaw"],
            "pitch": pos["pitch"],
            "width": marker_width,
            "height": int(marker_width * el.get("height", 150) / max(el.get("width", 200), 1)),
            "confidence": el.get("confidence", 0.5),
        })

    # Sort by confidence, highest first
    results.sort(key=lambda x: -x["confidence"])

    print(f"  Scene analysis: found {len(results)} elements")
    for r in results:
        print(f"    {r['type']} at yaw={r['yaw']}, pitch={r['pitch']} ({r['width']}x{r['height']}) conf={r['confidence']}")

    return results


def assign_content_to_positions(
    positions: list[dict],
    videos: list[dict],
    images: list[str],
    profile_data: dict,
) -> list[dict]:
    """Assign content (videos, images, profile) to detected scene positions.

    TVs get videos, frames get images, the largest/most central display gets the profile card.
    """
    markers = []

    # Separate by type
    tvs = [p for p in positions if p["type"] in ("tv", "display")]
    frames = [p for p in positions if p["type"] == "frame"]

    # Find the most central TV for the profile card (closest to yaw=0, pitch=0)
    if tvs:
        tvs.sort(key=lambda t: abs(t["yaw"]) + abs(t["pitch"]))
        profile_pos = tvs.pop(0)  # Take the most central one for profile
        markers.append({
            "type": "profile",
            "yaw": profile_pos["yaw"],
            "pitch": profile_pos["pitch"],
            "data": profile_data,
        })

    # Assign videos to remaining TVs — include detected width for sizing
    for i, tv in enumerate(tvs):
        if i >= len(videos):
            break
        markers.append({
            "type": "video",
            "yaw": tv["yaw"],
            "pitch": tv["pitch"],
            "scene_width": tv.get("width", 360),
            "data": videos[i],
        })

    # Assign images to frames
    for i, frame in enumerate(frames):
        if i >= len(images):
            break
        markers.append({
            "type": "image",
            "yaw": frame["yaw"],
            "pitch": frame["pitch"],
            "scene_width": frame.get("width", 160),
            "data": {
                "image_url": images[i],
                "source": "instagram",
            },
        })

    # If we have leftover videos and no more TVs, place them at default positions
    assigned_video_count = min(len(tvs), len(videos))
    remaining_videos = videos[assigned_video_count:]
    default_yaws = [-130, -70, 70, 130, -170, 170]
    for i, video in enumerate(remaining_videos[:6]):
        if i >= len(default_yaws):
            break
        # Check the yaw isn't too close to an existing marker
        yaw = default_yaws[i]
        too_close = any(abs(m["yaw"] - yaw) < 30 for m in markers)
        if not too_close:
            markers.append({
                "type": "video",
                "yaw": yaw,
                "pitch": 6,
                "data": video,
            })

    # Place remaining images at default positions if not enough frames detected
    assigned_image_count = min(len(frames), len(images))
    remaining_images = images[assigned_image_count:]
    default_img_positions = [
        {"yaw": -45, "pitch": 15}, {"yaw": -15, "pitch": 18},
        {"yaw": 15, "pitch": 18}, {"yaw": 45, "pitch": 15},
        {"yaw": -75, "pitch": 12}, {"yaw": 75, "pitch": 12},
    ]
    for i, img_url in enumerate(remaining_images[:6]):
        if i >= len(default_img_positions):
            break
        pos = default_img_positions[i]
        too_close = any(abs(m["yaw"] - pos["yaw"]) < 20 for m in markers)
        if not too_close:
            markers.append({
                "type": "image",
                "yaw": pos["yaw"],
                "pitch": pos["pitch"],
                "scene_width": 200,
                "data": {"image_url": img_url, "source": "youtube"},
            })

    # If no profile card was placed (no TVs found), add at center
    if not any(m["type"] == "profile" for m in markers):
        markers.insert(0, {
            "type": "profile",
            "yaw": 0,
            "pitch": 10,
            "data": profile_data,
        })

    return markers


# CLI test
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python scene_analyzer.py <panorama.jpg>")
        sys.exit(1)

    img_path = sys.argv[1]
    with open(img_path, "rb") as f:
        img_bytes = f.read()

    elements = asyncio.run(detect_scene_elements(img_bytes))
    print(f"\nFound {len(elements)} elements")
