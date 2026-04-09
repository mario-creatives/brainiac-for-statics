# API Integration Notes

> Before adding any external API, document it here: auth method, rate limits, gotchas.
> See `../../LESSONS.md` for cross-project API lessons.

---

## Stripe

- **Auth:** Secret key in server env; publishable key in `NEXT_PUBLIC_`
- **Webhook:** Verify `stripe-signature` header with `stripe.webhooks.constructEvent()` before any processing
- **Key events:** `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`
- **Local testing:** `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- **Gotcha:** Webhook secret changes if you re-register the endpoint in Stripe dashboard — update env var

## Supabase

- **Client (browser):** anon key — respects RLS
- **Server (API routes):** service role key — bypasses RLS; never expose to browser
- **Edge functions:** deploy manually (`npx supabase functions deploy`); JWT settings reset to ON after every deploy
- **Migrations:** apply via Supabase SQL editor (no local psql); keep files in `supabase/migrations/`

## Resend

- **Auth:** `RESEND_API_KEY`
- **From address:** Must use a verified sending domain — gmail from-address lands in spam
- **Rate limits:** Generous on free tier for low-volume transactional email

## Anthropic

- **Models:** Haiku (`claude-haiku-4-5-20251001`) for cheap summaries ~$0.001/call; Sonnet for quality
- **Always provide fallback** when `ANTHROPIC_API_KEY` is missing (dev environments)
- **Proxy through server** — never call Anthropic directly from the browser

---

## Adding a New API

When integrating a new external API, add a section here covering:
1. Auth method and where credentials live
2. Rate limits and quota reset schedule
3. Any known gotchas (encoding issues, content-type requirements, silent failures)
4. Whether to call directly from client or proxy through server
