"use client"

import { useEffect, useRef } from "react"

// Per-sphere event telemetry — patents GB '335 / US '706 (event tracking + heatmap).
//
// Usage:
//   const track = useEventTracker(sphereId)
//   track("marker_select", { marker_id: "video-abc", meta: {...} })
//
// Events are queued in memory and flushed to /api/events every 3 s. On page
// hide / tab close the queue is flushed via navigator.sendBeacon so nothing
// is lost. sessionStorage persists session_id across in-page navigations.

type EventPayload = {
  type: string
  marker_id?: string
  meta?: Record<string, unknown>
}

type QueuedEvent = {
  type: string
  marker_id?: string
  meta: Record<string, unknown>
}

const SESSION_STORAGE_KEY = "biosphere-session-id"
const FLUSH_INTERVAL_MS = 3000
const MAX_QUEUE = 200

function uuid(): string {
  // Prefer crypto.randomUUID (Safari 15.4+, all modern browsers); fall back to
  // a v4 from random bytes if unavailable (shouldn't happen in target browsers).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  const hex = "0123456789abcdef"
  const b: string[] = []
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) b.push("-")
    else if (i === 14) b.push("4")
    else if (i === 19) b.push(hex[8 + Math.floor(Math.random() * 4)])
    else b.push(hex[Math.floor(Math.random() * 16)])
  }
  return b.join("")
}

function getSessionId(): string {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000000"
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (existing) return existing
    const fresh = uuid()
    sessionStorage.setItem(SESSION_STORAGE_KEY, fresh)
    return fresh
  } catch {
    return uuid()
  }
}

export type TrackFn = (
  type: string,
  payload?: { marker_id?: string; meta?: Record<string, unknown> }
) => void

/**
 * Track UI events against a sphere. Returns a stable `track(type, payload?)` function.
 * Events are batched and flushed every 3 s; on page hide the queue is sent via sendBeacon.
 */
export function useEventTracker(sphereId: string | null | undefined): TrackFn {
  // Keep the queue + sphereId in refs so the same function identity survives re-renders.
  const queueRef = useRef<QueuedEvent[]>([])
  const sphereIdRef = useRef<string | null | undefined>(sphereId)
  const sessionIdRef = useRef<string>("")
  const flushingRef = useRef<boolean>(false)

  // Lazy session id on first client render (avoids SSR window access).
  if (typeof window !== "undefined" && !sessionIdRef.current) {
    sessionIdRef.current = getSessionId()
  }

  // Keep latest sphereId captured for the flush-on-unmount path.
  useEffect(() => {
    sphereIdRef.current = sphereId
  }, [sphereId])

  useEffect(() => {
    if (typeof window === "undefined") return

    const flush = async (opts?: { beacon?: boolean }) => {
      const sid = sphereIdRef.current
      if (!sid) return
      if (queueRef.current.length === 0) return
      if (flushingRef.current) return
      const toSend = queueRef.current.splice(0, queueRef.current.length)
      flushingRef.current = true
      try {
        const body = JSON.stringify({
          sphere_id: sid,
          session_id: sessionIdRef.current,
          events: toSend,
        })
        if (opts?.beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const ok = navigator.sendBeacon(
            "/api/events",
            new Blob([body], { type: "application/json" })
          )
          if (!ok) queueRef.current.unshift(...toSend) // beacon rejected, re-queue
        } else {
          const res = await fetch("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          })
          if (!res.ok) queueRef.current.unshift(...toSend)
        }
      } catch {
        queueRef.current.unshift(...toSend)
      } finally {
        flushingRef.current = false
      }
    }

    const interval = window.setInterval(() => {
      void flush()
    }, FLUSH_INTERVAL_MS)

    const onHide = () => void flush({ beacon: true })
    window.addEventListener("pagehide", onHide)
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide()
    })

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("pagehide", onHide)
      void flush() // best-effort on unmount
    }
  }, [])

  const track: TrackFn = (type, payload) => {
    if (!sphereIdRef.current) return
    if (queueRef.current.length >= MAX_QUEUE) {
      // Drop oldest to bound memory on pathological event storms.
      queueRef.current.shift()
    }
    queueRef.current.push({
      type,
      marker_id: payload?.marker_id,
      meta: payload?.meta || {},
    })
  }
  return track
}
