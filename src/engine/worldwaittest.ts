/**
 * Новость с условием ждёт своего часа и не теряется.
 *
 * 🔴 Указ № 604 бьёт по логистике. Пока логистики за столом нет, он обязан
 * ЖДАТЬ, а не выходить впустую: мировых событий за партию всего три десятка, и
 * каждое выпадает лишь однажды. Потратить такое на пустоту — значит лишить
 * стол целой новости.
 */
import { createTable, applyTableEvent, nextWorldEventIndex } from './table'
import { WORLD_EVENTS } from './data'
import type { Table } from './types'

const УКАЗ = WORLD_EVENTS.findIndex((e) => e.id === 'ukaz-604')

function стол(seed: number): Table {
  return createTable({
    seed,
    deckTheme: 'ru',
    seats: [0, 1, 2].map((i) => ({
      id: `s${i}`,
      name: `И${i}`,
      professionId: ['engineer', 'doctor', 'teacher'][i],
      dreamSpace: 3 + i * 5,
      isBot: true,
      botDifficulty: 'medium' as const,
    })),
  } as never)
}

/** Выдать игроку пункт выдачи — это и есть логистика из указа. */
function датьЛогистику(t: Table, место: number, id: string): void {
  const s = t.seats[место]
  t.seats[место] = {
    ...s,
    ledger: {
      ...s.ledger,
      businesses: [
        ...s.ledger.businesses,
        {
          id,
          name: 'Пункт выдачи заказов',
          cost: 300_000,
          downPayment: 300_000,
          liability: 0,
          cashFlow: 8100,
          category: 'bizService',
        } as never,
      ],
    },
  }
}

/** Дойдёт ли очередь до указа, если крутить новости до конца колоды. */
function указВыйдет(старт: Table): boolean {
  let t = старт
  for (let i = 0; i < WORLD_EVENTS.length + 2; i++) {
    const idx = nextWorldEventIndex(t)
    if (idx < 0) return false
    if (idx === УКАЗ) return true
    t = applyTableEvent(t, { type: 'WORLD_EVENT', index: idx } as never)
  }
  return false
}

let плохо = 0
const итог = (ок: boolean, текст: string) => {
  console.log(`${ок ? '✅' : '❌'} ${текст}`)
  if (!ок) плохо += 1
}

console.log(`указ № 604: номер ${УКАЗ}, условие ${JSON.stringify(WORLD_EVENTS[УКАЗ]?.требует)}\n`)

// 1. Логистики нет — указ не выходит вовсе.
итог(!указВыйдет(стол(3)), 'без логистики за столом указ не выходит')

// 2. Один владелец — всё ещё ждёт: в условии стоит «минимум двое».
{
  const t = стол(3)
  датьЛогистику(t, 0, 'b0')
  итог(!указВыйдет(t), 'с одним владельцем логистики указ ещё ждёт')
}

// 3. Двое — выходит.
{
  const t = стол(3)
  датьЛогистику(t, 0, 'b0')
  датьЛогистику(t, 1, 'b1')
  итог(указВыйдет(t), 'как только логистика у двоих — указ выходит')
}

// 4. Ни одна новость не повторяется за партию.
{
  let t = стол(11)
  const вышли = new Set<number>()
  let повтор = false
  for (let i = 0; i < WORLD_EVENTS.length + 5; i++) {
    const idx = nextWorldEventIndex(t)
    if (idx < 0) break
    if (вышли.has(idx)) {
      повтор = true
      break
    }
    вышли.add(idx)
    t = applyTableEvent(t, { type: 'WORLD_EVENT', index: idx } as never)
  }
  итог(!повтор, `повторов нет: вышло ${вышли.size} новостей из ${WORLD_EVENTS.length}`)
}

console.log(плохо === 0 ? '\n✅ НОВОСТЬ С УСЛОВИЕМ ЖДЁТ И НЕ ТЕРЯЕТСЯ' : `\n❌ ПРОБЛЕМ: ${плохо}`)
if (плохо) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
