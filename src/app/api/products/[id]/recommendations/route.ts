import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'
import { keepAliveStream } from '@/lib/streaming'
import { parseClaudeJson } from '@/lib/parseClaudeJson'
import { detectFatigue, type Quadrant } from '@/lib/quadrant'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'
import { buildAdSummary } from '@/app/api/analyze/synthesize-patterns/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const anthropic = new Anthropic({ timeout: 280000 })

export interface ProductRecommendationReport {
  generated_at: string
  ads_analyzed: number
  summary_actions: string[]
  per_ad_recommendations: {
    analysis_id: string
    quadrant: Quadrant
    actions: string[]
    iteration_ideas?: string[]
    salvage_test?: string
    failure_reason?: string
  }[]
  breakdown: {
    winning_formats:      { finding: string; examples: string[] }
    winning_age_ranges:   { finding: string; examples: string[] }
    winning_angles_hooks: { finding: string; examples: string[] }
    winning_visuals:      { finding: string; examples: string[] }
    winning_headlines:    { finding: string; structure: string; word_count_range: string; examples: string[] }
    winning_subheadlines: { finding: string }
    winning_body:         { finding: string }
    cta_presence:         { with_cta: string; without_cta: string; verdict: string }
    winning_combinations: { finding: string; top_stacks: string[] }
    losing_patterns:      { finding: string; examples: string[] }
  }
  next_test_batch: {
    rationale: string
    variations_per_spec: number
    specs: TestSpec[]
    // Back-compat: older cached reports use a flat angle_themes list.
    // Renderers should prefer `specs` and fall back to `angle_themes`.
    angle_themes?: string[]
    variations_per_angle?: number
  }
}

export interface TestSpec {
  name: string                       // short label — "Mechanism reveal for sleep-deprived moms"
  ad_format: string                  // e.g. "lifestyle photo with text overlay", "product hero", "testimonial card"
  composition: string                // "visual+text", "text-dominant", "visual_only", "split-screen"
  tam: string                        // total addressable market
  persona: string                    // one-sentence target
  micro_persona: string              // narrow situational target
  desire: string                     // underlying desire or pain to lead with
  awareness_level: string            // unaware | problem-aware | solution-aware | product-aware | most-aware
  sophistication_level: string       // "1 — first to market" through "5 — saturated, identity-led"
  concept: string                    // the big idea
  angle: string                      // hook mechanism — mechanism reveal | identity claim | before/after | contrarian | proof-led
  headline_structure: string         // mechanism-reveal | outcome-claim | question | identity | command | etc.
  headline_word_count: string        // e.g. "5-9 words"
  headline_example: string           // a usable draft
  subheadline_role: string           // amplify | specify | credentialize | tonal-shift | absent
  subheadline_example: string        // empty if role=absent
  cta_framing: string                // direct | soft | value | curiosity
  cta_example: string                // e.g. "Try Beam tonight"
  body_role: string                  // benefits | social_proof | story | mechanism | absent
  behavioral_economics: string[]     // e.g. ["social_proof", "authority", "scarcity"]
  trust_signals: string[]            // e.g. ["clinical_study", "doctor_endorsement", "user_count"]
  visual_direction: string           // short brief for the designer
  why_this_test: string              // 1-2 sentences citing winning patterns from the plan
}

async function getUserOr401(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  return user
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOr401(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: productId } = await params

  const { data: product } = await supabaseServer
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { data } = await supabaseServer
    .from('product_recommendations')
    .select('generated_at, ads_analyzed, report')
    .eq('product_id', productId)
    .maybeSingle()

  if (!data) return NextResponse.json({ cached: null })
  return NextResponse.json({ cached: data.report, generated_at: data.generated_at, ads_analyzed: data.ads_analyzed })
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

  return keepAliveStream(async () => {
    const { data: ads } = await supabaseServer
      .from('analyses')
      .select('id, comprehensive_analysis, roi_data, spend_usd, cpa_usd, ctr_pct, age_range, ad_active, quadrant, quadrant_override, loss_reason')
      .eq('product_id', productId)
      .not('comprehensive_analysis', 'is', null)

    const rows = (ads ?? []) as {
      id: string; comprehensive_analysis: Record<string, unknown>
      roi_data: Array<{ region_key: string; activation: number }> | null
      spend_usd: number | null; cpa_usd: number | null; ctr_pct: number | null
      age_range: string | null; ad_active: boolean | null
      quadrant: Quadrant | null; quadrant_override: Quadrant | null
      loss_reason: string | null
    }[]

    if (rows.length < 1) {
      return { insufficient_data: true, ads_count: rows.length }
    }

    // Pull metrics history per ad for fatigue detection
    const adIds = rows.map(r => r.id)
    const historyByAd = new Map<string, { recorded_at: string; ctr_pct: number | null }[]>()
    if (adIds.length > 0) {
      const { data: history } = await supabaseServer
        .from('ad_metrics_history')
        .select('analysis_id, recorded_at, ctr_pct')
        .in('analysis_id', adIds)
        .order('recorded_at', { ascending: true })
      for (const h of (history ?? []) as { analysis_id: string; recorded_at: string; ctr_pct: number | null }[]) {
        const arr = historyByAd.get(h.analysis_id) ?? []
        arr.push({ recorded_at: h.recorded_at, ctr_pct: h.ctr_pct })
        historyByAd.set(h.analysis_id, arr)
      }
    }

    const adSummaries = rows.map((r, i) => {
      const effective = r.quadrant_override ?? r.quadrant
      const fatigue = detectFatigue(historyByAd.get(r.id) ?? [])
      const fingerprint = buildAdSummary(
        r.comprehensive_analysis as unknown as ComprehensiveAnalysis,
        r.spend_usd ?? 0,
        r.loss_reason as Parameters<typeof buildAdSummary>[2],
        { roi_data: r.roi_data, ctr_pct: r.ctr_pct, cpa_usd: r.cpa_usd },
      )
      return `AD A${i + 1} [id=${r.id}] (quadrant=${effective ?? 'unset'}, spend=$${r.spend_usd ?? '?'}, cpa=$${r.cpa_usd ?? '?'}, ctr=${r.ctr_pct ?? '?'}%, age=${r.age_range ?? '?'}, active=${r.ad_active ?? '?'}, fatigue=${fatigue}):\n${fingerprint}`
    })

    const targetCpa = product.target_cpa_usd ?? null
    const prompt = `You are a senior performance creative strategist. You have ${rows.length} static ads for product "${product.name}"${product.vertical_category ? ` (${product.vertical_category})` : ''}${targetCpa != null ? ` with target CPA of $${targetCpa}` : ''}. Your job is to produce a concrete, no-fluff action plan grounded in this exact data.

ADS:
${adSummaries.join('\n\n')}

QUADRANT DEFINITIONS:
- winner: spend ≥ $1k AND cpa ≤ target — scale + iterate
- promising: spend < $1k AND cpa ≤ target — increase spend to confirm
- investigate: spend ≥ $1k AND cpa > target — diagnose and fix
- loser: spend < $1k AND cpa > target — salvage test or kill

OUTPUT RULES:
- Every claim must reference specific ad IDs (e.g. "A3, A7, A11").
- The "breakdown" section must contain proper sentences, not bullet fragments. State what wins and WHY in one breath. No fluff phrases ("the data shows", "winners typically").
- Per-ad recommendations: tailored to that ad's quadrant. Winners get scale + iteration ideas. Losers get salvage test text + failure reason. Investigate gets root-cause direction.
- next_test_batch.specs are 3-5 fully-briefed test specs derived from this product's winning patterns. Each spec is a SHOPPING LIST for the strategist — TAM, persona, micro-persona, desire, awareness level, sophistication level, concept, angle, headline structure with a usable example, subheadline role, CTA framing with example, body role, behavioral economics, trust signals, visual direction. Specs must be DIFFERENT from each other (different angle OR different persona OR different awareness level — not just rewording the same concept). Cite winning patterns from the breakdown by name in why_this_test (e.g. "winners W2, W4, W7 all use mechanism-reveal headlines for solution-aware moms — this spec extends that to the perimenopausal micro-persona which has no representation yet").
- variations_per_spec is how many sub-variations the strategist should produce per spec (typically 3-5).

Return ONLY a JSON object (no markdown fences):
{
  "summary_actions": [
    "<top-level action 1 — cite specific ads>",
    "<top-level action 2>",
    "<top-level action 3>",
    "<top-level action 4>"
  ],
  "per_ad_recommendations": [
    {
      "analysis_id": "<ad uuid>",
      "quadrant": "<winner|promising|investigate|loser>",
      "actions": ["<action 1>", "<action 2>", "..."],
      "iteration_ideas": ["<specific iteration idea>", "..."],   // winner/promising only; omit for others
      "salvage_test": "<one specific swap to test>",              // loser/investigate only
      "failure_reason": "<one sentence: WHY this failed>"         // loser/investigate only
    }
  ],
  "breakdown": {
    "winning_formats": { "finding": "<full sentence>", "examples": ["A1","A4"] },
    "winning_age_ranges": { "finding": "<full sentence>", "examples": [] },
    "winning_angles_hooks": { "finding": "<full sentence>", "examples": [] },
    "winning_visuals": { "finding": "<full sentence>", "examples": [] },
    "winning_headlines": {
      "finding": "<full sentence>",
      "structure": "<dominant headline_structure_type>",
      "word_count_range": "<e.g. 5-9 words>",
      "examples": []
    },
    "winning_subheadlines": { "finding": "<full sentence describing role / presence / absence>" },
    "winning_body": { "finding": "<full sentence>" },
    "cta_presence": {
      "with_cta": "<sentence describing winning ads with CTA>",
      "without_cta": "<sentence describing winning ads without CTA>",
      "verdict": "<one sentence verdict>"
    },
    "winning_combinations": {
      "finding": "<full sentence>",
      "top_stacks": ["<composition_tag> — <why>", "..."]
    },
    "losing_patterns": { "finding": "<full sentence>", "examples": [] }
  },
  "next_test_batch": {
    "rationale": "<two-sentence rationale grounded in this product's data>",
    "variations_per_spec": 4,
    "specs": [
      {
        "name": "<short spec label>",
        "ad_format": "<lifestyle photo with text overlay | product hero | testimonial card | before/after split | etc.>",
        "composition": "<visual+text | text-dominant | visual_only | split-screen>",
        "tam": "<the broad addressable market>",
        "persona": "<one-sentence target>",
        "micro_persona": "<narrow life stage / situational context>",
        "desire": "<the underlying desire or pain to lead with>",
        "awareness_level": "<unaware | problem-aware | solution-aware | product-aware | most-aware>",
        "sophistication_level": "<1-5 with descriptor>",
        "concept": "<the single big idea>",
        "angle": "<mechanism-reveal | identity-claim | before-after | contrarian | proof-led | etc.>",
        "headline_structure": "<mechanism-reveal | outcome-claim | question | identity | command | etc.>",
        "headline_word_count": "<e.g. 5-9 words>",
        "headline_example": "<usable draft headline>",
        "subheadline_role": "<amplify | specify | credentialize | tonal-shift | absent>",
        "subheadline_example": "<usable draft, or empty string if absent>",
        "cta_framing": "<direct | soft | value | curiosity>",
        "cta_example": "<e.g. Try Beam tonight>",
        "body_role": "<benefits | social_proof | story | mechanism | absent>",
        "behavioral_economics": ["<e.g. social_proof>", "<authority>"],
        "trust_signals": ["<e.g. clinical_study>", "<doctor_endorsement>"],
        "visual_direction": "<brief brief for the designer>",
        "why_this_test": "<1-2 sentences citing winning patterns from the plan>"
      }
    ]
  }
}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      tools: [{
        name: 'submit_action_plan',
        description: 'Submit the structured product action plan.',
        input_schema: ACTION_PLAN_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'submit_action_plan' },
      messages: [{ role: 'user', content: prompt }],
    })

    if (message.stop_reason === 'max_tokens') {
      return {
        error: `Response truncated at the model token ceiling. Product has ${rows.length} ads — try archiving stale ads or splitting into sub-products.`,
      }
    }

    const toolUse = message.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      const textBlock = message.content.find(b => b.type === 'text')
      const raw = textBlock?.type === 'text' ? textBlock.text : ''
      // Fallback: try to parse text in case the model returned text instead.
      const partial = parseClaudeJson<Omit<ProductRecommendationReport, 'generated_at' | 'ads_analyzed'>>(raw)
      const report: ProductRecommendationReport = {
        ...partial,
        generated_at: new Date().toISOString(),
        ads_analyzed: rows.length,
      }
      await supabaseServer
        .from('product_recommendations')
        .upsert({ product_id: productId, generated_at: report.generated_at, ads_analyzed: report.ads_analyzed, report }, { onConflict: 'product_id' })
      return report
    }

    const partial = toolUse.input as Omit<ProductRecommendationReport, 'generated_at' | 'ads_analyzed'>

    const report: ProductRecommendationReport = {
      ...partial,
      generated_at: new Date().toISOString(),
      ads_analyzed: rows.length,
    }

    await supabaseServer
      .from('product_recommendations')
      .upsert({
        product_id: productId,
        generated_at: report.generated_at,
        ads_analyzed: report.ads_analyzed,
        report,
      }, { onConflict: 'product_id' })

    return report
  })
}

const ACTION_PLAN_SCHEMA = {
  type: 'object',
  required: ['summary_actions', 'per_ad_recommendations', 'breakdown', 'next_test_batch'],
  properties: {
    summary_actions: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 top-level actions, each citing specific ad IDs',
    },
    per_ad_recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['analysis_id', 'quadrant', 'actions'],
        properties: {
          analysis_id: { type: 'string' },
          quadrant: { type: 'string', enum: ['winner', 'promising', 'investigate', 'loser'] },
          actions: { type: 'array', items: { type: 'string' } },
          iteration_ideas: { type: 'array', items: { type: 'string' } },
          salvage_test: { type: 'string' },
          failure_reason: { type: 'string' },
        },
      },
    },
    breakdown: {
      type: 'object',
      required: ['winning_formats', 'winning_age_ranges', 'winning_angles_hooks', 'winning_visuals', 'winning_headlines', 'winning_subheadlines', 'winning_body', 'cta_presence', 'winning_combinations', 'losing_patterns'],
      properties: {
        winning_formats:      { type: 'object', properties: { finding: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['finding', 'examples'] },
        winning_age_ranges:   { type: 'object', properties: { finding: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['finding', 'examples'] },
        winning_angles_hooks: { type: 'object', properties: { finding: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['finding', 'examples'] },
        winning_visuals:      { type: 'object', properties: { finding: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['finding', 'examples'] },
        winning_headlines:    {
          type: 'object',
          properties: {
            finding: { type: 'string' },
            structure: { type: 'string' },
            word_count_range: { type: 'string' },
            examples: { type: 'array', items: { type: 'string' } },
          },
          required: ['finding', 'structure', 'word_count_range', 'examples'],
        },
        winning_subheadlines: { type: 'object', properties: { finding: { type: 'string' } }, required: ['finding'] },
        winning_body:         { type: 'object', properties: { finding: { type: 'string' } }, required: ['finding'] },
        cta_presence: {
          type: 'object',
          properties: {
            with_cta: { type: 'string' },
            without_cta: { type: 'string' },
            verdict: { type: 'string' },
          },
          required: ['with_cta', 'without_cta', 'verdict'],
        },
        winning_combinations: {
          type: 'object',
          properties: {
            finding: { type: 'string' },
            top_stacks: { type: 'array', items: { type: 'string' } },
          },
          required: ['finding', 'top_stacks'],
        },
        losing_patterns: { type: 'object', properties: { finding: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['finding', 'examples'] },
      },
    },
    next_test_batch: {
      type: 'object',
      required: ['rationale', 'variations_per_spec', 'specs'],
      properties: {
        rationale: { type: 'string' },
        variations_per_spec: { type: 'number' },
        specs: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'name', 'ad_format', 'composition', 'tam', 'persona', 'micro_persona',
              'desire', 'awareness_level', 'sophistication_level', 'concept', 'angle',
              'headline_structure', 'headline_word_count', 'headline_example',
              'subheadline_role', 'subheadline_example', 'cta_framing', 'cta_example',
              'body_role', 'behavioral_economics', 'trust_signals', 'visual_direction',
              'why_this_test',
            ],
            properties: {
              name: { type: 'string' },
              ad_format: { type: 'string' },
              composition: { type: 'string' },
              tam: { type: 'string' },
              persona: { type: 'string' },
              micro_persona: { type: 'string' },
              desire: { type: 'string' },
              awareness_level: { type: 'string' },
              sophistication_level: { type: 'string' },
              concept: { type: 'string' },
              angle: { type: 'string' },
              headline_structure: { type: 'string' },
              headline_word_count: { type: 'string' },
              headline_example: { type: 'string' },
              subheadline_role: { type: 'string' },
              subheadline_example: { type: 'string' },
              cta_framing: { type: 'string' },
              cta_example: { type: 'string' },
              body_role: { type: 'string' },
              behavioral_economics: { type: 'array', items: { type: 'string' } },
              trust_signals: { type: 'array', items: { type: 'string' } },
              visual_direction: { type: 'string' },
              why_this_test: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const
