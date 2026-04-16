"""
Analyze scraped images and brand data to generate a Blockade Labs prompt.
Extracts dominant colors, mood, and visual style from images.
"""

from io import BytesIO
from PIL import Image
from collections import Counter


def extract_dominant_colors(images: list[bytes], n_colors: int = 5) -> list[str]:
    """Extract dominant colors from a set of images as hex strings."""
    all_colors = []

    for img_bytes in images[:6]:  # Sample first 6 images
        try:
            img = Image.open(BytesIO(img_bytes))
            # Resize small for speed
            img = img.resize((50, 50))
            img = img.convert("RGB")
            pixels = list(img.getdata())

            # Quantize to reduce color space
            quantized = []
            for r, g, b in pixels:
                # Round to nearest 32
                qr = (r // 32) * 32
                qg = (g // 32) * 32
                qb = (b // 32) * 32
                quantized.append((qr, qg, qb))

            all_colors.extend(quantized)
        except Exception:
            continue

    if not all_colors:
        return ["#111111", "#FFFFFF", "#0066CC"]

    # Get most common colors, skip very dark and very light
    counter = Counter(all_colors)
    result = []
    for (r, g, b), _ in counter.most_common(50):
        brightness = (r + g + b) / 3
        if brightness < 20 or brightness > 235:
            continue
        hex_color = f"#{r:02x}{g:02x}{b:02x}"
        result.append(hex_color)
        if len(result) >= n_colors:
            break

    if not result:
        result = ["#111111", "#FFFFFF", "#0066CC"]

    return result


def analyze_brightness(images: list[bytes]) -> str:
    """Determine if the brand imagery is light, dark, or mixed."""
    brightnesses = []

    for img_bytes in images[:6]:
        try:
            img = Image.open(BytesIO(img_bytes))
            img = img.resize((50, 50)).convert("L")  # Grayscale
            pixels = list(img.getdata())
            avg = sum(pixels) / len(pixels)
            brightnesses.append(avg)
        except Exception:
            continue

    if not brightnesses:
        return "mixed"

    avg_brightness = sum(brightnesses) / len(brightnesses)
    if avg_brightness < 85:
        return "dark"
    elif avg_brightness > 170:
        return "light"
    return "mixed"


def detect_mood(brand: str, colors: list[str], brightness: str) -> str:
    """Infer mood from brand, colors, and brightness."""
    # Brand-specific moods
    brand_moods = {
        "nike": "bold athletic energy",
        "apple": "minimal clean precision",
        "gucci": "opulent luxury fashion",
        "starbucks": "warm inviting comfort",
        "redbull": "extreme high-energy adrenaline",
        "tesla": "futuristic sleek innovation",
        "chanel": "elegant timeless sophistication",
        "supreme": "urban streetwear edge",
        "patagonia": "outdoor adventure nature",
    }

    if brand.lower() in brand_moods:
        return brand_moods[brand.lower()]

    # Infer from colors and brightness
    if brightness == "dark":
        return "dramatic moody atmosphere"
    elif brightness == "light":
        return "clean bright airy"
    return "modern professional"


def build_blockade_prompt(brand: str, images: list[bytes], source_url: str = "") -> str:
    """Build a Blockade Labs prompt from scraped brand data.

    Analyzes the images to extract colors and mood, then crafts a prompt
    that will generate a 360° environment matching the brand's visual identity.
    """
    colors = extract_dominant_colors(images)
    brightness = analyze_brightness(images)
    mood = detect_mood(brand, colors, brightness)

    # Color description
    color_names = []
    for hex_c in colors[:3]:
        r, g, b = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
        if r > 180 and g < 80 and b < 80:
            color_names.append("red")
        elif r < 80 and g > 150 and b < 80:
            color_names.append("green")
        elif r < 80 and g < 80 and b > 180:
            color_names.append("blue")
        elif r > 180 and g > 150 and b < 80:
            color_names.append("gold")
        elif r > 180 and g > 100 and b < 60:
            color_names.append("orange")
        elif r > 150 and g < 80 and b > 150:
            color_names.append("purple")
        elif r < 60 and g > 180 and b > 180:
            color_names.append("cyan")
        elif r > 200 and g > 200 and b > 200:
            color_names.append("white")
        elif r < 50 and g < 50 and b < 50:
            color_names.append("black")
        else:
            color_names.append("neutral")

    # Remove duplicates
    color_names = list(dict.fromkeys(color_names))
    color_desc = " and ".join(color_names[:3]) if color_names else "modern"

    # Build environment type based on mood
    if "luxury" in mood or "elegant" in mood or "opulent" in mood:
        environment = "a luxurious high-end showroom with marble floors, dramatic spotlights, and velvet curtains"
    elif "athletic" in mood or "energy" in mood or "extreme" in mood:
        environment = "a dynamic sports arena with dramatic stadium lighting, concrete and steel textures"
    elif "minimal" in mood or "clean" in mood:
        environment = "a pristine minimal gallery space with soft diffused lighting and floating display platforms"
    elif "warm" in mood or "comfort" in mood or "cozy" in mood:
        environment = "a warm inviting interior space with ambient lighting, natural wood textures, and comfortable atmosphere"
    elif "outdoor" in mood or "nature" in mood or "adventure" in mood:
        environment = "a breathtaking outdoor vista with dramatic natural landscape, golden hour lighting"
    elif "urban" in mood or "street" in mood:
        environment = "a trendy urban loft space with exposed brick, neon accents, and street art elements"
    elif "futuristic" in mood or "innovation" in mood:
        environment = "a sleek futuristic showroom with holographic displays, glass surfaces, and ambient LED lighting"
    elif "dark" in mood or "dramatic" in mood:
        environment = "a dramatic dark environment with volumetric lighting, deep shadows, and cinematic atmosphere"
    else:
        environment = "a stylish modern showroom with professional lighting and clean architectural lines"

    brand_name = brand.capitalize() if brand else "the brand"

    prompt = (
        f"A stunning 360-degree immersive environment designed as a brand experience. "
        f"{environment}. "
        f"The color palette features {color_desc} tones with {mood}. "
        f"Product display areas with elegant pedestals and floating shelves. "
        f"Photorealistic quality, cinematic lighting, 8K detail. "
        f"No text, no words, no letters, no writing, no signs, no labels anywhere in the scene."
    )

    print(f"  Style analysis:")
    print(f"    Colors: {colors[:3]}")
    print(f"    Brightness: {brightness}")
    print(f"    Mood: {mood}")
    print(f"    Prompt: {prompt[:100]}...")

    return prompt
