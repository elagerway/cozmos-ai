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
}

export async function startGeneration(
  brand: string,
  prompt: string,
  url?: string
): Promise<{ id: string }> {
  const res = await fetch(`${PIPELINE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand, prompt, url: url || "" }),
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

export async function checkPipelineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${PIPELINE_URL}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}
