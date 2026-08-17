/**
 * Выгрузка ЖИВОГО состояния стола середины партии.
 *
 * Зачем: макет интерфейса надо показывать на настоящих данных, а не на
 * придуманных «200 000 ₽». Здесь движок реально играет заданное число ходов
 * ботами и печатает то, что получилось: профессии, наличные, доходы, расходы,
 * обязательства, купленные активы, портфель, позиции фишек, состояние рынка.
 *
 * Запуск: npm run dump:state > /tmp/state.json
 */
import { createTable, applyTableEvent, currentSeat, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { dreamSpaces, professionsFor, professionName, setActiveTheme, setFastBoardTheme } from './data'
import { setRules } from './ledger'
import {
  monthlyCashFlow,
  passiveIncome,
  totalExpenses,
  totalIncome,
  netWorth,
} from './ledger'
import type { Table } from './types'

const TURNS = Number(process.env.TURNS || 60)
const SEED = Number(process.env.SEED || 20260817)

setActiveTheme('ru')
setFastBoardTheme('ru')
setRules({ currency: 'RUB' })

const pool = professionsFor('ru')
const dreams = dreamSpaces()
const rnd = mulberry32(SEED)

const setup: TableSetup = {
  seed: SEED,
  deckTheme: 'ru',
  seats: [
    { name: 'Камиль', professionId: pool[12].id, dreamSpace: dreams[0].index, isBot: true, botDifficulty: 'medium' },
    { name: 'Анвар', professionId: pool[15].id, dreamSpace: dreams[1].index, isBot: true, botDifficulty: 'medium' },
    { name: 'Малика', professionId: pool[8].id, dreamSpace: dreams[2].index, isBot: true, botDifficulty: 'medium' },
  ],
}

let t: Table = createTable(setup)
for (let i = 0; i < TURNS * 12 && t.phase !== 'finished'; i++) {
  const ev = decideBotEvent(t, rnd)
  if (!ev) break
  const next = applyTableEvent(t, ev)
  t = next === t ? applyTableEvent(t, { type: 'END_TURN' }) : next
  if (t.paydayCount !== undefined && t.paydayCount > TURNS) break
}

const money = (n: number) => Math.round(n)

const out = {
  ходит: currentSeat(t).name,
  фаза: t.phase,
  рынок: t.market,
  места: t.seats.map((s) => {
    const l = s.ledger
    return {
      имя: s.name,
      профессия: professionName(l.profession, 'ru'),
      дорожка: s.track,
      позиция: s.position,
      наличные: money(l.cash),
      зарплата: money(l.salary),
      пассивный: money(passiveIncome(l)),
      доходВсего: money(totalIncome(l)),
      расходВсего: money(totalExpenses(l)),
      поток: money(monthlyCashFlow(l)),
      капитал: money(netWorth(l)),
      дети: l.children,
      недвижимость: l.realEstate.map((a) => ({
        id: a.id,
        имя: a.name,
        стоимость: money(a.cost),
        долг: money(a.mortgage),
        поток: money(a.cashFlow),
      })),
      бизнес: l.businesses.map((a) => ({
        id: a.id,
        имя: a.name,
        стоимость: money(a.cost),
        долг: money(a.liability),
        поток: money(a.cashFlow),
      })),
      акции: l.stocks.map((s2) => ({ тикер: s2.symbol, штук: s2.shares, цена: money(s2.price) })),
      обязательства: {
        жильё: money(l.liabilities.homeMortgage),
        обучение: money(l.liabilities.schoolLoans),
        машина: money(l.liabilities.carLoans),
        карты: money(l.liabilities.creditCards),
        техника: money(l.liabilities.retailDebt),
      },
      расходы: {
        жильё: money(l.expenses.homeMortgagePayment),
        обучение: money(l.expenses.schoolLoanPayment),
        машина: money(l.expenses.carPayment),
        карты: money(l.expenses.creditCardPayment),
        техника: money(l.expenses.retailPayment),
        прочее: money(l.expenses.otherExpenses),
        дети: money(l.expenses.childExpenses ?? 0),
      },
    }
  }),
  журнал: t.log.slice(-8).map((e) => e.text),
}

console.log(JSON.stringify(out, null, 1))
