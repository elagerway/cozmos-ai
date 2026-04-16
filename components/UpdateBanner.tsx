"use client"

import { useEffect, useState } from "react"

export function UpdateBanner() {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Capture initial build ID from any Next.js chunk URL in the page
    const scripts = Array.from(document.querySelectorAll("script[src]"))
    const buildIds = scripts
      .map((s) => s.getAttribute("src")?.match(/\/_next\/static\/([^/]+)\//)?.[1])
      .filter(Boolean) as string[]

    const initialBuildId = buildIds[0] || ""
    if (!initialBuildId) return

    const interval = setInterval(async () => {
      try {
        // Fetch the raw HTML page (not RSC) with cache bust
        const resp = await fetch(`/?_t=${Date.now()}`, {
          headers: { Accept: "text/html" },
          cache: "no-store",
        })
        const html = await resp.text()

        // Only check if we got actual HTML back
        if (!html.includes("/_next/static/")) return

        const match = html.match(/\/_next\/static\/([^/]+)\//)
        if (match && match[1] && match[1] !== initialBuildId) {
          setShowBanner(true)
          clearInterval(interval)
        }
      } catch {
        // Ignore
      }
    }, 60000) // Check every 60 seconds (less aggressive)

    return () => clearInterval(interval)
  }, [])

  if (!showBanner) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-blue-600 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-3">
      <span>A new version is available.</span>
      <button
        onClick={() => window.location.reload()}
        className="px-3 py-1 rounded-md bg-white text-blue-600 font-semibold text-xs hover:bg-blue-50 transition-colors"
      >
        Reload
      </button>
      <button
        onClick={() => setShowBanner(false)}
        className="absolute right-3 text-white/60 hover:text-white"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
