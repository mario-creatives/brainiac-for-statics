import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

async function verifyAngleOwnership(
  angleId: string,
  productId: string,
  userId: string,
): Promise<boolean> {
  const { data: angle } = await supabaseServer
    .from('product_angles')
    .select('id, product_id')
    .eq('id', angleId)
    .eq('product_id', productId)
    .maybeSingle()
  if (!angle) return false
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
  { params }: { params: Promise<{ id: string; angleId: string }> },
) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId, angleId } = await params

  if (!(await verifyAngleOwnership(angleId, productId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({})) as { label?: string }
  const label = body.label?.trim()
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })

  const { error } = await supabaseServer
    .from('product_angles')
    .update({ label })
    .eq('id', angleId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; angleId: string }> },
) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId, angleId } = await params

  if (!(await verifyAngleOwnership(angleId, productId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await supabaseServer
    .from('product_angles')
    .delete()
    .eq('id', angleId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
