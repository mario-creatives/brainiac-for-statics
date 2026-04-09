// Stripe is not used in Brainiac (CC-BY-NC-4.0 non-commercial).
// See COMMERCIAL_USE_BLOCKED.md before adding any payment flows.
export const dynamic = 'force-dynamic'

export async function POST() {
  return Response.json({ error: 'Not implemented' }, { status: 501 })
}
