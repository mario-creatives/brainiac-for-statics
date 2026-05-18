import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseServer } from '@/lib/supabase-server'
import { keepAliveStream } from '@/lib/streaming'
import { parseClaudeJson } from '@/lib/parseClaudeJson'
import { effectiveQuadrant, type Quadrant } from '@/lib/quadrant'
import { buildAdSummary } from '@/app/api/analyze/synthesize-patterns/route'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const anthropic = new Anthropic({ timeout: 280000 })

export interface NextTestSuggestions {
  diagnosis: string
  tests: {
    element: string
    current_state: string
    proposed_change: string
    rationale: string
    backed_by_ad_ids: string[]
  }[]
  highest_leverage_test: number
  generated_at: string
  generated_against_quadrant: Quadrant | null
}

async function getUserOr401(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

interface AdRow {
  id: string
  comprehensive_analysis: Record<string, unknown> | null
  roi_data: Array<{ region_key: string; activation: number }> | null
  spend_usd: number | null
  cpa_usd: number | null
  ctr_pct: number | null
  quadrant: Quadrant | null
  quadrant_override: Quadrant | null
  loss_reason: string | null
  stated_concept: string | null
  stated_angle: string | null
}

const TARGET_AD_COLS = 'id, comprehensive_analysis, roi_data, spend_usd, cpa_usd, ctr_pct, quadrant, quadrant_override, loss_reason, stated_concept, stated_angle, product_id, user_id, next_test_suggestions, next_test_generated_at, next_test_quadrant'

function extractHeadline(ca: Record<string, unknown> | null): string | null {
  const copy = ca?.copy as Record<string, unknown> | undefined
  const headline = copy?.headline as { text?: string } | undefined
  return headline?.text ?? null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> },
) {
  const user = await getUserOr401(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId, analysisId } = await params

  const { data } = await supabaseServer
    .from('analyses')
    .select('next_test_suggestions, next_test_generated_at, next_test_quadrant, quadrant, quadrant_override, product_id, user_id')
    .eq('id', analysisId)
    .maybeSingle()

  if (!data || data.user_id !== user.id || data.product_id !== productId) {
    return NextResponse.json({ error: 'Ad not found' }, { status: 404 })
  }

  const current = effectiveQuadrant({
    quadrant: data.quadrant as Quadrant | null,
    quadrant_override: data.quadrant_override as Quadrant | null,
  })
  const stale = data.next_test_quadrant != null && data.next_test_quadrant !== current

  return NextResponse.json({
    cached: data.next_test_suggestions,
    generated_at: data.next_test_generated_at,
    generated_against_quadrant: data.next_test_quadrant,
    current_quadrant: current,
    stale,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> },
) {
  const user = await getUserOr401(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId, analysisId } = await params

  const { data: product } = await supabaseServer
    .from('products')
    .select('id, name, vertical_category, target_cpa_usd, winner_spend_threshold_usd')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  return keepAliveStream(async () => {
    const { data: target } = await supabaseServer
      .from('analyses')
      .select(TARGET_AD_COLS)
      .eq('id', analysisId)
      .maybeSingle()

    if (!target || (target as { user_id: string }).user_id !== user.id || (target as { product_id: string }).product_id !== productId) {
      return { error: 'Ad not found' }
    }
    const t = target as unknown as AdRow

    if (!t.comprehensive_analysis) {
      return { error: 'This ad has no comprehensive analysis yet — run analysis first.' }
    }

    const targetQuadrant = effectiveQuadrant({
      quadrant: t.quadrant,
      quadrant_override: t.quadrant_override,
    })

    // Cohort: every OTHER ad in the same product that has a comprehensive analysis.
    const { data: cohort } = await supabaseServer
      .from('analyses')
      .select('id, comprehensive_analysis, roi_data, spend_usd, cpa_usd, ctr_pct, quadrant, quadrant_override, loss_reason, stated_concept, stated_angle')
      .eq('product_id', productId)
      .neq('id', analysisId)
      .not('comprehensive_analysis', 'is', null)

    const cohortRows = (cohort ?? []) as AdRow[]

    const targetSummary = buildAdSummary(
      t.comprehensive_analysis as unknown as ComprehensiveAnalysis,
      t.spend_usd ?? 0,
      t.loss_reason as Parameters<typeof buildAdSummary>[2],
      { roi_data: t.roi_data, ctr_pct: t.ctr_pct, cpa_usd: t.cpa_usd },
    )

    const cohortSummaries = cohortRows.map((r, i) => {
      const eff = effectiveQuadrant({ quadrant: r.quadrant, quadrant_override: r.quadrant_override })
      const fp = buildAdSummary(
        r.comprehensive_analysis as unknown as ComprehensiveAnalysis,
        r.spend_usd ?? 0,
        r.loss_reason as Parameters<typeof buildAdSummary>[2],
        { roi_data: r.roi_data, ctr_pct: r.ctr_pct, cpa_usd: r.cpa_usd },
      )
      return `COHORT C${i + 1} [id=${r.id}] (quadrant=${eff ?? 'unset'}, concept="${r.stated_concept ?? '?'}", angle="${r.stated_angle ?? '?'}"):\n${fp}`
    })

    const statusFraming = quadrantFraming(targetQuadrant)

    const targetCpa = product.target_cpa_usd ?? null
    const threshold = product.winner_spend_threshold_usd ?? 1000

    const prompt = `You are a senior performance-creative iteration coach. Your job: given one ad's existing analysis, its measured performance, and the cohort of other ads under the same product, produce 3-5 concrete tests to run NEXT for this concept. No re-analysis. No vague advice. Specific, executable, evidence-cited.

PRODUCT: "${product.name}"${product.vertical_category ? ` (${product.vertical_category})` : ''}${targetCpa != null ? ` · target CPA $${targetCpa}` : ''} · winner threshold $${threshold}

TARGET AD [id=${t.id}]
quadrant: ${targetQuadrant ?? 'unset'}
concept: "${t.stated_concept ?? '?'}"   angle: "${t.stated_angle ?? '?'}"
headline: "${extractHeadline(t.comprehensive_analysis) ?? '?'}"
spend: $${t.spend_usd ?? '?'}   cpa: $${t.cpa_usd ?? '?'}   ctr: ${t.ctr_pct ?? '?'}%
${targetSummary}

${cohortRows.length > 0 ? `COHORT (${cohortRows.length} other ads in this product):
${cohortSummaries.join('\n\n')}` : 'COHORT: no other analyzed ads in this product yet — use the target ad alone.'}

QUADRANT MEANING:
- winner: high spend, hit target CPA — proven at scale, multiply or protect
- promising: low spend, hit target CPA — small sample, needs more spend to confirm
- investigate: high spend, missed target CPA — distributed but didn't convert efficiently
- loser: low spend, missed target CPA — failed fast, the algorithm rejected it

STATUS-SPECIFIC FRAMING for the target ad (${targetQuadrant ?? 'unset'}):
${statusFraming}

OUTPUT RULES:
- 3-5 tests, ranked by likely impact (highest first).
- Each test names the single element to change. Do not bundle multiple changes per test — A/B clarity is the point.
- "current_state" describes what the target ad does now for that element (quote headline/CTA text, name the disruptor, etc.).
- "proposed_change" must be executable — name the exact new headline structure, the specific visual treatment, the new persona to target. No "test variations" or "try different angles" — say which angle.
- "rationale" cites cohort evidence by ID. If no cohort evidence supports it, say so and ground it in framework/BERG signals from the target's own analysis.
- "backed_by_ad_ids" lists the cohort ad UUIDs that support the rationale (winners that did this thing right; losers that failed the opposite way). Empty array is allowed.
- "highest_leverage_test" is the index (0-based) of the single test you'd run first if you only had budget for one.
- "diagnosis" is 2-3 sentences explaining the target's situation in plain English, status-aware.

Return ONLY a JSON object (no markdown fences):
{
  "diagnosis": "<2-3 sentences>",
  "tests": [
    {
      "element": "<headline|subheadline|cta|visual_disruptor|concept|angle|persona_target|format|trust_signal|composition>",
      "current_state": "<what it is now>",
      "proposed_change": "<specific, executable change>",
      "rationale": "<1-2 sentences citing cohort evidence>",
      "backed_by_ad_ids": ["<uuid>", "..."]
    }
  ],
  "highest_leverage_test": 0
}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''
    const partial = parseClaudeJson<Omit<NextTestSuggestions, 'generated_at' | 'generated_against_quadrant'>>(raw)

    const suggestions: NextTestSuggestions = {
      ...partial,
      generated_at: new Date().toISOString(),
      generated_against_quadrant: targetQuadrant,
    }

    await supabaseServer
      .from('analyses')
      .update({
        next_test_suggestions: suggestions,
        next_test_generated_at: suggestions.generated_at,
        next_test_quadrant: targetQuadrant,
      })
      .eq('id', analysisId)

    return suggestions
  })
}

function quadrantFraming(q: Quadrant | null): string {
  if (q === 'winner') {
    return `This ad is a proven winner. Tests should either multiply the win (variations that might be EVEN better — different persona, sharper angle, tighter copy) or protect against decay (refresh elements before fatigue kills it). Do NOT propose changes that risk breaking what works. Focus on additive variations.`
  }
  if (q === 'promising') {
    return `Early signal is good but unconfirmed. The single most useful test is the one that disambiguates noise vs. signal. Pick ONE high-leverage element to vary (usually persona or angle) — keeping the rest constant lets you attribute the CPA change. Do NOT propose 5 simultaneous changes; that destroys learning.`
  }
  if (q === 'investigate') {
    return `Meta gave this ad spend but conversion was inefficient. Diagnose: compare this ad's elements vs. cohort winners' elements. The bleeder is usually one of (a) audience mismatch — the creative reached people who weren't buyers, (b) wrong awareness level — copy is for a different stage of the funnel, (c) weak CTA or value clarity. Tests should swap the single likeliest bleeder, not redo the ad.`
  }
  if (q === 'loser') {
    return `This ad failed fast — low spend AND off-target CPA. The algorithm refused to push it, meaning the creative likely failed at the visual/attention layer before copy even mattered. Tests should propose either (a) a fundamental visual/concept pivot using a winning angle from the cohort, or (b) honesty: recommend killing this concept and explain why the cohort suggests a different approach would work.`
  }
  return `Status unknown — no performance data yet. Tests should focus on the highest-leverage variables to test FIRST when this ad goes live, based on what the cohort shows works for this product.`
}
