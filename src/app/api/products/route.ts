import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export interface ProductRow {
  id: string
  name: string
  vertical_category: string | null
  target_cpa_usd: number | null
  notes: string | null
  archived: boolean
  created_at: string
  ad_count: number
}

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

export async function GET(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: products } = await supabaseServer
    .from('products')
    .select('id, name, vertical_category, target_cpa_usd, notes, archived, created_at')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('created_at', { ascending: false })

  // attach ad_count per product (single round-trip via .in)
  const ids = (products ?? []).map(p => p.id)
  const counts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: rows } = await supabaseServer
      .from('analyses')
      .select('product_id')
      .in('product_id', ids)
    for (const r of (rows ?? []) as { product_id: string }[]) {
      counts.set(r.product_id, (counts.get(r.product_id) ?? 0) + 1)
    }
  }

  const enriched: ProductRow[] = (products ?? []).map(p => ({
    ...p,
    ad_count: counts.get(p.id) ?? 0,
  }))
  return NextResponse.json({ products: enriched })
}

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    name?: string
    vertical_category?: string | null
    target_cpa_usd?: number | null
    notes?: string | null
  }

  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { data, error } = await supabaseServer
    .from('products')
    .insert({
      user_id: user.id,
      name,
      vertical_category: body.vertical_category ?? null,
      target_cpa_usd: body.target_cpa_usd ?? null,
      notes: body.notes ?? null,
    })
    .select('id, name, vertical_category, target_cpa_usd, notes, archived, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: { ...data, ad_count: 0 } })
}
