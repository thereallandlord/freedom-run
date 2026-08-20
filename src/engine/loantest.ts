/**
 * Проверка займа между игроками: кто просит, кто даёт, кому уходят деньги.
 * Живой случай 19.08: кнопку «Дать» видел заёмщик и дал деньги сам себе.
 * Запуск: npx tsx src/engine/loantest.ts
 */
import { applyTableEvent, createTable } from './table'
import type { Table } from './types'

function стол(): Table {
  return createTable({
    seed: 5,
    deckTheme: 'ru',
    seats: [
      { id: 'a', name: 'Камиль', isBot: false, botDifficulty: 'medium', dreamSpace: 3 },
      { id: 'b', name: 'Анвар', isBot: false, botDifficulty: 'medium', dreamSpace: 9 },
    ],
  } as never)
}

let провалов = 0
function проверь(что: string, факт: boolean) {
  console.log(`  ${факт ? '✅' : '❌'} ${что}`)
  if (!факт) провалов++
}

// ── Камиль ПРОСИТ у Анвара ──
console.log('\n█ Камиль просит у Анвара 15 000')
let t = стол()
const деньгиА = t.seats[0].ledger.cash
const деньгиБ = t.seats[1].ledger.cash
t = applyTableEvent(t, { type: 'ASK_LOAN', by: 'a', fromId: 'b', amount: 15_000 } as never)
проверь('предложение создано', t.offers.length === 1)
проверь('автор — тот, кто просил', t.offers[0].askedBy === 'a')

const id = t.offers[0].id
// Заёмщик пытается согласиться сам за себя — так и был баг.
const самСебе = applyTableEvent(t, {
  type: 'ACCEPT_OFFER_TRADE', by: 'a', offerId: id, seatId: 'a',
} as never)
проверь('заёмщик НЕ может выдать себе заём', самСебе === t)

// Кредитор соглашается — вот это должно сработать.
const дал = applyTableEvent(t, {
  type: 'ACCEPT_OFFER_TRADE', by: 'b', offerId: id, seatId: 'b',
} as never)
проверь('кредитор может дать', дал !== t)
проверь('деньги ушли ОТ кредитора', дал.seats[1].ledger.cash === деньгиБ - 15_000)
проверь('деньги пришли ЗАЁМЩИКУ', дал.seats[0].ledger.cash === деньгиА + 15_000)
проверь('долг записан верно', дал.loans[0]?.lenderId === 'b' && дал.loans[0]?.borrowerId === 'a')

// ── Анвар ПРЕДЛАГАЕТ Камилю ──
console.log('\n█ Анвар предлагает Камилю 20 000')
let t2 = стол()
t2 = applyTableEvent(t2, { type: 'END_TURN', by: 'a' } as never)
t2 = applyTableEvent(t2, { type: 'OFFER_LOAN', by: 'b', toId: 'a', amount: 20_000 } as never)
проверь('предложение создано', t2.offers.length === 1)
проверь('автор — тот, кто предложил', t2.offers[0].askedBy === 'b')
const id2 = t2.offers[0].id
const самСебе2 = applyTableEvent(t2, {
  type: 'ACCEPT_OFFER_TRADE', by: 'b', offerId: id2, seatId: 'b',
} as never)
проверь('кредитор НЕ может принять за должника', самСебе2 === t2)
const взял = applyTableEvent(t2, {
  type: 'ACCEPT_OFFER_TRADE', by: 'a', offerId: id2, seatId: 'a',
} as never)
проверь('должник может принять', взял !== t2)
проверь('деньги пришли должнику', взял.seats[0].ledger.cash === t2.seats[0].ledger.cash + 20_000)

console.log(провалов ? `\n❌ ПРОВАЛОВ: ${провалов}` : '\n✅ ЗАЁМ РАБОТАЕТ В ОБЕ СТОРОНЫ')
if (провалов) throw new Error('заём между игроками сломан')
