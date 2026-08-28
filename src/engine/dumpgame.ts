/** Прогоняет партию ботов и сохраняет журнал до момента победы — для проверки UI. */
import { createTable, applyTableEvent, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { PROFESSIONS_RU as PROFESSIONS, dreamSpaces } from './data'
import type { TableEvent } from './events'
import { writeFileSync } from 'node:fs'

const seed = Number(process.argv[2] ?? 1037)
const dreams = dreamSpaces()
const rnd0 = mulberry32(seed)
const setup: TableSetup = {
  seed,
  deckTheme: 'ru',
  seats: [
    { name: 'Камиль', professionId: 'engineer', dreamSpace: dreams[0].index, isBot: true, botDifficulty: 'unreal' },
    { name: 'Бот', professionId: 'lawyer', dreamSpace: dreams[3].index, isBot: true, botDifficulty: 'high' },
  ],
}

let t = createTable(setup)
const rnd = mulberry32(seed ^ 0x5f356495)
const events: TableEvent[] = []
let firstFastAt = -1

while (t.phase !== 'finished' && events.length < 20000) {
  const ev = decideBotEvent(t, rnd)
  if (!ev) break
  const next = applyTableEvent(t, ev)
  if (next === t) {
    const forced = applyTableEvent(t, { type: 'END_TURN' })
    if (forced === t) break
    t = forced
    events.push({ type: 'END_TURN' })
    continue
  }
  t = next
  events.push(ev)
  if (firstFastAt < 0 && t.seats.some((s) => s.track === 'fast')) firstFastAt = events.length
}

console.log('events', events.length, 'winner', t.winnerId, 'firstFastAt', firstFastAt)

// Состояние сразу после выхода на Полосу свободы
writeFileSync('.dump-fast.json', JSON.stringify({ setup, events: events.slice(0, firstFastAt + 1) }))
// Состояние за один ход до победы
writeFileSync('.dump-prewin.json', JSON.stringify({ setup, events: events.slice(0, events.length - 1) }))
// Финал
writeFileSync('.dump-win.json', JSON.stringify({ setup, events }))
console.log('written .dump-fast.json / .dump-prewin.json / .dump-win.json')
