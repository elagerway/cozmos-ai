"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SAMPLE_BRIEFS } from "@/lib/dummy-data"

export function GenerationForm() {
  const [prompt, setPrompt] = useState("")
  const router = useRouter()

  function handleSubmit() {
    if (!prompt.trim()) return
    // Store the prompt in sessionStorage for the result page to pick up
    const fakeId = `gen-${Date.now()}`
    sessionStorage.setItem(
      fakeId,
      JSON.stringify({ prompt: prompt.trim(), isNew: true })
    )
    router.push(`/dashboard/${fakeId}`)
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your campaign in plain English..."
          className="min-h-[120px] bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground resize-none text-base"
        />
      </div>

      {/* Sample brief chips */}
      <div className="flex flex-wrap gap-2">
        {SAMPLE_BRIEFS.map((brief, i) => (
          <button
            key={i}
            onClick={() => setPrompt(brief)}
            className="px-3 py-1.5 text-xs rounded-full bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors border border-white/5 truncate max-w-[280px]"
          >
            {brief}
          </button>
        ))}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!prompt.trim()}
        className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white border-0"
      >
        Generate Sphere
      </Button>
    </div>
  )
}
