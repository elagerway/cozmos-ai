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
  type: "video" | "profile"
  yaw: number
  pitch: number
  data: VideoMarkerData | ProfileMarkerData
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
  return `
    <div style="
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 24px;
      width: 320px;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      cursor: default;
    ">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
        ${data.profile_image ? `<img src="${data.profile_image}" style="width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);" />` : ""}
        <div>
          <div style="font-size:18px;font-weight:700;">${data.name}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.5);">${data.handle}</div>
        </div>
      </div>
      ${data.bio ? `<p style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.5;margin:0 0 16px 0;">${data.bio.slice(0, 150)}${data.bio.length > 150 ? "..." : ""}</p>` : ""}
      <div style="display:flex;gap:16px;font-size:12px;color:rgba(255,255,255,0.5);">
        ${data.subscriber_count ? `<span>${data.subscriber_count} subscribers</span>` : ""}
        ${data.twitter_handle ? `<span>@${data.twitter_handle}</span>` : ""}
      </div>
      ${data.channel_url ? `<a href="${data.channel_url}" target="_blank" style="
        display:inline-block;margin-top:16px;padding:8px 20px;
        background:rgba(255,0,0,0.8);border-radius:8px;
        color:white;font-size:13px;font-weight:600;text-decoration:none;
      ">Visit Channel</a>` : ""}
    </div>
  `
}

function VideoCardHTML(data: VideoMarkerData): string {
  return `
    <div class="video-marker" data-video-id="${data.video_id}" style="
      background: rgba(0,0,0,0.8);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      width: 280px;
      overflow: hidden;
      color: white;
      font-family: Inter, system-ui, sans-serif;
      cursor: pointer;
      transition: transform 0.2s, border-color 0.2s;
    " onmouseenter="this.style.borderColor='rgba(255,255,255,0.3)';this.style.transform='scale(1.02)'"
       onmouseleave="this.style.borderColor='rgba(255,255,255,0.1)';this.style.transform='scale(1)'">
      <div style="position:relative;">
        <img src="${data.thumbnail_url}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;" />
        <div style="
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          background:rgba(0,0,0,0.3);
        ">
          <div style="
            width:48px;height:48px;border-radius:50%;
            background:rgba(255,0,0,0.9);
            display:flex;align-items:center;justify-content:center;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <div style="padding:12px;">
        <div style="font-size:13px;font-weight:600;line-height:1.3;margin-bottom:4px;
          overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
          ${data.title}
        </div>
        ${data.view_count ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);">${data.view_count}</div>` : ""}
      </div>
    </div>
  `
}

export function InteractiveSphereViewer({ imageUrl, tileStem, tileBaseUrl, markers = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [activeVideo, setActiveVideo] = useState<string | null>(null)

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

        // Add markers
        const markersPlugin = viewer.getPlugin(MarkersPlugin)
        if (!markersPlugin) return

        for (const marker of markers) {
          const yawRad = (marker.yaw * Math.PI) / 180
          const pitchRad = (marker.pitch * Math.PI) / 180

          if (marker.type === "profile") {
            markersPlugin.addMarker({
              id: "profile-card",
              position: { yaw: yawRad, pitch: pitchRad },
              html: ProfileCardHTML(marker.data as ProfileMarkerData),
              anchor: "center center",
              zoomLvl: 100,
              data: marker.data,
            })
          } else if (marker.type === "video") {
            const vdata = marker.data as VideoMarkerData
            markersPlugin.addMarker({
              id: `video-${vdata.video_id}`,
              position: { yaw: yawRad, pitch: pitchRad },
              html: VideoCardHTML(vdata),
              anchor: "center center",
              zoomLvl: 100,
              data: vdata,
            })
          }
        }

        // Handle video clicks
        markersPlugin.addEventListener("select-marker", (e: any) => {
          const data = e.marker?.data
          if (data?.video_id) {
            setActiveVideo(data.video_id)
          }
        })
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

      {/* YouTube video overlay */}
      {activeVideo && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="relative w-full max-w-3xl mx-4">
            <button
              onClick={() => setActiveVideo(null)}
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-sm"
            >
              Close
            </button>
            <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
              <iframe
                className="absolute inset-0 w-full h-full rounded-xl"
                src={`https://www.youtube.com/embed/${activeVideo}?autoplay=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
