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

  const { data: angles, error } = await supabaseServer
    .from('product_angles')
    .select('id, label')
    .eq('product_id', productId)
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const angleRows = (angles ?? []) as { id: string; label: string }[]
  if (angleRows.length === 0) return NextResponse.json({ angles: [] })

  const angleIds = angleRows.map(a => a.id)

  const { data: analyses } = await supabaseServer
    .from('analyses')
    .select('id, angle_id, quadrant, quadrant_override')
    .eq('product_id', productId)
    .in('angle_id', angleIds)

  const analysisRows = (analyses ?? []) as {
    id: string
    angle_id: string | null
    quadrant: string | null
    quadrant_override: string | null
  }[]

  const countMap = new Map<string, number>()
  const quadrantTally = new Map<string, Record<string, number>>()

  for (const a of analysisRows) {
    if (!a.angle_id) continue
    countMap.set(a.angle_id, (countMap.get(a.angle_id) ?? 0) + 1)
    const effective = a.quadrant_override ?? a.quadrant
    if (effective) {
      const tally = quadrantTally.get(a.angle_id) ?? {}
      tally[effective] = (tally[effective] ?? 0) + 1
      quadrantTally.set(a.angle_id, tally)
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

  const result = angleRows.map(a => ({
    id: a.id,
    label: a.label,
    ad_count: countMap.get(a.id) ?? 0,
    dominant_quadrant: dominantQuadrant(a.id),
  }))

  return NextResponse.json({ angles: result })
}
