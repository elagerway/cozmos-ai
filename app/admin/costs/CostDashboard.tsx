"use client"

import { useEffect, useMemo, useState } from "react"

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

interface StorageSnapshot {
  bucket: string
  object_count: number
  total_bytes: number
  captured_at: string
}

interface CostsResponse {
  totals: {
    this_month: number
    last_month: number
    projected_month: number
    monthly_fixed: number
    day_of_month: number
    days_in_month: number
  }
  services: ServiceTotal[]
  features: FeatureTotal[]
  models: ModelTotal[]
  daily: DailyPoint[]
  top_generations: TopGeneration[]
  fixed_costs: FixedCost[]
  storage_snapshot: StorageSnapshot | null
  row_count_this_month: number
}

const fmt = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`
const fmtInt = (n: number) => n.toLocaleString()
const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

export function CostDashboard() {
  const [data, setData] = useState<CostsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/costs", { cache: "no-store" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" })
    window.location.reload()
  }

  async function exportCsv() {
    if (!data) return
    const lines = [
      "section,date,service,operation,feature,cost_usd,calls,input,output",
    ]
    for (const d of data.daily) {
      lines.push(`daily,${d.date},,,,${d.cost_usd},,,`)
    }
    for (const s of data.services) {
      lines.push(`service,,,${s.service},,${s.cost_usd},${s.calls},${s.input_tokens ?? ""},${s.output_tokens ?? ""}`)
    }
    for (const f of data.features) {
      lines.push(`feature,,,,${f.feature},${f.cost_usd},${f.calls},,`)
    }
    for (const g of data.top_generations) {
      lines.push(`top_gen,,${g.generation_id},${g.brand ?? ""},,${g.cost_usd},${g.calls},,`)
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `costs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <p className="text-white/60">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white p-8 space-y-4">
        <p className="text-red-400">{error}</p>
        <button onClick={load} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm">
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const { totals } = data
  const delta =
    totals.last_month > 0
      ? ((totals.this_month - totals.last_month) / totals.last_month) * 100
      : null

  const storageGb = data.storage_snapshot
    ? data.storage_snapshot.total_bytes / 1024 ** 3
    : 0
  const storageMonthly = storageGb * 0.021

  const totalMonthlyAllIn =
    totals.projected_month + totals.monthly_fixed + storageMonthly

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl p-8 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Admin · Costs</h1>
            <p className="text-sm text-white/50">
              Usage-based API spend + fixed infrastructure costs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              Export CSV
            </button>
            <button
              onClick={load}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              Refresh
            </button>
            <button
              onClick={logout}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              Log out
            </button>
          </div>
        </header>

        {/* Summary cards */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            label="This month (usage)"
            value={fmt(totals.this_month)}
            hint={`${totals.day_of_month} / ${totals.days_in_month} days in`}
          />
          <SummaryCard
            label="Projected month-end"
            value={fmt(totals.projected_month)}
            hint={
              delta == null
                ? undefined
                : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)}% vs last mo`
            }
            hintClass={
              delta == null ? "" : delta > 0 ? "text-red-400" : "text-emerald-400"
            }
          />
          <SummaryCard
            label="Last month (usage)"
            value={fmt(totals.last_month)}
            hint={`${data.row_count_this_month} API calls this month`}
          />
          <SummaryCard
            label="All-in monthly"
            value={fmt(totalMonthlyAllIn)}
            hint={`${fmt(totals.monthly_fixed)} fixed · ${fmt(storageMonthly)} storage`}
          />
        </section>

        {/* Daily chart */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-sm font-medium text-white/70 mb-4">Daily spend — last 30 days</h2>
          <DailyBarChart data={data.daily} />
        </section>

        {/* Two-column: services + features */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BreakdownCard title="By service (this month)">
            <BreakdownRows
              rows={data.services.map((s) => ({
                label: s.service,
                cost: s.cost_usd,
                sub: `${fmtInt(s.calls)} call${s.calls === 1 ? "" : "s"}${
                  s.input_tokens
                    ? ` · ${fmtInt(s.input_tokens)} in / ${fmtInt(s.output_tokens ?? 0)} out`
                    : ""
                }`,
              }))}
              total={totals.this_month}
            />
          </BreakdownCard>
          <BreakdownCard title="By feature (this month)">
            <BreakdownRows
              rows={data.features.map((f) => ({
                label: f.feature,
                cost: f.cost_usd,
                sub: `${fmtInt(f.calls)} call${f.calls === 1 ? "" : "s"}`,
              }))}
              total={totals.this_month}
            />
          </BreakdownCard>
        </section>

        {/* Models (tokens) */}
        {data.models.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm font-medium text-white/70 mb-4">Claude model usage (this month)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-white/50 uppercase">
                  <tr>
                    <th className="text-left py-2">Model</th>
                    <th className="text-right py-2">Calls</th>
                    <th className="text-right py-2">Input tokens</th>
                    <th className="text-right py-2">Output tokens</th>
                    <th className="text-right py-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.model} className="border-t border-white/5">
                      <td className="py-2 font-mono text-xs">{m.model}</td>
                      <td className="text-right">{fmtInt(m.calls)}</td>
                      <td className="text-right">{fmtInt(m.input_tokens)}</td>
                      <td className="text-right">{fmtInt(m.output_tokens)}</td>
                      <td className="text-right font-medium">{fmt(m.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Top generations */}
        {data.top_generations.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm font-medium text-white/70 mb-4">Top 10 generations this month</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-white/50 uppercase">
                  <tr>
                    <th className="text-left py-2">Generation ID</th>
                    <th className="text-left py-2">Brand</th>
                    <th className="text-right py-2">API calls</th>
                    <th className="text-right py-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_generations.map((g) => (
                    <tr key={g.generation_id} className="border-t border-white/5">
                      <td className="py-2">
                        <a
                          href={`/g/${g.generation_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-blue-300 hover:underline"
                        >
                          {g.generation_id}
                        </a>
                      </td>
                      <td>{g.brand || <span className="text-white/30">—</span>}</td>
                      <td className="text-right">{fmtInt(g.calls)}</td>
                      <td className="text-right font-medium">{fmt(g.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Storage + fixed costs side by side */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <StorageCard snapshot={data.storage_snapshot} storageMonthly={storageMonthly} onChange={load} />

          <FixedCostsCard fixed={data.fixed_costs} onChange={load} />
        </section>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  hintClass = "text-white/50",
}: {
  label: string
  value: string
  hint?: string
  hintClass?: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className={`mt-1 text-xs ${hintClass}`}>{hint}</div>}
    </div>
  )
}

function BreakdownCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-sm font-medium text-white/70 mb-4">{title}</h2>
      {children}
    </div>
  )
}

function BreakdownRows({
  rows,
  total,
}: {
  rows: { label: string; cost: number; sub: string }[]
  total: number
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-white/40">No data yet.</p>
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = total > 0 ? (r.cost / total) * 100 : 0
        return (
          <div key={r.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <div className="font-medium">{r.label}</div>
              <div className="tabular-nums">{fmt(r.cost)}</div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-blue-400/60"
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <div className="text-xs text-white/40">{r.sub}</div>
          </div>
        )
      })}
    </div>
  )
}

function Row({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex justify-between">
      <span className="text-white/50">{label}</span>
      <span className={muted ? "text-white/40" : "font-medium"}>{value}</span>
    </div>
  )
}

function StorageCard({
  snapshot,
  storageMonthly,
  onChange,
}: {
  snapshot: StorageSnapshot | null
  storageMonthly: number
  onChange: () => void
}) {
  const [capturing, setCapturing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function capture() {
    setCapturing(true)
    setErr(null)
    try {
      const res = await fetch("/api/admin/storage-snapshot", { method: "POST" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed")
      onChange()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed")
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-white/70">Supabase storage</h2>
        <button
          onClick={capture}
          disabled={capturing}
          className="text-xs text-blue-300 hover:text-blue-200 disabled:opacity-50"
        >
          {capturing ? "Capturing…" : "Capture snapshot"}
        </button>
      </div>
      {snapshot ? (
        <div className="space-y-2 text-sm">
          <Row label="Bucket" value={snapshot.bucket} />
          <Row label="Objects" value={fmtInt(snapshot.object_count)} />
          <Row label="Size" value={fmtBytes(snapshot.total_bytes)} />
          <Row label="Monthly (storage)" value={fmt(storageMonthly)} />
          <Row
            label="Captured"
            value={new Date(snapshot.captured_at).toLocaleString()}
            muted
          />
        </div>
      ) : (
        <p className="text-sm text-white/50">
          No snapshot yet — click &ldquo;Capture snapshot&rdquo; to measure storage now.
        </p>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  )
}

function FixedCostsCard({ fixed, onChange }: { fixed: FixedCost[]; onChange: () => void }) {
  const [service, setService] = useState("")
  const [amount, setAmount] = useState("")
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly")
  const [note, setNote] = useState("")
  const [adding, setAdding] = useState(false)

  async function add() {
    if (!service || !amount) return
    setAdding(true)
    try {
      await fetch("/api/admin/fixed-costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service,
          amount_usd: Number(amount),
          period,
          note: note || null,
        }),
      })
      setService("")
      setAmount("")
      setNote("")
      onChange()
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    if (!confirm("End this fixed cost?")) return
    await fetch(`/api/admin/fixed-costs?id=${id}`, { method: "DELETE" })
    onChange()
  }

  const total = useMemo(
    () => fixed.reduce((s, f) => s + f.monthly_equivalent, 0),
    [fixed]
  )

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-white/70">Fixed costs</h2>
        <span className="text-xs text-white/50">{fmt(total)} / mo</span>
      </div>

      <div className="space-y-2 text-sm">
        {fixed.length === 0 && (
          <p className="text-white/40">No fixed costs tracked. Add one below.</p>
        )}
        {fixed.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{f.service}</div>
              <div className="text-xs text-white/50">
                {fmt(f.amount_usd)} / {f.period} · since {f.started_at}
                {f.note ? ` · ${f.note}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-white/50">{fmt(f.monthly_equivalent)}/mo</div>
            </div>
            <button
              onClick={() => remove(f.id)}
              className="text-xs text-white/40 hover:text-red-400"
            >
              End
            </button>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-white/10 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="Service (e.g. Vercel Pro)"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm outline-none focus:border-blue-400"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount USD"
            type="number"
            step="0.01"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as "monthly" | "yearly")}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm outline-none focus:border-blue-400"
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>
        <button
          onClick={add}
          disabled={adding || !service || !amount}
          className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add fixed cost"}
        </button>
      </div>
    </div>
  )
}

function DailyBarChart({ data }: { data: DailyPoint[] }) {
  const max = Math.max(0.01, ...data.map((d) => d.cost_usd))
  const width = 900
  const height = 180
  const barWidth = width / data.length - 2
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-48 min-w-[900px]"
      >
        {data.map((d, i) => {
          const h = (d.cost_usd / max) * (height - 30)
          const x = i * (barWidth + 2)
          const y = height - h - 20
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                className="fill-blue-400/70"
              >
                <title>
                  {d.date} — ${d.cost_usd.toFixed(4)}
                </title>
              </rect>
              {i % 5 === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-white/40 text-[10px]"
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
        <line
          x1={0}
          x2={width}
          y1={height - 20}
          y2={height - 20}
          className="stroke-white/10"
          strokeWidth={1}
        />
      </svg>
    </div>
  )
}
