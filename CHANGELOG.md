# Changelog

## 2026-04-24

### Copilot: `add_social_profile_marker` — fetch a handle and drop a bio card
- The copilot now recognises "my handle is @x on instagram" / "go find @y" / "add my TikTok @z" style requests and drops a `profile` marker at the current view with scraped name, bio, avatar, and follower count — no URL required.
- New pipeline endpoint `POST /scrape-profile` dispatches by platform (`instagram|youtube|twitter|tiktok`) to the existing `profile_scraper.py` functions and returns a unified JSON shape. No tile generation side effects — pure data fetch.
- New copilot tool `add_social_profile_marker({ handle, platform, yaw?, pitch? })`; system prompt updated to describe when to use it (and to ask for the missing half when the user provides only a handle OR only a platform).
- `CopilotPanel.runTool` adds the client-side executor; calls `scrapeProfile()` then hands the result to `actions.addMarker({ type: "profile", ... })`.
- `InteractiveSphereViewer.addMarker` gains a `profile` branch that maps the tool's content into the existing `ProfileMarkerData` shape (so the existing `ProfileCardHTML` renderer picks it up unchanged).
- New client function `scrapeProfile()` in `lib/pipeline-client.ts` with a `ScrapedProfile` type.

## 2026-04-23

### Upload-a-photo second flow — frontend + pipeline
- New pipeline endpoint `POST /generate-from-bg-upload` accepts any image ≥ 1024 wide. If aspect is ~2:1 (1.8–2.2), the upload is used directly as the sphere background — no AI cost, ~20 s end-to-end. Else the image is sent to Gemini 3 Pro Image (`gemini-3-pro-image-preview`) with an outpaint prompt to extend it into a seamless 360° equirectangular panorama, then tiled. ~30–60 s, ~$0.24/call. Requires `GEMINI_API_KEY` on the pipeline env. Cost logging via new `log_gemini_imagegen()` helper.
- Home page now has two stacked flows: the existing brief textarea + Generate Sphere, and a new "Upload your own photo" section with `BackgroundImageUploader`.
- Hero copy: "AI-generated biospheres are sharp at a glance and soft at deep zoom. For true HD, upload your own equirectangular 360° photo below." Sets expectations about AI-gen fidelity and points to the upload flow.
- `BackgroundImageUploader` is a single-image drop zone — no equirectangular jargon in the UI. Live hint per image: *"Looks like a 360° photo — will render as-is"* vs *"Will be extended to 360° by AI (~30–60s)"*.
- `startBgUploadGeneration` in `lib/pipeline-client.ts` posts base64 to the new pipeline endpoint. `handleBackgroundUpload` in `app/page.tsx` reuses the same progress-poll + result-render path as the brief flow.
- Tile pyramid still uses `high_res=true` when the source is ≥ 12288 wide (equirect path only — Gemini outputs ~6336 wide, so auto-stays 3-tier).

### Copilot chat — full pointer/touch event isolation
- Copilot panel was portaled into PSV's own container and only stopped `mousedown` / `wheel` / `keydown`. PSV 5.x drives drag off pointer + touch events, so cursor moves inside the panel were rotating the sphere and dragging markers underneath.
- Panel root now stops propagation on the full set: `mouse*`, `pointer*`, `touch*`, `click`, `contextMenu`, `wheel`, `keyDown`. Drag-inside-panel no longer leaks to the viewer.

### Optional 4-tier "high_res" tile pyramid (16K)
- Re-added the 4th (16K) tile tier to both viewers, opt-in per sphere via a new `high_res` boolean column on `generations`. Default false preserves current 3-tier behaviour; existing spheres continue to render on 2K / 4K / 8K with no 404s.
- `SphereViewer` + `InteractiveSphereViewer` accept `highRes?: boolean`, pick `LEVELS_HIGH_RES` (adds `{ width: 16384, cols: 16, rows: 8 }`) when true.
- `app/g/[id]/page.tsx` reads `high_res` from the generation row and forwards it to whichever viewer renders.
- Schema migration `add_high_res_to_generations`: `alter table public.generations add column if not exists high_res boolean not null default false;`. Non-destructive — existing rows backfill to false.
- Rationale: infrastructure for future user-uploaded 16K+ VR captures and for GPT Image 2 when its API opens. Today's AI-generated sources (Gemini 4K) don't carry enough genuine detail to justify the 4th tier on their own.

### Deploy env parity fix (Vercel production)
- `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`, and `ADMIN_PASSWORD` were missing from Vercel production — server routes (`/api/copilot/chat`, admin auth, admin costs) returned 500s. Added all three to production + development (preview blocked by a CLI quirk in v50.37.0 and was skipped). Triggered production redeploy.

## 2026-04-22

### Marker redesign — flat glass panels (fbd1c20)
- Markers were dressed as faux-3D objects (TV bezels, wood picture frames, speaker cones) that conflicted with their camera-facing billboard behaviour, which read as a visual bug.
- Replaced all five marker types (profile / video thumbnail / video playing / image / audio / bio-links) with a shared `CARD_STYLE`: semi-transparent near-black fill with `backdrop-blur`, 1px hairline border, 14px radius, minimal shadow.
- Billboards remain — but now they look intentional: info cards overlaid on the sphere, not fake wall-mounted objects. Short-lived "wall-aligned perspective" experiment (153cd46) was reverted in 00d0481.

### Modals render inside sphere container (d1a31c6)
- `RerollBackgroundModal` and `CategoryExcludeModal` previously self-portaled into `document.body`, which sits OUTSIDE the fullscreen PSV element — in fullscreen edit mode the modals opened invisibly behind the viewer.
- Removed internal `createPortal` from both; viewer now wraps them in `createPortal(..., psvHost)` at render time, matching `AddMarkerModal`'s pattern. Modals appear inside the sphere in both normal and fullscreen.

### Comfort toggle — label + default ON (1d2417a, b9f680e)
- Active-state label: "👁 Comfort" → "👁 Comfort Enabled" (was "Reduced")
- First-visit default flipped from OFF to ON so new visitors get motion-reduced behaviour out of the gate; stored opt-outs in localStorage still stick.

### Category exclusion — allow repack-only flow (f805c2b)
- "Apply & repack" button no longer requires at least one excluded category. Strictness changes alone now repack the existing marker set (same `_pack_harmonically` call with new strictness). Button label switches between "Repack" and "Apply & repack".

### Hero copy accuracy (a1e395a)
- Homepage headline "biosphere in seconds" → "biosphere in a few minutes" — accurate against the 2–5 min end-to-end generation time.

### Vercel build unblocked (7f5a481)
- Four strict-type-check errors were silently failing Vercel's production build since commit `0ee322f`, freezing deploys at a pre-Copilot SHA.
  1. `admin/costs` route — `existing` inferred as a union without optional token fields; annotated as `ServiceTotal`.
  2. `admin/storage-snapshot` route — Supabase client generic mismatch in helper param; loosened.
  3. `InteractiveSphereViewer` — PSV `Viewer.renderer` is private; cast sites to `any` at the rig hook-in.
  4. `viewer-camera` — `import("three")` implicit `any`; added `@types/three` as dev dep.
- Also excluded nested `pipeline/` clone from `tsconfig.json` so stale mirrored files from the other working tree don't pollute future builds.

### Docs
- New `.audit/notes/patent-alignment-executive.html` + `Biosphere-Patent-Alignment-2026-04-22.pdf` — c-suite-ready patent alignment recap.
- New `.audit/notes/biosphere-gtm-architecture-cost.md` + `Biosphere-GTM-Architecture-Cost-2026-04-22.pdf` — architecture, full API + cost analysis (confirmed via vendor APIs), scale readiness, GTM plan, future product surfaces (User Portal, Admin Panel, Public API, MCP server).

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

### Upload images as interactive markers (Composite mode rewrite)
- `POST /upload-as-markers` pipeline endpoint — ESRGAN-upscales each uploaded image, uploads under `uploads/{gen_id}/`, and harmony-packs them as `image` markers against the sphere's existing marker set. Stays on the SAME `gen_id` — analytics, copilot, reroll, category exclusion, and heatmap all keep working against this sphere
- `lib/pipeline-client.ts` extended with `uploadAsMarkers()`
- `/g/[id]/page.tsx` Composite branch rewritten to call `uploadAsMarkers` + merge positions + persist markers via Supabase. "New Sphere" mode unchanged (still spawns a fresh gen via `startUploadGeneration`)
- Uploaded images are now fully interactive: drag-to-move, corner resize, copilot-addressable, category-excludable, heatmap-tracked

### Category exclusion + repack (patent US '666)
- New `POST /repack-markers` pipeline endpoint — filters markers by `excluded_types` / `excluded_platforms` / `excluded_tags` / `strictness`, re-runs `_pack_harmonically` on the kept subset so remaining markers spread into the freed space with anchor-pull + collision resolution
- `CategoryExcludeModal.tsx` — checkbox UI with live per-category counts + strictness slider
- "🚫 Categories" button in edit toolbar
- Copilot tool `exclude_categories` so the user can say things like "hide all my audio markers" or "drop the vimeo videos" conversationally
- `lib/pipeline-client.ts` extended with `repackMarkers`

### Anti-distortion camera rig — patents EP '953 / CN '718 / US '579
- New `lib/viewer-camera.ts:attachAntiDistortionRig()` attaches six independent anti-sickness behaviors to any PSV instance
  1. Pitch-adaptive damping: intercepts `before-rotate`, dampens yaw/pitch deltas above 55° where equirectangular stretch exaggerates small movements
  2. FOV-coupled vignette: soft DOM radial-gradient overlay that fades in above 95° FOV, killing peripheral motion cues
  3. Horizon-nudge spring: rAF loop applying gentle restoring force toward pitch=0 when idle >400ms at pitch >65°
  4. Explicit FOV ceiling/floor: 30°–95° (tighter than PSV's 15°–180° default) — never enters fisheye-stretch regime
  5. Motion-reduced mode: caps `moveSpeed`/`zoomSpeed`, disables `moveInertia`; auto-enables on `prefers-reduced-motion`
  6. Barrel-correction shader pass: Three.js `EffectComposer` + custom `ShaderPass` applying inverse radial distortion with FOV-scaled `k`/`k2`; bypassed below 70° FOV to keep markers aligned
- Top-right **👁 Comfort** button + popover with motion-reduced toggle; preference persisted in `biosphere_motion_reduced` localStorage
- Wired into `InteractiveSphereViewer` at PSV `ready`; cleanup runs on viewer teardown

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
