"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { InteractiveSphereViewer } from "@/components/InteractiveSphereViewer"
import { SphereSpecViewer } from "@/components/SphereSpecViewer"
import { ImageUploader } from "@/components/ImageUploader"
import { getGeneration } from "@/lib/dummy-data"
import { supabase, deleteGeneration, GenerationRow } from "@/lib/supabase"
import { startUploadGeneration, pollStatus, uploadAsMarkers } from "@/lib/pipeline-client"
import { GenerationProgress } from "@/components/GenerationProgress"
import { PipelineStep } from "@/lib/types"

interface ViewData {
  prompt: string
  title: string | null
  image_url: string | null
  tile_stem: string | null
  tile_base_url: string | null
  high_res: boolean
  sphere_spec: any
  bg_prompt: string | null
  brand: string | null
  markers: any[] | null
}

export default function PublicSharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [viewData, setViewData] = useState<ViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [step, setStep] = useState<PipelineStep>("scan_profile")
  const [pct, setPct] = useState(0)
  const [genLabel, setGenLabel] = useState("")
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const router = useRouter()

  // Track fullscreen changes
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  useEffect(() => {
    // Check hardcoded examples first
    const gen = getGeneration(id)
    if (gen) {
      setViewData({
        prompt: gen.prompt,
        title: gen.sphere_spec?.campaign_name || null,
        image_url: gen.image_url,
        tile_stem: (gen as any).tile_stem || null,
        tile_base_url: (gen as any).tile_base_url || null,
        high_res: (gen as any).high_res === true,
        sphere_spec: gen.sphere_spec,
        bg_prompt: gen.bg_prompt,
        brand: (gen as any).brand || null,
        markers: null,
      })
      setLoading(false)
      return
    }

    // Check Supabase
    if (!supabase) {
      setNotFound(true)
      setLoading(false)
      return
    }

    supabase
      .from("generations")
      .select("*")
      .eq("id", id)
      .eq("status", "done")
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound(true)
        } else {
          const row = data as GenerationRow & { environment?: string }
          let markers = null
          let profileName = row.brand
          if (row.environment) {
            try {
              const envData = JSON.parse(row.environment)
              markers = envData.markers || null
              if (envData.profile?.name) profileName = envData.profile.name
            } catch {}
          }
          setViewData({
            prompt: row.prompt,
            title: profileName ? `${profileName} — Generated Sphere` : "Generated Sphere",
            image_url: row.image_url,
            tile_stem: row.tile_stem,
            tile_base_url: row.tile_base_url,
            high_res: (row as any).high_res === true,
            sphere_spec: null,
            bg_prompt: null,
            brand: row.brand,
            markers,
          })
        }
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !viewData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-4xl font-bold">404</p>
          <p className="text-muted-foreground">Generation not found</p>
          <Link href="/" className="text-blue-400 hover:underline text-sm">
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Minimal header */}
      <div className="border-b border-white/5 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">B</span>
            </div>
            <span className="text-sm text-muted-foreground">Biosphere</span>
          </Link>
          <Link
            href="/examples"
            className="text-xs text-blue-400 hover:underline"
          >
            Back to Spheres
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8 w-full [&>*]:pointer-events-auto" style={{ pointerEvents: "none" }}>
        {viewData.title && (
          <h1 className="text-2xl font-bold mb-2">
            {viewData.title}
          </h1>
        )}
        <p className="text-muted-foreground mb-6">{viewData.prompt}</p>

        {generating ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <GenerationProgress
              currentStep={step}
              pct={pct}
              label={genLabel}
              hasSocialProfile={false}
            />
          </div>
        ) : (
          <>
            {viewData.image_url && (
              <div className="relative group">
                <InteractiveSphereViewer
                  imageUrl={viewData.image_url}
                  tileStem={viewData.tile_stem}
                  tileBaseUrl={viewData.tile_base_url}
                  highRes={viewData.high_res}
                  markers={viewData.markers ?? []}
                  sphereId={id}
                  onMarkersChanged={async (updatedMarkers) => {
                    // Save updated positions to Supabase. Persist the raw
                    // brand as profile.name — NOT viewData.title, which is
                    // already decorated ("<brand> — Generated Sphere") and
                    // would re-append the suffix on every reload.
                    if (supabase) {
                      const envData = { markers: updatedMarkers, profile: viewData.brand ? { name: viewData.brand } : undefined }
                      const { error } = await supabase
                        .from("generations")
                        .update({ environment: JSON.stringify(envData) })
                        .eq("id", id)
                      if (error) console.error("Failed to save markers:", error)
                      else console.log("Markers saved to Supabase")
                    }
                    setViewData({ ...viewData, markers: updatedMarkers })
                  }}
                />
                {/* Delete button — invisible until hover, hidden in fullscreen */}
                {!isFullscreen && (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="absolute top-3 right-24 z-20 w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-red-500/80 text-white/60 hover:text-white backdrop-blur-sm"
                    title="Delete sphere"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            <div className="mt-6">
              <ImageUploader
                onUpload={async (images, composite) => {
                  const isComposite = composite && viewData.tile_stem && viewData.tile_base_url

                  // Composite mode — upscale + pack as interactive image markers
                  // on the SAME gen_id. Keeps analytics / copilot / categories /
                  // reroll all pointed at this sphere instead of spawning a new
                  // gen every time the user adds images.
                  if (isComposite) {
                    setGenerating(true)
                    setGenLabel(`Upscaling ${images.length} image${images.length === 1 ? "" : "s"}…`)
                    setPct(20)
                    try {
                      const existing = (viewData.markers ?? []) as any[]
                      const normalized = existing.map((m, i) => {
                        const id =
                          m.type === "profile" ? "profile-card"
                          : m.type === "video" ? `video-${(m.data ?? {}).video_id}`
                          : m.type === "audio" ? `audio-${i}-${encodeURIComponent((m.data ?? {}).url || "").slice(0, 24)}`
                          : m.type === "bio-links" ? `bio-links-${i}`
                          : `image-${i}`
                        return {
                          id,
                          type: m.type,
                          yaw: m.yaw,
                          pitch: m.pitch,
                          scene_width: m.scene_width,
                        }
                      })
                      setGenLabel("Harmony-packing new markers…")
                      setPct(70)
                      const { new_markers, repacked_existing } = await uploadAsMarkers({
                        generationId: id,
                        images,
                        currentMarkers: normalized,
                        viewYaw: 0,
                        viewPitch: 0,
                      })
                      setPct(90)

                      // Merge: existing markers get new positions, new markers get appended.
                      const posById = new Map(repacked_existing.map((p) => [p.id, p]))
                      const mergedExisting = existing.map((m, i) => {
                        const mid =
                          m.type === "profile" ? "profile-card"
                          : m.type === "video" ? `video-${(m.data ?? {}).video_id}`
                          : m.type === "audio" ? `audio-${i}-${encodeURIComponent((m.data ?? {}).url || "").slice(0, 24)}`
                          : m.type === "bio-links" ? `bio-links-${i}`
                          : `image-${i}`
                        const p = posById.get(mid)
                        return p ? { ...m, yaw: p.yaw, pitch: p.pitch } : m
                      })
                      const appended = [
                        ...mergedExisting,
                        ...new_markers.map((nm) => ({
                          type: "image",
                          yaw: nm.yaw,
                          pitch: nm.pitch,
                          data: nm.data,
                          scene_scale: 1,
                        })),
                      ]

                      // Persist back to Supabase via the same path the viewer uses on Save.
                      if (supabase) {
                        await supabase
                          .from("generations")
                          .update({ environment: { markers: appended, profile: (viewData as any).profile ?? null } })
                          .eq("id", id)
                      }

                      setViewData({ ...viewData, markers: appended })
                      setPct(100)
                      setGenLabel(`Added ${new_markers.length} marker${new_markers.length === 1 ? "" : "s"}`)
                      setGenerating(false)
                    } catch (err) {
                      setGenLabel(`Failed: ${err instanceof Error ? err.message : "upload error"}`)
                      setGenerating(false)
                    }
                    return
                  }

                  // New Sphere mode — unchanged: spawn a fresh gen.
                  setGenerating(true)
                  setStep("scan_profile")
                  setPct(0)
                  setGenLabel("Processing uploads...")

                  try {
                    const { id: genId } = await startUploadGeneration(
                      images,
                      viewData.prompt,
                      undefined,
                      undefined,
                    )

                    let pollFailures = 0
                    const poll = setInterval(async () => {
                      try {
                        const status = await pollStatus(genId)
                        pollFailures = 0
                        setPct(status.pct)
                        setGenLabel(status.label)
                        if (status.step === "scrape") setStep("scan_profile")
                        else if (status.step === "upscale") setStep("extract_style")
                        else if (status.step === "compose") setStep("bg_prompt")
                        else if (status.step === "tiles" || status.step === "save") setStep("process")

                        if (status.status === "done") {
                          clearInterval(poll)
                          setViewData({
                            ...viewData,
                            image_url: status.image_url || viewData.image_url,
                            tile_stem: status.tile_stem || viewData.tile_stem,
                            tile_base_url: status.tile_base_url || viewData.tile_base_url,
                          })
                          setGenerating(false)
                        } else if (status.status === "failed") {
                          clearInterval(poll)
                          setGenLabel(`Error: ${status.error}`)
                          setGenerating(false)
                        }
                      } catch {
                        pollFailures++
                        if (pollFailures >= 10) {
                          clearInterval(poll)
                          setGenLabel("Lost connection — please try again")
                          setGenerating(false)
                        }
                      }
                    }, 1000)
                  } catch {
                    setGenLabel("Failed to start — please try again")
                    setGenerating(false)
                  }
                }}
                disabled={generating}
                hasExistingSphere={!!(viewData.tile_stem && viewData.tile_base_url)}
              />
            </div>
          </>
        )}

        {!generating && viewData.sphere_spec && viewData.bg_prompt && (
          <div className="mt-6">
            <SphereSpecViewer spec={viewData.sphere_spec} bgPrompt={viewData.bg_prompt} />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-6">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs text-muted-foreground">
            Made with{" "}
            <Link href="/" className="text-blue-400 hover:underline">
              Biosphere
            </Link>{" "}
            — AI-Powered 360° Biosphere Generation
          </p>
          <p className="font-mono text-[10px] text-muted-foreground/40 mt-1">{process.env.NEXT_PUBLIC_COMMIT_HASH}</p>
        </div>
      </footer>

      {/* Delete modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Delete this sphere?</h3>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the sphere and all its tiles. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-white/10 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await deleteGeneration(id)
                  setShowDeleteModal(false)
                  router.push("/examples")
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
