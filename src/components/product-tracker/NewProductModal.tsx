'use client'

import { useState, useRef } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'

const VERTICAL_OPTIONS = [
  '', 'health', 'beauty_skincare', 'apparel', 'food_beverage', 'home_lifestyle',
  'fitness', 'supplements', 'pet', 'accessories', 'wellness', 'other',
]

interface Props {
  token: string
  onClose: () => void
  onCreated: (productId: string) => void
}

export function NewProductModal({ token, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [vertical, setVertical] = useState('')
  const [targetCpa, setTargetCpa] = useState('')
  const [winnerThreshold, setWinnerThreshold] = useState('1000')
  const [notes, setNotes] = useState('')
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [defaultTam, setDefaultTam] = useState('')
  const [defaultPersona, setDefaultPersona] = useState('')
  const [defaultMicro, setDefaultMicro] = useState('')
  const [defaultConcept, setDefaultConcept] = useState('')
  const [defaultAngle, setDefaultAngle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          vertical_category: vertical || null,
          target_cpa_usd: targetCpa ? Number(targetCpa) : null,
          winner_spend_threshold_usd: winnerThreshold ? Number(winnerThreshold) : 1000,
          notes: notes.trim() || null,
          default_tam: defaultTam.trim() || null,
          default_persona: defaultPersona.trim() || null,
          default_micro_persona: defaultMicro.trim() || null,
          default_concept: defaultConcept.trim() || null,
          default_angle: defaultAngle.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create product')
      } else {
        onCreated(data.product.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    }
    setSaving(false)
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-gray-950 border border-gray-700 rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">New product</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <Field label="Product name" required>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Beam Sleep"
              required
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Niche / category">
              <select
                value={vertical}
                onChange={e => setVertical(e.target.value)}
                className="input"
              >
                {VERTICAL_OPTIONS.map(v => (
                  <option key={v} value={v}>{v === '' ? '— select —' : v.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>

            <Field label="Target CPA (USD)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={targetCpa}
                onChange={e => setTargetCpa(e.target.value)}
                placeholder="30.00"
                className="input"
              />
            </Field>
          </div>

          <Field label="Winner spend threshold (USD)" hint="Spend at which an on-target ad becomes a confirmed winner. Default $1,000.">
            <input
              type="number"
              step="100"
              min="100"
              value={winnerThreshold}
              onChange={e => setWinnerThreshold(e.target.value)}
              placeholder="1000"
              className="input"
            />
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any product context…"
              className="input resize-none"
            />
          </Field>

          {/* Audience defaults — collapsible */}
          <div className="border-t border-gray-800 pt-3">
            <button
              type="button"
              onClick={() => setAudienceOpen(o => !o)}
              className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
            >
              {audienceOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Target audience defaults (optional)
            </button>
            <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">
              Set once here — every ad you upload gets compared against these. Claude uses them as context so audience_match runs even on the first upload.
            </p>
            {audienceOpen && (
              <div className="mt-3 space-y-3">
                <Field label="TAM (total addressable market)" hint="e.g. Sleep-deprived working moms 35–54">
                  <input
                    type="text"
                    value={defaultTam}
                    onChange={e => setDefaultTam(e.target.value)}
                    placeholder="Who broadly buys this product"
                    className="input"
                  />
                </Field>
                <Field label="Persona" hint="One sentence — who you're targeting">
                  <input
                    type="text"
                    value={defaultPersona}
                    onChange={e => setDefaultPersona(e.target.value)}
                    placeholder="e.g. Busy moms who struggle to fall asleep"
                    className="input"
                  />
                </Field>
                <Field label="Micro-persona" hint="Narrower — specific life stage or situation">
                  <input
                    type="text"
                    value={defaultMicro}
                    onChange={e => setDefaultMicro(e.target.value)}
                    placeholder="e.g. Moms with school-age kids, post-caffeine crash"
                    className="input"
                  />
                </Field>
                <Field label="Concept" hint="The single big idea this product leads with">
                  <input
                    type="text"
                    value={defaultConcept}
                    onChange={e => setDefaultConcept(e.target.value)}
                    placeholder="e.g. Fall asleep faster without medication"
                    className="input"
                  />
                </Field>
                <Field label="Angle" hint="The hook mechanism — mechanism reveal, identity claim, before/after, etc.">
                  <input
                    type="text"
                    value={defaultAngle}
                    onChange={e => setDefaultAngle(e.target.value)}
                    placeholder="e.g. Before/after sleep quality transformation"
                    className="input"
                  />
                </Field>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors font-medium"
          >
            {saving ? 'Creating…' : 'Create product'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, required, children }: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-[10px] font-mono font-semibold uppercase tracking-wider text-gray-500 block mb-1.5">
        {label}{required && <span className="text-[#ff2a2b] ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}
