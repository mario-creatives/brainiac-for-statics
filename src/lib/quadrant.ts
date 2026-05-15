export type Quadrant = 'winner' | 'promising' | 'investigate' | 'loser'

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  winner: 'Winner',
  promising: 'Promising',
  investigate: 'Investigate',
  loser: 'Loser',
}

export const DEFAULT_WINNER_SPEND_THRESHOLD_USD = 1000

// Returns the deterministic 4-quadrant classification.
// With CPA + target available: full 4-way split.
// Without CPA: spend-only fallback (matches legacy is_winner semantics).
//
// winnerSpendThreshold is per-product (L1 of the audit). Pass it in from the
// product record. When absent, the legacy $1k threshold applies.
export function computeQuadrant(
  spend: number | null,
  cpa: number | null,
  targetCpa: number | null,
  winnerSpendThreshold: number = DEFAULT_WINNER_SPEND_THRESHOLD_USD,
): Quadrant | null {
  if (spend == null) return null
  const threshold = winnerSpendThreshold > 0 ? winnerSpendThreshold : DEFAULT_WINNER_SPEND_THRESHOLD_USD
  const hasCpa = cpa != null && targetCpa != null && targetCpa > 0
  if (hasCpa) {
    const hitsCpa = cpa! <= targetCpa!
    const bigSpend = spend >= threshold
    if (bigSpend && hitsCpa) return 'winner'
    if (!bigSpend && hitsCpa) return 'promising'
    if (bigSpend && !hitsCpa) return 'investigate'
    return 'loser'
  }
  return spend >= threshold ? 'winner' : 'loser'
}

export function effectiveQuadrant(row: {
  quadrant: Quadrant | null
  quadrant_override: Quadrant | null
}): Quadrant | null {
  return row.quadrant_override ?? row.quadrant
}

// Latest CTR < 70% of earliest CTR across ≥ 2 snapshots → fatigue.
// History must arrive in ascending recorded_at order.
export function detectFatigue(
  history: { recorded_at: string; ctr_pct: number | null }[],
): boolean {
  const ctrs = history.map(h => h.ctr_pct).filter((v): v is number => v != null && v > 0)
  if (ctrs.length < 2) return false
  const earliest = ctrs[0]
  const latest = ctrs[ctrs.length - 1]
  return latest < earliest * 0.7
}
