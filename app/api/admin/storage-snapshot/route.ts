import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const BUCKET = "spheres"

// Recursively walks the bucket tallying object count + total bytes, then writes
// a storage_snapshots row. Supabase storage.list() is paginated, so this may
// take a few seconds for a large bucket.
async function walkBucket(
  sb: ReturnType<typeof createClient>,
  prefix: string,
  counters: { objects: number; bytes: number }
): Promise<void> {
  let offset = 0
  const limit = 1000
  while (true) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    })
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const entry of data) {
      // Folders come back with id === null on the Supabase client.
      if (entry.id === null) {
        await walkBucket(sb, prefix ? `${prefix}/${entry.name}` : entry.name, counters)
      } else {
        counters.objects += 1
        const size = (entry.metadata as { size?: number } | null)?.size ?? 0
        counters.bytes += size
      }
    }
    if (data.length < limit) break
    offset += limit
  }
}

export async function POST() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
  }
  if (!ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Admin not configured" }, { status: 500 })
  }
  const cookieStore = await cookies()
  if (cookieStore.get("admin_session")?.value !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const counters = { objects: 0, bytes: 0 }
  try {
    await walkBucket(sb, "", counters)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "walk failed" },
      { status: 500 }
    )
  }

  const { error: insertErr } = await sb.from("storage_snapshots").insert({
    bucket: BUCKET,
    object_count: counters.objects,
    total_bytes: counters.bytes,
  })
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    bucket: BUCKET,
    object_count: counters.objects,
    total_bytes: counters.bytes,
  })
}
