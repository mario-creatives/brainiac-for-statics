import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { keepAliveStream } from '@/lib/streaming'
import Anthropic from '@anthropic-ai/sdk'
import {
  getWinningPatterns,
  getAllWinningAnalyses,
  getLosingPatterns,
  getAllLosersForSynthesis,
  getFrameworkPrinciples,
  getLatestBaselineEvolution,
  storeComprehensiveAnalysis,
  enqueueSynthesis,
} from '@/lib/pattern-library'
import { buildPatternContext, buildComprehensiveVisionPrompt, parseBergBullets, runBergAnalysis } from '../comprehensive/route'
import type { ComprehensiveAnalysis, StatedAudience } from '../comprehensive/route'
import type { ExtractedElements, HeadlineDNA, SubheadlineDNA, TrustDNA, CtaDNA } from '../extract-elements/route'
import { parseClaudeJson } from '@/lib/parseClaudeJson'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const anthropic = new Anthropic({ timeout: 280000 })

/** Derive a composition_tag from which elements are actually present. */
function deriveCompositionTag(ca: ComprehensiveAnalysis): string {
  const hasHeadline = !!ca.copy?.headline?.text
  const hasSub = !!(ca.copy?.subheadline?.text && ca.copy.subheadline.text !== 'absent')
  const hasBenefits = (ca.copy?.benefits_features?.identified?.length ?? 0) > 0
  const hasTrust = (ca.copy?.trust_signals?.identified?.length ?? 0) > 0
  const hasCta = !!ca.copy?.cta?.text
  const hasOffer = !!ca.offer_architecture?.offer_text

  if (!hasHeadline) return 'visual_only'
  const slots = ['headline']
  if (hasSub) slots.push('sub')
  if (hasBenefits) slots.push('benefits')
  if (hasTrust) slots.push('trust')
  if (hasCta) slots.push('cta')
  if (hasOffer) slots.push('offer')
  if (slots.length === 1) return 'headline_only'
  if (slots.length >= 6) return 'full_stack'
  return slots.join('+')
}

/** Reconstruct an ExtractedElements object from a stored ComprehensiveAnalysis.
 *  Used for re-analysis when the original image is no longer available. */
function reconstructFromComprehensive(ca: ComprehensiveAnalysis): ExtractedElements {
  return {
    headline: ca.copy?.headline?.text ?? null,
    subheadline: ca.copy?.subheadline?.text || null,
    body_copy: null,
    benefits: ca.copy?.benefits_features?.identified ?? [],
    trust_signals: ca.copy?.trust_signals?.identified ?? [],
    safety_signals: ca.copy?.safety_signals?.identified ?? [],
    proof_signals: ca.copy?.proof_signals?.identified ?? [],
    cta: ca.copy?.cta?.text ?? null,
    offer_details: ca.offer_architecture?.offer_text ?? null,
    visual_description: '',
    ad_format_guess: ca.ad_format?.type ?? '',
    vertical_category: 'other',
    headline_dna: (ca.copy?.headline?.dna as HeadlineDNA | null | undefined) ?? null,
    subheadline_dna: (ca.copy?.subheadline?.dna as SubheadlineDNA | null | undefined) ?? null,
    body_dna: ca.body_dna ?? null,
    benefits_dna: (ca.copy?.benefits_features?.dna as ExtractedElements['benefits_dna']) ?? null,
    trust_dna: (ca.copy?.trust_signals?.dna as TrustDNA | null | undefined) ?? null,
    cta_dna: (ca.copy?.cta?.dna as CtaDNA | null | undefined) ?? null,
    // Prefer the stored tag; fall back to deriving from present elements so
    // old analyses that pre-date composition_tag get a proper value.
    composition_tag: ca.composition_tag || deriveCompositionTag(ca),
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.analysis_id) return NextResponse.json({ error: 'analysis_id required' }, { status: 400 })

  const analysisId: string = body.analysis_id

  // Fetch the stored analysis — owned by this user only.
  const { data: row, error: fetchErr } = await supabaseServer
    .from('analyses')
    .select('id, user_id, comprehensive_analysis, roi_data, spend_usd, is_winner, quadrant, quadrant_override, status, input_storage_key, product_id, stated_concept, stated_angle')
    .eq('id', analysisId)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !row) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })

  const existingCa = row.comprehensive_analysis as unknown as ComprehensiveAnalysis | null
  const isFailed = !existingCa

  // For failed ads (no prior comprehensive_analysis), we need the original image.
  if (isFailed) {
    const storageKey = row.input_storage_key as string | null
    if (!storageKey) {
      return NextResponse.json(
        { error: 'No original image saved — please delete this ad and re-upload' },
        { status: 400 },
      )
    }
  }

  const roiAverages = (row.roi_data as unknown as Array<{ region_key: string; label: string; description: string; activation: number }>) ?? []
  const spendUsd: number | undefined = row.spend_usd ?? undefined
  const effectiveQuadrant = ((row.quadrant_override as string | null) ?? (row.quadrant as string | null)) ?? null
  const confirmedElements = existingCa ? reconstructFromComprehensive(existingCa) : undefined

  // Concurrent-run guard. Atomically claim the row by setting
  // reanalyze_locked_at = NOW() only if it's null or stale (>5 min). Two
  // tabs hitting bulk re-analyze on the same account end up serialized:
  // the loser gets a 409 for this analysis and the bulk loop moves on.
  const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000
  const staleCutoff = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS).toISOString()
  const { data: claimed } = await supabaseServer
    .from('analyses')
    .update({ reanalyze_locked_at: new Date().toISOString() })
    .eq('id', analysisId)
    .or(`reanalyze_locked_at.is.null,reanalyze_locked_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return NextResponse.json({ error: 'Re-analysis already in progress for this ad' }, { status: 409 })
  }

  async function release() {
    await supabaseServer
      .from('analyses')
      .update({ reanalyze_locked_at: null })
      .eq('id', analysisId)
  }

  return keepAliveStream(async () => {
    try {
    const [patterns, winningExamples, losingPatterns, losingExamples, frameworkPrinciples, evolvedBaseline] = await Promise.all([
      getWinningPatterns(),
      getAllWinningAnalyses(),
      getLosingPatterns(),
      getAllLosersForSynthesis(),
      getFrameworkPrinciples(),
      getLatestBaselineEvolution(),
    ])

    const patternContext = buildPatternContext(patterns, winningExamples, losingPatterns, losingExamples, frameworkPrinciples, evolvedBaseline?.created_at ?? null)
    const mode = spendUsd !== undefined ? 'historical' : 'feedback'

    // For failed ads (no prior comprehensive_analysis): download the original
    // image from storage and run the full vision pipeline from scratch.
    let imageBase64: string | null = null
    let mimeType = 'image/jpeg'
    if (isFailed) {
      const storageKey = row.input_storage_key as string
      const { data: blob, error: dlErr } = await supabaseServer.storage
        .from('creatives')
        .download(storageKey)
      if (dlErr || !blob) throw new Error('Failed to download original image from storage')
      const buffer = await blob.arrayBuffer()
      imageBase64 = Buffer.from(buffer).toString('base64')
      if (storageKey.endsWith('.png')) mimeType = 'image/png'
      else if (storageKey.endsWith('.webp')) mimeType = 'image/webp'
      // Mark in-progress so the status cell shows something while we run
      await supabaseServer.from('analyses').update({ status: 'processing' }).eq('id', analysisId)
    }

    // Build statedAudience from per-ad values, falling back to product defaults.
    let statedAudience: StatedAudience | null = null
    {
      const productId = row.product_id as string | null
      const adRow = row as unknown as { stated_concept: string | null; stated_angle: string | null }
      const statedConcept = adRow.stated_concept ?? null
      const statedAngle = adRow.stated_angle ?? null

      let productTam: string | null = null
      let productPersona: string | null = null
      let productMicro: string | null = null
      let productConcept: string | null = null
      let productAngle: string | null = null
      if (productId) {
        const { data: prod } = await supabaseServer
          .from('products')
          .select('tam, default_persona, default_micro_persona, default_concept, default_angle')
          .eq('id', productId)
          .maybeSingle()
        productTam = (prod?.tam as string | null) ?? null
        productPersona = (prod?.default_persona as string | null) ?? null
        productMicro = (prod?.default_micro_persona as string | null) ?? null
        productConcept = (prod?.default_concept as string | null) ?? null
        productAngle = (prod?.default_angle as string | null) ?? null
      }

      if (productTam || productPersona || statedConcept || statedAngle || productConcept || productAngle) {
        statedAudience = {
          tam: productTam,
          persona: productPersona,
          micro_persona: productMicro,
          concept: statedConcept ?? productConcept,
          angle: statedAngle ?? productAngle,
        }
      }
    }

    const visualDescription = confirmedElements?.visual_description
    const [bergText, visionResult] = await Promise.all([
      runBergAnalysis(roiAverages, patternContext, visualDescription, mode, spendUsd, effectiveQuadrant),
      (async () => {
        const prompt = buildComprehensiveVisionPrompt(roiAverages, patternContext, confirmedElements, mode, spendUsd, evolvedBaseline, effectiveQuadrant, statedAudience)
        const content: Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'] = imageBase64
          ? [
              { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: imageBase64 } },
              { type: 'text', text: prompt },
            ]
          : prompt
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 32000,
          messages: [{ role: 'user', content }],
        })
        const textBlock = message.content.find(b => b.type === 'text')
        const raw = textBlock?.type === 'text' ? textBlock.text : ''
        return parseClaudeJson<Omit<ComprehensiveAnalysis, 'berg_recommendations'>>(raw)
      })(),
    ])

    const bergBullets = parseBergBullets(bergText)
    const comprehensive: ComprehensiveAnalysis = { ...visionResult, berg_recommendations: bergBullets }

    await storeComprehensiveAnalysis(analysisId, comprehensive as unknown as Record<string, unknown>, spendUsd)

    // For ads that were previously failed, mark complete and clear error_message.
    if (isFailed) {
      await supabaseServer
        .from('analyses')
        .update({ status: 'complete', error_message: null })
        .eq('id', analysisId)
      // Auto-populate audience hierarchy from the fresh inference.
      if (comprehensive.audience_inference) {
        const productId = row.product_id as string | null
        if (productId) {
          const { autoPopulateFromInference } = await import('@/lib/audience-auto-populate')
          await autoPopulateFromInference(analysisId, productId, comprehensive.audience_inference).catch(() => {})
        }
      }
    }

    if (spendUsd !== undefined) {
      await enqueueSynthesis(analysisId)
      fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/analyze/synthesize-patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {})
    }

      return { comprehensive }
    } finally {
      await release()
    }
  })
}
