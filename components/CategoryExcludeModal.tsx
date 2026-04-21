"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

// Patent US '666: user input excludes categories → remaining markers are
// repacked (via /repack-markers endpoint, which re-runs the harmony packer
// on the subset).

interface Props {
  // markers shape from InteractiveSphereViewer — we don't depend on full MarkerDef
  // typing because the panel reads only a few fields defensively.
  markers: Array<{
    id: string
    type: string
    platform?: string | null
    tags?: string[]
  }>
  onClose: () => void
  onApply: (excluded: {
    types: string[]
    platforms: string[]
    tags: string[]
    strictness: number
  }) => Promise<void>
}

const TYPE_LABELS: Record<string, string> = {
  profile: "Profile card",
  video: "Videos",
  audio: "Audio",
  image: "Images",
  "bio-links": "Bio links",
}

export function CategoryExcludeModal({ markers, onClose, onApply }: Props) {
  // Count how many markers fall into each category so users see the impact.
  const counts = useMemo(() => {
    const byType: Record<string, number> = {}
    const byPlatform: Record<string, number> = {}
    const byTag: Record<string, number> = {}
    for (const m of markers) {
      byType[m.type] = (byType[m.type] ?? 0) + 1
      if (m.type === "video" && m.platform) {
        byPlatform[m.platform] = (byPlatform[m.platform] ?? 0) + 1
      }
      if (Array.isArray(m.tags)) {
        for (const t of m.tags) byTag[t] = (byTag[t] ?? 0) + 1
      }
    }
    return { byType, byPlatform, byTag }
  }, [markers])

  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(new Set())
  const [excludedPlatforms, setExcludedPlatforms] = useState<Set<string>>(new Set())
  const [excludedTags, setExcludedTags] = useState<Set<string>>(new Set())
  const [strictness, setStrictness] = useState(0.55)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backdropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = backdropRef.current
    if (!el) return
    const stop = (e: Event) => e.stopImmediatePropagation()
    el.addEventListener("mousedown", stop, true)
    el.addEventListener("wheel", stop, true)
    el.addEventListener("keydown", stop, true)
    return () => {
      el.removeEventListener("mousedown", stop, true)
      el.removeEventListener("wheel", stop, true)
      el.removeEventListener("keydown", stop, true)
    }
  }, [])

  function toggle(set: Set<string>, key: string, update: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    update(next)
  }

  const removedCount = useMemo(() => {
    let n = 0
    for (const m of markers) {
      if (excludedTypes.has(m.type)) { n++; continue }
      if (m.type === "video" && m.platform && excludedPlatforms.has(m.platform)) { n++; continue }
      if (Array.isArray(m.tags) && m.tags.some((t) => excludedTags.has(t))) { n++; continue }
    }
    return n
  }, [markers, excludedTypes, excludedPlatforms, excludedTags])

  async function apply() {
    setApplying(true)
    setError(null)
    try {
      await onApply({
        types: [...excludedTypes],
        platforms: [...excludedPlatforms],
        tags: [...excludedTags],
        strictness,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed")
    } finally {
      setApplying(false)
    }
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Exclude categories</h2>
            <p className="text-xs text-white/50 mt-0.5">
              Hidden markers are removed; remaining markers re-flow into the space.
            </p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>
        </div>

        <section className="space-y-1 mb-4">
          <div className="text-xs uppercase tracking-wide text-white/40 mb-1.5">
            Marker types
          </div>
          {Object.entries(counts.byType).length === 0 && (
            <div className="text-sm text-white/40">No markers to filter.</div>
          )}
          {Object.entries(counts.byType).map(([type, count]) => (
            <label
              key={type}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm cursor-pointer hover:border-white/20"
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={excludedTypes.has(type)}
                  onChange={() => toggle(excludedTypes, type, setExcludedTypes)}
                />
                <span>{TYPE_LABELS[type] ?? type}</span>
              </span>
              <span className="text-xs text-white/40 tabular-nums">{count}</span>
            </label>
          ))}
        </section>

        {Object.keys(counts.byPlatform).length > 0 && (
          <section className="space-y-1 mb-4">
            <div className="text-xs uppercase tracking-wide text-white/40 mb-1.5">
              Video platforms
            </div>
            {Object.entries(counts.byPlatform).map(([platform, count]) => (
              <label
                key={platform}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm cursor-pointer hover:border-white/20"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={excludedPlatforms.has(platform)}
                    onChange={() => toggle(excludedPlatforms, platform, setExcludedPlatforms)}
                  />
                  <span className="capitalize">{platform}</span>
                </span>
                <span className="text-xs text-white/40 tabular-nums">{count}</span>
              </label>
            ))}
          </section>
        )}

        {Object.keys(counts.byTag).length > 0 && (
          <section className="space-y-1 mb-4">
            <div className="text-xs uppercase tracking-wide text-white/40 mb-1.5">
              Tags
            </div>
            {Object.entries(counts.byTag).map(([tag, count]) => (
              <label
                key={tag}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm cursor-pointer hover:border-white/20"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={excludedTags.has(tag)}
                    onChange={() => toggle(excludedTags, tag, setExcludedTags)}
                  />
                  <span>{tag}</span>
                </span>
                <span className="text-xs text-white/40 tabular-nums">{count}</span>
              </label>
            ))}
          </section>
        )}

        <section className="mb-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-xs uppercase tracking-wide text-white/40">
              Repack strictness
            </div>
            <div className="text-xs text-white/60 tabular-nums">{strictness.toFixed(2)}</div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={strictness}
            onChange={(e) => setStrictness(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-white/40 mt-1">
            <span>Loose (spread wider)</span>
            <span>Strict (stay near anchors)</span>
          </div>
        </section>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <div className="flex items-center justify-between">
          <p className="text-xs text-white/50">
            {removedCount === 0
              ? "No categories selected."
              : `${removedCount} marker${removedCount === 1 ? "" : "s"} will be removed.`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={applying || removedCount === 0}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-40"
            >
              {applying ? "Repacking…" : "Apply & repack"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
