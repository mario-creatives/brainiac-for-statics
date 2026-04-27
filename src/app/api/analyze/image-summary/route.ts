import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

interface ROIAverage {
  region_key: string
  label: string
  description: string
  activation: number
}

const anthropic = new Anthropic()

export interface VisualAdAnalysis {
  cta_strength: { score: number; feedback: string }
  emotional_appeal: { score: number; feedback: string }
  brand_clarity: { score: number; feedback: string }
  visual_hierarchy: { score: number; feedback: string }
  overall_verdict: string
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildPrompt(body: Record<string, unknown>, hasImage: boolean): string {
  const context = body.context as string | undefined

  if (context === 'webpage_desktop' || context === 'webpage_mobile') {
    const page_url = body.page_url as string
    const roi_data = body.roi_data as ROIAverage[]
    const viewport = context === 'webpage_desktop' ? 'desktop (1280×720)' : 'mobile (390×844, iPhone UA)'
    const lines = roi_data.map(r => `- ${r.label}: ${r.activation.toFixed(3)} — ${r.description}`).join('\n')

    return `You are interpreting BERG fMRI brain activation predictions for an ad landing page screenshot captured on ${viewport}.

BERG predicts which visual cortex regions activate when a person views the page above the fold. Scores are normalized 0–1.

Page: ${page_url}
Viewport: ${viewport}

Brain activation scores:
${lines}

Give 4–5 specific, actionable design suggestions to improve this landing page's ability to convert ad traffic. Ground each suggestion in the specific region scores (e.g. "FFA score of 0.12 is low — add a human face near the headline to drive trust and attention"). Consider layout differences appropriate for ${context === 'webpage_desktop' ? 'desktop (wide viewport, mouse interaction)' : 'mobile (narrow viewport, thumb reach, smaller text)'}.

Format as a markdown bulleted list. Each bullet is one to two sentences. Do not guarantee business outcomes.`
  }

  const roi_averages = body.roi_averages as ROIAverage[]
  const image_count = body.image_count as number
  const scoreLines = roi_averages.map(r => `- ${r.label}: ${r.activation.toFixed(3)} — ${r.description}`).join('\n')

  if (hasImage) {
    // Single ad image with vision — one call returns both BERG analysis and ad dimension scores
    return `You are a senior advertising creative director and neuroscience analyst reviewing a static ad image alongside its BERG fMRI brain activation scores.

BERG predicts which visual cortex regions activate when a viewer sees this ad. Scores are normalized 0–1.

BERG brain activation scores:
${scoreLines}

Your task is to return a JSON object with exactly this structure — no extra keys, no markdown fences:
{
  "berg_recommendations": [
    "<bullet 1: one to two sentences grounded in a specific BERG region score>",
    "<bullet 2>",
    "<bullet 3>",
    "<bullet 4>"
  ],
  "cta_strength": {
    "score": <integer 1-10>,
    "feedback": "<one sentence: is the CTA clear, prominent, and compelling?>"
  },
  "emotional_appeal": {
    "score": <integer 1-10>,
    "feedback": "<one sentence: does the image evoke a clear emotional response relevant to the product or offer?>"
  },
  "brand_clarity": {
    "score": <integer 1-10>,
    "feedback": "<one sentence: is the brand identity — logo, colors, tone — immediately recognizable?>"
  },
  "visual_hierarchy": {
    "score": <integer 1-10>,
    "feedback": "<one sentence: does the layout guide the viewer's eye from headline to supporting content to CTA?>"
  },
  "overall_verdict": "<two to three sentences: top strength, biggest weakness, single highest-priority fix>"
}

Use both the image and the BERG scores together. Reference specific region names and scores in berg_recommendations.`
  }

  // Text-only — batch averages or single without image
  return image_count === 1
    ? `You are interpreting BERG fMRI brain activation predictions for a static ad image.

Brain activation scores:
${scoreLines}

Give 3–4 specific, actionable suggestions to improve this ad's visual impact and attention capture for paid media performance. Reference specific region names and scores. Do not guarantee outcomes.

Format as a markdown bulleted list. Each bullet is one to two sentences.`
    : `You are interpreting BERG fMRI brain activation predictions for a batch of ${image_count} static ad images.

Average activation across all ${image_count} ads:
${scoreLines}

Give 4–5 concise, actionable design suggestions for improving this creative set's performance in paid media. Reference specific region names and scores. Do not guarantee outcomes.

Format as a markdown bulleted list. Each bullet is one to two sentences.`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseServer.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const image_base64: string | undefined = body.image_base64
  const mime_type: string = body.mime_type ?? 'image/jpeg'
  const hasImage = !!image_base64

  const prompt = buildPrompt(body, hasImage)

  const content: Anthropic.MessageParam['content'] = hasImage
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mime_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: image_base64!,
          },
        },
        { type: 'text', text: prompt },
      ]
    : prompt

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 768,
    messages: [{ role: 'user', content }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''

  if (hasImage) {
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(cleaned)

      const summary = (parsed.berg_recommendations as string[])
        .map((b: string) => `- ${b}`)
        .join('\n')

      const visual_analysis: VisualAdAnalysis = {
        cta_strength: parsed.cta_strength,
        emotional_appeal: parsed.emotional_appeal,
        brand_clarity: parsed.brand_clarity,
        visual_hierarchy: parsed.visual_hierarchy,
        overall_verdict: parsed.overall_verdict,
      }

      return NextResponse.json({ summary, visual_analysis })
    } catch {
      // If JSON parse fails, return raw text as summary only
      return NextResponse.json({ summary: raw })
    }
  }

  return NextResponse.json({ summary: raw })
}
