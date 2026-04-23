"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

// Actions that the panel can perform via tool_use. The viewer passes
// implementations down — the panel just calls them and forwards results.
export interface CopilotActions {
  getProfile(): { brand: string | null; prompt: string; background_prompt?: string | null; reroll_count?: number }
  getMarkers(): Array<{ id: string; type: string; yaw: number; pitch: number; scene_scale?: number; summary: string }>
  getCurrentView(): { yaw: number; pitch: number; fov: number }
  addMarker(input: { type: string; content: unknown; yaw?: number; pitch?: number }): Promise<{ id: string }>
  moveMarker(input: { marker_id: string; yaw: number; pitch: number }): Promise<void>
  resizeMarker(input: { marker_id: string; scale: number }): Promise<void>
  deleteMarker(input: { marker_id: string }): Promise<void>
  regenerateBackground(input: {
    prompt: string
    style_id?: number
    negative_text?: string
    variants?: boolean
    high_res?: boolean
  }): Promise<{ status: "started"; job_id: string; kind: "direct" | "variants" }>
  getAnalytics(input: { days?: number }): Promise<unknown>
  excludeCategories(input: {
    types?: string[]
    platforms?: string[]
    tags?: string[]
    strictness?: number
  }): Promise<void>
}

interface Props {
  sphereId: string
  actions: CopilotActions
  onClose: () => void
  mountHost: HTMLElement
}

// Anthropic message-shape blocks we care about
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

interface Message {
  role: "user" | "assistant"
  content: string | ContentBlock[]
}

type Model = "claude-sonnet-4-6" | "claude-opus-4-7"

const HISTORY_KEY = (sphereId: string) => `copilot_history_${sphereId}`

export function CopilotPanel({ sphereId, actions, onClose, mountHost }: Props) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<Message[]>(() => loadHistory(sphereId))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<Model>("claude-sonnet-4-6")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Persist history per sphere across navigations within the session.
  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY(sphereId), JSON.stringify(messages))
    } catch {}
  }, [messages, sphereId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const runTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<{ result: string; is_error?: boolean }> => {
      try {
        switch (name) {
          case "get_profile":
            return { result: JSON.stringify(actions.getProfile()) }
          case "get_markers":
            return { result: JSON.stringify(actions.getMarkers()) }
          case "get_current_view":
            return { result: JSON.stringify(actions.getCurrentView()) }
          case "get_analytics": {
            const data = await actions.getAnalytics({ days: Number(args.days ?? 7) })
            return { result: JSON.stringify(data) }
          }
          case "exclude_categories": {
            const types = Array.isArray(args.types) ? args.types.map(String) : []
            const platforms = Array.isArray(args.platforms) ? args.platforms.map(String) : []
            const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
            await actions.excludeCategories({
              types,
              platforms,
              tags,
              strictness: args.strictness !== undefined ? Number(args.strictness) : 0.55,
            })
            return { result: JSON.stringify({ ok: true }) }
          }
          case "add_marker": {
            const res = await actions.addMarker({
              type: String(args.type),
              content: args.content as unknown,
              yaw: args.yaw !== undefined ? Number(args.yaw) : undefined,
              pitch: args.pitch !== undefined ? Number(args.pitch) : undefined,
            })
            return { result: JSON.stringify(res) }
          }
          case "move_marker":
            await actions.moveMarker({
              marker_id: String(args.marker_id),
              yaw: Number(args.yaw),
              pitch: Number(args.pitch),
            })
            return { result: JSON.stringify({ ok: true }) }
          case "resize_marker":
            await actions.resizeMarker({
              marker_id: String(args.marker_id),
              scale: Number(args.scale),
            })
            return { result: JSON.stringify({ ok: true }) }
          case "delete_marker":
            await actions.deleteMarker({ marker_id: String(args.marker_id) })
            return { result: JSON.stringify({ ok: true }) }
          case "regenerate_background": {
            const res = await actions.regenerateBackground({
              prompt: String(args.prompt),
              style_id: args.style_id !== undefined ? Number(args.style_id) : undefined,
              negative_text: args.negative_text !== undefined ? String(args.negative_text) : undefined,
              variants: args.variants === false ? false : true,
              high_res: Boolean(args.high_res),
            })
            return { result: JSON.stringify(res) }
          }
          case "suggest_prompts": {
            // Pure LLM side — return stub, Claude will synthesize suggestions itself
            // from its own reasoning. We'd need a second API call for this which
            // doubles cost; passing the intent back as a no-op result tells Claude
            // "use what you know to suggest".
            return {
              result: JSON.stringify({
                intent: String(args.intent ?? ""),
                context_hint: String(args.context_hint ?? ""),
                note: "Generate 3 concrete prompt suggestions inline in your next message.",
              }),
            }
          }
          default:
            return { result: `Unknown tool: ${name}`, is_error: true }
        }
      } catch (err) {
        return {
          result: err instanceof Error ? err.message : "Tool execution failed",
          is_error: true,
        }
      }
    },
    [actions]
  )

  const send = useCallback(
    async (userText: string) => {
      if (!userText.trim() || loading) return
      setError(null)
      setLoading(true)

      const newMessages: Message[] = [
        ...messages,
        { role: "user", content: userText.trim() },
      ]
      setMessages(newMessages)
      setInput("")

      try {
        let workingMessages = newMessages
        let iterations = 0
        const MAX_ITER = 8

        while (iterations < MAX_ITER) {
          iterations++
          const res = await fetch("/api/copilot/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: workingMessages,
              model,
              sphere_id: sphereId,
              session_id: getSessionId(),
              context: {
                sphere_id: sphereId,
                profile: actions.getProfile(),
                marker_count: actions.getMarkers().length,
                current_view: actions.getCurrentView(),
              },
            }),
          })

          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || "Chat request failed")
          }
          const data = await res.json()
          const assistantContent = data.content as ContentBlock[]
          workingMessages = [
            ...workingMessages,
            { role: "assistant", content: assistantContent },
          ]
          setMessages(workingMessages)

          // If no tool_use, we're done.
          const toolUses = assistantContent.filter((c) => c.type === "tool_use") as Extract<
            ContentBlock,
            { type: "tool_use" }
          >[]
          if (toolUses.length === 0 || data.stop_reason === "end_turn") break

          // Execute all tool_uses, collect tool_result blocks.
          const toolResults: ContentBlock[] = []
          for (const tu of toolUses) {
            const { result, is_error } = await runTool(tu.name, tu.input)
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: result,
              is_error,
            })
          }
          workingMessages = [
            ...workingMessages,
            { role: "user", content: toolResults },
          ]
          setMessages(workingMessages)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat failed")
      } finally {
        setLoading(false)
      }
    },
    [messages, loading, model, sphereId, actions, runTool]
  )

  function clearHistory() {
    setMessages([])
    try {
      sessionStorage.removeItem(HISTORY_KEY(sphereId))
    } catch {}
  }

  return createPortal(
    <div
      className="absolute top-0 right-0 h-full w-[400px] z-[95] flex flex-col bg-neutral-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <div className="text-sm font-semibold">Copilot</div>
          <div className="text-[10px] uppercase tracking-wide text-white/40">
            Cmd+K to toggle
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as Model)}
            className="rounded-md border border-white/10 bg-black/40 text-xs px-2 py-1 outline-none"
          >
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-opus-4-7">Opus 4.7</option>
          </select>
          <button
            onClick={clearHistory}
            title="Clear history"
            className="text-white/40 hover:text-white text-xs"
          >
            Clear
          </button>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            ✕
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-xs text-white/40 mt-4 space-y-2">
            <p>Try asking:</p>
            <ul className="space-y-1 pl-3 list-disc marker:text-white/20">
              <li>&ldquo;Make the background a cyberpunk alley at night&rdquo;</li>
              <li>&ldquo;Show me which markers get the least engagement&rdquo;</li>
              <li>&ldquo;Move the bio-links card to where I&apos;m looking&rdquo;</li>
              <li>&ldquo;Suggest 3 prompt ideas for a lo-fi music producer&rdquo;</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow key={i} message={m} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Thinking…
          </div>
        )}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      <form
        className="border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          rows={3}
          placeholder="Ask anything about this sphere…"
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none"
          disabled={loading}
        />
        <div className="flex justify-end mt-2">
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>,
    mountHost
  )
}

function MessageRow({ message }: { message: Message }) {
  if (message.role === "user") {
    // User messages with only tool_result content are system-generated — hide them.
    if (Array.isArray(message.content)) {
      const toolOnly = message.content.every((c) => c.type === "tool_result")
      if (toolOnly) return null
      return null
    }
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-500/80 px-3 py-2 text-sm text-white whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant: render text blocks as chat bubbles, tool_use blocks as chips.
  const blocks = Array.isArray(message.content) ? message.content : []
  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) => {
        if (b.type === "text") {
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-white/5 border border-white/10 px-3 py-2 text-sm text-white/90 whitespace-pre-wrap">
                {b.text}
              </div>
            </div>
          )
        }
        if (b.type === "tool_use") {
          return (
            <div
              key={i}
              className="inline-flex items-center gap-2 rounded-lg border border-purple-400/30 bg-purple-400/10 px-2.5 py-1 text-[11px] text-purple-200"
            >
              <span className="font-mono">⚙ {b.name}</span>
              <span className="text-purple-300/70 truncate max-w-[220px]">
                {formatToolInput(b.input)}
              </span>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

function formatToolInput(input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ""
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") {
      parts.push(`${k}="${v.length > 40 ? v.slice(0, 37) + "…" : v}"`)
    } else if (typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${v}`)
    } else {
      parts.push(`${k}=…`)
    }
  }
  return parts.join(" ")
}

function loadHistory(sphereId: string): Message[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY(sphereId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getSessionId(): string {
  try {
    let sid = sessionStorage.getItem("copilot_session_id")
    if (!sid) {
      sid = crypto.randomUUID()
      sessionStorage.setItem("copilot_session_id", sid)
    }
    return sid
  } catch {
    return "unknown"
  }
}
