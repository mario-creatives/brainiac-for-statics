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
  // Removed from generation: redundant with the per-ad "What to test next"
  // feature. Kept as an optional field so legacy cached reports still read.
  per_ad_recommendations?: {
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

  // Audience
  tam: string
  persona: string
  micro_persona: string
  desire: string
  awareness_level: string
  sophistication_level: string

  // Concept
  concept: string
  angle: string

  // FINAL COPY — written in this brand's voice, ready to hand off. Not examples.
  brand_voice_notes: string          // 1-2 sentences on the voice this spec uses, derived from cohort winners
  headline: string                   // the actual final headline
  headline_structure: string         // metadata — what structure pattern this headline embodies
  subheadline: string                // the actual final subheadline, or empty string if absent
  subheadline_role: string           // metadata — "amplify | specify | credentialize | tonal-shift | absent"
  body_copy: string                  // the actual final body copy, or empty string if body_role is absent
  body_role: string                  // "benefits | social_proof | story | mechanism | absent"
  cta: string                        // the actual final CTA text
  cta_framing: string                // metadata — "direct | soft | value | curiosity"

  // Production direction
  behavioral_economics: string[]
  trust_signals: string[]
  visual_direction: string           // detailed brief for the designer — composition, palette, key visual, focal point
  production_notes: string           // any specific layering, urgency cues, or layout instructions (empty if none)

  // Justification
  why_this_test: string              // 1-2 sentences citing specific winning ad IDs from the cohort
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

    // Cap input to the most informative ads so the model can do quality
    // synthesis instead of choking on 79+ entries. Take all winners + all
    // investigates (high-spend signal, both kinds), plus top losers by spend
    // (the failures that actually got tested). This keeps total input under
    // ~30 ads, which keeps the LLM call reliable and the response complete.
    const SAMPLE_CAP = 30
    const winners      = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'winner').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const investigates = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'investigate').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const promising   = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'promising').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const losers      = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'loser').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const sampled = [
      ...winners,
      ...investigates,
      ...promising.slice(0, 5),
      ...losers.slice(0, Math.max(0, SAMPLE_CAP - winners.length - investigates.length - 5)),
    ].slice(0, SAMPLE_CAP)
    const sampleNote = sampled.length < rows.length
      ? `(sampled the most informative ${sampled.length} of ${rows.length} total ads: all winners + all investigates + top losers by spend)`
      : ''

    // Pull metrics history per sampled ad for fatigue detection
    const adIds = sampled.map(r => r.id)
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

    const adSummaries = sampled.map((r, i) => {
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
    const prompt = `You are a senior performance creative strategist. You have ${sampled.length} static ads for product "${product.name}"${product.vertical_category ? ` (${product.vertical_category})` : ''}${targetCpa != null ? ` with target CPA of $${targetCpa}` : ''} ${sampleNote}. Your job is to produce a concrete, no-fluff action plan grounded in this exact data.

ADS:
${adSummaries.join('\n\n')}

QUADRANT DEFINITIONS:
- winner: spend ≥ $1k AND cpa ≤ target — scale + iterate
- promising: spend < $1k AND cpa ≤ target — increase spend to confirm
- investigate: spend ≥ $1k AND cpa > target — diagnose and fix
- loser: spend < $1k AND cpa > target — salvage test or kill

You MUST call the submit_action_plan tool. Do not respond with text. Empty strings, single words, or skeleton placeholders in any required field will be rejected and force a regenerate.

CONTENT REQUIREMENTS:

summary_actions — 3-5 top-level actions, each a full sentence citing specific ad IDs (e.g. "Scale A3, A7, A11 immediately — they're at $32, $38, $40 CPA and validated past $1k spend"). No fluff openers like "the data shows" or "winners typically".

breakdown — proper sentences in EVERY "finding" field. For each section, state WHAT wins (or loses) AND WHY in one breath, citing ad IDs. For sections where the cohort doesn't have enough data to draw a conclusion, write a sentence explaining that explicitly (e.g. "Only 3 ads have age_range data — too thin to draw a winning pattern; collect targeting data to enable this finding"). Never leave a finding blank.

next_test_batch.specs — 3-5 FINISHED CREATIVE BRIEFS, not templated forms. You are this brand's senior copywriter. You have read every winning ad's headline, subheadline, body, and CTA in the cohort. You know this brand's voice — its cadence, vocabulary, level of formality, sentence length, what it always says, what it never says. WRITE the final copy in that voice, not example placeholders:

  - headline: the actual headline that goes in the ad. Match the cohort's voice exactly — same syntax patterns, same tone register, same level of specificity. If winners use 6-word outcome claims, write a 6-word outcome claim. Don't invent a foreign voice.
  - subheadline: the actual subheadline (empty string ONLY if subheadline_role is "absent"). Same voice match.
  - body_copy: the actual body copy (empty string ONLY if body_role is "absent").
  - cta: the actual CTA text.
  - brand_voice_notes: 1-2 sentences naming THIS brand's voice attributes as you observed them in the cohort (e.g. "Beam's winners use second-person direct address, present-tense outcome claims, 6-8 words max, never use exclamation points, lean on time-bound specifics like '12 minutes' over vague claims like 'fast'").
  - visual_direction: a real designer brief — composition, palette, key visual, focal point. Not "show product clearly" — say "tight close-up of woman 35-44 with relaxed expression in soft warm bedroom lighting, product bottle in lower-right third, copy left-aligned over upper third with the relaxed face as primary focal point". Specific enough to design from.
  - production_notes: any specific layering, urgency cues, layout instructions. Empty string if none.

Plus the metadata fields (TAM, persona, micro_persona, desire, awareness, sophistication, concept, angle, headline_structure, subheadline_role, body_role, cta_framing, behavioral_economics, trust_signals, ad_format, composition) — these describe what the copy IS doing strategically. Both the copy AND the metadata get filled.

Specs MUST differ in angle OR persona OR awareness level — not just reword the same concept with different headlines. variations_per_spec is typically 3-5 (sub-variations the strategist makes from each finished brief).

why_this_test cites specific winning ad IDs from the cohort (e.g. "A3 and A7 prove that 6-word outcome-claim headlines for solution-aware sleep-deprived adults convert at $32-40 CPA; this spec extends that pattern to the perimenopausal micro-persona which has no winner yet").

Call submit_action_plan now.`

    // Opus 4.7 is materially more reliable at filling complex tool_use schemas
    // with substantive content. Sonnet was returning skeleton submissions
    // (empty strings, single words) when the schema was this large; for an
    // infrequent, quality-critical synthesis like the action plan, Opus is
    // worth the cost.
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16000,
      tools: [{
        name: 'submit_action_plan',
        description: 'Submit the structured product action plan.',
        input_schema: ACTION_PLAN_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'submit_action_plan' },
      messages: [{ role: 'user', content: prompt }],
    })

    if (message.stop_reason === 'max_tokens') {
      await deleteCachedReport(productId)
      return { error: 'Response truncated at the model token ceiling. Click Regenerate to try again.' }
    }

    const toolUse = message.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      const textBlock = message.content.find(b => b.type === 'text')
      const raw = textBlock?.type === 'text' ? textBlock.text : ''
      try {
        const partial = parseClaudeJson<Omit<ProductRecommendationReport, 'generated_at' | 'ads_analyzed'>>(raw)
        const emptyReason = detectEmptyReport(partial)
        if (emptyReason) {
          await deleteCachedReport(productId)
          return { error: `Model returned an incomplete plan (${emptyReason}). Click Regenerate.` }
        }
        const report: ProductRecommendationReport = { ...partial, generated_at: new Date().toISOString(), ads_analyzed: sampled.length }
        await supabaseServer
          .from('product_recommendations')
          .upsert({ product_id: productId, generated_at: report.generated_at, ads_analyzed: report.ads_analyzed, report }, { onConflict: 'product_id' })
        return report
      } catch {
        await deleteCachedReport(productId)
        return { error: 'Model did not return structured data. Click Regenerate.' }
      }
    }

    const partial = toolUse.input as Omit<ProductRecommendationReport, 'generated_at' | 'ads_analyzed'>

    const emptyReason = detectEmptyReport(partial)
    if (emptyReason) {
      // Delete stale cached report so the user sees the empty state on next
      // load instead of the previous broken version. Without this, repeated
      // regenerate failures keep showing the original garbage report.
      await deleteCachedReport(productId)
      return { error: `Model returned an incomplete plan (${emptyReason}). Click Regenerate.` }
    }

    const report: ProductRecommendationReport = {
      ...partial,
      generated_at: new Date().toISOString(),
      ads_analyzed: sampled.length,
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

async function deleteCachedReport(productId: string): Promise<void> {
  await supabaseServer.from('product_recommendations').delete().eq('product_id', productId)
}

// Returns a human-readable reason if the report is missing substantive content,
// or null if it has the minimum required substance to be saved.
function detectEmptyReport(p: Partial<ProductRecommendationReport>): string | null {
  if (!p.summary_actions?.length) return 'no summary_actions'
  if (p.summary_actions.some(s => !s?.trim() || s.trim().length < 10)) return 'summary_actions contain empty/placeholder strings'
  const b = p.breakdown
  if (!b) return 'no breakdown'
  const findings = [
    b.winning_formats?.finding,
    b.winning_age_ranges?.finding,
    b.winning_angles_hooks?.finding,
    b.winning_visuals?.finding,
    b.winning_headlines?.finding,
    b.winning_subheadlines?.finding,
    b.winning_body?.finding,
    b.cta_presence?.verdict,
    b.winning_combinations?.finding,
    b.losing_patterns?.finding,
  ]
  const populated = findings.filter(f => typeof f === 'string' && f.trim().length >= 20).length
  if (populated < 7) return `only ${populated}/10 breakdown findings have substantive content`
  if (!p.next_test_batch?.specs?.length) return 'no next_test_batch.specs'
  // Spot-check that the specs are actually written, not skeleton placeholders.
  const firstSpec = p.next_test_batch.specs[0]
  if (!firstSpec?.headline?.trim() || !firstSpec?.tam?.trim() || !firstSpec?.concept?.trim() || !firstSpec?.visual_direction?.trim()) {
    return 'next_test_batch.specs contain empty required fields (headline / tam / concept / visual_direction)'
  }
  // Reject placeholder-style copy that some weaker schema submissions produce
  if (firstSpec.headline.length < 6 || /^<.+>$/.test(firstSpec.headline.trim())) {
    return 'first spec headline looks like a placeholder, not real copy'
  }
  return null
}

const ACTION_PLAN_SCHEMA = {
  type: 'object',
  required: ['summary_actions', 'breakdown', 'next_test_batch'],
  properties: {
    summary_actions: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 top-level actions, each citing specific ad IDs',
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
              'name', 'ad_format', 'composition',
              'tam', 'persona', 'micro_persona', 'desire', 'awareness_level', 'sophistication_level',
              'concept', 'angle',
              'brand_voice_notes',
              'headline', 'headline_structure',
              'subheadline', 'subheadline_role',
              'body_copy', 'body_role',
              'cta', 'cta_framing',
              'behavioral_economics', 'trust_signals',
              'visual_direction', 'production_notes',
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
              brand_voice_notes: { type: 'string' },
              headline: { type: 'string' },
              headline_structure: { type: 'string' },
              subheadline: { type: 'string' },
              subheadline_role: { type: 'string' },
              body_copy: { type: 'string' },
              body_role: { type: 'string' },
              cta: { type: 'string' },
              cta_framing: { type: 'string' },
              behavioral_economics: { type: 'array', items: { type: 'string' } },
              trust_signals: { type: 'array', items: { type: 'string' } },
              visual_direction: { type: 'string' },
              production_notes: { type: 'string' },
              why_this_test: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const
