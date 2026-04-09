import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { decrypt } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const accountId: string = body?.account_id ?? ''
  if (!accountId) return NextResponse.json({ error: 'account_id is required' }, { status: 400 })

  // Verify ownership
  const { data: account } = await supabaseServer
    .from('connected_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', user.id)
    .single()

  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Attempt to revoke the token with Meta (best-effort)
  try {
    const accessToken = decrypt(account.access_token_encrypted)
    await fetch(
      `https://graph.facebook.com/v19.0/me/permissions?access_token=${accessToken}`,
      { method: 'DELETE' }
    )
  } catch {
    // Non-fatal — we deactivate locally regardless
  }

  await supabaseServer
    .from('connected_accounts')
    .update({ is_active: false })
    .eq('id', accountId)

  return NextResponse.json({ status: 'disconnected' })
}
