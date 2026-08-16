/**
 * Значки клеток доски.
 *
 * 🔴 Почему не эмодзи. Клетка на доске — 26 пикселей. Эмодзи в этом размере
 * превращается в цветное пятно: у него своя внутренняя детализация, свои поля
 * и своя палитра, которая спорит с цветом клетки. Линейный значок в 14 пикселей
 * читается, наследует цвет клетки и одинаково выглядит на всех системах —
 * эмодзи на Windows и Android рисуются вообще другими картинками.
 *
 * Все значки нарисованы в одной сетке 24×24 с одной толщиной штриха.
 */
import type { ReactNode } from 'react'

const S = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Возможность — портфель со сделкой. */
export const IcDeal = (
  <svg {...S}>
    <rect x="2.5" y="7.5" width="19" height="13" rx="2.2" />
    <path d="M15.5 20.5V6a2 2 0 0 0-2-2h-3a2 2 0 0 0-2 2v14.5" />
  </svg>
)

/** Рынок — свеча вверх. */
export const IcMarket = (
  <svg {...S}>
    <path d="M3 20h18" />
    <path d="M7 16V9M12 16V5M17 16v-4" />
  </svg>
)

/** Трата — пакет из магазина. */
export const IcSpend = (
  <svg {...S}>
    <path d="M4.5 8h15l-1.2 12.2a1.6 1.6 0 0 1-1.6 1.3H7.3a1.6 1.6 0 0 1-1.6-1.3z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
)

/** Благотворительность — раскрытая ладонь с сердцем. */
export const IcCharity = (
  <svg {...S}>
    <path d="M12 10.2c1.6-2.4 5.2-1.3 5.2 1.5 0 2.3-3 4.2-5.2 5.8-2.2-1.6-5.2-3.5-5.2-5.8 0-2.8 3.6-3.9 5.2-1.5Z" />
    <path d="M3.5 20.5h17" />
  </svg>
)

/** Зарплата — банкнота. */
export const IcPaycheck = (
  <svg {...S}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 10v4M18 10v4" />
  </svg>
)

/** Питомец — кошачья мордочка. */
export const IcPet = (
  <svg {...S}>
    <path d="M4.5 9.5 5 4l4 3.2M19.5 9.5 19 4l-4 3.2" />
    <path d="M12 20.5c-4 0-7-2.7-7-6.1S8 7.5 12 7.5s7 3.5 7 6.9-3 6.1-7 6.1Z" />
    <path d="M10 13.5h.01M14 13.5h.01" />
  </svg>
)

/** Увольнение — свеча вниз. */
export const IcLayoff = (
  <svg {...S}>
    <path d="M3 6.5 10 13l3.5-3.5L21 17" />
    <path d="M21 12.5V17h-4.5" />
  </svg>
)

/** День дохода — монеты стопкой. */
export const IcCashDay = (
  <svg {...S}>
    <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
    <path d="M5 6.5v5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-5" />
    <path d="M5 11.5v5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-5" />
  </svg>
)

/** Инвестиция — здание. */
export const IcBusiness = (
  <svg {...S}>
    <path d="M4 20.5V6.2a1.6 1.6 0 0 1 1-1.5l6-2.2a1 1 0 0 1 1.3 1v17" />
    <path d="M12.3 9.5h6a1.6 1.6 0 0 1 1.7 1.6v9.4" />
    <path d="M3 20.5h18M7.5 8.5v.01M7.5 12.5v.01M7.5 16.5v.01M16 13.5v.01M16 17v.01" />
  </svg>
)

/** Мечта — звезда. */
export const IcDream = (
  <svg {...S}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
  </svg>
)

/** Рисковый проект — ракета. */
export const IcVenture = (
  <svg {...S}>
    <path d="M12 2.5c3 2.2 4.6 5.5 4.6 9.2l-1.8 4.4H9.2L7.4 11.7C7.4 8 9 4.7 12 2.5Z" />
    <circle cx="12" cy="10" r="1.9" />
    <path d="M9.2 16.1 7 19.4l3.2-.7M14.8 16.1 17 19.4l-3.2-.7" />
  </svg>
)

/** Налоговая проверка — документ с печатью. */
export const IcTax = (
  <svg {...S}>
    <path d="M6 3.5h8.5L19 8v12.5H6z" />
    <path d="M14 3.5V8h5" />
    <path d="M9 12.5h6M9 16h4" />
  </svg>
)

/** Иск — весы. */
export const IcLawsuit = (
  <svg {...S}>
    <path d="M12 3.5v17M5 20.5h14M4 8.5h16M7.5 8.5 5 14h5zM16.5 8.5 14 14h5z" />
  </svg>
)

/** Развод — разбитое сердце. */
export const IcDivorce = (
  <svg {...S}>
    <path d="M12 20.5C8.6 18 4 15 4 10.8 4 6.6 9.4 5.4 12 9c2.6-3.6 8-2.4 8 1.8 0 4.2-4.6 7.2-8 9.7Z" />
    <path d="m12 9-1.8 3.2 3.2 1.5-2 3.6" />
  </svg>
)

export const RAT_ICON: Record<string, ReactNode> = {
  opportunity: IcDeal,
  market: IcMarket,
  doodad: IcSpend,
  charity: IcCharity,
  paycheck: IcPaycheck,
  baby: IcPet,
  downsized: IcLayoff,
}

export const FAST_ICON: Record<string, ReactNode> = {
  cashflowDay: IcCashDay,
  business: IcBusiness,
  dream: IcDream,
  venture: IcVenture,
  taxAudit: IcTax,
  lawsuit: IcLawsuit,
  divorce: IcDivorce,
  downsized: IcLayoff,
  charity: IcCharity,
}
