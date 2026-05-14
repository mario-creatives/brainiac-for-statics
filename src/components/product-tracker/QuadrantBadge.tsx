import type { Quadrant } from '@/lib/quadrant'

const STYLES: Record<Quadrant, string> = {
  winner:      'text-emerald-400 border-emerald-800/60',
  promising:   'text-indigo-300 border-indigo-800/60',
  investigate: 'text-amber-400 border-amber-800/60',
  loser:       'text-[#ff2a2b] border-red-900/60',
}

const LABELS: Record<Quadrant, string> = {
  winner: 'Winner',
  promising: 'Promising',
  investigate: 'Investigate',
  loser: 'Loser',
}

export function QuadrantBadge({ quadrant, override }: { quadrant: Quadrant | null; override?: boolean }) {
  if (!quadrant) {
    return (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-gray-900 text-gray-500 border-gray-800">
        Pending
      </span>
    )
  }
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border bg-gray-900 ${STYLES[quadrant]}`}>
      {LABELS[quadrant]}{override ? '*' : ''}
    </span>
  )
}
