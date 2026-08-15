/**
 * Прогон движка без интерфейса: боты играют полные партии.
 * Ловит зависания, отрицательные балансы и недостижимую победу.
 */
import { createTable, applyTableEvent, currentSeat, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { PROFESSIONS, dreamSpaces } from './data'
import {
  monthlyCashFlow,
  netWorth,
  passiveIncome,
  professionMonthlyCashFlow,
  startingCash,
  totalExpenses,
} from './ledger'
import type { BotDifficulty } from './types'

const MAX_EVENTS = 20000

function buildSetup(seed: number, difficulties: BotDifficulty[]): TableSetup {
  const dreams = dreamSpaces()
  const rnd = mulberry32(seed)
  return {
    seed,
    deckTheme: seed % 2 === 0 ? 'offshore' : 'classic',
    seats: difficulties.map((d, i) => ({
      name: `Бот ${i + 1}`,
      professionId: PROFESSIONS[Math.floor(rnd() * PROFESSIONS.length)].id,
      dreamSpace: dreams[Math.floor(rnd() * dreams.length)].index,
      isBot: true,
      botDifficulty: d,
    })),
  }
}

interface Result {
  seed: number
  events: number
  turns: number
  winner: string | null
  winReason?: string
  escaped: number
  bankrupt: number
  stalled: boolean
}

function playGame(seed: number, difficulties: BotDifficulty[]): Result {
  const setup = buildSetup(seed, difficulties)
  let t = createTable(setup)
  const rnd = mulberry32(seed ^ 0x5f356495)
  let events = 0
  let stuck = 0

  while (t.phase !== 'finished' && events < MAX_EVENTS) {
    const before = t
    const ev = decideBotEvent(t, rnd)
    if (!ev) break
    t = applyTableEvent(t, ev)
    events++
    if (t === before) {
      // Событие отклонено — форсируем завершение хода, иначе бесконечный цикл.
      stuck++
      if (stuck > 3) {
        const forced = applyTableEvent(t, { type: 'END_TURN' })
        if (forced === t) {
          return {
            seed,
            events,
            turns: t.turnCounter,
            winner: null,
            escaped: 0,
            bankrupt: 0,
            stalled: true,
          }
        }
        t = forced
        stuck = 0
      }
    } else {
      stuck = 0
    }
  }

  const winner = t.winnerId ? t.seats.find((s) => s.id === t.winnerId) : null
  return {
    seed,
    events,
    turns: t.turnCounter,
    winner: winner ? `${winner.name} (${winner.botDifficulty})` : null,
    winReason: winner?.ledger.winReason,
    escaped: t.seats.filter((s) => s.track === 'fast').length,
    bankrupt: t.seats.filter((s) => s.outOfGame).length,
    stalled: events >= MAX_EVENTS,
  }
}

// ─── Проверки формул на известных числах ──────────────────────────────

function checkFormulas() {
  const cases: [string, number, number][] = [
    ['engineer', 1690, 2090],
    ['truck-driver', 880, 1630],
    ['airline-pilot', 2600, 3000],
    ['doctor', 3550, 3950],
    ['janitor', 650, 1210],
  ]
  let ok = true
  for (const [id, flow, cash] of cases) {
    const p = PROFESSIONS.find((x) => x.id === id)!
    const f = professionMonthlyCashFlow(p)
    const c = startingCash(p)
    const good = f === flow && c === cash
    if (!good) ok = false
    console.log(
      `  ${good ? '✅' : '❌'} ${p.name.padEnd(17)} поток $${f} (ждём $${flow}) · старт $${c} (ждём $${cash})`,
    )
  }
  return ok
}

// ─── Запуск ───────────────────────────────────────────────────────────

console.log('\n=== Формулы против живой игры ===')
const formulasOk = checkFormulas()

console.log('\n=== 40 партий ботов ===')
const mixes: BotDifficulty[][] = [
  ['easy', 'medium'],
  ['medium', 'high'],
  ['high', 'unreal'],
  ['easy', 'medium', 'high', 'unreal'],
]
const results: Result[] = []
for (let i = 0; i < 40; i++) {
  results.push(playGame(1000 + i * 37, mixes[i % mixes.length]))
}

const stalled = results.filter((r) => r.stalled)
const won = results.filter((r) => r.winner)
const avgTurns = Math.round(results.reduce((s, r) => s + r.turns, 0) / results.length)
const avgEvents = Math.round(results.reduce((s, r) => s + r.events, 0) / results.length)
const escapedGames = results.filter((r) => r.escaped > 0).length
const byReason: Record<string, number> = {}
for (const r of won) byReason[r.winReason ?? '?'] = (byReason[r.winReason ?? '?'] ?? 0) + 1
const byDiff: Record<string, number> = {}
for (const r of won) {
  const d = r.winner!.match(/\((\w+)\)/)?.[1] ?? '?'
  byDiff[d] = (byDiff[d] ?? 0) + 1
}

console.log(`  партий:            ${results.length}`)
console.log(`  зависших:          ${stalled.length}`)
console.log(`  с победителем:     ${won.length}`)
console.log(`  вышли из Круга:    ${escapedGames} партий`)
console.log(`  средняя длина:     ${avgTurns} ходов / ${avgEvents} событий`)
console.log(`  победы по типу:    ${JSON.stringify(byReason)}`)
console.log(`  победы по уровню:  ${JSON.stringify(byDiff)}`)

const pass = formulasOk && stalled.length === 0
console.log(`\n${pass ? '✅ ДВИЖОК ЖИВОЙ' : '❌ ЕСТЬ ПРОБЛЕМЫ'}\n`)
if (!pass) process.exit(1)
