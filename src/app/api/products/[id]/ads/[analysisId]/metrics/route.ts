import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { computeQuadrant } from '@/lib/quadrant'
import { findOrCreateConcept, findOrCreateAngle } from '@/lib/audience-auto-populate'

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
    // Creative-level free text
    stated_concept?: string | null
    stated_angle?: string | null
    // Hierarchical audience FKs (014 migration)
    tam_id?: string | null
    persona_id?: string | null
    micro_persona_id?: string | null
    // North-star reference ad toggle per product.
    is_reference_ad?: boolean
  }

  // Build update with only provided fields (allow explicit null to clear)
  const update: Record<string, unknown> = {}
  for (const key of [
    'spend_usd', 'cpa_usd', 'ctr_pct', 'age_range',
    'date_range_start', 'date_range_end', 'ad_active', 'loss_reason',
    'stated_concept', 'stated_angle',
    'is_reference_ad',
  ] as const) {
    if (key in body) {
      const v = body[key as keyof typeof body]
      if (typeof v === 'string') {
        const trimmed = v.trim()
        update[key] = trimmed === '' ? null : trimmed
      } else {
        update[key] = v
      }
    }
  }

  // Dual-write concept_id / angle_id when the user edits the text field, so
  // manual edits dedup at the DB the same way autoPopulateFromInference does
  // on fresh analyses. Empty/whitespace clears the FK.
  if ('stated_concept' in body) {
    const txt = typeof body.stated_concept === 'string' ? body.stated_concept.trim() : null
    update.concept_id = txt ? await findOrCreateConcept(productId, txt) : null
  }
  if ('stated_angle' in body) {
    const txt = typeof body.stated_angle === 'string' ? body.stated_angle.trim() : null
    update.angle_id = txt ? await findOrCreateAngle(productId, txt) : null
  }

  // Validate audience FK chain belongs to this product, then apply.
  if ('tam_id' in body || 'persona_id' in body || 'micro_persona_id' in body) {
    const tamId = body.tam_id ?? null
    const personaId = body.persona_id ?? null
    const microId = body.micro_persona_id ?? null

    if (tamId) {
      const { data } = await supabaseServer
        .from('product_tams')
        .select('id, product_id')
        .eq('id', tamId)
        .maybeSingle()
      if (!data || (data as { product_id: string }).product_id !== productId) {
        return NextResponse.json({ error: 'tam_id does not belong to this product' }, { status: 400 })
      }
    }
    if (personaId) {
      const { data } = await supabaseServer
        .from('product_personas')
        .select('id, tam_id')
        .eq('id', personaId)
        .maybeSingle()
      if (!data) return NextResponse.json({ error: 'persona_id not found' }, { status: 400 })
      const personaTamId = (data as { tam_id: string }).tam_id
      const { data: tam } = await supabaseServer
        .from('product_tams')
        .select('product_id')
        .eq('id', personaTamId)
        .maybeSingle()
      const personaProductId = (tam as { product_id: string } | null)?.product_id
      if (personaProductId !== productId) {
        return NextResponse.json({ error: 'persona_id does not belong to this product' }, { status: 400 })
      }
      if (tamId && personaTamId !== tamId) {
        return NextResponse.json({ error: 'persona_id does not belong to tam_id' }, { status: 400 })
      }
    }
    if (microId) {
      const { data } = await supabaseServer
        .from('product_micro_personas')
        .select('id, persona_id')
        .eq('id', microId)
        .maybeSingle()
      if (!data) return NextResponse.json({ error: 'micro_persona_id not found' }, { status: 400 })
      const microPersonaId = (data as { persona_id: string }).persona_id
      const { data: persona } = await supabaseServer
        .from('product_personas')
        .select('tam_id')
        .eq('id', microPersonaId)
        .maybeSingle()
      const microTamId = (persona as { tam_id: string } | null)?.tam_id
      if (!microTamId) return NextResponse.json({ error: 'micro_persona_id has no parent' }, { status: 400 })
      const { data: tam } = await supabaseServer
        .from('product_tams')
        .select('product_id')
        .eq('id', microTamId)
        .maybeSingle()
      const microProductId = (tam as { product_id: string } | null)?.product_id
      if (microProductId !== productId) {
        return NextResponse.json({ error: 'micro_persona_id does not belong to this product' }, { status: 400 })
      }
      if (personaId && microPersonaId !== personaId) {
        return NextResponse.json({ error: 'micro_persona_id does not belong to persona_id' }, { status: 400 })
      }
    }

    if ('tam_id' in body) update.tam_id = tamId
    if ('persona_id' in body) update.persona_id = personaId
    if ('micro_persona_id' in body) update.micro_persona_id = microId
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
