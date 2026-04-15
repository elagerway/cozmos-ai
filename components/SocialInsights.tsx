"use client"

import { useState } from "react"
import { SocialProfile } from "@/lib/social-profiles"

interface Props {
  profile: SocialProfile
}

export function SocialInsights({ profile }: Props) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <span className="text-white font-bold text-xs">
              {profile.display_name.charAt(0)}
            </span>
          </div>
          <div className="text-left">
            <span className="font-medium text-foreground">
              {profile.display_name}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">
              {profile.handle} &middot; {profile.followers} followers
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full">
            SOCIAL INSIGHTS
          </span>
          <svg
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4">
          {/* Extracted colors */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
              Brand Colors
            </p>
            <div className="flex items-center gap-2">
              {profile.extracted.primary_colors.map((color, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div
                    className="w-6 h-6 rounded-md border border-white/10"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-mono text-muted-foreground">
                    {color}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Mood & Style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                Mood
              </p>
              <p className="text-sm text-foreground/80">
                {profile.extracted.mood}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                Brand Tone
              </p>
              <p className="text-sm text-foreground/80">
                {profile.extracted.brand_tone}
              </p>
            </div>
          </div>

          {/* Visual Style */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
              Visual Style
            </p>
            <p className="text-sm text-foreground/70 leading-relaxed">
              {profile.extracted.visual_style}
            </p>
          </div>

          {/* Key Themes */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
              Key Themes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {profile.extracted.key_themes.map((theme, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20"
                >
                  {theme}
                </span>
              ))}
            </div>
          </div>

          {/* Sample Captions */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
              Brand Voice Samples
            </p>
            <div className="space-y-1.5">
              {profile.extracted.sample_captions.map((caption, i) => (
                <p
                  key={i}
                  className="text-xs text-foreground/50 italic pl-3 border-l-2 border-violet-500/20"
                >
                  &ldquo;{caption}&rdquo;
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
