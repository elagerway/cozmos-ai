export type GenerationStatus = "pending" | "running" | "done" | "failed"

export type Mood = "bold" | "minimal" | "playful" | "luxury" | "energetic" | "dark" | "bright"

export type LayoutStyle = "hero_center" | "grid" | "scattered" | "featured_3" | "arc"

export interface SphereSpec {
  campaign_name: string
  theme: string
  background_style: string
  primary_colors: string[]
  mood: Mood
  product_count: number
  layout_style: LayoutStyle
  brand_tone: string
}

export type PipelineStep =
  | "scan_profile"
  | "extract_style"
  | "bg_prompt"
  | "process"
  | "done"

export interface Generation {
  id: string
  prompt: string
  status: GenerationStatus
  step: PipelineStep | null
  step_label: string | null
  sphere_spec: SphereSpec | null
  bg_prompt: string | null
  image_url: string | null
  error: string | null
  cost_usd: number | null
  duration_s: number | null
  created_at: string
}

export interface PipelineStepDef {
  key: PipelineStep
  label: string
  pct: number
}

export const PIPELINE_STEPS: PipelineStepDef[] = [
  { key: "scan_profile", label: "Scraping images", pct: 0 },
  { key: "extract_style", label: "AI upscaling", pct: 10 },
  { key: "bg_prompt", label: "Composing panorama", pct: 65 },
  { key: "process", label: "Generating tiles", pct: 80 },
  { key: "done", label: "Your sphere is ready", pct: 100 },
]

export const SOCIAL_PIPELINE_STEPS: PipelineStepDef[] = [
  { key: "scan_profile", label: "Scraping images", pct: 0 },
  { key: "extract_style", label: "AI upscaling", pct: 10 },
  { key: "bg_prompt", label: "Composing panorama", pct: 65 },
  { key: "process", label: "Generating tiles", pct: 80 },
  { key: "done", label: "Your sphere is ready", pct: 100 },
]
