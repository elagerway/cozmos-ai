// Vendor pricing catalog. All prices in USD.
// When a vendor changes rates, update the relevant entry + `lastVerified`.
// Used by lib/cost-tracker.ts to price API calls at log time.

export type UnitType = "tokens" | "megapixels" | "images" | "seconds" | "requests" | "bytes" | "gb_month"

export interface PriceEntry {
  service: string
  operation: string
  model?: string
  unitType: UnitType
  // For token-based services, split into input/output rates (per 1K tokens).
  inputRatePer1k?: number
  outputRatePer1k?: number
  // For per-request services, a flat fee per operation.
  flatPerRequest?: number
  // For per-megapixel / per-second / per-GB services.
  ratePerUnit?: number
  lastVerified: string // ISO date
  notes?: string
}

// ---------- Anthropic Claude ----------
// https://www.anthropic.com/pricing (API)
export const ANTHROPIC_PRICING: Record<string, PriceEntry> = {
  "claude-sonnet-4-20250514": {
    service: "anthropic",
    operation: "messages",
    model: "claude-sonnet-4-20250514",
    unitType: "tokens",
    inputRatePer1k: 0.003,
    outputRatePer1k: 0.015,
    lastVerified: "2026-04-21",
  },
  "claude-sonnet-4-6": {
    service: "anthropic",
    operation: "messages",
    model: "claude-sonnet-4-6",
    unitType: "tokens",
    inputRatePer1k: 0.003,
    outputRatePer1k: 0.015,
    lastVerified: "2026-04-21",
  },
  "claude-opus-4-7": {
    service: "anthropic",
    operation: "messages",
    model: "claude-opus-4-7",
    unitType: "tokens",
    inputRatePer1k: 0.015,
    outputRatePer1k: 0.075,
    lastVerified: "2026-04-21",
  },
  "claude-haiku-4-5-20251001": {
    service: "anthropic",
    operation: "messages",
    model: "claude-haiku-4-5-20251001",
    unitType: "tokens",
    inputRatePer1k: 0.001,
    outputRatePer1k: 0.005,
    lastVerified: "2026-04-21",
  },
}

// ---------- Blockade Labs Skybox ----------
// https://skybox.blockadelabs.com/pricing
// Pricing is credit-based; approximate USD per generation at Pro tier rates.
export const BLOCKADE_PRICING = {
  skybox_generate_8k: {
    service: "blockade_labs",
    operation: "skybox_generate",
    unitType: "requests" as UnitType,
    flatPerRequest: 0.30,
    lastVerified: "2026-04-21",
    notes: "8K base generation (M3 Photoreal). Credit cost ~3 credits, ~$0.30 at Pro rates.",
  },
  skybox_export_16k: {
    service: "blockade_labs",
    operation: "skybox_export",
    unitType: "requests" as UnitType,
    flatPerRequest: 0.15,
    lastVerified: "2026-04-21",
    notes: "16K export via resolution_id=7. ~1.5 credits.",
  },
} satisfies Record<string, PriceEntry>

// ---------- fal.ai ESRGAN ----------
// https://fal.ai/models/fal-ai/esrgan — priced per megapixel of output.
export const FAL_PRICING = {
  esrgan_4x: {
    service: "fal_ai",
    operation: "esrgan_upscale",
    model: "fal-ai/esrgan",
    unitType: "megapixels" as UnitType,
    ratePerUnit: 0.0025,
    lastVerified: "2026-04-21",
    notes: "Priced per output megapixel. 16K sphere = ~130MP → ~$0.33/upscale.",
  },
} satisfies Record<string, PriceEntry>

// ---------- OpenAI ----------
// Not currently used in pipeline; kept for future DALL-E / GPT-Image-1 integration.
export const OPENAI_PRICING: Record<string, PriceEntry> = {
  "dall-e-3-hd": {
    service: "openai",
    operation: "image_generation",
    model: "dall-e-3",
    unitType: "images",
    flatPerRequest: 0.080,
    lastVerified: "2026-04-21",
    notes: "1024x1024 HD.",
  },
  "gpt-image-1": {
    service: "openai",
    operation: "image_generation",
    model: "gpt-image-1",
    unitType: "images",
    flatPerRequest: 0.170,
    lastVerified: "2026-04-21",
    notes: "Per high-quality image (approx).",
  },
}

// ---------- Supabase Storage ----------
// https://supabase.com/pricing — Pro tier: $0.021/GB-month storage, $0.09/GB egress.
export const SUPABASE_PRICING = {
  storage_gb_month: {
    service: "supabase",
    operation: "storage",
    unitType: "gb_month" as UnitType,
    ratePerUnit: 0.021,
    lastVerified: "2026-04-21",
  },
  egress_gb: {
    service: "supabase",
    operation: "egress",
    unitType: "bytes" as UnitType,
    ratePerUnit: 0.09,
    lastVerified: "2026-04-21",
    notes: "$0.09 per GB egress.",
  },
} satisfies Record<string, PriceEntry>

// ---------- YouTube ----------
// Data API v3 is free within 10,000 units/day quota. Thumbnail img.youtube.com is free.
export const YOUTUBE_PRICING: Record<string, PriceEntry> = {
  thumbnail_fetch: {
    service: "youtube",
    operation: "thumbnail_fetch",
    unitType: "requests",
    flatPerRequest: 0,
    lastVerified: "2026-04-21",
    notes: "img.youtube.com CDN fetch — free.",
  },
}

// ---------- Pricing helpers ----------

export function priceAnthropicCall(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const entry = ANTHROPIC_PRICING[model]
  if (!entry || !entry.inputRatePer1k || !entry.outputRatePer1k) {
    console.warn(`[pricing] Unknown Anthropic model: ${model}`)
    return 0
  }
  return (
    (inputTokens / 1000) * entry.inputRatePer1k +
    (outputTokens / 1000) * entry.outputRatePer1k
  )
}

export function priceBlockadeCall(operation: "skybox_generate" | "skybox_export"): number {
  const entry =
    operation === "skybox_generate"
      ? BLOCKADE_PRICING.skybox_generate_8k
      : BLOCKADE_PRICING.skybox_export_16k
  return entry.flatPerRequest ?? 0
}

export function priceFalEsrganCall(outputMegapixels: number): number {
  return (FAL_PRICING.esrgan_4x.ratePerUnit ?? 0) * outputMegapixels
}

export function priceSupabaseStorageGbMonth(gb: number): number {
  return (SUPABASE_PRICING.storage_gb_month.ratePerUnit ?? 0) * gb
}
