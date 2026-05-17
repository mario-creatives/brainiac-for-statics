import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

async function userOwnsProduct(productId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId } = await params
  if (!(await userOwnsProduct(productId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: concepts, error } = await supabaseServer
    .from('product_concepts')
    .select('id, label')
    .eq('product_id', productId)
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const conceptRows = (concepts ?? []) as { id: string; label: string }[]
  if (conceptRows.length === 0) return NextResponse.json({ concepts: [] })

  const conceptIds = conceptRows.map(c => c.id)

  // Pull all analyses for this product scoped to these concept IDs
  const { data: analyses } = await supabaseServer
    .from('analyses')
    .select('id, concept_id, quadrant, quadrant_override')
    .eq('product_id', productId)
    .in('concept_id', conceptIds)

  const analysisRows = (analyses ?? []) as {
    id: string
    concept_id: string | null
    quadrant: string | null
    quadrant_override: string | null
  }[]

  // Build per-concept stats
  const countMap = new Map<string, number>()
  const quadrantTally = new Map<string, Record<string, number>>()

  for (const a of analysisRows) {
    if (!a.concept_id) continue
    countMap.set(a.concept_id, (countMap.get(a.concept_id) ?? 0) + 1)
    const effective = a.quadrant_override ?? a.quadrant
    if (effective) {
      const tally = quadrantTally.get(a.concept_id) ?? {}
      tally[effective] = (tally[effective] ?? 0) + 1
      quadrantTally.set(a.concept_id, tally)
    }
  }

  function dominantQuadrant(id: string): string | null {
    const tally = quadrantTally.get(id)
    if (!tally) return null
    let best: string | null = null
    let bestCount = 0
    for (const [q, n] of Object.entries(tally)) {
      if (n > bestCount) { bestCount = n; best = q }
    }
    return best
  }

  const result = conceptRows.map(c => ({
    id: c.id,
    label: c.label,
    ad_count: countMap.get(c.id) ?? 0,
    dominant_quadrant: dominantQuadrant(c.id),
  }))

  return NextResponse.json({ concepts: result })
}
