import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'
import { keepAliveStream } from '@/lib/streaming'
import { parseClaudeJson } from '@/lib/parseClaudeJson'
import { getAllWinnersForSynthesis, getAllLosersForSynthesis } from '@/lib/pattern-library'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'
import { buildAdSummary } from '@/app/api/analyze/synthesize-patterns/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const anthropic = new Anthropic({ timeout: 280000 })

export interface CopyIntelligenceSection {
  finding: string
  dos: string[]
  donts: string[]
  examples?: string[]
}

export interface CopyIntelligenceReport {
  generated_at: string
  winners_analyzed: number
  losers_analyzed: number
  headline: CopyIntelligenceSection
  subheadline: CopyIntelligenceSection
  benefits: CopyIntelligenceSection
  cta: CopyIntelligenceSection
  combinations: {
    finding: string
    winning_stacks: string[]
    losing_stacks: string[]
  }
  behavioral_economics: {
    finding: string
    top_levers: string[]
    weak_levers: string[]
  }
  dos: string[]
  donts: string[]
  winning_formula: string
  notable_examples: {
    headline: string
    spend: number
    why: string
  }[]
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return keepAliveStream(async () => {
    const [winners, losers] = await Promise.all([
      getAllWinnersForSynthesis(),
      getAllLosersForSynthesis(),
    ])

    if (winners.length + losers.length < 3) {
      return {
        insufficient_data: true,
        winners_count: winners.length,
        losers_count: losers.length,
        needed: 3 - (winners.length + losers.length),
      }
    }

    const winnerSummaries = winners.map((w, i) =>
      `WINNER W${i + 1} ($${w.spend_usd} spend):\n${buildAdSummary(w.comprehensive_analysis as unknown as ComprehensiveAnalysis, w.spend_usd)}`
    )
    const loserSummaries = losers.map((l, i) =>
      `LOSER L${i + 1} ($${l.spend_usd} spend):\n${buildAdSummary(l.comprehensive_analysis as unknown as ComprehensiveAnalysis, l.spend_usd, l.loss_reason as Parameters<typeof buildAdSummary>[2])}`
    )

    // Notable winners for example section
    const topWinners = [...winners]
      .sort((a, b) => b.spend_usd - a.spend_usd)
      .slice(0, 5)
      .map(w => ({
        headline: (w.comprehensive_analysis as unknown as ComprehensiveAnalysis)?.copy?.headline?.text ?? '',
        spend: w.spend_usd,
      }))

    const prompt = `You are a world-class direct-response copywriting strategist. You have access to a complete database of winning and losing static ad creatives from one advertising account. Your job is to synthesize all this data into a definitive, account-specific copywriting playbook.

WINNING ADS (${winners.length} total, all crossed $1,000 spend):
${winnerSummaries.join('\n\n')}

LOSING ADS (${losers.length} total, all stayed below $1,000 spend):
${loserSummaries.join('\n\n')}

TOP WINNERS BY SPEND (for notable examples):
${topWinners.map(w => `"${w.headline}" — $${w.spend} spend`).join('\n')}

Analyze this data exhaustively. Your output is a copywriting guide for THIS SPECIFIC ACCOUNT based entirely on their actual performance data — not generic copywriting advice. Every claim must be grounded in patterns you can see in the data above.

Return ONLY a JSON object (no markdown fences) matching this structure exactly:
{
  "headline": {
    "finding": "<2-3 sentences: what headline patterns dominate among winners vs losers — structure types, word counts, emotional registers, specificity levels>",
    "dos": ["<specific, actionable do — e.g. 'Use pain_agitation structure with direct voice for problem_aware segments'>", ...],
    "donts": ["<specific, actionable don't>", ...],
    "examples": ["<best headline from winners with explanation of why it works>", ...]
  },
  "subheadline": {
    "finding": "<2-3 sentences: when winners include a subheadline vs omit it, what role it plays>",
    "dos": ["...", ...],
    "donts": ["...", ...]
  },
  "benefits": {
    "finding": "<2-3 sentences: benefit count, outcome vs feature framing, specificity level patterns>",
    "dos": ["...", ...],
    "donts": ["...", ...]
  },
  "cta": {
    "finding": "<2-3 sentences: CTA verb patterns, friction levels, framing that wins vs loses>",
    "dos": ["...", ...],
    "donts": ["...", ...]
  },
  "combinations": {
    "finding": "<2-3 sentences: which element stacks (composition_tags) appear in winners vs losers — this is the most important structural signal>",
    "winning_stacks": ["<composition_tag> — <why it wins, how many winners use it>", ...],
    "losing_stacks": ["<composition_tag> — <why it loses, how many losers use it>", ...]
  },
  "behavioral_economics": {
    "finding": "<2 sentences: which BE levers are present in winners vs absent in losers>",
    "top_levers": ["<lever name> — <how it manifests in winners>", ...],
    "weak_levers": ["<lever name> — <why it doesn't correlate with wins here>", ...]
  },
  "dos": [
    "<account-wide rule #1 — most important, most evidence>",
    "<account-wide rule #2>",
    "<account-wide rule #3>",
    "<account-wide rule #4>",
    "<account-wide rule #5>",
    "<account-wide rule #6>",
    "<account-wide rule #7>",
    "<account-wide rule #8>"
  ],
  "donts": [
    "<account-wide anti-rule #1>",
    "<account-wide anti-rule #2>",
    "<account-wide anti-rule #3>",
    "<account-wide anti-rule #4>",
    "<account-wide anti-rule #5>",
    "<account-wide anti-rule #6>",
    "<account-wide anti-rule #7>",
    "<account-wide anti-rule #8>"
  ],
  "winning_formula": "<2-3 sentences synthesizing: for THIS account, a winning static ad typically looks like X. The combination of Y and Z is what separates winners from losers. The single most important thing this account must do is W.>",
  "notable_examples": [
    {
      "headline": "<exact headline text from the data>",
      "spend": <number>,
      "why": "<one sentence: the specific structural reason this ad spent well — cite DNA, combination, BE lever>"
    }
  ]
}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''
    const report = parseClaudeJson<CopyIntelligenceReport>(raw)

    return {
      ...report,
      generated_at: new Date().toISOString(),
      winners_analyzed: winners.length,
      losers_analyzed: losers.length,
    }
  })
}
