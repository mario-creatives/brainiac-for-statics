import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

async function verifyConceptOwnership(
  conceptId: string,
  productId: string,
  userId: string,
): Promise<boolean> {
  const { data: concept } = await supabaseServer
    .from('product_concepts')
    .select('id, product_id')
    .eq('id', conceptId)
    .eq('product_id', productId)
    .maybeSingle()
  if (!concept) return false
  const { data: product } = await supabaseServer
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!product
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; conceptId: string }> },
) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId, conceptId } = await params

  if (!(await verifyConceptOwnership(conceptId, productId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { label?: string }
  const label = body.label?.trim()
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })

  const { error } = await supabaseServer
    .from('product_concepts')
    .update({ label })
    .eq('id', conceptId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; conceptId: string }> },
) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId, conceptId } = await params

  if (!(await verifyConceptOwnership(conceptId, productId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await supabaseServer
    .from('product_concepts')
    .delete()
    .eq('id', conceptId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
