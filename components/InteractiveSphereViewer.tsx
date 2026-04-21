"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import "@photo-sphere-viewer/core/index.css"
import "@photo-sphere-viewer/markers-plugin/index.css"
import { AddMarkerModal } from "./AddMarkerModal"
import { RerollBackgroundModal } from "./RerollBackgroundModal"
import { CopilotPanel, type CopilotActions } from "./CopilotPanel"
import { startBackgroundReroll, startVariantReroll } from "@/lib/pipeline-client"
import { attachAntiDistortionRig } from "@/lib/viewer-camera"
import { useEventTracker } from "@/lib/event-tracker"

interface VideoMarkerData {
  video_id: string
  title: string
  thumbnail_url: string
  view_count: string
  url: string
  platform?: "youtube" | "vimeo"
}

interface ProfileMarkerData {
  name: string
  handle: string
  bio: string
  profile_image: string
  subscriber_count: string
  twitter_handle: string
  channel_url: string
}

interface AudioMarkerData {
  url: string
  title: string
  artist?: string
  cover_url?: string
}

interface BioLink {
  emoji: string
  title: string
  url: string
}

interface BioLinksMarkerData {
  title: string
  links: BioLink[]
}

interface MarkerDef {
  type: "video" | "profile" | "image" | "audio" | "bio-links"
  yaw: number
  pitch: number
  scene_width?: number     // designed base width used to render HTML
  scene_scale?: number     // user-applied uniform scale multiplier (1 = default)
  data: VideoMarkerData | ProfileMarkerData | AudioMarkerData | BioLinksMarkerData | any
}

interface Props {
  imageUrl: string
  tileStem?: string | null
  tileBaseUrl?: string | null
  markers?: MarkerDef[]
  onMarkersChanged?: (markers: MarkerDef[]) => void | Promise<void>
  // Sphere ID for event telemetry (patents GB '335 / US '706). When set,
  // user interactions are batched-posted to /api/events for heatmap building
  // and data-driven regeneration (GB '934 / WO '623).
  sphereId?: string | null
}

// Tile pyramid — must match what the pipeline actually generated.
// With `high_res=false` (default, the Ultra HD checkbox off) the pipeline
// skips the 16K tier; requesting those non-existent tiles from PSV shows
// red warning triangles on zoom. Keep this in sync with pipeline/server.py
// generate_tiles() — currently LEVELS[:3] for non-high_res.
const LEVELS = [
  { width: 2048, cols: 2, rows: 1 },
  { width: 4096, cols: 4, rows: 2 },
  { width: 8192, cols: 8, rows: 4 },
]

// Escape helpers — marker HTML goes straight into PSV's innerHTML, so every
// string interpolated from scraped/user input must pass through these to
// prevent XSS via `<script>`, quote breakouts, or `javascript:` URIs.
function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
}
function safeUrl(u: unknown): string {
  const raw = String(u ?? "").trim()
  return /^(https?:|\/|#)/i.test(raw) ? escapeHtml(raw) : "#"
}

function ProfileCardHTML(data: ProfileMarkerData, width: number = 320): string {
  // Wall-mounted display panel — sharp, solid, like a kiosk in the room
  const name = escapeHtml(data.name)
  const handle = escapeHtml(data.handle)
  const bio = escapeHtml((data.bio || "").slice(0, 160))
  const bioDots = (data.bio || "").length > 160 ? "..." : ""
  const subs = escapeHtml(data.subscriber_count)
  const tw = escapeHtml(data.twitter_handle)
  const ig = escapeHtml((data as any).instagram_handle)
  const tt = escapeHtml((data as any).tiktok_handle)
  return `
    <div style="
      background: linear-gradient(180deg, #0d0d0d 0%, #151515 100%);
      border: 1px solid rgba(255,255,255,0.06);
      border-left: 4px solid rgba(59,130,246,0.6);
      border-radius: 4px;
      padding: 28px 28px 24px;
      width: ${width}px;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      cursor: default;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
    ">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        ${data.profile_image ? `<img src="${safeUrl(data.profile_image)}" style="width:80px;height:80px;border-radius:8px;border:2px solid rgba(255,255,255,0.1);object-fit:cover;" />` : ""}
        <div>
          <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;">${name}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.35);margin-top:3px;">${handle}</div>
        </div>
      </div>
      ${bio ? `<p style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;margin:0 0 16px 0;">${bio}${bioDots}</p>` : ""}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${subs ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(255,0,0,0.12);font-size:11px;color:rgba(255,100,100,0.9);">YT ${subs}</span>` : ""}
        ${ig ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(225,48,108,0.12);font-size:11px;color:rgba(225,130,170,0.9);">IG @${ig}</span>` : ""}
        ${tw ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(29,155,240,0.12);font-size:11px;color:rgba(100,180,240,0.9);">X @${tw}</span>` : ""}
        ${tt ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(0,242,234,0.08);font-size:11px;color:rgba(100,242,234,0.9);">TT @${tt}</span>` : ""}
      </div>
      ${data.channel_url ? `<a href="${safeUrl(data.channel_url)}" target="_blank" rel="noopener" style="
        display:inline-block;padding:10px 24px;
        background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);
        border-radius:4px;
        color:white;font-size:13px;font-weight:600;text-decoration:none;
      ">Visit Channel</a>` : ""}
    </div>
  `
}

function VideoThumbnailHTML(data: VideoMarkerData, width: number = 360): string {
  // Wall-mounted TV — thick bezel, screen glow, realistic proportions
  const videoId = escapeHtml(data.video_id)
  const title = escapeHtml(data.title)
  const viewCount = escapeHtml(data.view_count)
  return `
    <div data-video-id="${videoId}" data-mode="thumbnail" style="
      background: #080808;
      border: 12px solid #111;
      border-bottom: 18px solid #111;
      border-radius: 6px;
      width: ${width}px;
      overflow: hidden;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 15px 40px rgba(0,0,0,0.9);
    ">
      <div style="position:relative;box-shadow:inset 0 0 30px rgba(100,150,255,0.06);">
        <img src="${safeUrl(data.thumbnail_url)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.15);">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(255,0,0,0.85);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 25px rgba(255,0,0,0.5);transition:transform 0.2s;"
               onmouseenter="this.style.transform='scale(1.15)'" onmouseleave="this.style.transform='scale(1)'">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <div style="padding:10px 14px;background:#0a0a0a;">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
        ${viewCount ? `<div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:3px;">${viewCount}</div>` : ""}
      </div>
    </div>
  `
}

function VideoPlayingHTML(data: VideoMarkerData, width: number = 360): string {
  // TV screen with YouTube or Vimeo iframe — same bezel styling, seamless transition
  // Only allow video IDs that match the platform's expected format — defense-in-depth
  // against crafted IDs that could break out of the src attribute.
  const ytId = /^[A-Za-z0-9_-]{11}$/.test(data.video_id || "") ? data.video_id : ""
  const vimeoId = /^\d+$/.test(data.video_id || "") ? data.video_id : ""
  const embedSrc = data.platform === "vimeo"
    ? `https://player.vimeo.com/video/${vimeoId}?autoplay=1&title=0&byline=0&portrait=0`
    : `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`
  const videoId = escapeHtml(data.video_id)
  const title = escapeHtml(data.title)
  return `
    <div data-video-id="${videoId}" data-mode="playing" style="
      background: #000;
      border: 12px solid #111;
      border-bottom: 18px solid #111;
      border-radius: 6px;
      width: ${width}px;
      overflow: hidden;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      box-shadow: 0 15px 40px rgba(0,0,0,0.9), 0 0 60px rgba(100,150,255,0.1);
    ">
      <div style="position:relative;width:100%;padding-bottom:56.25%;">
        <iframe
          src="${embedSrc}"
          style="position:absolute;inset:0;width:100%;height:100%;border:0;"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
      <div style="padding:8px 14px;background:#0a0a0a;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${title}</div>
        <button onclick="this.closest('[data-video-id]').setAttribute('data-action','close')" style="
          margin-left:10px;padding:5px 14px;border-radius:3px;border:1px solid rgba(255,255,255,0.1);
          background:#1a1a1a;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;white-space:nowrap;
        ">Stop</button>
      </div>
    </div>
  `
}

function ImageFrameHTML(data: { image_url: string; source: string }, width: number = 160): string {
  // Wall-mounted picture frame — wooden frame, off-white matte, realistic shadow
  return `
    <div style="
      background: linear-gradient(145deg, #3a2e1f, #2a2015, #3a2e1f);
      padding: 14px;
      border-radius: 2px;
      box-shadow: 0 8px 25px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.06);
      width: ${width}px;
      cursor: default;
    ">
      <div style="border:6px solid #f0ebe0;border-radius:1px;overflow:hidden;box-shadow:inset 0 0 10px rgba(0,0,0,0.15);">
        <img src="${safeUrl(data.image_url)}" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;" />
      </div>
    </div>
  `
}

function AudioPlayerHTML(data: AudioMarkerData, width: number = 280): string {
  // Speaker-style audio card with built-in HTML5 player
  const title = escapeHtml(data.title || "Audio")
  const artist = data.artist ? escapeHtml(data.artist) : ""
  return `
    <div data-audio-url="${safeUrl(data.url)}" style="
      background: linear-gradient(160deg, #1a1a1a, #0a0a0a);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 18px 18px 14px;
      width: ${width}px;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      box-shadow: 0 15px 40px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.04);
    ">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;">
        <div style="width:54px;height:54px;border-radius:50%;background:radial-gradient(circle at 50% 50%, #333 0%, #111 60%, #050505 100%);border:3px solid #0a0a0a;box-shadow:0 2px 6px rgba(0,0,0,0.8),inset 0 0 0 8px #1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <div style="width:10px;height:10px;border-radius:50%;background:#ff3b30;"></div>
        </div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
          ${artist ? `<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${artist}</div>` : ""}
        </div>
      </div>
      <audio controls preload="none" src="${safeUrl(data.url)}" style="width:100%;height:32px;filter:invert(0.92) hue-rotate(180deg);"></audio>
    </div>
  `
}

function BioLinksHTML(data: BioLinksMarkerData, width: number = 300): string {
  const title = escapeHtml(data.title || "Links")
  const rows = (data.links || []).map((l) => `
    <a href="${safeUrl(l.url)}" target="_blank" rel="noopener noreferrer" style="
      display:flex;align-items:center;gap:12px;
      padding:12px 14px;
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.08);
      border-radius:10px;
      color:white;text-decoration:none;
      transition:background 0.15s;
    " onmouseenter="this.style.background='rgba(255,255,255,0.09)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
      <span style="font-size:20px;flex-shrink:0;">${escapeHtml(l.emoji || "🔗")}</span>
      <span style="font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(l.title || l.url)}</span>
      <span style="font-size:12px;color:rgba(255,255,255,0.35);">↗</span>
    </a>
  `).join("")
  return `
    <div style="
      background: linear-gradient(180deg, #0d0d0d, #151515);
      border: 1px solid rgba(255,255,255,0.06);
      border-left: 4px solid rgba(168,85,247,0.6);
      border-radius: 4px;
      padding: 20px 20px 18px;
      width: ${width}px;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
    ">
      <div style="font-size:15px;font-weight:700;margin-bottom:14px;letter-spacing:-0.01em;">${title}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
    </div>
  `
}

export function InteractiveSphereViewer({ imageUrl, tileStem, tileBaseUrl, markers = [], onMarkersChanged, sphereId }: Props) {
  const track = useEventTracker(sphereId ?? null)
  // Latest track fn kept in a ref so PSV listener closures always call the
  // current one even across re-renders (React re-creates track otherwise).
  const trackRef = useRef(track)
  useEffect(() => { trackRef.current = track }, [track])
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const editModeRef = useRef(false)
  const [lock360, setLock360] = useState(true)
  const lock360Ref = useRef(true)
  const selectedMarkerRef = useRef<string | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null)
  const markersPluginRef = useRef<any>(null)
  const movedPositionsRef = useRef<Record<string, { yaw: number; pitch: number }>>({})
  const resizedWidthsRef = useRef<Record<string, number>>({})     // legacy, unused for new resize flow
  const resizedScalesRef = useRef<Record<string, number>>({})     // user-applied scale multiplier to persist
  // Live scale multiplier applied on top of zoom/viewport scale.
  const userScalesRef = useRef<Record<string, number>>({})
  const [psvHost, setPsvHost] = useState<HTMLElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [rerollOpen, setRerollOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  // Comfort settings — anti-distortion rig (EP '953 / CN '718 / US '579).
  // Persisted per-user in localStorage; defaults favor comfort.
  const [motionReduced, setMotionReduced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem("biosphere_motion_reduced") === "1"
  })
  const [comfortOpen, setComfortOpen] = useState(false)
  // Heatmap + top-viewed overlays (patent GB '335 / US '706).
  const [heatmapOn, setHeatmapOn] = useState(false)
  const [eventStats, setEventStats] = useState<Record<string, { selects: number; dwell_ms: number; dwell_rank: number; select_rank: number }>>({})
  // Keep the latest markers prop reachable from refs-only closures (onMarkersChanged commit).
  const markersRef = useRef(markers)
  useEffect(() => { markersRef.current = markers }, [markers])

  // Toggle the heatmap class on psv-container whenever heatmapOn flips.
  useEffect(() => {
    const host = containerRef.current?.querySelector(".psv-container")
    if (!host) return
    host.classList.toggle("biosphere-heatmap-on", heatmapOn)
  }, [heatmapOn, psvHost])

  // Fetch aggregated event stats (patent GB '335 / US '706). Refreshed on mount
  // + every 30s while in edit mode so heatmap/toggle stays current.
  useEffect(() => {
    if (!sphereId) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/events/summary?sphere_id=${encodeURIComponent(sphereId)}&days=30`)
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (!cancelled) setEventStats(json.markers || {})
      } catch {}
    }
    load()
    const interval = editMode ? window.setInterval(load, 30000) : null
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [sphereId, editMode])

  // Paint data-* attributes onto marker DOM elements whenever stats update or
  // markers (re)render. CSS selectors consume these for heatmap glow + badges.
  useEffect(() => {
    if (typeof window === "undefined") return
    const paint = () => {
      document.querySelectorAll<HTMLElement>(".psv-marker").forEach((el) => {
        const id = el.id.replace(/^psv-marker-/, "")
        const s = eventStats[id]
        if (s && s.dwell_ms > 0) {
          // 0 = most dwelt; clamp rank to 0..9 for CSS tiers
          el.setAttribute("data-dwell-rank", String(Math.min(9, s.dwell_rank)))
          el.setAttribute("data-dwell-ms", String(s.dwell_ms))
          el.setAttribute("data-selects", String(s.selects))
          if (s.dwell_rank < 3) el.setAttribute("data-top-viewed", String(s.dwell_rank + 1))
          else el.removeAttribute("data-top-viewed")
        } else {
          el.removeAttribute("data-dwell-rank")
          el.removeAttribute("data-dwell-ms")
          el.removeAttribute("data-selects")
          el.removeAttribute("data-top-viewed")
        }
      })
    }
    paint()
    // Re-paint when PSV adds/moves markers — cheap, idempotent.
    const obs = new MutationObserver(paint)
    const host = containerRef.current?.querySelector(".psv-container")
    if (host) obs.observe(host, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [eventStats, ready])

  const addMarkerAtCurrentView = async (builder: (yawDeg: number, pitchDeg: number) => MarkerDef) => {
    const viewer: any = viewerRef.current
    if (!viewer) return
    const pos = viewer.getPosition()
    const yawDeg = (pos.yaw * 180) / Math.PI
    const pitchDeg = (pos.pitch * 180) / Math.PI
    const newMarker = builder(yawDeg, pitchDeg)
    viewer.__biosphereAddMarker?.(newMarker)
    const updated = [...markersRef.current, newMarker]
    markersRef.current = updated
    if (onMarkersChanged) await onMarkersChanged(updated)
  }

  const commitMarkerChanges = async () => {
    const hasChanges =
      Object.keys(movedPositionsRef.current).length > 0 ||
      Object.keys(resizedScalesRef.current).length > 0
    if (!onMarkersChanged || !hasChanges) return
    const updated = markersRef.current.map((m, i) => {
      // Keep in sync with markerIdFor() inside the viewer's ready handler.
      const id = m.type === "profile" ? "profile-card"
        : m.type === "video" ? `video-${(m.data as VideoMarkerData).video_id}`
        : m.type === "audio" ? `audio-${i}-${encodeURIComponent((m.data as AudioMarkerData).url || "").slice(0, 24)}`
        : m.type === "bio-links" ? `bio-links-${i}`
        : `image-${i}`
      const newPos = movedPositionsRef.current[id]
      const newScale = resizedScalesRef.current[id]
      let next: MarkerDef = m
      if (newPos) next = { ...next, yaw: newPos.yaw, pitch: newPos.pitch }
      if (newScale) next = { ...next, scene_scale: newScale }
      return next
    })
    await onMarkersChanged(updated)
    movedPositionsRef.current = {}
    resizedScalesRef.current = {}
  }

  useEffect(() => {
    if (!containerRef.current) return
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (!ready || !containerRef.current) return

    let destroyed = false
    setLoading(true)

    async function init() {
      if (destroyed || !containerRef.current) return

      const stem = tileStem
      const { Viewer } = await import("@photo-sphere-viewer/core")
      const { EquirectangularTilesAdapter } = await import(
        "@photo-sphere-viewer/equirectangular-tiles-adapter"
      )
      const { MarkersPlugin } = await import("@photo-sphere-viewer/markers-plugin")

      if (destroyed || !containerRef.current) return

      const base = tileBaseUrl
        ? `${tileBaseUrl}/tiles/${stem}`
        : `/spheres/tiles/${stem}`

      // Inject styles for markers and edit mode
      const style = document.createElement("style")
      style.textContent = `
        .psv-marker--normal {
          transition: none !important;
        }

        /* Edit mode: dashed border on all markers */
        .biosphere-edit-mode .psv-marker {
          outline: 2px dashed rgba(59,130,246,0.5) !important;
          outline-offset: 4px;
          cursor: pointer !important;
        }
        .biosphere-edit-mode .psv-marker:hover {
          outline-color: rgba(59,130,246,0.8) !important;
        }

        /* ---- Patent GB '335 / US '706: heatmap + top-viewed overlays ---- */

        /* Top-viewed badge: 1 = ⭐⭐⭐, 2 = ⭐⭐, 3 = ⭐ — always visible in public view. */
        .psv-marker[data-top-viewed]::after {
          content: attr(data-top-viewed-stars);
          position: absolute;
          top: -10px;
          right: -10px;
          background: linear-gradient(135deg, #fbbf24, #f97316);
          color: white;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 9999px;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          font-family: Inter, system-ui, sans-serif;
          white-space: nowrap;
          pointer-events: none;
          z-index: 5;
        }
        .psv-marker[data-top-viewed="1"] { --stars: "⭐⭐⭐"; }
        .psv-marker[data-top-viewed="2"] { --stars: "⭐⭐"; }
        .psv-marker[data-top-viewed="3"] { --stars: "⭐"; }
        .psv-marker[data-top-viewed="1"]::after { content: "⭐⭐⭐ #1"; }
        .psv-marker[data-top-viewed="2"]::after { content: "⭐⭐ #2"; }
        .psv-marker[data-top-viewed="3"]::after { content: "⭐ #3"; }

        /* Heatmap mode: colored glow whose hue maps to dwell rank.
           Only visible while in edit mode AND the Heatmap toggle is on. */
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank] {
          outline: 3px solid transparent !important;
          filter: drop-shadow(0 0 20px var(--heat-color, rgba(59,130,246,0.5)));
        }
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="0"] { --heat-color: rgba(239, 68, 68, 0.9); }   /* red */
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="1"] { --heat-color: rgba(249, 115, 22, 0.85); } /* orange */
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="2"] { --heat-color: rgba(234, 179, 8, 0.8); }   /* amber */
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="3"] { --heat-color: rgba(163, 230, 53, 0.75); } /* lime */
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="4"] { --heat-color: rgba(34, 197, 94, 0.7); }   /* green */
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="5"],
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="6"],
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="7"],
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="8"],
        .biosphere-edit-mode.biosphere-heatmap-on .psv-marker[data-dwell-rank="9"] { --heat-color: rgba(14, 165, 233, 0.6); }  /* blue */

        /* Selected marker: solid blue border */
        .psv-marker.biosphere-selected {
          outline: 2px solid rgba(59,130,246,0.9) !important;
          outline-offset: 4px;
          opacity: 0.7;
        }

        /* Dragging state: hide default cursor */
        .biosphere-dragging .psv-canvas-container,
        .biosphere-dragging .psv-overlay {
          cursor: none !important;
        }

        /* Resize handles on selected marker */
        .biosphere-handle {
          position: absolute;
          width: 14px;
          height: 14px;
          background: rgba(59,130,246,0.95);
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0,0,0,0.5);
          z-index: 1000;
          pointer-events: auto;
        }
        .biosphere-handle--tl { top: -7px; left: -7px; cursor: nwse-resize; }
        .biosphere-handle--tr { top: -7px; right: -7px; cursor: nesw-resize; }
        .biosphere-handle--bl { bottom: -7px; left: -7px; cursor: nesw-resize; }
        .biosphere-handle--br { bottom: -7px; right: -7px; cursor: nwse-resize; }
        /* While actively resizing: drop the selection box and ghost so the marker reads clean */
        .biosphere-resizing .psv-marker.biosphere-selected {
          outline: none !important;
          opacity: 1 !important;
        }
        .biosphere-resizing .psv-marker.biosphere-selected .biosphere-handle {
          background: rgba(59,130,246,1);
        }
        .biosphere-resizing .biosphere-ghost {
          display: none !important;
        }
        .biosphere-resizing .psv-canvas-container,
        .biosphere-resizing .psv-overlay {
          cursor: inherit !important;
        }

        /* Ghost element following cursor */
        .biosphere-ghost {
          position: fixed;
          pointer-events: none;
          z-index: 9999;
          border: 2px dashed rgba(59,130,246,0.7);
          border-radius: 4px;
          background: rgba(59,130,246,0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
          font-family: Inter, system-ui, sans-serif;
          font-size: 11px;
          color: rgba(147,197,253,0.9);
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
          white-space: nowrap;
          padding: 0 8px;
        }
      `
      containerRef.current.appendChild(style)

      const viewer = new Viewer({
        container: containerRef.current,
        adapter: EquirectangularTilesAdapter,
        panorama: {
          baseUrl: `${base}/base.jpg`,
          levels: LEVELS,
          tileUrl: (col: number, row: number, level: number) =>
            `${base}/${level}/${col}_${row}.jpg`,
        },
        defaultZoomLvl: 50,
        defaultPitch: 0,
        minFov: 15,
        touchmoveTwoFingers: false,
        navbar: ["zoom", "fullscreen"],
        plugins: [
          [MarkersPlugin, {}],
        ],
      })
      viewerRef.current = viewer

      // Expose psv-container to React so overlays can portal into it (visible in fullscreen).
      setPsvHost(containerRef.current?.querySelector(".psv-container") as HTMLElement | null)

      // Event telemetry: sphere opened (patent GB '335 / US '706)
      trackRef.current("sphere_open")

      // Pitch lock — force straight ahead when 360 is off
      // Also emits throttled "pan" telemetry.
      let lastPanTrackAt = 0
      viewer.addEventListener("before-rotate", (e: any) => {
        if (!lock360Ref.current) {
          // no-op for pitch; still want to record the pan
        } else if (e.position) {
          e.position.pitch = 0
        }
        const now = Date.now()
        if (e.position && now - lastPanTrackAt > 1000) {
          lastPanTrackAt = now
          trackRef.current("pan", {
            meta: {
              yaw_deg: +((e.position.yaw * 180) / Math.PI).toFixed(2),
              pitch_deg: +((e.position.pitch * 180) / Math.PI).toFixed(2),
            },
          })
        }
      })

      // Zoom telemetry, throttled to 1 s.
      let lastZoomTrackAt = 0
      viewer.addEventListener("zoom-updated", (e: any) => {
        const now = Date.now()
        if (now - lastZoomTrackAt < 1000) return
        lastZoomTrackAt = now
        const zoom = typeof e.zoomLevel === "number" ? e.zoomLevel : viewer.getZoomLevel()
        trackRef.current("zoom", {
          meta: {
            zoom_level: +zoom.toFixed(1),
            fov_deg: +viewer.dataHelper.zoomLevelToFov(zoom).toFixed(2),
          },
        })
      })

      // Marker scaling — PSV calls the `scale` function on every render, so it
      // stays in sync with zoom AND viewport (including fullscreen) automatically.
      // Scales both the marker's visual and hit area, so clicks in edit mode work.
      const defaultFov = viewer.dataHelper.zoomLevelToFov(50)
      const psvEl = () =>
        containerRef.current?.querySelector(".psv-container") as HTMLElement | null
      const referenceHeight =
        psvEl()?.clientHeight || containerRef.current.clientHeight || 600
      const computeScale = (zoomLevel: number) => {
        const currentFov = viewer.dataHelper.zoomLevelToFov(zoomLevel)
        const fovScale = defaultFov / currentFov
        const currentHeight = psvEl()?.clientHeight || referenceHeight
        const viewportScale = currentHeight / referenceHeight
        return fovScale * viewportScale
      }

      // Force PSV to re-render markers when viewport size changes (fullscreen/resize)
      const refreshMarkers = () => {
        const plugin = markersPluginRef.current
        if (!plugin) return
        // Trigger PSV's marker render by calling renderMarkers on the viewer
        viewer.needsUpdate()
      }
      const onFullscreen = () => {
        requestAnimationFrame(() => requestAnimationFrame(refreshMarkers))
      }
      viewer.addEventListener("fullscreen", onFullscreen)
      const onResize = () => refreshMarkers()
      window.addEventListener("resize", onResize)

      ;(viewer as any).__biosphereCleanup = () => {
        viewer.removeEventListener("fullscreen", onFullscreen)
        window.removeEventListener("resize", onResize)
      }

      viewer.addEventListener("ready", () => {
        if (destroyed) return
        setLoading(false)

        // Attach the anti-distortion camera rig as soon as the viewer is live.
        // Store cleanup on the viewer so the top-level effect teardown runs it.
        const detachRig = attachAntiDistortionRig(viewer, { motionReduced })
        ;(viewer as any).__biosphereRigCleanup = detachRig

        const markersPlugin = viewer.getPlugin(MarkersPlugin) as any
        if (!markersPlugin) return

        const playingVideos = new Set<string>()

        // Scale function factory — per-marker so resize-drag multiplier applies
        // on top of zoom/viewport scale uniformly (width, height, fonts, hit area).
        const makeScaleFn = (id: string) => (zoomLevel: number) =>
          computeScale(zoomLevel) * (userScalesRef.current[id] ?? 1)

        // Compute a stable marker id + default design width for a MarkerDef
        const markerIdFor = (m: MarkerDef, i: number): string => {
          if (m.type === "profile") return "profile-card"
          if (m.type === "video") return `video-${(m.data as VideoMarkerData).video_id}`
          if (m.type === "audio") return `audio-${i}-${encodeURIComponent((m.data as AudioMarkerData).url || "").slice(0, 24)}`
          if (m.type === "bio-links") return `bio-links-${i}`
          return `image-${i}`
        }
        const defaultWidthFor = (t: MarkerDef["type"]) =>
          t === "profile" ? 320 : t === "video" ? 360 : t === "image" ? 160 : t === "audio" ? 280 : 300

        // Build html + PSV config for a marker
        const buildMarkerConfig = (m: MarkerDef, i: number) => {
          const yawRad = (m.yaw * Math.PI) / 180
          const pitchRad = (m.pitch * Math.PI) / 180
          const sceneW = m.scene_width || defaultWidthFor(m.type)
          const id = markerIdFor(m, i)
          userScalesRef.current[id] = m.scene_scale ?? 1
          let html = ""
          if (m.type === "profile") html = ProfileCardHTML(m.data as ProfileMarkerData, sceneW)
          else if (m.type === "video") html = VideoThumbnailHTML(m.data as VideoMarkerData, sceneW)
          else if (m.type === "image") html = ImageFrameHTML(m.data as any, sceneW)
          else if (m.type === "audio") html = AudioPlayerHTML(m.data as AudioMarkerData, sceneW)
          else if (m.type === "bio-links") html = BioLinksHTML(m.data as BioLinksMarkerData, sceneW)
          return {
            id,
            position: { yaw: yawRad, pitch: pitchRad },
            html,
            anchor: "center center" as const,
            scale: makeScaleFn(id),
            data: { ...m.data, markerType: m.type, sceneWidth: sceneW },
          }
        }

        for (let i = 0; i < markers.length; i++) {
          markersPlugin.addMarker(buildMarkerConfig(markers[i], i) as any)
        }

        // Expose so the add-marker UI can inject new markers without re-init
        ;(viewer as any).__biosphereAddMarker = (newMarker: MarkerDef) => {
          const idx = markersRef.current.length
          const config = buildMarkerConfig(newMarker, idx)
          markersPlugin.addMarker(config as any)
          return config.id
        }

        // Build new marker HTML at a given width, based on marker type
        const rebuildMarkerHTML = (markerId: string, data: any, width: number): string | null => {
          const origIdx = markers.findIndex((m, i) => {
            const id = m.type === "profile" ? "profile-card"
              : m.type === "video" ? `video-${(m.data as VideoMarkerData).video_id}`
              : `image-${i}`
            return id === markerId
          })
          if (origIdx < 0) return null
          const orig = markers[origIdx]
          if (orig.type === "profile") return ProfileCardHTML(orig.data as ProfileMarkerData, width)
          if (orig.type === "video") return VideoThumbnailHTML(orig.data as VideoMarkerData, width)
          if (orig.type === "image") return ImageFrameHTML(orig.data as any, width)
          return null
        }

        const attachResizeHandles = (markerEl: HTMLElement, markerId: string, data: any) => {
          markerEl.querySelectorAll(".biosphere-handle").forEach((h) => h.remove())
          const corners: Array<{ cls: string; sx: number; sy: number }> = [
            { cls: "biosphere-handle--tl", sx: -1, sy: -1 },
            { cls: "biosphere-handle--tr", sx: 1, sy: -1 },
            { cls: "biosphere-handle--bl", sx: -1, sy: 1 },
            { cls: "biosphere-handle--br", sx: 1, sy: 1 },
          ]
          for (const c of corners) {
            const h = document.createElement("div")
            h.className = `biosphere-handle ${c.cls}`
            h.addEventListener("click", (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
            })
            h.addEventListener("mousedown", (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              const startX = ev.clientX
              const startY = ev.clientY
              const psvC = containerRef.current?.querySelector(".psv-container")
              psvC?.classList.add("biosphere-resizing")
              const ghost = document.querySelector(".biosphere-ghost") as any
              if (ghost) { ghost.__cleanup?.(); ghost.remove() }

              // Work purely in scale-multiplier space so everything (width,
              // height, padding, font sizes) grows uniformly and height can
              // never "snap back" to content-driven layout.
              const baseWidth = data?.sceneWidth || 320
              const zoom = viewer.getZoomLevel()
              const curScale = computeScale(zoom) || 1
              const startMultiplier = userScalesRef.current[markerId] ?? 1
              const startVisualWidth = baseWidth * curScale * startMultiplier

              const onMove = (mv: MouseEvent) => {
                const dx = (mv.clientX - startX) * c.sx
                const dy = (mv.clientY - startY) * c.sy
                const delta = (dx + dy) / 2
                const newVisual = Math.max(40, startVisualWidth + delta)
                const newMultiplier = Math.max(0.25, Math.min(4, newVisual / (baseWidth * curScale)))
                userScalesRef.current[markerId] = newMultiplier
                resizedScalesRef.current[markerId] = newMultiplier
                viewer.needsUpdate()
              }
              const onUp = () => {
                document.removeEventListener("mousemove", onMove)
                document.removeEventListener("mouseup", onUp)
                psvC?.classList.remove("biosphere-resizing")
              }
              document.addEventListener("mousemove", onMove)
              document.addEventListener("mouseup", onUp)
            })
            markerEl.appendChild(h)
          }
        }

        // Select a marker for editing — highlight, show resize handles, track state.
        const selectForEdit = (markerEl: HTMLElement, markerId: string, data: any) => {
          document.querySelectorAll(".psv-marker.biosphere-selected").forEach((el) => {
            el.classList.remove("biosphere-selected")
            el.querySelectorAll(".biosphere-handle").forEach((h) => h.remove())
          })
          markerEl.classList.add("biosphere-selected")
          attachResizeHandles(markerEl, markerId, data)
          selectedMarkerRef.current = markerId
          setSelectedMarker(markerId)
        }

        // Edit-mode drag-to-move: capture mousedown before PSV so the scene
        // doesn't rotate while the user is moving a marker.
        const psvContainer = containerRef.current?.querySelector(".psv-container") as HTMLElement | null
        const onEditMousedown = (ev: MouseEvent) => {
          if (!editModeRef.current) return
          const target = ev.target as Element
          // Let resize handles own their own drag
          if (target.closest(".biosphere-handle")) return
          const markerEl = target.closest(".psv-marker") as HTMLElement | null
          if (!markerEl) return

          const markerId = markerEl.id.replace(/^psv-marker-/, "")
          const marker = markersPlugin.markers?.[markerId]
          if (!marker) return
          const data = marker.config?.data
          ev.preventDefault()
          ev.stopPropagation()

          const startX = ev.clientX
          const startY = ev.clientY
          let dragging = false
          const threshold = 4
          psvContainer?.classList.add("biosphere-dragging")

          // Pre-select on mousedown so resize handles/outline appear immediately
          selectForEdit(markerEl, markerId, data)

          const onMove = (mv: MouseEvent) => {
            if (!dragging) {
              if (Math.hypot(mv.clientX - startX, mv.clientY - startY) < threshold) return
              dragging = true
            }
            const psvEl = containerRef.current?.querySelector(".psv-container") as HTMLElement | null
            if (!psvEl) return
            const r = psvEl.getBoundingClientRect()
            const pt = { x: mv.clientX - r.left, y: mv.clientY - r.top }
            const pos = viewer.dataHelper.viewerCoordsToSphericalCoords(pt)
            if (!pos) return
            try {
              markersPlugin.updateMarker({
                id: markerId,
                position: { yaw: pos.yaw, pitch: pos.pitch },
              } as any)
            } catch {}
            movedPositionsRef.current[markerId] = {
              yaw: (pos.yaw * 180) / Math.PI,
              pitch: (pos.pitch * 180) / Math.PI,
            }
            // PSV rebuilds the marker element on position update — re-apply selection + handles
            requestAnimationFrame(() => {
              const fresh = markersPlugin.markers?.[markerId]?.domElement as HTMLElement | undefined
              if (fresh && selectedMarkerRef.current === markerId) {
                fresh.classList.add("biosphere-selected")
                if (!fresh.querySelector(".biosphere-handle")) {
                  attachResizeHandles(fresh, markerId, data)
                }
              }
            })
          }
          const onUp = () => {
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            psvContainer?.classList.remove("biosphere-dragging")
          }
          document.addEventListener("mousemove", onMove)
          document.addEventListener("mouseup", onUp)
        }
        psvContainer?.addEventListener("mousedown", onEditMousedown, true)
        ;(viewer as any).__biosphereEditCleanup = () => {
          psvContainer?.removeEventListener("mousedown", onEditMousedown, true)
        }

        // Marker dwell telemetry (patent GB '335 / US '706). Record
        // `marker_dwell` with duration_ms when a hover exceeds 500 ms.
        const hoverStart: Record<string, number> = {}
        markersPlugin.addEventListener("enter-marker", (e: any) => {
          const id = (e.marker?.config || e.marker)?.id
          if (id) hoverStart[id] = Date.now()
        })
        markersPlugin.addEventListener("leave-marker", (e: any) => {
          const cfg = e.marker?.config || e.marker
          const id = cfg?.id
          if (!id || !hoverStart[id]) return
          const duration_ms = Date.now() - hoverStart[id]
          delete hoverStart[id]
          if (duration_ms >= 500) {
            trackRef.current("marker_dwell", {
              marker_id: id,
              meta: { marker_type: cfg?.data?.markerType || null, duration_ms },
            })
          }
        })

        // Handle marker clicks (non-edit mode): video play/stop
        markersPlugin.addEventListener("select-marker", (e: any) => {
          if (editModeRef.current) return
          const markerConfig = e.marker?.config || e.marker
          const markerId = markerConfig?.id || ""
          const data = markerConfig?.data

          // Event telemetry: marker_select (patent GB '335 / US '706)
          trackRef.current("marker_select", {
            marker_id: markerId,
            meta: { marker_type: data?.markerType || null },
          })

          if (!data?.video_id) return

          const sw = data.sceneWidth || 360
          if (playingVideos.has(data.video_id)) {
            // Stop — swap back to thumbnail
            playingVideos.delete(data.video_id)
            markersPlugin.updateMarker({
              id: markerId,
              html: VideoThumbnailHTML(data as VideoMarkerData, sw),
            } as any)
          } else {
            // Play — swap to iframe
            playingVideos.add(data.video_id)
            markersPlugin.updateMarker({
              id: markerId,
              html: VideoPlayingHTML(data as VideoMarkerData, sw),
            } as any)
          }
        })

        markersPluginRef.current = markersPlugin

        // Listen for Stop button clicks inside playing videos
        const observer = new MutationObserver(() => {
          document.querySelectorAll("[data-action='close']").forEach((el) => {
            const wrapper = el.closest("[data-video-id]")
            const videoId = wrapper?.getAttribute("data-video-id")
            if (videoId && playingVideos.has(videoId)) {
              playingVideos.delete(videoId)
              const origMarker = markers.find(
                (m) => m.type === "video" && (m.data as VideoMarkerData).video_id === videoId
              )
              if (origMarker) {
                markersPlugin.updateMarker({
                  id: `video-${videoId}`,
                  html: VideoThumbnailHTML(origMarker.data as VideoMarkerData, origMarker.scene_width || 360),
                } as any)
              }
            }
          })
        })
        observer.observe(containerRef.current!, { childList: true, subtree: true, attributes: true })
        ;(viewer as any).__biosphereObserver = observer
      })
    }

    init()

    return () => {
      destroyed = true
      ;(viewerRef.current as any)?.__biosphereCleanup?.()
      ;(viewerRef.current as any)?.__biosphereEditCleanup?.()
      ;(viewerRef.current as any)?.__biosphereObserver?.disconnect()
      ;(viewerRef.current as any)?.__biosphereRigCleanup?.()
      viewerRef.current?.destroy()
      viewerRef.current = null
      setPsvHost(null)
    }
    // NOTE: `markers` intentionally NOT in deps — the viewer builds from the
    // initial markers prop once, then live edits flow through the plugin and
    // refs. Re-running this effect would tear down and rebuild the whole
    // viewer, which happened every time the user saved (annoying reload flash).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, tileStem, tileBaseUrl, ready])

  // Cmd/Ctrl+K toggles the copilot panel while in edit mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (editMode) {
          e.preventDefault()
          setCopilotOpen((v) => !v)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [editMode])

  // Build the imperative actions the copilot panel can invoke.
  const copilotActions: CopilotActions = {
    getProfile() {
      // Derive a tiny snapshot from current markers + sphere metadata.
      const profileMarker = markersRef.current.find((m) => m.type === "profile")
      const data: any = profileMarker?.data ?? {}
      return {
        brand: data.name ?? null,
        prompt: data.bio ?? "",
        background_prompt: null,
        reroll_count: 0,
      }
    },
    getMarkers() {
      return markersRef.current.map((m, i) => {
        const anyM = m as any
        const id = m.type === "profile" ? "profile-card"
          : m.type === "video" ? `video-${(m.data as any).video_id}`
          : m.type === "audio" ? `audio-${i}-${encodeURIComponent((m.data as any).url || "").slice(0, 24)}`
          : m.type === "bio-links" ? `bio-links-${i}`
          : `image-${i}`
        const d = anyM.data ?? {}
        const summary = m.type === "profile" ? (d.name || "Profile")
          : m.type === "video" ? (d.title || `Video ${d.video_id}`)
          : m.type === "audio" ? (d.title || "Audio")
          : m.type === "bio-links" ? (d.title || "Bio Links")
          : (d.title || "Image")
        return {
          id,
          type: m.type,
          yaw: m.yaw,
          pitch: m.pitch,
          scene_scale: anyM.scene_scale,
          summary,
        }
      })
    },
    getCurrentView() {
      const v: any = viewerRef.current
      if (!v) return { yaw: 0, pitch: 0, fov: 90 }
      const pos = v.getPosition()
      return {
        yaw: (pos.yaw * 180) / Math.PI,
        pitch: (pos.pitch * 180) / Math.PI,
        fov: v.getZoomLevel() ?? 90,
      }
    },
    async addMarker(input) {
      // Use existing addMarkerAtCurrentView path — builder must produce a MarkerDef.
      await addMarkerAtCurrentView((yaw, pitch) => {
        const y = input.yaw ?? yaw
        const p = input.pitch ?? pitch
        const c = input.content as any
        if (input.type === "image") {
          return { type: "image", yaw: y, pitch: p, data: { url: c.url, title: c.title ?? "" }, scene_scale: 1 } as any
        }
        if (input.type === "video") {
          return { type: "video", yaw: y, pitch: p, data: { platform: c.platform ?? "youtube", video_id: c.video_id, title: c.title ?? "" }, scene_scale: 1 } as any
        }
        if (input.type === "audio") {
          return { type: "audio", yaw: y, pitch: p, data: { url: c.url, title: c.title ?? "" }, scene_scale: 1 } as any
        }
        return { type: "bio-links", yaw: y, pitch: p, data: { title: c.title ?? "Links", links: c.links ?? [] }, scene_scale: 1 } as any
      })
      return { id: "pending" }
    },
    async moveMarker({ marker_id, yaw, pitch }) {
      movedPositionsRef.current[marker_id] = { yaw, pitch }
      await commitMarkerChanges()
    },
    async resizeMarker({ marker_id, scale }) {
      const clamped = Math.min(3, Math.max(0.3, scale))
      resizedScalesRef.current[marker_id] = clamped
      await commitMarkerChanges()
    },
    async deleteMarker({ marker_id }) {
      // Filter out the matching marker using the same ID derivation as commitMarkerChanges.
      const idx = markersRef.current.findIndex((m, i) => {
        const id = m.type === "profile" ? "profile-card"
          : m.type === "video" ? `video-${(m.data as any).video_id}`
          : m.type === "audio" ? `audio-${i}-${encodeURIComponent((m.data as any).url || "").slice(0, 24)}`
          : m.type === "bio-links" ? `bio-links-${i}`
          : `image-${i}`
        return id === marker_id
      })
      if (idx < 0) return
      const next = [...markersRef.current]
      next.splice(idx, 1)
      markersRef.current = next
      if (onMarkersChanged) await onMarkersChanged(next)
    },
    async regenerateBackground(input) {
      if (input.variants === false) {
        await startBackgroundReroll({
          generationId: sphereId!,
          prompt: input.prompt,
          styleId: input.style_id,
          negativeText: input.negative_text,
          highRes: input.high_res,
        })
        return { status: "started", job_id: sphereId!, kind: "direct" }
      }
      const { job_id } = await startVariantReroll({
        generationId: sphereId!,
        prompt: input.prompt,
        styleId: input.style_id,
        negativeText: input.negative_text,
        highRes: input.high_res,
        count: 4,
      })
      return { status: "started", job_id, kind: "variants" }
    },
    async getAnalytics({ days = 7 }) {
      if (!sphereId) return { markers: {} }
      const res = await fetch(`/api/events/summary?sphere_id=${sphereId}&days=${days}`)
      if (!res.ok) return { error: "failed to fetch analytics" }
      return await res.json()
    },
  }

  return (
    <div className="relative w-full h-[600px] rounded-xl overflow-hidden border border-white/10" style={{ zIndex: 20, isolation: "isolate" }}>
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-white/70">Rendering interactive sphere...</span>
          </div>
        </div>
      )}
      {/* Edit mode controls — portaled into PSV container so they show in fullscreen too */}
      {!loading && markers.length > 0 && psvHost && createPortal(
        <div
          style={{ position: "absolute", top: 12, left: 12, zIndex: 90, display: "flex", alignItems: "center", gap: 8 }}
        >
          <button
            onClick={() => {
              const next = !editMode
              setEditMode(next)
              editModeRef.current = next
              if (!next) {
                selectedMarkerRef.current = null
                setSelectedMarker(null)
                commitMarkerChanges()
              }
              // Toggle edit-mode styling on all markers
              const psvContainer = containerRef.current?.querySelector(".psv-container")
              if (psvContainer) {
                if (next) {
                  psvContainer.classList.add("biosphere-edit-mode")
                } else {
                  psvContainer.classList.remove("biosphere-edit-mode")
                  psvContainer.classList.remove("biosphere-dragging")
                  const ghost = document.querySelector(".biosphere-ghost") as any
                  if (ghost) { ghost.__cleanup?.(); ghost.remove() }
                  document.querySelectorAll(".psv-marker.biosphere-selected").forEach((el) => {
                    el.classList.remove("biosphere-selected")
                  })
                  document.querySelectorAll(".biosphere-handle").forEach((h) => h.remove())
                }
              }
            }}
            style={{
              padding: "6px 12px", fontSize: 12, borderRadius: 8,
              backdropFilter: "blur(8px)", transition: "all 0.2s", cursor: "pointer",
              border: editMode ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.1)",
              background: editMode ? "rgba(59,130,246,0.8)" : "rgba(0,0,0,0.4)",
              color: editMode ? "white" : "rgba(255,255,255,0.5)",
            }}
          >
            {editMode ? "Done Editing" : "Edit Layout"}
          </button>
          {editMode && (
            <button
              onClick={async () => {
                setSaving(true)
                try {
                  await commitMarkerChanges()
                } finally {
                  setSaving(false)
                }
              }}
              disabled={saving}
              style={{
                padding: "6px 12px", fontSize: 12, borderRadius: 8,
                backdropFilter: "blur(8px)", transition: "all 0.2s",
                cursor: saving ? "default" : "pointer",
                border: "1px solid rgba(34,197,94,0.5)",
                background: saving ? "rgba(34,197,94,0.4)" : "rgba(34,197,94,0.8)",
                color: "white",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {editMode && (
            <>
              <button
                onClick={() => setAddOpen(true)}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 8,
                  backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.45)",
                  color: "white",
                }}
              >
                + Add
              </button>
              <button
                onClick={() => setRerollOpen(true)}
                title="Regenerate the sphere background with a new prompt"
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 8,
                  backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s",
                  border: "1px solid rgba(168,85,247,0.5)",
                  background: "rgba(168,85,247,0.8)",
                  color: "white",
                }}
              >
                🎨 Reroll BG
              </button>
              <button
                onClick={() => setCopilotOpen((v) => !v)}
                title="Toggle copilot chat (Cmd+K)"
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 8,
                  backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s",
                  border: copilotOpen ? "1px solid rgba(59,130,246,0.6)" : "1px solid rgba(255,255,255,0.15)",
                  background: copilotOpen ? "rgba(59,130,246,0.8)" : "rgba(0,0,0,0.45)",
                  color: "white",
                }}
              >
                ✨ Copilot
              </button>
              <button
                onClick={() => setHeatmapOn((v) => !v)}
                title={Object.keys(eventStats).length === 0 ? "No viewer events recorded yet" : "Toggle dwell-time heatmap"}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 8,
                  backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s",
                  border: heatmapOn ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.15)",
                  background: heatmapOn ? "rgba(239,68,68,0.8)" : "rgba(0,0,0,0.45)",
                  color: "white",
                }}
              >
                🔥 Heatmap {heatmapOn ? "On" : "Off"}
              </button>
              <span style={{
                padding: "4px 8px", fontSize: 10, borderRadius: 6,
                background: selectedMarker ? "rgba(59,130,246,0.2)" : "rgba(0,0,0,0.4)",
                color: selectedMarker ? "rgba(147,197,253,1)" : "rgba(255,255,255,0.4)",
                border: selectedMarker ? "1px solid rgba(59,130,246,0.3)" : "none",
              }}>
                {selectedMarker ? "Drag to move • corners to resize" : "Drag a marker to move it"}
              </span>
            </>
          )}
        </div>,
        psvHost
      )}
      {addOpen && psvHost && createPortal(
        <AddMarkerModal
          onClose={() => setAddOpen(false)}
          onAdd={async (builder) => {
            await addMarkerAtCurrentView(builder)
            setAddOpen(false)
          }}
        />,
        psvHost
      )}
      {rerollOpen && sphereId && (
        <RerollBackgroundModal
          generationId={sphereId}
          onClose={() => setRerollOpen(false)}
          onRerolled={() => {
            // Hard reload so the viewer picks up the new tile_stem from the
            // generations row — markers/state are preserved by server-side storage.
            setRerollOpen(false)
            setTimeout(() => window.location.reload(), 800)
          }}
        />
      )}
      {copilotOpen && editMode && sphereId && psvHost && (
        <CopilotPanel
          sphereId={sphereId}
          actions={copilotActions}
          onClose={() => setCopilotOpen(false)}
          mountHost={psvHost}
        />
      )}
      {/* 360 toggle — lock/unlock vertical look */}
      {!loading && psvHost && createPortal(
        <div
          style={{ position: "absolute", top: 12, right: 12, zIndex: 90, display: "flex", alignItems: "flex-start", gap: 8 }}
        >
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setComfortOpen((v) => !v)}
              title="Comfort settings — anti-distortion + motion-reduced mode"
              style={{
                padding: "6px 12px", fontSize: 12, borderRadius: 8,
                backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s",
                border: motionReduced ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(255,255,255,0.1)",
                background: motionReduced ? "rgba(34,197,94,0.8)" : "rgba(0,0,0,0.4)",
                color: motionReduced ? "white" : "rgba(255,255,255,0.5)",
              }}
            >
              👁 Comfort{motionReduced ? " · Reduced" : ""}
            </button>
            {comfortOpen && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, width: 280,
                  padding: 12, borderRadius: 12,
                  background: "rgba(10,10,10,0.95)", backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "white", fontSize: 12, lineHeight: 1.5,
                  boxShadow: "0 12px 30px rgba(0,0,0,0.6)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Comfort</div>
                <div style={{ color: "rgba(255,255,255,0.5)", marginBottom: 10, fontSize: 11 }}>
                  Reduces perspective distortion + motion sickness. Pitch damping, horizon nudge, FOV bounds, and barrel correction are always on.
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={motionReduced}
                    onChange={(e) => {
                      const next = e.target.checked
                      setMotionReduced(next)
                      try {
                        window.localStorage.setItem("biosphere_motion_reduced", next ? "1" : "0")
                      } catch { /* ignore */ }
                      // Rig reads this at attach time; reload is cleanest way to re-attach.
                      // Alt: we could re-run attach; for now just remount by forcing a reload-ish flag.
                      if (viewerRef.current) {
                        try {
                          (viewerRef.current as any).__biosphereRigCleanup?.()
                          const rig = attachAntiDistortionRig(viewerRef.current, { motionReduced: next })
                          ;(viewerRef.current as any).__biosphereRigCleanup = rig
                        } catch {}
                      }
                    }}
                  />
                  <span>Motion-reduced mode (caps velocity, disables momentum)</span>
                </label>
                <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                  Honors your OS &ldquo;Reduce motion&rdquo; preference automatically.
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              const next = !lock360
              setLock360(next)
              lock360Ref.current = next
              // If locking, snap back to equator
              if (next && viewerRef.current) {
                const pos = viewerRef.current.getPosition()
                if (Math.abs(pos.pitch) > Math.PI / 6) {
                  viewerRef.current.animate({ yaw: pos.yaw, pitch: 0, speed: "3rpm" })
                }
              }
            }}
            style={{
              padding: "6px 12px", fontSize: 12, borderRadius: 8,
              backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s",
              border: lock360 ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(59,130,246,0.5)",
              background: lock360 ? "rgba(0,0,0,0.4)" : "rgba(59,130,246,0.8)",
              color: lock360 ? "rgba(255,255,255,0.5)" : "white",
            }}
          >
            {lock360 ? "360° Off" : "360° On"}
          </button>
        </div>,
        psvHost
      )}
    </div>
  )
}
