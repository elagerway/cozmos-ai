"use client"

import { useEffect, useRef, useState } from "react"

type MarkerDef = {
  type: "video" | "image" | "audio" | "bio-links" | "profile"
  yaw: number
  pitch: number
  data: any
}

type BioLink = { emoji: string; title: string; url: string }

type TabKey = "image" | "video" | "audio" | "bio-links"

interface Props {
  onClose: () => void
  onAdd: (builder: (yawDeg: number, pitchDeg: number) => MarkerDef) => void | Promise<void>
}

function parseVideoUrl(url: string): { platform: "youtube" | "vimeo"; id: string } | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (yt) return { platform: "youtube", id: yt[1] }
  const v = url.match(/(?:vimeo\.com\/(?:video\/|channels\/[\w]+\/|groups\/[\w]+\/videos\/)?|player\.vimeo\.com\/video\/)(\d+)/)
  if (v) return { platform: "vimeo", id: v[1] }
  return null
}

async function fetchVideoMeta(url: string, platform: "youtube" | "vimeo"): Promise<{ title: string; thumbnail: string } | null> {
  try {
    const oembed =
      platform === "vimeo"
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
        : `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    const res = await fetch(oembed)
    if (!res.ok) return null
    const json: any = await res.json()
    return { title: json.title || "", thumbnail: json.thumbnail_url || "" }
  } catch {
    return null
  }
}

export function AddMarkerModal({ onClose, onAdd }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<TabKey>("image")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Attach NATIVE event listeners to block PSV from receiving pointer/key
  // events that bubble through the modal. React's synthetic event system
  // delegates at the React root — by then PSV has already fired its own
  // listeners attached at .psv-container and window. Native listeners on
  // the backdrop fire during the real bubble phase and can actually stop it.
  useEffect(() => {
    const el = backdropRef.current
    if (!el) return
    const stop = (e: Event) => {
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    // NOTE: "click" intentionally omitted — React's onClick={onClose} on the
    // backdrop needs the click to bubble to the React root to fire.
    // PSV only reacts to mousedown/up/move/wheel/keys, not click, so this is safe.
    const events = ["mousedown", "mouseup", "mousemove", "pointerdown", "pointerup", "pointermove", "wheel", "touchstart", "touchmove", "touchend", "keydown", "keyup"]
    for (const ev of events) el.addEventListener(ev, stop)
    return () => {
      for (const ev of events) el.removeEventListener(ev, stop)
    }
  }, [])

  // Image
  const [imageUrl, setImageUrl] = useState("")

  // Video
  const [videoUrl, setVideoUrl] = useState("")

  // Audio
  const [audioUrl, setAudioUrl] = useState("")
  const [audioTitle, setAudioTitle] = useState("")
  const [audioArtist, setAudioArtist] = useState("")

  // Bio links
  const [linksTitle, setLinksTitle] = useState("Links")
  const [links, setLinks] = useState<BioLink[]>([{ emoji: "🔗", title: "", url: "" }])

  async function handleAdd() {
    setError(null)
    setSubmitting(true)
    try {
      if (tab === "image") {
        const url = imageUrl.trim()
        if (!url) throw new Error("Image URL required")
        await onAdd((yaw, pitch) => ({
          type: "image",
          yaw,
          pitch,
          data: { image_url: url, source: "user" },
        }))
      } else if (tab === "video") {
        const url = videoUrl.trim()
        const parsed = parseVideoUrl(url)
        if (!parsed) throw new Error("Paste a YouTube or Vimeo URL")
        const meta = await fetchVideoMeta(url, parsed.platform)
        await onAdd((yaw, pitch) => ({
          type: "video",
          yaw,
          pitch,
          data: {
            video_id: parsed.id,
            title: meta?.title || url,
            thumbnail_url: meta?.thumbnail || (parsed.platform === "youtube" ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg` : ""),
            view_count: "",
            url,
            platform: parsed.platform,
          },
        }))
      } else if (tab === "audio") {
        const url = audioUrl.trim()
        if (!url) throw new Error("Audio URL required")
        await onAdd((yaw, pitch) => ({
          type: "audio",
          yaw,
          pitch,
          data: { url, title: audioTitle.trim() || "Audio", artist: audioArtist.trim() },
        }))
      } else {
        const cleaned = links.filter((l) => l.url.trim()).map((l) => ({
          emoji: l.emoji.trim() || "🔗",
          title: l.title.trim() || l.url.trim(),
          url: l.url.trim(),
        }))
        if (!cleaned.length) throw new Error("Add at least one link")
        await onAdd((yaw, pitch) => ({
          type: "bio-links",
          yaw,
          pitch,
          data: { title: linksTitle.trim() || "Links", links: cleaned },
        }))
      }
    } catch (e: any) {
      setError(e.message || "Failed to add")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onKeyPress={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 92%)", maxHeight: "88%",
          background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 14, color: "white",
          fontFamily: "Inter, system-ui, sans-serif",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Add to sphere</div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "rgba(255,255,255,0.5)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {(["image", "video", "audio", "bio-links"] as TabKey[]).map((k) => (
            <button
              key={k}
              onClick={() => { setTab(k); setError(null) }}
              style={{
                padding: "6px 12px", fontSize: 12, borderRadius: 8, cursor: "pointer",
                border: "1px solid " + (tab === k ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)"),
                background: tab === k ? "rgba(59,130,246,0.2)" : "transparent",
                color: tab === k ? "rgba(147,197,253,1)" : "rgba(255,255,255,0.6)",
              }}
            >
              {k === "bio-links" ? "Bio links" : k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ padding: "16px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {tab === "image" && (
            <>
              <label style={labelStyle}>Image URL</label>
              <input style={inputStyle} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/photo.jpg" />
              <p style={hintStyle}>Paste any publicly accessible image URL.</p>
            </>
          )}

          {tab === "video" && (
            <>
              <label style={labelStyle}>YouTube or Vimeo URL</label>
              <input style={inputStyle} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=… or https://vimeo.com/…" />
              <p style={hintStyle}>We'll fetch the thumbnail and title automatically.</p>
            </>
          )}

          {tab === "audio" && (
            <>
              <label style={labelStyle}>Audio URL (.mp3, .m4a, .wav)</label>
              <input style={inputStyle} value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="https://…/track.mp3" />
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={audioTitle} onChange={(e) => setAudioTitle(e.target.value)} placeholder="My track" />
              <label style={labelStyle}>Artist (optional)</label>
              <input style={inputStyle} value={audioArtist} onChange={(e) => setAudioArtist(e.target.value)} placeholder="Artist name" />
            </>
          )}

          {tab === "bio-links" && (
            <>
              <label style={labelStyle}>Card title</label>
              <input style={inputStyle} value={linksTitle} onChange={(e) => setLinksTitle(e.target.value)} placeholder="Links" />
              <label style={{ ...labelStyle, marginTop: 4 }}>Links</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {links.map((l, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr 1fr 28px", gap: 6 }}>
                    <input
                      style={{ ...inputStyle, textAlign: "center", fontSize: 16 }}
                      value={l.emoji}
                      maxLength={4}
                      onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)))}
                    />
                    <input
                      style={inputStyle}
                      value={l.title}
                      placeholder="Title"
                      onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    />
                    <input
                      style={inputStyle}
                      value={l.url}
                      placeholder="https://…"
                      onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    />
                    <button
                      onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                      disabled={links.length === 1}
                      style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "rgba(255,255,255,0.5)", cursor: links.length === 1 ? "default" : "pointer" }}
                    >×</button>
                  </div>
                ))}
                <button
                  onClick={() => setLinks((prev) => [...prev, { emoji: "🔗", title: "", url: "" }])}
                  style={{ alignSelf: "flex-start", padding: "6px 10px", fontSize: 12, background: "transparent", border: "1px dashed rgba(255,255,255,0.2)", borderRadius: 6, color: "rgba(255,255,255,0.7)", cursor: "pointer" }}
                >+ Add link</button>
              </div>
              <p style={hintStyle}>Tip: press <code>⌃⌘Space</code> in any emoji field to open macOS emoji picker.</p>
            </>
          )}

          {error && <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 4 }}>{error}</div>}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 14px", fontSize: 12, borderRadius: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}
          >Cancel</button>
          <button
            onClick={handleAdd}
            disabled={submitting}
            style={{ padding: "8px 14px", fontSize: 12, borderRadius: 8, background: "rgba(34,197,94,0.8)", border: "1px solid rgba(34,197,94,0.5)", color: "white", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}
          >{submitting ? "Adding…" : "Add to sphere"}</button>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }
const inputStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 13, borderRadius: 6,
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  color: "white", outline: "none",
}
const hintStyle: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "4px 0 0 0" }
