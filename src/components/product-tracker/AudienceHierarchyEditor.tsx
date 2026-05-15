'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import type { AudienceTreePayload, AudienceTam, AudiencePersona, AudienceMicroPersona } from '@/app/api/products/[id]/audiences/route'

interface Props {
  productId: string
  token: string
}

type Level = 'tam' | 'persona' | 'micro_persona'

export function AudienceHierarchyEditor({ productId, token }: Props) {
  const [tree, setTree] = useState<AudienceTreePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedTams, setExpandedTams] = useState<Set<string>>(new Set())
  const [expandedPersonas, setExpandedPersonas] = useState<Set<string>>(new Set())
  const [addingTam, setAddingTam] = useState(false)
  const [newTamLabel, setNewTamLabel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${productId}/audiences`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Failed to load audiences (${res.status})`)
      } else {
        const data = (await res.json()) as AudienceTreePayload
        setTree(data)
        // auto-expand single-tam trees so the structure is visible immediately
        if (data.tams.length === 1) setExpandedTams(new Set([data.tams[0].id]))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setLoading(false)
  }, [productId, token])

  useEffect(() => { load() }, [load])

  async function createNode(level: Level, parentId: string | undefined, label: string): Promise<boolean> {
    const trimmed = label.trim()
    if (!trimmed) return false
    const res = await fetch(`/api/products/${productId}/audiences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ level, parent_id: parentId, label: trimmed }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Create failed')
      return false
    }
    await load()
    return true
  }

  async function renameNode(level: Level, id: string, label: string): Promise<boolean> {
    const trimmed = label.trim()
    if (!trimmed) return false
    const res = await fetch(`/api/products/${productId}/audiences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ level, id, label: trimmed }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Rename failed')
      return false
    }
    await load()
    return true
  }

  async function deleteNode(level: Level, id: string, confirmText: string) {
    if (!confirm(`Delete this ${confirmText}? Any children and any ads pointing to it will lose this selection.`)) return
    const res = await fetch(`/api/products/${productId}/audiences?level=${level}&id=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Delete failed')
      return
    }
    await load()
  }

  function toggleTam(id: string) {
    setExpandedTams(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function togglePersona(id: string) {
    setExpandedPersonas(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return <p className="text-xs text-gray-500 animate-pulse-soft">Loading audiences…</p>
  }

  const tams = tree?.tams ?? []

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-center justify-between text-[10px] text-[#ff2a2b] bg-red-950/30 border border-red-900/40 rounded px-2 py-1">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      {tams.length === 0 && !addingTam && (
        <p className="text-[10px] text-gray-500 leading-relaxed">
          No audiences yet. Add a TAM (total addressable market) → personas → micro-personas. Each ad later picks ONE combo to anchor the targeting-fit check.
        </p>
      )}

      {tams.map(tam => (
        <TamRow
          key={tam.id}
          tam={tam}
          expanded={expandedTams.has(tam.id)}
          expandedPersonas={expandedPersonas}
          onToggle={() => toggleTam(tam.id)}
          onTogglePersona={togglePersona}
          onRename={(id, label) => renameNode('tam', id, label)}
          onDelete={(id) => deleteNode('tam', id, 'TAM and ALL its personas + micro-personas')}
          onAddPersona={(parentId, label) => createNode('persona', parentId, label)}
          onRenamePersona={(id, label) => renameNode('persona', id, label)}
          onDeletePersona={(id) => deleteNode('persona', id, 'persona and ALL its micro-personas')}
          onAddMicro={(parentId, label) => createNode('micro_persona', parentId, label)}
          onRenameMicro={(id, label) => renameNode('micro_persona', id, label)}
          onDeleteMicro={(id) => deleteNode('micro_persona', id, 'micro-persona')}
        />
      ))}

      {addingTam ? (
        <InlineAddRow
          placeholder="e.g. Sleep-deprived working moms"
          value={newTamLabel}
          onChange={setNewTamLabel}
          onSubmit={async () => {
            const ok = await createNode('tam', undefined, newTamLabel)
            if (ok) { setNewTamLabel(''); setAddingTam(false) }
          }}
          onCancel={() => { setNewTamLabel(''); setAddingTam(false) }}
        />
      ) : (
        <button
          onClick={() => setAddingTam(true)}
          className="flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 px-2 py-1.5 rounded-lg hover:bg-indigo-950/30 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add TAM
        </button>
      )}
    </div>
  )
}

function TamRow({
  tam, expanded, expandedPersonas, onToggle, onTogglePersona,
  onRename, onDelete, onAddPersona, onRenamePersona, onDeletePersona,
  onAddMicro, onRenameMicro, onDeleteMicro,
}: {
  tam: AudienceTam
  expanded: boolean
  expandedPersonas: Set<string>
  onToggle: () => void
  onTogglePersona: (id: string) => void
  onRename: (id: string, label: string) => Promise<boolean>
  onDelete: (id: string) => void
  onAddPersona: (parentId: string, label: string) => Promise<boolean>
  onRenamePersona: (id: string, label: string) => Promise<boolean>
  onDeletePersona: (id: string) => void
  onAddMicro: (parentId: string, label: string) => Promise<boolean>
  onRenameMicro: (id: string, label: string) => Promise<boolean>
  onDeleteMicro: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center bg-gray-900/60">
        <button
          onClick={onToggle}
          className="px-2 py-2 text-gray-500 hover:text-white"
          aria-label={expanded ? 'Collapse TAM' : 'Expand TAM'}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <EditableLabel
          label={tam.label}
          prefix="TAM"
          onSave={(v) => onRename(tam.id, v)}
        />
        <span className="text-[10px] text-gray-600 mr-2">
          {tam.personas.length} {tam.personas.length === 1 ? 'persona' : 'personas'}
        </span>
        <button
          onClick={() => onDelete(tam.id)}
          className="text-gray-600 hover:text-[#ff2a2b] p-1.5 mr-1"
          title="Delete TAM"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="bg-gray-950/40 px-3 py-2 space-y-1.5 border-t border-gray-800">
          {tam.personas.map(p => (
            <PersonaRow
              key={p.id}
              persona={p}
              expanded={expandedPersonas.has(p.id)}
              onToggle={() => onTogglePersona(p.id)}
              onRename={(label) => onRenamePersona(p.id, label)}
              onDelete={() => onDeletePersona(p.id)}
              onAddMicro={(label) => onAddMicro(p.id, label)}
              onRenameMicro={(id, label) => onRenameMicro(id, label)}
              onDeleteMicro={(id) => onDeleteMicro(id)}
            />
          ))}

          {adding ? (
            <InlineAddRow
              placeholder="Persona label, e.g. exhausted working mothers"
              value={newLabel}
              onChange={setNewLabel}
              indent={1}
              onSubmit={async () => {
                const ok = await onAddPersona(tam.id, newLabel)
                if (ok) { setNewLabel(''); setAdding(false) }
              }}
              onCancel={() => { setNewLabel(''); setAdding(false) }}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-950/30 transition-colors ml-5"
            >
              <Plus className="w-3 h-3" />
              Add persona
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function PersonaRow({
  persona, expanded, onToggle, onRename, onDelete,
  onAddMicro, onRenameMicro, onDeleteMicro,
}: {
  persona: AudiencePersona
  expanded: boolean
  onToggle: () => void
  onRename: (label: string) => Promise<boolean>
  onDelete: () => void
  onAddMicro: (label: string) => Promise<boolean>
  onRenameMicro: (id: string, label: string) => Promise<boolean>
  onDeleteMicro: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  return (
    <div className="border-l border-gray-800 pl-2 ml-1">
      <div className="flex items-center bg-gray-900/30 rounded">
        <button
          onClick={onToggle}
          className="px-1.5 py-1 text-gray-500 hover:text-white"
          aria-label={expanded ? 'Collapse persona' : 'Expand persona'}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <EditableLabel
          label={persona.label}
          prefix="Persona"
          onSave={onRename}
        />
        <span className="text-[10px] text-gray-600 mr-2">
          {persona.micro_personas.length}μ
        </span>
        <button onClick={onDelete} className="text-gray-600 hover:text-[#ff2a2b] p-1 mr-1" title="Delete persona">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && (
        <div className="pl-4 py-1 space-y-1">
          {persona.micro_personas.map(m => (
            <MicroPersonaRow
              key={m.id}
              micro={m}
              onRename={(label) => onRenameMicro(m.id, label)}
              onDelete={() => onDeleteMicro(m.id)}
            />
          ))}

          {adding ? (
            <InlineAddRow
              placeholder="Micro-persona, e.g. 38-yr-old mom of two who tried Ambien"
              value={newLabel}
              onChange={setNewLabel}
              indent={0}
              onSubmit={async () => {
                const ok = await onAddMicro(newLabel)
                if (ok) { setNewLabel(''); setAdding(false) }
              }}
              onCancel={() => { setNewLabel(''); setAdding(false) }}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded hover:bg-indigo-950/30 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add micro-persona
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function MicroPersonaRow({
  micro, onRename, onDelete,
}: {
  micro: AudienceMicroPersona
  onRename: (label: string) => Promise<boolean>
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1 group">
      <span className="text-gray-700 text-[10px] ml-1">·</span>
      <EditableLabel label={micro.label} onSave={onRename} compact />
      <button onClick={onDelete} className="text-gray-700 hover:text-[#ff2a2b] p-1 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete micro-persona">
        <Trash2 className="w-2.5 h-2.5" />
      </button>
    </div>
  )
}

function EditableLabel({ label, prefix, onSave, compact }: {
  label: string
  prefix?: string
  onSave: (label: string) => Promise<boolean>
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)

  async function commit() {
    if (value.trim() === label.trim()) { setEditing(false); return }
    const ok = await onSave(value)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setValue(label); setEditing(false) }
          }}
          onBlur={commit}
          className="input flex-1 min-w-0 !py-1 !text-xs"
        />
        <button onClick={commit} className="text-emerald-400 hover:text-emerald-300 p-1" aria-label="Save">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={() => { setValue(label); setEditing(false) }} className="text-gray-500 hover:text-white p-1" aria-label="Cancel">
          <X className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`flex-1 min-w-0 text-left flex items-center gap-1.5 group ${compact ? 'py-0.5 px-1' : 'py-1.5 px-1'} hover:bg-gray-800/40 rounded transition-colors`}
      title="Click to edit"
    >
      {prefix && <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 shrink-0">{prefix}</span>}
      <span className="text-xs text-gray-200 truncate">{label}</span>
      <Pencil className="w-2.5 h-2.5 text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  )
}

function InlineAddRow({ placeholder, value, onChange, onSubmit, onCancel, indent = 0 }: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => Promise<void> | void
  onCancel: () => void
  indent?: number
}) {
  return (
    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${indent * 16}px` }}>
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={e => {
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        className="input flex-1 !py-1 !text-xs"
      />
      <button onClick={() => onSubmit()} className="text-emerald-400 hover:text-emerald-300 p-1" aria-label="Save">
        <Check className="w-3 h-3" />
      </button>
      <button onClick={onCancel} className="text-gray-500 hover:text-white p-1" aria-label="Cancel">
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
