"""
Behind-the-scenes prompt rewriter for the OpenAI sphere generation path.

User types a short scene description ("Music Studio Background"); Claude Haiku
rewrites it into a more photographically detailed scene description that
steers gpt-image-2 away from its known weak modes — most importantly the
"dense mechanical micro-detail hallucination" failure where it averages rows
of buttons / readouts / faders into noise.

Sync and async variants both live here so the prove-out CLI and the async
pipeline server can share one system prompt + one place to tune behavior.
"""

from __future__ import annotations

import os
from typing import Optional

from cost_tracker import log_anthropic


REWRITER_MODEL = "claude-haiku-4-5-20251001"

REWRITE_SYSTEM_PROMPT = """You rewrite short scene descriptions into longer photographic scene descriptions for an AI image generation pipeline that produces 360-degree equirectangular VR panoramas via OpenAI's gpt-image-2.

The image model has known structural weaknesses you must steer around:
1. Dense mechanical micro-detail hallucinates badly — rows of small buttons, faders, knobs, readouts, switches, and rack-gear surfaces become noise ("rocks in glass" / "feathered twigs" garbage).
2. Text on equipment is unreadable; the model invents glyphs.
3. Tight foreground gear (mixing desks, instruments, cockpits, lab benches, control panels) is the worst case.

Your rewrite must:
- Preserve the user's core scene intent. If they asked for a music studio, the result should still read as a music studio.
- Move any gear/equipment to the background, soft focus, or out of the dominant framing. Foreground should be clean architectural elements: furniture, walls, lighting fixtures, art, plants, rugs, fabric textures.
- Use real architectural-photography language: warm/cool lighting choice, soft shadows, shallow depth of field, real-camera color, time of day if relevant.
- Specify materials and textures concretely (oak floor, leather sofa, brushed brass fixture) so the model has something to render that isn't gear.
- Keep the rewrite under ~100 words.
- Output ONLY the rewritten scene description as a single paragraph. No preamble, no markdown, no quote marks, no labels like "Rewrite:". Just the description.

Examples:

Input: Music Studio Background
Output: A cozy upscale music studio lounge at night. A warm tan leather sofa centered in the room, a deep wine-colored vintage rug on oak floors, two brass floor lamps casting warm pools of light, framed vinyl records on the walls, a small mid-century bar cart with amber glassware. Acoustic walnut wood-slat panels line the walls. A mixing desk and rack gear sit softly out of focus in the deep background, lit by warm amber ambient light. Tall potted plants in the corners.

Input: Hockey rink penalty box
Output: A view from inside an empty NHL penalty box at game time. Polished wood-and-glass partitions in the immediate foreground, dark padded blue bench seat below, scuffed white boards and crisp red lines of the rink filling the mid-ground. Stadium seating rises in tiered dark rows beyond, dimmed but warmly lit by overhead arena floods that catch the ice surface. Real-camera depth, soft directional lighting, photojournalistic feel.

Input: Cyberpunk neon alley
Output: A rain-slick narrow alley at night between two tall brutalist buildings. Wet asphalt reflects a wash of magenta and cyan neon from signage glowing softly out of focus in the deep background. Tight foreground: weathered brick walls, a metal fire escape, scattered cardboard boxes, steam rising from a manhole. Warm tungsten light spills from a single open doorway on the right. Cinematic depth of field, photographically faithful textures."""


def _build_messages(user_prompt: str) -> list[dict]:
    return [{"role": "user", "content": user_prompt.strip()}]


def rewrite_user_prompt_sync(
    user_prompt: str,
    *,
    generation_id: Optional[str] = None,
    verbose: bool = True,
) -> str:
    """Sync version. Used by the CLI prove-out script."""
    from anthropic import Anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    client = Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=REWRITER_MODEL,
        max_tokens=300,
        system=REWRITE_SYSTEM_PROMPT,
        messages=_build_messages(user_prompt),
    )
    rewritten = resp.content[0].text.strip()

    log_anthropic(
        model=REWRITER_MODEL,
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
        generation_id=generation_id,
        feature="bg_reroll",
        operation="prompt_rewrite",
    )

    if verbose:
        print(f"  Rewriter: {user_prompt!r}")
        print(f"        →  {rewritten!r}")

    return rewritten


async def rewrite_user_prompt(
    user_prompt: str,
    *,
    generation_id: Optional[str] = None,
) -> str:
    """Async version. Used by the production pipeline."""
    from anthropic import AsyncAnthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    client = AsyncAnthropic(api_key=api_key)
    resp = await client.messages.create(
        model=REWRITER_MODEL,
        max_tokens=300,
        system=REWRITE_SYSTEM_PROMPT,
        messages=_build_messages(user_prompt),
    )
    rewritten = resp.content[0].text.strip()

    log_anthropic(
        model=REWRITER_MODEL,
        input_tokens=resp.usage.input_tokens,
        output_tokens=resp.usage.output_tokens,
        generation_id=generation_id,
        feature="bg_reroll",
        operation="prompt_rewrite",
    )

    return rewritten


if __name__ == "__main__":
    import sys
    raw = sys.argv[1] if len(sys.argv) > 1 else "Music Studio Background"
    rewritten = rewrite_user_prompt_sync(raw)
    print()
    print(rewritten)
