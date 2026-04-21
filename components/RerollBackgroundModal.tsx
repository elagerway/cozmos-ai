"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  startBackgroundReroll,
  startVariantReroll,
  getVariantJob,
  commitVariant,
  pollStatus,
  type PipelineStatus,
  type VariantJob,
  type VariantPreview,
} from "@/lib/pipeline-client"

interface Props {
  generationId: string
  currentPrompt?: string
  onClose: () => void
  onRerolled: (status: PipelineStatus) => void
}

// Curated subset of Blockade Labs style IDs that produce coherent, low-warp
// results for the COZMOS persona-studio use case. Full catalog is 40+.
const STYLE_PRESETS = [
  { id: 119, label: "Photoreal (M3)", hint: "Default. Balanced light, photographic." },
  { id: 120, label: "Anime", hint: "Cel-shaded, soft gradients." },
  { id: 126, label: "Cinematic", hint: "Moody, filmic, dramatic." },
  { id: 127, label: "Fantasy", hint: "Painterly, magical." },
  { id: 128, label: "Dreamscape", hint: "Surreal, atmospheric." },
  { id: 7, label: "Realistic (M1)", hint: "Alternate photoreal model." },
]

const DEFAULT_NEGATIVE =
  "text, words, letters, writing, signs, labels, logos, watermarks, names, titles, " +
  "captions, numbers, typography, warped, distorted, pinched poles, stretched, " +
  "duplicated elements, artifacts, noise"

type Stage =
  | { kind: "form" }
  | { kind: "variants"; jobId: string }
  | { kind: "committing"; jobId: string; variantId: string }

export function RerollBackgroundModal({
  generationId,
  currentPrompt,
  onClose,
  onRerolled,
}: Props) {
  const [prompt, setPrompt] = useState(currentPrompt ?? "")
  const [styleId, setStyleId] = useState(119)
  const [negative, setNegative] = useState(DEFAULT_NEGATIVE)
  const [highRes, setHighRes] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [skipVariants, setSkipVariants] = useState(false)

  const [stage, setStage] = useState<Stage>({ kind: "form" })
  const [variantJob, setVariantJob] = useState<VariantJob | null>(null)
  const [commitProgress, setCommitProgress] = useState<PipelineStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  const backdropRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Block PSV under the modal from stealing focus/keys/wheel.
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
  }, [mounted])

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current)
    }
  }, [])

  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  async function startFlow() {
    if (!prompt.trim()) return
    setError(null)
    try {
      if (skipVariants) {
        // Classic direct reroll — skip variant picker, go straight to full render.
        await startBackgroundReroll({
          generationId,
          prompt: prompt.trim(),
          styleId,
          negativeText: negative,
          highRes,
        })
        setStage({ kind: "committing", jobId: generationId, variantId: "direct" })
        pollRef.current = window.setInterval(async () => {
          try {
            const s = await pollStatus(generationId)
            setCommitProgress(s)
            if (s.status === "done") {
              stopPolling()
              onRerolled(s)
            } else if (s.status === "failed") {
              stopPolling()
              setError(s.error || "Reroll failed")
              setStage({ kind: "form" })
            }
          } catch (e) {
            console.warn("[reroll] poll error", e)
          }
        }, 1500)
        return
      }

      const { job_id } = await startVariantReroll({
        generationId,
        prompt: prompt.trim(),
        styleId,
        negativeText: negative,
        highRes,
        count: 4,
      })
      setStage({ kind: "variants", jobId: job_id })

      pollRef.current = window.setInterval(async () => {
        try {
          const job = await getVariantJob(job_id)
          setVariantJob(job)
          if (job.status === "done" || job.status === "failed") {
            // Stop polling once all variants have terminal state — user picks next.
            stopPolling()
          }
        } catch (e) {
          console.warn("[variants] poll error", e)
        }
      }, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start")
    }
  }

  async function pickVariant(jobId: string, variantId: string) {
    setError(null)
    try {
      await commitVariant(jobId, variantId)
      setStage({ kind: "committing", jobId, variantId })

      pollRef.current = window.setInterval(async () => {
        try {
          const s = await pollStatus(generationId)
          setCommitProgress(s)
          if (s.status === "done") {
            stopPolling()
            onRerolled(s)
          } else if (s.status === "failed") {
            stopPolling()
            setError(s.error || "Commit failed")
            // Let the user pick a different variant.
            setStage({ kind: "variants", jobId })
          }
        } catch (e) {
          console.warn("[commit] poll error", e)
        }
      }, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to commit variant")
    }
  }

  function resetToForm() {
    stopPolling()
    setVariantJob(null)
    setCommitProgress(null)
    setError(null)
    setStage({ kind: "form" })
  }

  if (!mounted) return null

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Reroll background</h2>
            {stage.kind !== "form" && (
              <button
                onClick={resetToForm}
                className="mt-0.5 text-xs text-white/50 hover:text-white"
              >
                ← Start over
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {stage.kind === "form" && (
          <>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1.5">
              Describe the new background
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              autoFocus
              rows={4}
              placeholder="A moody cyberpunk studio at night, neon accents, rain on the windows"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none"
            />

            <label className="block text-xs uppercase tracking-wide text-white/50 mt-4 mb-1.5">
              Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyleId(s.id)}
                  className={`text-left rounded-lg border px-3 py-2 text-sm transition ${
                    styleId === s.id
                      ? "border-blue-400 bg-blue-400/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-white/50">{s.hint}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-white/60 hover:text-white"
              >
                {showAdvanced ? "Hide" : "Show"} advanced options
              </button>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={highRes}
                    onChange={(e) => setHighRes(e.target.checked)}
                  />
                  Ultra HD (16K tiles)
                </label>
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={skipVariants}
                    onChange={(e) => setSkipVariants(e.target.checked)}
                  />
                  Skip variants (one shot)
                </label>
              </div>
            </div>

            {showAdvanced && (
              <div className="mt-3">
                <label className="block text-xs uppercase tracking-wide text-white/50 mb-1.5">
                  Negative prompt
                </label>
                <textarea
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80 outline-none focus:border-blue-400 font-mono resize-none"
                />
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex items-center justify-between gap-2">
              <p className="text-xs text-white/40">
                {skipVariants
                  ? "Single full render. ~3 min total."
                  : "4 × 8K previews (~90s). Pick one → full 16K render."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={startFlow}
                  disabled={!prompt.trim()}
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-40"
                >
                  {skipVariants ? "Render background" : "Generate 4 variants"}
                </button>
              </div>
            </div>
          </>
        )}

        {stage.kind === "variants" && (
          <VariantGrid
            job={variantJob}
            onPick={(variantId) => pickVariant(stage.jobId, variantId)}
          />
        )}

        {stage.kind === "committing" && (
          <CommitProgress status={commitProgress} error={error} />
        )}
      </div>
    </div>,
    document.body
  )
}

function VariantGrid({
  job,
  onPick,
}: {
  job: VariantJob | null
  onPick: (variantId: string) => void
}) {
  if (!job) {
    return (
      <div className="py-10 text-center text-sm text-white/60">Starting variant job…</div>
    )
  }

  const readyCount = job.variants.filter((v) => v.status === "ready").length
  const totalCount = job.variants.length
  const allSettled = job.status !== "running"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <div>
          {allSettled
            ? readyCount > 0
              ? `Pick a variant${readyCount < totalCount ? ` (${totalCount - readyCount} failed)` : ""}`
              : "All variants failed — check logs"
            : `Generating ${totalCount} variants — ${readyCount} / ${totalCount} ready…`}
        </div>
        <div className="text-xs text-white/40 tabular-nums">
          {readyCount} / {totalCount}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {job.variants.map((v) => (
          <VariantCard key={v.id} variant={v} onPick={() => onPick(v.id)} />
        ))}
      </div>
    </div>
  )
}

function VariantCard({
  variant,
  onPick,
}: {
  variant: VariantPreview
  onPick: () => void
}) {
  if (variant.status === "failed") {
    return (
      <div className="aspect-video rounded-xl border border-red-500/30 bg-red-500/10 flex items-center justify-center text-xs text-red-300 p-4 text-center">
        Variant failed: {variant.error ?? "unknown error"}
      </div>
    )
  }
  if (variant.status === "pending" || !variant.preview_url) {
    return (
      <div className="aspect-video rounded-xl border border-white/10 bg-white/5 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  return (
    <button
      onClick={onPick}
      className="group relative aspect-video rounded-xl border border-white/10 bg-black overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-400/40 transition"
    >
      {/* Preview is equirectangular 8K — show as a stretched flat thumbnail.
          Not ideal but quickest way to compare composition + color. */}
      <img
        src={variant.preview_url}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
      <div className="absolute bottom-2 left-2 right-2 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition">
        Pick this one →
      </div>
    </button>
  )
}

function CommitProgress({
  status,
  error,
}: {
  status: PipelineStatus | null
  error: string | null
}) {
  return (
    <div className="space-y-4 py-6">
      <div>
        <div className="text-sm text-white/80">{status?.label ?? "Starting 16K export…"}</div>
        <div className="text-xs text-white/40 mt-0.5">
          Markers and everything else stay put — only the background changes.
        </div>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full bg-blue-400 transition-all"
          style={{ width: `${status?.pct ?? 55}%` }}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {status?.status === "done" && (
        <p className="text-sm text-emerald-400">Done. Reloading viewer…</p>
      )}
    </div>
  )
}
