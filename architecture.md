# Biosphere Architecture

## Overview
AI-powered interactive 360° biospheres for influencers. Users type a name or prompt, the system scrapes their digital presence, generates a personalized 3D environment, and creates an interactive sphere with video playback and profile information.

## Stack

### Frontend — Next.js 16 on Vercel
- **Domain**: biosphere.ink
- **Framework**: Next.js 16 (Turbopack), React, TypeScript, Tailwind CSS
- **Sphere Viewer**: Photo Sphere Viewer with EquirectangularTilesAdapter + MarkersPlugin
- **Database Client**: @supabase/supabase-js

### Pipeline — FastAPI on Railway
- **Runtime**: Python 3.12, Docker with Chromium (Playwright)
- **Image Processing**: pyvips (16K compositing, tile pyramid generation)
- **AI Upscaling**: fal.ai ESRGAN (4x GPU upscaling)
- **360° Generation**: Blockade Labs Skybox AI (M3 Photoreal, 8K → 16K export)
- **Scene Analysis**: Claude Vision API (detect TVs/screens for marker placement)
- **Social Scraping**: YouTube (channel + video data), Instagram (instagrapi), Twitter/TikTok (meta tags), Playwright (screenshots)

### Infrastructure
- **Supabase**: PostgreSQL + Storage (sphere tiles, public CDN). Tables: `generations`, `sphere_events`, `api_costs`, `fixed_costs`, `storage_snapshots`. Bucket: `spheres`.
- **Railway**: Pro plan, 24 GB RAM container ceiling, 1 replica us-west2, auto-deploy from git
- **Vercel**: Pro Plus, auto-deploy on every push, biosphere.ink + www.biosphere.ink
- **Tailscale**: free plan, userspace-networking daemon in pipeline container; socat bridge routes Instagram scrape traffic through a home-Mac residential proxy (`pipeline/start.sh`)
- **Cost tracking**: every paid external call logs an `api_costs` row via `lib/cost-tracker.ts` (TS) or `pipeline/cost_tracker.py` (Python). `/admin/costs` dashboard shows live + historical spend

## Key Files

### Frontend
- `app/page.tsx` — Home page, generation form, progress modal
- `app/g/[id]/page.tsx` — Sphere share page with interactive viewer
- `app/examples/page.tsx` — All spheres gallery with auto-refresh
- `app/admin/costs/page.tsx` — Spend dashboard (password-gated via `ADMIN_PASSWORD` env var + `admin_session` cookie, 14-day TTL)
- `app/admin/costs/CostDashboard.tsx` / `LoginForm.tsx` — Client components for the admin page
- `app/api/admin/costs/route.ts` — Aggregates `api_costs` + `fixed_costs` + `storage_snapshots` for the dashboard
- `app/api/admin/login/route.ts` / `fixed-costs/route.ts` / `storage-snapshot/route.ts` — Admin-scoped mutations
- `app/api/copilot/chat/route.ts` + `tools.ts` — Anthropic proxy for the copilot panel; client-side tool execution, per-turn cost logging
- `app/api/events/route.ts` / `summary/route.ts` — Event ingest + heatmap aggregation (patents GB '335 / US '706)
- `components/InteractiveSphereViewer.tsx` — PSV viewer with markers, edit mode (drag-move, corner-drag resize), portal-mounted controls, HTML-marker XSS escapers, heatmap overlay, Cmd+K copilot toggle
- `components/AddMarkerModal.tsx` — Tabbed "+ Add" modal for Image/Video/Audio/Bio Links; native-event backdrop so PSV underneath can't steal focus
- `components/RerollBackgroundModal.tsx` — 🎨 Reroll BG: prompt input + curated style presets + advanced negative prompt + Ultra HD toggle + 4-variant picker flow OR direct single-shot. Renders inside `psvHost` for fullscreen-safe overlays
- `components/CategoryExcludeModal.tsx` — 🚫 Categories: checkbox UI with live per-category counts + strictness slider. Calls `/repack-markers` (patent US '666)
- `components/CopilotPanel.tsx` — ✨ Copilot / Cmd+K drawer in edit mode. Claude Sonnet 4.6 default / Opus 4.7 toggle. 10 tools including `regenerate_background`, `exclude_categories`, marker CRUD, `get_analytics`. History in sessionStorage
- `components/SphereViewer.tsx` — Basic sphere viewer (non-interactive)
- `components/ImageUploader.tsx` — Drag-and-drop upload with Composite/New Sphere toggle. Composite now calls `/upload-as-markers` (same gen_id, interactive image markers) — New Sphere still spawns a fresh gen
- `lib/supabase.ts` — Supabase client, fetchGenerations, deleteGeneration
- `lib/pipeline-client.ts` — Railway API client: generate, poll, upload, `startBackgroundReroll`, `startVariantReroll`, `getVariantJob`, `commitVariant`, `repackMarkers`, `uploadAsMarkers`
- `lib/event-tracker.ts` — `useEventTracker()` hook. sessionStorage session IDs, 3s flush, `sendBeacon` on `pagehide`
- `lib/viewer-camera.ts` — `attachAntiDistortionRig()`: 6 anti-sickness behaviours (patents EP '953 / CN '718 / US '579)
- `lib/pricing.ts` — Vendor price catalogue with last-verified dates
- `lib/cost-tracker.ts` — Server-side cost logger used by every paid-API route

### Marker types (MarkerDef)
All five types share a single flat-panel `CARD_STYLE` — semi-transparent near-black fill, `backdrop-blur`, 1px hairline border, 14px radius. Camera-facing billboards read as intentional UI overlays (not faux-3D props).
- `profile` — glass profile card (name, handle, bio, social badges, "Visit Channel" CTA)
- `video` — glass video card; thumbnail → YouTube/Vimeo iframe on click; `platform: "youtube" | "vimeo"`
- `image` — clean rounded image card (wooden-frame replacement)
- `audio` — glass audio card with flat play icon + HTML5 `<audio>` player
- `bio-links` — list of emoji + title + URL rows, clickable in view mode
- Position in degrees (yaw/pitch), `scene_width` (designed HTML width), `scene_scale` (user-applied uniform scale multiplier)

### Pipeline
- `server.py` — FastAPI server, all endpoints, pipeline orchestration
- `sphere_gen.py` — Blockade Labs API integration. `generate_skybox_8k()` + `export_skybox_16k()` split for variant picker reuse; `generate_skybox()` wraps both for the classic one-shot flow
- `profile_scraper.py` — YouTube/Instagram/Twitter/TikTok scraping, marker building. Honors `IG_PROXY_URL` for residential-proxy routing
- `scene_analyzer.py` — Claude Vision scene analysis + harmony packer (`_pack_harmonically`, `_marker_box`, `_collides`, `_yaw_delta`) practicing patents US '455 / '565 / '580 / GB '147 / EP '254 / US '349 / CN '866
- `style_analyzer.py` — Color/mood extraction from images
- `cost_tracker.py` — Mirror of `mockup/lib/cost-tracker.ts` — posts `api_costs` rows on every paid call. Kept in pricing-sync with the TS version

## Pipeline API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /generate` | Start sphere from brand/@handle/URL/prompt |
| `POST /generate-about-me` | Interactive About Me sphere for influencers |
| `POST /generate-from-prompt` | Pure AI generation via Blockade Labs |
| `POST /generate-from-uploads` | Generate a brand-new sphere from uploaded images |
| `POST /upload-as-markers` | Upscale uploads + harmony-pack as `image` markers on an EXISTING sphere (preserves gen_id) |
| `POST /reroll-background` | Regenerate only the background; markers preserved; versioned tile stem |
| `POST /reroll-variants` | Generate N × 8K previews for the variant picker |
| `GET /reroll-variants/{id}` | Poll variant-job state |
| `POST /reroll-variants/{id}/commit` | Commit chosen preview → 16K export + tile swap |
| `POST /repack-markers` | Filter markers by category + re-run harmony packer (US '666) |
| `POST /regenerate-markers-from-analytics` | Promote top-viewed markers based on `sphere_events` dwell rank (GB '934 / WO '623) |
| `GET /status/{id}` | Poll generation progress |
| `GET /health` | Health check |

## Frontend (Next) API Routes

| Endpoint | Purpose |
|----------|---------|
| `POST /api/events` | Batched event ingest from the viewer |
| `GET /api/events/summary` | Per-marker dwell/select rank aggregation |
| `POST /api/copilot/chat` | Anthropic proxy for the copilot. Cost-logged under `feature=copilot` |
| `POST /api/admin/login` / `DELETE` | Set/clear `admin_session` cookie against `ADMIN_PASSWORD` |
| `GET /api/admin/costs` | Spend dashboard aggregation (gated) |
| `POST|DELETE /api/admin/fixed-costs` | CRUD on fixed-cost rows |
| `POST /api/admin/storage-snapshot` | Walk Supabase `spheres` bucket + record size |

## Data Flow

```
User prompt → /generate → detect intent (about-me? brand? URL? AI-only?)
  ↓
Scrape content (YouTube search → channel → thumbnails + Instagram + Twitter + TikTok)
  ↓
Style analysis (colors, mood, brightness)
  ↓
Blockade Labs prompt → 8K generation → 16K export
  ↓
Scene analysis (Claude Vision → detect TVs/screens → marker positions)
  ↓
Composite thumbnails onto environment (small frames in equatorial band)
  ↓
Tile pyramid (2K→4K→8K, 42 tiles default; +16K tier if `high_res=true`, 170 tiles). Frontend `LEVELS` in the viewers must match pipeline output.
  ↓
Upload to Supabase Storage + save generation record
  ↓
Frontend navigates to /g/{id} → InteractiveSphereViewer with markers
```

## Environment Variables

### Railway
FAL_KEY, BLOCKADE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD, IG_PROXY_URL (optional — residential proxy for Instagram; see `.audit/notes/residential-ig-proxy-plan.md`)

### Vercel
NEXT_PUBLIC_PIPELINE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (server-side), ANTHROPIC_API_KEY (for copilot), ADMIN_PASSWORD (admin dashboard gate)
