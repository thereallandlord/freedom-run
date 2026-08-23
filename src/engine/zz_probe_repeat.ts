/**
 * Независимый замер повторов. Отличия от repeattest.ts автора:
 *  1) игрокам ВЫДАЮТСЯ бумаги — иначе перекос к «своим» вообще не включается
 *     (owned.size === 0), и тест не касается той ветки, которую «чинили»;
 *  2) считаем не только «сколько разных карт когда-либо показалось», а
 *     повторы ВНУТРИ окна длиной в колоду и длину order на каждом шаге.
 */
import { createTable, applyTableEvent } from './table'
import { smallDeals, bigDeals } from './data'
import type { Table } from './types'

const SEATS = [
  { id: 'a', name: 'А', professionId: 'engineer', color: '#f00', dreamSpace: 3 },
  { id: 'b', name: 'Б', professionId: 'doctor', color: '#0f0', dreamSpace: 7 },
]

function стол(seed: number, withStocks: boolean): Table {
  const t = createTable({ seed, seats: SEATS, deckTheme: 'ru' } as never)
  const syms = smallDeals('ru')
    .filter((c: any) => c.kind === 'stock')
    .map((c: any) => c.symbol)
  t.seats = t.seats.map((s, i) => ({
    ...s,
    ledger: {
      ...s.ledger,
      cash: 50_000_000,
      stocks: withStocks
        ? syms.slice(i * 2, i * 2 + 2).map((sym, k) => ({
            id: `x${i}${k}`,
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

function прогон(size: 'small' | 'big', seed: number, n: number, withStocks: boolean) {
  let t = стол(seed, withStocks)
  const seq: string[] = []
  const orderLens: number[] = []
  for (let i = 0; i < n; i++) {
    t.pending = { kind: 'chooseDeal' } as never
    t.phase = 'resolving'
    const после = applyTableEvent(t, { type: 'CHOOSE_DEAL', size } as never)
    if (после.pending?.kind === 'deal') seq.push((после.pending.card as any).id)
    orderLens.push(после.decks[size].order.length)
    t = после
  }
  return { seq, orderLens }
}

const N = 600
for (const withStocks of [false, true]) {
  console.log(`\n===== у игроков бумаги: ${withStocks ? 'ЕСТЬ' : 'нет'} =====`)
  for (const size of ['small', 'big'] as const) {
    const deck = size === 'small' ? smallDeals('ru') : bigDeals('ru')
    const L = deck.length
    let повторовВОкне = 0
    let окон = 0
    const всеВиданы = new Set<string>()
    const счёт = new Map<string, number>()
    let короткийOrder = 0
    let шагов = 0
    const seeds = [3, 11, 77, 555, 8080, 31337, 4, 9, 123, 4242]
    for (const seed of seeds) {
      const { seq, orderLens } = прогон(size, seed, N, withStocks)
      for (const id of seq) {
        всеВиданы.add(id)
        счёт.set(id, (счёт.get(id) ?? 0) + 1)
      }
      for (const ol of orderLens) {
        шагов++
        if (ol !== L) короткийOrder++
      }
      // Повторы внутри непересекающихся окон длиной в колоду.
      for (let s = 0; s + L <= seq.length; s += L) {
        const w = seq.slice(s, s + L)
        повторовВОкне += L - new Set(w).size
        окон++
      }
    }
    const топ = [...счёт.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const ожид = (N * seeds.length) / L
    console.log(
      `${size}: разных ${всеВиданы.size}/${L} · повторов в окне длиной ${L}: ${(повторовВОкне / окон).toFixed(1)} из ${L} (${((повторовВОкне / окон / L) * 100).toFixed(0)}%) · order≠${L} на ${((короткийOrder / шагов) * 100).toFixed(1)}% шагов`,
    )
    console.log(
      `   ожидание на карту ${ожид.toFixed(0)}, топ-5: ${топ.map(([k, v]) => `${k}=${v}`).join(' ')}`,
    )
  }
}
