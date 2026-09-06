/**
 * Беды Полосы свободы обязаны быть РАЗНЫМИ по механике, а не по подписи.
 *
 * 🔴 Живая жалоба Камиля: «сейчас выпадают одни иски». Так и было: две клетки
 * на всё поле, и обе забирали половину наличных.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import { fastTroubles } from './data'
import type { Table } from './types'

const колода = fastTroubles()
const беды: string[] = []
console.log(`бед в колоде: ${колода.length}`)
const виды = new Set(колода.map((б) => б.вид))
console.log(`разных механик: ${виды.size} (${[...виды].join(', ')})`)
if (виды.size < 3) беды.push(`механик всего ${виды.size} — беда снова одна под разными именами`)
if (колода.length < 8) беды.push(`бед всего ${колода.length} — за партию пойдут по кругу`)

/* Живая раздача: какие беды реально выпадают на Полосе. */
const выпало = new Map<string, number>()
let всего = 0
for (let seed = 1; seed <= 40; seed++) {
  let t: Table = createTable({
    seed, deckTheme: 'ru',
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`, name: `Б${i}`,
      professionId: ['engineer', 'doctor', 'teacher', 'driver'][i],
      dreamSpace: [2, 13, 24, 39][i], isBot: true, botDifficulty: 'high' as const,
    })),
  } as never)
  let к = seed * 7919
  let прошлое: unknown = null
  for (let i = 0; i < 700 && t.phase !== 'finished'; i++) {
    const p = t.pending as { kind?: string; title?: string } | null
    if (p?.kind === 'ftEvent' && p !== прошлое && p.title) {
      прошлое = p
      всего += 1
      выпало.set(p.title, (выпало.get(p.title) ?? 0) + 1)
    }
    const ev = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
    if (!ev) break
    const до = t
    t = applyTableEvent(t, ev)
    if (t === до) { t = applyTableEvent(до, { type: 'END_TURN' } as never); if (t === до) break }
  }
}
console.log(`\nбед выпало за 40 партий: ${всего}`)
for (const [имя, n] of [...выпало.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(3)} × ${имя}`)
if (всего > 20 && выпало.size < 4)
  беды.push(`за ${всего} бед выпало всего ${выпало.size} разных — колода не тасуется`)

for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ БЕДЫ ПОЛОСЫ ОДНООБРАЗНЫ' : '\n✅ БЕДЫ ПОЛОСЫ РАЗНЫЕ ПО МЕХАНИКЕ')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
