export const LOSS_REASONS = [
  'weak_hook',
  'no_offer',
  'no_proof',
  'wrong_audience',
  'saturated_pattern',
  'congruence_failure',
  'cognitive_overload',
  'weak_cta',
  'creative_fatigue',
  'audience_saturation',
  'targeting_mismatch',
  'landing_page_failure',
  'tracking_loss',
  'paused_too_early',
  'seasonality',
  'other',
] as const

export type LossReason = typeof LOSS_REASONS[number]

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  weak_hook: 'Weak hook',
  no_offer: 'No / unclear offer',
  no_proof: 'No proof or trust signal',
  wrong_audience: 'Wrong audience match',
  saturated_pattern: 'Saturated pattern',
  congruence_failure: 'Congruence failure',
  cognitive_overload: 'Cognitive overload',
  weak_cta: 'Weak CTA',
  creative_fatigue: 'Creative fatigue (CTR decay)',
  audience_saturation: 'Audience saturation',
  targeting_mismatch: 'Targeting mismatch',
  landing_page_failure: 'Landing page failure',
  tracking_loss: 'Tracking / attribution loss',
  paused_too_early: 'Paused too early',
  seasonality: 'Seasonality',
  other: 'Other',
}
