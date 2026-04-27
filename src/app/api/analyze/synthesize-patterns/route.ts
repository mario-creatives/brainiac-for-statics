import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getRecentWinnersForSynthesis, upsertPatterns } from '@/lib/pattern-library'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const anthropic = new Anthropic({ timeout: 120000 })

function buildWinnerSummary(ca: ComprehensiveAnalysis, spendUsd: number): string {
  const headline = ca.copy?.headline?.text || 'n/a'
  const cta = ca.copy?.cta?.text || 'n/a'
  const trustSignals = ca.copy?.trust_signals?.identified?.join(', ') || 'none'
  const safetySignals = ca.copy?.safety_signals?.identified?.join(', ') || 'none'
  const activeBE = Object.entries(ca.behavioral_economics ?? {})
    .filter(([k, v]) => k !== 'overall_feedback' && (v as { present?: boolean }).present)
    .map(([k]) => k)
    .join(', ') || 'none'
  const topROI = (ca.berg_recommendations ?? []).slice(0, 2).join(' | ')
  const verdict = ca.overall?.verdict?.slice(0, 150) || ''
  const vdScore = ca.visual_dimensions?.visual_hierarchy?.score ?? 0
  const eaScore = ca.visual_dimensions?.emotional_appeal?.score ?? 0

  return `$${spendUsd} spend | headline="${headline}" | CTA="${cta}" | trust: ${trustSignals} | safety: ${safetySignals} | BE active: ${activeBE} | visual_hierarchy=${vdScore}/10 | emotional_appeal=${eaScore}/10 | BERG: ${topROI} | verdict: ${verdict}`
}

export async function POST(_req: NextRequest) {
  const winners = await getRecentWinnersForSynthesis(20)
  if (winners.length < 2) {
    return NextResponse.json({ skipped: true, reason: 'not enough winners yet', count: winners.length })
  }

  const summaries = winners
    .map(w => buildWinnerSummary(w.comprehensive_analysis as unknown as ComprehensiveAnalysis, w.spend_usd))
    .map((s, i) => `Winner ${i + 1}: ${s}`)
    .join('\n')

  const prompt = `You are analyzing ${winners.length} winning ads (each with $1000+ spend) to extract transferable creative principles.

Here are the winning ad summaries:
${summaries}

Extract 5–8 specific, transferable rules that appear across multiple winners. Focus on patterns that are actionable and concrete — not generic best practices.

Return ONLY a JSON array with no markdown fences:
[
  { "category": "visual|copy|behavioral|neuroscience", "rule_text": "<specific actionable rule>", "confidence": <0.0-1.0> }
]

Rules should be specific enough to be useful for evaluating a new ad. Confidence should reflect how many of the ${winners.length} winners support the rule (1.0 = all winners, 0.5 = half).`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { category: string; rule_text: string; confidence: number }[]

    await upsertPatterns(parsed)

    return NextResponse.json({ synthesized: parsed.length, winner_count: winners.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
