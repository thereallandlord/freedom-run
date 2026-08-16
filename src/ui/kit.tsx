/**
 * Общие кирпичи интерфейса.
 *
 * Зачем: каждый экран верстался сам по себе, и они разъезжались при любой
 * правке — ширина, отступы, заголовки секций, подписи полей везде были свои.
 * Теперь единство держится конструкцией, а не аккуратностью: экран собирается
 * из этих кирпичей, и «выглядеть иначе» ему просто нечем.
 */
import type { ReactNode } from 'react'

/** Ширины страниц. Одно место, где решается, насколько широк экран. */
const WIDTH = {
  form: 'max-w-2xl', // ввод: имя, цвет, профессия
  room: 'max-w-4xl', // лобби и настройка партии — там таблицы и карточки
  wide: 'max-w-5xl', // посадочная
} as const

export function Page({
  width = 'room',
  children,
  className = '',
}: {
  width?: keyof typeof WIDTH
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mx-auto w-full ${WIDTH[width]} px-4 pb-16 pt-5 sm:px-6 sm:pt-7 ${className}`}>
      {children}
    </div>
  )
}

/** Карточка-панель. Радиус и отступы у всех одинаковые — это и есть «одна семья». */
export function Card({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <div className={`panel rounded-2xl ${pad ? 'p-5 sm:p-6' : ''} ${className}`}>{children}</div>
  )
}

/** Шапка секции: надзаголовок акцентом, название, пояснение. */
export function CardHead({
  kicker,
  title,
  hint,
  end,
}: {
  kicker?: string
  title: string
  hint?: ReactNode
  end?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {kicker && (
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.09em] text-accent">
            {kicker}
          </div>
        )}
        <h2 className="text-lg font-bold leading-tight sm:text-xl">{title}</h2>
        {hint && <p className="mt-1.5 text-sm leading-relaxed text-muted">{hint}</p>}
      </div>
      {end && <div className="shrink-0">{end}</div>}
    </div>
  )
}

/** Поле формы: подпись видна всегда, ошибка живёт рядом с полем, а не сверху. */
export function Field({
  label,
  hint,
  error,
  end,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  end?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        {end && <span className="ml-auto">{end}</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs font-medium text-[var(--bad)]">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-xs leading-snug text-muted">{hint}</span>
      )}
    </label>
  )
}

/** Текстовое поле — один вид на все экраны. */
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return (
    <input
      {...rest}
      className={`w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-[15px] outline-none transition duration-150 placeholder:text-muted/60 focus:border-accent ${className}`}
    />
  )
}

/** Тонкая линия между блоками внутри карточки. */
export function Rule({ className = '' }: { className?: string }) {
  return <div className={`h-px bg-[var(--line)] ${className}`} />
}
