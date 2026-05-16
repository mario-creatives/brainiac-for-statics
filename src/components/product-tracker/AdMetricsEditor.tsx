'use client'

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import type { Quadrant } from '@/lib/quadrant'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'
import type { AudienceTreePayload } from '@/app/api/products/[id]/audiences/route'
import { LOSS_REASONS, LOSS_REASON_LABELS, type LossReason } from '@/lib/loss-reasons'

interface Props {
  token: string
  productId: string
  row: ProductAdRow & { loss_reason?: string | null }
  onSaved: () => void
  onClose: () => void
}

const QUADRANT_OPTIONS: { value: '' | Quadrant; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'winner', label: 'Winner' },
  { value: 'promising', label: 'Promising' },
  { value: 'investigate', label: 'Investigate' },
  { value: 'loser', label: 'Loser' },
]

export function AdMetricsEditor({ token, productId, row, onSaved, onClose }: Props) {
  const [spend, setSpend] = useState(row.spend_usd?.toString() ?? '')
  const [cpa, setCpa] = useState(row.cpa_usd?.toString() ?? '')
  const [ctr, setCtr] = useState(row.ctr_pct?.toString() ?? '')
  const [ageRange, setAgeRange] = useState(row.age_range ?? '')
  const [active, setActive] = useState<boolean>(row.ad_active ?? true)
  const [override, setOverride] = useState<'' | Quadrant>(row.quadrant_override ?? '')
  const [lossReason, setLossReason] = useState<'' | LossReason>(
    (row.loss_reason as LossReason | null | undefined) ?? '',
  )
  // Hierarchical audience selection (014 migration)
  const [tamId, setTamId] = useState<string>(row.tam_id ?? '')
  const [personaId, setPersonaId] = useState<string>(row.persona_id ?? '')
  const [microId, setMicroId] = useState<string>(row.micro_persona_id ?? '')
  const [audienceTree, setAudienceTree] = useState<AudienceTreePayload | null>(null)
  // Creative-level free-text (kept per-ad)
  const [statedConcept, setStatedConcept] = useState(row.stated_concept ?? '')
  const [statedAngle, setStatedAngle] = useState(row.stated_angle ?? '')
  const [isReferenceAd, setIsReferenceAd] = useState(row.is_reference_ad ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch the product's audience tree once on mount.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/products/${productId}/audiences`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) return
        const data = (await r.json()) as AudienceTreePayload
        if (!cancelled) setAudienceTree(data)
      })
      .catch(() => { /* non-fatal */ })
    return () => { cancelled = true }
  }, [productId, token])

  // Cascade clears when parent changes
  function handleTamChange(v: string) {
    setTamId(v)
    setPersonaId('')
    setMicroId('')
  }
  function handlePersonaChange(v: string) {
    setPersonaId(v)
    setMicroId('')
  }

  const selectedTam = audienceTree?.tams.find(t => t.id === tamId) ?? null
  const selectedPersona = selectedTam?.personas.find(p => p.id === personaId) ?? null

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const metricsRes = await fetch(`/api/products/${productId}/ads/${row.analysis_id}/metrics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          spend_usd: spend === '' ? null : Number(spend),
          cpa_usd:   cpa   === '' ? null : Number(cpa),
          ctr_pct:   ctr   === '' ? null : Number(ctr),
          age_range: ageRange.trim() || null,
          ad_active: active,
          loss_reason: lossReason || null,
          tam_id: tamId || null,
          persona_id: personaId || null,
          micro_persona_id: microId || null,
          stated_concept: statedConcept.trim() || null,
          stated_angle: statedAngle.trim() || null,
          is_reference_ad: isReferenceAd,
        }),
      })
      if (!metricsRes.ok) {
        const data = await metricsRes.json().catch(() => ({}))
        setError(data.error ?? `Save failed (${metricsRes.status})`)
        setSaving(false)
        return
      }

      // Only PATCH override if it actually changed
      if ((override || null) !== (row.quadrant_override ?? null)) {
        await fetch(`/api/products/${productId}/ads/${row.analysis_id}/quadrant`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ quadrant_override: override === '' ? null : override }),
        })
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setSaving(false)
  }

  const tams = audienceTree?.tams ?? []
  const personas = selectedTam?.personas ?? []
  const micros = selectedPersona?.micro_personas ?? []

  return (
    <tr className="bg-gray-950/50 border-b border-gray-800">
      <td colSpan={13} className="px-3 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Field label="Spend (USD)" type="number" value={spend} onChange={setSpend} placeholder="0.00" />
          <Field label="CPA (USD)" type="number" value={cpa} onChange={setCpa} placeholder="0.00" />
          <Field label="CTR (%)" type="number" value={ctr} onChange={setCtr} placeholder="0.00" />
          <Field label="Age range" type="text" value={ageRange} onChange={setAgeRange} placeholder="e.g. 25-44" />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Status override</label>
            <select
              value={override}
              onChange={e => setOverride(e.target.value as '' | Quadrant)}
              className="input !py-1 !text-xs"
            >
              {QUADRANT_OPTIONS.map(o => <option key={o.value || 'auto'} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Loss reason</label>
            <select
              value={lossReason}
              onChange={e => setLossReason(e.target.value as '' | LossReason)}
              className="input !py-1 !text-xs"
            >
              <option value="">Auto-classify</option>
              {LOSS_REASONS.map(r => (
                <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Active</label>
            <button
              onClick={() => setActive(v => !v)}
              type="button"
              className={`text-xs px-2 py-1 rounded border ${active ? 'bg-emerald-900/30 border-emerald-800/60 text-emerald-300' : 'bg-gray-900 border-gray-800 text-gray-500'}`}
            >
              {active ? 'Active' : 'Paused'}
            </button>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Reference ad ★</label>
            <button
              onClick={() => setIsReferenceAd(v => !v)}
              type="button"
              title="Star this as the north-star ad for this product"
              className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${isReferenceAd ? 'bg-yellow-900/30 border-yellow-800/60 text-yellow-300' : 'bg-gray-900 border-gray-800 text-gray-500'}`}
            >
              <Star className={`w-3 h-3 ${isReferenceAd ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              {isReferenceAd ? 'Starred' : 'Star'}
            </button>
          </div>
        </div>

        {/* Audience targeting — cascading selects from the product's hierarchy */}
        <div className="border-t border-gray-800 mt-3 pt-3">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold font-mono">Audience targeting</p>
            {tams.length === 0 && (
              <p className="text-[10px] text-gray-600">No audience hierarchy defined — add one in Product Settings</p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">TAM</label>
              <select
                value={tamId}
                onChange={e => handleTamChange(e.target.value)}
                disabled={tams.length === 0}
                className="input !py-1 !text-xs"
              >
                <option value="">— none —</option>
                {tams.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Persona</label>
              <select
                value={personaId}
                onChange={e => handlePersonaChange(e.target.value)}
                disabled={!tamId || personas.length === 0}
                className="input !py-1 !text-xs disabled:opacity-50"
              >
                <option value="">— none —</option>
                {personas.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">Micro-persona</label>
              <select
                value={microId}
                onChange={e => setMicroId(e.target.value)}
                disabled={!personaId || micros.length === 0}
                className="input !py-1 !text-xs disabled:opacity-50"
              >
                <option value="">— none —</option>
                {micros.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Concept (this ad)" type="text" value={statedConcept} onChange={setStatedConcept} placeholder="the ONE big idea this ad expresses" />
            <Field label="Angle (this ad)" type="text" value={statedAngle} onChange={setStatedAngle} placeholder="the lead/hook angle" />
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
            On the next re-analysis, Claude infers the persona / concept / angle from the ad alone, then checks alignment with what you selected here. Mismatches surface as a "targeting fit" flag.
          </p>
        </div>

        {error && <p className="text-[10px] text-[#ff2a2b] mt-2">{error}</p>}

        <div className="flex items-center justify-end gap-2 mt-3">
          <button onClick={onClose} className="text-[10px] text-gray-400 hover:text-white px-2 py-1">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1 rounded transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </td>
    </tr>
  )
}

function Field({ label, type, value, onChange, placeholder }: {
  label: string; type: 'text' | 'number' | 'date'; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium font-mono block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input !py-1 !text-xs"
      />
    </div>
  )
}
