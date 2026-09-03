/**
 * Мерилка поведения ботов: что они на самом деле делают за партию.
 *
 * 🔴 Заводится потому, что «бот работает» и «бот похож на человека» — разные
 * вещи, и вторую на глаз не проверишь. Проверка чужими глазами показала:
 * бот продаёт бумаги в 100% случаев при первой цене, ни разу не отказывает
 * себе в хотелке, ни разу не берёт промоушен партнёрского бизнеса и почти
 * никогда не смотрит малую колоду. По журналу партии этого не видно.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import { netWorth } from './ledger'
import type { Table, BotDifficulty } from './types'

const ПАРТИЙ = Number(process.env.G || 30)
const ХОДОВ = Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.H || 600)

function стол(seed: number, уровень: BotDifficulty): Table {
  return createTable({
    seed,
    deckTheme: 'ru',
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      name: `Б${i}`,
      professionId: ['engineer', 'doctor', 'teacher', 'driver'][i],
      /*
       * 🔴 НАСТОЯЩИЕ КЛЕТКИ МЕЧТЫ, а не произвольные индексы. Раньше здесь
       * стояло `3 + i * 4`, и три места из четырёх целились в клетку, которая
       * мечтой не является: победить мечтой они не могли в принципе, а замер
       * молча показывал заниженные выходы и длину партии.
       */
      dreamSpace: [2, 13, 24, 39][i],
      isBot: true,
      botDifficulty: уровень,
    })),
  } as never)
}

interface Счёт {
  событий: Record<string, number>
  колода: { small: number; big: number }
  вышли: number
  мест: number
  капитал: number[]
  ходов: number[]
}

function прогон(уровень: BotDifficulty): Счёт {
  const с: Счёт = {
    событий: {},
    колода: { small: 0, big: 0 },
    вышли: 0,
    мест: 0,
    капитал: [],
    ходов: [],
  }
  for (let seed = 1; seed <= ПАРТИЙ; seed++) {
    let t = стол(seed, уровень)
    let к = seed * 7919
    for (let i = 0; i < ХОДОВ && t.phase !== 'finished'; i++) {
      const ход = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
      if (!ход) break
      с.событий[ход.type] = (с.событий[ход.type] ?? 0) + 1
      if (ход.type === 'CHOOSE_DEAL') с.колода[(ход as { size: 'small' | 'big' }).size] += 1
      const до = t
      t = applyTableEvent(t, ход)
      if (t === до) {
        /*
         * 🔴 Ровно как живой водитель ботов (useGame): отказ движка НЕ вешает
         * стол — бот молча заканчивает ход и теряет карточку. Считаем такие
         * случаи отдельно: это потерянные ходы, из-за них партия с ботом и
         * выглядит безжизненной.
         */
        с.событий['ОТКАЗ:' + ход.type] = (с.событий['ОТКАЗ:' + ход.type] ?? 0) + 1
        t = applyTableEvent(до, { type: 'END_TURN' } as never)
        if (t === до) break
        continue
      }
    }
    for (const s of t.seats) {
      с.мест += 1
      if (s.track === 'fast') с.вышли += 1
      с.капитал.push(netWorth(s.ledger))
    }
    с.ходов.push(t.turnCounter)
  }
  return с
}

const медиана = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  return b.length ? b[Math.floor(b.length / 2)] : 0
}
const млн = (n: number) => `${(n / 1e6).toFixed(1)} млн`

const интересно = [
  'CHOOSE_DEAL', 'BUY_DEAL', 'PASS_CARD', 'BUY_STOCK_SHARES', 'SELL_STOCK_LOT',
  'PAY_DOODAD', 'SKIP_WANT', 'TAKE_LOAN', 'TAKE_RIBA', 'PAYOFF_ASSET',
  'GL_PROMO_TAKE', 'GL_UPGRADE', 'GL_BUY_TRIANGLE', 'ACCEPT_OFFER',
  'HIRE_MANAGER', 'ENTER_FAST_TRACK', 'TRY_VENTURE', 'SET_ACCESS',
  'OFFER_ASSET', 'REPAY_LOAN', 'ACCEPT_CHARITY',
]

console.log(`партий на уровень: ${ПАРТИЙ}\n`)
const шапка = ['показатель'.padEnd(22), ...['easy', 'medium', 'high', 'unreal'].map((x) => x.padStart(11))]
console.log(шапка.join(''))
const все: Record<string, Счёт> = {}
for (const у of ['easy', 'medium', 'high', 'unreal'] as BotDifficulty[]) все[у] = прогон(у)

const строка = (имя: string, f: (с: Счёт) => string) =>
  console.log(имя.padEnd(22) + (['easy', 'medium', 'high', 'unreal'] as BotDifficulty[])
    .map((у) => f(все[у]).padStart(11)).join(''))

строка('капитал (медиана)', (с) => млн(медиана(с.капитал)))
строка('вышли из Круга', (с) => `${Math.round((с.вышли / с.мест) * 100)}%`)
строка('длина партии', (с) => `${медиана(с.ходов)}`)
строка('колода: малая', (с) => {
  const в = с.колода.small + с.колода.big
  return в ? `${Math.round((с.колода.small / в) * 100)}%` : '—'
})
console.log('')
const отказы = new Set<string>()
for (const у of ['easy', 'medium', 'high', 'unreal'] as BotDifficulty[])
  for (const k of Object.keys(все[у].событий)) if (k.startsWith('ОТКАЗ:')) отказы.add(k)
if (отказы.size) {
  console.log('потерянные ходы (движок отказал, бот молча закончил ход):')
  for (const e of [...отказы].sort()) строка('  ' + e, (с) => String(с.событий[e] ?? 0))
  console.log('')
}

for (const e of интересно) {
  const есть = (['easy', 'medium', 'high', 'unreal'] as BotDifficulty[]).some((у) => все[у].событий[e])
  if (есть) строка(e, (с) => String(с.событий[e] ?? 0))
}
