import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { computeQuadrant } from '@/lib/quadrant'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> },
) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: productId, analysisId } = await params

  // Verify product ownership
  const { data: product } = await supabaseServer
    .from('products')
    .select('id, target_cpa_usd, winner_spend_threshold_usd')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Verify ad belongs to this product (and user)
  const { data: ad } = await supabaseServer
    .from('analyses')
    .select('id, user_id, product_id, spend_usd, cpa_usd, ctr_pct')
    .eq('id', analysisId)
    .maybeSingle()
  if (!ad || ad.user_id !== user.id || ad.product_id !== productId) {
    return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as {
    spend_usd?: number | null
    cpa_usd?: number | null
    ctr_pct?: number | null
    age_range?: string | null
    date_range_start?: string | null
    date_range_end?: string | null
    ad_active?: boolean | null
    loss_reason?: string | null
    // Audience Clarity Module (012 migration) — per-ad audience overrides.
    stated_concept?: string | null
    stated_persona?: string | null
    stated_micro_persona?: string | null
    stated_angle?: string | null
    // North-star reference ad toggle per product.
    is_reference_ad?: boolean
  }

  // Build update with only provided fields (allow explicit null to clear)
  const update: Record<string, unknown> = {}
  for (const key of [
    'spend_usd', 'cpa_usd', 'ctr_pct', 'age_range',
    'date_range_start', 'date_range_end', 'ad_active', 'loss_reason',
    'stated_concept', 'stated_persona', 'stated_micro_persona', 'stated_angle',
    'is_reference_ad',
  ] as const) {
    if (key in body) {
      // Trim text fields and empty-coerce to null.
      const v = body[key as keyof typeof body]
      if (typeof v === 'string') {
        const trimmed = v.trim()
        update[key] = trimmed === '' ? null : trimmed
      } else {
        update[key] = v
      }
    }
  }

  // Recompute quadrant from new effective spend + cpa using the product's
  // winner threshold (defaults to $1k when unset).
  const nextSpend = 'spend_usd' in body ? body.spend_usd ?? null : ad.spend_usd
  const nextCpa = 'cpa_usd' in body ? body.cpa_usd ?? null : ad.cpa_usd
  update.quadrant = computeQuadrant(
    nextSpend,
    nextCpa,
    product.target_cpa_usd ?? null,
    product.winner_spend_threshold_usd ?? 1000,
  )

  const { error: updateError } = await supabaseServer
    .from('analyses')
    .update(update)
    .eq('id', analysisId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // If at least one performance metric was provided, append a history snapshot
  // so the CTR-fatigue chart and decay detection have a time series.
  const hasPerfSnapshot = 'spend_usd' in body || 'cpa_usd' in body || 'ctr_pct' in body
  if (hasPerfSnapshot) {
    await supabaseServer.from('ad_metrics_history').insert({
      analysis_id: analysisId,
      spend_usd: 'spend_usd' in body ? body.spend_usd ?? null : ad.spend_usd,
      cpa_usd:   'cpa_usd' in body ? body.cpa_usd ?? null : ad.cpa_usd,
      ctr_pct:   'ctr_pct' in body ? body.ctr_pct ?? null : ad.ctr_pct,
    })
  }

  return NextResponse.json({ ok: true, quadrant: update.quadrant })
}
