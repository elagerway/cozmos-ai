"use client"

import { useEffect, useRef, useState } from "react"
import "@photo-sphere-viewer/core/index.css"

interface Props {
  imageUrl: string
  tileStem?: string | null
}

function getImageStem(url: string): string | null {
  const match = url.match(/\/spheres\/([^.]+)\.jpg$/)
  return match ? match[1] : null
}

const LEVELS = [
  { width: 2048, cols: 2, rows: 1 },
  { width: 4096, cols: 4, rows: 2 },
  { width: 8192, cols: 8, rows: 4 },
  { width: 16384, cols: 16, rows: 8 },
]

export function SphereViewer({ imageUrl, tileStem }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (!ready || !containerRef.current) return

    let destroyed = false

    async function init() {
      if (destroyed || !containerRef.current) return

      const stem = tileStem || getImageStem(imageUrl)

      if (stem) {
        const { Viewer } = await import("@photo-sphere-viewer/core")
        const { EquirectangularTilesAdapter } = await import(
          "@photo-sphere-viewer/equirectangular-tiles-adapter"
        )
        if (destroyed || !containerRef.current) return

        viewerRef.current = new Viewer({
          container: containerRef.current,
          adapter: EquirectangularTilesAdapter,
          panorama: {
            baseUrl: `/spheres/tiles/${stem}/base.jpg`,
            levels: LEVELS,
            tileUrl: (col: number, row: number, level: number) =>
              `/spheres/tiles/${stem}/${level}/${col}_${row}.jpg`,
          },
          defaultZoomLvl: 50,
          minFov: 15,
          touchmoveTwoFingers: false,
          navbar: ["zoom", "fullscreen"],
        })
      } else {
        const { Viewer } = await import("@photo-sphere-viewer/core")
        if (destroyed || !containerRef.current) return

        viewerRef.current = new Viewer({
          container: containerRef.current,
          panorama: imageUrl,
          defaultZoomLvl: 50,
          minFov: 15,
          touchmoveTwoFingers: false,
          navbar: ["zoom", "fullscreen"],
        })
      }
    }

    init()

    return () => {
      destroyed = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [imageUrl, tileStem, ready])

  return (
    <div
      ref={containerRef}
      className="w-full h-[500px] rounded-xl overflow-hidden border border-white/10"
    />
  )
}
