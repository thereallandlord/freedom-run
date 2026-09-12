/**
 * Деньги на Полосе идут по-настоящему (11.09).
 *
 * 🔴 С 03.09 дела, купленные на Полосе, не платили в кассу ни рубля — доход
 * был только на экране; просадка от «тянуть беду» резала только это число;
 * клетка «продать выше рынка» отклоняла всех. Здесь проверяется, что деньги
 * ходят так, как написано на карточках.
 */
import { createTable, applyTableEvent, dreamPriceAt, sellOfferQuote } from './table'
import { applyEvent } from './applyEvent'
import { RULES, totalExpenses, totalIncome } from './ledger'
import { fastBoard } from './data'
import type { Ledger, Table } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

function стол(): Table {
  return createTable({
    seed: 5,
    deckTheme: 'ru',
    seats: [
      { id: 'a', name: 'Камиль', professionId: 'engineer', dreamSpace: 2 },
      { id: 'b', name: 'Анвар', professionId: 'doctor', dreamSpace: 13 },
    ],
  } as never)
}
// Кошелёк, вышедший на Полосу: наличных много, зарплаты больше нет.
function наПолосе(l0: Ledger): Ledger {
  const l = structuredClone(l0)
  l.cash = 30_000_000
  return applyEvent(l, { type: 'ENTER_FAST_TRACK' } as never)
}
function ходящийНаПолосе(t: Table, l: Ledger, pending: unknown): Table {
  return {
    ...t,
    turnIndex: 0,
    phase: 'resolving',
    seats: [{ ...t.seats[0], track: 'fast', ledger: l }, t.seats[1]],
    pending,
  } as Table
}

// 1–2. Дело Полосы платит в кассу; просадка режет кассу.
{
  const база = наПолосе(стол().seats[0].ledger)
  const сДелом = applyEvent(база, {
    type: 'BUY_FT_BUSINESS',
    id: 'ft1',
    name: 'Кофейня',
    downPayment: 2_500_000,
    cashFlow: 138_000,
  } as never)
  const без = applyEvent(база, { type: 'CASHFLOW_DAY' } as never)
  const с = applyEvent(сДелом, { type: 'CASHFLOW_DAY' } as never)
  const прирост = с.cash - сДелом.cash - (без.cash - база.cash)
  п('дело Полосы платит в кассу', прирост === 138_000, String(прирост))
  п('в ведомости — то, что пришло', с.lastPaycheck === с.cash - сДелом.cash, `${с.lastPaycheck} против ${с.cash - сДелом.cash}`)
  const сПросадкой = applyEvent(сДелом, { type: 'SET_FT_DIP', pct: 50, paydays: 2 } as never)
  const д = applyEvent(сПросадкой, { type: 'CASHFLOW_DAY' } as never)
  const срез = с.cash - сДелом.cash - (д.cash - сПросадкой.cash)
  const ждём = Math.round((totalIncome(сДелом) + 138_000) * 0.5)
  п('просадка 50% режет половину дохода Полосы в кассе', Math.abs(срез - ждём) <= 1, `${срез} против ${ждём}`)
}

// 3. Клетка «продать выше рынка»: ходящий продаёт свой актив, чужой — нет, карточка закрывается.
{
  const t0 = стол()
  const l = наПолосе(t0.seats[0].ledger)
  l.realEstate = [
    { id: 'kv', name: 'Студия', cost: 5_000_000, value: 5_000_000, downPayment: 5_000_000, mortgage: 0, cashFlow: 40_000, category: 'aptKZN' } as never,
  ]
  const t = ходящийНаПолосе(t0, l, {
    kind: 'market',
    card: { id: 'ft-sell-36', deck: 'market', kind: 'sellOffer', category: '*', multiplierPct: 145, title: 'Покупатель', text: '' },
  })
  п('чужой не продаёт на клетке Полосы', applyTableEvent(t, { type: 'ACCEPT_OFFER', seatId: 'b', assetId: 'kv' } as never) === t)
  const n = applyTableEvent(t, { type: 'ACCEPT_OFFER', seatId: 'a', assetId: 'kv' } as never)
  const ждём = sellOfferQuote(l.realEstate[0] as never, 0, 145, t.market.price['aptKZN'] ?? 1).price
  п('ходящий продаёт свой актив на клетке Полосы', n !== t && n.seats[0].ledger.realEstate.length === 0)
  п('продано по цене клетки', n.seats[0].ledger.cash - l.cash === ждём, `${n.seats[0].ledger.cash - l.cash} против ${ждём}`)
  п('после продажи карточка закрыта', n.pending === null)
}

// 4. Чужая мечта дорожает на шаг и не выше потолка.
{
  const t = стол()
  const клетка = fastBoard().findIndex((s) => s.type === 'dream')
  const база = dreamPriceAt(t, клетка)
  const потолок = RULES.dreamBumpCapPct
  п('у подорожания мечты есть потолок', потолок != null, String(потолок))
  if (потолок != null) {
    const много = { ...t, dreamBumps: { ...t.dreamBumps, [клетка]: 50 } } as Table
    const ждём = Math.round((база * (100 + потолок)) / 100 / 1000) * 1000
    п('подорожание упирается в потолок', dreamPriceAt(много, клетка) === ждём, `${dreamPriceAt(много, клетка)} против ${ждём}`)
  }
}

// 5. У своей мечты можно быстро продать дело, пока карточка мечты на столе.
{
  const t0 = стол()
  const l = наПолосе(t0.seats[0].ledger)
  l.cash = 100_000
  l.businesses = [
    { id: 'biz', name: 'Барбершоп', cost: 1_900_000, value: 1_900_000, downPayment: 1_900_000, liability: 0, cashFlow: 100_000, category: 'bizService' } as never,
  ]
  const t = ходящийНаПолосе(t0, l, { kind: 'ftDream', space: 2 })
  const n = applyTableEvent(t, { type: 'SELL_ASSET_NOW', assetId: 'biz' } as never)
  п('у своей мечты можно быстро продать дело', n !== t && n.seats[0].ledger.businesses.length === 0)
  п('карточка мечты после продажи на столе', n.pending?.kind === 'ftDream', String(n.pending?.kind))
}

// 6. На Полосе открывается ещё одна точка своего дела (Камиль 01.09: вложиться в бизнес — на обоих кругах).
{
  const t0 = стол()
  const l = наПолосе(t0.seats[0].ledger)
  l.businesses = [
    { id: 'kof', name: 'Кофейня', cost: 2_500_000, value: 2_500_000, downPayment: 2_500_000, liability: 0, cashFlow: 90_000, category: 'bizFood', managerPct: 35 } as never,
  ]
  const t = { ...ходящийНаПолосе(t0, l, null), phase: 'awaitingRoll' } as Table
  const n = applyTableEvent(t, { type: 'OPEN_BRANCH', assetId: 'kof' } as never)
  п('на Полосе открывается ещё одна точка', n !== t && n.seats[0].ledger.businesses.some((b) => b.точкаОт === 'kof'))
}

// 7. Дело второго круга продаётся быстро: 85% вложенного на счёт, клетка свободна (12.09).
{
  const t0 = стол()
  const l = наПолосе(t0.seats[0].ledger)
  l.fastTrack!.businesses = [{ id: 'ft-1', name: 'Кофейня', downPayment: 2_500_000, cashFlow: 138_000 }]
  const t = { ...ходящийНаПолосе(t0, l, null), phase: 'awaitingRoll', ftOwnership: { 1: 'a' } } as Table
  const n = applyTableEvent(t, { type: 'SELL_ASSET_NOW', assetId: 'ft-1' } as never)
  const пришло = n.seats[0].ledger.cash - l.cash
  п('дело второго круга продаётся', n !== t && (n.seats[0].ledger.fastTrack?.businesses.length ?? -1) === 0)
  п('за 85% вложенного', пришло === 2_125_000, String(пришло))
  п('клетка дела освободилась', n.ftOwnership[1] === undefined, String(n.ftOwnership[1]))
}

// 8. Обязательная трата второго круга — не больше полугода расходов игрока (12.09).
{
  const t0 = стол()
  const l = наПолосе(t0.seats[0].ledger)
  l.cash = 5_000_000
  const доска = fastBoard() as { type: string; want?: boolean; amount?: number }[]
  const клетка = доска.findIndex((s) => s.type === 'lifeSpend' && !s.want && (s.amount ?? 0) > 0)
  const сумма = доска[клетка].amount ?? 0
  const t = { ...ходящийНаПолосе(t0, l, null), phase: 'awaitingRoll' } as Table
  t.seats = [{ ...t.seats[0], position: клетка - 2 }, t.seats[1]]
  const n = applyTableEvent(t, { type: 'ROLL', dice: [1, 1] } as never)
  const карта = n.pending as { kind?: string; before?: number; after?: number } | null
  const взяли = (карта?.before ?? 0) - (карта?.after ?? 0)
  const поМасштабу = Math.round((totalExpenses(n.seats[0].ledger) * (RULES.ftLifeSpendMonths ?? 0)) / 1000) * 1000
  п('у инженера полгода расходов меньше суммы клетки', поМасштабу > 0 && поМасштабу < сумма, `${поМасштабу} против ${сумма}`)
  п('трата взята по масштабу жизни', карта?.kind === 'ftEvent' && взяли === Math.min(сумма, поМасштабу), `${карта?.kind}: ${взяли} против ${Math.min(сумма, поМасштабу)}`)
}

console.log(
  беды.length
    ? '\n❌ ДЕНЬГИ НА ПОЛОСЕ:\n  ' + беды.join('\n  ')
    : '\n✅ ДЕНЬГИ НА ПОЛОСЕ ИДУТ ПО-НАСТОЯЩЕМУ: дела платят, просадка режет, продажа работает',
)
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
