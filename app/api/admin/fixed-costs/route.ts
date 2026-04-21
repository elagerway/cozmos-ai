import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

async function requireAdmin(): Promise<boolean> {
  if (!ADMIN_PASSWORD) return false
  const cookieStore = await cookies()
  return cookieStore.get("admin_session")?.value === ADMIN_PASSWORD
}

function getClient() {
  if (!supabaseUrl || !supabaseServiceKey) return null
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = getClient()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const { service, amount_usd, period, started_at, note } = body
  if (!service || typeof amount_usd !== "number" || !["monthly", "yearly"].includes(period)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { data, error } = await sb
    .from("fixed_costs")
    .insert({
      service,
      amount_usd,
      period,
      started_at: started_at ?? new Date().toISOString().slice(0, 10),
      note: note ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ fixed_cost: data })
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sb = getClient()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const { error } = await sb
    .from("fixed_costs")
    .update({ ended_at: new Date().toISOString().slice(0, 10) })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
