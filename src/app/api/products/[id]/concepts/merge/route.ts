import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId } = await params

  // Verify product ownership
  const { data: product } = await supabaseServer
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    source_ids?: string[]
    target_id?: string
  }
  const { source_ids, target_id } = body
  if (!source_ids || !Array.isArray(source_ids) || source_ids.length === 0) {
    return NextResponse.json({ error: 'source_ids is required' }, { status: 400 })
  }
  if (!target_id) return NextResponse.json({ error: 'target_id is required' }, { status: 400 })

  // Verify all concept IDs belong to this product
  const allIds = [...source_ids, target_id]
  const { data: ownedConcepts } = await supabaseServer
    .from('product_concepts')
    .select('id')
    .eq('product_id', productId)
    .in('id', allIds)

  const ownedIds = new Set((ownedConcepts ?? []).map((c: { id: string }) => c.id))
  for (const id of allIds) {
    if (!ownedIds.has(id)) {
      return NextResponse.json({ error: `concept ${id} not found in this product` }, { status: 400 })
    }
  }

  // Move analyses from source concepts to target
  const { data: updated, error: updateError } = await supabaseServer
    .from('analyses')
    .update({ concept_id: target_id })
    .eq('product_id', productId)
    .in('concept_id', source_ids)
    .select('id')
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Delete source concept rows
  const { error: deleteError } = await supabaseServer
    .from('product_concepts')
    .delete()
    .eq('product_id', productId)
    .in('id', source_ids)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  return NextResponse.json({
    merged_count: (updated ?? []).length,
    target_id,
  })
}
