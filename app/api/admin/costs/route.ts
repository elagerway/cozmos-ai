import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

interface DailyPoint {
  date: string
  cost_usd: number
}

interface ServiceTotal {
  service: string
  cost_usd: number
  calls: number
  input_tokens?: number
  output_tokens?: number
}

interface FeatureTotal {
  feature: string
  cost_usd: number
  calls: number
}

interface ModelTotal {
  model: string
  cost_usd: number
  calls: number
  input_tokens: number
  output_tokens: number
}

interface TopGeneration {
  generation_id: string
  brand: string | null
  cost_usd: number
  calls: number
}

interface FixedCost {
  id: string
  service: string
  amount_usd: number
  period: "monthly" | "yearly"
  started_at: string
  ended_at: string | null
  note: string | null
  monthly_equivalent: number
}

export async function GET(_req: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
  }
  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ error: "ADMIN_PASSWORD not configured" }, { status: 500 })
  }

  const cookieStore = await cookies()
  const token = cookieStore.get("admin_session")?.value
  if (token !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = new Date()
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const endOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const { data: rows, error } = await sb
    .from("api_costs")
    .select("*")
    .gte("created_at", startOfLastMonth.toISOString())
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const all = rows ?? []

  const thisMonthRows = all.filter((r) => new Date(r.created_at) >= startOfMonth)
  const lastMonthRows = all.filter((r) => {
    const d = new Date(r.created_at)
    return d >= startOfLastMonth && d < endOfLastMonth
  })
  const last30Rows = all.filter((r) => new Date(r.created_at) >= thirtyDaysAgo)

  const sum = (rs: typeof all) => rs.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
  const thisMonthTotal = sum(thisMonthRows)
  const lastMonthTotal = sum(lastMonthRows)

  const dayOfMonth = now.getUTCDate()
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  ).getUTCDate()
  const projectedMonthTotal = dayOfMonth > 0 ? (thisMonthTotal / dayOfMonth) * daysInMonth : 0

  // Service breakdown (this month)
  const serviceMap = new Map<string, ServiceTotal>()
  for (const r of thisMonthRows) {
    const key = r.service
    const existing: ServiceTotal = serviceMap.get(key) ?? { service: key, cost_usd: 0, calls: 0 }
    existing.cost_usd += Number(r.cost_usd || 0)
    existing.calls += 1
    if (r.unit_type === "tokens") {
      existing.input_tokens = (existing.input_tokens ?? 0) + Number(r.input_units || 0)
      existing.output_tokens = (existing.output_tokens ?? 0) + Number(r.output_units || 0)
    }
    serviceMap.set(key, existing)
  }

  // Feature breakdown (this month)
  const featureMap = new Map<string, FeatureTotal>()
  for (const r of thisMonthRows) {
    const key = r.feature ?? "other"
    const existing = featureMap.get(key) ?? { feature: key, cost_usd: 0, calls: 0 }
    existing.cost_usd += Number(r.cost_usd || 0)
    existing.calls += 1
    featureMap.set(key, existing)
  }

  // Model breakdown (this month, tokens only)
  const modelMap = new Map<string, ModelTotal>()
  for (const r of thisMonthRows) {
    if (r.unit_type !== "tokens" || !r.model) continue
    const existing = modelMap.get(r.model) ?? {
      model: r.model,
      cost_usd: 0,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
    }
    existing.cost_usd += Number(r.cost_usd || 0)
    existing.calls += 1
    existing.input_tokens += Number(r.input_units || 0)
    existing.output_tokens += Number(r.output_units || 0)
    modelMap.set(r.model, existing)
  }

  // Daily series (30 days)
  const dailyMap = new Map<string, number>()
  for (const r of last30Rows) {
    const d = new Date(r.created_at).toISOString().slice(0, 10)
    dailyMap.set(d, (dailyMap.get(d) ?? 0) + Number(r.cost_usd || 0))
  }
  const daily: DailyPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    daily.push({ date: key, cost_usd: dailyMap.get(key) ?? 0 })
  }

  // Top generations (this month)
  const genMap = new Map<string, { cost: number; calls: number }>()
  for (const r of thisMonthRows) {
    if (!r.generation_id) continue
    const existing = genMap.get(r.generation_id) ?? { cost: 0, calls: 0 }
    existing.cost += Number(r.cost_usd || 0)
    existing.calls += 1
    genMap.set(r.generation_id, existing)
  }
  const topGenIds = [...genMap.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)

  let topGenerations: TopGeneration[] = []
  if (topGenIds.length) {
    const { data: gens } = await sb
      .from("generations")
      .select("id, brand")
      .in(
        "id",
        topGenIds.map(([id]) => id)
      )
    const brandMap = new Map<string, string | null>(
      (gens ?? []).map((g) => [g.id, g.brand])
    )
    topGenerations = topGenIds.map(([id, v]) => ({
      generation_id: id,
      brand: brandMap.get(id) ?? null,
      cost_usd: v.cost,
      calls: v.calls,
    }))
  }

  // Fixed costs
  const { data: fixedRows } = await sb
    .from("fixed_costs")
    .select("*")
    .is("ended_at", null)
    .order("amount_usd", { ascending: false })

  const fixed: FixedCost[] = (fixedRows ?? []).map((r) => ({
    id: r.id,
    service: r.service,
    amount_usd: Number(r.amount_usd),
    period: r.period,
    started_at: r.started_at,
    ended_at: r.ended_at,
    note: r.note,
    monthly_equivalent:
      r.period === "yearly" ? Number(r.amount_usd) / 12 : Number(r.amount_usd),
  }))

  const monthlyFixed = fixed.reduce((s, r) => s + r.monthly_equivalent, 0)

  // Storage snapshot (most recent)
  const { data: storageRows } = await sb
    .from("storage_snapshots")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(1)
  const storageSnapshot = storageRows?.[0] ?? null

  return NextResponse.json({
    totals: {
      this_month: thisMonthTotal,
      last_month: lastMonthTotal,
      projected_month: projectedMonthTotal,
      monthly_fixed: monthlyFixed,
      day_of_month: dayOfMonth,
      days_in_month: daysInMonth,
    },
    services: [...serviceMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    features: [...featureMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    models: [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    daily,
    top_generations: topGenerations,
    fixed_costs: fixed,
    storage_snapshot: storageSnapshot,
    row_count_this_month: thisMonthRows.length,
  })
}
