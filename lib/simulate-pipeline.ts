import { PipelineStep } from "./types"

interface PipelineUpdate {
  step: PipelineStep
  label: string
  pct: number
}

const STANDARD_STEPS: { step: PipelineStep; label: string; pct: number; delay: number }[] = [
  { step: "scan_profile", label: "Scraping images...", pct: 5, delay: 0 },
  { step: "extract_style", label: "AI upscaling...", pct: 10, delay: 2000 },
  { step: "bg_prompt", label: "Composing panorama...", pct: 70, delay: 5000 },
  { step: "process", label: "Generating tiles...", pct: 82, delay: 7000 },
  { step: "done", label: "Your sphere is ready", pct: 100, delay: 8500 },
]

const SOCIAL_STEPS: { step: PipelineStep; label: string; pct: number; delay: number }[] = [
  { step: "scan_profile", label: "Scraping images...", pct: 5, delay: 0 },
  { step: "extract_style", label: "AI upscaling...", pct: 10, delay: 2500 },
  { step: "bg_prompt", label: "Composing panorama...", pct: 70, delay: 6000 },
  { step: "process", label: "Generating tiles...", pct: 82, delay: 8000 },
  { step: "done", label: "Your sphere is ready", pct: 100, delay: 10000 },
]

export function simulatePipeline(
  onUpdate: (update: PipelineUpdate) => void,
  hasSocialProfile: boolean = false
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []
  const steps = hasSocialProfile ? SOCIAL_STEPS : STANDARD_STEPS

  for (const s of steps) {
    const t = setTimeout(() => {
      onUpdate({ step: s.step, label: s.label, pct: s.pct })
    }, s.delay)
    timers.push(t)
  }

  return () => timers.forEach(clearTimeout)
}
