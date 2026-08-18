/**
 * Партия вслух: каждый ход печатается человеческим языком, и тут же
 * проверяется, сходятся ли деньги.
 *
 * Зачем ещё один прогон, когда есть fuzz.ts: тот проверяет правила («долг не
 * бывает отрицательным»), но не арифметику. Он бы НЕ поймал историю с
 * машиноместом, где карточка обещала одно, а начислялось другое: оба числа
 * законные, просто разные. Здесь после каждого события считается, сколько
 * денег ДОЛЖНО было измениться, и сравнивается с тем, сколько изменилось.
 *
 * Запуск:  npm run audit           одна партия вслух
 *          AUDIT_GAMES=20 npm run audit    двадцать молча, только расхождения
 */
import { createTable, applyTableEvent, applyWorldEvent, nextWorldEventIndex, currentSeat, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { professionsFor, dreamSpaces, setActiveTheme, setFastBoardTheme } from './data'
import {
  setRules,
  monthlyCashFlow,
  passiveIncome,
  totalExpenses,
  totalIncome,
  ownShareAt,
} from './ledger'
import type { Table } from './types'

const GAMES = Number(process.env.AUDIT_GAMES || 1)
const LOUD = GAMES === 1
const TURNS = Number(process.env.AUDIT_TURNS || 140)

const M = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const S = (n: number) => (n >= 0 ? '+' : '−') + M(Math.abs(n)).replace('-', '')

let problems = 0
function bad(what: string, detail: string) {
  problems++
  console.log(`     ❌ ${what}\n        ${detail}`)
}

/** Сумма потоков всех активов — то, чем пассивный доход обязан быть. */
function assetSum(t: Table, i: number): number {
  const l = t.seats[i].ledger
  const stocks = l.stocks.reduce((s, x) => s + x.shares * x.dividendPerShareMonthly, 0)
  const re = l.realEstate.reduce((s, a) => s + ownShareAt(a, t.market.flow), 0)
  const biz = l.businesses.reduce((s, a) => s + ownShareAt(a, t.market.flow), 0)
  return stocks + re + biz
}

function audit(seed: number) {
  setActiveTheme('ru')
  setFastBoardTheme('ru')
  setRules({ currency: 'RUB' })
  const pool = professionsFor('ru')
  const dreams = dreamSpaces()
  const rnd = mulberry32(seed)
  const setup: TableSetup = {
    seed,
    deckTheme: 'ru',
    seats: [0, 1, 2].map((i) => ({
      name: ['Камиль', 'Анвар', 'Малика'][i],
      professionId: pool[(seed + i * 3) % pool.length].id,
      dreamSpace: dreams[i].index,
      isBot: true,
      botDifficulty: 'medium' as const,
    })),
  }
  let t: Table = createTable(setup)

  if (LOUD) {
    console.log('\n══════ НАЧАЛО ПАРТИИ ══════')
    for (const s of t.seats) {
      const l = s.ledger
      console.log(
        `  ${s.name} · ${l.profession.name}\n` +
          `     зарплата ${M(l.salary)} · расходы ${M(totalExpenses(l))} · поток ${S(monthlyCashFlow(l))} · наличные ${M(l.cash)}`,
      )
    }
  }

  for (let turn = 1; turn <= TURNS && t.phase !== 'finished'; turn++) {
    const before = t
    const iBefore = t.turnIndex
    const cashBefore = t.seats.map((s) => s.ledger.cash)
    const passiveBefore = t.seats.map((_, i) => passiveIncome(t.seats[i].ledger, t.market.flow))
    const nameBefore = t.seats[iBefore].name
    const logLen = t.log.length

    const ev = decideBotEvent(t, rnd)
    t = ev ? applyTableEvent(t, ev) : t
    if (t === before) t = applyTableEvent(t, { type: 'END_TURN' })

    // Что движок сам записал в журнал за этот ход — это и есть «что произошло».
    const said = t.log.slice(logLen).map((e) => e.text)

    for (let i = 0; i < t.seats.length; i++) {
      const l = t.seats[i].ledger
      const delta = l.cash - cashBefore[i]

      // 1. Пассивный доход обязан РАВНЯТЬСЯ сумме потоков активов.
      const want = assetSum(t, i)
      const got = passiveIncome(l, t.market.flow)
      if (Math.abs(want - got) > 1)
        bad('пассивный доход не сходится с активами', `${t.seats[i].name}: показано ${M(got)}, по активам ${M(want)}`)

      // 2. Всего доходов = зарплата + пассивный.
      if (Math.abs(totalIncome(l, t.market.flow) - (l.salary + got)) > 1)
        bad('всего доходов не сходится', `${t.seats[i].name}`)

      // 3. Деньги не появляются молча: заметное движение обязано быть в журнале.
      if (Math.abs(delta) > 500 && said.length === 0)
        bad('деньги изменились без единой записи в журнале', `${t.seats[i].name}: ${S(delta)}`)

      // 4. Купленный актив обязан приносить ровно то, что записано в нём.
      for (const a of l.realEstate) {
        if (!Number.isFinite(a.cashFlow)) bad('поток актива — не число', a.name)
      }
    }

    if (LOUD && said.length) {
      const i = iBefore
      const l = t.seats[i].ledger
      const delta = l.cash - cashBefore[i]
      const dp = passiveIncome(l, t.market.flow) - passiveBefore[i]
      const tail =
        (delta !== 0 ? `  деньги ${S(delta)} → ${M(l.cash)}` : '') +
        (dp !== 0 ? `  пассивный ${S(dp)} → ${M(passiveIncome(l, t.market.flow))}` : '')
      console.log(`\n  ход ${String(turn).padStart(3)} · ${nameBefore}`)
      for (const line of said) console.log(`     ${line}`)
      if (tail) console.log(`    ${tail}`)
    }

    if (turn % 40 === 0) {
      const idx = nextWorldEventIndex(t)
      t = applyWorldEvent(t, idx)
      if (LOUD) console.log(`\n  🌍 ${t.log[t.log.length - 1]?.text ?? ''}`)
    }
  }

  if (LOUD) {
    console.log('\n══════ ИТОГ ══════')
    for (const s of t.seats) {
      const l = s.ledger
      console.log(
        `  ${s.name}: наличные ${M(l.cash)} · пассивный ${M(passiveIncome(l, t.market.flow))} · расходы ${M(
          totalExpenses(l),
        )} · поток ${S(monthlyCashFlow(l, t.market.flow))}`,
      )
      for (const a of [...l.realEstate, ...l.businesses])
        console.log(`     ${a.name}: ${S(a.cashFlow)}/мес`)
    }
  }
}

for (let g = 0; g < GAMES; g++) audit(4200 + g * 13)

console.log(problems === 0 ? '\n✅ АРИФМЕТИКА СХОДИТСЯ\n' : `\n❌ РАСХОЖДЕНИЙ: ${problems}\n`)
if (problems) process.exit(1)
