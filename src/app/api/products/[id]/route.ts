import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { computeQuadrant } from '@/lib/quadrant'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

async function loadProduct(id: string, userId: string) {
  const { data } = await supabaseServer
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  return data
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const product = await loadProduct(id, user.id)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const existing = await loadProduct(id, user.id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    name?: string
    vertical_category?: string | null
    target_cpa_usd?: number | null
    winner_spend_threshold_usd?: number | null
    notes?: string | null
    tam?: string | null
    default_persona?: string | null
    default_micro_persona?: string | null
  }
  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.vertical_category !== undefined) update.vertical_category = body.vertical_category
  if (body.target_cpa_usd !== undefined) update.target_cpa_usd = body.target_cpa_usd
  if (body.winner_spend_threshold_usd !== undefined) {
    // Threshold must be positive — fall back to the default rather than letting
    // a zero/negative slip through and break computeQuadrant.
    update.winner_spend_threshold_usd =
      body.winner_spend_threshold_usd != null && body.winner_spend_threshold_usd > 0
        ? body.winner_spend_threshold_usd
        : 1000
  }
  if (body.notes !== undefined) update.notes = body.notes
  // Audience Clarity Module fields — accept null to allow clearing.
  if (body.tam !== undefined) update.tam = body.tam?.trim() || null
  if (body.default_persona !== undefined) update.default_persona = body.default_persona?.trim() || null
  if (body.default_micro_persona !== undefined) update.default_micro_persona = body.default_micro_persona?.trim() || null

  const { data, error } = await supabaseServer
    .from('products')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If target_cpa_usd OR winner_spend_threshold_usd changed, recompute quadrant
  // for every ad in this product so the dashboard reflects the new boundary
  // immediately.
  const cpaChanged =
    body.target_cpa_usd !== undefined && body.target_cpa_usd !== existing.target_cpa_usd
  const thresholdChanged =
    body.winner_spend_threshold_usd !== undefined &&
    (update.winner_spend_threshold_usd as number) !== existing.winner_spend_threshold_usd
  if (cpaChanged || thresholdChanged) {
    await recomputeProductQuadrants(
      id,
      (data?.target_cpa_usd as number | null) ?? null,
      (data?.winner_spend_threshold_usd as number | null) ?? 1000,
    )
  }

  return NextResponse.json({ product: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  // soft delete — keep ads in the analyses table, just unlink and archive
  const { error } = await supabaseServer
    .from('products')
    .update({ archived: true })
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ archived: true })
}

async function recomputeProductQuadrants(
  productId: string,
  targetCpa: number | null,
  winnerThreshold: number,
) {
  const { data: rows } = await supabaseServer
    .from('analyses')
    .select('id, spend_usd, cpa_usd')
    .eq('product_id', productId)
  for (const r of (rows ?? []) as { id: string; spend_usd: number | null; cpa_usd: number | null }[]) {
    const q = computeQuadrant(r.spend_usd, r.cpa_usd, targetCpa, winnerThreshold)
    await supabaseServer.from('analyses').update({ quadrant: q }).eq('id', r.id)
  }
}
