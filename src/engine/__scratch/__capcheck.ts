/** Проверка заявления: продажа партнёрки покупателю, у которого уже 3 кабинета. */
import { createTable, applyTableEvent, type TableSetup } from '../table'
import { applyEvent } from '../applyEvent'
import { setActiveTheme, setFastBoardTheme, dreamSpaces } from '../data'

setActiveTheme('ru')
setFastBoardTheme('ru')
const dreams = dreamSpaces()
const setup: TableSetup = {
  seed: 42,
  deckTheme: 'ru',
  seats: [
    { name: 'Продавец', professionId: 'engineer', dreamSpace: dreams[0].index, isBot: false, botDifficulty: 'medium' },
    { name: 'Покупатель', professionId: 'teacher', dreamSpace: dreams[1].index, isBot: false, botDifficulty: 'medium' },
  ],
}
let t = createTable(setup)

const PRICE = 28_900

// Продавец: один партнёрский кабинет.
let s = t.seats[0].ledger
s = applyEvent(s, { type: 'ADJUST_CASH', amount: 1_000_000 })
s = applyEvent(s, {
  type: 'BUY_BUSINESS', id: 'pn-sell', name: 'Кабинет продавца', cost: PRICE, downPayment: 0,
  liability: 0, cashFlow: 1700, category: 'partnership',
})

// Покупатель: уже три кабинета + деньги.
let b = t.seats[1].ledger
b = applyEvent(b, { type: 'ADJUST_CASH', amount: 5_000_000 })
for (let i = 0; i < 3; i++) {
  b = applyEvent(b, {
    type: 'BUY_BUSINESS', id: `pn-buy${i}`, name: 'Кабинет', cost: PRICE, downPayment: 0,
    liability: 0, cashFlow: 1700, category: 'partnership',
  })
}

t = { ...t, turnIndex: 0, seats: t.seats.map((seat, i) => (i === 0 ? { ...seat, ledger: s } : { ...seat, ledger: b })) }

const sellerCash0 = t.seats[0].ledger.cash
const buyerCash0 = t.seats[1].ledger.cash
console.log('ДО: продавец кабинетов', t.seats[0].ledger.businesses.length, 'наличных', sellerCash0)
console.log('ДО: покупатель кабинетов', t.seats[1].ledger.businesses.length, 'наличных', buyerCash0)

t = applyTableEvent(t, { type: 'OFFER_ASSET', assetId: 'pn-sell', toId: t.seats[1].id, amount: PRICE } as any)
const offer = t.offers[t.offers.length - 1]
console.log('оферта:', offer?.kind, 'цена', offer?.amount)
t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: offer.id, seatId: t.seats[1].id } as any)

const S = t.seats[0].ledger
const B = t.seats[1].ledger
console.log('ПОСЛЕ: продавец кабинетов', S.businesses.length, 'наличных', S.cash, '(получил', S.cash - sellerCash0, ')')
console.log('ПОСЛЕ: покупатель кабинетов', B.businesses.length, 'наличных', B.cash, '(заплатил', buyerCash0 - B.cash, ')')
console.log('журнал хвост:', t.log.slice(-3).map((e) => e.text))

// ── Контроль: тот же обмен, но покупателю НЕ до потолка (2 кабинета) ──
let t2 = createTable(setup)
let s2 = applyEvent(t2.seats[0].ledger, {
  type: 'BUY_BUSINESS', id: 'pn-sell', name: 'Кабинет продавца', cost: PRICE, downPayment: 0,
  liability: 0, cashFlow: 1700, category: 'partnership',
})
let b2 = applyEvent(t2.seats[1].ledger, { type: 'ADJUST_CASH', amount: 5_000_000 })
for (let i = 0; i < 2; i++) {
  b2 = applyEvent(b2, {
    type: 'BUY_BUSINESS', id: `pn-buy${i}`, name: 'Кабинет', cost: PRICE, downPayment: 0,
    liability: 0, cashFlow: 1700, category: 'partnership',
  })
}
t2 = { ...t2, turnIndex: 0, seats: t2.seats.map((seat, i) => (i === 0 ? { ...seat, ledger: s2 } : { ...seat, ledger: b2 })) }
t2 = applyTableEvent(t2, { type: 'OFFER_ASSET', assetId: 'pn-sell', toId: t2.seats[1].id, amount: PRICE } as any)
const o2 = t2.offers[t2.offers.length - 1]
t2 = applyTableEvent(t2, { type: 'ACCEPT_OFFER_TRADE', offerId: o2.id, seatId: t2.seats[1].id } as any)
console.log('\nКОНТРОЛЬ (у покупателя было 2): продавец кабинетов', t2.seats[0].ledger.businesses.length,
  '| покупатель кабинетов', t2.seats[1].ledger.businesses.length)
