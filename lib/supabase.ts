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
  high_res: boolean
  created_at: string
  updated_at: string
}

export async function deleteGeneration(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from("generations")
    .delete()
    .eq("id", id)
  if (error) {
    console.error("Failed to delete generation:", error)
    return false
  }
  return true
}

export async function fetchGenerations(includeRunning: boolean = false): Promise<GenerationRow[]> {
  if (!supabase) return []
  let query = supabase
    .from("generations")
    .select("*")
    .order("created_at", { ascending: false })

  if (includeRunning) {
    query = query.in("status", ["done", "running"])
  } else {
    query = query.eq("status", "done")
  }

  const { data, error } = await query
  if (error) {
    console.error("Failed to fetch generations:", error)
    return []
  }
  return data || []
}
