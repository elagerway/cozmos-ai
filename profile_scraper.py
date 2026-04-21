"""
Comprehensive profile scraper for influencer "About Me" spheres.
Scrapes YouTube, X/Twitter, and website data to build a complete profile.
"""

import asyncio
import re
from dataclasses import dataclass, field
from io import BytesIO

import os

import httpx
from PIL import Image

INSTAGRAM_USERNAME = os.environ.get("INSTAGRAM_USERNAME", "")
INSTAGRAM_PASSWORD = os.environ.get("INSTAGRAM_PASSWORD", "")
IG_PROXY_URL = os.environ.get("IG_PROXY_URL", "")


@dataclass
class InstagramData:
    handle: str = ""
    name: str = ""
    bio: str = ""
    profile_pic_url: str = ""
    follower_count: int = 0
    post_images: list[str] = field(default_factory=list)  # URLs


@dataclass
class TikTokData:
    handle: str = ""
    name: str = ""
    bio: str = ""
    profile_pic_url: str = ""
    follower_count: str = ""


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
    instagram: InstagramData | None = None
    tiktok: TikTokData | None = None
    website_url: str = ""
    thumbnail_images: list[bytes] = field(default_factory=list)


async def search_youtube_handle(name: str) -> str | None:
    """Search YouTube for a person/brand name and return their main channel handle.

    Checks multiple channel results and picks the one whose name best matches
    the search query, preferring channels with the person's actual name.
    """
    search_url = f"https://www.youtube.com/results?search_query={name.replace(' ', '+')}&sp=EgIQAg%3D%3D"
    name_lower = name.lower()

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15.0,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        ) as client:
            resp = await client.get(search_url)
            if resp.status_code != 200:
                return None

            # Extract unique channel IDs (deduplicated, preserve order)
            all_ids = re.findall(r'"channelId":"([^"]+)"', resp.text)
            seen = set()
            channel_ids = []
            for cid in all_ids:
                if cid not in seen:
                    seen.add(cid)
                    channel_ids.append(cid)

            if not channel_ids:
                return None

            # Check up to 5 channels, find the best name match
            best_handle = None
            best_score = -1

            for cid in channel_ids[:5]:
                ch_url = f"https://www.youtube.com/channel/{cid}"
                try:
                    ch_resp = await client.get(ch_url)
                    if ch_resp.status_code != 200:
                        continue

                    # Extract channel name
                    ch_name = ""
                    ch_name_match = re.search(r'"channelName":"([^"]+)"', ch_resp.text)
                    if ch_name_match:
                        ch_name = ch_name_match.group(1)

                    # Extract handle
                    handle = None
                    for pattern in [
                        r'"vanityChannelUrl":"http[s]?://www\.youtube\.com/@([^"]+)"',
                        r'"canonicalBaseUrl":"/@([^"]+)"',
                    ]:
                        match = re.search(pattern, ch_resp.text)
                        if match:
                            handle = match.group(1)
                            break

                    if not handle:
                        handle = f"channel/{cid}"

                    # Score: how well does this channel match the search name?
                    score = 0
                    ch_name_lower = ch_name.lower()
                    if ch_name_lower == name_lower:
                        score = 100  # Exact match
                    elif name_lower in ch_name_lower:
                        score = 80  # Name contained in channel name
                    elif ch_name_lower in name_lower:
                        score = 60  # Channel name contained in search

                    # Check subscriber count as tiebreaker
                    sub_match = re.search(r'"subscriberCountText":\{"simpleText":"([^"]+)"', ch_resp.text)
                    if sub_match:
                        sub_text = sub_match.group(1).lower()
                        if "m " in sub_text or "m sub" in sub_text:
                            score += 10  # Millions of subscribers = likely the main channel

                    print(f"  YouTube search: {ch_name} (@{handle}) score={score}")

                    if score > best_score:
                        best_score = score
                        best_handle = handle

                    # Perfect match, stop looking
                    if score >= 100:
                        break

                except Exception:
                    continue

            if best_handle:
                print(f"  YouTube search: best match @{best_handle} (score={best_score})")
            return best_handle

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


async def scrape_tiktok_profile(handle: str) -> TikTokData | None:
    """Scrape basic TikTok profile data from meta tags."""
    data = TikTokData(handle=handle)

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        ) as client:
            resp = await client.get(f"https://www.tiktok.com/@{handle}")
            if resp.status_code != 200:
                return None
            html = resp.text

            # Extract from meta tags
            desc_match = re.search(r'<meta\s+(?:name|property)="(?:og:)?description"\s+content="([^"]+)"', html)
            if desc_match:
                data.bio = desc_match.group(1)

            title_match = re.search(r'<meta\s+(?:name|property)="(?:og:)?title"\s+content="([^"]+)"', html)
            if title_match:
                data.name = title_match.group(1).split("(")[0].split("|")[0].strip()

            img_match = re.search(r'<meta\s+(?:name|property)="(?:og:)?image"\s+content="([^"]+)"', html)
            if img_match:
                data.profile_pic_url = img_match.group(1)

            # Try to extract follower count from JSON-LD or page data
            followers_match = re.search(r'"followerCount"[:\s]*(\d+)', html)
            if followers_match:
                count = int(followers_match.group(1))
                if count >= 1000000:
                    data.follower_count = f"{count / 1000000:.1f}M"
                elif count >= 1000:
                    data.follower_count = f"{count / 1000:.1f}K"
                else:
                    data.follower_count = str(count)

            if data.bio or data.name:
                print(f"  TikTok: {data.name} (@{handle}), {data.follower_count} followers")
                return data
    except Exception:
        pass

    return None


async def scrape_instagram_profile(handle: str) -> InstagramData | None:
    """Scrape Instagram profile and recent post images via instagrapi."""
    if not INSTAGRAM_USERNAME or not INSTAGRAM_PASSWORD:
        print(f"  Instagram: skipping (no credentials)")
        return None

    try:
        from instagrapi import Client

        cl = Client()
        # Route through residential proxy if configured — Railway's datacenter IPs
        # are on Instagram's blacklist, so prod must use a home/residential egress.
        if IG_PROXY_URL:
            cl.set_proxy(IG_PROXY_URL)

        # Use cached session if available; fall back to full login.
        # Verbose logging so we can tell login failures apart from lookup failures.
        session_path = "/tmp/ig_session.json"
        try:
            cl.load_settings(session_path)
            cl.login(INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD)
            cl.get_timeline_feed()
            print(f"  Instagram login OK (cached session, user_id={cl.user_id})")
        except Exception as e:
            print(f"  Instagram cached session rejected ({type(e).__name__}: {e}); trying fresh login")
            try:
                cl.login(INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD)
                cl.dump_settings(session_path)
                print(f"  Instagram fresh login OK (user_id={cl.user_id})")
            except Exception as e2:
                print(f"  Instagram fresh login FAILED ({type(e2).__name__}: {e2})")
                return None

        # Look up user
        try:
            user_id = cl.user_id_from_username(handle)
            print(f"  Instagram resolved @{handle} → user_id={user_id}")
        except Exception as e:
            print(f"  Instagram user_id_from_username('{handle}') failed: {type(e).__name__}: {e}")
            return None

        try:
            user_info = cl.user_info(user_id)
        except Exception as e:
            print(f"  Instagram user_info({user_id}) failed: {type(e).__name__}: {e}")
            return None

        data = InstagramData(
            handle=handle,
            name=user_info.full_name or handle,
            bio=user_info.biography or "",
            profile_pic_url=str(user_info.profile_pic_url_hd or user_info.profile_pic_url or ""),
            follower_count=user_info.follower_count or 0,
        )

        # Get recent posts — optional; user_medias uses a stricter private
        # endpoint that can fail with "Not authorized to view user" even when
        # user_info succeeded (e.g. account restrictions or rate limiting).
        # Return partial profile data in that case instead of discarding the scrape.
        try:
            medias = cl.user_medias(user_id, amount=12)
            for media in medias:
                if media.media_type == 1 and media.thumbnail_url:  # Photo
                    data.post_images.append(str(media.thumbnail_url))
                elif media.media_type == 8 and media.resources:  # Carousel
                    for resource in media.resources[:2]:
                        if resource.thumbnail_url:
                            data.post_images.append(str(resource.thumbnail_url))
        except Exception as e:
            print(f"  Instagram user_medias({user_id}) failed: {type(e).__name__}: {e} — continuing with profile-only data")

        print(f"  Instagram: {data.name} (@{handle}), {data.follower_count} followers, {len(data.post_images)} images")
        return data

    except Exception as e:
        print(f"  Instagram scrape failed: {e}")
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

    # Try Instagram — keep any non-None result so we at least get the handle
    # and any follower/bio data even if user_medias was restricted.
    for handle in handles:
        ig = await scrape_instagram_profile(handle)
        if ig:
            profile.instagram = ig
            if not profile.bio and ig.bio:
                profile.bio = ig.bio
            if not profile.name and ig.name:
                profile.name = ig.name
            if not profile.profile_image_url and ig.profile_pic_url:
                profile.profile_image_url = ig.profile_pic_url
            break

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

    # Try TikTok
    for handle in handles:
        tt = await scrape_tiktok_profile(handle)
        if tt and (tt.bio or tt.name):
            profile.tiktok = tt
            if not profile.bio and tt.bio:
                profile.bio = tt.bio
            if not profile.name and tt.name:
                profile.name = tt.name
            break

    # Download thumbnails for compositing (YouTube + Instagram)
    if profile.youtube and profile.youtube.videos:
        profile.thumbnail_images = await download_thumbnails(profile.youtube.videos)
        print(f"  Downloaded {len(profile.thumbnail_images)} YouTube thumbnails")

    # Also download Instagram post images
    if profile.instagram and profile.instagram.post_images:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for img_url in profile.instagram.post_images[:6]:
                try:
                    resp = await client.get(img_url)
                    if resp.status_code == 200 and len(resp.content) > 5000:
                        profile.thumbnail_images.append(resp.content)
                except Exception:
                    continue
        print(f"  Downloaded {len(profile.instagram.post_images[:6])} Instagram images")

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

    # Every environment includes: wall-mounted TV screens, framed pictures on walls,
    # and a central display area. NO text, names, or words in the scene — AI renders text badly.
    screen_desc = "Large flat-screen TVs mounted on walls turned off with solid black screens, elegant empty picture frames on walls, a display pedestal"
    space_desc = "very spacious and open, high ceilings, wide room with plenty of distance between walls"

    if any(w in bio_lower for w in ["tech", "review", "gadget", "phone", "computer", "software"]):
        env = f"a {space_desc}, sleek modern tech studio, dark walls with subtle colored LED accent lighting, {screen_desc}, professional camera equipment on tripods, cinematic studio lighting"
    elif any(w in bio_lower for w in ["music", "artist", "singer", "rapper", "producer", "dj"]):
        env = f"a {space_desc}, dramatic music studio and lounge, moody concert lighting, {screen_desc}, speakers, vinyl records on shelves, mixing console, neon accents"
    elif any(w in bio_lower for w in ["fitness", "gym", "workout", "athlete", "sport"]):
        env = f"a {space_desc}, premium athletic personal space, dramatic spotlights, {screen_desc}, trophy case, dark concrete and steel, gym equipment in background"
    elif any(w in bio_lower for w in ["fashion", "style", "model", "beauty", "makeup"]):
        env = f"a {space_desc}, luxury fashion showroom, marble floors, {screen_desc}, dramatic runway lighting, velvet curtains, gold accents, mannequins"
    elif any(w in bio_lower for w in ["food", "cook", "chef", "recipe", "kitchen"]):
        env = f"a {space_desc}, stunning professional kitchen and dining lounge, warm ambient lighting, {screen_desc}, copper pots hanging, marble countertops"
    elif any(w in bio_lower for w in ["travel", "adventure", "explore", "outdoor"]):
        env = f"a {space_desc}, breathtaking travel lodge, panoramic windows with scenic views, {screen_desc}, warm wood interior, globes, camera gear"
    elif any(w in bio_lower for w in ["game", "gaming", "stream", "twitch", "esport"]):
        env = f"a {space_desc}, epic gaming command center, RGB lighting, {screen_desc}, multiple gaming monitors, dark room with neon accents, gaming chair"
    else:
        env = f"a {space_desc}, stylish modern creator studio, professional warm lighting, clean design, {screen_desc}, bookshelves, comfortable seating area"

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

    prompt = f"{env}.{color_desc} Photorealistic quality, cinematic depth of field, 8K detail, immersive atmosphere. No text, no words, no letters, no writing, no signs, no labels anywhere in the scene."

    print(f"  Blockade prompt: {prompt[:120]}...")
    return prompt


def build_markers(profile: InfluencerProfile) -> list[dict]:
    """Build marker data for interactive elements in the sphere."""
    markers = []

    # Profile card — mounted display, slightly above eye level
    markers.append({
        "type": "profile",
        "yaw": 0,
        "pitch": 10,
        "data": {
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
        },
    })

    # Video markers — positioned like wall-mounted TV screens around the room
    if profile.youtube and profile.youtube.videos:
        # TVs at eye level, spread around the room like a real studio
        tv_positions = [
            {"yaw": -150, "pitch": 5},   # Far left wall TV
            {"yaw": -90,  "pitch": 3},   # Left wall TV
            {"yaw": -40,  "pitch": 5},   # Left-center TV
            {"yaw": 40,   "pitch": 5},   # Right-center TV
            {"yaw": 90,   "pitch": 3},   # Right wall TV
            {"yaw": 150,  "pitch": 5},   # Far right wall TV
        ]
        for i, video in enumerate(profile.youtube.videos[:6]):
            pos = tv_positions[i] if i < len(tv_positions) else {"yaw": (i * 55) - 180, "pitch": 0}
            markers.append({
                "type": "video",
                "yaw": pos["yaw"],
                "pitch": pos["pitch"],
                "data": {
                    "video_id": video.id,
                    "title": video.title,
                    "thumbnail_url": video.thumbnail_url,
                    "view_count": video.view_count,
                    "url": video.url,
                },
            })

    # Image gallery markers — positioned like framed pictures on walls (above eye level)
    if profile.instagram and profile.instagram.post_images:
        frame_positions = [
            {"yaw": -65,  "pitch": 15},  # Upper left frame
            {"yaw": -25,  "pitch": 17},  # Upper center-left frame
            {"yaw": 25,   "pitch": 17},  # Upper center-right frame
            {"yaw": 65,   "pitch": 15},  # Upper right frame
        ]
        for i, img_url in enumerate(profile.instagram.post_images[:4]):
            pos = frame_positions[i] if i < len(frame_positions) else {"yaw": (i * 30) - 60, "pitch": 20}
            markers.append({
                "type": "image",
                "yaw": pos["yaw"],
                "pitch": pos["pitch"],
                "data": {
                    "image_url": img_url,
                    "source": "instagram",
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
