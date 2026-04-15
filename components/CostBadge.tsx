interface Props {
  costUsd: number
  durationS: number
}

export function CostBadge({ costUsd, durationS }: Props) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-muted-foreground font-mono">
      <span>${costUsd.toFixed(3)}</span>
      <span className="text-white/20">&middot;</span>
      <span>{durationS}s</span>
    </div>
  )
}
