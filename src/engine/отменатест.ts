/**
 * «Отменить» снимает последний ход ЧЕЛОВЕКА вместе с ходами ботов после него (12.09).
 *
 * 🔴 Живой прогон на сайте: в партии с ботами кнопка снимала последний бросок за
 * столом — а он почти всегда бота. Бот тут же ходил заново, и покупка человека
 * не отменялась ни с какого нажатия: шесть нажатий, касса та же.
 */
import { createTable, applyTableEvent, replayTable, началоПоследнегоХодаЧеловека } from './table'
import { decideBotEvent } from './bots'
import type { TableEvent } from './events'
import type { Table } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

function партия(люди: boolean[]) {
  const setup = {
    seed: 11,
    deckTheme: 'ru',
    seats: люди.map((человек, i) => ({
      id: `s${i}`,
      name: `И${i}`,
      professionId: ['engineer', 'teacher', 'doctor'][i % 3],
      dreamSpace: [2, 13, 24][i % 3],
      isBot: !человек,
      botDifficulty: 'medium',
    })),
  }
  let t: Table = createTable(setup as never)
  const events: TableEvent[] = []
  let к = 7
  const rnd = () => ((к = (к * 9301 + 49297) % 233280) / 233280)
  const шаг = (e: TableEvent) => {
    const n = applyTableEvent(t, e)
    if (n === t) return false
    events.push(e)
    t = n
    return true
  }
  /** Один ход того, чья очередь. За человека решает тот же бот — события от этого не зависят. Возвращает индекс броска. */
  const ход = () => {
    const место = t.turnIndex
    let бросок = -1
    for (let i = 0; i < 400 && t.turnIndex === место && t.phase !== 'finished'; i++) {
      const глазами = { ...t, seats: t.seats.map((s) => ({ ...s, isBot: true })) } as Table
      const e = decideBotEvent(глазами, rnd) ?? ({ type: 'END_TURN' } as TableEvent)
      if (шаг(e)) {
        if (e.type === 'ROLL' && бросок < 0) бросок = events.length - 1
      } else if (!шаг({ type: 'END_TURN' } as TableEvent)) break
    }
    return бросок
  }
  return { setup: setup as never, events, ход }
}

// 1. Человек и два бота: снимается ход человека вместе с ходами ботов после него.
{
  const p1 = партия([true, false, false])
  const человек = p1.ход()
  p1.ход()
  p1.ход()
  const i = началоПоследнегоХодаЧеловека(p1.setup, p1.events)
  п('снимается ход человека, а не бота', i === человек && i >= 0, `${i} против ${человек}`)
  const назад = replayTable(p1.setup, p1.events.slice(0, i))
  п('после отмены очередь человека, он перед броском', назад.turnIndex === 0 && назад.phase === 'awaitingRoll', `${назад.turnIndex} ${назад.phase}`)
}

// 2. Два человека и бот: снимается ход второго человека — последнего, кто бросал из людей.
{
  const p2 = партия([true, true, false])
  p2.ход()
  const второй = p2.ход()
  p2.ход()
  const i = началоПоследнегоХодаЧеловека(p2.setup, p2.events)
  п('снимается ход последнего человека', i === второй && i >= 0, `${i} против ${второй}`)
}

// 3. Человек ещё не бросал — отменять нечего.
{
  const p3 = партия([true, false])
  п('без бросков отменять нечего', началоПоследнегоХодаЧеловека(p3.setup, p3.events) === -1)
}

console.log(
  беды.length
    ? '\n❌ ОТМЕНА ХОДА:\n  ' + беды.join('\n  ')
    : '\n✅ ОТМЕНА ХОДА: снимается ход человека вместе с ходами ботов после него',
)
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
