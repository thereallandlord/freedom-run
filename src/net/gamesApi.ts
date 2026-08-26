/**
 * Сыгранные партии: сохранение и чтение из кабинета.
 *
 * 🔴 Партия сохраняется ОДНОЙ записью, хотя шлют её все игроки сразу. Ключ
 * `game_key` считается из состава и сида — он одинаков у всех за столом, и
 * сервер сводит присылаемое в одну строку. Иначе после каждой партии в базе
 * появлялось бы столько копий, сколько человек нажало «закрыть».
 *
 * 🔴 Сохранение НЕ обязательно. Не вошёл, сервер не ответил, сеть легла —
 * разбор всё равно показывается, он считается на месте. Ничего не блокируем.
 */
import type { Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { freedomIncome, netWorth, totalExpenses } from '../engine/ledger'
import { authFetch } from './auth'

const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''

export interface SavedGame {
  id: string
  room: string | null
  finishedAt: string
  turns: number
  /** Состав стола — чтобы в списке было видно, с кем играли. */
  seats: { name: string; track: string }[]
  /** Незаконченная партия отдаётся вместе с журналом — по нему её и поднимают. */
  setup?: unknown
  journal?: unknown
  /** Моя строка в этой партии. */
  me: {
    seatId: string
    name: string
    profession: string | null
    track: string
    passive: number
    netWorth: number
    debrief: string | null
  }
}

/**
 * Короткий устойчивый ключ партии.
 *
 * Складываем сид, порядок мест и имена: у всех за столом это одно и то же,
 * а у двух разных партий совпасть практически не может. Хэш простой (FNV-1a)
 * и синхронный — тянуть криптографию ради ключа записи незачем.
 */
export function gameKey(table: Table): string {
  const parts = [
    table.seed,
    table.deckTheme,
    table.seats.map((s) => `${s.id}:${s.name}`).join('|'),
  ].join('~')
  let h = 0x811c9dc5
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // Второй проход задом наперёд — разводит строки, отличающиеся хвостом.
  let g = 0x9e3779b9
  for (let i = parts.length - 1; i >= 0; i--) {
    g ^= parts.charCodeAt(i)
    g = Math.imul(g, 0x85ebca6b) >>> 0
  }
  return `${h.toString(36)}${g.toString(36)}`
}

/**
 * Сохранить партию. Возвращает id записи или null, если сохранять некому
 * (человек не вошёл) или сервер не ответил.
 */
export async function saveGame(
  table: Table,
  events: TableEvent[],
  mySeatId: string | undefined,
  room: string | null,
  /** Партия окончена? Незаконченную храним, чтобы её можно было поднять. */
  finished = true,
): Promise<string | null> {
  try {
    const body = {
      gameKey: gameKey(table),
      room,
      turns: table.turnCounter,
      mySeatId: mySeatId ?? null,
      finished,
      // Журнал — правда партии: по нему её можно проиграть заново целиком.
      journal: events,
      /*
       * 🔴 Сетап хранится ТАКИМ, каким его примет движок: с `professionId` и
       * мечтой. Раньше сюда клали человекочитаемое название профессии — по
       * такой записи стол собрать было нельзя, то есть журнал хранился, а
       * поднять по нему партию всё равно не получалось.
       */
      setup: {
        seed: table.seed,
        deckTheme: table.deckTheme,
        seats: table.seats.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          isBot: s.isBot,
          professionId: s.ledger.profession?.id ?? '',
          dreamSpace: s.dreamSpace,
          botDifficulty: s.botDifficulty,
        })),
      },
      seats: table.seats.map((s) => ({
        seatId: s.id,
        name: s.name,
        isBot: !!s.isBot,
        profession: s.ledger.profession?.name ?? null,
        track: s.track,
        cash: Math.round(s.ledger.cash),
        passive: Math.round(freedomIncome(s.ledger, table.market.flow)),
        expenses: Math.round(totalExpenses(s.ledger)),
        netWorth: Math.round(netWorth(s.ledger)),
      })),
    }
    const res = await authFetch(`${BASE}/api/games`, { method: 'POST', body: JSON.stringify(body) })
    if (!res?.ok) return null
    const d = (await res.json()) as { id?: string }
    return d.id ?? null
  } catch {
    return null
  }
}

/** Дописать к сохранённой партии текст разбора от модели. */
export async function saveDebriefText(
  gameId: string,
  seatId: string,
  text: string,
): Promise<void> {
  try {
    /* 🔴 Номер партии в ТЕЛЕ, а не в пути: Vercel не доносит до функции
       ничего глубже двух сегментов, и запрос молча улетал в 404. */
    await authFetch(`${BASE}/api/game-debrief`, {
      method: 'POST',
      body: JSON.stringify({ gameId, seatId, text }),
    })
  } catch {
    /* разбор уже на экране; не сохранился — не беда */
  }
}

/** Мои партии, свежие сверху. Не вошёл — пустой список. */
export async function myGames(): Promise<SavedGame[]> {
  try {
    const res = await authFetch(`${BASE}/api/games`)
    if (!res?.ok) return []
    const d = (await res.json()) as { games?: SavedGame[] }
    return d.games ?? []
  } catch {
    return []
  }
}
