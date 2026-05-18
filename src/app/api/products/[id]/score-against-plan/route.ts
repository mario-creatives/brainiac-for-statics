import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseServer } from '@/lib/supabase-server'
import { keepAliveStream } from '@/lib/streaming'
import { buildAdSummary } from '@/app/api/analyze/synthesize-patterns/route'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'
import type { ProductRecommendationReport } from '@/app/api/products/[id]/recommendations/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const anthropic = new Anthropic({ timeout: 280000 })

export interface CandidateVerdict {
  analysis_id: string
  verdict: 'ship' | 'iterate' | 'kill'
  rationale: string
  changes: string[]
  plan_alignment: string
}

export interface ScoreAgainstPlanReport {
  generated_at: string
  candidates_scored: number
  per_candidate: CandidateVerdict[]
  gaps: string[]
  redundancies: string[]
  additions: string[]
  global_verdict: string
}

async function getUserOr401(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOr401(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId } = await params

  const { data: product } = await supabaseServer
    .from('products')
    .select('id, name, vertical_category, target_cpa_usd')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { candidate_ids?: string[] }
  const candidateIds = (body.candidate_ids ?? []).filter(id => typeof id === 'string')
  if (candidateIds.length === 0) {
    return NextResponse.json({ error: 'No candidates provided' }, { status: 400 })
  }
  if (candidateIds.length > 25) {
    return NextResponse.json({ error: 'Maximum 25 candidates per scoring run' }, { status: 400 })
  }

  return keepAliveStream(async () => {
    const { data: planRow } = await supabaseServer
      .from('product_recommendations')
      .select('report, generated_at, ads_analyzed')
      .eq('product_id', productId)
      .maybeSingle()

    if (!planRow?.report) {
      return { error: 'No action plan exists for this product yet — generate one first.' }
    }
    const plan = planRow.report as ProductRecommendationReport

    const { data: candidates } = await supabaseServer
      .from('analyses')
      .select('id, comprehensive_analysis, roi_data, spend_usd, cpa_usd, ctr_pct, stated_concept, stated_angle, user_id, product_id')
      .in('id', candidateIds)

    const candidateRows = (candidates ?? []).filter(c =>
      c.user_id === user.id &&
      c.product_id === productId &&
      c.comprehensive_analysis,
    ) as Array<{
      id: string
      comprehensive_analysis: Record<string, unknown>
      roi_data: Array<{ region_key: string; activation: number }> | null
      spend_usd: number | null
      cpa_usd: number | null
      ctr_pct: number | null
      stated_concept: string | null
      stated_angle: string | null
    }>

    if (candidateRows.length === 0) {
      return { error: 'None of the provided candidate IDs are valid analyzed ads in this product.' }
    }

    const candidateSummaries = candidateRows.map((r, i) => {
      const fp = buildAdSummary(
        r.comprehensive_analysis as unknown as ComprehensiveAnalysis,
        r.spend_usd ?? 0,
        null,
        { roi_data: r.roi_data, ctr_pct: r.ctr_pct, cpa_usd: r.cpa_usd },
      )
      return `CANDIDATE K${i + 1} [id=${r.id}] (concept="${r.stated_concept ?? '?'}", angle="${r.stated_angle ?? '?'}"):\n${fp}`
    })

    const planSummary = condensePlan(plan)

    const prompt = `You are a senior performance creative reviewer. The product "${product.name}"${product.vertical_category ? ` (${product.vertical_category})` : ''} has a data-driven action plan distilled from its existing ad library. The user has uploaded ${candidateRows.length} NEW CANDIDATE ads they're considering testing — none have spend or CPA yet (pre-launch).

Your job: judge each candidate AGAINST the action plan and tell them, concretely, what to ship, what to iterate before shipping, what to kill, and what's MISSING from the batch.

ACTION PLAN FOR THIS PRODUCT (what's proven to work):
${planSummary}

CANDIDATE ADS (pre-launch):
${candidateSummaries.join('\n\n')}

OUTPUT RULES:
- For each candidate, give ONE verdict: ship | iterate | kill.
  - ship = aligns with multiple winning patterns from the plan; launch as-is.
  - iterate = decent concept but needs specific fixes before launch.
  - kill = repeats a known losing pattern OR fights the plan's winning structure — replace with something else.
- "changes" is empty for ship verdicts. For iterate, list 1-3 specific changes (cite the plan's winning patterns by name, e.g. "headline structure currently is X, plan winners use Y — rewrite to..."). For kill, name the losing pattern it matches.
- "plan_alignment" is one sentence: which winning patterns the candidate hits AND which it violates.
- "rationale" is 1-2 sentences explaining the verdict in plain English.
- "gaps" = winning angles/elements the action plan calls for that NO candidate in this batch addresses. Be specific (e.g. "no candidate uses the time-bound headline structure that wins for this product").
- "redundancies" = candidates that duplicate the same concept/angle — name the IDs and what makes them redundant.
- "additions" = angles or concept directions the plan suggests but aren't in the batch — what to ADD.
- "global_verdict" = 2-3 sentences: net read on this batch's strength against the plan.

Be decisive. No fluff. Cite candidate IDs (K1, K2...) and the plan's winning patterns by name. Match the strategist tone of the action plan itself.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      tools: [{
        name: 'submit_score_report',
        description: 'Submit the structured candidate scoring report.',
        input_schema: SCORE_REPORT_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'submit_score_report' },
      messages: [{ role: 'user', content: prompt }],
    })

    if (message.stop_reason === 'max_tokens') {
      return { error: 'Response truncated — try fewer candidates per batch (≤15).' }
    }

    const toolUse = message.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return { error: 'Model did not return a structured report. Try again.' }
    }

    const partial = toolUse.input as Omit<ScoreAgainstPlanReport, 'generated_at' | 'candidates_scored'>
    const report: ScoreAgainstPlanReport = {
      ...partial,
      generated_at: new Date().toISOString(),
      candidates_scored: candidateRows.length,
    }

    return report
  })
}

// Condenses a stored ProductRecommendationReport into a compact text block for the
// scoring prompt. The full report has ad-level recommendations we don't need here —
// candidates are scored against the PATTERNS, not against individual existing ads.
function condensePlan(plan: ProductRecommendationReport): string {
  const lines: string[] = []
  lines.push('TOP-LEVEL ACTIONS:')
  for (const a of plan.summary_actions ?? []) lines.push(`  - ${a}`)
  lines.push('')
  lines.push('WINNING PATTERNS:')
  if (plan.breakdown?.winning_formats?.finding) lines.push(`  formats: ${plan.breakdown.winning_formats.finding}`)
  if (plan.breakdown?.winning_age_ranges?.finding) lines.push(`  age ranges: ${plan.breakdown.winning_age_ranges.finding}`)
  if (plan.breakdown?.winning_angles_hooks?.finding) lines.push(`  angles/hooks: ${plan.breakdown.winning_angles_hooks.finding}`)
  if (plan.breakdown?.winning_visuals?.finding) lines.push(`  visuals: ${plan.breakdown.winning_visuals.finding}`)
  if (plan.breakdown?.winning_headlines?.finding) {
    const h = plan.breakdown.winning_headlines
    lines.push(`  headlines: ${h.finding} | structure=${h.structure} | words=${h.word_count_range}`)
  }
  if (plan.breakdown?.winning_subheadlines?.finding) lines.push(`  subheadlines: ${plan.breakdown.winning_subheadlines.finding}`)
  if (plan.breakdown?.winning_body?.finding) lines.push(`  body: ${plan.breakdown.winning_body.finding}`)
  if (plan.breakdown?.cta_presence?.verdict) lines.push(`  CTA: ${plan.breakdown.cta_presence.verdict}`)
  if (plan.breakdown?.winning_combinations?.finding) {
    lines.push(`  combinations: ${plan.breakdown.winning_combinations.finding}`)
    for (const s of plan.breakdown.winning_combinations.top_stacks ?? []) lines.push(`    · ${s}`)
  }
  lines.push('')
  lines.push('LOSING PATTERNS (avoid):')
  if (plan.breakdown?.losing_patterns?.finding) lines.push(`  ${plan.breakdown.losing_patterns.finding}`)
  lines.push('')
  if (plan.next_test_batch) {
    lines.push('NEXT-TEST SPECS THE PLAN CALLS FOR:')
    if (plan.next_test_batch.rationale) lines.push(`  rationale: ${plan.next_test_batch.rationale}`)
    // Prefer the rich specs shape; fall back to the legacy angle_themes list
    // for cached reports generated before the schema was expanded.
    const specs = plan.next_test_batch.specs ?? []
    if (specs.length > 0) {
      for (const s of specs) {
        lines.push(`  · ${s.name}`)
        lines.push(`      tam=${s.tam} | persona=${s.persona} | micro=${s.micro_persona}`)
        lines.push(`      desire=${s.desire} | aware=${s.awareness_level} | soph=${s.sophistication_level}`)
        lines.push(`      concept=${s.concept} | angle=${s.angle}`)
        lines.push(`      format=${s.ad_format} | composition=${s.composition}`)
        lines.push(`      headline (${s.headline_structure}): "${s.headline}"`)
        if (s.subheadline_role !== 'absent' && s.subheadline) lines.push(`      subheadline (${s.subheadline_role}): "${s.subheadline}"`)
        if (s.body_role !== 'absent' && s.body_copy) lines.push(`      body (${s.body_role}): "${s.body_copy}"`)
        lines.push(`      cta (${s.cta_framing}): "${s.cta}"`)
        if (s.behavioral_economics.length > 0) lines.push(`      BE=[${s.behavioral_economics.join(', ')}]`)
        if (s.trust_signals.length > 0) lines.push(`      trust=[${s.trust_signals.join(', ')}]`)
        lines.push(`      visual: ${s.visual_direction}`)
        if (s.production_notes) lines.push(`      production: ${s.production_notes}`)
      }
    } else if (plan.next_test_batch.angle_themes) {
      for (const a of plan.next_test_batch.angle_themes) lines.push(`  - ${a}`)
    }
  }
  return lines.join('\n')
}

const SCORE_REPORT_SCHEMA = {
  type: 'object',
  required: ['per_candidate', 'gaps', 'redundancies', 'additions', 'global_verdict'],
  properties: {
    per_candidate: {
      type: 'array',
      items: {
        type: 'object',
        required: ['analysis_id', 'verdict', 'rationale', 'changes', 'plan_alignment'],
        properties: {
          analysis_id: { type: 'string' },
          verdict: { type: 'string', enum: ['ship', 'iterate', 'kill'] },
          rationale: { type: 'string' },
          changes: { type: 'array', items: { type: 'string' } },
          plan_alignment: { type: 'string' },
        },
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
    redundancies: { type: 'array', items: { type: 'string' } },
    additions: { type: 'array', items: { type: 'string' } },
    global_verdict: { type: 'string' },
  },
} as const
