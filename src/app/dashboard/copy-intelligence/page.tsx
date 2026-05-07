'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { LogOut, ArrowLeft, RefreshCw, Sparkles, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { AttributionFooter } from '@/components/AttributionFooter'
import type { CopyIntelligenceReport, CopyIntelligenceSection } from '@/app/api/analyze/copy-intelligence/route'

function readJsonStream(res: Response): Promise<Record<string, unknown>> {
  return new Promise(async (resolve, reject) => {
    try {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: !done })
      }
      const last = text.split('\n').filter(l => l.trim()).pop() ?? '{}'
      resolve(JSON.parse(last))
    } catch (e) {
      reject(e)
    }
  })
}

function SectionCard({ title, section, accent = 'indigo' }: {
  title: string
  section: CopyIntelligenceSection
  accent?: 'indigo' | 'emerald' | 'amber'
}) {
  const [open, setOpen] = useState(false)
  const accentColor = accent === 'emerald' ? 'text-emerald-400' : accent === 'amber' ? 'text-amber-400' : 'text-indigo-400'
  const borderColor = accent === 'emerald' ? 'border-emerald-900/40' : accent === 'amber' ? 'border-amber-900/40' : 'border-indigo-900/40'
  return (
    <div className={`bg-gray-900 border ${borderColor} rounded-xl overflow-hidden`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
      >
        <span className={`text-sm font-semibold ${accentColor}`}>{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-800">
          <p className="text-sm text-gray-300 leading-relaxed pt-4">{section.finding}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {section.dos.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-emerald-500 font-medium">Do</p>
                <ul className="space-y-1">
                  {section.dos.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {section.donts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-[#ff2a2b] font-medium">Don&apos;t</p>
                <ul className="space-y-1">
                  {section.donts.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                      <XCircle className="w-3.5 h-3.5 text-[#ff2a2b] shrink-0 mt-0.5" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {section.examples && section.examples.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-gray-800">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Examples from your winners</p>
              <ul className="space-y-1">
                {section.examples.map((ex, i) => (
                  <li key={i} className="text-xs text-gray-400 pl-2 border-l border-gray-700">{ex}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CopyIntelligencePage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<CopyIntelligenceReport | null>(null)
  const [insufficientData, setInsufficientData] = useState<{ winners_count: number; losers_count: number; needed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }
      setToken(session.access_token)
    })
  }, [router])

  async function handleGenerate() {
    if (!token || loading) return
    setLoading(true)
    setError(null)
    setInsufficientData(null)
    try {
      const res = await fetch('/api/analyze/copy-intelligence', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await readJsonStream(res) as Record<string, unknown>
      if (data.error) {
        setError(data.error as string)
      } else if (data.insufficient_data) {
        setInsufficientData({
          winners_count: data.winners_count as number,
          losers_count: data.losers_count as number,
          needed: data.needed as number,
        })
      } else {
        setReport(data as unknown as CopyIntelligenceReport)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    }
    setLoading(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-30 bg-gray-950/85 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-[#ff2a2b]">Adforge</span>
          <span className="text-xs text-gray-500 hidden sm:block">Copy Intelligence</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Analyze ads
          </Link>
          <Link href="/dashboard/historical-analysis" className="text-xs text-gray-400 hover:text-white transition-colors">
            Historical analysis
          </Link>
          {report && (
            <button
              onClick={handleGenerate}
              disabled={loading}
              aria-label="Regenerate"
              title="Regenerate analysis"
              className="text-gray-400 hover:text-white transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button onClick={handleSignOut} aria-label="Sign out" className="text-gray-400 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Copy Intelligence</h1>
          <p className="text-sm text-gray-400 mt-1.5 leading-relaxed max-w-2xl">
            A Claude-powered copywriting playbook built entirely from your historical ad data.
            What headline structures win, which element combinations spend, what to always do and never do — specific to your account, not generic advice.
          </p>
        </div>

        {/* Generate / regenerate button — shown when no report yet */}
        {!report && !loading && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col items-center gap-4 text-center">
            <Sparkles className="w-8 h-8 text-indigo-400" />
            <div>
              <p className="text-base font-semibold text-white">Generate your copy playbook</p>
              <p className="text-sm text-gray-400 mt-1 max-w-sm">
                Analyzes all your historical winners and losers to produce a structured guide on what copy structure works for this account.
              </p>
            </div>
            {insufficientData && (
              <p className="text-xs text-amber-400">
                Not enough data yet — you have {insufficientData.winners_count} winner{insufficientData.winners_count !== 1 ? 's' : ''} and {insufficientData.losers_count} loser{insufficientData.losers_count !== 1 ? 's' : ''}.
                Upload {insufficientData.needed} more historical ad{insufficientData.needed !== 1 ? 's' : ''} to unlock this.
              </p>
            )}
            {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}
            <button
              onClick={handleGenerate}
              disabled={!token}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              <Sparkles className="w-4 h-4" />
              Generate Copy Intelligence
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-sm text-gray-300">Analyzing your ad history…</p>
            <p className="text-xs text-gray-500">Claude is reading all your winners and losers. This takes 30–90 seconds.</p>
          </div>
        )}

        {/* Report */}
        {report && !loading && (
          <div className="space-y-6">
            {/* Meta */}
            <p className="text-[11px] text-gray-600">
              Based on {report.winners_analyzed} winner{report.winners_analyzed !== 1 ? 's' : ''} and {report.losers_analyzed} loser{report.losers_analyzed !== 1 ? 's' : ''} ·
              Generated {new Date(report.generated_at).toLocaleString()}
            </p>

            {/* Winning Formula — hero section */}
            <div className="bg-gray-900 border border-indigo-900/50 rounded-2xl p-6 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-medium">Winning Formula</p>
              <p className="text-base text-white leading-relaxed">{report.winning_formula}</p>
            </div>

            {/* Dos / Don'ts grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-emerald-900/40 rounded-2xl p-5 space-y-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-medium">What to always do</p>
                <ul className="space-y-2">
                  {report.dos.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-gray-900 border border-red-900/40 rounded-2xl p-5 space-y-3">
                <p className="text-[10px] uppercase tracking-wider text-[#ff2a2b] font-medium">What to never do</p>
                <ul className="space-y-2">
                  {report.donts.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <XCircle className="w-4 h-4 text-[#ff2a2b] shrink-0 mt-0.5" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Element deep dives — collapsible cards */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-3">Element deep dives</p>
              <div className="space-y-2">
                <SectionCard title="Headline" section={report.headline} accent="indigo" />
                <SectionCard title="Subheadline" section={report.subheadline} accent="indigo" />
                <SectionCard title="Benefits" section={report.benefits} accent="indigo" />
                <SectionCard title="CTA" section={report.cta} accent="indigo" />
                <div className="bg-gray-900 border border-indigo-900/40 rounded-xl overflow-hidden">
                  <button
                    onClick={() => {}}
                    className="w-full flex items-center justify-between px-5 py-4 text-left cursor-default"
                  >
                    <span className="text-sm font-semibold text-indigo-400">Combination / Composition</span>
                  </button>
                  <div className="px-5 pb-5 space-y-4 border-t border-gray-800">
                    <p className="text-sm text-gray-300 leading-relaxed pt-4">{report.combinations.finding}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {report.combinations.winning_stacks.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-emerald-500 font-medium">Winning stacks</p>
                          <ul className="space-y-1">
                            {report.combinations.winning_stacks.map((s, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {report.combinations.losing_stacks.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-[#ff2a2b] font-medium">Losing stacks</p>
                          <ul className="space-y-1">
                            {report.combinations.losing_stacks.map((s, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                                <XCircle className="w-3.5 h-3.5 text-[#ff2a2b] shrink-0 mt-0.5" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="bg-gray-900 border border-indigo-900/40 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-800">
                    <span className="text-sm font-semibold text-indigo-400">Behavioral Economics</span>
                  </div>
                  <div className="px-5 pb-5 space-y-4">
                    <p className="text-sm text-gray-300 leading-relaxed pt-4">{report.behavioral_economics.finding}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {report.behavioral_economics.top_levers.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-emerald-500 font-medium">Levers that work</p>
                          <ul className="space-y-1">
                            {report.behavioral_economics.top_levers.map((l, i) => (
                              <li key={i} className="text-xs text-gray-300 pl-2 border-l-2 border-emerald-700">{l}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {report.behavioral_economics.weak_levers.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Levers with weak signal</p>
                          <ul className="space-y-1">
                            {report.behavioral_economics.weak_levers.map((l, i) => (
                              <li key={i} className="text-xs text-gray-400 pl-2 border-l-2 border-gray-700">{l}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notable winners */}
            {report.notable_examples.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Notable winners</p>
                <div className="space-y-3">
                  {report.notable_examples.map((ex, i) => (
                    <div key={i} className="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm text-white font-medium leading-snug">&ldquo;{ex.headline}&rdquo;</p>
                        <span className="text-xs font-mono text-emerald-400 shrink-0">${ex.spend.toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 leading-snug">{ex.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Regenerate */}
            <div className="flex justify-center pt-2">
              <button
                onClick={handleGenerate}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate with latest data
              </button>
            </div>
          </div>
        )}

        <AttributionFooter />
      </main>
    </div>
  )
}
