# Changelog

## 2026-04-21

### Cost tracking instrumentation
- New `cost_tracker.py` mirrors `mockup/lib/cost-tracker.ts` — posts to Supabase `api_costs` table on every billable external call
- `sphere_gen.generate_skybox()` now logs per-step (8K generate + 16K export), attributed to `generation_id` + `feature`
- `server.upscale_image_fal()` logs per-call priced by output megapixels (4× input area)
- `scene_analyzer.detect_scene_elements()` logs Claude Vision token usage
- All callers thread `gen_id` through so cost rows link back to the generation row they belong to

### Background reroll endpoint — `POST /reroll-background`
- Regenerates only the sphere background; markers and everything else preserved
- Writes tiles under a versioned stem (`{gen_id}-rr{timestamp}`) so old tiles stay accessible during the swap
- Single atomic PATCH updates `generations.tile_stem` / `image_url` / `background_prompt` / `reroll_count` / `last_rerolled_at`
- Cost-logged under `feature=bg_reroll`

### Variant picker — `POST /reroll-variants`, `GET /reroll-variants/{id}`, `POST /reroll-variants/{id}/commit`
- Generates N × 8K Skybox previews in parallel (no 16K export, no tile pyramid — cheap)
- User picks one → commit endpoint runs the 16K export + tile pyramid + atomic swap on the chosen variant
- `sphere_gen.generate_skybox_8k()` + `sphere_gen.export_skybox_16k()` split out from `generate_skybox()` for reuse
- Cost-logged: previews under `feature=variants_preview`, commit under `feature=bg_reroll`

### Schema
- `generations.background_prompt`, `generations.reroll_count`, `generations.last_rerolled_at` added (non-breaking)
- New `api_costs`, `fixed_costs`, `storage_snapshots` tables

### Admin cost dashboard — `/admin/costs`
- `lib/pricing.ts` vendor price catalog with last-verified dates
- `lib/cost-tracker.ts` server-side logger used by every API route that hits a paid external service
- Summary cards (this month / projected / last month / all-in), 30-day daily chart, per-service + per-feature breakdowns, Claude model token usage, top-10 expensive generations, fixed-costs editor, Supabase storage snapshot (on-demand), CSV export
- Gated via `ADMIN_PASSWORD` env var → httpOnly `admin_session` cookie (14-day TTL)

### Background reroll UI — `RerollBackgroundModal`
- "🎨 Reroll BG" button in edit mode
- Two flows: (a) generate 4 × 8K variants → pick one → 16K export + tile swap; (b) skip-variants single-shot direct render
- Curated style presets (Photoreal / Anime / Cinematic / Fantasy / Dreamscape / Realistic M1), negative-prompt override, Ultra HD toggle
- `lib/pipeline-client.ts` extended with `startBackgroundReroll`, `startVariantReroll`, `getVariantJob`, `commitVariant`

### Copilot chat panel — `CopilotPanel`
- "✨ Copilot" button + Cmd/Ctrl+K toggle in edit mode; slide-out drawer on the right of the viewer
- Claude Sonnet 4.6 (default) or Opus 4.7 via `/api/copilot/chat`
- Client-side tool execution for `regenerate_background`, `get_profile`, `get_markers`, `get_current_view`, `get_analytics`, `add_marker`, `move_marker`, `resize_marker`, `delete_marker`, `suggest_prompts`
- Session history persisted in sessionStorage per sphere
- Every turn cost-logged under `feature=copilot`, session_id attached for per-conversation breakdown

### Fix: sphere tile 404s (red warning triangles on zoom)
- Frontend `LEVELS` array in `InteractiveSphereViewer.tsx` and `SphereViewer.tsx` included a 16K tier that the pipeline no longer generates by default
- With `high_res=false` (Ultra HD checkbox off, the default), `pipeline/server.py generate_tiles()` produces 3 tiers — 2K, 4K, 8K — so PSV requests for the 4th tier 404'd and painted red warning triangles
- Removed the 16K tier from both viewers; frontend pyramid now matches pipeline output. Users who opt into high_res still get all 4 tiers

## 2026-04-16 (late session)

### Sphere editor — drag-to-move, drag-to-resize, inline asset add
- Move markers by dragging directly (was: click-to-select then click-to-drop)
- 4 corner handles resize selected marker uniformly (width, height, padding, font scale) via PSV's `scale` config; persists as `scene_scale` field
- New "+ Add" button opens a tabbed modal for Image / Video / Audio / Bio Links
- Image: any public URL → framed image marker
- Video: YouTube or Vimeo URL → auto-detects platform, fetches title + thumbnail via oembed
- Audio: any audio URL → speaker-style card with HTML5 player
- Bio Links: card with title + N rows of [emoji, title, url]; links open in new tab
- "Save" button commits changes without exiting edit mode (viewer no longer re-initializes on markers prop change)
- New markers drop at current view center, then user drags them where they want
- Modal backdrop uses native event listeners to block mousedown/wheel/keys from reaching PSV behind it — React's synthetic stopPropagation fires too late because PSV attaches natively at window/container level

### Security + correctness
- XSS hardening: all scraped/user-supplied strings interpolated into marker HTML pass through `escapeHtml`; URL attributes use `safeUrl` which blocks `javascript:` URIs; YouTube/Vimeo iframe IDs validated via regex before embed
- `commitMarkerChanges` now correctly derives IDs for `audio` and `bio-links` markers (was silently saving them under `image-N` key and losing edits on reload)
- Fixed indentation bug in `run_about_me_pipeline` / `run_prompt_pipeline` — `update_generation_status` failure-case call had leaked out of the `except` block
- Fixed `onMarkersChanged` title accumulation: `profile.name` was being saved as already-decorated `viewData.title`, re-appending " — Generated Sphere" every save; now saves raw `viewData.brand`; one-shot SQL heal applied to polluted rows
- MutationObserver in viewer ready-handler is now tracked and disconnected on effect teardown
- AddMarkerModal: submitting state resets on success (was stuck "Adding…")

### Instagram residential-proxy support
- `profile_scraper.py` honors `IG_PROXY_URL` env var; when set, `instagrapi` routes Instagram traffic through it via `cl.set_proxy()`
- Railway datacenter IPs are on Instagram's blacklist; long-term plan is a home Mac running `tinyproxy` + Cloudflare Tunnel (see `.audit/notes/residential-ig-proxy-plan.md`)

### Generation ID rename
- `gen-aboutme-*` → `gen-biosphere-*` prefix for all new generations (existing IDs untouched)

## 2026-04-16 (earlier)

### Interactive Sphere Editor
- Edit Layout mode with dashed border highlights on moveable markers
- Ghost cursor box with "Click to drop" follows mouse during repositioning
- All marker types moveable: profile cards, video TVs, image frames
- Marker positions persist to Supabase on Done Editing
- Fixed pointer event interception from page wrapper (isolation: isolate)
- Works in fullscreen

### Zoom Scaling (Task #5)
- Markers scale in lockstep with scene using FOV ratio (defaultFov / currentFov)
- No more arbitrary scale ranges — tied directly to the panorama projection
- No transition lag — markers snap to position instantly

### 360 Toggle (Task #3)
- Toggle button in top-right of sphere viewer
- Off (default): camera locked straight ahead, horizontal pan only
- On: full 360° freedom
- Uses PSV before-rotate event to clamp pitch to 0

### Room Size (Task #2)  
- Blockade prompts request "very spacious and open, high ceilings, wide room"
- Marker positions spread wider for larger rooms
- TV positions: -150° to 150° spread
- Image frame positions widened

### Content as Markers
- Removed compositing for About Me spheres — all content via interactive markers
- YouTube thumbnails added as image markers alongside video markers
- Scene analyzer places content on detected TVs/frames
- Everything moveable in edit mode

### Gallery Thumbnails
- 600x300 thumbnails (~20KB) generated in pipeline
- Examples page loads thumbs instead of 8K previews (5MB → 20KB)
- Lazy loading on images

### Stronger Anti-Text
- Expanded Blockade negative_text to cover all typography variations
- TVs requested as "turned off with solid black screens"
- Removed all person names from prompts

### UX Fixes
- Progress as modal overlay (dismissible, generation continues in background)
- Navigate to sphere on completion instead of inline display
- Error shown in modal instead of silent close
- "create bio for" detected as about-me intent (case insensitive)
- Delete button repositioned to avoid overlap with 360 toggle
- Footer pinned to bottom with commit hash
- Enter to submit, Shift+Enter for line break
- Generation records saved to Supabase at start (survive Railway restarts)
- Examples page auto-refreshes from Supabase every 5s
- Double-delete fix: deleted IDs tracked in session

### Pipeline
- YouTube search scores channels by name match (96% success rate on 50 influencers)
- Instagram integration via instagrapi
- TikTok profile scraping
- Never fail with "No images found" — falls through to AI generation
- Commit hash included in generation records

## 2026-04-15

### Rebranded to Biosphere
- App renamed from Cozmos to Biosphere
- Domain: biosphere.ink with SSL
- Favicon updated to B logo

### AI Sphere Generation
- Blockade Labs integration for 16K equirectangular panoramas
- M3 Photoreal style, native 16K export
- Scene analysis via Claude Vision for marker placement

### About Me Spheres
- Profile scraper: YouTube, Twitter, Instagram, TikTok
- Personalized Blockade environments based on content analysis
- Interactive markers: profile card, video TVs, picture frames
- Videos play inside sphere (YouTube iframe in marker)

### Core Features
- Image uploader with Composite/New Sphere toggle
- Delete sphere with confirmation modal
- Cancel button during generation

## 2026-04-14

### Initial Build
- Next.js frontend with Photo Sphere Viewer
- 4-level progressive tile loading (2K→16K)
- FastAPI pipeline on Railway
- fal.ai ESRGAN GPU upscaling
- Supabase Storage + PostgreSQL
