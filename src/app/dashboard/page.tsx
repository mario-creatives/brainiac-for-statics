'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { ConsentGate } from '@/components/ConsentGate'
import { UsageMeter } from '@/components/UsageMeter'
import { UploadZone } from '@/components/UploadZone'
import { ChannelInput } from '@/components/ChannelInput'
import { LoadingBrain } from '@/components/LoadingBrain'
import { HeatmapPanel } from '@/components/HeatmapPanel'
import { ROIBarChart } from '@/components/ROIBarChart'
import { AttributionFooter } from '@/components/AttributionFooter'
import { LogOut } from 'lucide-react'
import type { AnalysisResult, UsageInfo, ConsentType, LimitError } from '@/types'

type Tab = 'upload' | 'channel'

export default function DashboardPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [consentDone, setConsentDone] = useState<boolean | null>(null) // null = loading
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [tab, setTab] = useState<Tab>('upload')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [limitError, setLimitError] = useState<LimitError | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Auth + consent check ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }
      setToken(session.access_token)

      const [consentRes, usageRes] = await Promise.all([
        fetch('/api/users/me/consent', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/users/me/usage', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ])

      const consentData = await consentRes.json()
      setConsentDone(consentData.all_required_consents_given ?? false)

      if (usageRes.ok) setUsage(await usageRes.json())
    })
  }, [router])

  const refreshUsage = useCallback(async (tok: string) => {
    const res = await fetch('/api/users/me/usage', {
      headers: { Authorization: `Bearer ${tok}` },
    })
    if (res.ok) setUsage(await res.json())
  }, [])

  // ── Consent submit ────────────────────────────────────────────────────────
  async function handleConsent(types: ConsentType[]) {
    if (!token) return
    const res = await fetch('/api/users/me/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consent_types: types }),
    })
    if (res.ok) setConsentDone(true)
  }

  // ── Poll for analysis result ──────────────────────────────────────────────
  function startPolling(analysisId: string, tok: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/analyze/${analysisId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      if (!res.ok) return
      const data: AnalysisResult = await res.json()
      if (data.status === 'complete' || data.status === 'failed') {
        clearInterval(pollRef.current!)
        setAnalyzing(false)
        setResult(data)
        refreshUsage(tok)
      }
    }, 3000)
  }

  // ── Upload handler ────────────────────────────────────────────────────────
  async function handleUpload(file: File) {
    if (!token) return
    setAnalyzing(true)
    setResult(null)
    setError(null)
    setLimitError(null)

    const form = new FormData()
    form.append('image', file)

    const res = await fetch('/api/analyze/thumbnail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })

    if (res.status === 429) {
      setLimitError(await res.json())
      setAnalyzing(false)
      return
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Analysis failed. Please try again.')
      setAnalyzing(false)
      return
    }

    const { analysis_id } = await res.json()
    startPolling(analysis_id, token)
  }

  // ── Channel handler ───────────────────────────────────────────────────────
  async function handleChannel(handle: string, count: number) {
    if (!token) return
    setAnalyzing(true)
    setResult(null)
    setError(null)
    setLimitError(null)

    const res = await fetch('/api/analyze/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel_handle: handle, thumbnail_count: count }),
    })

    if (res.status === 429) {
      setLimitError(await res.json())
      setAnalyzing(false)
      return
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Channel analysis failed.')
      setAnalyzing(false)
      return
    }

    const { analysis_ids } = await res.json()
    // Poll on the first analysis ID for live feedback
    if (analysis_ids?.[0]) startPolling(analysis_ids[0], token)
    else setAnalyzing(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (consentDone === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm animate-pulse">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {!consentDone && <ConsentGate onConsent={handleConsent} />}

      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-indigo-400">Brainiac</span>
          <span className="text-xs text-gray-600 hidden sm:block">
            Brain encoding model for creative analysis
          </span>
        </div>
        <div className="flex items-center gap-6">
          {usage && <UsageMeter usage={usage} />}
          <a href="/account" className="text-xs text-gray-500 hover:text-white transition-colors">
            Settings
          </a>
          <button onClick={handleSignOut} className="text-gray-500 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <div className="flex gap-1 p-1 bg-gray-900 rounded-lg w-fit border border-gray-800">
          {(['upload', 'channel'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors
                ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {t === 'upload' ? 'Upload Image' : 'YouTube Channel'}
            </button>
          ))}
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          {tab === 'upload'
            ? <UploadZone onFile={handleUpload} disabled={analyzing} />
            : <ChannelInput onSubmit={handleChannel} disabled={analyzing} />
          }
        </div>

        {limitError && (
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl px-5 py-4 text-sm">
            <p className="text-amber-400 font-medium mb-1">Limit reached</p>
            <p className="text-amber-200/70">{limitError.reason}</p>
            {limitError.resets_at && (
              <p className="text-amber-200/50 text-xs mt-1">
                Resets: {new Date(limitError.resets_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl px-5 py-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {analyzing && <LoadingBrain />}

        {result && result.status === 'complete' && (
          <div className="space-y-6 bg-gray-900 rounded-xl border border-gray-800 p-6">
            {result.heatmap_url && <HeatmapPanel heatmapUrl={result.heatmap_url} />}
            {result.roi_data && result.roi_data.length > 0 && (
              <ROIBarChart roiData={result.roi_data} />
            )}
            {result.mean_top_roi_score !== null && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Mean top ROI score:</span>
                <span className="font-mono text-white">
                  {result.mean_top_roi_score.toFixed(3)}
                </span>
              </div>
            )}
            <AttributionFooter />
          </div>
        )}

        {result && result.status === 'failed' && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl px-5 py-4">
            <p className="text-red-400 text-sm">
              Analysis failed: {result.error_message ?? 'Unknown error. Please try again.'}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
