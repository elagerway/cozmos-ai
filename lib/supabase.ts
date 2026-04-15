import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export interface GenerationRow {
  id: string
  brand: string | null
  prompt: string
  status: string
  step: string | null
  step_label: string | null
  image_url: string | null
  tile_stem: string | null
  tile_base_url: string | null
  error: string | null
  cost_usd: number | null
  duration_s: number | null
  image_count: number | null
  environment: string | null
  featured: boolean
  created_at: string
  updated_at: string
}

export async function fetchGenerations(): Promise<GenerationRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from("generations")
    .select("*")
    .eq("status", "done")
    .order("created_at", { ascending: false })
  if (error) {
    console.error("Failed to fetch generations:", error)
    return []
  }
  return data || []
}
