// Stripe is not used in Brainiac (CC-BY-NC-4.0 non-commercial).
// This stub exists to prevent build errors from the original scaffold.
// See COMMERCIAL_USE_BLOCKED.md before adding any payment flows.

export const dynamic = 'force-dynamic'

export async function POST() {
  return Response.json({ error: 'Not implemented' }, { status: 501 })
}
