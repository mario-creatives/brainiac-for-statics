'use client'

import { useState, useRef } from 'react'
import { X, ChevronDown } from 'lucide-react'

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
  const [tam, setTam] = useState('')
  const [defaultPersona, setDefaultPersona] = useState('')
  const [defaultMicroPersona, setDefaultMicroPersona] = useState('')
  const [audienceOpen, setAudienceOpen] = useState(false)
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
          tam: tam.trim() || null,
          default_persona: defaultPersona.trim() || null,
          default_micro_persona: defaultMicroPersona.trim() || null,
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

          {/* Audience Clarity — collapsed by default */}
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setAudienceOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
            >
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-indigo-400">Audience clarity</p>
                <p className="text-[10px] text-gray-500 mt-0.5">TAM · persona · micro-persona (optional)</p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${audienceOpen ? 'rotate-180' : ''}`} />
            </button>

            {audienceOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-800 pt-3 bg-gray-950/50">
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  These are the defaults used as the "you said" side of the targeting-fit check. If Claude&apos;s read of the ad doesn&apos;t match, it flags the mismatch — because if Claude can&apos;t tell who it&apos;s for, Meta&apos;s algorithm can&apos;t either.
                </p>
                <Field label="TAM">
                  <textarea
                    value={tam}
                    onChange={e => setTam(e.target.value)}
                    rows={2}
                    placeholder="e.g. 35–55 yr-old women in the US with chronic insomnia"
                    className="input resize-none"
                  />
                </Field>
                <Field label="Default persona">
                  <input
                    type="text"
                    value={defaultPersona}
                    onChange={e => setDefaultPersona(e.target.value)}
                    placeholder="e.g. exhausted working mothers"
                    className="input"
                  />
                </Field>
                <Field label="Default micro-persona">
                  <input
                    type="text"
                    value={defaultMicroPersona}
                    onChange={e => setDefaultMicroPersona(e.target.value)}
                    placeholder="e.g. 38-yr-old working mom of two who tried Ambien and quit"
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
