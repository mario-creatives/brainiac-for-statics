'use client'

import { useCallback, useState } from 'react'
import { Upload, ImageIcon } from 'lucide-react'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function UploadZone({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return
      onFile(file)
    },
    [onFile]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  return (
    <label
      className={`flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed
        transition-colors cursor-pointer
        ${disabled ? 'opacity-50 cursor-not-allowed border-gray-700 bg-gray-900' :
          dragging ? 'border-indigo-500 bg-indigo-950/30' : 'border-gray-700 bg-gray-900 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={disabled ? undefined : onDrop}
    >
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />
      <div className="flex flex-col items-center gap-2 pointer-events-none">
        {dragging
          ? <ImageIcon className="w-8 h-8 text-indigo-400" />
          : <Upload className="w-8 h-8 text-gray-500" />
        }
        <p className="text-sm text-gray-400">
          {dragging ? 'Drop to analyze' : 'Drag & drop or click to upload'}
        </p>
        <p className="text-xs text-gray-600">JPG, PNG, WebP — max 10MB</p>
      </div>
    </label>
  )
}
