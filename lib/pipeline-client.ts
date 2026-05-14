const PIPELINE_URL =
  process.env.NEXT_PUBLIC_PIPELINE_URL || "http://localhost:8100"

export interface PipelineStatus {
  id: string
  brand: string
  prompt: string
  status: "running" | "done" | "failed"
  step: string
  pct: number
  label: string
  image_url?: string
  tile_stem?: string
  tile_base_url?: string
  duration_s?: number
  image_count?: number
  error?: string
  low_res_warning?: boolean
}

export async function startGeneration(
  brand: string,
  prompt: string,
  url?: string,
  highRes: boolean = false,
): Promise<{ id: string }> {
  const res = await fetch(`${PIPELINE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand, prompt, url: url || "", high_res: highRes }),
  })
  if (!res.ok) throw new Error("Failed to start generation")
  return res.json()
}

export async function pollStatus(genId: string): Promise<PipelineStatus> {
  const res = await fetch(`${PIPELINE_URL}/status/${genId}`)
  if (!res.ok) throw new Error("Failed to poll status")
  const data = await res.json()
  if (data.error === "not found") throw new Error("Failed to poll status")
  return data
}

export async function startUploadGeneration(
  images: string[],
  prompt: string,
  compositeTileStem?: string,
  compositeTileBaseUrl?: string
): Promise<{ id: string }> {
  const res = await fetch(`${PIPELINE_URL}/generate-from-uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images,
      prompt,
      composite_tile_stem: compositeTileStem || "",
      composite_tile_base_url: compositeTileBaseUrl || "",
    }),
  })
  if (!res.ok) throw new Error("Failed to start upload generation")
  return res.json()
}

export interface ScrapedProfile {
  handle: string
  platform: "instagram" | "youtube" | "twitter" | "tiktok"
  name: string
  bio: string
  profile_image: string
  followers?: number | string
  channel_url?: string
  twitter_handle?: string
  instagram_handle?: string
  instagram_followers?: number
  tiktok_handle?: string
}

export async function scrapeProfile(input: {
  handle: string
  platform: ScrapedProfile["platform"]
}): Promise<ScrapedProfile> {
  const res = await fetch(`${PIPELINE_URL}/scrape-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: input.handle, platform: input.platform }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Profile lookup failed (${res.status})`)
  }
  return res.json()
}

export interface ScrapedLinktree {
  username: string
  profile_image: string
  page_title: string
  links: Array<{ title: string; url: string }>
}

export async function scrapeLinktree(input: { url: string }): Promise<ScrapedLinktree> {
  const res = await fetch(`${PIPELINE_URL}/scrape-linktree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input.url }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Linktree lookup failed (${res.status})`)
  }
  return res.json()
}

export async function startBgUploadGeneration(input: {
  image: string
  prompt?: string
  brand?: string
}): Promise<{ id: string }> {
  const res = await fetch(`${PIPELINE_URL}/generate-from-bg-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: input.image,
      prompt: input.prompt || "",
      brand: input.brand || "",
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Failed to start background upload")
  }
  return res.json()
}

export type RerollModel = "blockade" | "openai"

export interface RerollBackgroundInput {
  generationId: string
  prompt: string
  styleId?: number
  negativeText?: string
  highRes?: boolean
  // "blockade" (default) — best quality, correct poles, ~3 min.
  // "openai"   — gpt-image-2 + fal ESRGAN 4x, ~30s, interiors only.
  model?: RerollModel
}

export async function startBackgroundReroll(
  input: RerollBackgroundInput
): Promise<{ job_id: string; new_stem: string }> {
  const res = await fetch(`${PIPELINE_URL}/reroll-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: input.generationId,
      prompt: input.prompt,
      style_id: input.styleId,
      negative_text: input.negativeText,
      high_res: input.highRes ?? false,
      model: input.model ?? "blockade",
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Failed to start background reroll")
  }
  return res.json()
}

export interface VariantPreview {
  id: string
  status: "pending" | "ready" | "failed"
  obfuscated_id?: string | null
  preview_url?: string | null
  error?: string
}

export interface VariantJob {
  job_id: string
  gen_id: string
  prompt: string
  style_id?: number
  negative_text?: string
  high_res: boolean
  status: "running" | "done" | "failed"
  committed_variant_id?: string | null
  commit_status?: "running" | "done" | "failed"
  commit_error?: string
  new_stem?: string
  variants: VariantPreview[]
}

export async function startVariantReroll(input: {
  generationId: string
  prompt: string
  styleId?: number
  negativeText?: string
  highRes?: boolean
  count?: number
}): Promise<{ job_id: string }> {
  const res = await fetch(`${PIPELINE_URL}/reroll-variants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: input.generationId,
      prompt: input.prompt,
      style_id: input.styleId,
      negative_text: input.negativeText,
      high_res: input.highRes ?? false,
      count: input.count ?? 4,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Failed to start variants job")
  }
  return res.json()
}

export async function getVariantJob(jobId: string): Promise<VariantJob> {
  const res = await fetch(`${PIPELINE_URL}/reroll-variants/${jobId}`, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Failed to load variants")
  }
  return res.json()
}

export async function commitVariant(
  jobId: string,
  variantId: string
): Promise<{ ok: boolean; new_stem: string }> {
  const res = await fetch(`${PIPELINE_URL}/reroll-variants/${jobId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant_id: variantId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Failed to commit variant")
  }
  return res.json()
}

export interface RepackInput {
  markers: Array<{
    id: string
    type: string
    yaw: number
    pitch: number
    scene_width?: number
    platform?: string
    tags?: string[]
  }>
  excluded_types?: string[]
  excluded_platforms?: string[]
  excluded_tags?: string[]
  strictness?: number
}

export async function repackMarkers(
  input: RepackInput
): Promise<{ kept: Array<{ id: string; yaw: number; pitch: number }>; removed_ids: string[]; strictness: number }> {
  const res = await fetch(`${PIPELINE_URL}/repack-markers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Failed to repack markers")
  }
  return res.json()
}

export interface UploadAsMarkersInput {
  generationId: string
  images: string[] // data URIs
  currentMarkers: Array<{
    id: string
    type: string
    yaw: number
    pitch: number
    scene_width?: number
  }>
  viewYaw?: number
  viewPitch?: number
  strictness?: number
}

export async function uploadAsMarkers(input: UploadAsMarkersInput): Promise<{
  new_markers: Array<{
    id: string
    type: string
    yaw: number
    pitch: number
    data: { url: string; title: string }
  }>
  repacked_existing: Array<{ id: string; yaw: number; pitch: number }>
}> {
  const res = await fetch(`${PIPELINE_URL}/upload-as-markers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: input.generationId,
      images: input.images,
      current_markers: input.currentMarkers,
      view_yaw: input.viewYaw ?? 0,
      view_pitch: input.viewPitch ?? 0,
      strictness: input.strictness ?? 0.55,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || "Upload-as-markers failed")
  }
  return res.json()
}

export async function checkPipelineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${PIPELINE_URL}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}
