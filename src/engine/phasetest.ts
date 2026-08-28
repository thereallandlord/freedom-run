/**
 * Инвариант фазы: если на столе лежит карточка, фаза обязана быть «разбираем».
 *
 * 🔴 Зачем это отдельной проверкой. Кнопка броска смотрит ТОЛЬКО на фазу и
 * ничего не знает про карточки. Стоит какой-нибудь клетке поставить карточку
 * и забыть про фазу — кнопка кубика остаётся живой поверх окна: человек
 * бросает второй раз, карточка стирается непрочитанной, ход выходит
 * бесплатным. Так было у клетки «зарплата» (19 369 случаев на 400 партиях) и
 * у выхода на Полосу свободы — там это ещё и запирало передачу хода намертво.
 *
 * Правило простое и проверяется механически, поэтому оно и записано кодом, а
 * не памяткой.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import type { Table } from './types'

function стол(seed: number, тема: 'ru'): Table {
  return createTable({
    seed,
    deckTheme: тема,
    seats: [
      { id: 'a', name: 'А', professionId: 'engineer', dreamSpace: 3, isBot: true, botDifficulty: 'medium' },
      { id: 'b', name: 'Б', professionId: 'doctor', dreamSpace: 7, isBot: true, botDifficulty: 'high' },
      { id: 'c', name: 'В', professionId: 'teacher', dreamSpace: 11, isBot: true, botDifficulty: 'easy' },
    ],
  } as never)
}

const нарушения: string[] = []
let проверено = 0

for (const тема of ['ru'] as const) {
  for (let seed = 1; seed <= 120; seed++) {
    let t = стол(seed, тема)
    let к = seed
    for (let шаг = 0; шаг < 900 && t.phase !== 'finished'; шаг++) {
      проверено += 1
      const p = t.pending
      if (p && p.kind !== 'gameOver' && t.phase !== 'resolving') {
        нарушения.push(`${тема} seed=${seed}: карточка «${p.kind}» при фазе «${t.phase}»`)
        break
      }
      const ход = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
      if (!ход) break
      const до = t
      t = applyTableEvent(t, ход)
      if (t === до) break
    }
  }
}

console.log(`проверено состояний: ${проверено}`)
if (нарушения.length === 0) {
  console.log('\n✅ КАРТОЧКА НА СТОЛЕ — ВСЕГДА ФАЗА «РАЗБИРАЕМ»')
} else {
  const первые = [...new Set(нарушения)].slice(0, 8)
  console.log(`\n❌ нарушений: ${нарушения.length}`)
  for (const x of первые) console.log('  ·', x)
  ;(globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
}
