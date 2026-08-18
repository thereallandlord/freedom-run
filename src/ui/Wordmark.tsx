/**
 * Логотип игры — одно место на всё приложение.
 *
 * Было по-разному в трёх экранах, и «GreenLeaf version» висело залитой
 * пилюлей. Пилюля читается как статус («beta», «new») и спорит с самим
 * названием; у издания игры место под названием, а не рядом с ним.
 * Поэтому здесь классический лого-блок: имя, под ним строка издания
 * прописными вразрядку.
 */

const SIZES = {
  sm: { box: 'size-8 rounded-[10px]', icon: 'size-[17px]', name: 'text-[15px]', edition: 'text-[8.5px]', editionInline: 'text-[10.5px]' },
  md: { box: 'size-9 rounded-xl', icon: 'size-[19px]', name: 'text-[17px]', edition: 'text-[9px]', editionInline: 'text-[12px]' },
  lg: { box: 'size-14 rounded-2xl', icon: 'size-7', name: 'text-[30px] sm:text-[34px]', edition: 'text-[11px]', editionInline: 'text-[17px] sm:text-[19px]' },
} as const

function Leaf({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  )
}

export function Wordmark({
  size = 'md',
  edition = true,
  className = '',
  style,
}: {
  size?: keyof typeof SIZES
  /** Строку издания можно убрать там, где место дорого (шапка стола). */
  edition?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const s = SIZES[size]
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`} style={style}>
      <span
        className={`grid shrink-0 place-items-center bg-accent text-accent-ink shadow-glow ${s.box}`}
      >
        <Leaf className={s.icon} />
      </span>
      {/*
        🔴 «GreenLeaf version» стоит В СТРОКУ с названием тем же шрифтом, только
        мельче (правка Камиля 18.08). Прописными вразрядку под названием оно
        читалось как подпись к чужому продукту, а это одно имя: Cashflow
        GreenLeaf version.
      */}
      <span className="flex items-baseline gap-1.5 leading-none">
        <span className={`font-display font-bold tracking-[-0.03em] ${s.name}`}>Cashflow</span>
        {edition && (
          <span className={`font-display font-bold tracking-[-0.02em] text-accent/85 ${s.editionInline}`}>
            GreenLeaf version
          </span>
        )}
      </span>
    </span>
  )
}
