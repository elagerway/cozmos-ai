import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Batched event ingest for sphere viewer telemetry.
// Patents practiced: GB '335 / US '706 (event tracking + heatmap).
//
// Browser POST payload:
//   {
//     sphere_id: string,
//     session_id: uuid,
//     events: [
//       { type: "marker_select"|"marker_dwell"|"zoom"|"pan"|..., marker_id?: string, meta?: object },
//       ...
//     ]
//   }
//
// Uses the server-side Supabase client (service key) so the browser never
// needs direct INSERT privilege on sphere_events. The table's RLS policy
// also allows anon/authenticated INSERT as a belt-and-suspenders fallback
// for future direct-client flushes.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

// Hard cap per request to avoid runaway payloads; the client flushes every
// few seconds so 200 events per batch is generous.
const MAX_EVENTS_PER_REQUEST = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_EVENT_TYPES = new Set([
  "marker_select",
  "marker_dwell",
  "marker_hover",
  "zoom",
  "pan",
  "fullscreen",
  "edit_mode_on",
  "edit_mode_off",
  "sphere_open",
  "sphere_close",
])

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { sphere_id, session_id, events } = (body ?? {}) as {
    sphere_id?: unknown
    session_id?: unknown
    events?: unknown
  }

  if (typeof sphere_id !== "string" || !sphere_id || sphere_id.length > 128) {
    return NextResponse.json({ error: "sphere_id required" }, { status: 400 })
  }
  if (typeof session_id !== "string" || !UUID_RE.test(session_id)) {
    return NextResponse.json({ error: "session_id must be a UUID" }, { status: 400 })
  }
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "events must be a non-empty array" }, { status: 400 })
  }
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: `max ${MAX_EVENTS_PER_REQUEST} events per request` }, { status: 400 })
  }

  const rows: Array<{
    sphere_id: string
    event_type: string
    marker_id: string | null
    meta: Record<string, unknown>
    session_id: string
  }> = []
  for (const e of events) {
    if (!e || typeof e !== "object") continue
    const { type, marker_id, meta } = e as {
      type?: unknown
      marker_id?: unknown
      meta?: unknown
    }
    if (typeof type !== "string" || !ALLOWED_EVENT_TYPES.has(type)) continue
    rows.push({
      sphere_id,
      event_type: type,
      marker_id: typeof marker_id === "string" && marker_id.length <= 128 ? marker_id : null,
      meta: meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
      session_id,
    })
  }

  if (!rows.length) {
    return NextResponse.json({ inserted: 0 })
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey)
  const { error } = await sb.from("sphere_events").insert(rows)
  if (error) {
    console.error("sphere_events insert failed:", error.message)
    return NextResponse.json({ error: "Insert failed" }, { status: 500 })
  }

  return NextResponse.json({ inserted: rows.length })
}
