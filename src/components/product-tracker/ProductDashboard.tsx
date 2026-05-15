'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Settings2, X } from 'lucide-react'
import { ImageBatchTab } from '@/components/ImageBatchTab'
import { AudienceHierarchyEditor } from './AudienceHierarchyEditor'
import { AdAnalysisModal } from '@/components/AdAnalysisModal'
import { ActionPlanCard } from './ActionPlanCard'
import { AdTrackerTable } from './AdTrackerTable'
import { SpendCpaScatter } from './SpendCpaScatter'
import { CtrFatigueChart } from './CtrFatigueChart'
import { FormatBreakdownBar } from './FormatBreakdownBar'
import { DiagnosisPie } from './DiagnosisPie'
import type { ProductDashboardPayload } from '@/app/api/products/[id]/dashboard/route'
import type { ProductRecommendationReport } from '@/app/api/products/[id]/recommendations/route'
import type { AnalysisResult } from '@/types'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'

interface Props {
  productId: string
  token: string
  onProductChanged: () => void
}

interface OpenedAd {
  id: string
  result: AnalysisResult
  comprehensive: ComprehensiveAnalysis | null
  spend: number | undefined
  isWinner: boolean
  isLoser: boolean
}

export function ProductDashboard({ productId, token, onProductChanged }: Props) {
  const [payload, setPayload] = useState<ProductDashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [report, setReport] = useState<ProductRecommendationReport | null>(null)
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string | null>(null)
  const [opened, setOpened] = useState<OpenedAd | null>(null)
  const [openedLoading, setOpenedLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dashRes, recRes] = await Promise.all([
        fetch(`/api/products/${productId}/dashboard`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/products/${productId}/recommendations`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!dashRes.ok) {
        const data = await dashRes.json().catch(() => ({}))
        setError(data.error ?? `Failed to load dashboard (${dashRes.status})`)
      } else {
        setPayload(await dashRes.json())
      }
      if (recRes.ok) {
        const recData = await recRes.json()
        if (recData.cached) {
          setReport(recData.cached)
          setReportGeneratedAt(recData.generated_at ?? null)
        } else {
          setReport(null)
          setReportGeneratedAt(null)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setLoading(false)
  }, [productId, token])

  useEffect(() => { load() }, [load])

  async function handleOpenAd(analysisId: string) {
    setOpenedLoading(true)
    try {
      const res = await fetch(`/api/analyze/${analysisId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        const isWinner = data.spend_usd != null && data.spend_usd >= 1000
        const isLoser = data.spend_usd != null && data.spend_usd < 1000
        setOpened({
          id: data.analysis_id,
          result: {
            analysis_id: data.analysis_id,
            status: data.status,
            heatmap_url: data.heatmap_url,
            roi_data: data.roi_data,
            mean_top_roi_score: data.mean_top_roi_score,
            error_message: data.error_message,
            attribution: data.attribution,
          },
          comprehensive: data.comprehensive_analysis,
          spend: data.spend_usd ?? undefined,
          isWinner,
          isLoser,
        })
      }
    } catch { /* ignore */ }
    setOpenedLoading(false)
  }

  if (loading && !payload) return <p className="text-sm text-gray-500 animate-pulse-soft p-6">Loading product…</p>
  if (error) return <p className="text-sm text-[#ff2a2b] p-6">{error}</p>
  if (!payload) return null

  const { product, ads, summary } = payload
  const targetCpa = product.target_cpa_usd

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Product header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{product.name}</h1>
          <p className="text-xs text-gray-400 mt-1">
            {product.vertical_category && <span className="capitalize">{product.vertical_category.replace(/_/g, ' ')}</span>}
            {product.vertical_category && targetCpa != null && <span className="mx-1.5 text-gray-700">·</span>}
            {targetCpa != null && <span>Target CPA <span className="text-gray-200 font-mono">${targetCpa}</span></span>}
          </p>
          {product.notes && <p className="text-xs text-gray-500 mt-2 max-w-xl leading-relaxed">{product.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(true)} className="text-gray-500 hover:text-white p-1.5" aria-label="Product settings">
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 enter-stagger">
        <Stat label="Total ads" value={summary.total_ads.toLocaleString()} caption="Ads tracked under this product." />
        <Stat label="Winners" value={summary.winners.toLocaleString()} caption="Spend ≥ $1k AND CPA ≤ target." accent="emerald" />
        <Stat label="Promising" value={summary.promising.toLocaleString()} caption="CPA hits target; needs more spend to confirm." accent="indigo" />
        <Stat label="Spend on winners" value={`$${Math.round(summary.spend_on_winners).toLocaleString()}`} caption="Total spend behind winning creative." />
        <Stat label="Avg CPA" value={summary.avg_cpa != null ? `$${summary.avg_cpa.toFixed(2)}` : '—'} caption={targetCpa != null ? `Target $${targetCpa}` : 'Set a target to compare.'} />
        <Stat label="Fatigue flagged" value={summary.fatigue_count.toLocaleString()} caption="Creative with CTR decay — iterate now." accent={summary.fatigue_count > 0 ? 'amber' : undefined} />
      </div>

      {/* Action plan */}
      <ActionPlanCard
        token={token}
        productId={productId}
        report={report}
        generatedAt={reportGeneratedAt}
        onRegenerated={r => { setReport(r); setReportGeneratedAt(r.generated_at) }}
      />

      {/* Add ads CTA */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex items-center justify-between gap-4 glass card-lift">
        <div>
          <h3 className="text-sm font-semibold text-white">Add ads to this product</h3>
          <p className="text-xs text-gray-400 mt-1">Upload static ads → BERG → extract → confirm → comprehensive analysis. Enter spend / CPA / CTR later via the table.</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Add ads
        </button>
      </div>

      {/* Tracker table */}
      <AdTrackerTable
        token={token}
        productId={productId}
        ads={ads}
        onOpenAd={handleOpenAd}
        onChanged={() => { load(); onProductChanged() }}
      />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SpendCpaScatter ads={ads} targetCpa={targetCpa} />
        <CtrFatigueChart ads={ads} />
        <FormatBreakdownBar ads={ads} />
        <DiagnosisPie report={report} />
      </div>

      {/* Upload sheet */}
      {showUpload && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => { setShowUpload(false); load() }}
        >
          <div
            className="bg-gray-950 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <h2 className="text-sm font-semibold text-white">Add ads to {product.name}</h2>
              <button onClick={() => { setShowUpload(false); load() }} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <ImageBatchTab
                token={token}
                productId={productId}
                forceMode="historical"
                onStatsUpdate={() => { load() }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <ProductSettingsModal
          token={token}
          product={product}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load(); onProductChanged() }}
          onDeleted={() => { setShowSettings(false); onProductChanged() }}
        />
      )}

      {/* Ad analysis modal */}
      {opened && (
        <AdAnalysisModal
          card={{
            id: opened.id,
            fileName: opened.id.slice(0, 8),
            previewUrl: opened.result.heatmap_url ?? '',
            result: opened.result,
            spend: opened.spend,
            isWinner: opened.isWinner,
            isLoser: opened.isLoser,
          }}
          comprehensive={opened.comprehensive ?? undefined}
          loading={openedLoading}
          isHistorical={opened.spend != null}
          token={token}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, caption, accent }: { label: string; value: string; caption: string; accent?: 'emerald' | 'amber' | 'indigo' }) {
  const accentClass =
    accent === 'emerald' ? 'text-emerald-400' :
    accent === 'amber'   ? 'text-amber-400' :
    accent === 'indigo'  ? 'text-indigo-300' :
    'text-white'
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${accentClass}`}>{value}</p>
      <p className="text-[10px] text-gray-600 leading-snug">{caption}</p>
    </div>
  )
}

function ProductSettingsModal({ token, product, onClose, onSaved, onDeleted }: {
  token: string
  product: ProductDashboardPayload['product']
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(product.name)
  const [targetCpa, setTargetCpa] = useState(product.target_cpa_usd?.toString() ?? '')
  const [winnerThreshold, setWinnerThreshold] = useState(
    product.winner_spend_threshold_usd?.toString() ?? '1000',
  )
  const [notes, setNotes] = useState(product.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          target_cpa_usd: targetCpa === '' ? null : Number(targetCpa),
          winner_spend_threshold_usd: winnerThreshold === '' ? 1000 : Number(winnerThreshold),
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to save')
      } else {
        onSaved()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (saving) return
    if (!confirm(`Archive "${product.name}"? Its ads stay in your account but no longer appear here.`)) return
    setSaving(true)
    try {
      await fetch(`/api/products/${product.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-700 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">Product settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <Input label="Name" value={name} onChange={setName} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Target CPA (USD)" type="number" value={targetCpa} onChange={setTargetCpa} />
            <Input label="Winner spend threshold (USD)" type="number" value={winnerThreshold} onChange={setWinnerThreshold} />
          </div>
          <p className="text-[10px] text-gray-600 -mt-2">Changing the target CPA or threshold re-classifies every ad in this product.</p>

          <div className="border-t border-gray-800 pt-4 space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold font-mono">Audience hierarchy</p>
              <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                A product can serve many TAMs. Each TAM has its own personas; each persona has micro-personas. A specific ad later picks ONE combo from this tree to anchor the targeting-fit check.
              </p>
            </div>
            <AudienceHierarchyEditor productId={product.id} token={token} />
          </div>

          <div className="border-t border-gray-800 pt-4">
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="input resize-none"
            />
          </div>
          {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between shrink-0">
          <button onClick={handleDelete} disabled={saving} className="text-xs text-[#ff2a2b] hover:text-red-400 flex items-center gap-1.5">
            <Trash2 className="w-3 h-3" />
            Archive product
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">Cancel</button>
            <button onClick={handleSave} disabled={saving || !name.trim()} className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="input" />
    </div>
  )
}
