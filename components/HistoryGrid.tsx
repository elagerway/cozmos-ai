"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { DUMMY_GENERATIONS } from "@/lib/dummy-data"

export function HistoryGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {DUMMY_GENERATIONS.map((gen) => (
        <Link
          key={gen.id}
          href={`/dashboard/${gen.id}`}
          className="group relative rounded-xl overflow-hidden border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-all hover:border-white/20"
        >
          {/* Thumbnail */}
          <div className="aspect-[2/1] bg-gradient-to-br from-white/5 to-white/[0.02] relative overflow-hidden">
            {gen.image_url && (
              <img
                src={gen.image_url}
                alt={gen.sphere_spec?.campaign_name || "Sphere"}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            )}
            <div className="absolute top-2 right-2">
              <Badge
                variant="secondary"
                className={`text-[10px] ${
                  gen.status === "done"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : gen.status === "failed"
                      ? "bg-red-500/20 text-red-400 border-red-500/30"
                      : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                }`}
              >
                {gen.status}
              </Badge>
            </div>
          </div>

          {/* Info */}
          <div className="p-3 space-y-1.5">
            <p className="text-sm text-foreground line-clamp-2 leading-snug">
              {gen.prompt}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>${gen.cost_usd?.toFixed(3)}</span>
              <span>&middot;</span>
              <span>{gen.duration_s}s</span>
              <span>&middot;</span>
              <span>
                {new Date(gen.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
