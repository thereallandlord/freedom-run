/**
 * Прогон движка без интерфейса: боты играют полные партии.
 * Ловит зависания, отрицательные балансы и недостижимую победу.
 */
import { createTable, applyTableEvent, currentSeat, type TableSetup,
  THEME_RULES,
} from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { PROFESSIONS_RU, dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme } from './data'
import { RULES, setRules } from './ledger'
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

type Theme = 'ru'

function buildSetup(seed: number, difficulties: BotDifficulty[], theme: Theme): TableSetup {
  // Поле и профессии зависят от темы — переключаем до чтения списков.
  setActiveTheme(theme)
  setFastBoardTheme(theme)
  const dreams = dreamSpaces()
  const pool = professionsFor(theme)
  const rnd = mulberry32(seed)
  return {
    seed,
    deckTheme: theme,
    seats: difficulties.map((d, i) => ({
      name: `Бот ${i + 1}`,
      professionId: pool[Math.floor(rnd() * pool.length)].id,
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

function playGame(seed: number, difficulties: BotDifficulty[], theme: Theme): Result {
  const setup = buildSetup(seed, difficulties, theme)
  let t = createTable(setup)
  const rnd = mulberry32(seed ^ 0x5f356495)
  let events = 0
  let stuck = 0

  // Партия ботов меряется до ПЕРВОЙ победы: дальше живая игра продолжается
  // для людей, а ботам мериться уже нечем.
  while (t.phase !== 'finished' && !t.winnerId && events < MAX_EVENTS) {
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
  /*
   * 🔴 Числа пересчитаны на русские профессии 28.08.2026. Раньше здесь стояли
   * долларовые из классической колоды — её убрали, и проверка сравнивала
   * формулу с профессиями, которых в игре больше нет. Смысл проверки прежний:
   * поймать, если кто-то тронет расчёт потока или стартовых денег.
   */
  const cases: [string, number, number][] = [
    ['teacher', 50500, 71500],
    ['nurse', 57000, 80000],
    ['courier', 59000, 81000],
    ['mechanic', 59500, 83500],
    ['accountant', 63000, 89000],
  ]
  let ok = true
  for (const [id, flow, cash] of cases) {
    const p = PROFESSIONS_RU.find((x) => x.id === id)!
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
setRules(THEME_RULES.ru)
const formulasOk = checkFormulas()

const mixes: BotDifficulty[][] = [
  ['easy', 'medium'],
  ['medium', 'high'],
  ['high', 'unreal'],
  ['easy', 'medium', 'high', 'unreal'],
]

let anyStalled = 0
for (const theme of ['ru'] as Theme[]) {
  console.log(`\n=== 30 партий ботов · тема «${theme}» ===`)
  const results: Result[] = []
  for (let i = 0; i < 30; i++) {
    results.push(playGame(1000 + i * 37, mixes[i % mixes.length], theme))
  }

  const stalled = results.filter((r) => r.stalled)
  anyStalled += stalled.length
  const won = results.filter((r) => r.winner)
  const avgTurns = Math.round(results.reduce((s, r) => s + r.turns, 0) / results.length)
  const avgEvents = Math.round(results.reduce((s, r) => s + r.events, 0) / results.length)
  const escapedGames = results.filter((r) => r.escaped > 0).length
  const bankrupt = results.reduce((s, r) => s + r.bankrupt, 0)
  const byReason: Record<string, number> = {}
  for (const r of won) byReason[r.winReason ?? 'последний выживший'] = (byReason[r.winReason ?? 'последний выживший'] ?? 0) + 1
  const byDiff: Record<string, number> = {}
  for (const r of won) {
    const d = r.winner!.match(/\((\w+)\)/)?.[1] ?? '?'
    byDiff[d] = (byDiff[d] ?? 0) + 1
  }

  console.log(`  зависших:          ${stalled.length}`)
  console.log(`  с победителем:     ${won.length} / ${results.length}`)
  console.log(`  вышли из Круга:    ${escapedGames} партий · банкротов ${bankrupt}`)
  console.log(`  средняя длина:     ${avgTurns} ходов / ${avgEvents} событий`)
  console.log(`  победы по типу:    ${JSON.stringify(byReason)}`)
  console.log(`  победы по уровню:  ${JSON.stringify(byDiff)}`)
}

const pass = formulasOk && anyStalled === 0
console.log(`\n${pass ? '✅ ДВИЖОК ЖИВОЙ' : '❌ ЕСТЬ ПРОБЛЕМЫ'}\n`)
if (!pass) process.exit(1)
