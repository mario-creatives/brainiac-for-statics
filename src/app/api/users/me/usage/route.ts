import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { DAILY_LIMIT, MONTHLY_LIMIT } from '@/lib/usage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('daily_count, monthly_count, daily_reset_at, monthly_reset_at')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  tomorrow.setUTCHours(0, 0, 0, 0)

  const nextMonth = new Date()
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1)
  nextMonth.setUTCHours(0, 0, 0, 0)

  return NextResponse.json({
    daily_used: profile.daily_count,
    daily_limit: DAILY_LIMIT,
    monthly_used: profile.monthly_count,
    monthly_limit: MONTHLY_LIMIT,
    daily_resets_at: tomorrow.toISOString(),
    monthly_resets_at: nextMonth.toISOString(),
  })
}
