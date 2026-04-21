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

export interface RerollBackgroundInput {
  generationId: string
  prompt: string
  styleId?: number
  negativeText?: string
  highRes?: boolean
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

export async function checkPipelineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${PIPELINE_URL}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}
