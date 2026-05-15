'use client'

import { useState, type ReactNode } from 'react'

interface Props {
  /** What the user hovers — the jargon term, button, etc. */
  children: ReactNode
  /** The plain-English explanation. */
  text: string
  /** Where the bubble appears relative to the child. */
  side?: 'top' | 'bottom' | 'right'
  /** Optional max width in tailwind units (default 64 = w-64). */
  width?: 'sm' | 'md' | 'lg'
}

const SIDE_CLASSES: Record<NonNullable<Props['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}

const WIDTH_CLASSES: Record<NonNullable<Props['width']>, string> = {
  sm: 'w-44',
  md: 'w-56',
  lg: 'w-72',
}

export function Tooltip({ children, text, side = 'top', width = 'md' }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className="cursor-help underline decoration-dotted decoration-gray-600 underline-offset-2">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 ${SIDE_CLASSES[side]} ${WIDTH_CLASSES[width]} bg-gray-950 border border-gray-700 rounded-md px-2.5 py-1.5 text-[10px] text-gray-200 leading-snug shadow-xl pointer-events-none`}
        >
          {text}
        </span>
      )}
    </span>
  )
}
