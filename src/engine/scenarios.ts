/** Прогон партий разными составами: ищем перекосы, тупики и принтеры денег. */
import { createTable, applyTableEvent, applyWorldEvent, nextWorldEventIndex, currentSeat, type TableSetup } from '../table'
import { decideBotEvent } from '../bots'
import { mulberry32 } from '../rng'
import { professionsFor, dreamSpaces, setActiveTheme, setFastBoardTheme } from '../data'
import { setRules, monthlyCashFlow, passiveIncome, totalExpenses, netWorth, RULES } from '../ledger'
import { glTotalIncome, glRankFor } from '../greenleaf'
import type { Table } from '../types'

setActiveTheme('ru'); setFastBoardTheme('ru')
const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

function play(seed: number, nSeats: number, diff: 'easy'|'medium'|'high'|'unreal', maxTurns = 900) {
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru'); const dreams = dreamSpaces()
  const rnd = mulberry32(seed)
  const setup: TableSetup = { seed, deckTheme: 'ru', seats: Array.from({ length: nSeats }, (_, i) => ({
    name: `И${i+1}`, professionId: pool[(seed + i * 5) % pool.length].id,
    dreamSpace: dreams[i % dreams.length].index, isBot: true, botDifficulty: diff,
  })) }
  let t: Table = createTable(setup)
  let turns = 0, worldEvents = 0, stuck = 0
  while (t.phase !== 'finished' && turns < maxTurns) {
    const before = t
    const ev = decideBotEvent(t, rnd)
    t = ev ? applyTableEvent(t, ev) : t
    if (t === before) { t = applyTableEvent(t, { type: 'END_TURN' }); stuck++ }
    turns++
    if (turns % 40 === 0) { t = applyWorldEvent(t, nextWorldEventIndex(t)); worldEvents++ }
    if (stuck > 250) break
  }
  const alive = t.seats.filter(s => !s.outOfGame)
  const fast = t.seats.filter(s => s.track === 'fast')
  const won = t.seats.filter(s => s.won)
  const gl = t.seats.filter(s => s.ledger.businesses.some(b => b.gl))
  const negCash = t.seats.filter(s => s.ledger.cash < 0)
  const maxNet = Math.max(...t.seats.map(s => netWorth(s.ledger)))
  return { turns, worldEvents, stuck, phase: t.phase,
    alive: alive.length, fast: fast.length, won: won.length, gl: gl.length,
    bankrupt: t.seats.length - alive.length, negCash: negCash.length, maxNet, table: t }
}

console.log('СЦЕНАРИИ (900 ходов каждый)\n')
const rows: string[] = []
for (const [seats, diff] of [[2,'easy'],[3,'medium'],[4,'medium'],[4,'high'],[6,'unreal']] as const) {
  for (const seed of [11, 42, 777]) {
    const r = play(seed, seats as number, diff as any)
    rows.push(`  мест ${seats} · ${String(diff).padEnd(7)} · зерно ${String(seed).padStart(3)} → ходов ${String(r.turns).padStart(3)}  на Полосе ${r.fast}  победа ${r.won}  банкротов ${r.bankrupt}  с GreenLeaf ${r.gl}  минус-касса ${r.negCash}  макс.капитал ${M(r.maxNet).padStart(16)}  тупиков ${r.stuck}`)
  }
}
rows.forEach(r => console.log(r))

console.log('\nПРОВЕРКА НА ПРИНТЕРЫ ДЕНЕГ')
const big = play(42, 4, 'unreal', 1500)
const cash = big.table.seats.map(s => s.ledger.cash)
console.log('  наличные по игрокам:', cash.map(c => M(c)).join(' · '))
console.log('  капитал максимум:', M(big.maxNet))
for (const s of big.table.seats) {
  const b = s.ledger.businesses.find(x => x.gl)
  if (b?.gl) console.log(`  ${s.name}: GreenLeaf ${M(glTotalIncome(b.gl))}/мес, ранг ${glRankFor(b.gl.volume).name}`)
}
