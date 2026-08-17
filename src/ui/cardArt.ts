/**
 * Иллюстрация к карточке: одна точка поиска для всего интерфейса.
 *
 * Манифест собирает scripts/gen-illustrations.mjs — он же кладёт файлы в
 * public/cards и копию манифеста в src/data/card-art.json (из public импортировать
 * нельзя: он вне tsconfig include). Ключи разные, потому что карточки родом из разных мест:
 *   byId     — сделки, расходы, карточки рынка (у них есть id)
 *   byTicker — акции: один рисунок на бумагу, а не на каждую цену покупки
 *   byDream  — мечты Полосы свободы (у них нет id, только название)
 *   bySpace  — клетки-события: одна картинка на ТИП клетки
 *   byDeck   — обложки трёх колод, широкий кадр
 *   byDeckCard — те же обложки, кадрированные под карту (портрет, ~размер показа)
 *   byBoard  — полотно доски: поверхность и центральная плашка
 *
 * Картинки нет — возвращаем null, и карточка честно показывает эмодзи.
 * Так игра остаётся играбельной, даже если иллюстрации ещё не нарисованы.
 */
import manifest from '../data/card-art.json'

type Manifest = {
  byId?: Record<string, string>
  byTicker?: Record<string, string>
  byDream?: Record<string, string>
  bySpace?: Record<string, string>
  byDeck?: Record<string, string>
  byDeckCard?: Record<string, string>
  byBoard?: Record<string, string>
}

const M = manifest as Manifest

/** База сайта: на GitHub Pages приложение живёт в подпапке, а не в корне. */
const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? '/'

function url(path: string | undefined): string | null {
  if (!path) return null
  // В манифесте пути абсолютные («/cards/x.webp») — приклеиваем базу без двойного слэша.
  return BASE.replace(/\/$/, '') + path
}

export function artById(id: string | undefined): string | null {
  return id ? url(M.byId?.[id]) : null
}

export function artByTicker(symbol: string | undefined): string | null {
  return symbol ? url(M.byTicker?.[symbol]) : null
}

export function artByDream(name: string | undefined): string | null {
  return name ? url(M.byDream?.[name]) : null
}

export function artByDeck(theme: string | undefined): string | null {
  return theme ? url(M.byDeck?.[theme]) : null
}

/** Обложка колоды в пропорции карты: отдельный файл, а не обрезка большого. */
export function artByDeckCard(theme: string | undefined): string | null {
  return theme ? url(M.byDeckCard?.[theme]) : null
}

/** Полотно доски: 'surface' — поверхность, 'center' — центральная плашка. */
export function artBoard(part: 'plate' | 'surface' | 'center'): string | null {
  return url(M.byBoard?.[part])
}

export function artBySpace(kind: string | undefined): string | null {
  return kind ? url(M.bySpace?.[kind]) : null
}

/**
 * Универсальный поиск для карточки колоды: сначала по id, затем по тикеру.
 * У акций id свой на каждую цену (sd-doge-500), а рисунок общий на бумагу.
 */
export function artForCard(card: { id?: string; symbol?: string } | null | undefined): string | null {
  if (!card) return null
  return artById(card.id) ?? artByTicker(card.symbol)
}
