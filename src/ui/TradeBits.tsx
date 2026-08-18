/**
 * Общие детали окон сделок: рамка, строки, ползунок суммы и полоса честного
 * коридора. Собраны в одном месте, чтобы три экрана сделок выглядели одинаково
 * и не разъехались при правках.
 */
import type { Seat } from '../engine/types'
import { PRICE_CEIL, PRICE_FLOOR, priceAllowed } from '../engine/trades'
import { money } from './PlayerPanel'

export function TradeShell({
  title,
  subtitle,
  icon,
  onClose,
  layer = 'z-[60]',
  children,
}: {
  title: string
  subtitle?: string
  icon?: string
  onClose?: () => void
  layer?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`modal-layer fixed inset-0 ${layer} grid place-items-center bg-black/70 p-3 sm:p-4`}
      onClick={onClose}
    >
      <div
        className="pop-in panel max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl p-4 shadow-[var(--shadow-pop)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">
              {icon ? `${icon} ` : ''}
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-[12px] leading-snug text-[var(--muted)]">{subtitle}</p>}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="-mr-1 -mt-1 shrink-0 px-2 py-1 text-[var(--muted)] hover:text-[var(--ink)]"
              aria-label="Закрыть"
            >
              ✕
            </button>
          )}
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  )
}

/** Блок-плитка внутри окна: заголовок мелким капсом и содержимое. */
export function TradeBlock({
  title,
  children,
  accent,
}: {
  title?: string
  children: React.ReactNode
  accent?: 'good' | 'warn'
}) {
  const skin =
    accent === 'good'
      ? 'border-emerald-500/40 bg-emerald-500/[0.08]'
      : accent === 'warn'
        ? 'border-amber-500/40 bg-amber-500/[0.10]'
        : 'panel-2'
  return (
    <div className={`rounded-xl border p-3 ${skin}`}>
      {title && (
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

export function TradeLine({
  label,
  value,
  strong,
  valueClass = '',
}: {
  label: string
  value: string
  strong?: boolean
  valueClass?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[13px]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`tabnum shrink-0 ${strong ? 'font-bold' : ''} ${valueClass}`}>{value}</span>
    </div>
  )
}

export function SeatTag({ seat }: { seat: Seat }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: seat.color }} />
      {seat.name}
      {seat.isBot && <span className="text-[10px] text-violet-300">🤖</span>}
    </span>
  )
}

/** Шаг ползунка «по-человечески»: 1 / 2 / 5 на нужном порядке. */
export function niceStep(span: number): number {
  const raw = Math.max(1, span / 20)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const mult = raw / pow
  return (mult >= 5 ? 5 : mult >= 2 ? 2 : 1) * pow
}

export function MoneySlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  note,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  note?: string
}) {
  const span = Math.max(1, max - min)
  const s = step ?? niceStep(span)
  const safe = Math.min(Math.max(value, min), max)
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
          {label}
        </span>
        <span className="tabnum text-base font-black">{money(safe)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={s}
        value={safe}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full accent-emerald-500"
        aria-label={label}
      />
      <div className="flex justify-between text-[10px] text-[var(--muted)]">
        <span className="tabnum">{money(min)}</span>
        {note && <span className="px-2 text-center">{note}</span>}
        <span className="tabnum">{money(max)}</span>
      </div>
    </div>
  )
}

/**
 * Честный коридор: цена сделки между игроками должна лежать вокруг настоящей
 * стоимости. Показываем не запрет, а линейку — где сейчас стоит цена.
 */
export function Corridor({ asked, fair }: { asked: number; fair: number }) {
  if (fair <= 0) {
    return (
      <p className="text-[11px] leading-snug text-[var(--muted)]">
        Чистой стоимости у сделки нет — цену стол не ограничивает.
      </p>
    )
  }
  const k = asked / fair
  const ok = priceAllowed(asked, fair)
  const pos = Math.min(100, Math.max(0, ((k - PRICE_FLOOR) / (PRICE_CEIL - PRICE_FLOOR)) * 100))
  const fairPos = ((1 - PRICE_FLOOR) / (PRICE_CEIL - PRICE_FLOOR)) * 100
  return (
    <div>
      <div className="relative mt-1 h-1.5 rounded-full bg-[var(--line)]">
        <div className="absolute inset-0 rounded-full bg-emerald-500/25" />
        <span
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--muted)]"
          style={{ left: `${fairPos}%` }}
        />
        <span
          className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
            ok ? 'border-emerald-500 bg-[var(--panel)]' : 'border-rose-400 bg-[var(--panel)]'
          }`}
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className={`chip ${ok ? 'chip-good' : 'chip-bad'}`}>
          {ok ? 'в честном коридоре' : 'вне коридора'}
        </span>
        <span className="tabnum text-[var(--muted)]">
          справедливо {money(fair)} · это {Math.round(k * 100)}% от неё
        </span>
      </div>
    </div>
  )
}

/** Окупаемость — главная цифра для того, кто решает, брать или нет. */
export function payback(need: number, monthly: number): string {
  if (monthly <= 0) return 'дохода нет'
  return `${Math.max(1, Math.round(need / monthly))} мес`
}
