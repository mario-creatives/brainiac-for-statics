import { supabaseServer } from '@/lib/supabase-server'

export const WINNER_THRESHOLD_USD = 1000

export interface PatternLibraryRow {
  id: string
  category: 'visual' | 'copy' | 'behavioral' | 'neuroscience'
  rule_text: string
  confidence: number
  winner_count: number
  created_at: string
  updated_at: string
}

export interface WinningAnalysisSummary {
  id: string
  comprehensive_analysis: Record<string, unknown>
  spend_usd: number
}

export async function getWinningPatterns(limit = 8): Promise<PatternLibraryRow[]> {
  const { data, error } = await supabaseServer
    .from('pattern_library')
    .select('*')
    .order('confidence', { ascending: false })
    .order('winner_count', { ascending: false })
    .limit(limit)

  if (error) return []
  return (data ?? []) as PatternLibraryRow[]
}

export async function getRecentWinningAnalyses(limit = 3): Promise<WinningAnalysisSummary[]> {
  const { data, error } = await supabaseServer
    .from('analyses')
    .select('id, comprehensive_analysis, spend_usd')
    .eq('is_winner', true)
    .not('comprehensive_analysis', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return []
  return (data ?? []) as WinningAnalysisSummary[]
}

export async function storeComprehensiveAnalysis(
  analysisId: string,
  data: Record<string, unknown>,
  spendUsd?: number,
): Promise<void> {
  const update: Record<string, unknown> = { comprehensive_analysis: data }
  if (spendUsd !== undefined) update.spend_usd = spendUsd

  await supabaseServer
    .from('analyses')
    .update(update)
    .eq('id', analysisId)
}

export async function getRecentWinnersForSynthesis(limit = 20): Promise<WinningAnalysisSummary[]> {
  const { data, error } = await supabaseServer
    .from('analyses')
    .select('id, comprehensive_analysis, spend_usd')
    .eq('is_winner', true)
    .not('comprehensive_analysis', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return []
  return (data ?? []) as WinningAnalysisSummary[]
}

export async function upsertPatterns(
  patterns: { category: string; rule_text: string; confidence: number }[],
): Promise<void> {
  for (const p of patterns) {
    const { data: existing } = await supabaseServer
      .from('pattern_library')
      .select('id, winner_count')
      .ilike('rule_text', p.rule_text.slice(0, 60) + '%')
      .limit(1)
      .maybeSingle()

    if (existing) {
      await supabaseServer
        .from('pattern_library')
        .update({
          confidence: p.confidence,
          winner_count: (existing.winner_count ?? 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabaseServer.from('pattern_library').insert({
        category: p.category,
        rule_text: p.rule_text,
        confidence: p.confidence,
        winner_count: 1,
      })
    }
  }
}
