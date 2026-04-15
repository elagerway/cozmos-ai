"use client"

import { useEffect, useRef, useState } from "react"
import "@photo-sphere-viewer/core/index.css"
import "@photo-sphere-viewer/markers-plugin/index.css"

interface VideoMarkerData {
  video_id: string
  title: string
  thumbnail_url: string
  view_count: string
  url: string
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

interface MarkerDef {
  type: "video" | "profile" | "image"
  yaw: number
  pitch: number
  data: VideoMarkerData | ProfileMarkerData | any
}

interface Props {
  imageUrl: string
  tileStem?: string | null
  tileBaseUrl?: string | null
  markers?: MarkerDef[]
}

const LEVELS = [
  { width: 2048, cols: 2, rows: 1 },
  { width: 4096, cols: 4, rows: 2 },
  { width: 8192, cols: 8, rows: 4 },
  { width: 16384, cols: 16, rows: 8 },
]

function ProfileCardHTML(data: ProfileMarkerData): string {
  // Wall-mounted display panel — sharp, solid, like a kiosk in the room
  return `
    <div style="
      background: linear-gradient(180deg, #0d0d0d 0%, #151515 100%);
      border: 1px solid rgba(255,255,255,0.06);
      border-left: 4px solid rgba(59,130,246,0.6);
      border-radius: 4px;
      padding: 28px 28px 24px;
      width: 400px;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      cursor: default;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8);
    ">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        ${data.profile_image ? `<img src="${data.profile_image}" style="width:80px;height:80px;border-radius:8px;border:2px solid rgba(255,255,255,0.1);object-fit:cover;" />` : ""}
        <div>
          <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;">${data.name}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.35);margin-top:3px;">${data.handle}</div>
        </div>
      </div>
      ${data.bio ? `<p style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;margin:0 0 16px 0;">${data.bio.slice(0, 160)}${data.bio.length > 160 ? "..." : ""}</p>` : ""}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${data.subscriber_count ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(255,0,0,0.12);font-size:11px;color:rgba(255,100,100,0.9);">YT ${data.subscriber_count}</span>` : ""}
        ${(data as any).instagram_handle ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(225,48,108,0.12);font-size:11px;color:rgba(225,130,170,0.9);">IG @${(data as any).instagram_handle}</span>` : ""}
        ${data.twitter_handle ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(29,155,240,0.12);font-size:11px;color:rgba(100,180,240,0.9);">X @${data.twitter_handle}</span>` : ""}
        ${(data as any).tiktok_handle ? `<span style="padding:4px 10px;border-radius:3px;background:rgba(0,242,234,0.08);font-size:11px;color:rgba(100,242,234,0.9);">TT @${(data as any).tiktok_handle}</span>` : ""}
      </div>
      ${data.channel_url ? `<a href="${data.channel_url}" target="_blank" rel="noopener" style="
        display:inline-block;padding:10px 24px;
        background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);
        border-radius:4px;
        color:white;font-size:13px;font-weight:600;text-decoration:none;
      ">Visit Channel</a>` : ""}
    </div>
  `
}

function VideoThumbnailHTML(data: VideoMarkerData): string {
  // Wall-mounted TV — thick bezel, screen glow, realistic proportions
  return `
    <div data-video-id="${data.video_id}" data-mode="thumbnail" style="
      background: #080808;
      border: 12px solid #111;
      border-bottom: 18px solid #111;
      border-radius: 6px;
      width: 640px;
      overflow: hidden;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 15px 40px rgba(0,0,0,0.9);
    ">
      <div style="position:relative;box-shadow:inset 0 0 30px rgba(100,150,255,0.06);">
        <img src="${data.thumbnail_url}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.15);">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(255,0,0,0.85);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 25px rgba(255,0,0,0.5);transition:transform 0.2s;"
               onmouseenter="this.style.transform='scale(1.15)'" onmouseleave="this.style.transform='scale(1)'">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <div style="padding:10px 14px;background:#0a0a0a;">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${data.title}</div>
        ${data.view_count ? `<div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:3px;">${data.view_count}</div>` : ""}
      </div>
    </div>
  `
}

function VideoPlayingHTML(data: VideoMarkerData): string {
  // TV screen with YouTube iframe — same bezel styling, seamless transition
  return `
    <div data-video-id="${data.video_id}" data-mode="playing" style="
      background: #000;
      border: 12px solid #111;
      border-bottom: 18px solid #111;
      border-radius: 6px;
      width: 640px;
      overflow: hidden;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      box-shadow: 0 15px 40px rgba(0,0,0,0.9), 0 0 60px rgba(100,150,255,0.1);
    ">
      <div style="position:relative;width:100%;padding-bottom:56.25%;">
        <iframe
          src="https://www.youtube.com/embed/${data.video_id}?autoplay=1&rel=0&modestbranding=1"
          style="position:absolute;inset:0;width:100%;height:100%;border:0;"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
      <div style="padding:8px 14px;background:#0a0a0a;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${data.title}</div>
        <button onclick="this.closest('[data-video-id]').setAttribute('data-action','close')" style="
          margin-left:10px;padding:5px 14px;border-radius:3px;border:1px solid rgba(255,255,255,0.1);
          background:#1a1a1a;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;white-space:nowrap;
        ">Stop</button>
      </div>
    </div>
  `
}

function ImageFrameHTML(data: { image_url: string; source: string }): string {
  // Wall-mounted picture frame — wooden frame, off-white matte, realistic shadow
  return `
    <div style="
      background: linear-gradient(145deg, #3a2e1f, #2a2015, #3a2e1f);
      padding: 14px;
      border-radius: 2px;
      box-shadow: 0 8px 25px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.06);
      width: 300px;
      cursor: default;
    ">
      <div style="border:6px solid #f0ebe0;border-radius:1px;overflow:hidden;box-shadow:inset 0 0 10px rgba(0,0,0,0.15);">
        <img src="${data.image_url}" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;" />
      </div>
    </div>
  `
}

export function InteractiveSphereViewer({ imageUrl, tileStem, tileBaseUrl, markers = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)

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

      // Inject smooth marker transitions
      const style = document.createElement("style")
      style.textContent = `.psv-marker--normal { transition: transform 0.15s ease-out, opacity 0.2s; }`
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
        minFov: 15,
        touchmoveTwoFingers: false,
        navbar: ["zoom", "fullscreen"],
        plugins: [
          [MarkersPlugin, {}],
        ],
      })
      viewerRef.current = viewer

      viewer.addEventListener("ready", () => {
        if (destroyed) return
        setLoading(false)

        const markersPlugin = viewer.getPlugin(MarkersPlugin) as any
        if (!markersPlugin) return

        const playingVideos = new Set<string>()

        for (let i = 0; i < markers.length; i++) {
          const marker = markers[i]
          const yawRad = (marker.yaw * Math.PI) / 180
          const pitchRad = (marker.pitch * Math.PI) / 180

          if (marker.type === "profile") {
            markersPlugin.addMarker({
              id: "profile-card",
              position: { yaw: yawRad, pitch: pitchRad },
              html: ProfileCardHTML(marker.data as ProfileMarkerData),
              anchor: "center center",
              data: { ...marker.data, markerType: "profile" },
            } as any)
          } else if (marker.type === "video") {
            const vdata = marker.data as VideoMarkerData
            markersPlugin.addMarker({
              id: `video-${vdata.video_id}`,
              position: { yaw: yawRad, pitch: pitchRad },
              html: VideoThumbnailHTML(vdata),
              anchor: "center center",
              data: { ...vdata, markerType: "video" },
            } as any)
          } else if (marker.type === "image") {
            markersPlugin.addMarker({
              id: `image-${i}`,
              position: { yaw: yawRad, pitch: pitchRad },
              html: ImageFrameHTML(marker.data as any),
              anchor: "center center",
            } as any)
          }
        }

        // Handle clicks — toggle video play/stop IN the sphere
        markersPlugin.addEventListener("select-marker", (e: any) => {
          const markerConfig = e.marker?.config || e.marker
          const data = markerConfig?.data
          if (!data?.video_id) return

          const markerId = `video-${data.video_id}`

          if (playingVideos.has(data.video_id)) {
            // Stop — swap back to thumbnail
            playingVideos.delete(data.video_id)
            markersPlugin.updateMarker({
              id: markerId,
              html: VideoThumbnailHTML(data as VideoMarkerData),
            } as any)
          } else {
            // Play — swap to iframe
            playingVideos.add(data.video_id)
            markersPlugin.updateMarker({
              id: markerId,
              html: VideoPlayingHTML(data as VideoMarkerData),
            } as any)
          }
        })

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
                  html: VideoThumbnailHTML(origMarker.data as VideoMarkerData),
                } as any)
              }
            }
          })
        })
        observer.observe(containerRef.current!, { childList: true, subtree: true, attributes: true })
      })
    }

    init()

    return () => {
      destroyed = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [imageUrl, tileStem, tileBaseUrl, markers, ready])

  return (
    <div className="relative w-full h-[600px] rounded-xl overflow-hidden border border-white/10">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-white/70">Rendering interactive sphere...</span>
          </div>
        </div>
      )}
    </div>
  )
}
