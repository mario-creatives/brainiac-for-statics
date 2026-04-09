import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { recordConsents, hasRequiredConsents, REQUIRED_CONSENTS } from '@/lib/consent'
import type { ConsentType } from '@/types'

export const dynamic = 'force-dynamic'

// POST /api/users/me/consent — record consent after the consent gate UI
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const consentTypes: ConsentType[] = body?.consent_types ?? []

  const valid = consentTypes.every(t =>
    ['terms_of_service', 'privacy_policy', 'data_aggregation', 'ad_account_connection'].includes(t)
  )
  if (!valid || consentTypes.length === 0) {
    return NextResponse.json({ error: 'Invalid consent_types' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  await recordConsents(user.id, consentTypes, ip, ua)

  const allGiven = await hasRequiredConsents(user.id)

  return NextResponse.json({
    recorded: consentTypes,
    all_required_consents_given: allGiven,
    required: REQUIRED_CONSENTS,
  })
}

// GET /api/users/me/consent — check current consent status
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const allGiven = await hasRequiredConsents(user.id)

  return NextResponse.json({
    all_required_consents_given: allGiven,
    required: REQUIRED_CONSENTS,
  })
}
