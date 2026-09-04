/** Точечная проверка новых механик RU-режима без интерфейса. */
import { createTable, applyTableEvent, currentSeat, pendingInvolvesOthers, type TableSetup } from './table'
import { applyEvent } from './applyEvent'
import { passiveIncome, monthlyCashFlow, RULES, ownShare } from './ledger'
import { professionsFor, setActiveTheme, setFastBoardTheme, dreamSpaces, smallDeals, bigDeals, marketCards, doodads } from './data'
import {
  GL_PACKAGES,
  glPackage,
  glRankFor,
  glStructureIncome,
  glTotalIncome,
  glUpgradeCost,
  glInitialState,
  glOnPayday,
} from './greenleaf'

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
/*
 * Выкупа больше нет: выход из Круга — увольнение, активы остаются. Вместо
 * множителя проверяем то, что теперь решает второй круг, — планку свободы.
 */
check('свобода = доход вдвое выше расходов', (RULES.freedomMultiple ?? 2) === 2, String(RULES.freedomMultiple))
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

console.log('\n=== Партнёрский бизнес GreenLeaf ===')
// 🔴 GreenLeaf переехал в МАЛЫЕ сделки: вход 28 900 — самый дешёвый в игре,
// в крупных он был заперт за деньгами и мог не выпасть за всю партию.
const pn = smallDeals('ru').find((c: any) => c.category === 'partnership') as any
check('карта партнёрки есть', !!pn, pn?.title)
let led = t.seats[0].ledger
led = applyEvent(led, { type: 'ADJUST_CASH', amount: 300_000 })
led = applyEvent(led, {
  type: 'BUY_BUSINESS', id: 'pn1', name: pn.title, cost: GL_PACKAGES[0].price,
  downPayment: GL_PACKAGES[0].price, liability: 0, cashFlow: 1700, category: 'partnership',
  glPackage: 'platinum', glLuck: 1,
})
const glBiz = () => led.businesses.find((b) => b.gl)!
check('состояние GreenLeaf заведено', !!glBiz().gl, glBiz().gl && glPackage(glBiz().gl!.packageId).name)
const flow0 = glTotalIncome(glBiz().gl!)
for (let i = 0; i < 5; i++) led = applyEvent(led, { type: 'PAYCHECK' })
const flow5 = glTotalIncome(glBiz().gl!)
check('доход растёт сам, по чуть-чуть', flow5 > flow0, `${flow0} → ${flow5}`)
check('зеркало cashFlow сходится', glBiz().cashFlow === flow5, `${glBiz().cashFlow} vs ${flow5}`)
for (let i = 0; i < 25; i++) led = applyEvent(led, { type: 'PAYCHECK' })
const rank = glRankFor(glBiz().gl!.volume)
check('ранг закрывается по объёму', rank.level >= 1, `${rank.name}, объём ${glBiz().gl!.volume} ₽`)
check('пенсия идёт сверх структуры',
  glTotalIncome(glBiz().gl!) === glStructureIncome(glBiz().gl!) + rank.pension,
  `${glStructureIncome(glBiz().gl!)} + ${rank.pension}`)
check('разовый бонус за ранг выдан', glBiz().gl!.rankPaid >= 1, String(glBiz().gl!.rankPaid))
// Старший пакет даёт БОЛЬШЕ с той же структуры — но не втрое, а ровно на четверть и половину.
check('Бриллиант даёт +25%', Math.abs(GL_PACKAGES[1].mul - 1.25) < 1e-9, String(GL_PACKAGES[1].mul))
check('Корона даёт +50%', Math.abs(GL_PACKAGES[2].mul - 1.5) < 1e-9, String(GL_PACKAGES[2].mul))
check('апгрейд стоит разницу', glUpgradeCost('platinum', 'crown') === GL_PACKAGES[2].price - GL_PACKAGES[0].price,
  String(glUpgradeCost('platinum', 'crown')))

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

console.log('\n=== Развод: разовые расходы, а не «половина всего» ===')
{
  let l4 = applyEvent(t.seats[0].ledger, { type: 'ADJUST_CASH', amount: 500_000 })
  const c4 = l4.cash
  l4 = applyEvent(l4, { type: 'DIVORCE', amount: 200_000 })
  check('списана названная сумма', c4 - l4.cash === 200_000, `${c4} → ${l4.cash}`)
  const poor = applyEvent(applyEvent(t.seats[0].ledger, { type: 'DIVORCE', amount: 10_000_000 }), { type: 'ADJUST_CASH', amount: 0 })
  check('в минус не уводит', poor.cash === 0, String(poor.cash))
}

console.log('\n=== Закят: с мёртвых денег, не с активов ===')
{
  const { RULES: R, zakatBase, zakatDue } = await import('./ledger')
  let z = applyEvent(t.seats[0].ledger, { type: 'ADJUST_CASH', amount: 1_000_000 })
  const baseCash = zakatBase(z)
  z = applyEvent(z, {
    type: 'BUY_REAL_ESTATE', id: 're-z', name: 'Квартира', cost: 5_000_000, downPayment: 500_000,
    mortgage: 4_500_000, cashFlow: 20_000, category: 'aptKZN',
  })
  check('квартира в базу закята НЕ входит', zakatBase(z) === baseCash - 500_000, `${baseCash} → ${zakatBase(z)}`)
  check('закят включён в RU-режиме', R.zakat.enabled === true)
  const due = zakatDue(z)
  check('ставка 2,5%', Math.abs(due - zakatBase(z) * 0.025) < 200, `${due} с базы ${zakatBase(z)}`)
  const after = applyEvent(z, { type: 'ZAKAT' })
  check('закят списывается', z.cash - after.cash === due)
}

console.log('\n=== Сделки между игроками ===')
{
  const tr = await import('./trades')
  check('цену «другу за рубль» отбивает', tr.priceAllowed(1, 500_000) === false)
  check('честный торг проходит', tr.priceAllowed(600_000, 500_000) === true)
  // Пол коридора опущен до десятой части (правка Камиля: «хочу сам назначать цену»).
  check('цена зажимается в коридор', tr.clampPrice(1, 500_000) === 50_000, String(tr.clampPrice(1, 500_000)))
  check('доля считается по деньгам', Math.abs(tr.shareOf(300_000, 1_000_000) - 0.3) < 1e-9)
  const profit = tr.splitProceeds(100_000, 0.3, 0.5)
  check('прибыль по договорённости', profit.mine === 50_000, String(profit.mine))
  const loss = tr.splitProceeds(-100_000, 0.3, 0.5)
  check('убыток строго по долям капитала', loss.mine === -30_000, String(loss.mine))
  const loans = [{ id: 'l1', lenderId: 'a', borrowerId: 'b', amount: 100_000, repaid: 40_000, atTurn: 1 }]
  check('остаток долга считается', tr.loanOutstanding(loans, 'b') === 60_000)
  check('с долгом победить нельзя', tr.canWinWithLoans(loans, 'b') === false)
  check('без долга можно', tr.canWinWithLoans(loans, 'a') === true)
}

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
  /*
   * Потолка у GreenLeaf больше нет — доход растёт, пока игрок работает.
   * Вместо потолка держим ДРУГОЙ рубеж: за 36 зарплат без единого ускорителя
   * бизнес не должен вырасти до чего-то, что само выносит из Рутины.
   * Камиль: «в космос не улетает и грошей не платит».
   */
  let g = glInitialState('platinum', 1)
  for (let i = 0; i < 36; i++) { g = glOnPayday(g).next; g.age += 1 }
  const passive = glTotalIncome(g)
  /*
   * 🔴 Порог поднят вслед за темпом роста (правка Камиля 19.08: «сто ходов
   * играем, а доход всё ещё пять тысяч»). Партнёрский бизнес — быстрый путь,
   * и он обязан таким быть; рубеж держим на порядке величины, чтобы поймать
   * настоящий разгон в миллионы, а не нормальный рост.
   */
  check('пассивный игрок не улетает', passive < 2_500_000, `${passive} ₽/мес за 36 зарплат без работы`)
  // Геометрия: за три года без единого действия структура даёт немного — и это
// правда жизни. Проверяем лишь, что она вообще растёт и не стоит на месте.
  check('пассивный игрок не в грошах', passive > 5_000, `${passive} ₽/мес за 36 зарплат без работы`)
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
// 🔴 Доходность НАСТОЯЩАЯ, без урезания: с тройкой аренда однушки в Казани
// считалась за 1,7% годовых, и ни одна покупка в рассрочку не сходилась.
check('доходность настоящая, не урезана', RULES.yieldScale === 1, String(RULES.yieldScale))
/*
 * Срок 300 месяцев — как у настоящей ипотеки. Сокращали до 180, когда
 * доходность была игровой (1% в месяц) и рассрочка выигрывала у нала втрое.
 * С жизненной доходностью (0,45%) картина перевернулась: платёж при 180
 * месяцах БОЛЬШЕ дохода, и 35 объектов из 57 переставали приносить вовсе.
 */
check('жильё в рассрочку на 25 лет', RULES.installmentTerm.realEstate === 300, String(RULES.installmentTerm.realEstate))

console.log('\n=== Колоды RU ===')
check('малых сделок', smallDeals('ru').length >= 30, String(smallDeals('ru').length))
check('крупных сделок', bigDeals('ru').length >= 20, String(bigDeals('ru').length))
// Мелкие бизнесы переехали в малые сделки: их тянет и рассрочка, и соинвестор.
const smallBiz = smallDeals('ru').filter((c: any) => c.kind === 'business')
check('бизнесы есть и в малых сделках', smallBiz.length >= 5, String(smallBiz.length))
check('карт рынка', marketCards('ru').length >= 30, String(marketCards('ru').length))
check('трат', doodads('ru').length >= 30, String(doodads('ru').length))
// Обязательные траты держим скромными: от них не отказаться, они не должны разорять.
const dood = doodads('ru').filter((d) => !d.want).map((d) => d.amount)
check('обязательные траты скромные', Math.max(...dood) <= 30_000, `макс ${Math.max(...dood)} ₽`)
// Хотелки — наоборот, крупные: отказ от них должен быть настоящим решением.
const wants = doodads('ru').filter((d) => d.want)
check('хотелки есть', wants.length >= 8, String(wants.length))
check('хотелки ощутимые', Math.max(...wants.map((w) => w.amount)) >= 100_000,
  `макс ${Math.max(...wants.map((w) => w.amount))} ₽`)
check('у части хотелок есть содержание', wants.filter((w) => w.upkeep).length >= 3,
  String(wants.filter((w) => w.upkeep).length))
// GreenLeaf — ОДНА карта с тремя ценами внутри, а не три разные карты:
// выбор пакета должен быть решением игрока, а не тем, что ему выпало.
const partnerships = smallDeals('ru').filter((c: any) => c.category === 'partnership')
check('карта GreenLeaf одна', partnerships.length === 1, String(partnerships.length))
check('у неё три цены', GL_PACKAGES.length === 3, GL_PACKAGES.map((p) => p.name).join('/'))
const glEvents = marketCards('ru').filter((c: any) => c.kind === 'glEvent')
check('события GreenLeaf есть', glEvents.length >= 8, String(glEvents.length))
const glDown = glEvents.filter((c: any) => c.dipPct || c.freezePaydays)
check('среди них есть беды', glDown.length >= 3, String(glDown.length))
const raises = marketCards('ru').filter((c: any) => c.kind === 'payRaise')
check('карт повышения есть', raises.length >= 3, String(raises.length))
const autopromo = marketCards('ru').find((c: any) => c.amountPerPartnership)
check('автопромоушен-карта есть', !!autopromo, (autopromo as any)?.title)
/*
 * Число сверяем, чтобы профессия не пропала молча при правке данных. Растёт
 * оно только осознанно: 19-й стал «Вайб-кодер» — Камиль просил его отдельно.
 */
check('профессий РФ 19', professionsFor('ru').length === 19, String(professionsFor('ru').length))

console.log(`\n${ok ? '✅ ВСЕ МЕХАНИКИ РАБОТАЮТ' : '❌ ЕСТЬ ПРОБЛЕМЫ'}\n`)
if (!ok) process.exit(1)
