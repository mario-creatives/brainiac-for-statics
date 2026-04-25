'use client'

import { useEffect, useRef, useState } from 'react'
import { ROIBarChart } from '@/components/ROIBarChart'
import { AttributionFooter } from '@/components/AttributionFooter'
import type { AnalysisResult, ROIRegion } from '@/types'

function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

interface Props { token: string }

type Status = 'idle' | 'capturing' | 'analyzing' | 'complete' | 'failed'

export function WebPageTab({ token }: Props) {
  const [url, setUrl] = useState('')
  const [submittedUrl, setSubmittedUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [suggestions, setSuggestions] = useState<string | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current)
    setUrl('')
    setSubmittedUrl('')
    setStatus('idle')
    setError(null)
    setAnalysisId(null)
    setScreenshotUrl(null)
    setResult(null)
    setShowHeatmap(true)
    setSuggestions(null)
    setSuggestionsLoading(false)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return

    const withProtocol = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
    setSubmittedUrl(withProtocol)
    setStatus('capturing')
    setError(null)
    setResult(null)
    setSuggestions(null)
    setScreenshotUrl(null)

    const res = await fetch('/api/analyze/webpage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: withProtocol }),
    })

    if (res.status === 429) {
      const d = await res.json()
      setError(d.reason ?? 'Usage limit reached.')
      setStatus('failed')
      return
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Screenshot or dispatch failed.')
      setStatus('failed')
      return
    }

    const { analysis_id, screenshot_url } = await res.json()
    setAnalysisId(analysis_id)
    setScreenshotUrl(screenshot_url)
    setStatus('analyzing')

    // Poll until complete
    pollRef.current = setInterval(async () => {
      const poll = await fetch(`/api/analyze/${analysis_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!poll.ok) return
      const data: AnalysisResult = await poll.json()
      if (data.status !== 'complete' && data.status !== 'failed') return

      clearInterval(pollRef.current!)
      pollRef.current = null

      if (data.status === 'failed') {
        setError(data.error_message ?? 'Analysis failed.')
        setStatus('failed')
        return
      }

      setResult(data)
      setStatus('complete')

      if (data.roi_data?.length) {
        setSuggestionsLoading(true)
        fetch('/api/analyze/image-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ context: 'webpage', page_url: withProtocol, roi_data: data.roi_data }),
        })
          .then(r => r.json())
          .then(d => setSuggestions(d.summary ?? null))
          .catch(() => {})
          .finally(() => setSuggestionsLoading(false))
      }
    }, 3000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-white">Landing Page Analyzer</h2>
        <p className="text-xs text-gray-500 mt-1">
          Enter any public URL. The page is screenshotted above the fold (1280×720) and run through
          the BERG brain activation model — same as thumbnail analysis. Returns a heatmap and ROI scores.
        </p>
      </div>

      {/* URL input */}
      {status === 'idle' || status === 'failed' ? (
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 px-3 py-2 text-sm bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            disabled={false}
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            Analyze
          </button>
        </form>
      ) : null}

      {/* Error */}
      {error && (
        <div className="bg-red-950/30 border border-red-800/50 px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={reset} className="text-xs text-gray-400 hover:text-white mt-2 underline">Try again</button>
        </div>
      )}

      {/* Capturing */}
      {status === 'capturing' && (
        <div className="flex items-center gap-3 py-4">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <div>
            <p className="text-sm text-white">Capturing screenshot…</p>
            <p className="text-xs text-gray-500 mt-0.5">{submittedUrl}</p>
          </div>
        </div>
      )}

      {/* Analyzing */}
      {status === 'analyzing' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 py-2">
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-white">Running BERG brain activation model…</p>
          </div>
          {/* Show screenshot while waiting */}
          {screenshotUrl && (
            <div className="border border-gray-800 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshotUrl} alt="Page screenshot" className="w-full opacity-60" />
            </div>
          )}
        </div>
      )}

      {/* Complete */}
      {status === 'complete' && result && (
        <div className="space-y-8">
          {/* URL + reset */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 font-mono truncate max-w-lg">{submittedUrl}</p>
            <button
              onClick={reset}
              className="text-xs text-gray-400 hover:text-white transition-colors shrink-0 ml-4"
            >
              Analyze another page
            </button>
          </div>

          {/* Screenshot with heatmap overlay */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Brain Activation Heatmap</h3>
              {result.heatmap_url && (
                <button
                  onClick={() => setShowHeatmap(h => !h)}
                  className="text-xs text-gray-400 hover:text-white transition-colors border border-gray-700 px-3 py-1"
                >
                  {showHeatmap ? 'Hide heatmap' : 'Show heatmap'}
                </button>
              )}
            </div>
            <div className="relative border border-gray-800 overflow-hidden">
              {screenshotUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={screenshotUrl} alt="Page screenshot" className="w-full block" />
              )}
              {result.heatmap_url && showHeatmap && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.heatmap_url}
                  alt="Brain activation heatmap"
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ opacity: 0.65 }}
                />
              )}
            </div>
            <p className="text-xs text-gray-500">
              Warmer zones indicate stronger predicted neural activation. This reflects visual salience, not user intent.
            </p>
          </div>

          {/* ROI bar chart */}
          {result.roi_data && result.roi_data.length > 0 && (
            <ROIBarChart roiData={result.roi_data as ROIRegion[]} />
          )}

          {/* AI suggestions */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-label">Design Recommendations</span>
              <span className="panel-meta">BERG · brain activation analysis</span>
            </div>
            <div className="p-5">
              {suggestionsLoading ? (
                <div className="flex items-center gap-3 t-meta">
                  <div className="w-3 h-3 border border-indigo-500 border-t-transparent animate-spin" />
                  Generating recommendations…
                </div>
              ) : suggestions ? (
                <div className="space-y-3">
                  {suggestions.split('\n').map((line, i) => {
                    const bullet = line.match(/^[-*]\s+(.+)/)
                    if (bullet) return (
                      <div key={i} className="flex gap-3 py-1 border-b border-gray-800 last:border-0">
                        <span className="text-indigo-500 shrink-0 t-meta mt-0.5">—</span>
                        <span className="text-sm text-gray-200 leading-relaxed"><RichLine text={bullet[1]} /></span>
                      </div>
                    )
                    if (line.startsWith('#')) return null
                    return line.trim() ? <p key={i} className="t-meta pb-1">{line}</p> : null
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <AttributionFooter />
        </div>
      )}
    </div>
  )
}
