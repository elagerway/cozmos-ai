# Changelog

## 2026-04-16

### Interactive Sphere Editor
- Edit Layout mode: click markers to select, click sphere to reposition
- Visual feedback: dashed borders on moveable markers, ghost cursor box with "Click to drop"
- Works in fullscreen mode
- Fixed pointer event interception from page wrapper div

### About Me Pipeline
- Scene analysis via Claude Vision detects TVs/screens in Blockade environments
- Markers placed at detected screen positions with matching dimensions
- YouTube search fallback handles typos and alternate names (96% success on 50 influencers)
- Instagram integration via instagrapi
- TikTok profile scraping via meta tags

### Infrastructure
- Generation records saved to Supabase at start (survive Railway restarts)
- Examples page auto-refreshes from Supabase every 5s when items are running
- Commit hash in footer for version tracking
- Vercel deploys on every push (ignoreCommand: exit 1)

## 2026-04-15

### Rebranded to Biosphere
- App renamed from Cozmos to Biosphere
- Domain: biosphere.ink
- Favicon updated to B logo

### AI Sphere Generation
- Blockade Labs integration for 16K equirectangular panoramas
- M3 Photoreal style, negative text to prevent AI text artifacts
- Native 16K export via Blockade export API

### About Me Spheres
- Profile scraper: YouTube, Twitter, Instagram, TikTok
- Personalized Blockade environments based on content analysis
- Interactive markers: profile card, video TVs, picture frames

### Core Features
- Generation progress in modal overlay (dismissible, generation continues in background)
- Image uploader with Composite/New Sphere toggle
- Delete sphere with confirmation modal
- Cancel button during generation
- Enter to submit, Shift+Enter for line break

## 2026-04-14

### Initial Build
- Next.js 15 frontend with Photo Sphere Viewer
- 4-level progressive tile loading (2K→16K)
- FastAPI pipeline on Railway: scrape → upscale → compose → tile
- fal.ai ESRGAN GPU upscaling
- Supabase Storage + PostgreSQL
- Playwright screenshot fallback for JS-heavy sites
- Social profile detection (@brand)
- Equatorial band compositing to avoid pole distortion
