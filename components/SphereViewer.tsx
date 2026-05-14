"use client"

import { useEffect, useRef, useState } from "react"
import "@photo-sphere-viewer/core/index.css"

interface Props {
  imageUrl: string
  tileStem?: string | null
  tileBaseUrl?: string | null
  highRes?: boolean
}

function getImageStem(url: string): string | null {
  const match = url.match(/\/spheres\/([^.]+)\.jpg$/)
  return match ? match[1] : null
}

// Match pipeline: 3 tiers default, 4 tiers (adds 16K) for high_res spheres.
const LEVELS_STANDARD = [
  { width: 2048, cols: 2, rows: 1 },
  { width: 4096, cols: 4, rows: 2 },
  { width: 8192, cols: 8, rows: 4 },
]
const LEVELS_HIGH_RES = [
  ...LEVELS_STANDARD,
  { width: 16384, cols: 16, rows: 8 },
]

export function SphereViewer({ imageUrl, tileStem, tileBaseUrl, highRes = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)

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

      const stem = tileStem || getImageStem(imageUrl)

      if (stem) {
        const { Viewer } = await import("@photo-sphere-viewer/core")
        const { EquirectangularTilesAdapter } = await import(
          "@photo-sphere-viewer/equirectangular-tiles-adapter"
        )
        if (destroyed || !containerRef.current) return

        // Use Supabase CDN if tileBaseUrl is set, otherwise local /spheres/
        const base = tileBaseUrl
          ? `${tileBaseUrl}/tiles/${stem}`
          : `/spheres/tiles/${stem}`

        const viewer = new Viewer({
          container: containerRef.current,
          adapter: EquirectangularTilesAdapter,
          panorama: {
            baseUrl: `${base}/base.jpg`,
            levels: highRes ? LEVELS_HIGH_RES : LEVELS_STANDARD,
            tileUrl: (col: number, row: number, level: number) =>
              `${base}/${level}/${col}_${row}.jpg`,
          },
          defaultZoomLvl: 50,
          minFov: 15,
          touchmoveTwoFingers: false,
          navbar: ["zoom", "fullscreen"],
        })
        viewerRef.current = viewer

        viewer.addEventListener("ready", () => {
          if (!destroyed) setLoading(false)
        })
      } else {
        const { Viewer } = await import("@photo-sphere-viewer/core")
        if (destroyed || !containerRef.current) return

        const viewer = new Viewer({
          container: containerRef.current,
          panorama: imageUrl,
          defaultZoomLvl: 50,
          minFov: 15,
          touchmoveTwoFingers: false,
          navbar: ["zoom", "fullscreen"],
        })
        viewerRef.current = viewer

        viewer.addEventListener("ready", () => {
          if (!destroyed) setLoading(false)
        })
      }
    }

    init()

    return () => {
      destroyed = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [imageUrl, tileStem, tileBaseUrl, ready])

  return (
    <div className="relative w-full h-[500px] rounded-xl overflow-hidden border border-white/10">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-white/70">Rendering sphere...</span>
          </div>
        </div>
      )}
    </div>
  )
}
