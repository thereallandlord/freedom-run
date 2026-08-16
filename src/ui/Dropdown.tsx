import { useEffect, useRef, useState } from 'react'

export interface Option<T> {
  value: T
  label: string
  hint?: string
}

/**
 * Свой выпадающий список. Нативный <select> не используем — он выпадает
 * из оформления и по-разному выглядит на разных системах.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Выбрать',
  className = '',
}: {
  value: T | null
  options: Option<T>[]
  onChange: (v: T) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-left text-sm hover:border-emerald-500/60"
      >
        <span className={current ? '' : 'text-[var(--muted)]'}>
          {current ? current.label : placeholder}
        </span>
        <span className={`text-[10px] text-[var(--muted)] transition ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <div className="pop-in absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[var(--shadow-pop)]">
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--panel-2)] ${
                o.value === value ? 'text-emerald-400' : ''
              }`}
            >
              <span>{o.label}</span>
              {o.hint && <span className="tabnum shrink-0 text-xs text-[var(--muted)]">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
