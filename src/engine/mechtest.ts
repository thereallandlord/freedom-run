/** Точечная проверка новых механик RU-режима без интерфейса. */
import { createTable, applyTableEvent, currentSeat, type TableSetup } from './table'
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

console.log('\n=== Кредит недоступен ===')
const beforeLoan = t.seats[0].ledger.cash
t = applyTableEvent(t, { type: 'TAKE_LOAN', amount: 100000 })
check('TAKE_LOAN отклонён', t.seats[0].ledger.cash === beforeLoan)

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

console.log('\n=== Инвестор: взнос его, поток пополам ===')
let l2 = t.seats[1].ledger
const cashBefore = l2.cash
l2 = applyEvent(l2, {
  type: 'BUY_REAL_ESTATE', id: 're1', name: 'Тест', cost: 10_000_000, downPayment: 500_000,
  mortgage: 9_500_000, cashFlow: 40_000, category: 'aptKZN', investorShare: 0.5,
})
check('взнос не списан с игрока', l2.cash === cashBefore, `${cashBefore} → ${l2.cash}`)
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
check('профессий РФ 12', professionsFor('ru').length === 12)

console.log(`\n${ok ? '✅ ВСЕ МЕХАНИКИ РАБОТАЮТ' : '❌ ЕСТЬ ПРОБЛЕМЫ'}\n`)
if (!ok) process.exit(1)
