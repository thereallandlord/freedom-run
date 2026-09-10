/**
 * Партия из кабинета поднимается только если повтор журнала пришёл к тому же.
 *
 * 🔴 До этой проверки кабинет молча переигрывал журнал по новым данным: после
 * правки колод или профессий человек получал другую партию под видом своей.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import { netWorth } from './ledger'
import { сверитьСКабинетом } from './сверкаПартии'
import type { Table } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

const setup = {
  seed: 9,
  deckTheme: 'ru',
  seats: [0, 1, 2].map((i) => ({
    id: `s${i}`,
    name: `Б${i}`,
    professionId: ['engineer', 'doctor', 'teacher'][i],
    dreamSpace: [2, 13, 24][i],
    isBot: true,
    botDifficulty: 'medium',
  })),
}
let t: Table = createTable(setup as never)
let к = 9 * 977 + 3
const rnd = () => ((к = (к * 9301 + 49297) % 233280) / 233280)
const журнал: unknown[] = []
for (let шаг = 0; шаг < 400 && t.phase !== 'finished'; шаг++) {
  const ev = decideBotEvent(t, rnd) ?? ({ type: 'END_TURN' } as never)
  let n = applyTableEvent(t, ev)
  if (n === t) {
    const e2 = { type: 'END_TURN' } as never
    n = applyTableEvent(t, e2)
    if (n === t) break
    журнал.push(e2)
  } else журнал.push(ev)
  t = n
}
const ожидание = { turns: t.turnCounter, seatId: 's0', netWorth: Math.round(netWorth(t.seats[0].ledger)) }

п('та же партия по тем же данным — сходится', сверитьСКабинетом(setup as never, журнал as never, ожидание).сошлась)
п('другой капитал — не сходится', !сверитьСКабинетом(setup as never, журнал as never, { ...ожидание, netWorth: ожидание.netWorth + 50_000 }).сошлась)
п('другой ход — не сходится', !сверитьСКабинетом(setup as never, журнал as never, { ...ожидание, turns: ожидание.turns + 1 }).сошлась)
const обрезанный = журнал.slice(0, Math.max(0, журнал.length - 40))
п('журнал короче записанного — не сходится', !сверитьСКабинетом(setup as never, обрезанный as never, ожидание).сошлась)
п('чужого места нет — не сходится', !сверитьСКабинетом(setup as never, журнал as never, { ...ожидание, seatId: 'нет-такого' }).сошлась)
console.log(`  партия на ${журнал.length} ходов журнала, ход стола ${ожидание.turns}, капитал ${ожидание.netWorth.toLocaleString('ru')}`)

console.log(беды.length ? '\n❌ СВЕРКА КАБИНЕТА:\n  ' + беды.join('\n  ') : '\n✅ СВЕРКА КАБИНЕТА: своя партия поднимается, чужая — нет')
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
