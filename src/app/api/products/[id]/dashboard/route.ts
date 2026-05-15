import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { detectFatigue, type Quadrant } from '@/lib/quadrant'

export const dynamic = 'force-dynamic'

export interface ProductAdRow {
  analysis_id: string
  created_at: string
  heatmap_url: string | null
  headline_text: string | null
  composition_tag: string | null
  framework_grade: string | null
  ad_format: string | null
  spend_usd: number | null
  cpa_usd: number | null
  ctr_pct: number | null
  age_range: string | null
  date_range_start: string | null
  date_range_end: string | null
  ad_active: boolean | null
  quadrant: Quadrant | null
  quadrant_override: Quadrant | null
  effective_quadrant: Quadrant | null
  loss_reason: string | null
  fatigue_flag: boolean
  ctr_history: { recorded_at: string; ctr_pct: number | null; spend_usd: number | null; cpa_usd: number | null }[]
}

export interface ProductDashboardPayload {
  product: {
    id: string
    name: string
    vertical_category: string | null
    target_cpa_usd: number | null
    winner_spend_threshold_usd: number
    notes: string | null
    created_at: string
  }
  ads: ProductAdRow[]
  summary: {
    total_ads: number
    winners: number
    promising: number
    investigate: number
    losers: number
    win_rate: number              // share with effective quadrant = winner
    spend_on_winners: number
    avg_cpa: number | null
    fatigue_count: number
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: product } = await supabaseServer
    .from('products')
    .select('id, name, vertical_category, target_cpa_usd, winner_spend_threshold_usd, notes, created_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: ads } = await supabaseServer
    .from('analyses')
    .select('id, created_at, heatmap_url, comprehensive_analysis, spend_usd, cpa_usd, ctr_pct, age_range, date_range_start, date_range_end, ad_active, quadrant, quadrant_override, loss_reason')
    .eq('product_id', id)
    .order('created_at', { ascending: false })

  const adRows = (ads ?? []) as {
    id: string; created_at: string; heatmap_url: string | null
    comprehensive_analysis: Record<string, unknown> | null
    spend_usd: number | null; cpa_usd: number | null; ctr_pct: number | null
    age_range: string | null; date_range_start: string | null; date_range_end: string | null
    ad_active: boolean | null; quadrant: Quadrant | null; quadrant_override: Quadrant | null
    loss_reason: string | null
  }[]

  // Pull metrics history for every ad in one query
  const adIds = adRows.map(a => a.id)
  const historyByAd = new Map<string, { recorded_at: string; ctr_pct: number | null; spend_usd: number | null; cpa_usd: number | null }[]>()
  if (adIds.length > 0) {
    const { data: history } = await supabaseServer
      .from('ad_metrics_history')
      .select('analysis_id, recorded_at, ctr_pct, spend_usd, cpa_usd')
      .in('analysis_id', adIds)
      .order('recorded_at', { ascending: true })
    for (const h of (history ?? []) as { analysis_id: string; recorded_at: string; ctr_pct: number | null; spend_usd: number | null; cpa_usd: number | null }[]) {
      const arr = historyByAd.get(h.analysis_id) ?? []
      arr.push({ recorded_at: h.recorded_at, ctr_pct: h.ctr_pct, spend_usd: h.spend_usd, cpa_usd: h.cpa_usd })
      historyByAd.set(h.analysis_id, arr)
    }
  }

  const adPayload: ProductAdRow[] = adRows.map(a => {
    const ca = a.comprehensive_analysis ?? {}
    const copy = (ca as Record<string, unknown>).copy as Record<string, unknown> | undefined
    const headline = copy?.headline as Record<string, unknown> | undefined
    const fwk = (ca as Record<string, unknown>).framework_score as Record<string, unknown> | undefined
    const adFormat = (ca as Record<string, unknown>).ad_format as Record<string, unknown> | undefined
    const history = historyByAd.get(a.id) ?? []
    const fatigue = detectFatigue(history)
    const effective = a.quadrant_override ?? a.quadrant
    return {
      analysis_id: a.id,
      created_at: a.created_at,
      heatmap_url: a.heatmap_url,
      headline_text: (headline?.text as string) ?? null,
      composition_tag: ((ca as Record<string, unknown>).composition_tag as string) ?? null,
      framework_grade: (fwk?.overall_framework_grade as string) ?? null,
      ad_format: (adFormat?.type as string) ?? null,
      spend_usd: a.spend_usd,
      cpa_usd: a.cpa_usd,
      ctr_pct: a.ctr_pct,
      age_range: a.age_range,
      date_range_start: a.date_range_start,
      date_range_end: a.date_range_end,
      ad_active: a.ad_active,
      quadrant: a.quadrant,
      quadrant_override: a.quadrant_override,
      effective_quadrant: effective,
      loss_reason: a.loss_reason,
      fatigue_flag: fatigue,
      ctr_history: history,
    }
  })

  // Summary
  const buckets: Record<Quadrant, number> = { winner: 0, promising: 0, investigate: 0, loser: 0 }
  let spendOnWinners = 0
  let cpaSum = 0
  let cpaCount = 0
  let fatigueCount = 0
  for (const a of adPayload) {
    if (a.effective_quadrant) buckets[a.effective_quadrant]++
    if (a.effective_quadrant === 'winner' && a.spend_usd) spendOnWinners += a.spend_usd
    if (a.cpa_usd != null) { cpaSum += a.cpa_usd; cpaCount++ }
    if (a.fatigue_flag) fatigueCount++
  }
  const total = adPayload.length
  const summary = {
    total_ads: total,
    winners: buckets.winner,
    promising: buckets.promising,
    investigate: buckets.investigate,
    losers: buckets.loser,
    win_rate: total > 0 ? buckets.winner / total : 0,
    spend_on_winners: spendOnWinners,
    avg_cpa: cpaCount > 0 ? cpaSum / cpaCount : null,
    fatigue_count: fatigueCount,
  }

  const payload: ProductDashboardPayload = { product, ads: adPayload, summary }
  return NextResponse.json(payload)
}
