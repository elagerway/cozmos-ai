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


REWRITER_MODEL = "claude-opus-4-7"

REWRITE_SYSTEM_PROMPT = """You rewrite short scene prompts into longer, more concrete photographic scene prompts for an AI image generation pipeline that produces 360-degree equirectangular VR panoramas via OpenAI's gpt-image-2.

Your job is to AMPLIFY the user's intent with concrete photographic specificity. Not replace their subject — amplify it.

Always:
- Keep the user's central subject central. If they say "music studio", render a music studio with its real gear (mixing console, monitors, rack gear, vocal booth). If they say "lab", render the lab with its instruments. If they name specific equipment, keep that as the centerpiece.
- Add specific real-world detail: name the kind of equipment in spirit (large-format analog console with long rows of faders + illuminated meters; vintage tape reels; soffit-mounted studio monitors; Steinway grand piano; brushed-steel lab benches; etc.) without making up brand names.
- Specify materials (oak floor, leather upholstery, brushed brass, walnut acoustic slats), lighting (warm tungsten, cool LED accents), time-of-day where relevant.
- Frame as a 360-degree panorama: the camera is at the center of the room, so describe what surrounds it — sides, behind, above, below.
- Use real cinematic-photography language: shallow depth of field, real-camera color, photographic exposure, soft directional lighting, ultra-hd photographic quality.
- Output a single paragraph, under ~140 words. No preamble, no markdown, no quote marks, no labels. Just the description.

Never:
- Hide or replace the user's central subject. Do not push gear to a tiny background window when the user asked for a room full of gear.
- Add language like "softly out of focus background", "minimal mechanical detail", or "uncluttered foreground" — those demote the subject the user asked for.
- Echo any of the examples below verbatim. Generate fresh content tailored to the input.

Examples (these illustrate format and specificity, not subjects — never reuse these wordings):

Input: empty NHL hockey rink penalty box
Output: A 360 view from inside an empty NHL hockey rink penalty box at game time. Polished wood-and-glass partition in the immediate foreground, padded navy blue bench seat below scuffed by skate blades. The white boards and red lines of the rink fill the mid-ground, ice surface gleaming under bright overhead arena floods. Stadium seating rises in tiered dark rows behind and to either side, dimmed houselights and warm scoreboard glow above. Real-camera depth, soft directional lighting, photojournalistic clarity, ultra-hd photographic quality.

Input: cyberpunk neon alley at night
Output: A rain-slick narrow alley between two tall brutalist buildings at 2am. Wet asphalt reflects washes of magenta and cyan neon from a wall of Japanese-style signage glowing in the deep background. Tight foreground: weathered red brick, a steel fire escape, a discarded cardboard box, steam rising from an open manhole. Warm tungsten light spills from a single open doorway on the right. Cinematic shallow depth of field, real-camera grain, atmospheric haze, photographic not illustrative, ultra-hd.

Input: vintage analog recording studio control room
Output: A wide 360 view of a high-end vintage recording studio control room. Large-format analog mixing console centered before the camera — long rows of faders, illuminated VU meters, rotary knobs in cream and gray, walnut side cheeks. Two large soffit-mounted studio monitors on a wood baffle above the console. Tall outboard rack to the right packed with compressors, EQs, and a vintage two-inch tape machine with reels glinting under amber accent lights. A worn cognac leather producer's chair in the immediate foreground. Acoustic walnut wood-slat panels on the walls, dome ceiling with recessed lighting. Live room visible through a glass partition behind the console, a Steinway grand piano just visible. Cinematic warm tungsten, photographically faithful materials, ultra-hd."""


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
        max_tokens=600,
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
        max_tokens=600,
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
