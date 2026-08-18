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
import { ribaRisk } from './ledger'
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
