import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { hasConsent } from '@/lib/consent'
import { generateStateToken, buildMetaOAuthUrl } from '@/lib/meta-ads'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAdConsent = await hasConsent(user.id, 'ad_account_connection')
  if (!hasAdConsent) {
    return NextResponse.json(
      { error: 'Ad account connection consent required before connecting Meta Ads.' },
      { status: 403 }
    )
  }

  const state = generateStateToken(user.id)
  const authUrl = buildMetaOAuthUrl(state)

  return NextResponse.json({ auth_url: authUrl })
}
