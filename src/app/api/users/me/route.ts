import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// DELETE /api/users/me — schedule account deletion (30-day purge)
export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date().toISOString()
  const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  await supabaseServer
    .from('profiles')
    .update({
      account_status: 'deleted',
      deletion_requested_at: now,
      deletion_scheduled_at: purgeAt,
    })
    .eq('id', user.id)

  await supabaseServer.from('deletion_log').insert({
    user_id: user.id,
    requested_at: now,
  })

  // Sign out the user immediately
  await supabaseServer.auth.admin.signOut(user.id)

  return NextResponse.json({
    message: 'Account deletion scheduled. All personal data will be purged within 30 days.',
    scheduled_at: purgeAt,
  })
}
