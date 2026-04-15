"use client"

import { use } from "react"
import Link from "next/link"
import { SphereViewer } from "@/components/SphereViewer"
import { SphereSpecViewer } from "@/components/SphereSpecViewer"
import { getGeneration } from "@/lib/dummy-data"

export default function PublicSharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const gen = getGeneration(id)

  if (!gen) {
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
        {/* Campaign name */}
        {gen.sphere_spec && (
          <h1 className="text-2xl font-bold mb-2">
            {gen.sphere_spec.campaign_name}
          </h1>
        )}
        <p className="text-muted-foreground mb-6">{gen.prompt}</p>

        {/* Sphere */}
        {gen.image_url && <SphereViewer imageUrl={gen.image_url} />}


        {/* Spec */}
        {gen.sphere_spec && gen.bg_prompt && (
          <div className="mt-6">
            <SphereSpecViewer spec={gen.sphere_spec} bgPrompt={gen.bg_prompt} />
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
