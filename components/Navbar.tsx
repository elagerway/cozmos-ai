"use client"

import Link from "next/link"

export function Navbar() {
  return (
    <nav className="border-b border-white/10 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <span className="text-white font-bold text-sm">C</span>
          </div>
          <span className="font-semibold text-foreground tracking-tight">
            Cozmos
          </span>
        </Link>

        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Dashboard
        </Link>
      </div>
    </nav>
  )
}
