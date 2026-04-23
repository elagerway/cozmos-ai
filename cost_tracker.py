"""Cost logging for the pipeline side.

Mirror of `mockup/lib/cost-tracker.ts` so the Python pipeline can log the same
api_costs rows the Next frontend does. Pricing kept in sync with
`mockup/lib/pricing.ts` — when updating vendor rates, update BOTH.

Never blocks a pipeline step if logging fails — failure is warned, not raised.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx

Feature = Literal[
    "initial_gen",
    "bg_reroll",
    "variants_preview",
    "copilot",
    "scene_analysis",
    "other",
]

# ---------- Pricing (mirror of lib/pricing.ts) ----------

ANTHROPIC_RATES = {
    # per 1K tokens — (input, output)
    "claude-sonnet-4-20250514": (0.003, 0.015),
    "claude-sonnet-4-6": (0.003, 0.015),
    "claude-opus-4-7": (0.015, 0.075),
    "claude-haiku-4-5-20251001": (0.001, 0.005),
}

BLOCKADE_FLAT = {
    "skybox_generate": 0.30,
    "skybox_export": 0.15,
}

FAL_ESRGAN_PER_MP = 0.0025

# Gemini 3 Pro Image (Nano Banana Pro) — token-based. Rough flat-rate estimate
# per 4K output image for logging; refine when Google publishes per-size
# breakdowns. Per https://ai.google.dev/gemini-api/docs/pricing (2026-04).
GEMINI_IMAGEGEN_PER_CALL = {
    "gemini-3-pro-image-preview": 0.24,
}


def price_anthropic(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = ANTHROPIC_RATES.get(model)
    if not rates:
        print(f"[cost-tracker] unknown Anthropic model: {model}")
        return 0.0
    return (input_tokens / 1000) * rates[0] + (output_tokens / 1000) * rates[1]


def price_blockade(operation: str) -> float:
    return BLOCKADE_FLAT.get(operation, 0.0)


def price_fal_esrgan(output_megapixels: float) -> float:
    return FAL_ESRGAN_PER_MP * output_megapixels


# ---------- Logger ----------


def _supabase_headers() -> Optional[dict]:
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key:
        return None
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _supabase_url() -> Optional[str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    if not url:
        return None
    return f"{url.rstrip('/')}/rest/v1/api_costs"


def _insert_row(row: dict[str, Any]) -> None:
    url = _supabase_url()
    headers = _supabase_headers()
    if not url or not headers:
        # Silent no-op when env not configured — we log to stdout so it's visible.
        print(f"[cost-tracker] skipped (no supabase env): {row.get('service')}/{row.get('operation')} ${row.get('cost_usd'):.4f}")
        return
    try:
        resp = httpx.post(url, json=row, headers=headers, timeout=5.0)
        if resp.status_code not in (200, 201, 204):
            print(f"[cost-tracker] insert failed {resp.status_code}: {resp.text[:200]}")
    except Exception as exc:  # noqa: BLE001 - never let logging break the pipeline
        print(f"[cost-tracker] insert error: {exc}")


def log_anthropic(
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    generation_id: Optional[str] = None,
    session_id: Optional[str] = None,
    feature: Feature = "scene_analysis",
    operation: str = "messages",
    metadata: Optional[dict[str, Any]] = None,
) -> float:
    cost = price_anthropic(model, input_tokens, output_tokens)
    _insert_row({
        "service": "anthropic",
        "operation": operation,
        "model": model,
        "input_units": input_tokens,
        "output_units": output_tokens,
        "unit_type": "tokens",
        "cost_usd": round(cost, 6),
        "generation_id": generation_id,
        "session_id": session_id,
        "feature": feature,
        "metadata": metadata or {},
    })
    return cost


def log_blockade(
    *,
    operation: Literal["skybox_generate", "skybox_export"],
    generation_id: Optional[str] = None,
    feature: Feature = "initial_gen",
    prompt: Optional[str] = None,
    style_id: Optional[int] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> float:
    cost = price_blockade(operation)
    meta = {"prompt": prompt, "style_id": style_id, **(metadata or {})}
    _insert_row({
        "service": "blockade_labs",
        "operation": operation,
        "input_units": 1,
        "unit_type": "requests",
        "cost_usd": round(cost, 6),
        "generation_id": generation_id,
        "feature": feature,
        "metadata": meta,
    })
    return cost


def log_fal_esrgan(
    *,
    output_megapixels: float,
    generation_id: Optional[str] = None,
    feature: Feature = "initial_gen",
    image_kind: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> float:
    cost = price_fal_esrgan(output_megapixels)
    meta = {"image_kind": image_kind, **(metadata or {})}
    _insert_row({
        "service": "fal_ai",
        "operation": "esrgan_upscale",
        "model": "fal-ai/esrgan",
        "input_units": output_megapixels,
        "unit_type": "megapixels",
        "cost_usd": round(cost, 6),
        "generation_id": generation_id,
        "feature": feature,
        "metadata": meta,
    })
    return cost


def log_gemini_imagegen(
    *,
    model: str,
    generation_id: Optional[str] = None,
    feature: Feature = "background",
    operation: str = "imagegen_bg_upload_outpaint",
    metadata: Optional[dict[str, Any]] = None,
) -> float:
    """Log a Gemini image-generation call. Flat per-call estimate until Google
    publishes final per-token breakdowns for gpt-image-2-class models."""
    cost = GEMINI_IMAGEGEN_PER_CALL.get(model, 0.24)
    meta = {"model": model}
    if metadata:
        meta.update(metadata)
    _insert_row({
        "service": "google_gemini",
        "operation": operation,
        "model": model,
        "input_units": 1,
        "unit_type": "calls",
        "cost_usd": round(cost, 6),
        "generation_id": generation_id,
        "feature": feature,
        "metadata": meta,
    })
    return cost


def log_free(
    *,
    service: str,
    operation: str,
    units: float = 1,
    unit_type: str = "requests",
    generation_id: Optional[str] = None,
    feature: Feature = "other",
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    _insert_row({
        "service": service,
        "operation": operation,
        "input_units": units,
        "unit_type": unit_type,
        "cost_usd": 0,
        "generation_id": generation_id,
        "feature": feature,
        "metadata": metadata or {},
    })
