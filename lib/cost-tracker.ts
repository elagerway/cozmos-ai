// Server-side cost logger. Writes to api_costs table via Supabase service key.
// Never import into client components — this uses the service role.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  priceAnthropicCall,
  priceBlockadeCall,
  priceFalEsrganCall,
} from "./pricing"

export type Feature =
  | "initial_gen"
  | "bg_reroll"
  | "variants_preview"
  | "copilot"
  | "scene_analysis"
  | "other"

interface BaseLogInput {
  generationId?: string | null
  sessionId?: string | null
  feature?: Feature
  metadata?: Record<string, unknown>
}

let cachedClient: SupabaseClient | null = null

function getServiceClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.warn("[cost-tracker] SUPABASE_SERVICE_KEY missing — costs will not be logged")
    return null
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedClient
}

async function insertCostRow(row: {
  service: string
  operation: string
  model?: string | null
  input_units?: number | null
  output_units?: number | null
  unit_type?: string | null
  cost_usd: number
  generation_id?: string | null
  session_id?: string | null
  feature?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const client = getServiceClient()
  if (!client) return
  const { error } = await client.from("api_costs").insert(row)
  if (error) {
    // Never let cost logging break the app — just warn.
    console.error("[cost-tracker] insert failed:", error.message)
  }
}

// ---------- Public logging API ----------

export async function logAnthropicCall(
  args: BaseLogInput & {
    model: string
    inputTokens: number
    outputTokens: number
    operation?: string
  }
): Promise<number> {
  const cost = priceAnthropicCall(args.model, args.inputTokens, args.outputTokens)
  await insertCostRow({
    service: "anthropic",
    operation: args.operation ?? "messages",
    model: args.model,
    input_units: args.inputTokens,
    output_units: args.outputTokens,
    unit_type: "tokens",
    cost_usd: cost,
    generation_id: args.generationId ?? null,
    session_id: args.sessionId ?? null,
    feature: args.feature ?? "other",
    metadata: args.metadata ?? {},
  })
  return cost
}

export async function logBlockadeCall(
  args: BaseLogInput & {
    operation: "skybox_generate" | "skybox_export"
    prompt?: string
    styleId?: number
  }
): Promise<number> {
  const cost = priceBlockadeCall(args.operation)
  await insertCostRow({
    service: "blockade_labs",
    operation: args.operation,
    unit_type: "requests",
    input_units: 1,
    cost_usd: cost,
    generation_id: args.generationId ?? null,
    session_id: args.sessionId ?? null,
    feature: args.feature ?? "initial_gen",
    metadata: {
      prompt: args.prompt,
      style_id: args.styleId,
      ...(args.metadata ?? {}),
    },
  })
  return cost
}

export async function logFalEsrganCall(
  args: BaseLogInput & { outputMegapixels: number; imageKind?: string }
): Promise<number> {
  const cost = priceFalEsrganCall(args.outputMegapixels)
  await insertCostRow({
    service: "fal_ai",
    operation: "esrgan_upscale",
    model: "fal-ai/esrgan",
    input_units: args.outputMegapixels,
    unit_type: "megapixels",
    cost_usd: cost,
    generation_id: args.generationId ?? null,
    session_id: args.sessionId ?? null,
    feature: args.feature ?? "initial_gen",
    metadata: { image_kind: args.imageKind, ...(args.metadata ?? {}) },
  })
  return cost
}

export async function logFreeCall(
  args: BaseLogInput & {
    service: string
    operation: string
    unitType?: string
    units?: number
  }
): Promise<void> {
  await insertCostRow({
    service: args.service,
    operation: args.operation,
    input_units: args.units ?? 1,
    unit_type: args.unitType ?? "requests",
    cost_usd: 0,
    generation_id: args.generationId ?? null,
    session_id: args.sessionId ?? null,
    feature: args.feature ?? "other",
    metadata: args.metadata ?? {},
  })
}
