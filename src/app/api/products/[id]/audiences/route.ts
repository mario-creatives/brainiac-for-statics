import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export interface AudienceMicroPersona {
  id: string
  label: string
  sort_order: number
}
export interface AudiencePersona {
  id: string
  label: string
  sort_order: number
  micro_personas: AudienceMicroPersona[]
}
export interface AudienceTam {
  id: string
  label: string
  sort_order: number
  personas: AudiencePersona[]
}
export interface AudienceTreePayload {
  tams: AudienceTam[]
}

type Level = 'tam' | 'persona' | 'micro_persona'

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

// Verify ownership of an existing node (tam/persona/micro_persona) by id.
// Resolve up to the owning product, then check products.user_id.
async function userOwnsNode(level: Level, nodeId: string, userId: string): Promise<boolean> {
  let productId: string | null = null

  if (level === 'tam') {
    const { data } = await supabaseServer
      .from('product_tams')
      .select('product_id')
      .eq('id', nodeId)
      .maybeSingle()
    productId = (data as { product_id: string } | null)?.product_id ?? null
  } else if (level === 'persona') {
    const { data } = await supabaseServer
      .from('product_personas')
      .select('tam_id')
      .eq('id', nodeId)
      .maybeSingle()
    const tamId = (data as { tam_id: string } | null)?.tam_id ?? null
    if (tamId) {
      const { data: tam } = await supabaseServer
        .from('product_tams')
        .select('product_id')
        .eq('id', tamId)
        .maybeSingle()
      productId = (tam as { product_id: string } | null)?.product_id ?? null
    }
  } else {
    const { data } = await supabaseServer
      .from('product_micro_personas')
      .select('persona_id')
      .eq('id', nodeId)
      .maybeSingle()
    const personaId = (data as { persona_id: string } | null)?.persona_id ?? null
    if (personaId) {
      const { data: persona } = await supabaseServer
        .from('product_personas')
        .select('tam_id')
        .eq('id', personaId)
        .maybeSingle()
      const tamId = (persona as { tam_id: string } | null)?.tam_id ?? null
      if (tamId) {
        const { data: tam } = await supabaseServer
          .from('product_tams')
          .select('product_id')
          .eq('id', tamId)
          .maybeSingle()
        productId = (tam as { product_id: string } | null)?.product_id ?? null
      }
    }
  }

  if (!productId) return false
  return userOwnsProduct(productId, userId)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId } = await params
  if (!(await userOwnsProduct(productId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: tams } = await supabaseServer
    .from('product_tams')
    .select('id, label, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  const tamRows = (tams ?? []) as { id: string; label: string; sort_order: number }[]
  const tamIds = tamRows.map(t => t.id)

  let personasByTam = new Map<string, { id: string; label: string; sort_order: number }[]>()
  let microsByPersona = new Map<string, { id: string; label: string; sort_order: number }[]>()
  let personaIds: string[] = []

  if (tamIds.length > 0) {
    const { data: personas } = await supabaseServer
      .from('product_personas')
      .select('id, tam_id, label, sort_order')
      .in('tam_id', tamIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    const personaRows = (personas ?? []) as { id: string; tam_id: string; label: string; sort_order: number }[]
    for (const p of personaRows) {
      const arr = personasByTam.get(p.tam_id) ?? []
      arr.push({ id: p.id, label: p.label, sort_order: p.sort_order })
      personasByTam.set(p.tam_id, arr)
    }
    personaIds = personaRows.map(p => p.id)
  }

  if (personaIds.length > 0) {
    const { data: micros } = await supabaseServer
      .from('product_micro_personas')
      .select('id, persona_id, label, sort_order')
      .in('persona_id', personaIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    const microRows = (micros ?? []) as { id: string; persona_id: string; label: string; sort_order: number }[]
    for (const m of microRows) {
      const arr = microsByPersona.get(m.persona_id) ?? []
      arr.push({ id: m.id, label: m.label, sort_order: m.sort_order })
      microsByPersona.set(m.persona_id, arr)
    }
  }

  const payload: AudienceTreePayload = {
    tams: tamRows.map(t => ({
      id: t.id,
      label: t.label,
      sort_order: t.sort_order,
      personas: (personasByTam.get(t.id) ?? []).map(p => ({
        id: p.id,
        label: p.label,
        sort_order: p.sort_order,
        micro_personas: microsByPersona.get(p.id) ?? [],
      })),
    })),
  }
  return NextResponse.json(payload)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId } = await params

  const body = await req.json().catch(() => ({})) as {
    level?: Level; parent_id?: string; label?: string
  }
  const level = body.level
  const label = body.label?.trim()
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })
  if (level !== 'tam' && level !== 'persona' && level !== 'micro_persona') {
    return NextResponse.json({ error: 'invalid level' }, { status: 400 })
  }

  if (level === 'tam') {
    if (!(await userOwnsProduct(productId, user.id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const { data, error } = await supabaseServer
      .from('product_tams')
      .insert({ product_id: productId, label })
      .select('id, label, sort_order')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tam: data })
  }

  if (level === 'persona') {
    if (!body.parent_id) return NextResponse.json({ error: 'parent_id required' }, { status: 400 })
    if (!(await userOwnsNode('tam', body.parent_id, user.id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const { data, error } = await supabaseServer
      .from('product_personas')
      .insert({ tam_id: body.parent_id, label })
      .select('id, label, sort_order')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ persona: data })
  }

  // micro_persona
  if (!body.parent_id) return NextResponse.json({ error: 'parent_id required' }, { status: 400 })
  if (!(await userOwnsNode('persona', body.parent_id, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { data, error } = await supabaseServer
    .from('product_micro_personas')
    .insert({ persona_id: body.parent_id, label })
    .select('id, label, sort_order')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ micro_persona: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await params // productId not needed — ownership checked via node

  const body = await req.json().catch(() => ({})) as {
    level?: Level; id?: string; label?: string; sort_order?: number
  }
  const level = body.level
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (level !== 'tam' && level !== 'persona' && level !== 'micro_persona') {
    return NextResponse.json({ error: 'invalid level' }, { status: 400 })
  }
  if (!(await userOwnsNode(level, body.id, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  if (body.label != null) {
    const trimmed = body.label.trim()
    if (!trimmed) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 })
    update.label = trimmed
  }
  if (typeof body.sort_order === 'number') update.sort_order = body.sort_order
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const table = level === 'tam' ? 'product_tams' : level === 'persona' ? 'product_personas' : 'product_micro_personas'
  const { error } = await supabaseServer.from(table).update(update).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await params

  const url = new URL(req.url)
  const level = url.searchParams.get('level') as Level | null
  const nodeId = url.searchParams.get('id')
  if (!nodeId) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (level !== 'tam' && level !== 'persona' && level !== 'micro_persona') {
    return NextResponse.json({ error: 'invalid level' }, { status: 400 })
  }
  if (!(await userOwnsNode(level, nodeId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const table = level === 'tam' ? 'product_tams' : level === 'persona' ? 'product_personas' : 'product_micro_personas'
  const { error } = await supabaseServer.from(table).delete().eq('id', nodeId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
