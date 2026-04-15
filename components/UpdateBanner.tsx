"use client"

import { useEffect, useState } from "react"

export function UpdateBanner() {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Store the initial build ID from the page load
    const initialBuildId = document.querySelector("script[src*='/_next/static/']")?.getAttribute("src")?.match(/\/_next\/static\/([^/]+)\//)?.[1] || ""

    if (!initialBuildId) return

    const interval = setInterval(async () => {
      try {
        const resp = await fetch("/", { headers: { Accept: "text/html" } })
        const html = await resp.text()
        const match = html.match(/\/_next\/static\/([^/]+)\//)
        if (match && match[1] !== initialBuildId) {
          setShowBanner(true)
          clearInterval(interval)
        }
      } catch {
        // Ignore fetch errors
      }
    }, 30000) // Check every 30 seconds

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
