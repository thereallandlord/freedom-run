/**
 * Насколько растущие расходы удлиняют партию.
 *
 * Гоняет настоящих ботов тем же способом, что и калибровка, и меряет ход,
 * на котором первый игрок выходит из Круга. Запуск:
 * npx tsx src/engine/creepsim.ts
 */
import { applyTableEvent, createTable, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme } from './data'
import { setRules } from './ledger'

function партия(seed: number, creep: number): number {
  setActiveTheme('ru')
  setFastBoardTheme('ru')
  const dreams = dreamSpaces()
  const pool = professionsFor('ru')
  const r0 = mulberry32(seed)
  const setup: TableSetup = {
    seed,
    deckTheme: 'ru',
    seats: [0, 1, 2].map((i) => ({
      name: `B${i}`,
      professionId: pool[Math.floor(r0() * pool.length)].id,
      dreamSpace: dreams[Math.floor(r0() * dreams.length)].index,
      isBot: true,
      botDifficulty: (['medium','high','unreal'] as const)[i],
    })),
  }
  let t = createTable(setup)
  // 🔴 createTable выставляет правила режима, поэтому величину ставим ПОСЛЕ него.
  setRules({ lifestyleCreepPct: creep })
  const rnd = mulberry32(seed ^ 0x5f356495)
  let ev = 0
  let stuck = 0
  while (t.phase !== 'finished' && ev < 20000) {
    if (t.seats.some((s) => s.track === 'fast')) return t.turnCounter
    const before = t
    const e = decideBotEvent(t, rnd)
    if (!e) break
    t = applyTableEvent(t, e)
    ev++
    if (t === before) {
      if (++stuck > 3) {
        const f = applyTableEvent(t, { type: 'END_TURN' })
        if (f === t) break
        t = f
        stuck = 0
      }
    } else stuck = 0
  }
  return 0
}

function прогон(имя: string, creep: number) {
  const ходы: number[] = []
  for (let i = 0; i < 80; i++) {
    const х = партия(4000 + i, creep)
    if (х) ходы.push(х)
  }
  ходы.sort((a, b) => a - b)
  const мед = ходы.length ? ходы[Math.floor(ходы.length / 2)] : 0
  const сред = ходы.length ? Math.round(ходы.reduce((s, x) => s + x, 0) / ходы.length) : 0
  console.log(
    `${имя.padEnd(38)} вышли ${String(ходы.length).padStart(2)}/80 · медиана ${String(мед).padStart(3)} ходов · среднее ${String(сред).padStart(3)}`,
  )
  return мед
}

const точки = [0, 25, 33, 50, 75, 100, 150]
const итог: [number, number][] = []
for (const p of точки) итог.push([p, прогон(`доля прироста ${p}%`, p)])
const база = итог[0][1]
console.log('')
for (const [p, м] of итог) {
  if (!база || !м) continue
  console.log(`  ${String(p).padStart(3)}% → ${String(м).padStart(3)} ходов · в ${(м / база).toFixed(2)} раза длиннее`)
}
