"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SphereViewer } from "@/components/SphereViewer"
import { SphereSpecViewer } from "@/components/SphereSpecViewer"
import { SocialInsights } from "@/components/SocialInsights"
import { ShareButton } from "@/components/ShareButton"
import { GenerationProgress } from "@/components/GenerationProgress"
import {
  EXAMPLES,
  SAMPLE_BRIEFS,
  getRandomImage,
  getRandomSpec,
  Example,
} from "@/lib/dummy-data"
import { SOCIAL_SAMPLE_BRIEFS, detectSocialProfile, SocialProfile } from "@/lib/social-profiles"
import { simulatePipeline } from "@/lib/simulate-pipeline"
import { startGeneration, startUploadGeneration, pollStatus, checkPipelineHealth } from "@/lib/pipeline-client"
import { ImageUploader } from "@/components/ImageUploader"
import { PipelineStep, SphereSpec } from "@/lib/types"
import { fetchGenerations, GenerationRow } from "@/lib/supabase"

export default function HomePage() {
  const [prompt, setPrompt] = useState("")

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [step, setStep] = useState<PipelineStep>("scan_profile")
  const [pct, setPct] = useState(0)
  const [label, setLabel] = useState("")
  const [done, setDone] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [spec, setSpec] = useState<SphereSpec | null>(null)
  const [bgPrompt, setBgPrompt] = useState<string | null>(null)
  const [submittedPrompt, setSubmittedPrompt] = useState("")
  const [detectedProfile, setDetectedProfile] = useState<SocialProfile | null>(null)
  const [lowResWarning, setLowResWarning] = useState(false)

  const resultRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Featured examples from localStorage
  const [featuredExamples, setFeaturedExamples] = useState<Example[]>([])
  useEffect(() => {
    // Load hardcoded featured examples
    const stored = localStorage.getItem("cozmos-featured")
    const hardcoded = stored
      ? EXAMPLES.filter((e) => new Set(JSON.parse(stored) as string[]).has(e.id))
      : EXAMPLES.filter((e) => e.featured)

    // Load generated spheres from Supabase, but only show ones the user starred
    const featuredSet = stored
      ? new Set(JSON.parse(stored) as string[])
      : new Set(EXAMPLES.filter((e) => e.featured).map((e) => e.id))

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
      // Only show starred/featured items on the homepage
      const all = [...hardcoded, ...generated]
      setFeaturedExamples(all.filter((e) => featuredSet.has(e.id)))
    })
  }, [])

  // Live detection of social profiles as user types
  const liveProfile = detectSocialProfile(prompt)

  const [tileStem, setTileStem] = useState<string | null>(null)
  const [tileBaseUrl, setTileBaseUrl] = useState<string | null>(null)
  const [durationS, setDurationS] = useState(52)

  async function handleGenerate() {
    if (!prompt.trim()) return

    const profile = detectSocialProfile(prompt.trim())
    const handle = profile?.handle?.replace("@", "")

    // Reset state
    setSubmittedPrompt(prompt.trim())
    setDetectedProfile(profile)
    setGenerating(true)
    setDone(false)
    setImageUrl(null)
    setTileStem(null)
    setLowResWarning(false)
    setSpec(null)
    setBgPrompt(null)
    setStep("scan_profile")
    setPct(0)
    setLabel("Starting...")

    // Scroll to result area
    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)

    // Clean up any previous simulation
    cleanupRef.current?.()

    // Extract URL from prompt if present
    const urlMatch = prompt.trim().match(/https?:\/\/[^\s]+/)
    const sourceUrl = urlMatch ? urlMatch[0] : undefined

    // Always try the real pipeline
    const pipelineUp = await checkPipelineHealth()

    if (pipelineUp) {
      try {
        const { id: genId } = await startGeneration(
          handle || "",
          prompt.trim(),
          sourceUrl
        )

        // Poll for updates
        let pollFailures = 0
        const poll = setInterval(async () => {
          try {
            const status = await pollStatus(genId)
            pollFailures = 0
            setPct(status.pct)
            setLabel(status.label)

            // Check for low-res warning
            if (status.low_res_warning) setLowResWarning(true)

            // Map pipeline steps to UI steps
            if (status.step === "scrape") setStep("scan_profile")
            else if (status.step === "upscale") setStep("extract_style")
            else if (status.step === "compose") setStep("bg_prompt")
            else if (status.step === "tiles" || status.step === "save") setStep("process")

            if (status.status === "done") {
              clearInterval(poll)
              setStep("done")
              setImageUrl(status.image_url || null)
              setTileStem(status.tile_stem || null)
              setTileBaseUrl(status.tile_base_url || null)
              setDurationS(status.duration_s || 52)
              setSpec(getRandomSpec())
              setBgPrompt(
                `360° sphere composed from ${status.image_count || 12} images${handle ? ` scraped from @${handle}'s web presence` : sourceUrl ? ` scraped from ${sourceUrl}` : ""}, AI-upscaled to 16K resolution.`
              )
              setDone(true)
              setGenerating(false)
            } else if (status.status === "failed") {
              clearInterval(poll)
              setLabel(`Error: ${status.error}`)
              setGenerating(false)
            }
          } catch {
            pollFailures++
            if (pollFailures >= 10) {
              clearInterval(poll)
              setLabel("Lost connection to pipeline — please try again")
              setGenerating(false)
            }
          }
        }, 1000)

        cleanupRef.current = () => clearInterval(poll)
        return
      } catch {
        // Pipeline failed to start — fall through to simulation
      }
    }

    // Fallback: simulated pipeline (only if real pipeline is down)
    cleanupRef.current = simulatePipeline((update) => {
      setStep(update.step)
      setPct(update.pct)
      setLabel(update.label)

      if (update.step === "done") {
        setImageUrl(getRandomImage(handle))
        setSpec(getRandomSpec())
        setBgPrompt(
          "A seamless 360-degree equirectangular panorama generated from the user's brief. Photorealistic quality with cinematic lighting."
        )
        setDone(true)
        setGenerating(false)
      }
    }, !!profile)
  }

  function handleReset() {
    setGenerating(false)
    setDone(false)
    setImageUrl(null)
    setTileStem(null)
    setTileBaseUrl(null)
    setLowResWarning(false)
    setSpec(null)
    setBgPrompt(null)
    setPrompt("")
    setSubmittedPrompt("")
    setDetectedProfile(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function handleUpload(images: string[]) {
    setSubmittedPrompt("Custom image upload")
    setDetectedProfile(null)
    setGenerating(true)
    setDone(false)
    setImageUrl(null)
    setTileStem(null)
    setTileBaseUrl(null)
    setLowResWarning(false)
    setSpec(null)
    setBgPrompt(null)
    setStep("scan_profile")
    setPct(0)
    setLabel("Uploading images...")

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)

    cleanupRef.current?.()

    try {
      const { id: genId } = await startUploadGeneration(images, prompt || "Custom upload sphere")

      let pollFailures = 0
      const poll = setInterval(async () => {
        try {
          const status = await pollStatus(genId)
          pollFailures = 0
          setPct(status.pct)
          setLabel(status.label)

          if (status.step === "scrape") setStep("scan_profile")
          else if (status.step === "upscale") setStep("extract_style")
          else if (status.step === "compose") setStep("bg_prompt")
          else if (status.step === "tiles" || status.step === "save") setStep("process")

          if (status.status === "done") {
            clearInterval(poll)
            setStep("done")
            setImageUrl(status.image_url || null)
            setTileStem(status.tile_stem || null)
            setTileBaseUrl(status.tile_base_url || null)
            setDurationS(status.duration_s || 52)
            setSpec(getRandomSpec())
            setBgPrompt(
              `360° sphere composed from ${status.image_count || images.length} uploaded images, AI-upscaled to 16K resolution.`
            )
            setDone(true)
            setGenerating(false)
          } else if (status.status === "failed") {
            clearInterval(poll)
            setLabel(`Error: ${status.error}`)
            setGenerating(false)
          }
        } catch {
          pollFailures++
          if (pollFailures >= 10) {
            clearInterval(poll)
            setLabel("Lost connection to pipeline — please try again")
            setGenerating(false)
          }
        }
      }, 1000)

      cleanupRef.current = () => clearInterval(poll)
    } catch {
      setLabel("Failed to start upload — please try again")
      setGenerating(false)
    }
  }

  const SUPABASE_CDN = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/spheres`
    : ""

  function handleSampleSphere(stem: string, label: string) {
    setSubmittedPrompt(`Pre-built 16K sphere: ${label}`)
    setDetectedProfile(null)
    setGenerating(true)
    setDone(false)
    setImageUrl(null)
    setTileStem(null)
    setTileBaseUrl(null)
    setLowResWarning(false)
    setSpec(null)
    setBgPrompt(null)
    setStep("scan_profile")
    setPct(0)
    setLabel("Loading high-res environment...")

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)

    cleanupRef.current?.()

    // Simulate progress steps with realistic timing
    const steps: { step: PipelineStep; pct: number; label: string; delay: number }[] = [
      { step: "scan_profile", pct: 5, label: "Loading environment data...", delay: 0 },
      { step: "scan_profile", pct: 10, label: "Found high-res source (16K)", delay: 400 },
      { step: "extract_style", pct: 25, label: "Analyzing environment lighting...", delay: 800 },
      { step: "extract_style", pct: 45, label: "Extracting color palette...", delay: 1200 },
      { step: "bg_prompt", pct: 65, label: "Preparing panoramic projection...", delay: 1600 },
      { step: "bg_prompt", pct: 75, label: "Mapping equirectangular tiles...", delay: 2000 },
      { step: "process", pct: 85, label: "Loading tile pyramid (170 tiles)...", delay: 2400 },
      { step: "process", pct: 95, label: "Finalizing sphere...", delay: 2800 },
    ]

    const timers: ReturnType<typeof setTimeout>[] = []

    for (const s of steps) {
      timers.push(setTimeout(() => {
        setStep(s.step)
        setPct(s.pct)
        setLabel(s.label)
      }, s.delay))
    }

    // Reveal the sphere — use Supabase CDN on production, local files on dev
    timers.push(setTimeout(() => {
      setStep("done")
      setPct(100)
      setLabel("Your sphere is ready")
      const isLocal = window.location.hostname === "localhost"
      if (isLocal) {
        setImageUrl(`/spheres/${stem}.jpg`)
        setTileStem(stem)
        setTileBaseUrl(null)
      } else {
        setImageUrl(`${SUPABASE_CDN}/${stem}.jpg`)
        setTileStem(stem)
        setTileBaseUrl(SUPABASE_CDN)
      }
      setSpec(null)
      setBgPrompt(`Pre-built 16K equirectangular environment from Polyhaven. 4-level progressive tile loading for razor-sharp detail at any zoom level.`)
      setDone(true)
      setGenerating(false)
    }, 3200))

    cleanupRef.current = () => timers.forEach(clearTimeout)
  }

  // Mix social and standard sample briefs
  const allSampleBriefs = [...SOCIAL_SAMPLE_BRIEFS.slice(0, 3), ...SAMPLE_BRIEFS.slice(0, 2)]

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-white/5 sticky top-0 z-50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="flex items-center gap-2"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="font-semibold text-foreground tracking-tight">
              Cozmos
            </span>
          </button>
          <Link
            href="/examples"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View Examples
          </Link>
        </div>
      </nav>

      {/* Hero + Generation Form */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          AI-Powered Sphere Generation
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
          From brief to{" "}
          <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            interactive 360°
          </span>{" "}
          sphere in seconds
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Describe your campaign in plain English. Point to a social media
          profile for style inspiration. Our AI extracts the brand&apos;s visual
          identity and generates a fully-interactive sphere.
        </p>

        {/* Generation form */}
        <div className="max-w-2xl mx-auto text-left space-y-4">
          <div className="relative">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Describe your campaign — mention @brand or paste a social profile URL for style inspiration...'
              className="min-h-[120px] bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground resize-none text-base"
              disabled={generating}
            />

            {/* Live social detection indicator */}
            {liveProfile && !generating && (
              <div className="absolute bottom-3 right-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-300 text-[11px] font-medium">
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">
                    {liveProfile.display_name.charAt(0)}
                  </span>
                </div>
                {liveProfile.display_name} detected
              </div>
            )}
          </div>

          {/* Pre-built high-res sample spheres */}
          <div className="pt-4 border-t border-white/5">
            <p className="text-xs text-muted-foreground mb-3">
              Or explore our hand selected briefs that output 16K spheres:
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { stem: "env-bell-tower", label: "Bell Tower" },
                { stem: "env-docklands", label: "Docklands" },
                { stem: "env-rogland-night", label: "Clear Night Sky" },
                { stem: "env-monkstown-castle", label: "Castle" },
                { stem: "env-red-wall", label: "Red Wall" },
                { stem: "env-peppermint-powerplant", label: "Powerplant" },
                { stem: "env-gym", label: "Gym" },
                { stem: "env-outdoor-storm", label: "Storm Sky" },
                { stem: "env-cozy-cafe", label: "Cozy Cafe" },
                { stem: "env-luxury-ballroom", label: "Ballroom" },
              ].map((s) => (
                <button
                  key={s.stem}
                  disabled={generating}
                  onClick={() => handleSampleSphere(s.stem, s.label)}
                  className="px-3 py-1.5 text-xs rounded-full border border-white/10 bg-transparent text-muted-foreground hover:text-foreground hover:border-white/20 hover:bg-white/5 transition-all disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating}
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white border-0"
          >
            {generating ? "Generating..." : "Generate Sphere"}
          </Button>
        </div>
      </section>

      {/* Generation Result — inline */}
      {(generating || done) && (
        <section
          ref={resultRef}
          className="max-w-4xl mx-auto px-6 py-12"
        >
          {/* Brief */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Brief
            </p>
            <p className="text-foreground">{submittedPrompt}</p>
          </div>

          {/* Progress or Sphere */}
          {!done ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <GenerationProgress
                currentStep={step}
                pct={pct}
                label={label}
                hasSocialProfile={!!detectedProfile}
              />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Social insights — show first if social profile was used */}
              {detectedProfile && (
                <SocialInsights profile={detectedProfile} />
              )}

              {imageUrl && <SphereViewer imageUrl={imageUrl} tileStem={tileStem} tileBaseUrl={tileBaseUrl} />}

              {/* Low-res warning */}
              {lowResWarning && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div>
                      <p className="text-sm text-amber-200 font-medium">
                        High resolution images could not be found.
                      </p>
                      <p className="text-sm text-amber-200/70 mt-1">
                        In order to obtain the best results when using this demo, please point to a destination that has 4K or preferably 8K imagery for your sphere. Alternatively, you can upload your images to be rendered into your sphere using the tool below.
                      </p>
                    </div>
                  </div>
                  <ImageUploader onUpload={handleUpload} disabled={generating} />
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <ShareButton generationId="demo" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="border-white/10 text-muted-foreground hover:text-foreground"
                >
                  Generate Another
                </Button>
              </div>

              {spec && bgPrompt && (
                <SphereSpecViewer spec={spec} bgPrompt={bgPrompt} />
              )}
            </div>
          )}
        </section>
      )}

      {/* How it Works — only show when not generating */}
      {!generating && !done && (
        <>
          <section className="max-w-5xl mx-auto px-6 py-20">
            <h2 className="text-2xl font-bold text-center mb-12">
              How it works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  step: "01",
                  title: "Describe",
                  desc: "Write a brief describing your campaign. Mention a social media profile like @nike or @starbucks to pull their visual style automatically.",
                },
                {
                  step: "02",
                  title: "Generate",
                  desc: "Our AI scans the social profile, extracts brand colors, mood, and visual style, then generates a panoramic background that matches.",
                },
                {
                  step: "03",
                  title: "Explore",
                  desc: "View your rendered 360° sphere in the browser. Drag to look around. Share with a link — no login required.",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="relative p-6 rounded-xl border border-white/5 bg-white/[0.02]"
                >
                  <span className="text-xs font-mono text-blue-400/60 mb-3 block">
                    {item.step}
                  </span>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Sample Spheres Gallery */}
          <section className="max-w-6xl mx-auto px-6 py-20">
            <h2 className="text-2xl font-bold text-center mb-4">
              Sample Generations
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
              Each sphere was generated from a single sentence brief. Click to
              explore in 360°.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {featuredExamples.map((gen) => (
                <Link
                  key={gen.id}
                  href={`/g/${gen.id}`}
                  className="group relative aspect-[2/1] rounded-xl overflow-hidden border border-white/10 hover:border-white/20 transition-all"
                >
                  {gen.image_url && (
                    <img
                      src={gen.image_url}
                      alt={gen.sphere_spec?.campaign_name || "Sphere"}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <p className="text-sm font-medium text-white">
                      {gen.sphere_spec?.campaign_name || gen.prompt.slice(0, 50)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>

        </>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>Cozmos &copy; 2026</span>
          <span>AI-Powered Sphere Generation</span>
        </div>
      </footer>
    </div>
  )
}
