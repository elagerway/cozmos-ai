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
- **Supabase**: PostgreSQL (generations table) + Storage (sphere tiles, public CDN)
- **Railway**: 24GB RAM, auto-deploy from git
- **Vercel**: auto-deploy on every push, biosphere.ink + www.biosphere.ink

## Key Files

### Frontend
- `app/page.tsx` — Home page, generation form, progress modal
- `app/g/[id]/page.tsx` — Sphere share page with interactive viewer
- `app/examples/page.tsx` — All spheres gallery with auto-refresh
- `components/InteractiveSphereViewer.tsx` — PSV viewer with markers, edit mode, video playback
- `components/SphereViewer.tsx` — Basic sphere viewer (non-interactive)
- `components/ImageUploader.tsx` — Drag-and-drop upload with Composite/New Sphere toggle
- `lib/supabase.ts` — Supabase client, fetchGenerations, deleteGeneration
- `lib/pipeline-client.ts` — Railway API client (generate, poll, upload)

### Pipeline
- `server.py` — FastAPI server, all endpoints, pipeline orchestration
- `sphere_gen.py` — Blockade Labs API integration
- `profile_scraper.py` — YouTube/Instagram/Twitter/TikTok scraping, marker building
- `scene_analyzer.py` — Claude Vision scene analysis for marker placement
- `style_analyzer.py` — Color/mood extraction from images

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /generate` | Start sphere from brand/@handle/URL/prompt |
| `POST /generate-about-me` | Interactive About Me sphere for influencers |
| `POST /generate-from-prompt` | Pure AI generation via Blockade Labs |
| `POST /generate-from-uploads` | Generate from uploaded images (supports composite mode) |
| `GET /status/{id}` | Poll generation progress |
| `GET /health` | Health check |

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
Tile pyramid (2K→4K→8K→16K, 170 tiles)
  ↓
Upload to Supabase Storage + save generation record
  ↓
Frontend navigates to /g/{id} → InteractiveSphereViewer with markers
```

## Environment Variables

### Railway
FAL_KEY, BLOCKADE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD

### Vercel
NEXT_PUBLIC_PIPELINE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
