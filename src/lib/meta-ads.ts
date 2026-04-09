// Meta Graph API helpers for pulling ad creatives and performance signals.
// Called from API routes that have already validated auth + consent.

import { createHmac, randomBytes } from 'crypto'
import { supabaseServer } from '@/lib/supabase-server'
import { decrypt } from '@/lib/encryption'

const META_API_VERSION = 'v19.0'
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export const META_SCOPES = ['ads_read', 'ads_management']

// ─── CSRF state token ─────────────────────────────────────────────────────────

export function generateStateToken(userId: string): string {
  const nonce = randomBytes(16).toString('hex')
  const payload = `${userId}:${nonce}`
  const sig = createHmac('sha256', process.env.ENCRYPTION_KEY ?? '')
    .update(payload)
    .digest('hex')
  return Buffer.from(`${payload}:${sig}`).toString('base64url')
}

export function verifyStateToken(state: string): string {
  const decoded = Buffer.from(state, 'base64url').toString('utf8')
  const parts = decoded.split(':')
  if (parts.length !== 3) throw new Error('Invalid state token')
  const [userId, nonce, sig] = parts
  const expectedSig = createHmac('sha256', process.env.ENCRYPTION_KEY ?? '')
    .update(`${userId}:${nonce}`)
    .digest('hex')
  if (sig !== expectedSig) throw new Error('State token signature mismatch')
  return userId
}

// ─── OAuth URL ────────────────────────────────────────────────────────────────

export function buildMetaOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? '',
    redirect_uri: process.env.META_REDIRECT_URI ?? '',
    scope: META_SCOPES.join(','),
    state,
    response_type: 'code',
  })
  return `https://www.facebook.com/dialog/oauth?${params}`
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeMetaCode(
  code: string
): Promise<{ access_token: string; expires_at: string | null }> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? '',
    client_secret: process.env.META_APP_SECRET ?? '',
    redirect_uri: process.env.META_REDIRECT_URI ?? '',
    code,
  })

  const res = await fetch(`${META_BASE}/oauth/access_token?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`Meta token exchange failed: ${JSON.stringify(body)}`)
  }

  const data = await res.json()
  const expires_at = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null

  return { access_token: data.access_token, expires_at }
}

// ─── Pull creatives ───────────────────────────────────────────────────────────

export async function pullAdCreatives(
  connectedAccountId: string
): Promise<Array<{ creative_id: string; image_bytes: Buffer; platform_name: string }>> {
  const { data: account } = await supabaseServer
    .from('connected_accounts')
    .select('*')
    .eq('id', connectedAccountId)
    .single()

  if (!account) throw new Error('Connected account not found')

  const token = decrypt(account.access_token_encrypted)
  const accountId = account.platform_account_id

  const params = new URLSearchParams({
    fields: 'id,name,creative{id,image_url,thumbnail_url}',
    effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
    access_token: token,
    limit: '50',
  })

  const res = await fetch(`${META_BASE}/act_${accountId}/ads?${params}`)
  if (!res.ok) throw new Error(`Meta ads fetch failed: ${res.status}`)

  const { data: ads = [] } = await res.json()
  const results: Array<{ creative_id: string; image_bytes: Buffer; platform_name: string }> = []

  for (const ad of ads) {
    const creative = ad.creative ?? {}
    const imageUrl: string | undefined = creative.image_url ?? creative.thumbnail_url
    if (!imageUrl) continue

    try {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) continue
      const image_bytes = Buffer.from(await imgRes.arrayBuffer())
      results.push({
        creative_id: creative.id,
        image_bytes,
        platform_name: ad.name ?? creative.id,
      })
    } catch {
      continue
    }
  }

  // Update last_synced_at
  await supabaseServer
    .from('connected_accounts')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', connectedAccountId)

  return results
}

// ─── Pull performance signals ─────────────────────────────────────────────────

export async function pullPerformanceSignals(
  platformCreativeId: string,
  adCreativeId: string,
  analysisId: string,
  token: string
): Promise<void> {
  const params = new URLSearchParams({
    fields: 'impressions,clicks,ctr,spend,cpm',
    access_token: token,
  })

  const res = await fetch(`${META_BASE}/${platformCreativeId}/insights?${params}`)
  if (!res.ok) return // Graceful skip — performance data is supplementary

  const { data = [] } = await res.json()
  const d = data[0] ?? {}

  await supabaseServer.from('creative_performance').insert({
    ad_creative_id: adCreativeId,
    analysis_id: analysisId,
    platform: 'meta_ads',
    impressions: parseInt(d.impressions ?? '0', 10),
    clicks: parseInt(d.clicks ?? '0', 10),
    ctr: parseFloat(d.ctr ?? '0'),
    spend_usd: parseFloat(d.spend ?? '0'),
    cpm: parseFloat(d.cpm ?? '0'),
  })
}
