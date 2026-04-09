# Brainiac — Project Context for Claude Code

> Shared patterns: `../../LESSONS.md` | Stack reference: `../../STACK.md`

---

## What This Is

A free, non-commercial YouTube thumbnail brain activation analyzer.
Users enter a YouTube channel handle. The app pulls the 25 most recent videos via the
YouTube Data API, runs each thumbnail through the Meta FAIR TRIBE v2 model (CC-BY-NC-4.0)
on Modal GPU workers, then correlates each brain region's activation score against the
video's actual view count — showing which visual signals statistically track with
performance on that specific channel.

**Current inference mode: MOCK_MODE = True** — the Modal worker uses image-statistics-based
proxy scores until real TRIBE v2 weights/package are integrated. See `TRIBE_V2_PLAN.md`.

**No revenue is generated. No performance claims are made. CC-BY-NC-4.0 until a commercial
license is obtained from Meta FAIR.**

**Live URL:** https://[domain].com
**GitHub:** https://github.com/natelorenzen/brainiac
**Operator:** Literally Anything LLC

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.1 (App Router) |
| Database & Auth | Supabase (Postgres + RLS + auth.users) |
| Storage | Supabase Storage (buckets: `creatives`, `heatmaps`) |
| GPU Inference | Modal (Python workers — `modal/inference.py`) |
| Hosting | Vercel |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| Language | TypeScript (Next.js) + Python (Modal worker) |

**No Stripe. No Redis. No separate backend. No Cloudflare R2.**

**Note:** Next.js 16 has breaking changes. `middleware.ts` is renamed to `proxy.ts`;
export is `proxy`, not `middleware`.

---

## Environment Variables

All required vars are in `.env.local`. See `.env.example` for full list.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server-only, never expose client-side

MODAL_INFERENCE_URL=                # Web endpoint URL after `modal deploy modal/inference.py`

ENCRYPTION_KEY=                     # 64-char hex (openssl rand -hex 32)

META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=

YOUTUBE_DATA_API_KEY=               # Required — channel resolution + video list + view counts

NEXT_PUBLIC_APP_URL=
MONTHLY_BUDGET_CAP_USD=300.0
COST_PER_ANALYSIS_USD=0.01
CURRENT_LEGAL_VERSION=1.0.0
```

---

## Database Schema

### `profiles` (extends auth.users)
```sql
id, email, daily_count, monthly_count, daily_reset_at, monthly_reset_at,
account_status ('active'|'suspended'|'deleted'), deletion_requested_at, deletion_scheduled_at
```

### `user_consents`
```sql
user_id, consent_type ('terms_of_service'|'privacy_policy'|'data_aggregation'|'ad_account_connection'),
consented_at, ip_address, user_agent, legal_version
```

### `analyses`
```sql
user_id, type ('thumbnail'|'channel_batch'|'ad_creative'),
status ('queued'|'processing'|'complete'|'failed'),
input_storage_key, heatmap_storage_key, heatmap_url,
roi_data (JSONB), mean_top_roi_score, source, error_message
```

### `monthly_budget`
```sql
month (UNIQUE), analyses_run, estimated_cost_usd, budget_cap_usd (300.0), is_exhausted
```

### `connected_accounts`, `ad_creatives`, `creative_performance`
OAuth tokens encrypted at rest with AES-256-GCM. See `src/lib/encryption.ts`.

### `aggregate_signals`
Anonymized only — no user_id, no creative_id. Written after analyses with performance data.

### RPC functions (003_rpc_functions.sql)
- `increment_usage_counts(uid, n)` — atomic daily/monthly counter increment
- `increment_budget(p_month, p_cost, p_count)` — atomic budget increment

---

## Route Map

### Public pages (no auth)
```
/                   Landing page
/auth/login
/auth/signup
/auth/reset-password
/auth/update-password
/legal/terms
/legal/privacy
```

### Authenticated app (gated by proxy.ts)
```
/dashboard          Main analysis UI (upload + YouTube channel)
/account            Settings (data export, deletion, connected accounts)
```

### API routes
```
POST /api/analyze/thumbnail           Upload image → queue inference
GET  /api/analyze/[id]               Poll analysis status
POST /api/analyze/channel            YouTube channel batch analysis
GET  /api/users/me/usage             Daily/monthly cap status
GET  /api/users/me/consent           Check consent status
POST /api/users/me/consent           Record consents
GET  /api/users/me/data-export       Full JSON export (GDPR/CCPA)
DELETE /api/users/me                 Schedule 30-day account deletion
GET  /api/oauth/meta/connect         Get Meta OAuth URL
GET  /api/oauth/meta/callback        Exchange code, store encrypted token
POST /api/oauth/meta/disconnect      Revoke + deactivate account
```

---

## Inference Architecture

```
User enters @channelhandle
  → YouTube Data API: resolves handle → channel ID (forHandle, preferred)
  → YouTube Data API: uploads playlist → 25 most recent video IDs
  → YouTube Data API: batch statistics → view counts for all 25
  → For each video: fetch thumbnail bytes (maxresdefault → hqdefault → mqdefault)
  → Next.js API validates auth + consent + usage caps
  → For each thumbnail:
      → Supabase: insert analyses row (status: queued)
      → Supabase Storage: upload thumbnail to `creatives` bucket
      → POST to Modal web endpoint (fire and forget)
      → analyses row updated (status: processing)
  → API returns { analysis_ids[], video_map{} } to client

Modal worker (currently MOCK_MODE, T4 GPU when real):
  → Downloads image from Supabase Storage
  → MOCK: derives ROI scores from image statistics (contrast, color, etc.)
  → REAL (future): runs TRIBE v2 inference → vertex activation map → ROI scores
  → Generates viridis heatmap overlay
  → Uploads heatmap to Supabase Storage (bucket: heatmaps)
  → Updates analyses row (status: complete, roi_data, heatmap_url)

Client polls all 25 analysis IDs every 3s (parallel)
  → Tracks N/25 progress
  → When all settle: computes Pearson r per ROI vs log(view_count)
  → Renders ranked correlation table + scatter chart for top region
```

---

## Usage Cap Logic

Hard limits enforced **before** any job is queued:
- **Currently: 10,000/day and 10,000/month** (caps raised for development/testing)
- $300/month global GPU budget (~30,000 analyses at $0.01 each)
- Batch channel analyses count as N against both caps
- Reset manually: `UPDATE profiles SET daily_count = 0, monthly_count = 0 WHERE email = '...';`

429 responses include `{ reason, limit_type, resets_at }`.

> Restore production caps by setting `DAILY_LIMIT = 10` and `MONTHLY_LIMIT = 50` in `src/lib/usage.ts` before launch.

---

## Modal Worker

```bash
# Initial setup
pip install modal
modal token new

# Create secret in Modal dashboard: "brainiac-supabase"
#   SUPABASE_SERVICE_ROLE_KEY = <your key>

# Deploy
modal deploy modal/inference.py

# Copy web endpoint URL → MODAL_INFERENCE_URL env var
```

---

## Compliance Hardcodes

- `COMMERCIAL_USE_BLOCKED.md` at repo root — do not remove
- Attribution footer required on every results page (see `AttributionFooter` component)
- Attribution in every API response under `attribution` key
- Required disclaimer on every result display
- No Stripe or payment flows while on CC-BY-NC-4.0

**Banned UI strings (never use):**
- "predicts viral" / "guarantees CTR" / "will improve performance"
- "proven to increase views" / "optimize for the algorithm"
- "brain scan" → use "brain activation model" instead

---

## Supabase Storage Buckets

| Bucket | Access | Contents |
|--------|--------|----------|
| `creatives` | Private (service role only) | Uploaded images, downloaded ad creatives |
| `heatmaps` | Public | Viridis overlay PNGs generated by Modal |

Create both buckets in the Supabase dashboard before first use.

---

## Conventions

- Next.js 16: `proxy.ts`, export is `proxy` not `middleware`
- Server components (no `'use client'`) for all SEO/public pages
- API routes: `export const dynamic = 'force-dynamic'`
- Always `await` Supabase mutations
- Tailwind v4: use explicit color classes only
- OAuth tokens encrypted with AES-256-GCM before storage

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | Anon key client (client-side) |
| `src/lib/supabase-server.ts` | Service role client (server-side only) |
| `src/lib/usage.ts` | Cap enforcement (daily/monthly/budget) |
| `src/lib/consent.ts` | Consent recording and checking |
| `src/lib/roi.ts` | ROI registry and activation extraction |
| `src/lib/inference.ts` | Modal web endpoint caller |
| `src/lib/encryption.ts` | AES-256-GCM for OAuth tokens |
| `src/lib/meta-ads.ts` | Meta Graph API + OAuth state tokens |
| `src/lib/youtube.ts` | YouTube Data API + RSS fallback (channel resolution, video list, view counts, thumbnail bytes) |
| `src/lib/aggregate.ts` | Anonymized signal writer |
| `src/lib/storage.ts` | Supabase Storage wrapper |
| `src/proxy.ts` | Auth middleware |
| `src/components/ConsentGate.tsx` | Blocking consent UI (first login) |
| `src/components/AttributionFooter.tsx` | Required CC-BY-NC-4.0 attribution |
| `src/components/CorrelationResults.tsx` | Ranked ROI correlation table + scatter chart |
| `src/components/ChannelInput.tsx` | YouTube channel handle input |
| `modal/inference.py` | Python GPU worker (TRIBE v2) |
| `COMMERCIAL_USE_BLOCKED.md` | License enforcement notice |
| `supabase/migrations/001_initial.sql` | profiles, RLS, handle_new_user trigger |
| `supabase/migrations/002_brainiac_schema.sql` | All brainiac tables |
| `supabase/migrations/003_rpc_functions.sql` | increment_usage_counts, increment_budget |

---

## Migrations Applied

| File | Description |
|------|-------------|
| 001_initial.sql | profiles table, RLS, handle_new_user trigger |
| 002_brainiac_schema.sql | user_consents, analyses, monthly_budget, connected_accounts, ad_creatives, creative_performance, aggregate_signals, deletion_log |
| 003_rpc_functions.sql | increment_usage_counts(), increment_budget() RPCs |

Apply in Supabase dashboard → SQL editor in order.

---

## What's Been Built

### Core Infrastructure
- [x] Project initialized, deployed to Vercel via GitHub integration
- [x] Supabase connected (auth + profiles + brainiac schema + RLS)
- [x] All 3 migrations applied in Supabase SQL editor
- [x] Supabase Storage buckets created (`creatives` private, `heatmaps` public)
- [x] Auth pages (login, signup, reset, update-password)
- [x] Consent gate (3 explicit checkboxes, versioned, IP-logged)
- [x] Modal GPU worker deployed (`modal deploy modal/inference.py`)
- [x] Modal secret `brainiac-supabase` configured with SUPABASE_SERVICE_ROLE_KEY
- [x] All env vars set in Vercel (Supabase, Modal, YouTube, Encryption)
- [x] Legal pages (terms, privacy — need lawyer review before public launch)
- [x] COMMERCIAL_USE_BLOCKED.md

### YouTube Correlation Analyzer (current focus)
- [x] YouTube Data API integration — channel resolution (forHandle preferred), video list via uploads playlist, batch view count fetch
- [x] RSS fallback for channels without API key (15-video limit)
- [x] Channel analysis API route — fetches 25 thumbnails, dispatches to Modal, returns video_map
- [x] Batch polling — client polls all 25 analysis IDs in parallel with progress bar
- [x] Pearson correlation engine — computes r per ROI vs log(view_count) across completed analyses
- [x] CorrelationResults component — ranked table with directional bars + scatter chart for top region
- [x] Quota warning surfaced when batch is capped by usage limits
- [x] Hydration mismatch fixed (mounted guard, server renders null for auth-gated page)
- [x] Channel resolution bug fixed (API forHandle before RSS to avoid legacy username shadowing)

### Modal Worker Status
- [x] Deployed and reachable at MODAL_INFERENCE_URL
- [x] Supabase Storage download + heatmap upload working
- [x] Mock inference producing ROI scores from image statistics
- [ ] **Real TRIBE v2 inference — see `TRIBE_V2_PLAN.md`**

### Pending Before Public Launch
- [ ] Integrate real TRIBE v2 model (see `TRIBE_V2_PLAN.md`)
- [ ] Restore production usage caps: `DAILY_LIMIT = 10`, `MONTHLY_LIMIT = 50` in `src/lib/usage.ts`
- [ ] Lawyer review of Terms + Privacy pages
- [ ] Remove debug fields from channel API response (`can_run`, `daily_count`, `loop_error`, etc.)
- [ ] Set live domain in CLAUDE.md and Vercel
