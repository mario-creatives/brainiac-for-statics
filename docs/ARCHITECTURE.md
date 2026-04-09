# Brainiac — Architecture

## Overview

```
Browser
  └── Next.js App Router (Vercel)
        ├── Public pages (Server Components, SEO)
        ├── Auth pages (Client Components)
        ├── Protected app (Client Components, gated by proxy.ts)
        └── API Routes
              ├── /api/stripe/*    Checkout, portal, webhook
              └── /api/*           App-specific routes

Supabase
  ├── Auth (email/password, session cookies)
  ├── Postgres (profiles, app tables)
  └── Storage (if needed)

Stripe
  └── Subscriptions + webhooks → updates profiles.subscription_status

Resend
  └── Transactional email (welcome, digest, alerts)

Anthropic
  └── AI features (Claude Haiku for cheap, Sonnet for quality)
```

## Auth Flow

1. User visits protected route → `src/proxy.ts` redirects to `/auth/login`
2. User logs in → Supabase sets session cookie
3. `proxy.ts` reads cookie → allows access
4. Subscription check: lapsed users redirected to `/upgrade`

## Data Flow

- Client pages: `supabase` (anon key) for reads/writes owned by the user
- API routes: `supabaseServer` (service role) for writes that bypass RLS
- Stripe webhook → `supabaseServer` updates `profiles.subscription_status`

## Key Constraints

- Never call rate-limited APIs in parallel — sequential + delay
- Always `await` Supabase mutations — fire-and-forget silently drops
- Server-only secrets never touch the browser bundle
- `proxy.ts` not `middleware.ts` (Next.js 16)
