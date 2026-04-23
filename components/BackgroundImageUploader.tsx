"use client"

import { useCallback, useRef, useState } from "react"

interface Props {
  onUpload: (dataUri: string, width: number, height: number) => void | Promise<void>
  disabled?: boolean
}

const MIN_WIDTH = 1024

export function BackgroundImageUploader({ onUpload, disabled }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [preview, setPreview] = useState<{ dataUri: string; width: number; height: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    setError(null)
    setPreview(null)
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      setError("Use a PNG, JPEG, or WebP image.")
      return
    }
    setLoadingPreview(true)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUri = typeof reader.result === "string" ? reader.result : ""
      const probe = new Image()
      probe.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = probe
        if (w < MIN_WIDTH) {
          setLoadingPreview(false)
          setError(`Image too small (${w}×${h}). Minimum 1024 px wide.`)
          return
        }
        setPreview({ dataUri, width: w, height: h })
        setLoadingPreview(false)
      }
      probe.onerror = () => {
        setLoadingPreview(false)
        setError("Couldn't read that image.")
      }
      probe.src = dataUri
    }
    reader.onerror = () => {
      setLoadingPreview(false)
      setError("Couldn't read that file.")
    }
    reader.readAsDataURL(file)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (disabled) return
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [disabled, handleFile],
  )

  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      e.target.value = ""
    },
    [handleFile],
  )

  const isEquirect = preview && Math.abs(preview.width / preview.height - 2) <= 0.2

  return (
    <div className="space-y-3">
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
          disabled
            ? "border-white/5 bg-white/[0.02] cursor-not-allowed opacity-60"
            : dragging
              ? "border-blue-400/60 bg-blue-500/5"
              : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onSelect}
          className="hidden"
          disabled={disabled}
        />
        <svg
          className="w-8 h-8 mx-auto mb-2 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        <p className="text-sm text-muted-foreground">
          Drop any photo, or click to browse
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          We&apos;ll turn it into a 360° environment.
        </p>
      </div>

      {loadingPreview && (
        <div className="text-xs text-muted-foreground/80">Reading image…</div>
      )}

      {error && (
        <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/5 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {preview && !error && (
        <div className="flex items-center gap-4">
          <img
            src={preview.dataUri}
            alt="preview"
            className="h-20 w-40 object-cover rounded-lg border border-white/10"
          />
          <div className="flex-1 text-xs text-muted-foreground">
            <div className="text-foreground/90">
              {preview.width}×{preview.height}
            </div>
            <div className="text-muted-foreground/60">
              {isEquirect
                ? "Looks like a 360° photo — will render as-is."
                : "Will be extended to 360° by AI (~30–60s)."}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onUpload(preview.dataUri, preview.width, preview.height)}
            className="h-10 px-4 text-sm font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white transition-all disabled:opacity-50 whitespace-nowrap"
          >
            Use as background
          </button>
        </div>
      )}
    </div>
  )
}
