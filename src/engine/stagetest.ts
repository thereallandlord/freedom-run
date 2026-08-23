/**
 * Карточки партнёрского бизнеса приходят ПО СТАДИИ.
 *
 * 🔴 Решение Камиля: три стадии — сам двигатель, структура шевелится, ступенька
 * ранга. Внутри стадии случайно, но порядок становится жизненным, а не набором.
 * Механика в движке была давно (marketCardIsLive смотрит поле stages), а самих
 * стадий карточкам никто не проставил — фильтр не отсекал ничего.
 */
import { marketCards } from './data'
import { glСтадия } from './greenleaf'
import type { GlState } from './types'

const карты = marketCards('ru').filter((c) => c.kind === 'glEvent')
const безСтадии = карты.filter((c) => !(c as unknown as { stages?: number[] }).stages?.length)

console.log(`карточек партнёрского бизнеса: ${карты.length}`)
console.log(`без стадии: ${безСтадии.length}`)
for (const c of безСтадии) console.log('  ·', (c as { title?: string }).title)

/* Каждая стадия обязана иметь чем наполниться: пустая — это стол без событий. */
const счёт: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
for (const c of карты)
  for (const s of (c as unknown as { stages?: number[] }).stages ?? []) счёт[s] = (счёт[s] ?? 0) + 1
console.log('\nдоступно на стадии:', счёт)

/* И сама стадия должна считаться от объёма так, как обещано. */
const проба = (volume: number) => glСтадия({ volume } as GlState)
const ступеньки = [0, 50_000, 500_000, 5_000_000, 50_000_000].map((v) => `${v}→${проба(v)}`)
console.log('объём → стадия:', ступеньки.join('  '))

const плохо = безСтадии.length > 0 || Object.values(счёт).some((n) => n < 5)
console.log(плохо ? '\n❌ ЕСТЬ ПРОБЛЕМЫ' : '\n✅ СТАДИИ РАССТАВЛЕНЫ, КАЖДОЙ ЕСТЬ ЧЕМ НАПОЛНИТЬСЯ')
if (плохо) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
