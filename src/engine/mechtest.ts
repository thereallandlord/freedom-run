/** Точечная проверка новых механик RU-режима без интерфейса. */
import { createTable, applyTableEvent, currentSeat, pendingInvolvesOthers, type TableSetup } from './table'
import { applyEvent } from './applyEvent'
import { passiveIncome, monthlyCashFlow, RULES, ownShare } from './ledger'
import { professionsFor, setActiveTheme, setFastBoardTheme, dreamSpaces, smallDeals, bigDeals, marketCards, doodads } from './data'

setActiveTheme('ru'); setFastBoardTheme('ru')
const dreams = dreamSpaces()
const setup: TableSetup = {
  seed: 42, deckTheme: 'ru',
  seats: [
    { name: 'A', professionId: 'engineer', dreamSpace: dreams[0].index, isBot: false, botDifficulty: 'medium' },
    { name: 'B', professionId: 'teacher', dreamSpace: dreams[1].index, isBot: false, botDifficulty: 'medium' },
  ],
}
let t = createTable(setup)
let ok = true
const check = (name: string, cond: boolean, info = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`)
  if (!cond) ok = false
}

console.log('\n=== Режим ===')
check('валюта рубли', RULES.currency === 'RUB')
check('кредиты выключены', RULES.loansEnabled === false)
check('выкуп ×50', RULES.fastTrackMultiplier === 50)
check('цель Полосы 1 млн', RULES.fastTrackTarget === 1_000_000)

console.log('\n=== Заём есть, но беспроцентный (кард хасан) ===')
{
  let l = t.seats[0].ledger
  const before = l.cash
  l = applyEvent(l, { type: 'TAKE_LOAN', amount: 100_000 })
  check('деньги пришли', l.cash === before + 100_000)
  check('платёж = 1/10', l.expenses.bankLoanPayment === 10_000)
  const debt0 = l.liabilities.bankLoan
  for (let i = 0; i < 10; i++) l = applyEvent(l, { type: 'PAYCHECK' })
  check('долг гасится платежами', l.liabilities.bankLoan === 0, `${debt0} → 0 за 10 зарплат`)
  check('платёж исчез вместе с долгом', l.expenses.bankLoanPayment === 0)
  check('переплаты нет', debt0 === 100_000, 'вернул ровно столько же')
}

console.log('\n=== Партнёрский бизнес: рост со временем ===')
const pn = bigDeals('ru').find((c: any) => c.category === 'partnership') as any
check('карта партнёрки есть', !!pn, pn?.title)
let led = t.seats[0].ledger
led = applyEvent(led, {
  type: 'BUY_BUSINESS', id: 'pn1', name: pn.title, cost: pn.cost, downPayment: pn.downPayment,
  liability: pn.liability ?? 0, cashFlow: pn.cashFlow, category: 'partnership',
  growthPerPayday: pn.growthPerPayday, growthCap: pn.growthCap,
})
const flow0 = led.businesses[0].cashFlow
for (let i = 0; i < 5; i++) led = applyEvent(led, { type: 'PAYCHECK' })
const flow5 = led.businesses[0].cashFlow
check('поток растёт с зарплатами', flow5 > flow0, `${flow0} → ${flow5} (потолок ${pn.growthCap})`)
for (let i = 0; i < 100; i++) led = applyEvent(led, { type: 'PAYCHECK' })
check('рост упирается в потолок', led.businesses[0].cashFlow === pn.growthCap, String(led.businesses[0].cashFlow))

console.log('\n=== Мушарака: складываемся долями, делим в тех же долях ===')
let l2 = applyEvent(t.seats[1].ledger, { type: 'ADJUST_CASH', amount: 500_000 })
const cashBefore = l2.cash
l2 = applyEvent(l2, {
  type: 'BUY_REAL_ESTATE', id: 're1', name: 'Тест', cost: 10_000_000, downPayment: 500_000,
  mortgage: 9_500_000, cashFlow: 40_000, category: 'aptKZN', investorShare: 0.5,
})
check('игрок внёс свою половину', cashBefore - l2.cash === 250_000, `списано ${cashBefore - l2.cash}`)
check('в пассив идёт половина', passiveIncome(l2) === 20_000, String(passiveIncome(l2)))
const l3 = applyEvent(l2, { type: 'SELL_REAL_ESTATE', assetId: 're1', salePrice: 12_000_000 })
check('с продажи игроку половина', l3.cash - l2.cash === 1_250_000, String(l3.cash - l2.cash))

console.log('\n=== Развод: половина, не всё ===')
let l4 = t.seats[0].ledger
l4 = applyEvent(l4, { type: 'ADJUST_CASH', amount: 100_000 })
const c4 = l4.cash
l4 = applyEvent(l4, { type: 'DIVORCE' })
check('осталась половина', l4.cash === Math.floor(c4 / 2), `${c4} → ${l4.cash}`)

console.log('\n=== Повышение зарплаты ===')
let l5 = applyEvent(t.seats[0].ledger, { type: 'SALARY_RAISE', amount: 20_000 })
check('зарплата выросла', l5.salary === t.seats[0].ledger.salary + 20_000)

console.log('\n=== Трата в рассрочку без процентов ===')
let l6 = applyEvent(t.seats[0].ledger, { type: 'FINANCE_DOODAD', amount: 20_000 })
check('платёж = 1/10 суммы', l6.expenses.retailPayment - t.seats[0].ledger.expenses.retailPayment === 2000)
check('кредитка не тронута', l6.liabilities.creditCards === t.seats[0].ledger.liabilities.creditCards)

console.log('\n=== Карта рынка видна другим игрокам ===')
{
  // У второго игрока есть акции; активный тянет котировку — он должен увидеть карту.
  let t2 = createTable(setup)
  t2.seats[1] = {
    ...t2.seats[1],
    ledger: applyEvent(t2.seats[1].ledger, {
      type: 'BUY_STOCK', id: 'lot1', symbol: 'GRIT', shares: 10, costPerShare: 500, dividendPerShareMonthly: 0,
    }),
  }
  t2 = { ...t2, pending: { kind: 'market', card: { kind: 'stockPrice', id: 'x', title: 'GRIT', flavor: '', symbol: 'GRIT', price: 3000 } } }
  check('котировка касается держателя', pendingInvolvesOthers(t2) === true)

  let t3 = createTable(setup)
  t3 = { ...t3, pending: { kind: 'market', card: { kind: 'stockPrice', id: 'x', title: 'GRIT', flavor: '', symbol: 'GRIT', price: 3000 } } }
  check('без держателей — никого не касается', pendingInvolvesOthers(t3) === false)

  let t4 = createTable(setup)
  t4 = { ...t4, pending: { kind: 'deal', deck: 'small', card: { kind: 'stock', id: 'y', symbol: 'GRIT', title: '', flavor: '', price: 2000, range: [100, 4000] } } }
  check('дешёвую акцию может купить сосед', pendingInvolvesOthers(t4) === true)
}

console.log('\n=== Партнёрский бизнес не принтер ===')
{
  const pns = bigDeals('ru').filter((c: any) => c.category === 'partnership') as any[]
  const worst = Math.max(...pns.map((c) => c.growthCap / c.downPayment))
  check('потолок соразмерен взносу', worst < 0.4, `максимум ${(worst * 100).toFixed(0)}% от взноса в месяц`)
  let l = t.seats[0].ledger
  for (let i = 0; i < 5; i++) {
    l = applyEvent(l, {
      type: 'BUY_BUSINESS', id: `pn${i}`, name: 'Пакет', cost: 28_900, downPayment: 0,
      liability: 0, cashFlow: 1700, category: 'partnership',
    })
  }
  check('больше трёх кабинетов не набрать', l.businesses.length === 3, `куплено ${l.businesses.length}`)
}

console.log('\n=== Масштаб доходности ===')
check('в RU-режиме игровой масштаб', RULES.yieldScale === 0.3, String(RULES.yieldScale))

console.log('\n=== Колоды RU ===')
check('малых сделок', smallDeals('ru').length >= 30, String(smallDeals('ru').length))
check('крупных сделок', bigDeals('ru').length >= 30, String(bigDeals('ru').length))
check('карт рынка', marketCards('ru').length >= 30, String(marketCards('ru').length))
check('трат', doodads('ru').length >= 30, String(doodads('ru').length))
const dood = doodads('ru').map((d) => d.amount)
check('траты скромные', Math.max(...dood) <= 30_000, `макс ${Math.max(...dood)} ₽`)
const partnerships = bigDeals('ru').filter((c: any) => c.category === 'partnership')
check('партнёрских карт 5', partnerships.length === 5)
const raises = marketCards('ru').filter((c: any) => c.kind === 'payRaise')
check('карт повышения есть', raises.length >= 3, String(raises.length))
const autopromo = marketCards('ru').find((c: any) => c.amountPerPartnership)
check('автопромоушен-карта есть', !!autopromo, (autopromo as any)?.title)
check('профессий РФ 18', professionsFor('ru').length === 18)

console.log(`\n${ok ? '✅ ВСЕ МЕХАНИКИ РАБОТАЮТ' : '❌ ЕСТЬ ПРОБЛЕМЫ'}\n`)
if (!ok) process.exit(1)
