/** Прогон партий разными составами: ищем перекосы, тупики и принтеры денег. */
import { createTable, applyTableEvent, applyWorldEvent, nextWorldEventIndex, currentSeat, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { professionsFor, dreamSpaces, setActiveTheme, setFastBoardTheme } from './data'
import { setRules, monthlyCashFlow, passiveIncome, freedomIncome, totalExpenses, netWorth, RULES } from './ledger'
import { glTotalIncome, glRankFor } from './greenleaf'
import type { Table } from './types'
import * as dataMod from './data'
import { applyEvent } from './applyEvent'
import { ribaRisk, ownShare } from './ledger'
import { fairAssetPrice } from './trades'

setActiveTheme('ru'); setFastBoardTheme('ru')
const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

function play(seed: number, nSeats: number, diff: 'easy'|'medium'|'high'|'unreal', maxTurns = 900) {
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru'); const dreams = dreamSpaces()
  const rnd = mulberry32(seed)
  const setup: TableSetup = { seed, deckTheme: 'ru', seats: Array.from({ length: nSeats }, (_, i) => ({
    name: `И${i+1}`, professionId: pool[(seed + i * 5) % pool.length].id,
    dreamSpace: dreams[i % dreams.length].index, isBot: true, botDifficulty: diff,
  })) }
  let t: Table = createTable(setup)
  let turns = 0, worldEvents = 0, stuck = 0
  while (t.phase !== 'finished' && turns < maxTurns) {
    const before = t
    const ev = decideBotEvent(t, rnd)
    t = ev ? applyTableEvent(t, ev) : t
    if (t === before) { t = applyTableEvent(t, { type: 'END_TURN' }); stuck++ }
    turns++
    if (turns % 40 === 0) { t = applyWorldEvent(t, nextWorldEventIndex(t)); worldEvents++ }
    if (stuck > 250) break
  }
  const alive = t.seats.filter(s => !s.outOfGame)
  const fast = t.seats.filter(s => s.track === 'fast')
  const won = t.seats.filter(s => s.won)
  const gl = t.seats.filter(s => s.ledger.businesses.some(b => b.gl))
  const negCash = t.seats.filter(s => s.ledger.cash < 0)
  const maxNet = Math.max(...t.seats.map(s => netWorth(s.ledger)))
  return { turns, worldEvents, stuck, phase: t.phase,
    alive: alive.length, fast: fast.length, won: won.length, gl: gl.length,
    bankrupt: t.seats.length - alive.length, negCash: negCash.length, maxNet, table: t }
}

console.log('СЦЕНАРИИ (900 ходов каждый)\n')
const rows: string[] = []
for (const [seats, diff] of [[2,'easy'],[3,'medium'],[4,'medium'],[4,'high'],[6,'unreal']] as const) {
  for (const seed of [11, 42, 777]) {
    const r = play(seed, seats as number, diff as any)
    const mgr = r.table.seats.reduce((n: number, s: any) => n + s.ledger.businesses.filter((b: any) => b.managerPct).length, 0)
    const freeMax = Math.max(...r.table.seats.map((s: any) => freedomIncome(s.ledger)))
    rows.push(`  мест ${seats} · ${String(diff).padEnd(7)} · зерно ${String(seed).padStart(3)} → ходов ${String(r.turns).padStart(3)}  на Полосе ${r.fast}  победа ${r.won}  банкротов ${r.bankrupt}  управляющих ${mgr}  свобода макс ${M(freeMax).padStart(13)}  капитал ${M(r.maxNet).padStart(15)}`)
  }
}
rows.forEach(r => console.log(r))

console.log('\nПРОВЕРКА НА ПРИНТЕРЫ ДЕНЕГ')
const big = play(42, 4, 'unreal', 1500)
const cash = big.table.seats.map(s => s.ledger.cash)
console.log('  наличные по игрокам:', cash.map(c => M(c)).join(' · '))
console.log('  капитал максимум:', M(big.maxNet))
for (const s of big.table.seats) {
  const b = s.ledger.businesses.find(x => x.gl)
  if (b?.gl) console.log(`  ${s.name}: GreenLeaf ${M(glTotalIncome(b.gl))}/мес, ранг ${glRankFor(b.gl.volume).name}`)
}

// ─── Взаимодействия между игроками ───────────────────────────────────

console.log('\n\nВЗАИМОДЕЙСТВИЯ МЕЖДУ ИГРОКАМИ')
{
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru'); const dreams = dreamSpaces()
  /** Стол с деньгами на счетах — иначе крупная сделка не по карману и проверка ничего не проверит. */
  const mk = () => {
    let t = createTable({ seed: 5, deckTheme: 'ru', seats: [0,1,2].map(i => ({
      name: `И${i+1}`, professionId: pool[i * 4].id, dreamSpace: dreams[i].index,
      isBot: false, botDifficulty: 'medium' as const,
    })) })
    t = { ...t, seats: t.seats.map(s => ({ ...s, ledger: { ...s.ledger, cash: 20_000_000 } })) }
    return t
  }

  const cash = (t: Table, i: number) => t.seats[i].ledger.cash
  const ok = (label: string, cond: boolean, detail = '') =>
    console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)

  // 1. Продажа актива игроку: деньги списываются ОДИН раз
  {
    let t = mk()
    const big = dataMod.bigDeals('ru')
    const card = big.find((c) => c.kind === 'realEstate' && c.cashFlow > 0)!
    t = { ...t, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
    const before0 = cash(t, 0)
    t = applyTableEvent(t, { type: 'BUY_DEAL' })
    const paid = before0 - cash(t, 0)
    ok('покупка списывает ровно взнос', Math.abs(paid - (card as any).downPayment) < 2,
      `списано ${paid.toLocaleString('ru-RU')} при взносе ${(card as any).downPayment.toLocaleString('ru-RU')}`)

    const asset = t.seats[0].ledger.realEstate[0]
    // Цена лежит в коридоре вокруг доли собственника (цена минус долг).
    const price = Math.max(1, fairAssetPrice(asset.cost, asset.mortgage))
    t = applyTableEvent(t, { type: 'OFFER_ASSET', assetId: asset.id, amount: price, toId: t.seats[1].id })
    const offer = t.offers[t.offers.length - 1]
    const b1 = cash(t, 1), s0 = cash(t, 0)
    t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: offer.id, seatId: t.seats[1].id })
    const buyerPaid = b1 - cash(t, 1)
    ok('покупатель платит ОДИН раз', Math.abs(buyerPaid - price) < 2,
      `списано ${buyerPaid.toLocaleString('ru-RU')} при цене ${price.toLocaleString('ru-RU')}`)
    ok('продавец получил деньги', cash(t, 0) > s0)
    ok('актив перешёл', t.seats[1].ledger.realEstate.length === 1 && t.seats[0].ledger.realEstate.length === 0)
  }

  // 2. Соинвестирование: доля достаётся обоим
  {
    let t = mk()
    const big = dataMod.bigDeals('ru')
    const card = big.find((c) => c.kind === 'realEstate' && c.cashFlow > 0)!
    t = { ...t, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
    const half = Math.round((card as any).downPayment / 2)
    t = applyTableEvent(t, { type: 'OFFER_COINVEST', amount: half, share: 0.5, toId: t.seats[1].id })
    const offer = t.offers[t.offers.length - 1]
    const p1 = passiveIncome(t.seats[1].ledger)
    t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: offer.id, seatId: t.seats[1].id })
    const a0 = t.seats[0].ledger.realEstate.length
    const a1 = t.seats[1].ledger.realEstate.length
    ok('доля соинвестора легла ЕМУ в портфель', a1 === 1, `у инициатора ${a0}, у партнёра ${a1}`)
    ok('соинвестор получает доход', passiveIncome(t.seats[1].ledger) > p1,
      `${passiveIncome(t.seats[1].ledger).toLocaleString('ru-RU')} ₽/мес`)
  }

  // 3. Заём без надбавки и с надбавкой
  {
    let t = mk()
    t = applyTableEvent(t, { type: 'ASK_LOAN', fromId: t.seats[1].id, amount: 100_000 })
    let offer = t.offers[t.offers.length - 1]
    t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: offer.id, seatId: t.seats[1].id })
    ok('беспроцентный заём не даёт нагрузки',
      (t.seats[0].ledger.ribaExposure ?? 0) === 0 && (t.seats[1].ledger.ribaExposure ?? 0) === 0)

    let t2 = mk()
    t2 = applyTableEvent(t2, { type: 'OFFER_LOAN_WITH_INTEREST', toId: t2.seats[1].id, amount: 100_000, interestPct: 25 })
    offer = t2.offers[t2.offers.length - 1]
    t2 = applyTableEvent(t2, { type: 'ACCEPT_OFFER_TRADE', offerId: offer.id, seatId: t2.seats[1].id })
    const lender = t2.seats[0].ledger, borrower = t2.seats[1].ledger
    ok('процентный заём кладёт нагрузку НА ОБОИХ',
      (lender.ribaExposure ?? 0) > 0 && (borrower.ribaExposure ?? 0) > 0,
      `дал ${(lender.ribaExposure ?? 0).toLocaleString('ru-RU')} · взял ${(borrower.ribaExposure ?? 0).toLocaleString('ru-RU')}`)
  }

  // 4. Банковский кредит и долговая нагрузка
  {
    let t = mk()
    
    const r0 = ribaRisk(t.seats[0].ledger)
    t = applyTableEvent(t, { type: 'TAKE_RIBA', amount: 600_000 })
    const l = t.seats[0].ledger
    ok('кредит выдан', l.liabilities.ribaLoan > 0, `${l.liabilities.ribaLoan.toLocaleString('ru-RU')} ₽`)
    ok('первые зарплаты без платежей', l.expenses.ribaPayment === 0 && (l.ribaGraceLeft ?? 0) > 0)
    ok('нагрузка выросла', ribaRisk(l) > r0, `риск ${(ribaRisk(l) * 100).toFixed(0)}%`)
    let led = l
    
    for (let i = 0; i < 4; i++) led = applyEvent(led, { type: 'PAYCHECK' })
    ok('после льготы появился платёж', led.expenses.ribaPayment > 0,
      `${led.expenses.ribaPayment.toLocaleString('ru-RU')} ₽/мес`)
    led = applyEvent(led, { type: 'REPAY_RIBA_L', amount: 10_000_000 })
    ok('кредит закрывается полностью', led.liabilities.ribaLoan === 0 && led.expenses.ribaPayment === 0)
  }

  // 5. Хотелки и выгорание
  {
    
    let t = mk()
    const dood = dataMod.doodads('ru')
    const want = dood.find((d) => d.want)!
    for (let i = 0; i < 5; i++) {
      t = { ...t, pending: { kind: 'doodad', card: want } as never, phase: 'resolving' }
      t = applyTableEvent(t, { type: 'SKIP_WANT' })
    }
    ok('отказы подряд приводят к выгоранию', t.seats[0].skipTurns > 0,
      `пропускает ${t.seats[0].skipTurns} ходов`)

    let t2 = mk()
    const withUpkeep = dood.find((d) => d.want && d.upkeep)!
    const e0 = totalExpenses(t2.seats[0].ledger)
    t2 = { ...t2, pending: { kind: 'doodad', card: withUpkeep } as never, phase: 'resolving' }
    t2 = applyTableEvent(t2, { type: 'PAY_DOODAD', financed: true })
    ok('у покупки появляется содержание', totalExpenses(t2.seats[0].ledger) > e0,
      `расходы ${e0.toLocaleString('ru-RU')} → ${totalExpenses(t2.seats[0].ledger).toLocaleString('ru-RU')}`)
  }
}

// ─── Деньги не берутся из ниоткуда и не пропадают ────────────────────

console.log('\n\nСОХРАНЕНИЕ ДЕНЕГ В СДЕЛКАХ')
{
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru'); const dreams = dreamSpaces()
  const mk = () => {
    let t = createTable({ seed: 3, deckTheme: 'ru', seats: [0,1,2].map(i => ({
      name: `И${i+1}`, professionId: pool[i * 5].id, dreamSpace: dreams[i].index,
      isBot: false, botDifficulty: 'medium' as const,
    })) })
    return { ...t, seats: t.seats.map(s => ({ ...s, ledger: { ...s.ledger, cash: 30_000_000 } })) }
  }
  const purse = (t: Table) => t.seats.reduce((s, x) => s + x.ledger.cash, 0)
  const ok = (label: string, cond: boolean, detail = '') =>
    console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
  const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

  // 1. Заём между игроками: сколько ушло, столько и пришло
  {
    let t = mk()
    const before = purse(t)
    t = applyTableEvent(t, { type: 'ASK_LOAN', fromId: t.seats[1].id, amount: 300_000 })
    const o = t.offers[t.offers.length - 1]
    // 🔴 В займе принимающая сторона — ЗАЁМЩИК (o.toId), а не тот, у кого просят:
    // движок сверяет seatId с адресатом предложения. Так же делает и интерфейс.
    t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: o.id, seatId: o.toId! })
    ok('заём не меняет общую кассу', purse(t) === before, `${M(before)} → ${M(purse(t))}`)
    ok('деньги реально перешли', t.seats[0].ledger.cash > 30_000_000 && t.seats[1].ledger.cash < 30_000_000)
  }

  // 2. Продажа актива игроку: касса цела, актив один
  {
    let t = mk()
    const card = dataMod.bigDeals('ru').find((c) => c.kind === 'realEstate' && c.cashFlow > 0)!
    t = { ...t, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
    t = applyTableEvent(t, { type: 'BUY_DEAL', payCash: true })
    const a = t.seats[0].ledger.realEstate[0]
    const before = purse(t)
    const price = Math.max(1, fairAssetPrice(a.cost, a.mortgage))
    t = applyTableEvent(t, { type: 'OFFER_ASSET', assetId: a.id, amount: price, toId: t.seats[1].id })
    const o = t.offers[t.offers.length - 1]
    t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: o.id, seatId: t.seats[1].id })
    ok('продажа актива не меняет общую кассу', purse(t) === before, `${M(before)} → ${M(purse(t))}`)
    const total = t.seats.reduce((n, s) => n + s.ledger.realEstate.length, 0)
    ok('актив не размножился и не пропал', total === 1, `объектов на столе: ${total}`)
  }

  // 3. Вход в чужую находку: плата за вход уходит владельцу карты
  {
    let t = mk()
    const stock = dataMod.smallDeals('ru').find((c) => c.kind === 'stock')! as never as { price: number; symbol: string }
    t = { ...t, pending: { kind: 'deal', card: stock as never, deck: 'small' } as never, phase: 'resolving' }
    t = applyTableEvent(t, {
      type: 'SET_ACCESS',
      access: { mode: 'open', allow: t.seats.slice(1).map((s) => s.id), terms: { kind: 'fee', amount: 50_000 } },
    })
    const before = purse(t)
    const c0 = t.seats[0].ledger.cash, c1 = t.seats[1].ledger.cash
    t = applyTableEvent(t, { type: 'BUY_STOCK_SHARES', shares: 2, seatId: t.seats[1].id })
    // Стоимость самих бумаг уходит «в рынок» — это не перевод между игроками.
    // А вот плата за вход обязана остаться за столом, целиком у владельца карты.
    ok('за столом убыло ровно на стоимость бумаг',
      purse(t) === before - 2 * stock.price, `${M(before)} → ${M(purse(t))}`)
    ok('плата ушла владельцу находки', t.seats[0].ledger.cash === c0 + 50_000,
      `${M(c0)} → ${M(t.seats[0].ledger.cash)}`)
    ok('вошедший заплатил и бумаги, и вход',
      c1 - t.seats[1].ledger.cash === 2 * stock.price + 50_000,
      `списано ${M(c1 - t.seats[1].ledger.cash)}`)
  }

  // 4. Закрытый вход: чужого не пускает
  {
    let t = mk()
    const stock = dataMod.smallDeals('ru').find((c) => c.kind === 'stock')!
    t = { ...t, pending: { kind: 'deal', card: stock, deck: 'small' } as never, phase: 'resolving' }
    const c1 = t.seats[1].ledger.cash
    t = applyTableEvent(t, { type: 'BUY_STOCK_SHARES', shares: 2, seatId: t.seats[1].id })
    ok('без разрешения в чужую находку не войти', t.seats[1].ledger.cash === c1)
  }

  // 5. Доля с прибыли: берётся только с прибыли и уходит владельцу
  {
    let t = mk()
    const stock = dataMod.smallDeals('ru').find((c) => c.kind === 'stock' && c.price > 1000)! as never as { price: number; symbol: string }
    t = { ...t, pending: { kind: 'deal', card: stock as never, deck: 'small' } as never, phase: 'resolving' }
    t = applyTableEvent(t, {
      type: 'SET_ACCESS',
      access: { mode: 'open', allow: t.seats.slice(1).map((s) => s.id), terms: { kind: 'profitShare', pct: 20 } },
    })
    t = applyTableEvent(t, { type: 'BUY_STOCK_SHARES', shares: 10, seatId: t.seats[1].id })
    const lot = t.seats[1].ledger.stocks[0]
    ok('условие записалось на лот', lot?.profitSharePct === 20 && lot?.profitShareTo === t.seats[0].id)

    // продаём вдвое дороже — доля должна уйти
    const before = purse(t), c0 = t.seats[0].ledger.cash
    const sellAt = lot.costPerShare * 2
    t = applyTableEvent(t, { type: 'SELL_STOCK_LOT', seatId: t.seats[1].id, lotId: lot.id, shares: 10, pricePerShare: sellAt })
    const profit = (sellAt - lot.costPerShare) * 10
    ok('доля с прибыли ушла владельцу находки',
      t.seats[0].ledger.cash === c0 + Math.round(profit * 0.2),
      `ожидали ${M(c0 + Math.round(profit * 0.2))}, вышло ${M(t.seats[0].ledger.cash)}`)
    ok('продажа не меняет общую кассу сверх выручки',
      purse(t) === before + 10 * sellAt, `${M(purse(t))}`)

    // продажа в убыток — доля НЕ берётся
    let t2 = mk()
    t2 = { ...t2, pending: { kind: 'deal', card: stock as never, deck: 'small' } as never, phase: 'resolving' }
    t2 = applyTableEvent(t2, { type: 'SET_ACCESS', access: { mode: 'open', allow: [t2.seats[1].id], terms: { kind: 'profitShare', pct: 20 } } })
    t2 = applyTableEvent(t2, { type: 'BUY_STOCK_SHARES', shares: 10, seatId: t2.seats[1].id })
    const lot2 = t2.seats[1].ledger.stocks[0]
    const owner0 = t2.seats[0].ledger.cash
    t2 = applyTableEvent(t2, { type: 'SELL_STOCK_LOT', seatId: t2.seats[1].id, lotId: lot2.id, shares: 10, pricePerShare: Math.round(lot2.costPerShare / 2) })
    ok('с убытка доля НЕ берётся', t2.seats[0].ledger.cash === owner0)
  }

  // 6. Управляющий: забирает свою долю и из денег, и переводит остаток в свободу
  {
    let t = mk()
    const biz = dataMod.smallDeals('ru').find((c) => c.kind === 'business' && !(c as never as {greenleaf?:boolean}).greenleaf)!
    t = { ...t, pending: { kind: 'deal', card: biz, deck: 'small' } as never, phase: 'resolving' }
    t = applyTableEvent(t, { type: 'BUY_DEAL', payCash: true })
    const b = t.seats[0].ledger.businesses[0]
    const flowBefore = passiveIncome(t.seats[0].ledger)
    ok('без управляющего бизнес НЕ идёт в свободу', freedomIncome(t.seats[0].ledger) === 0,
      `в свободу ${M(freedomIncome(t.seats[0].ledger))} при доходе ${M(flowBefore)}`)
    t = applyTableEvent(t, { type: 'HIRE_MANAGER', assetId: b.id, pct: 35 })
    const after = t.seats[0].ledger
    const expect = Math.round(b.cashFlow * 0.65)
    ok('управляющий забрал свою долю из денег',
      Math.abs(passiveIncome(after) - expect) <= 1, `${M(passiveIncome(after))} против ожидаемых ${M(expect)}`)
    ok('остаток пошёл в зачёт свободы',
      Math.abs(freedomIncome(after) - expect) <= 1, `${M(freedomIncome(after))}`)
  }
}

// ─── Три пути входа в сделку должны считать ОДИНАКОВО ────────────────

console.log('\n\nТРИ ПУТИ ВХОДА В СДЕЛКУ')
{
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru'); const dreams = dreamSpaces()
  const mk = () => {
    const t0 = createTable({ seed: 4, deckTheme: 'ru', seats: [0,1,2].map(i => ({
      name: `И${i+1}`, professionId: pool[i * 4].id, dreamSpace: dreams[i].index,
      isBot: false, botDifficulty: 'medium' as const,
    })) })
    return { ...t0, seats: t0.seats.map(s => ({ ...s, ledger: { ...s.ledger, cash: 40_000_000 } })) }
  }
  const ok = (label: string, cond: boolean, detail = '') =>
    console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
  const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
  const card = dataMod.bigDeals('ru').find((c) => c.kind === 'realEstate' && c.cashFlow > 0)!

  // прямая покупка в рассрочку
  let a = mk()
  a = { ...a, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
  a = applyTableEvent(a, { type: 'BUY_DEAL' })
  const own = a.seats[0].ledger.realEstate[0]

  // перекуп находки другим игроком
  let b = mk()
  b = { ...b, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
  b = applyTableEvent(b, { type: 'OFFER_CARD', amount: 100_000, toId: b.seats[1].id })
  const of1 = b.offers[b.offers.length - 1]
  b = applyTableEvent(b, { type: 'ACCEPT_OFFER_TRADE', offerId: of1.id, seatId: b.seats[1].id })
  const bought = b.seats[1].ledger.realEstate[0]

  ok('перекуп даёт ТОТ ЖЕ поток, что своя покупка',
    !!bought && bought.cashFlow === own.cashFlow,
    `своя ${M(own.cashFlow)} · перекуп ${bought ? M(bought.cashFlow) : 'нет'}`)
  ok('у перекупа тоже есть рассрочка',
    !!bought && (bought.installmentMonthly ?? 0) === (own.installmentMonthly ?? 0),
    `платёж ${bought ? M(bought.installmentMonthly ?? 0) : '—'}`)

  // вход вдвоём
  let c = mk()
  c = { ...c, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
  c = applyTableEvent(c, { type: 'OFFER_COINVEST', amount: Math.round(card.downPayment / 2), share: 0.5, toId: c.seats[1].id })
  const of2 = c.offers[c.offers.length - 1]
  c = applyTableEvent(c, { type: 'ACCEPT_OFFER_TRADE', offerId: of2.id, seatId: c.seats[1].id })
  const lead = c.seats[0].ledger.realEstate[0]
  const part = c.seats[1].ledger.realEstate[0]
  const together = ownShare(lead) + (part?.cashFlow ?? 0)
  ok('вдвоём получают НЕ больше, чем один в рассрочку',
    together <= own.cashFlow + 2,
    `вдвоём ${M(together)} против ${M(own.cashFlow)}`)

  // рассрочка гасится
  let d = mk()
  d = { ...d, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
  d = applyTableEvent(d, { type: 'BUY_DEAL' })
  let led = d.seats[0].ledger
  const debt0 = led.realEstate[0].mortgage
  for (let i = 0; i < 6; i++) led = applyEvent(led, { type: 'PAYCHECK' })
  const debt6 = led.realEstate[0].mortgage
  ok('рассрочка гасится платежами', debt6 < debt0,
    `${M(debt0)} → ${M(debt6)} за 6 зарплат`)
  const monthly = d.seats[0].ledger.realEstate[0].installmentMonthly ?? 0
  ok('гасится ровно на величину платежа', Math.abs((debt0 - debt6) - monthly * 6) <= 6,
    `списано ${M(debt0 - debt6)}, платёж ${M(monthly)}`)
}

// ─── Соинвестор получает долю при продаже ────────────────────────────
console.log('\n\nРАСЧЁТ С СОИНВЕСТОРОМ')
{
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru'); const dreams = dreamSpaces()
  let t = createTable({ seed: 6, deckTheme: 'ru', seats: [0,1].map(i => ({
    name: `И${i+1}`, professionId: pool[i * 4].id, dreamSpace: dreams[i].index,
    isBot: false, botDifficulty: 'medium' as const,
  })) })
  t = { ...t, seats: t.seats.map(s => ({ ...s, ledger: { ...s.ledger, cash: 40_000_000 } })) }
  const ok = (l: string, c: boolean, d = '') => console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

  const card = dataMod.bigDeals('ru').find((c) => c.kind === 'realEstate' && c.cashFlow > 0)!
  t = { ...t, pending: { kind: 'deal', card, deck: 'big' } as never, phase: 'resolving' }
  t = applyTableEvent(t, { type: 'OFFER_COINVEST', amount: Math.round(card.downPayment / 2), share: 0.5, toId: t.seats[1].id })
  const of = t.offers[t.offers.length - 1]
  t = applyTableEvent(t, { type: 'ACCEPT_OFFER_TRADE', offerId: of.id, seatId: t.seats[1].id })
  ok('у партнёра появилась доля', t.seats[1].ledger.realEstate.length === 1)

  const asset = t.seats[0].ledger.realEstate[0]
  const partnerBefore = t.seats[1].ledger.cash
  const sellCard = dataMod.marketCards('ru').find(
    (c) => c.kind === 'sellOffer' && c.category === asset.category,
  )!
  t = { ...t, pending: { kind: 'market', card: sellCard } as never, phase: 'resolving' }
  t = applyTableEvent(t, { type: 'ACCEPT_OFFER', seatId: t.seats[0].id, assetId: asset.id })

  ok('партнёр получил деньги с продажи', t.seats[1].ledger.cash > partnerBefore,
    `${M(partnerBefore)} → ${M(t.seats[1].ledger.cash)}`)
  ok('фантомная доля партнёра исчезла', t.seats[1].ledger.realEstate.length === 0)
  ok('объект снят у владельца', t.seats[0].ledger.realEstate.length === 0)
}
