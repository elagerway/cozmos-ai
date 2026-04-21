import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { logAnthropicCall } from "@/lib/cost-tracker"
import { COPILOT_TOOLS, COPILOT_SYSTEM } from "./tools"

// Non-streaming copilot endpoint. The client executes tools locally (add/move
// marker, reroll background, fetch analytics) and reposts the tool_result so
// Claude can continue. One turn per HTTP call — keeps the server stateless.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const DEFAULT_MODEL = "claude-sonnet-4-6"
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"])

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const {
    messages,
    model: requestedModel,
    sphere_id,
    session_id,
    context,
  } = body as {
    messages?: Anthropic.MessageParam[]
    model?: string
    sphere_id?: string | null
    session_id?: string | null
    context?: Record<string, unknown>
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 })
  }

  const model =
    requestedModel && ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const systemPrompt = buildSystemPrompt(context)

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      tools: COPILOT_TOOLS,
      messages,
    })

    // Cost log — attributed to the sphere as generation_id so per-gen copilot
    // spend rolls up alongside initial-gen spend on the admin dashboard.
    await logAnthropicCall({
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      generationId: sphere_id ?? null,
      sessionId: session_id ?? null,
      feature: "copilot",
      operation: "copilot_turn",
      metadata: {
        stop_reason: response.stop_reason,
        tool_uses: response.content
          .filter((c) => c.type === "tool_use")
          .map((c) => (c as { name: string }).name),
      },
    })

    return NextResponse.json({
      id: response.id,
      model,
      stop_reason: response.stop_reason,
      content: response.content,
      usage: response.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function buildSystemPrompt(context?: Record<string, unknown>): string {
  const parts = [COPILOT_SYSTEM]
  if (context) {
    parts.push("\n\n--- CURRENT SPHERE CONTEXT ---")
    parts.push(JSON.stringify(context, null, 2))
  }
  return parts.join("")
}
