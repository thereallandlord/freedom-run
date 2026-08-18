import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface Option<T> {
  value: T
  label: string
  hint?: string
}

/**
 * Свой выпадающий список. Нативный <select> не используем — он выпадает
 * из оформления и по-разному выглядит на разных системах.
 *
 * 🔴 Список рисуется ПОРТАЛОМ в body, а не рядом с кнопкой. Причина: любой
 * предок с `overflow:hidden` (а такие карточки у нас почти все) обрезал бы
 * его, и длинный список профессий открывался «внутри контейнера». Позиция
 * считается от кнопки и пересчитывается при прокрутке и смене размера окна.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Выбрать',
  className = '',
  buttonClassName,
  minListWidth = 0,
}: {
  value: T | null
  options: Option<T>[]
  onChange: (v: T) => void
  placeholder?: string
  className?: string
  /** Другой облик кнопки — например, чтобы встать в ряд к кнопкам верхней строки. */
  buttonClassName?: string
  /** Список бывает шире кнопки: узкая кнопка не должна резать названия. */
  minListWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 288, up: false })
  const current = options.find((o) => o.value === value)

  const place = useCallback(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 6
    const margin = 12
    const below = window.innerHeight - r.bottom - gap - margin
    const above = r.top - gap - margin
    // Не хватает места снизу — открываемся вверх, а не упираемся в край экрана.
    const up = below < 200 && above > below
    setPos({
      left: r.left,
      top: up ? r.top - gap : r.bottom + gap,
      width: r.width,
      maxHeight: Math.max(140, Math.min(288, up ? above : below)),
      up,
    })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || list.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // capture: список висит вне контейнера, поэтому ловим прокрутку любого предка.
    const onMove = () => place()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          buttonClassName ??
          `flex w-full items-center justify-between gap-2 rounded-xl border bg-panel px-3.5 py-2.5 text-left text-sm outline-none transition duration-150 ${
            open ? 'border-accent' : 'border-line hover:border-accent/55'
          }`
        }
      >
        <span className={`truncate ${current ? '' : 'text-muted'}`}>
          {current ? current.label : placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-[13px] shrink-0 text-muted transition duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            className="pop-in fixed z-[80] overflow-auto rounded-xl border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
            style={{
              left: pos.left,
              top: pos.up ? undefined : pos.top,
              bottom: pos.up ? window.innerHeight - pos.top : undefined,
              width: Math.max(pos.width, minListWidth),
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((o) => {
              const on = o.value === value
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition duration-100 hover:bg-panel2 ${
                    on ? 'bg-accent/10 font-semibold text-accent' : ''
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="tabnum shrink-0 text-xs text-muted">{o.hint}</span>}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
