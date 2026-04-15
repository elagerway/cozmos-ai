"use client"

import { PipelineStep, PipelineStepDef, PIPELINE_STEPS, SOCIAL_PIPELINE_STEPS } from "@/lib/types"

interface Props {
  currentStep: PipelineStep
  pct: number
  label: string
  hasSocialProfile?: boolean
}

export function GenerationProgress({ currentStep, pct, label, hasSocialProfile }: Props) {
  const steps: PipelineStepDef[] = hasSocialProfile ? SOCIAL_PIPELINE_STEPS : PIPELINE_STEPS
  const currentIndex = steps.findIndex((s) => s.key === currentStep)

  // Calculate per-step progress for the current step
  function getStepProgress(i: number): number {
    if (i < currentIndex) return 100
    if (i > currentIndex) return 0
    // Current step — map overall pct into this step's range
    const stepStart = steps[i].pct
    const stepEnd = i + 1 < steps.length ? steps[i + 1].pct : 100
    const range = stepEnd - stepStart
    if (range <= 0) return 100
    // Show at least 20% when active so the bar is visibly filling
    const raw = ((pct - stepStart) / range) * 100
    return Math.min(100, Math.max(20, raw))
  }

  return (
    <div className="w-full max-w-lg mx-auto space-y-8">
      {/* Overall progress bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-muted-foreground font-mono">{pct}%</span>
        </div>
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Step indicators with per-step progress bars */}
      <div className="space-y-4">
        {steps.map((step, i) => {
          const isComplete = i < currentIndex
          const isCurrent = i === currentIndex
          const isSocialStep = step.key === "scan_profile" || step.key === "extract_style"
          const stepPct = getStepProgress(i)

          return (
            <div key={step.key} className="space-y-1.5">
              <div className="flex items-center gap-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 transition-all duration-500 ${
                    isComplete
                      ? isSocialStep
                        ? "bg-violet-500 text-white"
                        : "bg-emerald-500 text-white"
                      : isCurrent
                        ? isSocialStep
                          ? "bg-violet-500 text-white animate-pulse"
                          : "bg-blue-500 text-white animate-pulse"
                        : "bg-white/5 text-muted-foreground"
                  }`}
                >
                  {isComplete ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`text-sm transition-colors duration-300 ${
                    isComplete
                      ? isSocialStep
                        ? "text-violet-400"
                        : "text-emerald-400"
                      : isCurrent
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
                {isCurrent && (
                  <div className="ml-auto">
                    <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${
                      isSocialStep ? "border-violet-400" : "border-blue-400"
                    }`} />
                  </div>
                )}
              </div>
              {/* Per-step progress bar */}
              <div className="ml-9 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    isComplete
                      ? isSocialStep
                        ? "bg-violet-500"
                        : "bg-emerald-500"
                      : isCurrent
                        ? isSocialStep
                          ? "bg-violet-500"
                          : "bg-gradient-to-r from-blue-500 to-cyan-400"
                        : ""
                  }`}
                  style={{ width: `${stepPct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
