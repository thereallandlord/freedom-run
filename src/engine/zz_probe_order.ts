/**
 * Насколько долго курсор малой колоды живёт «укороченным» и как это бьёт по
 * раскрытию колоды. Меняем число «своих» бумаг за столом: чем их больше, тем
 * длиннее (по версии автора) должен быть испорченный порядок.
 */
import { createTable, applyTableEvent } from './table'
import { smallDeals } from './data'
import type { Table } from './types'

const syms = smallDeals('ru')
  .filter((c: any) => c.kind === 'stock')
  .map((c: any) => c.symbol)
const L = smallDeals('ru').length

function стол(seed: number, ownedCount: number): Table {
  const t = createTable({
    seed,
    seats: [
      { id: 'a', name: 'А', professionId: 'engineer', color: '#f00', dreamSpace: 3 },
      { id: 'b', name: 'Б', professionId: 'doctor', color: '#0f0', dreamSpace: 7 },
    ],
    deckTheme: 'ru',
  } as never)
  t.seats = t.seats.map((s, i) => ({
    ...s,
    ledger: {
      ...s.ledger,
      cash: 50_000_000,
      stocks:
        i === 0
          ? syms.slice(0, ownedCount).map((sym, k) => ({
              id: `x${k}`,
              symbol: sym,
              shares: 10,
              costPerShare: 100,
              dividendPerShareMonthly: 1,
            }))
          : [],
    },
  })) as never
  return t
}

console.log('своих бумаг | order≠34 | самый долгий отрезок с коротким order | разных карт за 340 сдач (из 34) | доля 5 самых частых')
for (const owned of [1, 2, 3, 5, 8, 12, 15]) {
  let коротких = 0
  let шагов = 0
  let максОтрезок = 0
  const разныеПоПрогону: number[] = []
  const счёт = new Map<string, number>()
  let всегоСдач = 0
  for (const seed of [3, 11, 77, 555, 8080, 31337, 4, 9, 123, 4242]) {
    let t = стол(seed, owned)
    let текущий = 0
    const виданы = new Set<string>()
    for (let i = 0; i < 340; i++) {
      t.pending = { kind: 'chooseDeal' } as never
      t.phase = 'resolving'
      const после = applyTableEvent(t, { type: 'CHOOSE_DEAL', size: 'small' } as never)
      if (после.pending?.kind === 'deal') {
        const id = (после.pending.card as any).id
        виданы.add(id)
        счёт.set(id, (счёт.get(id) ?? 0) + 1)
        всегоСдач++
      }
      шагов++
      if (после.decks.small.order.length !== L) {
        коротких++
        текущий++
        максОтрезок = Math.max(максОтрезок, текущий)
      } else текущий = 0
      t = после
    }
    разныеПоПрогону.push(виданы.size)
  }
  const топ5 = [...счёт.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0)
  console.log(
    `${String(owned).padStart(11)} | ${((коротких / шагов) * 100).toFixed(1).padStart(7)}% | ${String(максОтрезок).padStart(37)} | ${(разныеПоПрогону.reduce((a, b) => a + b, 0) / разныеПоПрогону.length).toFixed(1).padStart(30)} | ${((топ5 / всегоСдач) * 100).toFixed(1)}%`,
  )
}
