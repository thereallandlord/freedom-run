/**
 * Дубль конца хода не должен съедать чужой ход.
 *
 * 🔴 Живой сценарий: конец хода отправляют ДВОЕ — хозяин комнаты и сам
 * ходящий. Так задумано: иначе стол замирает навсегда, стоит хозяину свернуть
 * вкладку. Но пока у события не было номера хода, второй экземпляр доезжал уже
 * ПОСЛЕ перехода и закрывал ход следующему игроку: за круг из троих один не
 * ходил вовсе, а страховочный повтор раз в три секунды множил пропуски.
 *
 * Проверяем самое ядро: два одинаковых конца хода двигают очередь РОВНО на
 * одного. Всё остальное (кто кому шлёт, сеть, таймеры) стоит на этом.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import type { Table } from './types'

function стол(seed: number): Table {
  return createTable({
    seed,
    deckTheme: 'ru',
    seats: [
      { id: 'a', name: 'Аня', professionId: 'engineer', dreamSpace: 3, isBot: true, botDifficulty: 'medium' },
      { id: 'b', name: 'Боря', professionId: 'doctor', dreamSpace: 7, isBot: true, botDifficulty: 'medium' },
      { id: 'c', name: 'Вика', professionId: 'teacher', dreamSpace: 11, isBot: true, botDifficulty: 'medium' },
    ],
  } as never)
}

let двойных = 0
let одинарных = 0
let безНомера = 0

for (const seed of [7, 42, 1234, 55555, 909090]) {
  let t = стол(seed)
  let к = 0
  for (let шаг = 0; шаг < 600 && t.phase !== 'finished'; шаг++) {
    if (t.phase === 'turnEnd') {
      const было = t.turnCounter

      // Как в жизни: хозяин комнаты и сам ходящий шлют независимо.
      const ev = { type: 'END_TURN', turn: было } as never
      t = applyTableEvent(t, ev)
      const послеПервого = t.turnCounter
      t = applyTableEvent(t, ev)
      const послеВторого = t.turnCounter

      /*
       * Смотрим не «сдвинул ли второй», а СУММАРНЫЙ сдвиг. Первый конец хода
       * иногда очередь не двигает — например, отдаёт партнёрский бизнес в
       * срок и оставляет карточку. Тогда двигает второй, и это правильно.
       * Плохо ровно одно: очередь ушла на ДВОИХ.
       */
      if (послеВторого - было > 1) двойных += 1
      else одинарных += 1

      // Контроль: без номера тот же дубль двигал бы очередь второй раз.
      const контроль = applyTableEvent(
        { ...стол(seed), ...JSON.parse(JSON.stringify({ ...t, turnCounter: послеПервого })) } as Table,
        { type: 'END_TURN' } as never,
      )
      if (контроль.turnCounter - было > 1) безНомера += 1
      continue
    }
    const ход = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
    if (!ход) break
    const до = t
    t = applyTableEvent(t, ход)
    if (t === до) break
  }
}

console.log(`концов хода разобрано: ${одинарных + двойных}`)
console.log(`  дубль отклонён (очередь сдвинулась на одного): ${одинарных}`)
console.log(`  дубль ПРОШЁЛ (очередь перескочила):            ${двойных}`)
console.log(`  тот же дубль БЕЗ номера хода прошёл бы:        ${безНомера} раз`)

if (двойных === 0 && безНомера > 0) {
  console.log('\n✅ ДУБЛЬ ОБЕЗВРЕЖЕН, И ПРОВЕРКА ЭТО ДОКАЗЫВАЕТ')
} else if (двойных > 0) {
  console.log('\n❌ дубль по-прежнему двигает очередь')
  ;(globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
} else {
  console.log('\n❌ проверка ничего не доказывает: без номера дубль тоже не проходит')
  ;(globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
}
