/**
 * Прогон партий с проверкой правил НА КАЖДОМ ходу.
 *
 * Зачем отдельно от scenarios.ts: там сценарии проверяют конкретные умения,
 * а здесь движок гоняют вслепую тысячами ходов и после каждого события
 * спрашивают: не нарушилось ли что-то, что нарушаться не должно вообще
 * никогда. Так ловятся баги, которые глазами не увидишь — они всплывают
 * раз в триста ходов при редком стечении карт.
 *
 * Запуск: npm run fuzz            (60 партий)
 *         FUZZ_GAMES=500 npm run fuzz
 */
import { createTable, applyTableEvent, applyWorldEvent, nextWorldEventIndex, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { professionsFor, dreamSpaces, setActiveTheme, setFastBoardTheme } from './data'
import { setRules, netWorth, passiveIncome, totalExpenses, totalIncome, ribaRisk } from './ledger'
import { glTotalIncome, glStructureIncome, glRankFor, GL_PACKAGES } from './greenleaf'
import type { Seat, Table } from './types'

const GAMES = Number(process.env.FUZZ_GAMES || 60)
const MAX_TURNS = Number(process.env.FUZZ_TURNS || 600)

interface Violation {
  rule: string
  detail: string
  seed: number
  turn: number
}

const seen = new Map<string, Violation>()
function fail(rule: string, detail: string, seed: number, turn: number) {
  // Одно нарушение каждого вида — иначе вывод тонет в повторах.
  if (!seen.has(rule)) seen.set(rule, { rule, detail, seed, turn })
}

const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const finite = (n: number) => Number.isFinite(n)

/** Всё, что не должно нарушаться никогда, независимо от того, как легли карты. */
function checkSeat(s: Seat, seed: number, turn: number, t: Table) {
  const l = s.ledger
  const name = `${s.name} (зерно ${seed}, ход ${turn})`

  if (!finite(l.cash)) fail('наличные — не число', name, seed, turn)
  if (!finite(netWorth(l))) fail('капитал — не число', name, seed, turn)
  if (!finite(totalIncome(l))) fail('доход — не число', name, seed, turn)
  if (!finite(totalExpenses(l))) fail('расходы — не число', name, seed, turn)

  /*
   * Отрицательная наличность законна РОВНО в одном случае: чек ушёл в минус,
   * закрыть его нечем, и игрок сейчас разбирает банкротство. Во всех
   * остальных — это дыра, через которую деньги берутся из ниоткуда.
   */
  const inBankruptcy = t.pending?.kind === 'bankruptcy' && t.seats[t.turnIndex]?.id === s.id
  if (l.cash < 0 && !s.outOfGame && !inBankruptcy) {
    fail('наличные ушли в минус вне банкротства', `${name}: ${M(l.cash)}`, seed, turn)
  }

  for (const a of l.realEstate) {
    if (a.cost < 0) fail('стоимость недвижимости отрицательная', `${name}: ${a.name}`, seed, turn)
    if (a.mortgage < 0) fail('долг по недвижимости отрицательный', `${name}: ${a.name}`, seed, turn)
    if (!finite(a.cashFlow)) fail('поток недвижимости — не число', `${name}: ${a.name}`, seed, turn)
  }
  for (const b of l.businesses) {
    if (b.cost < 0) fail('стоимость бизнеса отрицательная', `${name}: ${b.name}`, seed, turn)
    if (b.liability < 0) fail('долг бизнеса отрицательный', `${name}: ${b.name}`, seed, turn)
    if (!finite(b.cashFlow)) fail('поток бизнеса — не число', `${name}: ${b.name}`, seed, turn)
    if (b.gl) {
      const g = b.gl
      if (!GL_PACKAGES.some((p) => p.id === g.packageId))
        fail('неизвестный пакет GreenLeaf', `${name}: ${g.packageId}`, seed, turn)
      if (g.baseFlow < 0) fail('доход структуры отрицательный', `${name}: ${M(g.baseFlow)}`, seed, turn)
      if (g.volume < 0) fail('накопленный объём отрицательный', name, seed, turn)
      if (glTotalIncome(g) < glStructureIncome(g))
        fail('пенсия за ранг уменьшает доход', `${name}: ${M(glTotalIncome(g))} < ${M(glStructureIncome(g))}`, seed, turn)
      if (g.rankPaid > glRankFor(g.volume).level)
        fail('бонус выдан за ранг, который не закрыт', name, seed, turn)
      // Ключевое обещание Камиля: партнёр не улетает в космос и не сидит в грошах.
      if (glTotalIncome(g) > 3_000_000)
        fail('партнёрский бизнес улетел в космос', `${name}: ${M(glTotalIncome(g))}/мес`, seed, turn)
    }
  }
  for (const lot of l.stocks) {
    if (lot.shares <= 0) fail('лот бумаг с нулём акций', `${name}: ${lot.symbol}`, seed, turn)
    if (lot.costPerShare <= 0) fail('цена акции ноль или ниже', `${name}: ${lot.symbol}`, seed, turn)
  }

  for (const [k, v] of Object.entries(l.liabilities)) {
    if ((v as number) < 0) fail('обязательство ушло в минус', `${name}: ${k} = ${M(v as number)}`, seed, turn)
  }
  for (const [k, v] of Object.entries(l.expenses)) {
    if ((v as number) < 0) fail('расход ушёл в минус', `${name}: ${k} = ${M(v as number)}`, seed, turn)
  }

  // Долг закрыт — платёж обязан исчезнуть, иначе он висит вечно.
  if (l.liabilities.ribaLoan === 0 && l.expenses.ribaPayment > 0)
    fail('кредит закрыт, а платёж остался', name, seed, turn)
  if (l.liabilities.retailDebt === 0 && l.expenses.retailPayment > 0)
    fail('рассрочка закрыта, а платёж остался', name, seed, turn)
  if (l.liabilities.bankLoan === 0 && l.expenses.bankLoanPayment > 0)
    fail('заём закрыт, а платёж остался', name, seed, turn)

  const risk = ribaRisk(l)
  if (risk < 0 || risk > 0.6) fail('долговая нагрузка вне допустимого', `${name}: ${risk}`, seed, turn)

  if (l.pets < 0 || l.pets > 3) fail('питомцев вне диапазона', `${name}: ${l.pets}`, seed, turn)

  // Идентификаторы активов обязаны быть уникальными: иначе продажа одного
  // уносит другой. Ровно этот баг уже случался, когда id брали из журнала.
  const ids = [...l.realEstate.map((a) => a.id), ...l.businesses.map((a) => a.id)]
  if (new Set(ids).size !== ids.length) fail('совпали идентификаторы активов', name, seed, turn)
}

function checkTable(t: Table, seed: number, turn: number) {
  for (const s of t.seats) checkSeat(s, seed, turn, t)

  const offerIds = t.offers.map((o) => o.id)
  if (new Set(offerIds).size !== offerIds.length)
    fail('совпали идентификаторы предложений', `зерно ${seed}, ход ${turn}`, seed, turn)

  for (const o of t.offers) {
    if (o.amount < 0) fail('предложение с отрицательной суммой', `зерно ${seed}`, seed, turn)
    if (!t.seats.some((s) => s.id === o.fromId))
      fail('предложение от несуществующего игрока', `зерно ${seed}`, seed, turn)
  }
  for (const ln of t.loans) {
    if (ln.repaid > ln.amount) fail('вернули больше, чем брали', `зерно ${seed}`, seed, turn)
    if (ln.lenderId === ln.borrowerId) fail('заём самому себе', `зерно ${seed}`, seed, turn)
  }

  for (const [k, v] of Object.entries(t.market.flow)) {
    if (!finite(v) || v <= 0) fail('множитель дохода испорчен', `${k} = ${v}`, seed, turn)
  }
  for (const [k, v] of Object.entries(t.market.price)) {
    if (!finite(v) || v <= 0) fail('множитель цены испорчен', `${k} = ${v}`, seed, turn)
  }
  for (const [k, v] of Object.entries(t.market.stock)) {
    if (!finite(v) || v <= 0) fail('множитель котировок испорчен', `${k} = ${v}`, seed, turn)
  }

  /*
   * Победителей может быть НЕСКОЛЬКО — так и задумано: кто дошёл до цели,
   * выходит, остальные доигрывают, как в живой игре. Проверяем не число, а
   * что каждая победа законна и что первый победитель записан один.
   */
  const winners = t.seats.filter((s) => s.won)
  if (winners.length > 0 && !t.winnerId) fail('победа есть, а первый победитель не записан', `зерно ${seed}`, seed, turn)
  for (const w of winners) {
    if (w.track !== 'fast') fail('победа без выхода на Полосу', `${w.name}, зерно ${seed}`, seed, turn)
  }

  const active = t.seats[t.turnIndex]
  if (!active) fail('ход у несуществующего игрока', `зерно ${seed}`, seed, turn)
}

function playOne(seed: number, nSeats: number, diff: 'easy' | 'medium' | 'high' | 'unreal') {
  setActiveTheme('ru')
  setFastBoardTheme('ru')
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru')
  const dreams = dreamSpaces()
  const rnd = mulberry32(seed)
  const setup: TableSetup = {
    seed,
    deckTheme: 'ru',
    seats: Array.from({ length: nSeats }, (_, i) => ({
      name: `И${i + 1}`,
      professionId: pool[(seed + i * 3) % pool.length].id,
      dreamSpace: dreams[(seed + i) % dreams.length].index,
      isBot: true,
      botDifficulty: diff,
    })),
  }
  let t: Table = createTable(setup)
  checkTable(t, seed, 0)

  let stuck = 0
  for (let turn = 1; turn <= MAX_TURNS && t.phase !== 'finished'; turn++) {
    const before = t
    const ev = decideBotEvent(t, rnd)
    t = ev ? applyTableEvent(t, ev) : t
    if (t === before) {
      t = applyTableEvent(t, { type: 'END_TURN' })
      stuck++
      if (stuck > 200) {
        fail('партия встала: сто ходов подряд ничего не происходит', `зерно ${seed}`, seed, turn)
        break
      }
    } else {
      stuck = 0
    }
    // Мир двигается на своём ритме, независимо от ходов.
    if (turn % 35 === 0) t = applyWorldEvent(t, nextWorldEventIndex(t))
    checkTable(t, seed, turn)
  }
  return t
}

const DIFFS = ['easy', 'medium', 'high', 'unreal'] as const
let played = 0
for (let i = 0; i < GAMES; i++) {
  const seed = 1000 + i * 37
  const seats = 2 + (i % 5)
  const diff = DIFFS[i % DIFFS.length]
  try {
    playOne(seed, seats, diff)
    played++
  } catch (e) {
    fail('движок упал с ошибкой', `зерно ${seed}: ${(e as Error).message}`, seed, -1)
  }
}

console.log(`\nПрогнано партий: ${played} из ${GAMES} · до ${MAX_TURNS} ходов каждая\n`)
if (seen.size === 0) {
  console.log('✅ НАРУШЕНИЙ ПРАВИЛ НЕТ\n')
} else {
  console.log(`❌ НАРУШЕНО ПРАВИЛ: ${seen.size}\n`)
  for (const v of seen.values()) console.log(`  · ${v.rule}\n      ${v.detail}`)
  console.log('')
  process.exit(1)
}
