import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'
import {
  getWinningPatterns,
  getAllWinningAnalyses,
  getLosingPatterns,
  storeComprehensiveAnalysis,
  WINNER_THRESHOLD_USD,
  type PatternLibraryRow,
  type LosingPatternRow,
  type WinningAnalysisSummary,
} from '@/lib/pattern-library'
import { fetchRedditPosts, type RedditPost } from '@/lib/reddit'
import type { ExtractedElements } from '@/app/api/analyze/extract-elements/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface ROIAverage {
  region_key: string
  label: string
  description: string
  activation: number
}

export interface ComprehensiveAnalysis {
  copy: {
    headline: { text: string; clarity: number; urgency: number; relevance: number; feedback: string }
    subheadline: { text: string; supports_headline: boolean; clarity: number; feedback: string }
    benefits_features: { identified: string[]; clarity: number; prominence: number; feedback: string }
    trust_signals: { identified: string[]; strength: number; feedback: string }
    safety_signals: { identified: string[]; strength: number; feedback: string }
    cta: { text: string; clarity: number; placement: string; contrast: number; feedback: string }
  }
  behavioral_economics: {
    scarcity: { present: boolean; strength: number; note: string }
    urgency: { present: boolean; strength: number; note: string }
    social_proof: { present: boolean; strength: number; note: string }
    anchoring: { present: boolean; strength: number; note: string }
    loss_aversion: { present: boolean; strength: number; note: string }
    authority: { present: boolean; strength: number; note: string }
    reciprocity: { present: boolean; strength: number; note: string }
    overall_feedback: string
  }
  neuroscience: {
    attention_prediction: string
    emotional_encoding: string
    memory_encoding: string
    feedback: string
  }
  visual_dimensions: {
    cta_strength: { score: number; feedback: string }
    emotional_appeal: { score: number; feedback: string }
    brand_clarity: { score: number; feedback: string }
    visual_hierarchy: { score: number; feedback: string }
  }
  berg_recommendations: string[]
  pattern_matches: string[]
  overall: {
    verdict: string
    top_strength: string
    critical_weakness: string
    priority_fix: string
  }
  market_context: {
    awareness_level: 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware'
    awareness_reasoning: string
    sophistication_level: 1 | 2 | 3 | 4 | 5
    sophistication_reasoning: string
  }
  ad_format: {
    type: 'direct_response' | 'native_ugc' | 'advertorial' | 'brand_awareness' | 'product_demo' | 'testimonial' | 'hybrid'
    composition: {
      has_headline: boolean
      has_subheadline: boolean
      has_body_copy: boolean
      has_benefits_list: boolean
      has_trust_signals: boolean
      has_cta: boolean
      has_price_or_offer: boolean
      is_visual_dominant: boolean
      is_text_heavy: boolean
    }
    format_assessment: string
  }
  hook_analysis: {
    scroll_stop_score: number
    pattern_interrupt: string
    first_half_second: string
    hook_feedback: string
  }
  offer_architecture: {
    offer_present: boolean
    offer_text: string | null
    has_price_anchor: boolean
    has_guarantee: boolean
    has_urgency_mechanism: boolean
    has_trial_or_free: boolean
    perceived_value_score: number
    offer_clarity_score: number
    offer_feedback: string
  }
  cognitive_load: {
    score: number
    density: 'minimal' | 'moderate' | 'heavy'
    overload_risk: string
    simplification: string
  }
  platform_fit: {
    optimised_for: string[]
    weak_for: string[]
    reasoning: string
    adaptation_notes: string
  }
  framework_score: {
    minimum_viable_test: 'pass' | 'fail'
    headline_leaves_gap: boolean
    subheadline_justified: boolean
    benefits_justified: boolean
    trust_signal_justified: boolean
    cta_justified: boolean
    overall_framework_grade: 'A' | 'B' | 'C' | 'D'
    framework_feedback: string
  }
  congruence: {
    overall_score: number
    headline_to_visual: { aligned: boolean; note: string }
    headline_to_subheadline: { aligned: boolean; note: string }
    body_to_headline: { aligned: boolean; note: string }
    benefits_to_headline: { aligned: boolean; note: string }
    cta_to_offer: { aligned: boolean; note: string }
    trust_signals_to_claim: { aligned: boolean; note: string }
    incoherence_summary: string
    fix: string
  }
  reddit_research?: {
    topic: string
    posts_found: Array<{ title: string; url: string; snippet: string }>
    situation_patterns: string[]
    congruence_with_reddit: { verdict: 'aligned' | 'partial' | 'misaligned'; note: string }
    visual_ideation: { concept: string; rationale: string; source_urls: string[] }
  }
}

const anthropic = new Anthropic({ timeout: 120000 })

function buildPatternContext(
  patterns: PatternLibraryRow[],
  winningExamples: WinningAnalysisSummary[],
  losingPatterns: LosingPatternRow[] = [],
): string {
  if (patterns.length === 0 && winningExamples.length === 0 && losingPatterns.length === 0) return ''

  const lines: string[] = []

  if (patterns.length > 0) {
    lines.push(`--- Winning Ad Patterns (derived from ads with $${WINNER_THRESHOLD_USD}+ spend) ---`)
    patterns.forEach((p, i) => {
      lines.push(`${i + 1}. [${p.category}] ${p.rule_text}`)
    })
  }

  if (losingPatterns.length > 0) {
    lines.push('')
    lines.push(`--- Anti-Patterns (from ads that failed <$${WINNER_THRESHOLD_USD} spend — treat as warnings, not rules) ---`)
    losingPatterns.forEach((p, i) => {
      lines.push(`${i + 1}. [${p.category}] ${p.rule_text} (seen in ${p.loser_count} losers, confidence: ${p.confidence})`)
    })
  }

  if (winningExamples.length > 0) {
    lines.push('')
    lines.push('--- All Winning Ad Examples (every ad above spend threshold) ---')
    winningExamples.forEach((ex, i) => {
      const ca = ex.comprehensive_analysis as unknown as ComprehensiveAnalysis | null
      if (!ca) return
      const headline = ca.copy?.headline?.text ?? 'n/a'
      const headlineWords = headline !== 'n/a' ? headline.trim().split(/\s+/).length : 0
      const hasSubheadline = !!ca.copy?.subheadline?.text
      const benefits = ca.copy?.benefits_features?.identified ?? []
      const hasTrust = (ca.copy?.trust_signals?.identified?.length ?? 0) > 0
      const cta = ca.copy?.cta?.text ?? 'n/a'
      const offer = ca.offer_architecture?.offer_present ?? false
      const grade = ca.framework_score?.overall_framework_grade ?? '?'
      const awareness = ca.market_context?.awareness_level ?? 'unknown'
      const scrollStop = ca.hook_analysis?.scroll_stop_score ?? 0
      const cogLoad = ca.cognitive_load?.score ?? 0
      const congruenceScore = ca.congruence?.overall_score ?? 'n/a'
      const topBE = Object.entries(ca.behavioral_economics ?? {})
        .filter(([k, v]) => k !== 'overall_feedback' && (v as { present: boolean }).present)
        .map(([k]) => k).join(', ') || 'none'
      lines.push(`Example ${i + 1} ($${ex.spend_usd} spend): headline="${headline}" (${headlineWords}w) | subheadline=${hasSubheadline} | benefits=${benefits.length} | trust=${hasTrust} | cta="${cta}" | offer=${offer} | grade=${grade} | awareness=${awareness} | scroll_stop=${scrollStop}/10 | cog_load=${cogLoad}/10 | congruence=${congruenceScore}/10 | BE=[${topBE}]`)
    })
  }

  return lines.join('\n')
}

const ROI_AD_CONTEXT = `ROI interpretation for paid media:
- FFA (Face Detection): High = face/person anchoring attention — drives emotion and trust. Low = no human element — consider adding a face if the product allows.
- V1_V2 (Low-Level Visual): High = strong edges/contrast — scroll-stopping in feed. Low = flat visual — will blend in and be ignored.
- V4 (Color/Form): High = vivid, distinctive colors — aids brand recall. Low = muted palette — will not differentiate on a crowded feed.
- LO (Object Recognition): High = product/objects clearly identifiable. Low = visual is ambiguous — viewer won't immediately know what's being sold.
- PPA (Scene Recognition): High = environment/context is readable — good for lifestyle positioning. Low = no scene context.
- VWFA (Text Processing): High = text is legible and competing for visual attention. Low = text too small or contrast insufficient.`

const ROI_AD_CONTEXT_HISTORICAL = `ROI signals (descriptive only):
- FFA (Face Detection): High = face/face-like element anchoring attention. Low = no human anchor; the ad relies on non-human visual elements.
- V1_V2 (Low-Level Visual): High = strong edges/contrast driving feed disruption. Low = flat visual; this ad relies on text or color rather than edge density.
- V4 (Color/Form): High = vivid distinctive palette aiding brand recall. Low = muted palette; differentiation comes from another dimension.
- LO (Object Recognition): High = product/objects clearly identifiable as units. Low = visual is abstract or close-cropped; the product reads as texture rather than object.
- PPA (Scene Recognition): High = environment/context readable; lifestyle positioning. Low = no scene context; isolated subject framing.
- VWFA (Text Processing): High = text is legible and competing for visual attention. Low = text is minimal or de-prioritized; visual carries the message.`

const FRAMEWORK_CONTEXT = `Copywriting framework (minimum-viable-copy principle — apply strictly):
- Start with the minimum. Add an element ONLY when the previous one leaves something unresolved.
- Headline: Should communicate the core feeling with the visual in 5 words or fewer. Does it?
- Subheadline: Justified ONLY if headline leaves "so what?" unanswered. If headline is complete, subheadline is clutter.
- Benefits: Justified ONLY if the audience needs to justify the decision (not just desire it). Each benefit should answer a specific objection — not restate the headline.
- Trust signal: Default ON for health, money, significant life changes. Otherwise start without and test.
- CTA: Justified ONLY if the next step is unclear OR there is a specific offer worth leading with.

Awareness levels (Eugene Schwartz — assess which level this ad targets):
- Unaware: viewer doesn't know they have a problem. Ad must surface pain first.
- Problem-aware: knows the problem, not the solution category. Ad bridges problem to solution type.
- Solution-aware: knows solutions exist, not this product specifically. Ad differentiates.
- Product-aware: knows this product, hasn't committed. Ad removes barriers or sharpens offer.
- Most-aware: knows the product well, just needs an offer or trigger. Minimal copy, max offer.

Market sophistication levels (1 = low saturation, 5 = highly saturated/jaded):
- Level 1: First-to-market claim. A bold direct claim wins. No mechanism needed.
- Level 2: Market has seen claims. A bigger, more specific claim needed.
- Level 3: Claims saturated. The MECHANISM (how it works) is the differentiator.
- Level 4: Mechanisms saturated. IDENTIFICATION — "for people like you" — is the differentiator.
- Level 5: Everything saturated. SENSATION and experience are the only differentiators.

Congruence principle — every element must reinforce the same core message:
- Headline and visual must tell the same story with no ambiguity.
- Subheadline must resolve the specific tension the headline creates — not introduce a new topic.
- Body must elaborate the headline's promise. If headline is about energy but body talks about sleep mechanics with no energy connection, that is incoherence.
- Each benefit must be a direct consequence of the core mechanism — tangential benefits dilute focus.
- CTA must match the offer or ask — "Shop now" without a visible product or price is incoherent.
- Trust signals must validate the specific claim made, not a different dimension entirely.`

function buildBergPrompt(roiAverages: ROIAverage[], patternContext: string, visualDescription?: string, mode?: string, spendUsd?: number): string {
  const scoreLines = roiAverages
    .map(r => `- ${r.label} (${r.region_key}): ${r.activation.toFixed(3)} — ${r.description}`)
    .join('\n')

  const isLoser = mode === 'historical' && spendUsd !== undefined && spendUsd < WINNER_THRESHOLD_USD
  const isWinner = mode === 'historical' && !isLoser

  const roiContext = mode === 'historical' ? ROI_AD_CONTEXT_HISTORICAL : ROI_AD_CONTEXT

  let ending: string
  if (isLoser) {
    ending = `For each ROI: name it, quote the score, write 2 sentences explaining what its activation level reveals about why this ad failed to generate meaningful spend ($${spendUsd}). Pure observation — no recommendations, no "consider", no "test", no "darken".

GOOD: "V1_V2 — 0.415: Low edge density means the visual did not disrupt the scroll; with $${spendUsd} spend, this confirms the image failed to earn the stop that would have made the headline readable."

BAD: "V1_V2 — 0.415: Low contrast. Darken the background to push edge density and improve scroll-stopping power."

Format as a markdown bulleted list.`
  } else if (isWinner) {
    ending = `For each ROI: name it, quote the score, write 2 sentences explaining what its activation level reveals about this ad's effectiveness for this audience and category. Pure observation — no third sentence with recommendations, no "consider", no "test", no "darken", no "push closer to threshold".

GOOD: "VWFA — 1.000: Text is fully commanding visual attention; this is the single strongest signal in this creative. At high spend in a problem-aware audience, the audience reads this ad more than they recognize the product, and that trade-off worked for this conversion mechanic."

BAD: "VWFA — 1.000: Text is fully commanding attention. Audit the text hierarchy to ensure the offer line occupies the dominant position."

Format as a markdown bulleted list.`
  } else {
    ending = `Give 5–6 specific, actionable recommendations. For each: name the ROI, quote its score, state the ad-performance implication and the exact change to make. Two sentences max — no filler. Reference winning patterns above where relevant.\n\nFormat as a markdown bulleted list.`
  }

  return `You are interpreting BERG fMRI brain activation predictions for a static ad image.

${roiContext}

BERG brain activation scores:
${scoreLines}
${visualDescription ? `\nConfirmed visual content: "${visualDescription}"\n` : ''}
IMPORTANT — interpretation context:
BERG scores model how neural regions respond to low-level visual properties (edges, spatial frequencies, color distributions). They are NOT object detectors.
High FFA on an image with no faces means the visual patterns (curves, skin-tone-like colors, oval shapes) incidentally activated face-processing — not that a face is present.

For each ROI:
- High score + element present in confirmed visual: strong creative signal.
- High score + visual description contradicts element presence: flag as incidental. Example: "FFA elevated despite no human face — likely reflects shape/tonal properties, not a usable face signal."
- Base all analysis on what is actually in the image.
${patternContext ? `\n${patternContext}\n` : ''}
${ending}`
}

function buildConfirmedElementsBlock(confirmed: ExtractedElements): string {
  const lines = ['--- Confirmed ad element extraction (user-verified — use as ground truth, do not re-extract) ---']
  if (confirmed.headline) lines.push(`Headline: "${confirmed.headline}"`)
  if (confirmed.subheadline) lines.push(`Subheadline: "${confirmed.subheadline}"`)
  if (confirmed.body_copy) lines.push(`Body copy: "${confirmed.body_copy}"`)
  if (confirmed.benefits.length) lines.push(`Benefits: ${confirmed.benefits.map(b => `"${b}"`).join(', ')}`)
  if (confirmed.trust_signals.length) lines.push(`Trust signals: ${confirmed.trust_signals.join(', ')}`)
  if (confirmed.safety_signals.length) lines.push(`Safety signals: ${confirmed.safety_signals.join(', ')}`)
  if (confirmed.proof_signals.length) lines.push(`Proof signals: ${confirmed.proof_signals.join(', ')}`)
  if (confirmed.cta) lines.push(`CTA: "${confirmed.cta}"`)
  if (confirmed.offer_details) lines.push(`Offer: "${confirmed.offer_details}"`)
  lines.push(`Visual: ${confirmed.visual_description}`)
  lines.push(`Format type (user estimate): ${confirmed.ad_format_guess}`)
  return lines.join('\n')
}

const COMPREHENSIVE_JSON_SCHEMA = `{
  "copy": {
    "headline": { "text": "<exact text or null>", "clarity": <1-10>, "urgency": <1-10>, "relevance": <1-10>, "feedback": "<two sentences>" },
    "subheadline": { "text": "<exact text or null>", "supports_headline": <true/false>, "clarity": <1-10>, "feedback": "<one sentence>" },
    "benefits_features": { "identified": ["<benefit 1>"], "clarity": <1-10>, "prominence": <1-10>, "feedback": "<two sentences>" },
    "trust_signals": { "identified": ["<signal>"], "strength": <1-10>, "feedback": "<two sentences>" },
    "safety_signals": { "identified": ["<signal>"], "strength": <1-10>, "feedback": "<two sentences>" },
    "cta": { "text": "<exact text or null>", "clarity": <1-10>, "placement": "<location>", "contrast": <1-10>, "feedback": "<two sentences>" }
  },
  "behavioral_economics": {
    "scarcity":      { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "urgency":       { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "social_proof":  { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "anchoring":     { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "loss_aversion": { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "authority":     { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "reciprocity":   { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "overall_feedback": "<two sentences>"
  },
  "neuroscience": {
    "attention_prediction": "<one-two sentences: what captures attention first and why>",
    "emotional_encoding":   "<one-two sentences: emotional response likely triggered>",
    "memory_encoding":      "<one-two sentences: how memorable and what aids or hinders recall>",
    "feedback":             "<two sentences: top neuroscience recommendation>"
  },
  "visual_dimensions": {
    "cta_strength":     { "score": <1-10>, "feedback": "<two sentences>" },
    "emotional_appeal": { "score": <1-10>, "feedback": "<two sentences>" },
    "brand_clarity":    { "score": <1-10>, "feedback": "<two sentences>" },
    "visual_hierarchy": { "score": <1-10>, "feedback": "<two sentences>" }
  },
  "pattern_matches": ["<winning rule this ad satisfies or violates, verbatim from the patterns>"],
  "overall": {
    "verdict":           "<three-four sentences: overall assessment>",
    "top_strength":      "<one sentence: strongest element with specific reason>",
    "critical_weakness": "<one sentence: biggest weakness with specific reason>",
    "priority_fix":      "<one sentence: single highest-priority change>"
  },
  "market_context": {
    "awareness_level": "<one of: unaware | problem_aware | solution_aware | product_aware | most_aware>",
    "awareness_reasoning": "<one sentence: why this awareness level>",
    "sophistication_level": <1-5>,
    "sophistication_reasoning": "<one sentence: why this sophistication level>"
  },
  "ad_format": {
    "type": "<one of: direct_response | native_ugc | advertorial | brand_awareness | product_demo | testimonial | hybrid>",
    "composition": {
      "has_headline": <true/false>,
      "has_subheadline": <true/false>,
      "has_body_copy": <true/false>,
      "has_benefits_list": <true/false>,
      "has_trust_signals": <true/false>,
      "has_cta": <true/false>,
      "has_price_or_offer": <true/false>,
      "is_visual_dominant": <true/false>,
      "is_text_heavy": <true/false>
    },
    "format_assessment": "<one sentence: does the format match the likely intent and awareness level>"
  },
  "hook_analysis": {
    "scroll_stop_score": <1-10>,
    "pattern_interrupt": "<what specific element(s) would stop the scroll>",
    "first_half_second": "<what the eye hits first and why it works or doesn't for this audience>",
    "hook_feedback": "<one specific change to strengthen the hook>"
  },
  "offer_architecture": {
    "offer_present": <true/false>,
    "offer_text": "<exact offer text or null>",
    "has_price_anchor": <true/false>,
    "has_guarantee": <true/false>,
    "has_urgency_mechanism": <true/false>,
    "has_trial_or_free": <true/false>,
    "perceived_value_score": <1-10>,
    "offer_clarity_score": <1-10>,
    "offer_feedback": "<two sentences: offer strength and what to improve>"
  },
  "cognitive_load": {
    "score": <1-10, where 1=effortless and 10=overwhelming>,
    "density": "<one of: minimal | moderate | heavy>",
    "overload_risk": "<what specific element(s) are contributing to overload, or 'none'>",
    "simplification": "<one specific change to reduce cognitive load>"
  },
  "platform_fit": {
    "optimised_for": ["<platform 1>"],
    "weak_for": ["<platform 1>"],
    "reasoning": "<two sentences: why this format fits or doesn't fit each platform>",
    "adaptation_notes": "<one-two sentences: specific changes for the weakest platform>"
  },
  "framework_score": {
    "minimum_viable_test": "<pass or fail: does visual + 5 words communicate the core feeling?>",
    "headline_leaves_gap": <true/false>,
    "subheadline_justified": <true/false>,
    "benefits_justified": <true/false>,
    "trust_signal_justified": <true/false>,
    "cta_justified": <true/false>,
    "overall_framework_grade": "<A | B | C | D>",
    "framework_feedback": "<two sentences: where the framework is violated or over-built>"
  },
  "congruence": {
    "overall_score": <1-10, where 10=fully congruent>,
    "headline_to_visual":       { "aligned": <true/false>, "note": "<one sentence>" },
    "headline_to_subheadline":  { "aligned": <true/false>, "note": "<one sentence>" },
    "body_to_headline":         { "aligned": <true/false>, "note": "<one sentence>" },
    "benefits_to_headline":     { "aligned": <true/false>, "note": "<one sentence>" },
    "cta_to_offer":             { "aligned": <true/false>, "note": "<one sentence>" },
    "trust_signals_to_claim":   { "aligned": <true/false>, "note": "<one sentence>" },
    "incoherence_summary": "<one sentence: primary mismatch, or 'No incoherence detected'>",
    "fix": "<single most important change to improve congruence>"
  }
}`

const COMPREHENSIVE_JSON_SCHEMA_HISTORICAL = `{
  "copy": {
    "headline": { "text": "<exact text or null>", "clarity": <1-10>, "urgency": <1-10>, "relevance": <1-10>, "feedback": "<two sentences: what this headline reveals about the audience and structural choice>" },
    "subheadline": { "text": "<exact text or null>", "supports_headline": <true/false>, "clarity": <1-10>, "feedback": "<one sentence: what the subheadline's presence or absence reveals>" },
    "benefits_features": { "identified": ["<benefit 1>"], "clarity": <1-10>, "prominence": <1-10>, "feedback": "<two sentences: what the benefit structure reveals about audience justification needs>" },
    "trust_signals": { "identified": ["<signal>"], "strength": <1-10>, "feedback": "<two sentences: what the trust signal level reveals about category trust requirements>" },
    "safety_signals": { "identified": ["<signal>"], "strength": <1-10>, "feedback": "<two sentences: what safety signal handling reveals about category compliance posture>" },
    "cta": { "text": "<exact text or null>", "clarity": <1-10>, "placement": "<location>", "contrast": <1-10>, "feedback": "<two sentences: what the CTA presence/absence reveals about audience readiness>" }
  },
  "behavioral_economics": {
    "scarcity":      { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "urgency":       { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "social_proof":  { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "anchoring":     { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "loss_aversion": { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "authority":     { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "reciprocity":   { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "overall_feedback": "<two sentences: which BE levers carry the conversion load and what that reveals>"
  },
  "neuroscience": {
    "attention_prediction": "<one-two sentences: what captures attention first and why>",
    "emotional_encoding":   "<one-two sentences: emotional response likely triggered>",
    "memory_encoding":      "<one-two sentences: how memorable and what aids or hinders recall>",
    "feedback":             "<two sentences: top neural processing insight about why this ad works>"
  },
  "visual_dimensions": {
    "cta_strength":     { "score": <1-10>, "feedback": "<two sentences: observation about this dimension's role in this ad's effectiveness>" },
    "emotional_appeal": { "score": <1-10>, "feedback": "<two sentences: observation about this dimension's role in this ad's effectiveness>" },
    "brand_clarity":    { "score": <1-10>, "feedback": "<two sentences: observation about this dimension's role in this ad's effectiveness>" },
    "visual_hierarchy": { "score": <1-10>, "feedback": "<two sentences: observation about this dimension's role in this ad's effectiveness>" }
  },
  "pattern_matches": ["<winning rule this ad satisfies or violates, verbatim from the patterns>"],
  "overall": {
    "verdict":           "<three-four sentences: overall assessment of why this ad worked>",
    "top_strength":      "<one sentence: strongest element with specific reason>",
    "critical_weakness": "<one sentence: single notable structural absence and what it reveals about audience tolerance>",
    "priority_fix":      "<one sentence: single most transferable creative insight from this ad's structure>"
  },
  "market_context": {
    "awareness_level": "<one of: unaware | problem_aware | solution_aware | product_aware | most_aware>",
    "awareness_reasoning": "<one sentence: why this awareness level>",
    "sophistication_level": <1-5>,
    "sophistication_reasoning": "<one sentence: why this sophistication level>"
  },
  "ad_format": {
    "type": "<one of: direct_response | native_ugc | advertorial | brand_awareness | product_demo | testimonial | hybrid>",
    "composition": {
      "has_headline": <true/false>,
      "has_subheadline": <true/false>,
      "has_body_copy": <true/false>,
      "has_benefits_list": <true/false>,
      "has_trust_signals": <true/false>,
      "has_cta": <true/false>,
      "has_price_or_offer": <true/false>,
      "is_visual_dominant": <true/false>,
      "is_text_heavy": <true/false>
    },
    "format_assessment": "<one sentence: what this format reveals about audience match and conversion intent>"
  },
  "hook_analysis": {
    "scroll_stop_score": <1-10>,
    "pattern_interrupt": "<what specific element(s) stopped the scroll>",
    "first_half_second": "<what the eye hits first and why it works for this audience>",
    "hook_feedback": "<one sentence: what this hook's effectiveness reveals about audience attention in this vertical>"
  },
  "offer_architecture": {
    "offer_present": <true/false>,
    "offer_text": "<exact offer text or null>",
    "has_price_anchor": <true/false>,
    "has_guarantee": <true/false>,
    "has_urgency_mechanism": <true/false>,
    "has_trial_or_free": <true/false>,
    "perceived_value_score": <1-10>,
    "offer_clarity_score": <1-10>,
    "offer_feedback": "<two sentences: what the offer architecture reveals about decision pathway here>"
  },
  "cognitive_load": {
    "score": <1-10, where 1=effortless and 10=overwhelming>,
    "density": "<one of: minimal | moderate | heavy>",
    "overload_risk": "<what specific element(s) are contributing to overload, or 'none'>",
    "simplification": "<one sentence: what this load level reveals about minimum-viable copy in this category>"
  },
  "platform_fit": {
    "optimised_for": ["<platform 1>"],
    "weak_for": ["<platform 1>"],
    "reasoning": "<two sentences: why this format fits or doesn't fit each platform>",
    "adaptation_notes": "<one-two sentences: what platform fit reveals about audience-format match and category native placement>"
  },
  "framework_score": {
    "minimum_viable_test": "<pass or fail: does visual + 5 words communicate the core feeling?>",
    "headline_leaves_gap": <true/false>,
    "subheadline_justified": <true/false>,
    "benefits_justified": <true/false>,
    "trust_signal_justified": <true/false>,
    "cta_justified": <true/false>,
    "overall_framework_grade": "<A | B | C | D>",
    "framework_feedback": "<two sentences: what this grade reveals about minimum-viable-copy norms in this vertical>"
  },
  "congruence": {
    "overall_score": <1-10, where 10=fully congruent>,
    "headline_to_visual":       { "aligned": <true/false>, "note": "<one sentence>" },
    "headline_to_subheadline":  { "aligned": <true/false>, "note": "<one sentence>" },
    "body_to_headline":         { "aligned": <true/false>, "note": "<one sentence>" },
    "benefits_to_headline":     { "aligned": <true/false>, "note": "<one sentence>" },
    "cta_to_offer":             { "aligned": <true/false>, "note": "<one sentence>" },
    "trust_signals_to_claim":   { "aligned": <true/false>, "note": "<one sentence>" },
    "incoherence_summary": "<one sentence: primary mismatch, or 'No incoherence detected'>",
    "fix": "<one sentence: what the congruence pattern reveals about effective creative architecture here>"
  }
}`


const COMPREHENSIVE_JSON_SCHEMA_LOSER = `{
  "copy": {
    "headline": { "text": "<exact text or null>", "clarity": <1-10>, "urgency": <1-10>, "relevance": <1-10>, "feedback": "<two sentences: what this headline reveals about why the audience did not convert>" },
    "subheadline": { "text": "<exact text or null>", "supports_headline": <true/false>, "clarity": <1-10>, "feedback": "<one sentence: what the subheadline's presence or absence reveals about the structural failure>" },
    "benefits_features": { "identified": ["<benefit 1>"], "clarity": <1-10>, "prominence": <1-10>, "feedback": "<two sentences: what the benefit structure reveals about the conversion gap>" },
    "trust_signals": { "identified": ["<signal>"], "strength": <1-10>, "feedback": "<two sentences: what the trust signal level reveals about why credibility did not land>" },
    "safety_signals": { "identified": ["<signal>"], "strength": <1-10>, "feedback": "<two sentences: what safety signal handling reveals about compliance or friction failures>" },
    "cta": { "text": "<exact text or null>", "clarity": <1-10>, "placement": "<location>", "contrast": <1-10>, "feedback": "<two sentences: what the CTA reveals about why the next step failed to convert>" }
  },
  "behavioral_economics": {
    "scarcity":      { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "urgency":       { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "social_proof":  { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "anchoring":     { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "loss_aversion": { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "authority":     { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "reciprocity":   { "present": <true/false>, "strength": <0-10>, "note": "<one sentence>" },
    "overall_feedback": "<two sentences: which BE levers are absent or weak and what that reveals about why conversion stalled>"
  },
  "neuroscience": {
    "attention_prediction": "<one-two sentences: what captures attention first and why>",
    "emotional_encoding":   "<one-two sentences: emotional response likely triggered>",
    "memory_encoding":      "<one-two sentences: how memorable and what aids or hinders recall>",
    "feedback":             "<two sentences: top neural processing insight about why this ad failed to hold attention or drive action>"
  },
  "visual_dimensions": {
    "cta_strength":     { "score": <1-10>, "feedback": "<two sentences: what this score reveals about why the ad failed to drive action>" },
    "emotional_appeal": { "score": <1-10>, "feedback": "<two sentences: what this score reveals about the emotional failure mode>" },
    "brand_clarity":    { "score": <1-10>, "feedback": "<two sentences: what this score reveals about why brand registration failed>" },
    "visual_hierarchy": { "score": <1-10>, "feedback": "<two sentences: what this score reveals about how hierarchy limited performance>" }
  },
  "pattern_matches": ["<anti-pattern this ad embodies, or winning rule it violated>"],
  "overall": {
    "verdict":           "<three-four sentences: why this ad failed to achieve meaningful spend — what structural choices limited its distribution>",
    "top_strength":      "<one sentence: what worked structurally, if anything, and why it was insufficient>",
    "critical_weakness": "<one sentence: primary structural failure that most directly explains the low spend>",
    "priority_fix":      "<one sentence: single most diagnostic failure pattern this ad reveals about what does not work in this category>"
  },
  "market_context": {
    "awareness_level": "<one of: unaware | problem_aware | solution_aware | product_aware | most_aware>",
    "awareness_reasoning": "<one sentence: why this awareness level — and whether the ad matched or mismatched it>",
    "sophistication_level": <1-5>,
    "sophistication_reasoning": "<one sentence: why this sophistication level and whether the ad addressed it correctly>"
  },
  "ad_format": {
    "type": "<one of: direct_response | native_ugc | advertorial | brand_awareness | product_demo | testimonial | hybrid>",
    "composition": {
      "has_headline": <true/false>,
      "has_subheadline": <true/false>,
      "has_body_copy": <true/false>,
      "has_benefits_list": <true/false>,
      "has_trust_signals": <true/false>,
      "has_cta": <true/false>,
      "has_price_or_offer": <true/false>,
      "is_visual_dominant": <true/false>,
      "is_text_heavy": <true/false>
    },
    "format_assessment": "<one sentence: what this format reveals about audience mismatch or conversion intent failure>"
  },
  "hook_analysis": {
    "scroll_stop_score": <1-10>,
    "pattern_interrupt": "<what element(s) were intended to stop scroll and why they did or did not work>",
    "first_half_second": "<what the eye hits first and why it failed or succeeded for this audience>",
    "hook_feedback": "<one sentence: what the hook's failure reveals about attention patterns in this vertical>"
  },
  "offer_architecture": {
    "offer_present": <true/false>,
    "offer_text": "<exact offer text or null>",
    "has_price_anchor": <true/false>,
    "has_guarantee": <true/false>,
    "has_urgency_mechanism": <true/false>,
    "has_trial_or_free": <true/false>,
    "perceived_value_score": <1-10>,
    "offer_clarity_score": <1-10>,
    "offer_feedback": "<two sentences: what the offer architecture reveals about why the decision pathway broke down>"
  },
  "cognitive_load": {
    "score": <1-10, where 1=effortless and 10=overwhelming>,
    "density": "<one of: minimal | moderate | heavy>",
    "overload_risk": "<what specific element(s) caused friction, or 'none'>",
    "simplification": "<one sentence: what this load level reveals about copy failure in this category>"
  },
  "platform_fit": {
    "optimised_for": ["<platform 1>"],
    "weak_for": ["<platform 1>"],
    "reasoning": "<two sentences: why this format failed or fit each platform>",
    "adaptation_notes": "<one-two sentences: what platform mismatch reveals about why this ad did not find its audience>"
  },
  "framework_score": {
    "minimum_viable_test": "<pass or fail: does visual + 5 words communicate the core feeling?>",
    "headline_leaves_gap": <true/false>,
    "subheadline_justified": <true/false>,
    "benefits_justified": <true/false>,
    "trust_signal_justified": <true/false>,
    "cta_justified": <true/false>,
    "overall_framework_grade": "<A | B | C | D>",
    "framework_feedback": "<two sentences: what framework violations or over-building reveals about why this ad underperformed>"
  },
  "congruence": {
    "overall_score": <1-10, where 10=fully congruent>,
    "headline_to_visual":       { "aligned": <true/false>, "note": "<one sentence>" },
    "headline_to_subheadline":  { "aligned": <true/false>, "note": "<one sentence>" },
    "body_to_headline":         { "aligned": <true/false>, "note": "<one sentence>" },
    "benefits_to_headline":     { "aligned": <true/false>, "note": "<one sentence>" },
    "cta_to_offer":             { "aligned": <true/false>, "note": "<one sentence>" },
    "trust_signals_to_claim":   { "aligned": <true/false>, "note": "<one sentence>" },
    "incoherence_summary": "<one sentence: primary mismatch that contributed to failure, or 'No incoherence detected'>",
    "fix": "<one sentence: what the congruence failure reveals about creative architecture mistakes in this category>"
  }
}`

function buildRedditBlock(topic: string, posts: RedditPost[]): string {
  const postLines = posts.map((p, i) =>
    `Post ${i + 1}: "${p.title}"\nURL: ${p.url}\nSnippet: "${p.snippet}"`
  ).join('\n\n')

  return `--- Reddit research: real people describing "${topic}" ---
${postLines}

Reddit analysis instructions:
1. Identify 2–3 situation patterns from how these people describe their experience (use their language verbatim, not paraphrased).
2. Check whether the ad's headline, subheadline, body, benefits, and CTA are congruent with how real people describe this situation.
3. Propose one specific visual concept grounded in these Reddit descriptions — state who is shown, the setting, the physical/emotional detail.
4. In source_urls: include ONLY exact URLs from the list above. Do not modify. Do not add URLs not in this list.`
}

function buildRedditSchema(posts: RedditPost[]): string {
  const urlList = posts.map(p => `"${p.url}"`).join(', ')
  return `,
  "reddit_research": {
    "topic": "<topic string>",
    "posts_found": [{ "title": "<title>", "url": "<exact url from: ${urlList}>", "snippet": "<first 100 chars>" }],
    "situation_patterns": ["<pattern in real people's exact language>", "<pattern 2>"],
    "congruence_with_reddit": { "verdict": "<aligned|partial|misaligned>", "note": "<one sentence>" },
    "visual_ideation": {
      "concept": "<specific visual scene: who, where, what, emotional state>",
      "rationale": "<one sentence: grounded in which Reddit insight>",
      "source_urls": ["<one of: ${urlList}>"]
    }
  }`
}

function buildComprehensiveVisionPrompt(
  roiAverages: ROIAverage[],
  patternContext: string,
  confirmedElements?: ExtractedElements,
  redditPosts?: RedditPost[],
  conceptTopic?: string,
  mode?: string,
  spendUsd?: number,
): string {
  const scoreLines = roiAverages
    .map(r => `- ${r.label} (${r.region_key}): ${r.activation.toFixed(3)}`)
    .join('\n')

  const redditSection = (redditPosts && redditPosts.length > 0 && conceptTopic)
    ? `\n${buildRedditBlock(conceptTopic, redditPosts)}\n`
    : ''

  const isLoser = mode === 'historical' && spendUsd !== undefined && spendUsd < WINNER_THRESHOLD_USD
  const isWinner = mode === 'historical' && !isLoser

  const baseSchema = isLoser ? COMPREHENSIVE_JSON_SCHEMA_LOSER
    : isWinner ? COMPREHENSIVE_JSON_SCHEMA_HISTORICAL
    : COMPREHENSIVE_JSON_SCHEMA

  const schema = (redditPosts && redditPosts.length > 0 && conceptTopic)
    ? baseSchema.replace(/\n\}$/, `${buildRedditSchema(redditPosts)}\n}`)
    : baseSchema

  let preamble: string
  if (isWinner) {
    preamble = `You are a senior advertising strategist analyzing a confirmed winning ad. Your task is to understand WHY it worked — not to critique or suggest improvements. Write observations throughout: what is present, why it works for this audience, what structural choices reveal about effective creative architecture in this category.

FORBIDDEN — do not use these words or any directive grammar:
add, consider, should, remove, test, introduce, improve, increase, audit, expand, replace, darken, sharpen, push, bridge, would dramatically, would materially, would meaningfully, could be made, this could, try, ensure, must.

GOOD (observation — write like this):
"The headline is short and declarative; at high spend in a problem-aware vertical, this reveals the audience did not need a mechanism explained — the problem recognition alone was sufficient to hold attention."

BAD (directive — never write this):
"The headline is short. Consider adding a mechanism or benefit statement to increase specificity and improve conversion rate."

Every field that normally asks 'what to fix' now asks 'what does this reveal'. If you find yourself wanting to write 'add X', rewrite it as 'the absence of X reveals…'.`
  } else if (isLoser) {
    preamble = `You are a senior advertising strategist analyzing a confirmed underperforming ad ($${spendUsd} spend). This ad did not achieve meaningful distribution. Your task is to understand WHY it failed — what structural choices limited its reach, where the creative architecture broke down, and what the audience did not respond to.

FORBIDDEN — do not use these words or any directive grammar:
add, consider, should, remove, test, introduce, improve, increase, audit, expand, replace, darken, sharpen, push, bridge, would dramatically, would materially, would meaningfully, could be made, this could, try, ensure, must.

GOOD (observation of failure — write like this):
"The headline names a mechanism without establishing the problem first; at $${spendUsd} spend in a problem-aware vertical, this reveals the audience had not self-identified with the pain sufficiently for a mechanism-first approach to create urgency."

BAD (directive — never write this):
"The headline jumps to the mechanism. Add a problem-statement line above it to establish pain before introducing the solution."

Every field describes what IS present and what it reveals about why this ad failed to generate meaningful spend. If you find yourself wanting to write 'add X', rewrite it as 'the absence of X reveals why conversion stalled'.`
  } else {
    preamble = `You are a senior advertising strategist, media buyer, and neuroscience analyst reviewing a static ad image.`
  }

  const analysisInstruction = isWinner
    ? `Analyze this winning ad. Quote actual text, describe actual colors and layout, reference actual visual elements. Observations only — no improvement suggestions. Do not skip any section.`
    : isLoser
    ? `Analyze this underperforming ad. Quote actual text, describe actual colors and layout, reference actual visual elements. Failure analysis only — what broke down, not what to fix. Do not skip any section.`
    : `Analyze this ad image comprehensively. Quote actual text you see, describe actual colors and layout, reference actual visual elements. No generic feedback. Do not skip any section.`

  return `${preamble}
${confirmedElements ? `\n${buildConfirmedElementsBlock(confirmedElements)}\n` : ''}
Writing style: specific and direct — every word earns its place. No filler phrases. Detailed explanations in minimal words.

${FRAMEWORK_CONTEXT}
${patternContext ? `\n${patternContext}\n` : ''}
${redditSection}BERG brain activation scores:
${scoreLines}

${analysisInstruction}

Return a JSON object with EXACTLY this structure — no markdown fences, no extra keys:
${schema}

If pattern_matches is empty because no patterns are available, return [].`
}

async function runBergAnalysis(roiAverages: ROIAverage[], patternContext: string, visualDescription?: string, mode?: string, spendUsd?: number): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: buildBergPrompt(roiAverages, patternContext, visualDescription, mode, spendUsd) }],
  })
  const textBlock = message.content.find(b => b.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}

async function runComprehensiveVisionAnalysis(
  imageBase64: string,
  mimeType: string,
  roiAverages: ROIAverage[],
  patternContext: string,
  confirmedElements?: ExtractedElements,
  redditPosts?: RedditPost[],
  conceptTopic?: string,
  mode?: string,
  spendUsd?: number,
): Promise<Omit<ComprehensiveAnalysis, 'berg_recommendations'> | null> {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          { type: 'text', text: buildComprehensiveVisionPrompt(roiAverages, patternContext, confirmedElements, redditPosts, conceptTopic, mode, spendUsd) },
        ],
      }],
    })
    const textBlock = message.content.find(b => b.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function parseBergBullets(text: string): string[] {
  return text
    .split('\n')
    .filter(l => /^[-*]\s+/.test(l.trim()))
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
}

function emptyComprehensive(bergBullets: string[]): ComprehensiveAnalysis {
  return {
    copy: {
      headline: { text: '', clarity: 0, urgency: 0, relevance: 0, feedback: '' },
      subheadline: { text: '', supports_headline: false, clarity: 0, feedback: '' },
      benefits_features: { identified: [], clarity: 0, prominence: 0, feedback: '' },
      trust_signals: { identified: [], strength: 0, feedback: '' },
      safety_signals: { identified: [], strength: 0, feedback: '' },
      cta: { text: '', clarity: 0, placement: '', contrast: 0, feedback: '' },
    },
    behavioral_economics: {
      scarcity: { present: false, strength: 0, note: '' },
      urgency: { present: false, strength: 0, note: '' },
      social_proof: { present: false, strength: 0, note: '' },
      anchoring: { present: false, strength: 0, note: '' },
      loss_aversion: { present: false, strength: 0, note: '' },
      authority: { present: false, strength: 0, note: '' },
      reciprocity: { present: false, strength: 0, note: '' },
      overall_feedback: '',
    },
    neuroscience: { attention_prediction: '', emotional_encoding: '', memory_encoding: '', feedback: '' },
    visual_dimensions: {
      cta_strength: { score: 0, feedback: '' },
      emotional_appeal: { score: 0, feedback: '' },
      brand_clarity: { score: 0, feedback: '' },
      visual_hierarchy: { score: 0, feedback: '' },
    },
    berg_recommendations: bergBullets,
    pattern_matches: [],
    overall: { verdict: '', top_strength: '', critical_weakness: '', priority_fix: '' },
    market_context: { awareness_level: 'problem_aware', awareness_reasoning: '', sophistication_level: 1, sophistication_reasoning: '' },
    ad_format: {
      type: 'direct_response',
      composition: {
        has_headline: false, has_subheadline: false, has_body_copy: false,
        has_benefits_list: false, has_trust_signals: false, has_cta: false,
        has_price_or_offer: false, is_visual_dominant: true, is_text_heavy: false,
      },
      format_assessment: '',
    },
    hook_analysis: { scroll_stop_score: 0, pattern_interrupt: '', first_half_second: '', hook_feedback: '' },
    offer_architecture: {
      offer_present: false, offer_text: null,
      has_price_anchor: false, has_guarantee: false, has_urgency_mechanism: false, has_trial_or_free: false,
      perceived_value_score: 0, offer_clarity_score: 0, offer_feedback: '',
    },
    cognitive_load: { score: 0, density: 'minimal', overload_risk: '', simplification: '' },
    platform_fit: { optimised_for: [], weak_for: [], reasoning: '', adaptation_notes: '' },
    framework_score: {
      minimum_viable_test: 'fail',
      headline_leaves_gap: false, subheadline_justified: false, benefits_justified: false,
      trust_signal_justified: false, cta_justified: false,
      overall_framework_grade: 'D', framework_feedback: '',
    },
    congruence: {
      overall_score: 0,
      headline_to_visual: { aligned: false, note: '' },
      headline_to_subheadline: { aligned: false, note: '' },
      body_to_headline: { aligned: false, note: '' },
      benefits_to_headline: { aligned: false, note: '' },
      cta_to_offer: { aligned: false, note: '' },
      trust_signals_to_claim: { aligned: false, note: '' },
      incoherence_summary: '',
      fix: '',
    },
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const roi_averages: ROIAverage[] = body.roi_averages ?? []
  const image_base64: string | undefined = body.image_base64
  const mime_type: string = body.mime_type ?? 'image/jpeg'
  const spend_usd: number | undefined = body.spend_usd !== undefined ? Number(body.spend_usd) : undefined
  const analysis_id: string | undefined = body.analysis_id
  const confirmed_elements: ExtractedElements | undefined = body.confirmed_elements
  const concept_topic: string | undefined = body.concept_topic
  const mode: string | undefined = body.mode

  const [patterns, winningExamples, losingPatterns, redditPosts] = await Promise.all([
    getWinningPatterns(),
    getAllWinningAnalyses(),
    getLosingPatterns(),
    concept_topic ? fetchRedditPosts(concept_topic) : Promise.resolve(null),
  ])

  const patternContext = buildPatternContext(patterns, winningExamples, losingPatterns)
  const visualDescription = confirmed_elements?.visual_description

  let bergText: string
  let visionResult: Omit<ComprehensiveAnalysis, 'berg_recommendations'> | null
  try {
    ;[bergText, visionResult] = await Promise.all([
      runBergAnalysis(roi_averages, patternContext, visualDescription, mode, spend_usd),
      image_base64
        ? runComprehensiveVisionAnalysis(image_base64, mime_type, roi_averages, patternContext, confirmed_elements, redditPosts ?? undefined, concept_topic, mode, spend_usd)
        : Promise.resolve(null),
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Anthropic API error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const bergBullets = parseBergBullets(bergText)
  const comprehensive: ComprehensiveAnalysis = visionResult
    ? { ...visionResult, berg_recommendations: bergBullets }
    : emptyComprehensive(bergBullets)

  if (analysis_id) {
    await storeComprehensiveAnalysis(analysis_id, comprehensive as unknown as Record<string, unknown>, spend_usd)

    if (spend_usd !== undefined) {
      fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/analyze/synthesize-patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: analysis_id }),
      }).catch(() => { /* fire and forget */ })
    }
  }

  return NextResponse.json({ comprehensive })
}
