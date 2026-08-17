import decksJson from '../data/decks.json'
import decksRuJson from '../data/decks_ru.json'
import professionsJson from '../data/professions.json'
import professionsRuJson from '../data/professions_ru.json'
import boardsJson from '../data/boards.json'
import tickersJson from '../data/tickers.json'
import miscJson from '../data/misc.json'
import eventsRuJson from '../data/events_ru.json'
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
export type DeckTheme = 'classic' | 'offshore' | 'ru'

export const PROFESSIONS = professionsJson as unknown as Profession[]
export const PROFESSIONS_RU = professionsRuJson as unknown as Profession[]

export function professionsFor(theme: DeckTheme): Profession[] {
  return theme === 'ru' ? PROFESSIONS_RU : PROFESSIONS
}

/**
 * Случайная профессия из уровня, близкого к уже занятым местам.
 * Иначе за столом оказываются топ-менеджер на 500к и продавец на 90к,
 * и партия теряет смысл ещё до первого броска.
 */
export function randomProfessionNear(
  theme: DeckTheme,
  takenIds: string[],
  rnd: () => number = Math.random,
): Profession {
  const pool = [...professionsFor(theme)].sort((a, b) => a.salary - b.salary)
  const taken = takenIds
    .map((id) => pool.findIndex((p) => p.id === id))
    .filter((i) => i >= 0)
  if (!taken.length) return pool[Math.floor(rnd() * pool.length)]

  // Окно вокруг среднего уровня стола: ±2 ступени по зарплате.
  const centre = Math.round(taken.reduce((s, i) => s + i, 0) / taken.length)
  const from = Math.max(0, centre - 2)
  const to = Math.min(pool.length - 1, centre + 2)
  // Одинаковая профессия у двоих за столом выглядит как недоработка,
  // поэтому занятые из окна убираем — и расширяем его, если не осталось никого.
  const taken_ids = new Set(takenIds)
  const free = (a: number, b: number) =>
    pool.slice(a, b + 1).filter((p) => !taken_ids.has(p.id))
  const window = free(from, to)
  if (window.length) return window[Math.floor(rnd() * window.length)]
  const wide = free(0, pool.length - 1)
  if (wide.length) return wide[Math.floor(rnd() * wide.length)]
  return pool[Math.floor(rnd() * pool.length)]
}

export const RAT_BOARD = boardsJson.RAT_BOARD as RatSpace[]
export const RAT_BOARD_SIZE = RAT_BOARD.length

const FAST_BOARD_CLASSIC = boardsJson.FAST_BOARD as unknown as FastSpace[]
const FAST_BOARD_RU = ((decksRuJson as any).FAST_BOARD_RU ?? FAST_BOARD_CLASSIC) as FastSpace[]

/** Активное поле Полосы свободы — задаётся темой при создании стола. */
let ACTIVE_FAST_BOARD: FastSpace[] = FAST_BOARD_CLASSIC

export function setFastBoardTheme(theme: DeckTheme) {
  ACTIVE_FAST_BOARD = theme === 'ru' ? FAST_BOARD_RU : FAST_BOARD_CLASSIC
}

export function fastBoard(): FastSpace[] {
  return ACTIVE_FAST_BOARD
}

export function fastBoardSize(): number {
  return ACTIVE_FAST_BOARD.length
}
export const TICKERS = tickersJson as unknown as Record<string, { name: string; range: [number, number] }>
/* Только коты: собак в доме не заводим — халяльная версия. */
export const PETS = miscJson.PETS as { id: string; name: string }[]
export const WORLD_EVENTS = (eventsRuJson as any).WORLD_EVENTS_RU as import('./types').WorldEvent[]

const D = decksJson as any
const DRU = decksRuJson as any

export function smallDeals(theme: DeckTheme): DealCard[] {
  if (theme === 'ru') return DRU.SMALL_DEALS_RU as DealCard[]
  return (theme === 'offshore' ? D.OFFSHORE_SMALL_DEALS : D.SMALL_DEALS) as DealCard[]
}
export function bigDeals(theme: DeckTheme): DealCard[] {
  if (theme === 'ru') return DRU.BIG_DEALS_RU as DealCard[]
  return (theme === 'offshore' ? D.OFFSHORE_BIG_DEALS : D.BIG_DEALS) as DealCard[]
}
export function marketCards(theme: DeckTheme): MarketCard[] {
  if (theme === 'ru') return DRU.MARKET_CARDS_RU as MarketCard[]
  return (theme === 'offshore' ? D.OFFSHORE_MARKET_CARDS : D.MARKET_CARDS) as MarketCard[]
}
export function doodads(theme: DeckTheme): DoodadCard[] {
  return theme === 'ru' ? (DRU.DOODADS_RU as DoodadCard[]) : (D.DOODADS as DoodadCard[])
}
/** @deprecated используйте doodads(theme) */
export const DOODADS = D.DOODADS as DoodadCard[]

// ─── Локализация ──────────────────────────────────────────────────────

const RU_CARDS = ruCards as Record<string, { title: string; flavor: string }>
const RU_PROF = ruProfessions as Record<string, string>
const RU_FAST = ruFastSpaces as Record<string, { name: string; flavor: string }>

/**
 * Заголовок и описание карты для показа.
 *
 * 🔴 В русской колоде описание лежит в поле `text`, а не `flavor` — и до
 * 17.08 игрок не видел описания у 90 карт из 142: в окне был только заголовок
 * и цифры. Читаем оба поля, иначе половина работы над текстами уходит в стол.
 */
export function cardText(
  card: { id: string; title: string; flavor?: string; text?: string },
  locale: Locale,
): { title: string; flavor: string } {
  if (locale === 'ru') {
    const t = RU_CARDS[card.id]
    if (t) return t
  }
  return { title: card.title, flavor: card.flavor ?? card.text ?? '' }
}

let ACTIVE_THEME: DeckTheme = 'classic'
export function setActiveTheme(t: DeckTheme) {
  ACTIVE_THEME = t
}
export function activeTheme(): DeckTheme {
  return ACTIVE_THEME
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
  const space = fastBoard()[index] as any
  return fastSpaceText(index, CURRENT_LOCALE)?.name ?? space?.name ?? ''
}

export function professionName(p: Profession, locale: Locale): string {
  // В RU-теме имена профессий уже русские прямо в данных — не подменяем.
  if (ACTIVE_THEME === 'ru') return p.name
  return locale === 'ru' ? (RU_PROF[p.id] ?? p.name) : p.name
}

export function fastSpaceText(
  index: number,
  locale: Locale,
): { name: string; flavor: string } | null {
  const space = fastBoard()[index] as any
  if (!space || !('name' in space)) return null
  // В RU-теме тексты уже русские прямо в данных поля.
  if (ACTIVE_THEME !== 'ru' && locale === 'ru') {
    const t = RU_FAST[String(index)]
    if (t) return t
  }
  return { name: space.name, flavor: space.flavor ?? '' }
}

/** Все клетки-мечты Полосы свободы — из них игрок выбирает свою на старте. */
export function dreamSpaces(locale: Locale = 'ru'): { index: number; name: string; price: number }[] {
  const out: { index: number; name: string; price: number }[] = []
  fastBoard().forEach((s, i) => {
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
