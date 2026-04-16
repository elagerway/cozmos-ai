import { Generation, SphereSpec, LayoutStyle } from "./types"

export interface Example extends Generation {
  featured: boolean
  environment: string
  brand?: string
  tile_stem?: string | null
  tile_base_url?: string | null
}

export const EXAMPLES: Example[] = [
// All examples now come from Supabase — no hardcoded entries
]

const _LEGACY_EXAMPLES: Example[] = [
  {
    id: "ex-nike-showroom",
    prompt: "Create a sphere inspired by @nike — bold, athletic, dark tones",
    status: "done",
    step: "done",
    step_label: "Your sphere is ready",
    sphere_spec: {
      campaign_name: "Nike — Dark Showroom",
      theme: "Bold athletic brand in a dramatic dark showroom",
      background_style: "Professional dark studio environment with dramatic directional lighting, products placed as floating displays",
      primary_colors: ["#111111", "#FFFFFF", "#FF6B00"],
      mood: "bold",
      product_count: 12,
      layout_style: "grid",
      brand_tone: "Motivational, confident, direct",
    },
    bg_prompt: "An immersive 360° dark showroom environment with Nike product imagery composited as floating displays. Dramatic studio lighting with deep shadows and bright accents.",
    image_url: "/spheres/env-dark-showroom.jpg",
    error: null,
    cost_usd: 0.04,
    duration_s: 42,
    created_at: "2026-04-14T10:00:00Z",
    featured: true,
    environment: "env-dark-showroom",
    brand: "nike",
  },
  {
    id: "ex-starbucks-cafe",
    prompt: "Build a cozy autumn campaign based on @starbucks' visual style",
    status: "done",
    step: "done",
    step_label: "Your sphere is ready",
    sphere_spec: {
      campaign_name: "Starbucks — Cozy Cafe Experience",
      theme: "Warm inviting cafe environment with Starbucks branding",
      background_style: "Cozy cafe interior with warm amber lighting, wooden furniture, and inviting atmosphere",
      primary_colors: ["#00704A", "#1E3932", "#F2F0EB"],
      mood: "luxury",
      product_count: 8,
      layout_style: "scattered",
      brand_tone: "Warm, friendly, community-driven",
    },
    bg_prompt: "An immersive 360° warm cafe environment with Starbucks product imagery naturally placed throughout. Soft ambient lighting, wooden textures, comfortable atmosphere.",
    image_url: "/spheres/env-cozy-cafe.jpg",
    error: null,
    cost_usd: 0.04,
    duration_s: 38,
    created_at: "2026-04-14T09:00:00Z",
    featured: true,
    environment: "env-cozy-cafe",
    brand: "starbucks",
  },
  {
    id: "ex-apple-studio",
    prompt: "Design a premium product showcase using @apple's minimal aesthetic",
    status: "done",
    step: "done",
    step_label: "Your sphere is ready",
    sphere_spec: {
      campaign_name: "Apple — Clean Studio Showcase",
      theme: "Minimal white studio with premium Apple aesthetic",
      background_style: "Pristine white studio environment with soft diffused lighting, clean lines, and floating product displays",
      primary_colors: ["#000000", "#FFFFFF", "#0071E3"],
      mood: "minimal",
      product_count: 6,
      layout_style: "arc",
      brand_tone: "Understated confidence, precision, creativity",
    },
    bg_prompt: "An immersive 360° clean white studio environment with Apple product imagery displayed on minimal floating surfaces. Soft octabox lighting, infinite white backdrop.",
    image_url: "/spheres/env-white-studio.jpg",
    error: null,
    cost_usd: 0.04,
    duration_s: 35,
    created_at: "2026-04-14T08:00:00Z",
    featured: true,
    environment: "env-white-studio",
    brand: "apple",
  },
  {
    id: "ex-gucci-ballroom",
    prompt: "Create a luxury fashion sphere inspired by @gucci",
    status: "done",
    step: "done",
    step_label: "Your sphere is ready",
    sphere_spec: {
      campaign_name: "Gucci — Grand Ballroom",
      theme: "Opulent luxury ballroom with Gucci fashion",
      background_style: "Victorian ballroom with chandeliers, warm golden lighting, ornate architecture, and fashion displays",
      primary_colors: ["#0A0A0A", "#C6A961", "#6B2D35"],
      mood: "luxury",
      product_count: 10,
      layout_style: "scattered",
      brand_tone: "Opulent, artistic, boundary-pushing",
    },
    bg_prompt: "An immersive 360° luxury ballroom environment with Gucci fashion imagery displayed among ornate Victorian architecture. Warm chandelier glow, marble floors, gilded details.",
    image_url: "/spheres/env-luxury-ballroom.jpg",
    error: null,
    cost_usd: 0.04,
    duration_s: 44,
    created_at: "2026-04-14T07:00:00Z",
    featured: false,
    environment: "env-luxury-ballroom",
    brand: "gucci",
  },
  {
    id: "ex-redbull-storm",
    prompt: "Build an extreme sports sphere based on @redbull's energy and style",
    status: "done",
    step: "done",
    step_label: "Your sphere is ready",
    sphere_spec: {
      campaign_name: "Red Bull — Storm Chaser",
      theme: "Dramatic outdoor environment with extreme sports energy",
      background_style: "Dramatic storm sky with high contrast lighting, moody atmosphere, and adrenaline-fuelled imagery",
      primary_colors: ["#DB0A40", "#1E2757", "#FFC906"],
      mood: "energetic",
      product_count: 8,
      layout_style: "scattered",
      brand_tone: "High-energy, fearless, adventurous",
    },
    bg_prompt: "An immersive 360° dramatic outdoor environment with Red Bull extreme sports imagery composited into a stormy landscape. High contrast, moody skies, adrenaline atmosphere.",
    image_url: "/spheres/env-outdoor-storm.jpg",
    error: null,
    cost_usd: 0.04,
    duration_s: 40,
    created_at: "2026-04-14T06:00:00Z",
    featured: false,
    environment: "env-outdoor-storm",
    brand: "redbull",
  },
  {
    id: "ex-nike-mosaic",
    prompt: "Create a sphere inspired by @nike — bold, athletic, dark tones",
    status: "done",
    step: "done",
    step_label: "Your sphere is ready",
    sphere_spec: {
      campaign_name: "Nike — Product Mosaic",
      theme: "Nike product gallery on dark background",
      background_style: "Dark gallery with Nike product images arranged as a mosaic",
      primary_colors: ["#111111", "#FFFFFF", "#FF6B00"],
      mood: "bold",
      product_count: 12,
      layout_style: "grid",
      brand_tone: "Motivational, confident, direct",
    },
    bg_prompt: "A 360° gallery sphere with Nike product images composited on a dark background.",
    image_url: "/spheres/nike-social.jpg",
    error: null,
    cost_usd: 0.04,
    duration_s: 68,
    created_at: "2026-04-13T16:00:00Z",
    featured: false,
    environment: "custom-mosaic",
    brand: "nike",
  },
]

// For backwards compatibility
export const DUMMY_GENERATIONS: Generation[] = EXAMPLES

export const SAMPLE_BRIEFS: string[] = []

export function getGeneration(id: string): Generation | undefined {
  return EXAMPLES.find((g) => g.id === id)
}

export function getExample(id: string): Example | undefined {
  return EXAMPLES.find((g) => g.id === id)
}

export function getFeaturedExamples(): Example[] {
  return EXAMPLES.filter((e) => e.featured)
}

export function getAllExamples(): Example[] {
  return EXAMPLES
}

export function getEnvironmentForBrand(brand: string): string {
  const map: Record<string, string> = {
    nike: "env-dark-showroom",
    starbucks: "env-cozy-cafe",
    apple: "env-white-studio",
    gucci: "env-luxury-ballroom",
    redbull: "env-outdoor-storm",
  }
  return map[brand] || "env-dark-showroom"
}

export function getRandomImage(socialHandle?: string): string {
  if (socialHandle) {
    const env = getEnvironmentForBrand(socialHandle)
    return `/spheres/${env}.jpg`
  }
  const images = EXAMPLES.filter((e) => e.featured).map((g) => g.image_url!)
  return images[Math.floor(Math.random() * images.length)]
}

export function getRandomSpec(): SphereSpec {
  const featured = EXAMPLES.filter((e) => e.featured)
  return featured[Math.floor(Math.random() * featured.length)].sphere_spec!
}

export const LAYOUT_TEMPLATES: Record<
  LayoutStyle,
  { id: string; yaw: number; pitch: number; size: number; label: string }[]
> = {
  hero_center: [
    { id: "hero", yaw: 0, pitch: 0, size: 120, label: "Hero Product" },
  ],
  featured_3: [
    { id: "left", yaw: -45, pitch: -10, size: 80, label: "Product 1" },
    { id: "center", yaw: 0, pitch: 0, size: 100, label: "Hero Product" },
    { id: "right", yaw: 45, pitch: -10, size: 80, label: "Product 2" },
  ],
  grid: [
    { id: "tl", yaw: -60, pitch: 10, size: 70, label: "Product 1" },
    { id: "tr", yaw: -20, pitch: 10, size: 70, label: "Product 2" },
    { id: "ml", yaw: 20, pitch: -5, size: 70, label: "Product 3" },
    { id: "mr", yaw: 60, pitch: -5, size: 70, label: "Product 4" },
  ],
  scattered: [
    { id: "s1", yaw: -80, pitch: 5, size: 60, label: "Product 1" },
    { id: "s2", yaw: -30, pitch: -15, size: 70, label: "Product 2" },
    { id: "s3", yaw: 25, pitch: 10, size: 55, label: "Product 3" },
    { id: "s4", yaw: 70, pitch: -5, size: 65, label: "Product 4" },
    { id: "s5", yaw: 120, pitch: 0, size: 50, label: "Product 5" },
  ],
  arc: [
    { id: "a1", yaw: -60, pitch: -5, size: 65, label: "Product 1" },
    { id: "a2", yaw: -30, pitch: 5, size: 70, label: "Product 2" },
    { id: "a3", yaw: 0, pitch: 8, size: 75, label: "Product 3" },
    { id: "a4", yaw: 30, pitch: 5, size: 70, label: "Product 4" },
    { id: "a5", yaw: 60, pitch: -5, size: 65, label: "Product 5" },
  ],
}
