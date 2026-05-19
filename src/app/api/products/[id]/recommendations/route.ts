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
  // Spec intent. Constrains how strictly the spec must match cohort empirics:
  //   replicate — match the dominant winning attributes; safe variation.
  //   extend    — mostly match winners; vary one targeted dimension (a known
  //               winning pattern applied to an under-tested persona / segment).
  //   fix       — match winners EXCEPT on a flagged quality dimension where
  //               the cohort is weak; the spec intentionally diverges on that
  //               axis as a corrective test hypothesis.
  //   novelty   — explore a combination not yet tested in the cohort (gap
  //               fill). May leave replicates_from empty; MUST cite the gap
  //               in contrastive_findings_used.
  spec_mode: 'replicate' | 'extend' | 'fix' | 'novelty'
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

    // No input cap — every analyzed ad gets fed to the model. The original
    // 30-ad cap was a workaround for Sonnet choking on large JSON tool calls
    // when per_ad_recommendations was still in the schema. Since we switched
    // to Opus 4.7 and dropped per_ad_recommendations, response size is
    // bounded by the breakdown + 3-5 specs (~5-10k output tokens) regardless
    // of input count. Input tokens are cheap relative to losing signal.
    // Order by spend desc within quadrant so the highest-validated ads
    // appear first in the prompt — small attention bias toward what worked.
    const winners      = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'winner').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const investigates = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'investigate').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const promising   = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'promising').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const losers      = rows.filter(r => (r.quadrant_override ?? r.quadrant) === 'loser').sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0))
    const unclassified = rows.filter(r => {
      const q = r.quadrant_override ?? r.quadrant
      return q !== 'winner' && q !== 'investigate' && q !== 'promising' && q !== 'loser'
    })
    const sampled = [...winners, ...investigates, ...promising, ...losers, ...unclassified]
    const sampleNote = ''

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

    // Cross-cohort pool: every winner this user owns OUTSIDE the current
    // product, across all verticals and historical-mode uploads. Feeds the
    // novelty mode with combinations validated elsewhere in the user's
    // account but not yet tested for this product. Voice/style is NEVER
    // pulled from this pool — only the COMBINATION (audience × angle ×
    // format × awareness × BE signal).
    const { data: crossRows } = await supabaseServer
      .from('analyses')
      .select('id, comprehensive_analysis, spend_usd, cpa_usd, ctr_pct, quadrant, quadrant_override, product_id')
      .eq('user_id', user.id)
      .neq('product_id', productId)
      .not('comprehensive_analysis', 'is', null)
      .or('quadrant.eq.winner,quadrant_override.eq.winner,is_winner.eq.true,spend_usd.gte.1000')
      .order('spend_usd', { ascending: false, nullsFirst: false })
      .limit(80)
    const crossPool = computeCrossCohortPool((crossRows ?? []) as CrossCohortRow[], analyticsRows)

    const cohortAnalytics = computeCohortAnalytics(analyticsRows, crossPool)
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

next_test_batch.specs — 3-5 FINISHED CREATIVE BRIEFS that are DERIVATIONS from the breakdown findings AND the empirical constraints above.

SPEC MODES (REQUIRED — every spec carries one):
  - replicate: matches winners on every dimension (the safest test).
  - extend: matches winners on every dimension EXCEPT one, applying a proven winning pattern to a new audience / persona / micro-segment / awareness level that's under-represented in the cohort.
  - fix: matches winners EXCEPT on a dimension flagged in the QUALITY GAPS section. The spec INTENTIONALLY diverges on that dimension as a corrective test hypothesis. Required when QUALITY GAPS exist: at least one fix spec per flagged gap (or one fix spec covering the highest-leverage gap if multiple are flagged).
  - novelty: explores a combination NOT yet tested in the cohort — a persona × angle × format combination winners have never paired, an awareness level the cohort doesn't target, a behavioral_economics signal never deployed. The novelty spec's data_basis.replicates_from MAY be empty, but data_basis.contrastive_findings_used MUST cite the gap explicitly (e.g. "no winner targets the unaware awareness level despite 4 losers attempting it without trust signals — testing trust-signal-led unaware framing"). MAY match cohort voice / writing style if appropriate.

A 3-5 spec batch MUST include:
  - At least 1 'replicate' spec (anchors the test on what's proven).
  - At least 1 of {'fix', 'novelty'} (guarantees the batch isn't all-replicate). If QUALITY GAPS exist, the batch MUST include at least 1 'fix' spec per gap (or covering the worst gap when many exist).
  - The remaining specs may be replicate / extend / fix / novelty as judgment dictates.

Every spec decision must trace back. Rules apply CONDITIONALLY on spec_mode:

  - If cta_presence.verdict says CTA isn't the lever, at least one spec MUST have no CTA. Use empty string for cta and set cta_framing to "none". The body or headline should carry the persuasion.
  - Element load (headline + subheadline + body + cta + benefits + trust_signals) MUST vary across specs to span the cohort's measured element-count range. If winners cluster at low element counts (2-3 populated elements), most specs should be lean. If winners use full element loads, more specs can be loaded. NEVER pile every element on every spec — that's the element-overload trap your breakdown is meant to call out.

  For spec_mode = 'replicate' OR 'extend':
  - Headline word count MUST fall in the empirical headline range. CTA word count (when present) MUST fall in the empirical CTA range. Subheadline length (when present) MUST fall in the empirical subheadline range. Body length MUST fall in the body range.
  - Headline STYLE must match the dominant attributes in the empirical block: same voice/person/tense, dominant structure_type, dominant sentence_type, dominant register, dominant specificity_level. If winners NEVER use exclamation points (or any specific punctuation), your specs MUST NOT use them either.
  - CTA STYLE (when included) must use one of the verbs winners use, the dominant framing, the dominant friction_level.
  - Body STYLE (when included) must match the dominant frame and pronoun_density.
  - READ the verbatim exemplars in the empirical block. Your written copy MUST read like it belongs in that list. Stay in the voice.
  - Composition_tag and ad_format SHOULD lean toward the top winning compositions/formats unless extending into a deliberately new format combination (which must be justified in why_this_test).
  - For 'extend' specifically: keep all the above replicate rules EXCEPT for the one dimension you're extending (e.g. extending to a new persona keeps copy style identical, just retargets).

  For spec_mode = 'fix':
  - Match all dimensions EXCEPT the flagged QUALITY GAP dimension. On the flagged dimension, INTENTIONALLY diverge in the direction the QUALITY GAPS prescription names.
  - Example: if QUALITY GAPS flagged "writing_quality.headline_grade: winners' median = 11, test simpler", the fix spec writes a headline at grade 6-8 with the SAME angle, persona, awareness level, and concept as the cohort winners — but simpler prose. Everything else stays in the cohort voice.
  - Voice still anchored to cohort exemplars unless the fix dimension IS the voice (rare).
  - why_this_test MUST name the dimension being intentionally diverged on and the hypothesis (e.g. "Hypothesis: winners win DESPITE grade-11 prose, not because of it; testing grade-7 variant").

  For spec_mode = 'novelty':
  - Voice / writing style should still align with the brand's observed voice from WINNER DETAIL (Hemingway grade, sentence length, active voice ratio, weasel density, punctuation conventions). The novelty is in the COMBINATION (audience × angle × format × awareness × BE signal), not in inventing a foreign voice.
  - Identify a specific gap. Two valid gap sources:
    (a) Within-product: from the COHORT ANALYTICS — an awareness level winners don't target, a format×angle pair never tried, a persona × micro-persona never tested.
    (b) Cross-cohort: from the CROSS-COHORT NOVELTY POOL when present — combinations validated across the user's OTHER products / historical uploads that haven't been tested for THIS product. The gaps subsection of that pool names them explicitly (angles_not_in_current, awareness_not_in_current, format_compositions_not_in_current, be_stacks_not_in_current, personas_not_in_current). Drawing on cross-cohort signals is encouraged when the within-product gap is thin.
  - Do NOT match the voice of the cross-cohort headlines. Those headlines exist only to show what COMBINATIONS work in other products — your spec's voice stays anchored to THIS product's WINNER DETAIL exemplars.
  - contrastive_findings_used MUST cite the specific gap (within-product or cross-cohort) the novelty spec is filling.
  - data_basis.replicates_from MAY be empty for novelty specs (no direct in-product winner pattern to replicate).
  - why_this_test MUST be explicit. When drawing on cross-cohort, name the cross-cohort pattern (e.g. "Cross-cohort: N winners in other products use mechanism-reveal headlines for problem-aware moms; this product has 0 — testing adaptation in this product's voice"). When drawing on within-product gap only: "Novel combination test — <combination> not tried in cohort. Hypothesis: <why this might work>."

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
    // max_tokens=32000: with 3-5 detailed specs (full copy + data_basis) plus
    // 10 breakdown sections the output routinely needs 15-25k tokens. 16k was
    // too tight — the model would exhaust its budget mid-generation and submit
    // an empty or skeleton tool call, triggering the "no summary_actions" error.
    const callModel = () => anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 32000,
      tools: [{
        name: 'submit_action_plan',
        description: 'Submit the structured product action plan.',
        input_schema: ACTION_PLAN_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'submit_action_plan' },
      messages: [{ role: 'user', content: prompt }],
    })

    // Auto-retry once: if the first attempt produces an empty/skeleton
    // tool call the model retries with the same prompt. This handles the
    // rare case where the model submits a well-formed but blank tool call
    // (distinct from max_tokens truncation, which is caught separately).
    let message = await callModel()
    let retried = false

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        message = await callModel()
        retried = true
      }

      if (message.stop_reason === 'max_tokens') {
        await deleteCachedReport(productId)
        return { error: 'Response truncated at the model token ceiling. Click Regenerate to try again.' }
      }

      const toolUse = message.content.find(b => b.type === 'tool_use')
      if (!toolUse || toolUse.type !== 'tool_use') {
        // Fallback: model returned text instead of a tool call — try to parse JSON from it.
        if (attempt === 0) continue
        const textBlock = message.content.find(b => b.type === 'text')
        const raw = textBlock?.type === 'text' ? textBlock.text : ''
        try {
          const partial = parseClaudeJson<Omit<ProductRecommendationReport, 'generated_at' | 'ads_analyzed'>>(raw)
          const emptyReason = detectEmptyReport(partial, cohortAnalytics.quality_gaps)
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
      const emptyReason = detectEmptyReport(partial, cohortAnalytics.quality_gaps)
      if (emptyReason) {
        if (attempt === 0) continue  // retry once before surfacing the error
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
    }

    // Should not be reachable — the loop above always returns or continues.
    await deleteCachedReport(productId)
    return { error: 'Model did not produce a valid plan after retrying. Click Regenerate.' }
  })
}

async function deleteCachedReport(productId: string): Promise<void> {
  await supabaseServer.from('product_recommendations').delete().eq('product_id', productId)
}

// Returns a human-readable reason if the report is missing substantive content,
// or null if it has the minimum required substance to be saved.
function detectEmptyReport(p: Partial<ProductRecommendationReport>, qualityGaps: QualityGap[] = []): string | null {
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
  // Novelty specs are the exception for the ad-ID requirement (they explore
  // a gap, by definition having no prior ad to replicate) but they still
  // need contrastive_findings_used to cite the gap.
  const modeCount: Record<string, number> = { replicate: 0, extend: 0, fix: 0, novelty: 0 }
  const specs: TestSpec[] = p.next_test_batch.specs
  for (let i = 0; i < specs.length; i++) {
    const s: TestSpec = specs[i]
    const mode = s.spec_mode
    if (!mode || !['replicate', 'extend', 'fix', 'novelty'].includes(mode)) {
      return `spec #${i + 1} has missing or invalid spec_mode`
    }
    modeCount[mode]++
    const db = s.data_basis
    if (!db) return `spec #${i + 1} missing data_basis`
    const totalCitations =
      (db.replicates_from?.length ?? 0) +
      (db.avoids_pattern_of?.length ?? 0) +
      (db.addresses_investigate_weakness?.length ?? 0) +
      (db.extends_promising_signal?.length ?? 0)
    if (mode !== 'novelty' && totalCitations === 0) {
      return `spec #${i + 1} (${mode}) data_basis cites no ad IDs across any of the four roles`
    }
    if (!db.contrastive_findings_used?.length) return `spec #${i + 1} data_basis cites no contrastive findings`
  }

  // Batch composition rules — guarantees the batch isn't all-replicate AND
  // covers the corrective hypotheses flagged by QUALITY GAPS.
  if (specs.length >= 3) {
    if (modeCount.replicate === 0) {
      return 'no replicate-mode spec in the batch — at least 1 spec MUST anchor on what\'s proven'
    }
    if (modeCount.fix === 0 && modeCount.novelty === 0) {
      return 'batch is all-replicate/extend — at least 1 spec MUST be \'fix\' or \'novelty\' to surface corrective hypotheses or test new combinations'
    }
  }
  if (qualityGaps.length > 0 && modeCount.fix === 0) {
    return `QUALITY GAPS flagged (${qualityGaps.map(g => g.dimension).join(', ')}) but no spec is spec_mode='fix' to test corrections`
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
              'name', 'spec_mode', 'ad_format', 'composition',
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
              spec_mode: { type: 'string', enum: ['replicate', 'extend', 'fix', 'novelty'] },
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
interface QualityGap {
  dimension: string                  // 'writing_quality.hemingway' | 'voice_consistency' | ...
  observed: string                   // human-readable observed value
  prescription: string               // what corrective specs should test
}

interface CohortAnalytics {
  by_quadrant: Record<Quadrant, CohortConstraints>
  quality_gaps: QualityGap[]
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
  // Winners from every OTHER product/upload this user owns. Surfaces as the
  // novelty-mode inspiration source — combinations proven elsewhere but not
  // yet tested for this product. null when no cross-cohort winners exist.
  cross_cohort_pool: CrossCohortPool | null
}

interface CrossCohortRow {
  id: string
  comprehensive_analysis: Record<string, unknown> | null
  spend_usd: number | null
  cpa_usd: number | null
  ctr_pct: number | null
  quadrant: Quadrant | null
  quadrant_override: Quadrant | null
  product_id: string | null
}

interface CrossCohortPool {
  sample_size: number
  top_angles: Array<[string, number]>
  top_concepts: Array<[string, number]>
  top_awareness_levels: Array<[string, number]>
  top_format_compositions: Array<[string, number]>
  top_be_stacks: Array<[string, number]>
  headline_exemplars: string[]
  gaps: {
    angles_not_in_current: string[]
    awareness_not_in_current: string[]
    format_compositions_not_in_current: string[]
    be_stacks_not_in_current: string[]
    personas_not_in_current: string[]
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

function computeCohortAnalytics(rows: QuadrantAdRow[], crossCohortPool: CrossCohortPool | null = null): CohortAnalytics {
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
  const quality_gaps = detectQualityGaps(by_quadrant.winner)

  return { by_quadrant, quality_gaps, contrasts, loss_diagnostics, audience_match_correlation, cross_cohort_pool: crossCohortPool }
}

// Aggregates winners across every OTHER product/upload this user owns, then
// computes set differences vs. the current product's winner patterns. Surfaces
// combinations validated elsewhere but absent here — the seed signal for
// spec_mode='novelty'. Returns null when no cross-cohort winners exist.
function computeCrossCohortPool(crossRows: CrossCohortRow[], currentProductRows: QuadrantAdRow[]): CrossCohortPool | null {
  if (crossRows.length === 0) return null

  const angleCounts = new Map<string, number>()
  const conceptCounts = new Map<string, number>()
  const awarenessCounts = new Map<string, number>()
  const formatCompCounts = new Map<string, number>()
  const beStackCounts = new Map<string, number>()
  const personaSet = new Set<string>()
  const headlineCandidates: Array<{ text: string; spend: number }> = []

  for (const r of crossRows) {
    const ca = (r.comprehensive_analysis ?? {}) as Record<string, unknown>
    const audI = ca.audience_inference as Record<string, unknown> | undefined
    const mc = ca.market_context as Record<string, unknown> | undefined
    const fmt = (ca.ad_format as Record<string, unknown> | undefined)?.type
    const comp = ca.composition_tag

    if (typeof audI?.inferred_angle === 'string') angleCounts.set(audI.inferred_angle, (angleCounts.get(audI.inferred_angle) ?? 0) + 1)
    if (typeof audI?.inferred_concept === 'string') conceptCounts.set(audI.inferred_concept, (conceptCounts.get(audI.inferred_concept) ?? 0) + 1)
    if (typeof audI?.inferred_persona === 'string') personaSet.add(audI.inferred_persona)
    if (typeof mc?.awareness_level === 'string') awarenessCounts.set(mc.awareness_level, (awarenessCounts.get(mc.awareness_level) ?? 0) + 1)
    if (typeof fmt === 'string' && typeof comp === 'string') {
      const key = `${fmt} / ${comp}`
      formatCompCounts.set(key, (formatCompCounts.get(key) ?? 0) + 1)
    }

    const be = ca.behavioral_economics as Record<string, unknown> | undefined
    if (be) {
      const active: string[] = []
      for (const s of ['scarcity', 'urgency', 'social_proof', 'anchoring', 'loss_aversion', 'authority', 'reciprocity']) {
        if ((be[s] as { present?: boolean } | undefined)?.present) active.push(s)
      }
      if (active.length > 0) {
        const stack = active.sort().join('+')
        beStackCounts.set(stack, (beStackCounts.get(stack) ?? 0) + 1)
      }
    }

    const headlineText = (ca.copy as Record<string, unknown> | undefined)?.headline as { text?: string } | undefined
    if (typeof headlineText?.text === 'string' && headlineText.text.trim()) {
      headlineCandidates.push({ text: headlineText.text.trim(), spend: r.spend_usd ?? 0 })
    }
  }

  // Build current-product reference sets for gap computation
  const currentAngles = new Set<string>()
  const currentAwareness = new Set<string>()
  const currentFormatComp = new Set<string>()
  const currentBeStacks = new Set<string>()
  const currentPersonas = new Set<string>()
  for (const r of currentProductRows) {
    const ca = r.comprehensive_analysis as Record<string, unknown>
    const audI = ca.audience_inference as Record<string, unknown> | undefined
    const mc = ca.market_context as Record<string, unknown> | undefined
    const fmt = (ca.ad_format as Record<string, unknown> | undefined)?.type
    const comp = ca.composition_tag
    if (typeof audI?.inferred_angle === 'string') currentAngles.add(audI.inferred_angle)
    if (typeof audI?.inferred_persona === 'string') currentPersonas.add(audI.inferred_persona)
    if (typeof mc?.awareness_level === 'string') currentAwareness.add(mc.awareness_level)
    if (typeof fmt === 'string' && typeof comp === 'string') currentFormatComp.add(`${fmt} / ${comp}`)
    const be = ca.behavioral_economics as Record<string, unknown> | undefined
    if (be) {
      const active: string[] = []
      for (const s of ['scarcity', 'urgency', 'social_proof', 'anchoring', 'loss_aversion', 'authority', 'reciprocity']) {
        if ((be[s] as { present?: boolean } | undefined)?.present) active.push(s)
      }
      if (active.length > 0) currentBeStacks.add(active.sort().join('+'))
    }
  }

  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])
  const topAngles    = sortDesc(angleCounts).slice(0, 8)
  const topConcepts  = sortDesc(conceptCounts).slice(0, 8)
  const topAwareness = sortDesc(awarenessCounts).slice(0, 6)
  const topFormatComp = sortDesc(formatCompCounts).slice(0, 8)
  const topBeStacks  = sortDesc(beStackCounts).slice(0, 8)

  const gaps = {
    angles_not_in_current:           topAngles.map(([k]) => k).filter(k => !currentAngles.has(k)),
    awareness_not_in_current:        topAwareness.map(([k]) => k).filter(k => !currentAwareness.has(k)),
    format_compositions_not_in_current: topFormatComp.map(([k]) => k).filter(k => !currentFormatComp.has(k)),
    be_stacks_not_in_current:        topBeStacks.map(([k]) => k).filter(k => !currentBeStacks.has(k)),
    personas_not_in_current:         [...personaSet].filter(p => !currentPersonas.has(p)).slice(0, 8),
  }

  return {
    sample_size: crossRows.length,
    top_angles: topAngles,
    top_concepts: topConcepts,
    top_awareness_levels: topAwareness,
    top_format_compositions: topFormatComp,
    top_be_stacks: topBeStacks,
    headline_exemplars: dedupe(headlineCandidates.sort((a, b) => b.spend - a.spend).map(c => c.text)).slice(0, 10),
    gaps,
  }
}

// Flags dimensions where even the WINNING cohort is mediocre. Each flagged gap
// forces at least one `spec_mode='fix'` spec that intentionally diverges on
// that dimension as a corrective test hypothesis. Without this, the spec
// generator replicates whatever winners do — even when winners are flawed
// (e.g. won DESPITE high reading-grade copy, not because of it).
function detectQualityGaps(winners: CohortConstraints): QualityGap[] {
  const gaps: QualityGap[] = []
  if (winners.sample_size === 0) return gaps

  const wq = winners.writing_quality
  if (wq?.headline_grade_median != null && wq.headline_grade_median > 9) {
    gaps.push({
      dimension: 'writing_quality.headline_grade',
      observed: `winners' median headline reading grade = ${wq.headline_grade_median} (Hemingway: hard)`,
      prescription: 'test a simpler-prose variant (target grade 6-8) with the same angle and audience — winners may be winning despite, not because of, dense copy',
    })
  }
  if (wq?.body_grade_median != null && wq.body_grade_median > 10) {
    gaps.push({
      dimension: 'writing_quality.body_grade',
      observed: `winners' median body reading grade = ${wq.body_grade_median}`,
      prescription: 'test a Hemingway-good body variant (short sentences, active voice, no weasels) — see if simplification lifts CPA',
    })
  }
  if (wq?.active_voice_ratio_median != null && wq.active_voice_ratio_median < 0.85) {
    gaps.push({
      dimension: 'writing_quality.active_voice',
      observed: `winners' median active voice ratio = ${Math.round(wq.active_voice_ratio_median * 100)}%`,
      prescription: 'test a fully-active-voice variant — passive constructions weaken claims',
    })
  }
  if (wq?.weasel_word_density_median != null && wq.weasel_word_density_median > 3) {
    gaps.push({
      dimension: 'writing_quality.weasel_density',
      observed: `winners use ${wq.weasel_word_density_median.toFixed(1)} weasel words per 100w`,
      prescription: 'test a no-weasel variant — strip "very/really/just/quite" and replace with specifics',
    })
  }
  if (winners.voice_consistency_median != null && winners.voice_consistency_median < 7) {
    gaps.push({
      dimension: 'voice_consistency',
      observed: `winners' median voice_consistency = ${winners.voice_consistency_median}/10 (drift even in winners)`,
      prescription: 'test a tighter-voice variant where headline / subheadline / body / CTA all read in one consistent voice',
    })
  }
  const cg = winners.curiosity_gap
  if (cg && cg.gap_strength_median >= 6 && cg.body_resolves_rate < 0.5) {
    gaps.push({
      dimension: 'curiosity_gap.body_resolves',
      observed: `winners have median gap_strength ${cg.gap_strength_median}/10 but body resolves only ${Math.round(cg.body_resolves_rate * 100)}% of the time (info-gap leak)`,
      prescription: 'test a closed-loop variant where body explicitly delivers on the headline gap — winners may be leaving conversions on the table',
    })
  }
  if (winners.congruence_median != null && winners.congruence_median < 7) {
    gaps.push({
      dimension: 'congruence',
      observed: `winners' median congruence = ${winners.congruence_median}/10`,
      prescription: 'test a single-concept variant — strip competing claims so every element points at the same outcome',
    })
  }
  if (winners.attention_score_median != null && winners.attention_score_median < 7) {
    gaps.push({
      dimension: 'attention_score',
      observed: `winners' median attention_score = ${winners.attention_score_median}/10`,
      prescription: 'test a stronger-disruptor variant — even winners aren\'t commanding strong attention; raise visual contrast or text dominance',
    })
  }
  const aud = winners.fit_dimension_medians.audience_targeting_fit
  if (typeof aud === 'number' && aud < 7) {
    gaps.push({
      dimension: 'fit.audience_targeting',
      observed: `winners' median audience_targeting_fit = ${aud}/10`,
      prescription: 'test a sharper-persona variant — narrower micro-persona, more audience-explicit headline language',
    })
  }
  return gaps
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

  if (a.quality_gaps.length > 0) {
    lines.push('')
    lines.push('## QUALITY GAPS (winners are mediocre on these dimensions — corrective test specs REQUIRED)')
    for (const g of a.quality_gaps) {
      lines.push(`  · ${g.dimension}: ${g.observed}`)
      lines.push(`    → ${g.prescription}`)
    }
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

  // Cross-cohort novelty pool — winners from every other product/upload the
  // user owns. Used by spec_mode='novelty' as the COMBINATION inspiration source
  // (audience × angle × format × awareness × BE). Voice / style explicitly
  // NOT pulled from this pool — anchored to WINNER DETAIL below.
  if (a.cross_cohort_pool) {
    const ccp = a.cross_cohort_pool
    lines.push('')
    lines.push(`## CROSS-COHORT NOVELTY POOL (n=${ccp.sample_size} other analyses you own, across all products + historical uploads)`)
    lines.push('  Top patterns proven elsewhere:')
    if (ccp.top_angles.length > 0)             lines.push(`    angles:           ${dist(ccp.top_angles)}`)
    if (ccp.top_concepts.length > 0)           lines.push(`    concepts:         ${dist(ccp.top_concepts)}`)
    if (ccp.top_awareness_levels.length > 0)   lines.push(`    awareness:        ${dist(ccp.top_awareness_levels)}`)
    if (ccp.top_format_compositions.length > 0) lines.push(`    format × comp:    ${dist(ccp.top_format_compositions)}`)
    if (ccp.top_be_stacks.length > 0)          lines.push(`    BE stacks:        ${dist(ccp.top_be_stacks)}`)
    const g = ccp.gaps
    const anyGap = g.angles_not_in_current.length + g.awareness_not_in_current.length + g.format_compositions_not_in_current.length + g.be_stacks_not_in_current.length + g.personas_not_in_current.length > 0
    if (anyGap) {
      lines.push('  GAPS — combinations validated cross-cohort but NOT YET tested in this product:')
      if (g.angles_not_in_current.length > 0)            lines.push(`    angles missing here:           ${g.angles_not_in_current.join(', ')}`)
      if (g.awareness_not_in_current.length > 0)         lines.push(`    awareness levels missing here: ${g.awareness_not_in_current.join(', ')}`)
      if (g.format_compositions_not_in_current.length > 0) lines.push(`    format×comp missing here:      ${g.format_compositions_not_in_current.join(', ')}`)
      if (g.be_stacks_not_in_current.length > 0)         lines.push(`    BE stacks missing here:        ${g.be_stacks_not_in_current.join(', ')}`)
      if (g.personas_not_in_current.length > 0)          lines.push(`    personas missing here:         ${g.personas_not_in_current.join(', ')}`)
    }
    if (ccp.headline_exemplars.length > 0) {
      lines.push('  Top cross-cohort headlines (FOR COMBINATION INSPIRATION ONLY — DO NOT match this voice; match the current product\'s verbatim winners below):')
      for (const h of ccp.headline_exemplars) lines.push(`    · ${h}`)
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
