import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { Quadrant } from '@/lib/quadrant'

export const dynamic = 'force-dynamic'

const VALID: Quadrant[] = ['winner', 'promising', 'investigate', 'loser']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> },
) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: productId, analysisId } = await params

  const { data: product } = await supabaseServer
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data: ad } = await supabaseServer
    .from('analyses')
    .select('id, user_id, product_id')
    .eq('id', analysisId)
    .maybeSingle()
  if (!ad || ad.user_id !== user.id || ad.product_id !== productId) {
    return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { quadrant_override?: Quadrant | null }
  const override = body.quadrant_override
  if (override !== null && override !== undefined && !VALID.includes(override)) {
    return NextResponse.json({ error: 'Invalid quadrant' }, { status: 400 })
  }

  const { error } = await supabaseServer
    .from('analyses')
    .update({ quadrant_override: override ?? null })
    .eq('id', analysisId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
