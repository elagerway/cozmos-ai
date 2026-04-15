"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EXAMPLES, Example } from "@/lib/dummy-data"
import { fetchGenerations, GenerationRow } from "@/lib/supabase"

export default function ExamplesPage() {
  const [allExamples, setAllExamples] = useState<Example[]>(EXAMPLES)
  // Track featured state locally (persisted in localStorage)
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Load generated spheres from Supabase and merge with hardcoded examples
    fetchGenerations().then((rows) => {
      const generated: Example[] = rows.map((r: GenerationRow) => ({
        id: r.id,
        prompt: r.prompt,
        status: "done" as const,
        step: "done" as const,
        step_label: r.step_label,
        sphere_spec: null,
        bg_prompt: null,
        image_url: r.image_url,
        error: null,
        cost_usd: r.cost_usd ? Number(r.cost_usd) : null,
        duration_s: r.duration_s,
        created_at: r.created_at,
        featured: false,
        environment: "pipeline",
        brand: r.brand || undefined,
        tile_stem: r.tile_stem,
        tile_base_url: r.tile_base_url,
      }))
      // Show only Supabase generations if available, otherwise hardcoded
      if (generated.length > 0) {
        setAllExamples(generated)
      } else {
        setAllExamples(EXAMPLES)
      }
    })
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem("cozmos-featured")
    if (stored) {
      setFeaturedIds(new Set(JSON.parse(stored)))
    } else {
      // Default to the ones marked featured in data
      setFeaturedIds(new Set(EXAMPLES.filter((e) => e.featured).map((e) => e.id)))
    }
  }, [])

  function toggleFeatured(id: string) {
    setFeaturedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      localStorage.setItem("cozmos-featured", JSON.stringify([...next]))
      return next
    })
  }

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-white/5 sticky top-0 z-50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="font-semibold text-foreground tracking-tight">
              Cozmos
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">All Examples</h1>
          <p className="text-muted-foreground">
            Click the star to toggle which examples appear on the home page under
            &ldquo;Sample Generations&rdquo;.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {allExamples.map((example) => {
            const isFeatured = featuredIds.has(example.id)
            return (
              <div
                key={example.id}
                className="rounded-xl overflow-hidden border border-white/10 bg-white/[0.02]"
              >
                {/* Thumbnail */}
                <Link
                  href={`/g/${example.id}`}
                  className="block relative aspect-[2/1] overflow-hidden group"
                >
                  {example.image_url && (
                    <img
                      src={example.image_url}
                      alt={example.sphere_spec?.campaign_name || "Sphere"}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                  {example.brand && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] font-medium">
                      @{example.brand}
                    </div>
                  )}
                </Link>

                {/* Info + controls */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">
                        {example.sphere_spec?.campaign_name || example.prompt.slice(0, 50)}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {example.prompt}
                      </p>
                    </div>

                    {/* Featured toggle */}
                    <button
                      onClick={() => toggleFeatured(example.id)}
                      className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                        isFeatured
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-white/5 text-muted-foreground border border-white/10 hover:text-foreground"
                      }`}
                      title={isFeatured ? "Remove from homepage" : "Add to homepage"}
                    >
                      <svg
                        className="w-4 h-4"
                        fill={isFeatured ? "currentColor" : "none"}
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                        />
                      </svg>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <Link
                      href={`/g/${example.id}`}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      View sphere
                    </Link>
                    <span className="text-white/20">&middot;</span>
                    <span className="text-xs text-muted-foreground">
                      {example.environment}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
