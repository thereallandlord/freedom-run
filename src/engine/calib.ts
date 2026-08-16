/** Калибровка длины RU-партии под классику: где время теряется и что крутить. */
import { createTable, applyTableEvent, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme, fastBoard } from './data'
import { setRules, RULES } from './ledger'
import type { BotDifficulty } from './types'

type Theme = 'classic' | 'ru'

function run(seed: number, diff: BotDifficulty[], theme: Theme) {
  setActiveTheme(theme); setFastBoardTheme(theme)
  const dreams = dreamSpaces(); const pool = professionsFor(theme)
  const r0 = mulberry32(seed)
  const setup: TableSetup = {
    seed, deckTheme: theme,
    seats: diff.map((d, i) => ({
      name: `B${i}`, professionId: pool[Math.floor(r0() * pool.length)].id,
      dreamSpace: dreams[Math.floor(r0() * dreams.length)].index, isBot: true, botDifficulty: d,
    })),
  }
  let t = createTable(setup)
  const rnd = mulberry32(seed ^ 0x5f356495)
  let ev = 0, escapeTurn = 0, stuck = 0
  while (t.phase !== 'finished' && !t.winnerId && ev < 20000) {
    const before = t
    const e = decideBotEvent(t, rnd); if (!e) break
    t = applyTableEvent(t, e); ev++
    if (!escapeTurn && t.seats.some((s) => s.track === 'fast')) escapeTurn = t.turnCounter
    if (t === before) { if (++stuck > 3) { const f = applyTableEvent(t, { type: 'END_TURN' }); if (f === t) break; t = f; stuck = 0 } } else stuck = 0
  }
  return { turns: t.turnCounter, escapeTurn: escapeTurn || t.turnCounter, ftTurns: t.turnCounter - (escapeTurn || t.turnCounter) }
}

const mixes: BotDifficulty[][] = [['easy','medium'],['medium','high'],['high','unreal'],['easy','medium','high','unreal']]
function measure(theme: Theme, label: string) {
  const rs = Array.from({ length: 30 }, (_, i) => run(1000 + i * 37, mixes[i % 4], theme))
  const avg = (f: (r: typeof rs[0]) => number) => Math.round(rs.reduce((s, r) => s + f(r), 0) / rs.length)
  console.log(`  ${label.padEnd(34)} всего ${String(avg(r=>r.turns)).padStart(4)} · Круг ${String(avg(r=>r.escapeTurn)).padStart(4)} · Полоса ${String(avg(r=>r.ftTurns)).padStart(4)}`)
  return avg((r) => r.turns)
}

console.log('\n=== Эталон ===')
setRules({ currency:'USD', fastTrackMultiplier:100, fastTrackTarget:150_000, loansEnabled:true, yieldScale:1 })
const target = measure('classic', 'classic (эталон)')

console.log('\n=== RU: подбор цели Полосы ===')
const board = (() => { setActiveTheme('ru'); setFastBoardTheme('ru'); return fastBoard() })()
const flows = board.filter((s: any) => s.type === 'business').map((s: any) => s.cashFlow)
console.log(`  поток инвестиций Полосы: ${Math.min(...flows)}–${Math.max(...flows)} ₽/мес, медиана ${flows.sort((a:number,b:number)=>a-b)[Math.floor(flows.length/2)]}`)

for (const goal of [1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000]) {
  setRules({ currency:'RUB', fastTrackMultiplier:50, fastTrackTarget:goal, loansEnabled:false })
  measure('ru', `цель ${(goal/1_000_000).toFixed(0)} млн ₽/мес`)
}
console.log(`\n  эталон классики: ${target} ходов — подбираем ближайшее\n`)
