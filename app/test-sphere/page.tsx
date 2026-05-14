"use client"

import { useState } from "react"
import { InteractiveSphereViewer } from "@/components/InteractiveSphereViewer"

type Sample = {
  slug: string
  label: string
  prompt: string
  note: string
}

const SAMPLES: Sample[] = [
  {
    slug: "studio",
    label: "Music Studio",
    prompt: "Music Studio Background",
    note: "Interior. Equirect dome ceiling present. Wrap has soft mismatch.",
  },
  {
    slug: "library",
    label: "Library",
    prompt: "Cozy library with stone fireplace, leather armchairs, tall bookshelves, warm lamp light",
    note: "Interior. Strongest equirect result — clean zenith dome, bookshelves wrap continuously.",
  },
  {
    slug: "beach",
    label: "Beach (outdoor)",
    prompt: "Tropical beach at sunset, palm trees, ocean horizon, soft pastel sky",
    note: "Outdoor. Horizontal wrap looks good, but no zenith convergence — sky will band, not dome.",
  },
  {
    slug: "forest",
    label: "Forest (outdoor)",
    prompt: "Sunlit forest clearing in autumn, tall trees, mossy ground, golden light through leaves",
    note: "Outdoor. Same as beach — canopy fails to dome at zenith.",
  },
]

export default function TestSpherePage() {
  const [current, setCurrent] = useState<Sample>(SAMPLES[0])
  const [upscaled, setUpscaled] = useState<boolean>(true)

  const imageUrl = upscaled
    ? `/test-spheres/${current.slug}_upscaled.jpg`
    : `/test-spheres/${current.slug}.jpg`

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">OpenAI gpt-image-2 sphere prove-out</h1>
          <p className="text-sm text-white/60">
            Loaded in the production InteractiveSphereViewer via its new non-tile fallback path.
            Pan up to inspect zenith, drag to 0°/360° to inspect the wrap seam.
          </p>
        </header>

        <nav className="flex flex-wrap items-center gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.slug}
              onClick={() => setCurrent(s)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                current.slug === s.slug
                  ? "bg-blue-500/20 border-blue-400 text-white"
                  : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
              }`}
            >
              {s.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-white/50">Resolution:</span>
            <button
              onClick={() => setUpscaled(false)}
              className={`px-2.5 py-1 rounded-md border text-xs transition ${
                !upscaled
                  ? "bg-amber-500/20 border-amber-400 text-white"
                  : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
              }`}
            >
              Raw 3840×1920
            </button>
            <button
              onClick={() => setUpscaled(true)}
              className={`px-2.5 py-1 rounded-md border text-xs transition ${
                upscaled
                  ? "bg-emerald-500/20 border-emerald-400 text-white"
                  : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
              }`}
            >
              Upscaled 14142×7071 (fal ESRGAN 4×)
            </button>
          </div>
        </nav>

        <InteractiveSphereViewer
          key={`${current.slug}-${upscaled ? "up" : "raw"}`}
          imageUrl={imageUrl}
          tileStem={null}
          tileBaseUrl={null}
          markers={[]}
          sphereId="test-sphere-prove-out"
        />

        <section className="text-sm text-white/70 space-y-1">
          <div>
            <span className="text-white/40">Prompt: </span>
            <span className="text-white/90">{current.prompt}</span>
          </div>
          <div>
            <span className="text-white/40">Notes: </span>
            <span>{current.note}</span>
          </div>
          <div className="text-xs text-white/40 pt-2">
            Image: <code className="text-white/60">{imageUrl}</code>
          </div>
        </section>
      </div>
    </div>
  )
}
