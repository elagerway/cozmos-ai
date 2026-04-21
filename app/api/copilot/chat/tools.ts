import type { Tool } from "@anthropic-ai/sdk/resources/messages"

// Tool schemas for the Biosphere copilot. These are executed by the CLIENT —
// the server just forwards the tool_use blocks to the client and awaits
// tool_result blocks on the next request. This keeps the server stateless and
// lets the client own all sphere state (markers, viewer pose, etc).

export const COPILOT_TOOLS: Tool[] = [
  {
    name: "regenerate_background",
    description:
      "Reroll the sphere's background with a new Skybox prompt. This replaces the 360° environment but preserves all markers. If variants=true (default), generates 4 × 8K previews for the user to pick from. If false, renders one full 16K directly (faster, lower quality ceiling).",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The Skybox prompt describing the new environment. Be specific about lighting, spatial cues, color palette.",
        },
        style_id: {
          type: "integer",
          description: "Blockade Labs style ID. 119=Photoreal M3, 120=Anime, 126=Cinematic, 127=Fantasy, 128=Dreamscape, 7=Realistic M1.",
        },
        negative_text: {
          type: "string",
          description: "Things to avoid (warping, text, artifacts). Omit to use the sensible default.",
        },
        variants: {
          type: "boolean",
          description: "If true (default), generate 4 preview variants for the user to choose from. If false, single-shot direct render.",
        },
        high_res: {
          type: "boolean",
          description: "If true, emit 16K tile tier (slower, sharper on extreme zoom). Default false.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "get_profile",
    description:
      "Get the current sphere's basic metadata: brand, original prompt, current background prompt (if rerolled), reroll count.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_markers",
    description:
      "List all markers currently in the sphere with their ID, type, content summary, and yaw/pitch position.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_current_view",
    description:
      "Get the user's current viewport: yaw, pitch, and fov (degrees). Useful when placing a new marker at where the user is looking.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_analytics",
    description:
      "Get per-marker engagement stats (selects count, dwell ms, dwell_rank, select_rank) over the last N days. Use this when the user asks about what's performing well or what to prune.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Window in days. Default 7." },
      },
    },
  },
  {
    name: "add_marker",
    description:
      "Add a new marker to the sphere. Drops at current view center if position omitted.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["image", "video", "audio", "bio-links"],
          description: "Marker kind.",
        },
        content: {
          type: "object",
          description:
            "Payload for the marker. Shape depends on type — ask get_markers if unsure.",
        },
        yaw: { type: "number", description: "Yaw in degrees (-180..180). Omit to use current view." },
        pitch: { type: "number", description: "Pitch in degrees (-90..90). Omit to use current view." },
      },
      required: ["type", "content"],
    },
  },
  {
    name: "move_marker",
    description: "Move an existing marker to a new yaw/pitch.",
    input_schema: {
      type: "object",
      properties: {
        marker_id: { type: "string" },
        yaw: { type: "number" },
        pitch: { type: "number" },
      },
      required: ["marker_id", "yaw", "pitch"],
    },
  },
  {
    name: "resize_marker",
    description:
      "Change a marker's scene_scale (size multiplier). 1.0 = default. Valid range 0.3..3.0.",
    input_schema: {
      type: "object",
      properties: {
        marker_id: { type: "string" },
        scale: { type: "number" },
      },
      required: ["marker_id", "scale"],
    },
  },
  {
    name: "delete_marker",
    description: "Permanently delete a marker from the sphere.",
    input_schema: {
      type: "object",
      properties: {
        marker_id: { type: "string" },
      },
      required: ["marker_id"],
    },
  },
  {
    name: "suggest_prompts",
    description:
      "Generate 3 improved Skybox prompts from a vague or short user intent. Returns an array of {title, prompt, style_id, rationale} objects the user can pick from. Use this when the user asks for ideas or their prompt is too generic (<10 words, no spatial cues).",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "The user's rough idea." },
        context_hint: {
          type: "string",
          description:
            "Optional extra context (e.g. 'music producer, LA-based, lo-fi vibe').",
        },
      },
      required: ["intent"],
    },
  },
]

export const COPILOT_SYSTEM = `You are the Biosphere copilot — an AI assistant embedded inside a 360° sphere editor.

You help the user:
- Reroll the background (with better prompts than they'd write themselves)
- Add, move, resize, and delete markers
- Read analytics about what's performing and what isn't
- Suggest prompts when their idea is vague

**Rules:**
- Always use a tool when the user's request calls for action — don't just describe what you'd do.
- When rerolling background, default to variants=true so the user can pick. Only single-shot (variants=false) if they explicitly say "just pick one" or similar.
- When a prompt is short/vague (<10 words, no spatial cues like "morning light", "neon", "wood textures"), call suggest_prompts first rather than regenerating with a bad prompt.
- Negative prompts: the tool has a sensible default — only override if the user explicitly calls out something to avoid.
- When moving/resizing markers, you often want to call get_markers first to find the right ID.
- Be concise. 1-3 sentences is usually enough.
- If the user asks something that requires state you don't have (brand, current markers, current view), call the relevant get_* tool first, THEN answer.

You are running in an edit-mode panel. Changes are live but reversible via the user's undo/edit UI.`
