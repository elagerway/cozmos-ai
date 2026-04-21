import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Aggregated marker stats for a sphere — drives heatmap overlay + top-viewed
// badges. Patents: GB '335 / US '706 (event tracking → heatmap visualisation).
//
// GET /api/events/summary?sphere_id=<id>&days=7
//   → {
//       markers: {
//         "<marker_id>": { selects: N, dwell_ms: N, dwell_rank: 0, select_rank: 0 }
//       },
//       total_sessions: N,
//       window_days: N
//     }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

export async function GET(req: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }

  const sphereId = req.nextUrl.searchParams.get("sphere_id")?.trim()
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7)))

  if (!sphereId || sphereId.length > 128) {
    return NextResponse.json({ error: "sphere_id required" }, { status: 400 })
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey)
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

  const { data, error } = await sb
    .from("sphere_events")
    .select("event_type, marker_id, meta, session_id")
    .eq("sphere_id", sphereId)
    .gte("created_at", since)

  if (error) {
    console.error("sphere_events summary query failed:", error.message)
    return NextResponse.json({ error: "query failed" }, { status: 500 })
  }

  const byMarker: Record<string, { selects: number; dwell_ms: number }> = {}
  const sessions = new Set<string>()
  for (const row of data || []) {
    if (row.session_id) sessions.add(row.session_id)
    const id = row.marker_id
    if (!id) continue
    if (!byMarker[id]) byMarker[id] = { selects: 0, dwell_ms: 0 }
    if (row.event_type === "marker_select") {
      byMarker[id].selects += 1
    } else if (row.event_type === "marker_dwell") {
      const d = (row.meta as Record<string, unknown> | null)?.duration_ms
      if (typeof d === "number" && d > 0) byMarker[id].dwell_ms += d
    }
  }

  // Rank markers by dwell and by selects (0 = most, ascending).
  const ids = Object.keys(byMarker)
  const byDwell = [...ids].sort((a, b) => byMarker[b].dwell_ms - byMarker[a].dwell_ms)
  const bySelect = [...ids].sort((a, b) => byMarker[b].selects - byMarker[a].selects)

  const markers: Record<
    string,
    { selects: number; dwell_ms: number; dwell_rank: number; select_rank: number }
  > = {}
  for (const id of ids) {
    markers[id] = {
      ...byMarker[id],
      dwell_rank: byDwell.indexOf(id),
      select_rank: bySelect.indexOf(id),
    }
  }

  return NextResponse.json(
    {
      markers,
      total_sessions: sessions.size,
      window_days: days,
    },
    { headers: { "Cache-Control": "public, max-age=30" } },
  )
}
