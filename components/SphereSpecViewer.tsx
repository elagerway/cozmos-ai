"use client"

import { useState } from "react"
import { SphereSpec } from "@/lib/types"

interface Props {
  spec: SphereSpec
  bgPrompt: string | null
}

export function SphereSpecViewer({ spec, bgPrompt }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">Generation Details</span>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4">
          {/* Spec */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
              Sphere Spec
            </p>
            <pre className="text-xs text-foreground/80 bg-black/30 rounded-lg p-3 overflow-x-auto font-mono">
              {JSON.stringify(spec, null, 2)}
            </pre>
          </div>

          {/* Background prompt */}
          {bgPrompt && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
                Image Prompt
              </p>
              <p className="text-sm text-foreground/70 bg-black/30 rounded-lg p-3 leading-relaxed">
                {bgPrompt}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
