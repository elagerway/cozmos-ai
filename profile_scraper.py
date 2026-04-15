"""
Comprehensive profile scraper for influencer "About Me" spheres.
Scrapes YouTube, X/Twitter, and website data to build a complete profile.
"""

import asyncio
import re
from dataclasses import dataclass, field
from io import BytesIO

import httpx
from PIL import Image


@dataclass
class VideoData:
    id: str
    title: str
    thumbnail_url: str
    view_count: str
    url: str


@dataclass
class YouTubeData:
    channel_name: str = ""
    channel_url: str = ""
    handle: str = ""
    subscriber_count: str = ""
    description: str = ""
    videos: list[VideoData] = field(default_factory=list)
    banner_url: str = ""
    profile_pic_url: str = ""


@dataclass
class TwitterData:
    handle: str = ""
    name: str = ""
    bio: str = ""
    profile_pic_url: str = ""
    banner_url: str = ""
    follower_count: str = ""


@dataclass
class InfluencerProfile:
    name: str = ""
    handle: str = ""
    bio: str = ""
    profile_image_url: str = ""
    banner_image_url: str = ""
    colors: list[str] = field(default_factory=list)
    mood: str = ""
    youtube: YouTubeData | None = None
    twitter: TwitterData | None = None
    website_url: str = ""
    thumbnail_images: list[bytes] = field(default_factory=list)


async def search_youtube_handle(name: str) -> str | None:
    """Search YouTube for a person/brand name and return their channel handle."""
    search_url = f"https://www.youtube.com/results?search_query={name.replace(' ', '+')}&sp=EgIQAg%3D%3D"

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15.0,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        ) as client:
            resp = await client.get(search_url)
            if resp.status_code != 200:
                return None

            # Extract channel IDs from search results (first result is usually the best match)
            channel_ids = re.findall(r'"channelId":"([^"]+)"', resp.text)
            if not channel_ids:
                return None

            # Visit the top channel to get its handle
            ch_url = f"https://www.youtube.com/channel/{channel_ids[0]}"
            print(f"  YouTube search: visiting {ch_url}...")
            ch_resp = await client.get(ch_url)
            if ch_resp.status_code == 200:
                # Try multiple patterns for handle extraction
                for pattern in [
                    r'"vanityChannelUrl":"http[s]?://www\.youtube\.com/@([^"]+)"',
                    r'"channelUrl":"http[s]?://www\.youtube\.com/@([^"]+)"',
                    r'"canonicalBaseUrl":"/@([^"]+)"',
                    r'"ownerUrls":\["http[s]?://www\.youtube\.com/@([^"]+)"\]',
                ]:
                    match = re.search(pattern, ch_resp.text)
                    if match:
                        handle = match.group(1)
                        print(f"  YouTube search found handle: @{handle}")
                        return handle

                # Last resort: use the channel ID directly
                print(f"  YouTube search: using channel ID as fallback")
                return f"channel/{channel_ids[0]}"
    except Exception as e:
        print(f"  YouTube search failed: {e}")

    return None


async def scrape_youtube_channel(handle: str) -> YouTubeData | None:
    """Scrape YouTube channel data including videos, stats, and branding."""
    data = YouTubeData()

    # Handle both @handle and channel/UCXXX formats
    if handle.startswith("channel/"):
        channel_urls = [
            f"https://www.youtube.com/{handle}/videos",
            f"https://www.youtube.com/{handle}",
        ]
    else:
        channel_urls = [
            f"https://www.youtube.com/@{handle}/videos",
            f"https://www.youtube.com/c/{handle}/videos",
            f"https://www.youtube.com/@{handle}",
            f"https://www.youtube.com/c/{handle}",
        ]

    async with httpx.AsyncClient(
        follow_redirects=True, timeout=15.0,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
    ) as client:
        html = ""
        for url in channel_urls:
            try:
                resp = await client.get(url)
                if resp.status_code == 200 and "youtube.com" in str(resp.url):
                    html = resp.text
                    data.channel_url = str(resp.url).split("/videos")[0].split("/about")[0]
                    break
            except Exception:
                continue

        if not html:
            return None

        # Extract channel name
        name_match = re.search(r'"channelName":"([^"]+)"', html)
        if name_match:
            data.channel_name = name_match.group(1)

        # Extract handle
        handle_match = re.search(r'"channelHandleText":\{"runs":\[\{"text":"(@[^"]+)"\}', html)
        if handle_match:
            data.handle = handle_match.group(1)

        # Extract subscriber count
        sub_match = re.search(r'"subscriberCountText":\{"simpleText":"([^"]+)"', html)
        if not sub_match:
            sub_match = re.search(r'"subscriberCountText":\{"content":"([^"]+)"', html)
        if sub_match:
            data.subscriber_count = sub_match.group(1)

        # Extract description
        desc_match = re.search(r'"description":"([^"]{0,500})"', html)
        if desc_match:
            data.description = desc_match.group(1).replace("\\n", " ")

        # Extract profile pic
        avatar_match = re.search(r'"avatar":\{"thumbnails":\[.*?\{"url":"([^"]+)".*?\}\]', html)
        if avatar_match:
            data.profile_pic_url = avatar_match.group(1).split("=")[0] + "=s240-c-k-c0x00ffffff-no-rj"

        # Extract banner
        banner_match = re.search(r'"banner":\{"thumbnails":\[.*?\{"url":"([^"]+)"', html)
        if banner_match:
            data.banner_url = banner_match.group(1)

        # Extract videos from richItemRenderer blocks (the /videos tab)
        # Each block contains a videoId and title close together
        import json as json_mod

        # Try to find the video grid data in ytInitialData
        init_match = re.search(r'var ytInitialData\s*=\s*(\{.+?\});', html)
        if init_match:
            try:
                yt_data = json_mod.loads(init_match.group(1))
                # Navigate to video list
                tabs = yt_data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
                for tab in tabs:
                    tab_content = tab.get("tabRenderer", {}).get("content", {})
                    items = (tab_content.get("richGridRenderer", {}).get("contents", []) or
                             tab_content.get("sectionListRenderer", {}).get("contents", []))
                    for item in items:
                        renderer = (item.get("richItemRenderer", {}).get("content", {}).get("videoRenderer", {}) or
                                   item.get("gridVideoRenderer", {}))
                        vid_id = renderer.get("videoId", "")
                        title_runs = renderer.get("title", {}).get("runs", [])
                        title = title_runs[0].get("text", "") if title_runs else ""
                        views_text = renderer.get("viewCountText", {}).get("simpleText", "")

                        if vid_id and title and len(vid_id) == 11:
                            data.videos.append(VideoData(
                                id=vid_id,
                                title=title,
                                thumbnail_url=f"https://img.youtube.com/vi/{vid_id}/maxresdefault.jpg",
                                view_count=views_text,
                                url=f"https://www.youtube.com/watch?v={vid_id}",
                            ))
                            if len(data.videos) >= 12:
                                break
                    if data.videos:
                        break
            except Exception as e:
                print(f"  JSON parse failed: {e}")

        # Fallback: regex extraction if JSON parse didn't work
        if not data.videos:
            # Find videoId followed by title within ~500 chars
            blocks = re.findall(r'"videoRenderer":\{[^}]*?"videoId":"([a-zA-Z0-9_-]{11})"[^}]*?"title":\{"runs":\[\{"text":"([^"]{1,200})"\}', html)
            seen_ids = set()
            for vid_id, title in blocks:
                if vid_id in seen_ids or title in ("Want to join this channel?", "Posts"):
                    continue
                seen_ids.add(vid_id)
                data.videos.append(VideoData(
                    id=vid_id,
                    title=title,
                    thumbnail_url=f"https://img.youtube.com/vi/{vid_id}/maxresdefault.jpg",
                    view_count="",
                    url=f"https://www.youtube.com/watch?v={vid_id}",
                ))
                if len(data.videos) >= 12:
                    break

        # Filter out non-video entries
        data.videos = [v for v in data.videos if v.title not in ("Want to join this channel?", "Posts", "")]

    if data.channel_name or data.videos:
        print(f"  YouTube: {data.channel_name} ({data.subscriber_count}), {len(data.videos)} videos")
        return data
    return None


async def scrape_twitter_profile(handle: str) -> TwitterData | None:
    """Scrape basic Twitter/X profile data."""
    data = TwitterData(handle=handle)

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        ) as client:
            # Try nitter or direct X
            for url in [f"https://x.com/{handle}", f"https://twitter.com/{handle}"]:
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    html = resp.text

                    # Extract from meta tags
                    desc_match = re.search(r'<meta\s+(?:name|property)="(?:og:)?description"\s+content="([^"]+)"', html)
                    if desc_match:
                        data.bio = desc_match.group(1)

                    title_match = re.search(r'<meta\s+(?:name|property)="(?:og:)?title"\s+content="([^"]+)"', html)
                    if title_match:
                        data.name = title_match.group(1).split("(")[0].strip()

                    img_match = re.search(r'<meta\s+(?:name|property)="(?:og:)?image"\s+content="([^"]+)"', html)
                    if img_match:
                        data.profile_pic_url = img_match.group(1)

                    if data.bio or data.name:
                        print(f"  Twitter: {data.name} — {data.bio[:60]}...")
                        return data
                except Exception:
                    continue
    except Exception:
        pass

    return None


async def download_thumbnails(videos: list[VideoData], max_count: int = 12) -> list[bytes]:
    """Download video thumbnails as image bytes."""
    images = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for video in videos[:max_count]:
            for quality in ["maxresdefault", "hqdefault"]:
                try:
                    url = f"https://img.youtube.com/vi/{video.id}/{quality}.jpg"
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.content) > 10000:
                        images.append(resp.content)
                        break
                except Exception:
                    continue
    return images


async def scrape_influencer_profile(name: str) -> InfluencerProfile:
    """Scrape all available data for a person/brand.

    Tries multiple handle variations and platforms.
    """
    profile = InfluencerProfile(name=name)

    # Generate handle variations
    slug = name.lower().replace(" ", "")
    slug_underscore = name.lower().replace(" ", "_")
    slug_dots = name.lower().replace(" ", ".")
    handles = list(dict.fromkeys([slug, slug_underscore, slug_dots, name.lower()]))

    # Try YouTube with each handle variation
    for handle in handles:
        yt = await scrape_youtube_channel(handle)
        if yt and yt.videos:
            profile.youtube = yt
            profile.handle = yt.handle or f"@{handle}"
            profile.name = yt.channel_name or name
            profile.bio = yt.description
            profile.profile_image_url = yt.profile_pic_url
            profile.banner_image_url = yt.banner_url
            break

    # If no YouTube found, search YouTube for the name
    if not profile.youtube:
        print(f"  Handle variations failed, searching YouTube for '{name}'...")
        found_handle = await search_youtube_handle(name)
        if found_handle:
            yt = await scrape_youtube_channel(found_handle)
            if yt and yt.videos:
                profile.youtube = yt
                profile.handle = yt.handle or f"@{found_handle}"
                profile.name = yt.channel_name or name
                profile.bio = yt.description
                profile.profile_image_url = yt.profile_pic_url
                profile.banner_image_url = yt.banner_url

    # Try Twitter
    for handle in handles:
        tw = await scrape_twitter_profile(handle)
        if tw and (tw.bio or tw.name):
            profile.twitter = tw
            if not profile.bio:
                profile.bio = tw.bio
            if not profile.name and tw.name:
                profile.name = tw.name
            if not profile.profile_image_url and tw.profile_pic_url:
                profile.profile_image_url = tw.profile_pic_url
            break

    # Download thumbnails for compositing
    if profile.youtube and profile.youtube.videos:
        profile.thumbnail_images = await download_thumbnails(profile.youtube.videos)
        print(f"  Downloaded {len(profile.thumbnail_images)} thumbnails")

    # Extract colors from thumbnails
    if profile.thumbnail_images:
        from style_analyzer import extract_dominant_colors, analyze_brightness, detect_mood
        profile.colors = extract_dominant_colors(profile.thumbnail_images)
        brightness = analyze_brightness(profile.thumbnail_images)
        profile.mood = detect_mood(profile.handle or name, profile.colors, brightness)

    if not profile.name:
        profile.name = name

    print(f"  Profile: {profile.name} ({profile.handle})")
    print(f"    Bio: {profile.bio[:80]}..." if profile.bio else "    Bio: (none)")
    print(f"    YouTube: {len(profile.youtube.videos) if profile.youtube else 0} videos")
    print(f"    Colors: {profile.colors[:3]}")
    print(f"    Mood: {profile.mood}")

    return profile


def build_about_me_prompt(profile: InfluencerProfile) -> str:
    """Build a Blockade Labs prompt for a personalized About Me sphere."""

    # Determine environment style from content
    bio_lower = (profile.bio or "").lower()
    name = profile.name

    if any(w in bio_lower for w in ["tech", "review", "gadget", "phone", "computer", "software"]):
        env = f"a sleek modern tech studio designed for {name}, dark walls with subtle colored LED accent lighting, multiple floating display screens, professional camera equipment, cinematic studio lighting"
    elif any(w in bio_lower for w in ["music", "artist", "singer", "rapper", "producer", "dj"]):
        env = f"a dramatic music studio and performance space for {name}, moody concert lighting, speakers, mixing console, neon accents, stage atmosphere"
    elif any(w in bio_lower for w in ["fitness", "gym", "workout", "athlete", "sport"]):
        env = f"a premium athletic training facility for {name}, dramatic spotlights, modern gym equipment, motivational atmosphere, dark concrete and steel"
    elif any(w in bio_lower for w in ["fashion", "style", "model", "beauty", "makeup"]):
        env = f"a luxury fashion showroom for {name}, marble floors, dramatic runway lighting, velvet curtains, gold accents, high-end boutique atmosphere"
    elif any(w in bio_lower for w in ["food", "cook", "chef", "recipe", "kitchen"]):
        env = f"a stunning professional kitchen and dining space for {name}, warm ambient lighting, copper accents, marble countertops, rustic modern design"
    elif any(w in bio_lower for w in ["travel", "adventure", "explore", "outdoor"]):
        env = f"a breathtaking travel lodge overlooking dramatic scenery for {name}, panoramic windows, warm wood interior, golden hour lighting, maps and globes"
    elif any(w in bio_lower for w in ["game", "gaming", "stream", "twitch", "esport"]):
        env = f"an epic gaming command center for {name}, RGB lighting, multiple monitors, dark room with neon accents, futuristic setup"
    else:
        env = f"a stylish modern creator studio for {name}, professional lighting, clean design, floating display screens, warm atmospheric lighting"

    # Add color influence
    color_desc = ""
    if profile.colors:
        from style_analyzer import extract_dominant_colors
        color_names = []
        for hex_c in profile.colors[:3]:
            r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
            if r > 180 and g < 80: color_names.append("red")
            elif r < 80 and g > 150: color_names.append("green")
            elif r < 80 and b > 180: color_names.append("blue")
            elif r > 180 and g > 150: color_names.append("warm gold")
            elif r > 150 and b > 150: color_names.append("purple")
            elif g > 180 and b > 180: color_names.append("cyan")
        if color_names:
            color_desc = f" The color scheme features {' and '.join(color_names[:2])} accent tones."

    prompt = f"{env}.{color_desc} Photorealistic quality, cinematic depth of field, 8K detail, immersive atmosphere."

    print(f"  Blockade prompt: {prompt[:120]}...")
    return prompt


def build_markers(profile: InfluencerProfile) -> list[dict]:
    """Build marker data for interactive elements in the sphere."""
    markers = []

    # Profile card — front and center
    markers.append({
        "type": "profile",
        "yaw": 0,
        "pitch": 5,
        "data": {
            "name": profile.name,
            "handle": profile.handle,
            "bio": (profile.bio or "")[:200],
            "profile_image": profile.profile_image_url,
            "subscriber_count": profile.youtube.subscriber_count if profile.youtube else "",
            "twitter_handle": profile.twitter.handle if profile.twitter else "",
            "channel_url": profile.youtube.channel_url if profile.youtube else "",
        },
    })

    # Video markers — spread around at eye level
    if profile.youtube and profile.youtube.videos:
        video_yaws = [-150, -100, -50, 50, 100, 150]
        for i, video in enumerate(profile.youtube.videos[:6]):
            markers.append({
                "type": "video",
                "yaw": video_yaws[i] if i < len(video_yaws) else (i * 60 - 180),
                "pitch": 0,
                "data": {
                    "video_id": video.id,
                    "title": video.title,
                    "thumbnail_url": video.thumbnail_url,
                    "view_count": video.view_count,
                    "url": video.url,
                },
            })

    return markers


# CLI test
if __name__ == "__main__":
    import sys
    name = sys.argv[1] if len(sys.argv) > 1 else "Marques Brownlee"
    print(f"Scraping profile: {name}")
    profile = asyncio.run(scrape_influencer_profile(name))
    prompt = build_about_me_prompt(profile)
    markers = build_markers(profile)
    print(f"\nMarkers: {len(markers)}")
    for m in markers:
        print(f"  {m['type']} at yaw={m['yaw']}: {m['data'].get('name') or m['data'].get('title','')}")
