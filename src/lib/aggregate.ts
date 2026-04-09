// Writes anonymized aggregate signal after a completed analysis with performance data.
// No user_id. No creative_id. No storage key. Pure signal.

import { supabaseServer } from '@/lib/supabase-server'
import type { Analysis, CreativePerformance, ROIRegion } from '@/types'

// Platform average CTRs for performance bucketing (rough industry benchmarks)
const PLATFORM_AVG_CTR: Record<string, number> = {
  meta_ads: 0.009, // ~0.9%
  google_ads: 0.02,
  tiktok_ads: 0.01,
}

function classifyBucket(
  ctr: number,
  platform: string
): 'top_quartile' | 'upper_mid' | 'lower_mid' | 'bottom_quartile' {
  const avg = PLATFORM_AVG_CTR[platform] ?? 0.01
  if (ctr >= avg * 2) return 'top_quartile'
  if (ctr >= avg) return 'upper_mid'
  if (ctr >= avg * 0.5) return 'lower_mid'
  return 'bottom_quartile'
}

function anonymizeROIData(roiData: ROIRegion[]): Record<string, number> {
  // Strip labels/descriptions — keep only region_key → activation score
  const out: Record<string, number> = {}
  for (const r of roiData) {
    out[r.region_key] = r.activation
  }
  return out
}

export async function writeAggregateSignal(
  analysis: Analysis,
  performance: CreativePerformance
): Promise<void> {
  if (!analysis.roi_data || analysis.mean_top_roi_score === null) return

  const bucket = classifyBucket(performance.ctr, performance.platform)
  const roi_breakdown = anonymizeROIData(analysis.roi_data)

  await supabaseServer.from('aggregate_signals').insert({
    creative_type: analysis.type,
    platform: performance.platform,
    niche_tag: null, // Phase 2: user-provided niche tagging
    mean_top_roi_score: analysis.mean_top_roi_score,
    roi_breakdown,
    performance_bucket: bucket,
  })
}
