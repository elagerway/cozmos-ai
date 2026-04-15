"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { SphereViewer } from "@/components/SphereViewer"
import { SphereSpecViewer } from "@/components/SphereSpecViewer"
import { ImageUploader } from "@/components/ImageUploader"
import { getGeneration } from "@/lib/dummy-data"
import { supabase, GenerationRow } from "@/lib/supabase"
import { startUploadGeneration, pollStatus } from "@/lib/pipeline-client"
import { GenerationProgress } from "@/components/GenerationProgress"
import { PipelineStep } from "@/lib/types"

interface ViewData {
  prompt: string
  title: string | null
  image_url: string | null
  tile_stem: string | null
  tile_base_url: string | null
  sphere_spec: any
  bg_prompt: string | null
  brand: string | null
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
        sphere_spec: gen.sphere_spec,
        bg_prompt: gen.bg_prompt,
        brand: (gen as any).brand || null,
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
          const row = data as GenerationRow
          setViewData({
            prompt: row.prompt,
            title: row.brand ? `${row.brand} — Generated Sphere` : "Generated Sphere",
            image_url: row.image_url,
            tile_stem: row.tile_stem,
            tile_base_url: row.tile_base_url,
            sphere_spec: null,
            bg_prompt: null,
            brand: row.brand,
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
              <span className="text-white font-bold text-[10px]">C</span>
            </div>
            <span className="text-sm text-muted-foreground">Cozmos</span>
          </Link>
          <Link
            href="/"
            className="text-xs text-blue-400 hover:underline"
          >
            Create your own
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-5xl mx-auto px-6 py-8 w-full">
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
              <SphereViewer
                imageUrl={viewData.image_url}
                tileStem={viewData.tile_stem}
                tileBaseUrl={viewData.tile_base_url}
              />
            )}

            <div className="mt-6">
              <ImageUploader
                onUpload={async (images, composite) => {
                  const isComposite = composite && viewData.tile_stem && viewData.tile_base_url
                  setGenerating(true)
                  setStep("scan_profile")
                  setPct(0)
                  setGenLabel(isComposite ? "Compositing onto environment..." : "Processing uploads...")

                  try {
                    const { id: genId } = await startUploadGeneration(
                      images,
                      viewData.prompt,
                      isComposite ? viewData.tile_stem || undefined : undefined,
                      isComposite ? viewData.tile_base_url || undefined : undefined,
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
              Cozmos
            </Link>{" "}
            — AI-Powered 360° Sphere Generation
          </p>
        </div>
      </footer>
    </div>
  )
}
