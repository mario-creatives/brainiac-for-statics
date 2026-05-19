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
  sourcing_requirements: string      // when the format requires a real person (testimonial/UGC/before-after), the casting brief; empty string otherwise

  // Justification
  why_this_test: string              // 1-2 sentences citing specific winning ad IDs from the cohort

  // Auditable data basis — every spec must derive from specific cohort signals.
  // The action-plan UI renders this as a "Derived from" block so the user can
  // click into each cited ad and verify the spec is grounded in real data, not
  // generic ad-brief patterns. detectEmptyReport rejects specs where every
  // role array is empty.
  data_basis: {
    replicates_from: string[]                  // winner ad IDs whose pattern this spec replicates
    avoids_pattern_of: string[]                // loser ad IDs whose pattern this spec deliberately avoids
    addresses_investigate_weakness: string[]   // investigate ad IDs whose bleeder this spec fixes
    extends_promising_signal: string[]         // promising ad IDs this spec extends to confirm
    contrastive_findings_used: string[]        // 1-line strings referencing specific contrasts from the analytics block
    loss_modes_addressed: string[]             // loss_reason enum values this spec is designed to avoid
  }
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

    // Empirical constraints from the cohort's winners (or all sampled if winner
    // count is low). These are NUMBERS, not Claude's interpretation — the model
    // is told to honor these exact ranges when writing spec copy. Without this
    // the model fabricated subheadlines of 350+ characters even when no winner
    // had ever used a subheadline that long, and included CTAs even when the
    // breakdown's own cta_presence.verdict said CTA wasn't the lever.
    // Full-cohort analytics: per-quadrant aggregates (winners / promising /
    // investigate / losers) plus contrastive findings, loss diagnostics, and
    // audience-match correlation. Replaces the old winner-only constraints
    // block — the prompt now sees signal from every quadrant.
    const analyticsRows: QuadrantAdRow[] = sampled.map(r => ({
      id: r.id,
      comprehensive_analysis: r.comprehensive_analysis,
      spend_usd: r.spend_usd,
      quadrant: r.quadrant,
      quadrant_override: r.quadrant_override,
      loss_reason: r.loss_reason,
    }))
    const cohortAnalytics = computeCohortAnalytics(analyticsRows)
    const constraintsText = formatCohortAnalytics(cohortAnalytics)

    const targetCpa = product.target_cpa_usd ?? null
    const prompt = `You are a senior performance creative strategist. You have ${sampled.length} static ads for product "${product.name}"${product.vertical_category ? ` (${product.vertical_category})` : ''}${targetCpa != null ? ` with target CPA of $${targetCpa}` : ''} ${sampleNote}. Your job is to produce a concrete, no-fluff action plan grounded in this exact data.

ADS:
${adSummaries.join('\n\n')}

COHORT ANALYTICS — deterministically computed from every sampled ad's comprehensive analysis, split per quadrant (winners / promising / investigate / losers). The CONTRASTIVE FINDINGS section names specific deltas between quadrants. The LOSS DIAGNOSTICS section names the failure modes that recur in losers + investigates. Treat ALL numbers and named attributes as HARD CONSTRAINTS on spec design.

${constraintsText}

QUADRANT DEFINITIONS:
- winner: spend ≥ $1k AND cpa ≤ target — scale + iterate
- promising: spend < $1k AND cpa ≤ target — increase spend to confirm
- investigate: spend ≥ $1k AND cpa > target — diagnose and fix
- loser: spend < $1k AND cpa > target — salvage test or kill

You MUST call the submit_action_plan tool. Do not respond with text. Empty strings, single words, or skeleton placeholders in any required field will be rejected and force a regenerate.

CONTENT REQUIREMENTS:

summary_actions — 3-5 top-level actions, each a full sentence citing specific ad IDs (e.g. "Scale A3, A7, A11 immediately — they're at $32, $38, $40 CPA and validated past $1k spend"). No fluff openers like "the data shows" or "winners typically".

breakdown — proper sentences in EVERY "finding" field. For each section, state WHAT wins (or loses) AND WHY in one breath, citing ad IDs. For sections where the cohort doesn't have enough data to draw a conclusion, write a sentence explaining that explicitly (e.g. "Only 3 ads have age_range data — too thin to draw a winning pattern; collect targeting data to enable this finding"). Never leave a finding blank.

next_test_batch.specs — 3-5 FINISHED CREATIVE BRIEFS that are DERIVATIONS from the breakdown findings AND the empirical constraints above. Every spec decision must trace back:

  - If cta_presence.verdict says CTA isn't the lever, at least one spec MUST have no CTA. Use empty string for cta and set cta_framing to "none". The body or headline should carry the persuasion.
  - Element load (headline + subheadline + body + cta + benefits + trust_signals) MUST vary across specs to span the cohort's measured element-count range. If winners cluster at low element counts (2-3 populated elements), most specs should be lean. If winners use full element loads, more specs can be loaded. NEVER pile every element on every spec — that's the element-overload trap your breakdown is meant to call out.
  - Headline word count MUST fall in the empirical headline range. CTA word count (when present) MUST fall in the empirical CTA range. Subheadline length (when present) MUST fall in the empirical subheadline range. Body length MUST fall in the body range.
  - Headline STYLE must match the dominant attributes in the empirical block: same voice/person/tense, dominant structure_type, dominant sentence_type, dominant register, dominant specificity_level. If winners NEVER use exclamation points (or any specific punctuation), your specs MUST NOT use them either. If winners NEVER use metaphor/negation/contrast, do not introduce those.
  - CTA STYLE (when included) must use one of the verbs winners use, the dominant framing, the dominant friction_level. Don't invent new verb patterns the winners haven't validated.
  - Body STYLE (when included) must match the dominant frame and pronoun_density.
  - READ the verbatim exemplars in the empirical block. Your written copy MUST read like it belongs in that list — same syntax patterns, same vocabulary tier, same cadence, same emotional register, same level of specificity. If a verbatim winner says "Falling asleep in 12 minutes again", do not write "Get amazing sleep!" — that breaks every style signal at once. Stay in the voice.
  - Composition_tag and ad_format SHOULD lean toward the top winning compositions/formats from the empirical data, unless the spec is explicitly contrarian (which must be justified in why_this_test).

You are this brand's senior copywriter. You have read every winning ad's headline, subheadline, body, and CTA. You know this brand's voice — its cadence, vocabulary, sentence length, what it always says, what it never says. WRITE the final copy in that voice:

  - headline: the actual headline that goes in the ad. Match the cohort's voice exactly.
  - subheadline: the actual subheadline (empty string ONLY if subheadline_role is "absent"). Stay within the empirical char range.
  - body_copy: the actual body copy (empty string ONLY if body_role is "absent"). Stay within the empirical body word range.
  - cta: the actual CTA text (empty string ONLY if cta_framing is "none").
  - brand_voice_notes: 1-2 sentences naming THIS brand's observed voice attributes BY ATTRIBUTE NAME from the empirical block — voice, person, tense, register, structure tendencies, punctuation conventions, vocabulary tier. Concrete. Example: "Voice: active, second-person, present-tense, statement-form. Dominant structure: outcome-claim with mechanism. Register: warm-confident, never urgent or clinical. No exclamation points, em-dashes used for emphasis. Specificity: high — time-bound numerics like '12 minutes' over vague qualifiers."

SOURCING vs WRITING — when a spec's ad_format requires a real person (testimonial card, UGC, before/after photo, founder portrait, real customer quote), you CANNOT fabricate the quote or invent a person. Instead:
  - Fill sourcing_requirements with a casting/sourcing brief: who to find, what they should have experienced, what they should be able to say or show, what setting they should be in. Be specific.
  - body_copy becomes the PATTERN of the quote you want sourced (e.g. "I was X for Y years, then Z. Now W in T days.") — describe the quote shape, do not invent the quote.
  - headline, cta remain overlay copy you write yourself.
For non-sourcing specs (designed-from-scratch creative), set sourcing_requirements to empty string.

visual_direction must be a real designer brief — composition, palette, key visual, focal point. Not "show product clearly" — say "tight close-up of woman 35-44 with relaxed expression in soft warm bedroom lighting, product bottle in lower-right third, copy left-aligned over upper third with the relaxed face as primary focal point". Specific enough to design from.

production_notes: any specific layering, urgency cues, or layout instructions. Empty string if none.

Specs MUST differ in angle OR persona OR awareness level OR element load — not just reword the same concept. variations_per_spec is typically 3-5.

why_this_test cites specific winning ad IDs from the cohort AND names the breakdown finding (or empirical constraint) that justifies the spec's decisions (e.g. "A3, A7 prove 6-word outcome-claim headlines win for solution-aware sleep-deprived adults at $32-40 CPA; cta_presence.verdict says CTA isn't the lever for cold confessional formats so this spec omits the CTA; element count of 3 matches the median winning load").

data_basis (REQUIRED — every spec, every field): the spec must be a derivation from the cohort, not a freestanding brief. Populate:
  - replicates_from: ad IDs of winners whose pattern this spec replicates (the "do this" signal).
  - avoids_pattern_of: ad IDs of losers whose pattern this spec deliberately avoids (the "don't do this" signal). Note: refer to losers by ID in the cohort; do not paste loser copy.
  - addresses_investigate_weakness: ad IDs of investigates whose bleeder this spec proposes a fix for. Investigates earned distribution but failed at conversion — your spec should keep what worked (the hook signal) and swap the specific element identified in winner_vs_investigate_deltas.
  - extends_promising_signal: ad IDs of promising ads this spec extends to confirm (same angle / persona, scaled).
  - contrastive_findings_used: 1-line strings copied or paraphrased from the CONTRASTIVE FINDINGS or LOSS DIAGNOSTICS sections above that justify the spec's decisions. Minimum one entry per spec.
  - loss_modes_addressed: loss_reason enum values this spec is designed to NOT fall into (e.g. ["weak_hook", "wrong_audience"]). Empty array if no loss modes specifically targeted.

At least one of {replicates_from, avoids_pattern_of, addresses_investigate_weakness, extends_promising_signal} MUST be non-empty per spec. contrastive_findings_used MUST have at least one entry. Specs that fail this validation are rejected and force a regenerate.

Use the AD line IDs from the ADS list above when populating data_basis (they're 36-character UUIDs after [id=...]). Do not use the short A3 / A7 labels — those are for human reading.

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
  // Every spec must be grounded — data_basis with at least one ad ID and at
  // least one contrastive finding cited. Without this guard the model can
  // produce specs that don't trace back to any concrete cohort data.
  for (let i = 0; i < p.next_test_batch.specs.length; i++) {
    const s = p.next_test_batch.specs[i]
    const db = s.data_basis
    if (!db) return `spec #${i + 1} missing data_basis`
    const totalCitations =
      (db.replicates_from?.length ?? 0) +
      (db.avoids_pattern_of?.length ?? 0) +
      (db.addresses_investigate_weakness?.length ?? 0) +
      (db.extends_promising_signal?.length ?? 0)
    if (totalCitations === 0) return `spec #${i + 1} data_basis cites no ad IDs across any of the four roles`
    if (!db.contrastive_findings_used?.length) return `spec #${i + 1} data_basis cites no contrastive findings`
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
              'visual_direction', 'production_notes', 'sourcing_requirements',
              'why_this_test',
              'data_basis',
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
              sourcing_requirements: { type: 'string' },
              why_this_test: { type: 'string' },
              data_basis: {
                type: 'object',
                required: ['replicates_from', 'avoids_pattern_of', 'addresses_investigate_weakness', 'extends_promising_signal', 'contrastive_findings_used', 'loss_modes_addressed'],
                properties: {
                  replicates_from: { type: 'array', items: { type: 'string' } },
                  avoids_pattern_of: { type: 'array', items: { type: 'string' } },
                  addresses_investigate_weakness: { type: 'array', items: { type: 'string' } },
                  extends_promising_signal: { type: 'array', items: { type: 'string' } },
                  contrastive_findings_used: { type: 'array', items: { type: 'string' } },
                  loss_modes_addressed: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

interface NumRange { min: number; max: number; p50: number }

// Per-quadrant aggregates — computed independently for winners / promising /
// investigate / losers and combined into CohortAnalytics. The action-plan
// prompt surfaces these side-by-side so the model can read contrasts directly.
interface CohortConstraints {
  source_label: string
  sample_size: number
  // Size constraints — empirical word/char ranges + presence rates
  headline_words: NumRange | null
  headline_chars: NumRange | null
  subheadline_presence_rate: number
  subheadline_chars: NumRange | null
  body_presence_rate: number
  body_words: NumRange | null
  cta_presence_rate: number
  cta_words: NumRange | null
  benefits_presence_rate: number
  benefits_count: NumRange | null
  trust_presence_rate: number
  trust_count: NumRange | null
  element_counts: NumRange | null
  compositions: Record<string, number>
  formats: Record<string, number>
  // Style constraints — voice / register / structure / punctuation
  headline_style: StyleAggregates
  cta_style: CtaStyleAggregates
  body_style: BodyStyleAggregates
  // Verbatim exemplars (only meaningful for winners; non-winner quadrants
  // populate these but the formatter doesn't render loser/investigate copy)
  headline_exemplars: string[]
  subheadline_exemplars: string[]
  cta_exemplars: string[]
  body_exemplars: string[]
  // ── Strategy + analysis aggregates (new) ──────────────────────────────
  behavioral_economics_rates: Record<string, number>     // scarcity, urgency, etc → presence rate
  framework_grades: Record<'A' | 'B' | 'C' | 'D', number>
  awareness_levels: Record<string, number>
  sophistication_levels: Record<string, number>
  attention_score_median: number | null
  cognitive_load_median: number | null
  congruence_median: number | null
  fit_dimension_medians: Record<string, number | null>    // angle_quality, register_fit, cognitive_load_fit, placement_fit, format_choice_fit, audience_targeting_fit
  // ── Per-ad enrichment aggregates (new) ────────────────────────────────
  visual_inventory: {
    face_presence_rate: number
    product_visibility_distribution: Record<string, number>
    top_settings: Array<[string, number]>
    top_props: Array<[string, number]>
    warmth_distribution: Record<string, number>
    contrast_level_distribution: Record<string, number>
    sample_count: number
  } | null
  voice_consistency_median: number | null
  curiosity_gap: {
    gap_strength_median: number
    body_resolves_rate: number
    sample_count: number
  } | null
  writing_quality: {
    headline_grade_median: number | null
    body_grade_median: number | null
    avg_sentence_length_median: number | null
    active_voice_ratio_median: number | null
    adverb_density_median: number | null
    weasel_word_density_median: number | null
    sample_count: number
  } | null
}

// Top-level analytics shape combining per-quadrant aggregates with cross-quadrant
// contrasts, loss diagnostics, and audience-match correlation. This is what the
// action-plan prompt consumes.
interface CohortAnalytics {
  by_quadrant: Record<Quadrant, CohortConstraints>
  contrasts: {
    winner_exclusive_attributes: string[]
    loser_exclusive_attributes: string[]
    presence_rate_gaps: string[]
    winner_vs_investigate_deltas: string[]
  }
  loss_diagnostics: {
    loss_reason_distribution: Array<[string, number]>
    recurring_priority_fixes: string[]
    recurring_critical_weaknesses: string[]
    format_failure_mode_distribution: Array<[string, number]>
  }
  audience_match_correlation: {
    aligned_rate_by_quadrant: Record<Quadrant, number>
    mismatch_examples: Array<{ ad_id: string; quadrant: Quadrant; mismatches: string[] }>
  }
}

interface StyleAggregates {
  voice: Array<[string, number]>             // active vs passive
  person: Array<[string, number]>            // 1st / 2nd / 3rd
  tense: Array<[string, number]>             // present / past / future
  sentence_type: Array<[string, number]>     // statement / question / imperative
  structure_type: Array<[string, number]>    // outcome-claim / mechanism-reveal / etc.
  specificity_level: Array<[string, number]>
  emotional_register: Array<[string, number]>
  tone_register: Array<[string, number]>
  mechanism_present_rate: number
  audience_explicit_rate: number
  outcome_explicit_rate: number
  time_bound_rate: number
  uses_metaphor_rate: number
  uses_negation_rate: number
  uses_contrast_rate: number
  punctuation_signals: Array<[string, number]>
}

interface CtaStyleAggregates {
  verbs: Array<[string, number]>
  framing: Array<[string, number]>
  friction_level: Array<[string, number]>
  has_value_anchor_rate: number
  has_urgency_signal_rate: number
}

interface BodyStyleAggregates {
  frame: Array<[string, number]>
  pronoun_density: Array<[string, number]>
}

function range(arr: number[]): NumRange | null {
  if (arr.length === 0) return null
  const sorted = [...arr].sort((a, b) => a - b)
  return { min: sorted[0], max: sorted[sorted.length - 1], p50: sorted[Math.floor(sorted.length / 2)] }
}

function modeCount(arr: Array<string | null | undefined>): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const v of arr) {
    if (typeof v === 'string' && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function rate(present: number, total: number): number {
  return total > 0 ? present / total : 0
}

// Pulls measurable copy/composition/style/strategy/visual/quality stats AND
// verbatim copy exemplars from each ad's comprehensive analysis. Called once
// per quadrant by computeCohortAnalytics. The numbers feed the empirical
// per-quadrant block in the prompt; the verbatim exemplars are rendered only
// for the winner quadrant (preserving voice-signal cleanliness).
function computeCohortConstraints(rows: Array<{ comprehensive_analysis: Record<string, unknown>; spend_usd: number | null }>): CohortConstraints {
  const headlineWords: number[] = []
  const headlineChars: number[] = []
  const subheadlineChars: number[] = []
  const bodyWords: number[] = []
  const ctaWords: number[] = []
  const benefitsCounts: number[] = []
  const trustCounts: number[] = []
  const elementCounts: number[] = []
  const compositions = new Map<string, number>()
  const formats = new Map<string, number>()
  let subheadlinePresent = 0
  let bodyPresent = 0
  let ctaPresent = 0
  let benefitsPresent = 0
  let trustPresent = 0

  // Style accumulators (headline)
  const hVoice: Array<string | undefined> = []
  const hPerson: Array<string | undefined> = []
  const hTense: Array<string | undefined> = []
  const hSentenceType: Array<string | undefined> = []
  const hStructureType: Array<string | undefined> = []
  const hSpecificity: Array<string | undefined> = []
  const hEmotionalRegister: Array<string | undefined> = []
  const hToneRegister: Array<string | undefined> = []
  let hMechanism = 0, hAudExplicit = 0, hOutcomeExplicit = 0, hTimeBound = 0
  let hMetaphor = 0, hNegation = 0, hContrast = 0
  const hPunctuation: string[] = []

  // CTA style
  const cVerb: Array<string | undefined> = []
  const cFraming: Array<string | undefined> = []
  const cFriction: Array<string | undefined> = []
  let cValueAnchor = 0, cUrgency = 0

  // Body style
  const bFrame: Array<string | undefined> = []
  const bPronoun: Array<string | undefined> = []

  // Verbatim exemplars (paired with spend for ranking)
  const headlineCandidates: Array<{ text: string; spend: number }> = []
  const subheadlineCandidates: Array<{ text: string; spend: number }> = []
  const ctaCandidates: Array<{ text: string; spend: number }> = []
  const bodyCandidates: Array<{ text: string; spend: number }> = []

  // Strategy + analysis aggregates
  const beCounts: Record<string, number> = {}
  const grades: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 }
  const awareness: Record<string, number> = {}
  const sophistication: Record<string, number> = {}
  const attentionScores: number[] = []
  const cogLoadScores: number[] = []
  const congruenceScores: number[] = []
  const fitDimensions: Record<string, number[]> = {
    angle_quality: [], register_fit: [], cognitive_load_fit: [],
    placement_fit: [], format_choice_fit: [], audience_targeting_fit: [],
  }

  // Visual inventory aggregates
  let viSampleCount = 0
  let facePresent = 0
  const productVisibility: Record<string, number> = {}
  const settings = new Map<string, number>()
  const props = new Map<string, number>()
  const warmth: Record<string, number> = {}
  const contrastLevel: Record<string, number> = {}

  // Voice consistency + curiosity gap aggregates
  const voiceConsistencyScores: number[] = []
  const gapStrengths: number[] = []
  let gapBodyResolves = 0
  let cgSampleCount = 0

  // Writing quality aggregates
  const wqHeadlineGrades: number[] = []
  const wqBodyGrades: number[] = []
  const wqAvgSentenceLengths: number[] = []
  const wqActiveVoiceRatios: number[] = []
  const wqAdverbDensities: number[] = []
  const wqWeaselDensities: number[] = []
  let wqSampleCount = 0

  for (const r of rows) {
    const ca = r.comprehensive_analysis as Record<string, unknown>
    const copy = ca.copy as Record<string, unknown> | undefined
    const spend = r.spend_usd ?? 0
    let elements = 0

    const headlineBlock = copy?.headline as Record<string, unknown> | undefined
    const hd = headlineBlock?.dna as Record<string, unknown> | undefined
    if (hd) {
      if (typeof hd.word_count === 'number') headlineWords.push(hd.word_count)
      if (typeof hd.char_count === 'number') headlineChars.push(hd.char_count)
      hVoice.push(hd.voice as string | undefined)
      hPerson.push(hd.person as string | undefined)
      hTense.push(hd.tense as string | undefined)
      hSentenceType.push(hd.sentence_type as string | undefined)
      hStructureType.push(hd.structure_type as string | undefined)
      hSpecificity.push(hd.specificity_level as string | undefined)
      hEmotionalRegister.push(hd.emotional_register as string | undefined)
      hToneRegister.push(hd.tone_register as string | undefined)
      if (hd.mechanism_present)  hMechanism++
      if (hd.audience_explicit)  hAudExplicit++
      if (hd.outcome_explicit)   hOutcomeExplicit++
      if (hd.time_bound)         hTimeBound++
      if (hd.uses_metaphor)      hMetaphor++
      if (hd.uses_negation)      hNegation++
      if (hd.uses_contrast)      hContrast++
      const punct = hd.punctuation_signals
      if (Array.isArray(punct)) for (const p of punct) if (typeof p === 'string') hPunctuation.push(p)
      elements++
    }
    const headlineText = headlineBlock?.text
    if (typeof headlineText === 'string' && headlineText.trim()) {
      headlineCandidates.push({ text: headlineText.trim(), spend })
    }

    const subheadlineBlock = copy?.subheadline as Record<string, unknown> | undefined
    const sd = subheadlineBlock?.dna as Record<string, unknown> | undefined
    if (sd && sd.role !== 'absent') {
      subheadlinePresent++
      if (typeof sd.char_count === 'number') subheadlineChars.push(sd.char_count)
      elements++
      const subText = subheadlineBlock?.text
      if (typeof subText === 'string' && subText.trim()) {
        subheadlineCandidates.push({ text: subText.trim(), spend })
      }
    }

    const body = ca.body_dna as Record<string, unknown> | undefined
    if (body && typeof body.word_count === 'number' && body.word_count > 0) {
      bodyPresent++
      bodyWords.push(body.word_count)
      bFrame.push(body.frame as string | undefined)
      bPronoun.push(body.personal_pronoun_density as string | undefined)
      elements++
    }
    const bodyText = (copy?.body as Record<string, unknown> | undefined)?.text ?? ca.body_text
    if (typeof bodyText === 'string' && bodyText.trim() && bodyText.length < 600) {
      bodyCandidates.push({ text: bodyText.trim(), spend })
    }

    const ctaBlock = copy?.cta as Record<string, unknown> | undefined
    const cd = ctaBlock?.dna as Record<string, unknown> | undefined
    if (cd) {
      ctaPresent++
      if (typeof cd.word_count === 'number') ctaWords.push(cd.word_count)
      cVerb.push(cd.verb as string | undefined)
      cFraming.push(cd.framing as string | undefined)
      cFriction.push(cd.friction_level as string | undefined)
      if (cd.has_value_anchor)   cValueAnchor++
      if (cd.has_urgency_signal) cUrgency++
      elements++
      const ctaText = ctaBlock?.text
      if (typeof ctaText === 'string' && ctaText.trim()) {
        ctaCandidates.push({ text: ctaText.trim(), spend })
      }
    }

    const bd = (copy?.benefits_features as Record<string, unknown> | undefined)?.dna as Record<string, unknown> | undefined
    if (bd && typeof bd.count === 'number' && bd.count > 0) {
      benefitsPresent++
      benefitsCounts.push(bd.count)
      elements++
    }

    const td = (copy?.trust_signals as Record<string, unknown> | undefined)?.dna as Record<string, unknown> | undefined
    if (td && typeof td.count === 'number' && td.count > 0) {
      trustPresent++
      trustCounts.push(td.count)
      elements++
    }

    elementCounts.push(elements)

    const ct = ca.composition_tag
    if (typeof ct === 'string') compositions.set(ct, (compositions.get(ct) ?? 0) + 1)

    const fmt = (ca.ad_format as Record<string, unknown> | undefined)?.type
    if (typeof fmt === 'string') formats.set(fmt, (formats.get(fmt) ?? 0) + 1)

    // Behavioral economics — count each signal where present=true
    const be = ca.behavioral_economics as Record<string, unknown> | undefined
    if (be) {
      for (const signal of ['scarcity', 'urgency', 'social_proof', 'anchoring', 'loss_aversion', 'authority', 'reciprocity']) {
        const block = be[signal] as { present?: boolean } | undefined
        if (block?.present) beCounts[signal] = (beCounts[signal] ?? 0) + 1
      }
    }

    // Framework grade distribution
    const fs = ca.framework_score as Record<string, unknown> | undefined
    const grade = fs?.overall_framework_grade
    if (grade === 'A' || grade === 'B' || grade === 'C' || grade === 'D') grades[grade]++

    // Market context
    const mc = ca.market_context as Record<string, unknown> | undefined
    const aw = mc?.awareness_level
    if (typeof aw === 'string') awareness[aw] = (awareness[aw] ?? 0) + 1
    const soph = mc?.sophistication_level
    if (typeof soph === 'number' || typeof soph === 'string') {
      const key = String(soph)
      sophistication[key] = (sophistication[key] ?? 0) + 1
    }

    // Attention / cognitive load / congruence medians
    const ha = ca.hook_analysis as Record<string, unknown> | undefined
    const ascore = ha?.attention_score
    if (typeof ascore === 'number') attentionScores.push(ascore)
    const cl = ca.cognitive_load as Record<string, unknown> | undefined
    if (typeof cl?.score === 'number') cogLoadScores.push(cl.score)
    const cg = ca.congruence as Record<string, unknown> | undefined
    if (typeof cg?.overall_score === 'number') congruenceScores.push(cg.overall_score)

    // Fit dimension scores
    for (const dim of Object.keys(fitDimensions)) {
      const block = ca[dim] as Record<string, unknown> | undefined
      if (typeof block?.score === 'number') fitDimensions[dim].push(block.score)
    }

    // Visual inventory
    const vi = ca.visual_inventory as Record<string, unknown> | undefined
    if (vi) {
      viSampleCount++
      const faces = vi.faces as { count?: number } | null
      if (faces && typeof faces.count === 'number' && faces.count > 0) facePresent++
      if (typeof vi.product_visibility === 'string') {
        productVisibility[vi.product_visibility] = (productVisibility[vi.product_visibility] ?? 0) + 1
      }
      if (typeof vi.setting === 'string') settings.set(vi.setting, (settings.get(vi.setting) ?? 0) + 1)
      if (Array.isArray(vi.props)) for (const p of vi.props) if (typeof p === 'string') props.set(p, (props.get(p) ?? 0) + 1)
      const palette = vi.color_palette as Record<string, unknown> | undefined
      if (typeof palette?.warmth === 'string') warmth[palette.warmth] = (warmth[palette.warmth] ?? 0) + 1
      if (typeof palette?.contrast_level === 'string') contrastLevel[palette.contrast_level] = (contrastLevel[palette.contrast_level] ?? 0) + 1
    }

    // Voice consistency
    const vc = ca.voice_consistency as Record<string, unknown> | undefined
    if (vc && typeof vc.overall_score === 'number') voiceConsistencyScores.push(vc.overall_score)

    // Curiosity gap
    const cgapBlock = ca.curiosity_gap as Record<string, unknown> | undefined
    if (cgapBlock && typeof cgapBlock.gap_strength === 'number') {
      cgSampleCount++
      gapStrengths.push(cgapBlock.gap_strength)
      if (cgapBlock.body_resolves) gapBodyResolves++
    }

    // Writing quality aggregates (deterministic per-element scores)
    const wq = ca.writing_quality as Record<string, unknown> | undefined
    if (wq) {
      const wqHd = wq.headline as Record<string, unknown> | null | undefined
      if (wqHd) {
        wqSampleCount++
        if (typeof wqHd.flesch_kincaid_grade === 'number') wqHeadlineGrades.push(wqHd.flesch_kincaid_grade)
        if (typeof wqHd.avg_sentence_length === 'number') wqAvgSentenceLengths.push(wqHd.avg_sentence_length)
        if (typeof wqHd.active_voice_ratio === 'number') wqActiveVoiceRatios.push(wqHd.active_voice_ratio)
        if (typeof wqHd.adverb_density === 'number') wqAdverbDensities.push(wqHd.adverb_density)
        if (typeof wqHd.weasel_word_count === 'number' && typeof wqHd.word_count === 'number' && wqHd.word_count > 0) {
          wqWeaselDensities.push((wqHd.weasel_word_count / wqHd.word_count) * 100)
        }
      }
      const wqBody = wq.body as Record<string, unknown> | null | undefined
      if (wqBody && typeof wqBody.flesch_kincaid_grade === 'number') wqBodyGrades.push(wqBody.flesch_kincaid_grade)
    }
  }

  const n = rows.length

  function median(arr: number[]): number | null {
    if (arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a - b)
    const m = sorted[Math.floor(sorted.length / 2)]
    return Math.round(m * 100) / 100
  }

  return {
    source_label: '',
    headline_words: range(headlineWords),
    headline_chars: range(headlineChars),
    subheadline_presence_rate: rate(subheadlinePresent, n),
    subheadline_chars: range(subheadlineChars),
    body_presence_rate: rate(bodyPresent, n),
    body_words: range(bodyWords),
    cta_presence_rate: rate(ctaPresent, n),
    cta_words: range(ctaWords),
    benefits_presence_rate: rate(benefitsPresent, n),
    benefits_count: range(benefitsCounts),
    trust_presence_rate: rate(trustPresent, n),
    trust_count: range(trustCounts),
    element_counts: range(elementCounts),
    compositions: Object.fromEntries(compositions),
    formats: Object.fromEntries(formats),
    headline_style: {
      voice: modeCount(hVoice),
      person: modeCount(hPerson),
      tense: modeCount(hTense),
      sentence_type: modeCount(hSentenceType),
      structure_type: modeCount(hStructureType),
      specificity_level: modeCount(hSpecificity),
      emotional_register: modeCount(hEmotionalRegister),
      tone_register: modeCount(hToneRegister),
      mechanism_present_rate:   rate(hMechanism, headlineWords.length),
      audience_explicit_rate:   rate(hAudExplicit, headlineWords.length),
      outcome_explicit_rate:    rate(hOutcomeExplicit, headlineWords.length),
      time_bound_rate:          rate(hTimeBound, headlineWords.length),
      uses_metaphor_rate:       rate(hMetaphor, headlineWords.length),
      uses_negation_rate:       rate(hNegation, headlineWords.length),
      uses_contrast_rate:       rate(hContrast, headlineWords.length),
      punctuation_signals: modeCount(hPunctuation),
    },
    cta_style: {
      verbs:        modeCount(cVerb),
      framing:      modeCount(cFraming),
      friction_level: modeCount(cFriction),
      has_value_anchor_rate:   rate(cValueAnchor, ctaPresent),
      has_urgency_signal_rate: rate(cUrgency, ctaPresent),
    },
    body_style: {
      frame:           modeCount(bFrame),
      pronoun_density: modeCount(bPronoun),
    },
    headline_exemplars:    headlineCandidates.sort((a, b) => b.spend - a.spend).slice(0, 10).map(c => c.text),
    subheadline_exemplars: subheadlineCandidates.sort((a, b) => b.spend - a.spend).slice(0, 6).map(c => c.text),
    cta_exemplars:         dedupe(ctaCandidates.sort((a, b) => b.spend - a.spend).map(c => c.text)).slice(0, 8),
    body_exemplars:        bodyCandidates.sort((a, b) => b.spend - a.spend).slice(0, 4).map(c => c.text),
    sample_size: n,
    behavioral_economics_rates: Object.fromEntries(
      Object.entries(beCounts).map(([k, v]) => [k, rate(v, n)]),
    ),
    framework_grades: grades,
    awareness_levels: awareness,
    sophistication_levels: sophistication,
    attention_score_median: median(attentionScores),
    cognitive_load_median: median(cogLoadScores),
    congruence_median: median(congruenceScores),
    fit_dimension_medians: Object.fromEntries(
      Object.entries(fitDimensions).map(([k, v]) => [k, median(v)]),
    ),
    visual_inventory: viSampleCount > 0 ? {
      face_presence_rate: rate(facePresent, viSampleCount),
      product_visibility_distribution: productVisibility,
      top_settings: [...settings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      top_props: [...props.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      warmth_distribution: warmth,
      contrast_level_distribution: contrastLevel,
      sample_count: viSampleCount,
    } : null,
    voice_consistency_median: median(voiceConsistencyScores),
    curiosity_gap: cgSampleCount > 0 ? {
      gap_strength_median: median(gapStrengths) ?? 0,
      body_resolves_rate: rate(gapBodyResolves, cgSampleCount),
      sample_count: cgSampleCount,
    } : null,
    writing_quality: wqSampleCount > 0 ? {
      headline_grade_median: median(wqHeadlineGrades),
      body_grade_median: median(wqBodyGrades),
      avg_sentence_length_median: median(wqAvgSentenceLengths),
      active_voice_ratio_median: median(wqActiveVoiceRatios),
      adverb_density_median: median(wqAdverbDensities),
      weasel_word_density_median: median(wqWeaselDensities),
      sample_count: wqSampleCount,
    } : null,
  }
}

// Splits sampled ads into quadrant buckets, computes per-quadrant aggregates,
// derives contrastive findings between winners and losers, aggregates loss
// reasons + critical-weakness themes from losers, and computes audience-match
// alignment correlation across quadrants. This is the structured input the
// action-plan prompt consumes.
interface QuadrantAdRow {
  id: string
  comprehensive_analysis: Record<string, unknown>
  spend_usd: number | null
  quadrant: Quadrant | null
  quadrant_override: Quadrant | null
  loss_reason: string | null
}

function computeCohortAnalytics(rows: QuadrantAdRow[]): CohortAnalytics {
  const buckets: Record<Quadrant, QuadrantAdRow[]> = { winner: [], promising: [], investigate: [], loser: [] }
  for (const r of rows) {
    const q = (r.quadrant_override ?? r.quadrant) as Quadrant | null
    if (q && q in buckets) buckets[q].push(r)
  }

  const by_quadrant: Record<Quadrant, CohortConstraints> = {
    winner:      computeCohortConstraints(buckets.winner),
    promising:   computeCohortConstraints(buckets.promising),
    investigate: computeCohortConstraints(buckets.investigate),
    loser:       computeCohortConstraints(buckets.loser),
  }

  const contrasts = computeContrasts(by_quadrant.winner, by_quadrant.loser, by_quadrant.investigate)
  const loss_diagnostics = computeLossDiagnostics([...buckets.loser, ...buckets.investigate])
  const audience_match_correlation = computeAudienceMatchCorrelation(rows, buckets)

  return { by_quadrant, contrasts, loss_diagnostics, audience_match_correlation }
}

// Contrastive findings — programmatically computed deltas between quadrants.
// Surfaces attributes that appear ONLY in winners (replicate signal) or ONLY
// in losers (avoid signal), plus large presence-rate gaps and the specific
// attributes that distinguish investigates from winners (the bleeders to fix).
function computeContrasts(winners: CohortConstraints, losers: CohortConstraints, investigates: CohortConstraints): CohortAnalytics['contrasts'] {
  const winner_exclusive_attributes: string[] = []
  const loser_exclusive_attributes: string[] = []
  const presence_rate_gaps: string[] = []
  const winner_vs_investigate_deltas: string[] = []

  // Helper: compare two style distributions and find values seen exclusively in one.
  function styleExclusivity(label: string, a: Array<[string, number]>, b: Array<[string, number]>, intoA: string[], intoB: string[]) {
    const bKeys = new Set(b.map(([k]) => k))
    const aKeys = new Set(a.map(([k]) => k))
    for (const [k, n] of a) if (n > 0 && !bKeys.has(k)) intoA.push(`${label}=${k} (${n}× in this quadrant, 0 in the other)`)
    for (const [k, n] of b) if (n > 0 && !aKeys.has(k)) intoB.push(`${label}=${k} (${n}× in this quadrant, 0 in the other)`)
  }

  styleExclusivity('headline.structure_type', winners.headline_style.structure_type, losers.headline_style.structure_type, winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('headline.tense', winners.headline_style.tense, losers.headline_style.tense, winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('headline.person', winners.headline_style.person, losers.headline_style.person, winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('headline.sentence_type', winners.headline_style.sentence_type, losers.headline_style.sentence_type, winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('emotional_register', winners.headline_style.emotional_register, losers.headline_style.emotional_register, winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('punctuation', winners.headline_style.punctuation_signals, losers.headline_style.punctuation_signals, winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('composition_tag', Object.entries(winners.compositions), Object.entries(losers.compositions), winner_exclusive_attributes, loser_exclusive_attributes)
  styleExclusivity('ad_format', Object.entries(winners.formats), Object.entries(losers.formats), winner_exclusive_attributes, loser_exclusive_attributes)

  // Presence-rate gaps ≥ 30pp between winners and losers
  function rateGap(label: string, w: number, l: number) {
    const pp = Math.round((w - l) * 100)
    if (Math.abs(pp) >= 30) {
      const sign = pp > 0 ? '+' : ''
      presence_rate_gaps.push(`${label}: winners ${Math.round(w * 100)}% vs losers ${Math.round(l * 100)}% (${sign}${pp}pp)`)
    }
  }
  rateGap('subheadline_present',  winners.subheadline_presence_rate, losers.subheadline_presence_rate)
  rateGap('body_present',         winners.body_presence_rate,        losers.body_presence_rate)
  rateGap('cta_present',          winners.cta_presence_rate,         losers.cta_presence_rate)
  rateGap('benefits_present',     winners.benefits_presence_rate,    losers.benefits_presence_rate)
  rateGap('trust_present',        winners.trust_presence_rate,       losers.trust_presence_rate)
  rateGap('mechanism_in_headline', winners.headline_style.mechanism_present_rate, losers.headline_style.mechanism_present_rate)
  rateGap('audience_explicit_in_headline', winners.headline_style.audience_explicit_rate, losers.headline_style.audience_explicit_rate)
  rateGap('outcome_explicit_in_headline', winners.headline_style.outcome_explicit_rate, losers.headline_style.outcome_explicit_rate)
  rateGap('time_bound_in_headline', winners.headline_style.time_bound_rate, losers.headline_style.time_bound_rate)
  for (const signal of Object.keys(winners.behavioral_economics_rates)) {
    rateGap(`be_${signal}`, winners.behavioral_economics_rates[signal] ?? 0, losers.behavioral_economics_rates[signal] ?? 0)
  }

  // Winner-vs-investigate deltas — what investigates DIFFER from winners on (the bleeders).
  // Investigates earn distribution but lose at conversion, so attributes investigates SHARE
  // with winners are valid hooks; attributes that DIFFER are the conversion bleeders.
  function diffSignal(label: string, w: number | null, i: number | null, threshold = 1.5) {
    if (w == null || i == null) return
    if (Math.abs(w - i) >= threshold) {
      winner_vs_investigate_deltas.push(`${label}: winners ${w.toFixed(1)} vs investigates ${i.toFixed(1)} (${(w - i).toFixed(1)})`)
    }
  }
  diffSignal('attention_score_median', winners.attention_score_median, investigates.attention_score_median)
  diffSignal('congruence_median',      winners.congruence_median,      investigates.congruence_median)
  diffSignal('cognitive_load_median',  winners.cognitive_load_median,  investigates.cognitive_load_median)
  for (const k of Object.keys(winners.fit_dimension_medians)) {
    diffSignal(`fit.${k}`, winners.fit_dimension_medians[k], investigates.fit_dimension_medians[k] ?? null)
  }

  return {
    winner_exclusive_attributes: winner_exclusive_attributes.slice(0, 12),
    loser_exclusive_attributes:  loser_exclusive_attributes.slice(0, 12),
    presence_rate_gaps:          presence_rate_gaps.slice(0, 12),
    winner_vs_investigate_deltas: winner_vs_investigate_deltas.slice(0, 10),
  }
}

function computeLossDiagnostics(failureRows: QuadrantAdRow[]): CohortAnalytics['loss_diagnostics'] {
  const lossReasons = new Map<string, number>()
  const failureModes = new Map<string, number>()
  const priorityFixes: string[] = []
  const criticalWeaknesses: string[] = []

  for (const r of failureRows) {
    if (r.loss_reason) lossReasons.set(r.loss_reason, (lossReasons.get(r.loss_reason) ?? 0) + 1)
    const ca = r.comprehensive_analysis as Record<string, unknown>
    const ffm = ca.format_failure_mode as Record<string, unknown> | undefined
    if (typeof ffm?.mode === 'string' && ffm.mode !== 'none') {
      failureModes.set(ffm.mode, (failureModes.get(ffm.mode) ?? 0) + 1)
    }
    const overall = ca.overall as Record<string, unknown> | undefined
    if (typeof overall?.priority_fix === 'string' && overall.priority_fix.trim()) {
      priorityFixes.push(overall.priority_fix.trim())
    }
    if (typeof overall?.critical_weakness === 'string' && overall.critical_weakness.trim()) {
      criticalWeaknesses.push(overall.critical_weakness.trim())
    }
  }

  return {
    loss_reason_distribution: [...lossReasons.entries()].sort((a, b) => b[1] - a[1]),
    recurring_priority_fixes:     priorityFixes.slice(0, 6),
    recurring_critical_weaknesses: criticalWeaknesses.slice(0, 6),
    format_failure_mode_distribution: [...failureModes.entries()].sort((a, b) => b[1] - a[1]),
  }
}

function computeAudienceMatchCorrelation(allRows: QuadrantAdRow[], buckets: Record<Quadrant, QuadrantAdRow[]>): CohortAnalytics['audience_match_correlation'] {
  function alignedRate(qRows: QuadrantAdRow[]): number {
    let total = 0, aligned = 0
    for (const r of qRows) {
      const am = (r.comprehensive_analysis as Record<string, unknown>).audience_match as { has_user_input?: boolean; match_quality?: string } | undefined
      if (!am || !am.has_user_input) continue
      total++
      if (am.match_quality === 'aligned') aligned++
    }
    return total > 0 ? aligned / total : 0
  }
  const mismatchExamples: CohortAnalytics['audience_match_correlation']['mismatch_examples'] = []
  for (const r of allRows) {
    const am = (r.comprehensive_analysis as Record<string, unknown>).audience_match as { match_quality?: string; mismatches?: string[] } | undefined
    if (am?.match_quality === 'major_mismatch' && Array.isArray(am.mismatches) && am.mismatches.length > 0) {
      const q = (r.quadrant_override ?? r.quadrant) as Quadrant | null
      if (q) mismatchExamples.push({ ad_id: r.id, quadrant: q, mismatches: am.mismatches.slice(0, 3) })
    }
    if (mismatchExamples.length >= 5) break
  }
  return {
    aligned_rate_by_quadrant: {
      winner:      alignedRate(buckets.winner),
      promising:   alignedRate(buckets.promising),
      investigate: alignedRate(buckets.investigate),
      loser:       alignedRate(buckets.loser),
    },
    mismatch_examples: mismatchExamples,
  }
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of arr) {
    const key = s.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(s) }
  }
  return out
}

function formatConstraints(c: CohortConstraints, sourceLabel: string): string {
  const lines: string[] = [`Source: ${sourceLabel}`, '']
  const pct = (r: number) => `${Math.round(r * 100)}%`
  const rs = (n: NumRange | null) => n ? `${n.min}–${n.max} (median ${n.p50})` : 'no data'
  const dist = (arr: Array<[string, number]>) => arr.length === 0 ? 'no data' : arr.slice(0, 5).map(([k, n]) => `${k}=${n}`).join(', ')

  lines.push('## Size & presence (HARD CONSTRAINTS)')
  lines.push(`Headlines: ${rs(c.headline_words)} words, ${rs(c.headline_chars)} chars`)
  if (c.subheadline_presence_rate > 0) {
    lines.push(`Subheadlines: present in ${pct(c.subheadline_presence_rate)} of source ads. When present: ${rs(c.subheadline_chars)} chars. Specs MUST NOT exceed this char range.`)
  } else {
    lines.push(`Subheadlines: NEVER used by source ads. Most specs should set subheadline_role to "absent".`)
  }
  if (c.body_presence_rate > 0) {
    lines.push(`Body copy: present in ${pct(c.body_presence_rate)} of source ads. When present: ${rs(c.body_words)} words. Specs MUST stay in this word range.`)
  } else {
    lines.push(`Body copy: NEVER used by source ads. Most specs should set body_role to "absent".`)
  }
  if (c.cta_presence_rate > 0) {
    lines.push(`CTA: present in ${pct(c.cta_presence_rate)} of source ads. When present: ${rs(c.cta_words)} words. If breakdown.cta_presence.verdict says CTA isn't the lever, at least one spec MUST omit the CTA (cta_framing="none", cta="").`)
  } else {
    lines.push(`CTA: NEVER used by source ads. Most specs should set cta_framing to "none" and cta to "".`)
  }
  if (c.benefits_presence_rate > 0) {
    lines.push(`Benefits/features list: present in ${pct(c.benefits_presence_rate)} of source ads, ${rs(c.benefits_count)} items when present.`)
  }
  if (c.trust_presence_rate > 0) {
    lines.push(`Trust signals: present in ${pct(c.trust_presence_rate)} of source ads, ${rs(c.trust_count)} items when present.`)
  }
  if (c.element_counts) {
    lines.push(`Element count per ad: ${rs(c.element_counts)}. Specs MUST span this range — do NOT pile every element on every spec.`)
  }
  const topComp = Object.entries(c.compositions).sort((a, b) => b[1] - a[1]).slice(0, 4)
  if (topComp.length > 0) lines.push(`Top compositions: ${topComp.map(([t, n]) => `${t}=${n}`).join(', ')}`)
  const topFmt = Object.entries(c.formats).sort((a, b) => b[1] - a[1]).slice(0, 4)
  if (topFmt.length > 0) lines.push(`Top formats: ${topFmt.map(([t, n]) => `${t}=${n}`).join(', ')}`)

  // Style constraints — voice, register, structure, conventions
  const hs = c.headline_style
  lines.push('')
  lines.push('## Headline STYLE (HARD CONSTRAINTS — match the dominant attributes; never use what winners never use)')
  lines.push(`  voice:             ${dist(hs.voice)}`)
  lines.push(`  person:            ${dist(hs.person)}`)
  lines.push(`  tense:             ${dist(hs.tense)}`)
  lines.push(`  sentence_type:     ${dist(hs.sentence_type)}`)
  lines.push(`  structure_type:    ${dist(hs.structure_type)}`)
  lines.push(`  specificity:       ${dist(hs.specificity_level)}`)
  lines.push(`  emotional_register: ${dist(hs.emotional_register)}`)
  lines.push(`  tone_register:     ${dist(hs.tone_register)}`)
  lines.push(`  flag presence in winners — mechanism: ${pct(hs.mechanism_present_rate)}, audience-explicit: ${pct(hs.audience_explicit_rate)}, outcome-explicit: ${pct(hs.outcome_explicit_rate)}, time-bound: ${pct(hs.time_bound_rate)}`)
  lines.push(`  conventions — metaphor: ${pct(hs.uses_metaphor_rate)}, negation: ${pct(hs.uses_negation_rate)}, contrast: ${pct(hs.uses_contrast_rate)}`)
  lines.push(`  punctuation winners use: ${hs.punctuation_signals.length === 0 ? 'NONE (clean prose, no marks beyond periods)' : dist(hs.punctuation_signals)}`)

  if (c.cta_presence_rate > 0) {
    const cs = c.cta_style
    lines.push('')
    lines.push('## CTA STYLE (when a spec includes a CTA)')
    lines.push(`  verbs winners use:  ${dist(cs.verbs)}`)
    lines.push(`  framing:            ${dist(cs.framing)}`)
    lines.push(`  friction_level:     ${dist(cs.friction_level)}`)
    lines.push(`  value_anchor in:    ${pct(cs.has_value_anchor_rate)}, urgency_signal in: ${pct(cs.has_urgency_signal_rate)}`)
  }

  if (c.body_presence_rate > 0) {
    const bs = c.body_style
    lines.push('')
    lines.push('## BODY STYLE (when a spec includes body copy)')
    lines.push(`  frame:              ${dist(bs.frame)}`)
    lines.push(`  pronoun_density:    ${dist(bs.pronoun_density)}`)
  }

  // Verbatim exemplars
  if (c.headline_exemplars.length > 0) {
    lines.push('')
    lines.push('## Winning HEADLINES (verbatim — match this voice, vocabulary, cadence, syntax)')
    for (const h of c.headline_exemplars) lines.push(`  · ${h}`)
  }
  if (c.subheadline_exemplars.length > 0) {
    lines.push('')
    lines.push('## Winning SUBHEADLINES (verbatim)')
    for (const s of c.subheadline_exemplars) lines.push(`  · ${s}`)
  }
  if (c.cta_exemplars.length > 0) {
    lines.push('')
    lines.push('## Winning CTAs (verbatim)')
    for (const c2 of c.cta_exemplars) lines.push(`  · ${c2}`)
  }
  if (c.body_exemplars.length > 0) {
    lines.push('')
    lines.push('## Winning BODY copy (verbatim — match register and cadence)')
    for (const b of c.body_exemplars) lines.push(`  · ${b}`)
  }

  return lines.join('\n')
}

// Renders the full CohortAnalytics block — per-quadrant aggregates side-by-side,
// contrastive findings, loss diagnostics, audience-match correlation. This is
// the prompt scaffold that replaces the winner-only EMPIRICAL CONSTRAINTS block.
function formatCohortAnalytics(a: CohortAnalytics): string {
  const lines: string[] = []
  const pct = (r: number) => `${Math.round(r * 100)}%`
  const dist = (arr: Array<[string, number]>) => arr.length === 0 ? '—' : arr.slice(0, 5).map(([k, n]) => `${k}=${n}`).join(', ')

  // Concise per-quadrant summary line — full constraints rendered below for winners.
  function quadrantSnapshot(label: string, c: CohortConstraints): string {
    if (c.sample_size === 0) return `  ${label} (n=0): no ads in this quadrant`
    const parts: string[] = [`  ${label} (n=${c.sample_size}):`]
    if (c.headline_words) parts.push(`HL=${c.headline_words.min}-${c.headline_words.max}w`)
    parts.push(`sub=${pct(c.subheadline_presence_rate)}`, `body=${pct(c.body_presence_rate)}`, `cta=${pct(c.cta_presence_rate)}`)
    if (c.element_counts) parts.push(`elements=${c.element_counts.min}-${c.element_counts.max} (med ${c.element_counts.p50})`)
    if (c.attention_score_median != null) parts.push(`attention=${c.attention_score_median}`)
    if (c.cognitive_load_median != null) parts.push(`cogload=${c.cognitive_load_median}`)
    if (c.congruence_median != null) parts.push(`congruence=${c.congruence_median}`)
    const topGrade = (Object.entries(c.framework_grades) as Array<[string, number]>).sort((a2, b2) => b2[1] - a2[1])[0]
    if (topGrade && topGrade[1] > 0) parts.push(`grade_mode=${topGrade[0]}`)
    return parts.join(' | ')
  }

  lines.push('## PER-QUADRANT SNAPSHOT')
  lines.push(quadrantSnapshot('WINNERS',      a.by_quadrant.winner))
  lines.push(quadrantSnapshot('PROMISING',    a.by_quadrant.promising))
  lines.push(quadrantSnapshot('INVESTIGATE',  a.by_quadrant.investigate))
  lines.push(quadrantSnapshot('LOSERS',       a.by_quadrant.loser))

  lines.push('')
  lines.push('## CONTRASTIVE FINDINGS (programmatically computed from per-quadrant deltas)')
  if (a.contrasts.winner_exclusive_attributes.length > 0) {
    lines.push('  Winner-exclusive attributes (REPLICATE):')
    for (const f of a.contrasts.winner_exclusive_attributes) lines.push(`    · ${f}`)
  }
  if (a.contrasts.loser_exclusive_attributes.length > 0) {
    lines.push('  Loser-exclusive attributes (AVOID):')
    for (const f of a.contrasts.loser_exclusive_attributes) lines.push(`    · ${f}`)
  }
  if (a.contrasts.presence_rate_gaps.length > 0) {
    lines.push('  Presence-rate gaps ≥30pp (strongest signals):')
    for (const f of a.contrasts.presence_rate_gaps) lines.push(`    · ${f}`)
  }
  if (a.contrasts.winner_vs_investigate_deltas.length > 0) {
    lines.push('  Winner-vs-investigate deltas (the bleeders investigates suffer from):')
    for (const f of a.contrasts.winner_vs_investigate_deltas) lines.push(`    · ${f}`)
  }

  lines.push('')
  lines.push('## LOSS DIAGNOSTICS (from losers + investigates)')
  if (a.loss_diagnostics.loss_reason_distribution.length > 0) {
    lines.push(`  loss_reason distribution: ${a.loss_diagnostics.loss_reason_distribution.map(([k, n]) => `${k}=${n}`).join(', ')}`)
  } else {
    lines.push('  loss_reason distribution: not classified for these failures')
  }
  if (a.loss_diagnostics.format_failure_mode_distribution.length > 0) {
    lines.push(`  format_failure_mode: ${a.loss_diagnostics.format_failure_mode_distribution.map(([k, n]) => `${k}=${n}`).join(', ')}`)
  }
  if (a.loss_diagnostics.recurring_priority_fixes.length > 0) {
    lines.push('  Recurring priority_fix themes (from losers):')
    for (const f of a.loss_diagnostics.recurring_priority_fixes) lines.push(`    · ${f}`)
  }
  if (a.loss_diagnostics.recurring_critical_weaknesses.length > 0) {
    lines.push('  Recurring critical_weakness themes:')
    for (const f of a.loss_diagnostics.recurring_critical_weaknesses) lines.push(`    · ${f}`)
  }

  lines.push('')
  lines.push('## AUDIENCE-MATCH CORRELATION')
  const am = a.audience_match_correlation.aligned_rate_by_quadrant
  lines.push(`  aligned-rate by quadrant: winner=${pct(am.winner)}, promising=${pct(am.promising)}, investigate=${pct(am.investigate)}, loser=${pct(am.loser)}`)
  if (am.winner > am.loser + 0.3) {
    lines.push('  → large alignment gap: audience clarity is a winning lever. Specs MUST nail TAM/persona/micro.')
  }
  if (a.audience_match_correlation.mismatch_examples.length > 0) {
    lines.push('  Major-mismatch examples:')
    for (const ex of a.audience_match_correlation.mismatch_examples) {
      lines.push(`    · ${ex.ad_id.slice(0, 8)} (${ex.quadrant}): ${ex.mismatches.join('; ')}`)
    }
  }

  // Visual inventory (only renders when ≥1 ad in the cohort has the field populated)
  const wv = a.by_quadrant.winner.visual_inventory
  const lv = a.by_quadrant.loser.visual_inventory
  if (wv || lv) {
    lines.push('')
    lines.push('## VISUAL INVENTORY (from ads with visual_inventory populated)')
    if (wv) lines.push(`  Winners (n=${wv.sample_count}): face_presence=${pct(wv.face_presence_rate)}, top_settings=${dist(wv.top_settings)}, warmth=${Object.entries(wv.warmth_distribution).map(([k, n]) => `${k}=${n}`).join(', ')}`)
    if (lv) lines.push(`  Losers  (n=${lv.sample_count}): face_presence=${pct(lv.face_presence_rate)}, top_settings=${dist(lv.top_settings)}, warmth=${Object.entries(lv.warmth_distribution).map(([k, n]) => `${k}=${n}`).join(', ')}`)
    if (wv && wv.top_props.length > 0) lines.push(`  Top props in winners: ${dist(wv.top_props)}`)
  }

  // Voice consistency
  const wVc = a.by_quadrant.winner.voice_consistency_median
  const lVc = a.by_quadrant.loser.voice_consistency_median
  if (wVc != null || lVc != null) {
    lines.push('')
    lines.push('## VOICE CONSISTENCY')
    if (wVc != null) lines.push(`  Winners voice_consistency median: ${wVc}/10`)
    if (lVc != null) lines.push(`  Losers  voice_consistency median: ${lVc}/10`)
    if (wVc != null && lVc != null && wVc - lVc >= 1.5) {
      lines.push('  → winners maintain voice across elements; losers drift. Specs MUST keep headline / subheadline / body / CTA in one consistent voice.')
    }
  }

  // Curiosity gap
  const wCg = a.by_quadrant.winner.curiosity_gap
  const lCg = a.by_quadrant.loser.curiosity_gap
  if (wCg || lCg) {
    lines.push('')
    lines.push('## CURIOSITY GAP')
    if (wCg) lines.push(`  Winners (n=${wCg.sample_count}): gap_strength=${wCg.gap_strength_median}/10, body_resolves=${pct(wCg.body_resolves_rate)}`)
    if (lCg) lines.push(`  Losers  (n=${lCg.sample_count}): gap_strength=${lCg.gap_strength_median}/10, body_resolves=${pct(lCg.body_resolves_rate)}`)
  }

  // Writing quality
  const wWq = a.by_quadrant.winner.writing_quality
  const lWq = a.by_quadrant.loser.writing_quality
  if (wWq || lWq) {
    lines.push('')
    lines.push('## WRITING QUALITY (deterministic per-element scores; HARD CONSTRAINTS)')
    if (wWq) lines.push(`  Winners (n=${wWq.sample_count}): headline_grade=${wWq.headline_grade_median}, body_grade=${wWq.body_grade_median ?? '—'}, avg_sentence=${wWq.avg_sentence_length_median}w, active_voice=${wWq.active_voice_ratio_median ?? '—'}, adverb_density=${wWq.adverb_density_median}/100w, weasel_density=${wWq.weasel_word_density_median?.toFixed(1) ?? '—'}/100w`)
    if (lWq) lines.push(`  Losers  (n=${lWq.sample_count}): headline_grade=${lWq.headline_grade_median}, body_grade=${lWq.body_grade_median ?? '—'}, avg_sentence=${lWq.avg_sentence_length_median}w, active_voice=${lWq.active_voice_ratio_median ?? '—'}, adverb_density=${lWq.adverb_density_median}/100w, weasel_density=${lWq.weasel_word_density_median?.toFixed(1) ?? '—'}/100w`)
  }

  // Detailed winner constraints + verbatim exemplars (the existing format)
  lines.push('')
  lines.push('## WINNER DETAIL (size + style + verbatim copy — match this voice)')
  lines.push(formatConstraints(a.by_quadrant.winner, `${a.by_quadrant.winner.sample_size} winners`))

  return lines.join('\n')
}
