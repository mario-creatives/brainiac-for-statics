import { supabaseServer } from '@/lib/supabase-server'
import type { ConsentType } from '@/types'

export const CURRENT_LEGAL_VERSION = process.env.CURRENT_LEGAL_VERSION ?? '1.0.0'

export const REQUIRED_CONSENTS: ConsentType[] = [
  'terms_of_service',
  'privacy_policy',
  'data_aggregation',
]

export async function hasRequiredConsents(userId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from('user_consents')
    .select('consent_type, legal_version')
    .eq('user_id', userId)
    .in('consent_type', REQUIRED_CONSENTS)
    .eq('legal_version', CURRENT_LEGAL_VERSION)

  if (error || !data) return false

  const given = new Set(data.map(c => c.consent_type))
  return REQUIRED_CONSENTS.every(r => given.has(r))
}

export async function hasConsent(userId: string, type: ConsentType): Promise<boolean> {
  const { data } = await supabaseServer
    .from('user_consents')
    .select('id')
    .eq('user_id', userId)
    .eq('consent_type', type)
    .eq('legal_version', CURRENT_LEGAL_VERSION)
    .limit(1)
    .single()

  return !!data
}

export async function recordConsents(
  userId: string,
  consentTypes: ConsentType[],
  ipAddress: string | null,
  userAgent: string | null
): Promise<void> {
  const rows = consentTypes.map(consent_type => ({
    user_id: userId,
    consent_type,
    ip_address: ipAddress,
    user_agent: userAgent,
    legal_version: CURRENT_LEGAL_VERSION,
  }))

  await supabaseServer.from('user_consents').insert(rows)
}
