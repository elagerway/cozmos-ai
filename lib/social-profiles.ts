export interface SocialProfile {
  handle: string
  platform: "instagram" | "tiktok" | "twitter" | "pinterest" | "youtube"
  display_name: string
  avatar_url: string
  bio: string
  followers: string
  extracted: {
    primary_colors: string[]
    mood: string
    visual_style: string
    brand_tone: string
    key_themes: string[]
    sample_captions: string[]
  }
}

const PROFILES: Record<string, SocialProfile> = {
  nike: {
    handle: "@nike",
    platform: "instagram",
    display_name: "Nike",
    avatar_url: "",
    bio: "Just Do It.",
    followers: "304M",
    extracted: {
      primary_colors: ["#111111", "#FFFFFF", "#FF6B00"],
      mood: "Bold, athletic, empowering",
      visual_style: "High-contrast photography, dramatic lighting, motion blur, close-up textures of sportswear and athletes in action",
      brand_tone: "Motivational, confident, direct",
      key_themes: ["athletic performance", "street culture", "inclusivity", "urban grit"],
      sample_captions: [
        "You don't need permission to be great.",
        "Every champion was once a contender who refused to give up.",
        "Sport changes everything.",
      ],
    },
  },
  starbucks: {
    handle: "@starbucks",
    platform: "instagram",
    display_name: "Starbucks",
    avatar_url: "",
    bio: "Inspiring and nurturing the human spirit.",
    followers: "17.8M",
    extracted: {
      primary_colors: ["#00704A", "#1E3932", "#F2F0EB"],
      mood: "Warm, inviting, cozy",
      visual_style: "Warm tones, soft natural light, overhead flat-lays of drinks, autumn leaves, handwritten cup art, cafe interiors",
      brand_tone: "Friendly, warm, community-driven",
      key_themes: ["seasonal drinks", "cozy moments", "sustainability", "community"],
      sample_captions: [
        "Name a better duo than fall and a Pumpkin Spice Latte.",
        "Sip happens. Make it a good one.",
        "Your daily dose of warmth.",
      ],
    },
  },
  apple: {
    handle: "@apple",
    platform: "instagram",
    display_name: "Apple",
    avatar_url: "",
    bio: "Everyone has a story to tell.",
    followers: "35.2M",
    extracted: {
      primary_colors: ["#000000", "#FFFFFF", "#0071E3"],
      mood: "Minimal, premium, innovative",
      visual_style: "Clean minimalism, product-focused, dramatic shadows on dark backgrounds, user-generated photography shot on iPhone, precise geometric compositions",
      brand_tone: "Understated confidence, precision, creativity",
      key_themes: ["innovation", "creativity", "photography", "design simplicity"],
      sample_captions: [
        "Shot on iPhone.",
        "Think different.",
        "The best way to experience it is to experience it.",
      ],
    },
  },
  gucci: {
    handle: "@gucci",
    platform: "instagram",
    display_name: "Gucci",
    avatar_url: "",
    bio: "Redefining modern luxury.",
    followers: "52.6M",
    extracted: {
      primary_colors: ["#0A0A0A", "#C6A961", "#6B2D35"],
      mood: "Luxury, eclectic, maximalist",
      visual_style: "Rich textures, ornate patterns, Renaissance-inspired compositions, velvet and gold, dramatic editorial photography with bold colour grading",
      brand_tone: "Opulent, artistic, boundary-pushing",
      key_themes: ["high fashion", "art collaboration", "heritage craft", "gender fluidity"],
      sample_captions: [
        "Where heritage meets the avant-garde.",
        "A new chapter of beauty.",
        "The ritual of self-expression.",
      ],
    },
  },
  redbull: {
    handle: "@redbull",
    platform: "instagram",
    display_name: "Red Bull",
    avatar_url: "",
    bio: "Giving you wings since 1987.",
    followers: "17.1M",
    extracted: {
      primary_colors: ["#DB0A40", "#1E2757", "#FFC906"],
      mood: "Energetic, extreme, adrenaline-fuelled",
      visual_style: "Action sports photography, aerial shots, extreme angles, motion-heavy, vibrant skies, athletes mid-flight",
      brand_tone: "High-energy, fearless, adventurous",
      key_themes: ["extreme sports", "adventure", "music festivals", "pushing limits"],
      sample_captions: [
        "Limits? What limits?",
        "Send it.",
        "The only way is up.",
      ],
    },
  },
}

// Detect social handles or URLs in text
export function detectSocialProfile(text: string): SocialProfile | null {
  const lower = text.toLowerCase()

  // Check for @handle mentions
  const handleMatch = lower.match(/@(\w+)/)
  if (handleMatch) {
    const handle = handleMatch[1]
    if (PROFILES[handle]) return PROFILES[handle]
  }

  // Check for platform URLs
  const urlPatterns = [
    /(?:instagram\.com|instagr\.am)\/(\w+)/i,
    /(?:tiktok\.com)\/@?(\w+)/i,
    /(?:twitter\.com|x\.com)\/(\w+)/i,
    /(?:pinterest\.com)\/(\w+)/i,
    /(?:youtube\.com)\/@?(\w+)/i,
  ]

  for (const pattern of urlPatterns) {
    const match = text.match(pattern)
    if (match) {
      const username = match[1].toLowerCase()
      if (PROFILES[username]) return PROFILES[username]
    }
  }

  // Check for brand name mentions
  for (const [key, profile] of Object.entries(PROFILES)) {
    if (lower.includes(key)) return profile
  }

  return null
}

export function getProfileInitial(profile: SocialProfile): string {
  return profile.display_name.charAt(0).toUpperCase()
}

export const SOCIAL_SAMPLE_BRIEFS = [
  "Create a sphere inspired by @nike — bold, athletic, dark tones",
  "Build a cozy autumn campaign based on @starbucks' visual style",
  "Design a premium product showcase using @apple's minimal aesthetic",
  "Create a luxury fashion sphere inspired by @gucci",
  "Build an extreme sports sphere based on @redbull's energy and style",
]
