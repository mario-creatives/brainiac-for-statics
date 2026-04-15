import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { checkUserLimits, checkGlobalBudget, incrementUsage } from '@/lib/usage'
import { hasRequiredConsents } from '@/lib/consent'
import { dispatchInferenceJob, ATTRIBUTION } from '@/lib/inference'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Called after the client has already uploaded the video directly to Supabase Storage.
// Receives storage_key, creates an analysis row, fires Modal with content_type: 'video'.

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const consented = await hasRequiredConsents(user.id)
  if (!consented) return NextResponse.json({ error: 'Required consents not recorded.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const storageKey: string = body?.storage_key ?? ''
  if (!storageKey) return NextResponse.json({ error: 'storage_key is required' }, { status: 400 })

  const [userLimit, budgetLimit] = await Promise.all([
    checkUserLimits(user.id),
    checkGlobalBudget(),
  ])

  if (!userLimit.allowed) {
    return NextResponse.json(
      { reason: userLimit.reason, limit_type: userLimit.limit_type, resets_at: userLimit.resets_at },
      { status: 429 }
    )
  }
  if (!budgetLimit.allowed) {
    return NextResponse.json(
      { reason: budgetLimit.reason, limit_type: budgetLimit.limit_type, resets_at: budgetLimit.resets_at },
      { status: 429 }
    )
  }

  const { data: analysis, error: insertError } = await supabaseServer
    .from('analyses')
    .insert({
      user_id: user.id,
      type: 'ad_creative',
      status: 'queued',
      source: 'manual_upload',
      input_storage_key: storageKey,
    })
    .select('id')
    .single()

  if (!analysis) {
    return NextResponse.json({ error: `DB insert failed: ${insertError?.message}` }, { status: 500 })
  }

  await supabaseServer
    .from('analyses')
    .update({ status: 'processing' })
    .eq('id', analysis.id)

  try {
    await dispatchInferenceJob({
      analysis_id: analysis.id,
      storage_key: storageKey,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      content_type: 'video',
    })
  } catch (err) {
    await supabaseServer
      .from('analyses')
      .update({ status: 'failed', error_message: String(err) })
      .eq('id', analysis.id)
    return NextResponse.json({ error: `Modal dispatch failed: ${String(err)}` }, { status: 502 })
  }

  await incrementUsage(user.id, 1)

  return NextResponse.json({ analysis_id: analysis.id, attribution: ATTRIBUTION })
}
