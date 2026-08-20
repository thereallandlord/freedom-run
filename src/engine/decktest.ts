/**
 * Проверка раздачи: карточки не должны повторяться, пока колода не пройдена.
 * Запуск: npx tsx src/engine/decktest.ts
 */
import { createTable } from './table'
import { marketCards } from './data'
import type { Table } from './types'

// draw не экспортируется, поэтому дёргаем его через ту же механику курсора.
function тянуть(t: Table, колода: 'market' | 'glEvent', размер: number): number {
  const d = t.decks[колода]
  if (d.next >= d.order.length) throw new Error('колода кончилась — перетасовка вне теста')
  const idx = d.order[d.next]
  d.next += 1
  return idx
}

const t = createTable({
  seed: 42,
  deckTheme: 'ru',
  seats: [{ id: 's1', name: 'A', isBot: false, botDifficulty: 'medium', dreamSpace: 3 }],
} as never)

const всеРынка = marketCards('ru')
const глКарты = всеРынка.filter((c) => c.kind === 'glEvent')

const рынок = new Set<number>()
for (let i = 0; i < всеРынка.length; i++) рынок.add(тянуть(t, 'market', всеРынка.length))
console.log(`рынок: ${всеРынка.length} карт → разных вытянуто ${рынок.size}`)

const гл = new Set<number>()
for (let i = 0; i < глКарты.length; i++) гл.add(тянуть(t, 'glEvent', глКарты.length))
console.log(`партнёрский бизнес: ${глКарты.length} карт → разных вытянуто ${гл.size}`)

const ок = рынок.size === всеРынка.length && гл.size === глКарты.length
console.log(ок ? '\n✅ ПОВТОРОВ ВНУТРИ ПРОХОДА НЕТ' : '\n❌ ЕСТЬ ПОВТОРЫ')
if (!ок) throw new Error('карточки повторяются внутри одного прохода колоды')
