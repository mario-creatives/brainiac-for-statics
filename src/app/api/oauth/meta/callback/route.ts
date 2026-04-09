import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { verifyStateToken, exchangeMetaCode, META_SCOPES } from '@/lib/meta-ads'
import { encrypt } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(new URL('/account?meta=denied', req.url))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/account?meta=error', req.url))
  }

  let userId: string
  try {
    userId = verifyStateToken(state)
  } catch {
    return NextResponse.redirect(new URL('/account?meta=error', req.url))
  }

  let tokens: { access_token: string; expires_at: string | null }
  try {
    tokens = await exchangeMetaCode(code)
  } catch {
    return NextResponse.redirect(new URL('/account?meta=error', req.url))
  }

  // Fetch the ad account ID from Meta to store alongside the token
  let platformAccountId: string | null = null
  let platformAccountName: string | null = null
  try {
    const meRes = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name&access_token=${tokens.access_token}`
    )
    if (meRes.ok) {
      const { data } = await meRes.json()
      if (data?.[0]) {
        platformAccountId = data[0].id?.replace('act_', '') ?? null
        platformAccountName = data[0].name ?? null
      }
    }
  } catch {
    // Non-fatal — store token without account ID
  }

  await supabaseServer.from('connected_accounts').insert({
    user_id: userId,
    platform: 'meta_ads',
    platform_account_id: platformAccountId,
    platform_account_name: platformAccountName,
    access_token_encrypted: encrypt(tokens.access_token),
    refresh_token_encrypted: encrypt(''),
    token_expires_at: tokens.expires_at,
    scopes_granted: META_SCOPES,
  })

  return NextResponse.redirect(new URL('/account?meta=connected', req.url))
}
