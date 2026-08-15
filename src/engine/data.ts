import decksJson from '../data/decks.json'
import professionsJson from '../data/professions.json'
import boardsJson from '../data/boards.json'
import tickersJson from '../data/tickers.json'
import miscJson from '../data/misc.json'
import ruCards from '../data/ru.cards.json'
import ruProfessions from '../data/ru.professions.json'
import ruFastSpaces from '../data/ru.misc2.json'
import type {
  DealCard,
  DoodadCard,
  FastSpace,
  MarketCard,
  Profession,
  RatSpace,
} from './types'

export type Locale = 'ru' | 'en'
export type DeckTheme = 'classic' | 'offshore'

export const PROFESSIONS = professionsJson as unknown as Profession[]
export const RAT_BOARD = boardsJson.RAT_BOARD as RatSpace[]
export const RAT_BOARD_SIZE = RAT_BOARD.length
export const FAST_BOARD = boardsJson.FAST_BOARD as unknown as FastSpace[]
export const FAST_BOARD_SIZE = FAST_BOARD.length
export const TICKERS = tickersJson as unknown as Record<string, { name: string; range: [number, number] }>
export const PETS = miscJson.DOGS as { id: string; name: string }[]

const D = decksJson as any

export function smallDeals(theme: DeckTheme): DealCard[] {
  return (theme === 'offshore' ? D.OFFSHORE_SMALL_DEALS : D.SMALL_DEALS) as DealCard[]
}
export function bigDeals(theme: DeckTheme): DealCard[] {
  return (theme === 'offshore' ? D.OFFSHORE_BIG_DEALS : D.BIG_DEALS) as DealCard[]
}
export function marketCards(theme: DeckTheme): MarketCard[] {
  return (theme === 'offshore' ? D.OFFSHORE_MARKET_CARDS : D.MARKET_CARDS) as MarketCard[]
}
export const DOODADS = D.DOODADS as DoodadCard[]

// ─── Локализация ──────────────────────────────────────────────────────

const RU_CARDS = ruCards as Record<string, { title: string; flavor: string }>
const RU_PROF = ruProfessions as Record<string, string>
const RU_FAST = ruFastSpaces as Record<string, { name: string; flavor: string }>

export function cardText(
  card: { id: string; title: string; flavor: string },
  locale: Locale,
): { title: string; flavor: string } {
  if (locale === 'ru') {
    const t = RU_CARDS[card.id]
    if (t) return t
  }
  return { title: card.title, flavor: card.flavor }
}

/**
 * Активный язык. Названия купленных активов записываются в кошелёк уже
 * переведёнными — иначе в отчёте о доходах вперемешку два языка.
 */
let CURRENT_LOCALE: Locale = 'ru'
export function setLocale(l: Locale) {
  CURRENT_LOCALE = l
}
export function getLocale(): Locale {
  return CURRENT_LOCALE
}
export function localizedCardTitle(card: { id: string; title: string; flavor: string }): string {
  return cardText(card, CURRENT_LOCALE).title
}
export function localizedSpaceName(index: number): string {
  const space = FAST_BOARD[index] as any
  return fastSpaceText(index, CURRENT_LOCALE)?.name ?? space.name ?? ''
}

export function professionName(p: Profession, locale: Locale): string {
  return locale === 'ru' ? (RU_PROF[p.id] ?? p.name) : p.name
}

export function fastSpaceText(
  index: number,
  locale: Locale,
): { name: string; flavor: string } | null {
  const space = FAST_BOARD[index] as any
  if (!('name' in space)) return null
  if (locale === 'ru') {
    const t = RU_FAST[String(index)]
    if (t) return t
  }
  return { name: space.name, flavor: space.flavor ?? '' }
}

/** Все клетки-мечты Полосы свободы — из них игрок выбирает свою на старте. */
export function dreamSpaces(locale: Locale = 'ru'): { index: number; name: string; price: number }[] {
  const out: { index: number; name: string; price: number }[] = []
  FAST_BOARD.forEach((s, i) => {
    if (s.type !== 'dream') return
    out.push({ index: i, name: fastSpaceText(i, locale)?.name ?? s.name, price: s.price })
  })
  return out
}

export const TOKEN_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#f97316',
] as const
