"use client"

import { useCallback, useState } from "react"

interface Props {
  onUpload: (images: string[], composite: boolean) => void
  disabled?: boolean
  hasExistingSphere?: boolean
}

export function ImageUploader({ onUpload, disabled, hasExistingSphere }: Props) {
  const [previews, setPreviews] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [composite, setComposite] = useState(true)

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) =>
        f.type.startsWith("image/")
      )
      if (fileArray.length === 0) return

      const readers = fileArray.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(file)
          })
      )

      Promise.all(readers).then((results) => {
        setPreviews((prev) => [...prev, ...results])
      })
    },
    []
  )

  function handleRemove(index: number) {
    setPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  function handleGenerate() {
    if (previews.length === 0) return
    onUpload(previews, composite && !!hasExistingSphere)
  }

  return (
    <div className="space-y-3">
      {/* Composite / New Sphere toggle — always visible when there's an existing sphere */}
      {hasExistingSphere && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setComposite(true)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              composite
                ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                : "border-white/10 text-muted-foreground hover:text-foreground"
            }`}
          >
            Composite
          </button>
          <button
            onClick={() => setComposite(false)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              !composite
                ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                : "border-white/10 text-muted-foreground hover:text-foreground"
            }`}
          >
            New Sphere
          </button>
          <span className="text-[10px] text-muted-foreground/60">
            {composite
              ? "Layer your images onto the current environment"
              : "Generate a fresh sphere from your images"}
          </span>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
          dragging
            ? "border-blue-400 bg-blue-500/10"
            : "border-white/10 hover:border-white/20 bg-white/[0.02]"
        } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
        onClick={() => {
          const input = document.createElement("input")
          input.type = "file"
          input.multiple = true
          input.accept = "image/*"
          input.onchange = () => input.files && handleFiles(input.files)
          input.click()
        }}
      >
        <svg
          className="w-8 h-8 mx-auto mb-2 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm text-muted-foreground">
          {hasExistingSphere && composite
            ? "Drop images to composite onto this sphere"
            : "Drop images here or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          For best results, use 4K+ resolution images
        </p>
      </div>

      {/* Previews */}
      {previews.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {previews.map((src, i) => (
              <div key={i} className="relative group">
                <img
                  src={src}
                  alt={`Upload ${i + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-white/10"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(i)
                  }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={disabled}
            className="w-full h-10 text-sm font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white transition-all disabled:opacity-50"
          >
            {composite && hasExistingSphere
              ? `Composite ${previews.length} image${previews.length !== 1 ? "s" : ""} onto sphere`
              : `Generate Sphere from ${previews.length} image${previews.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  )
}
