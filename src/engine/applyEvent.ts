import type { Ledger } from './types'
import { DEBT_TO_PAYMENT } from './types'
import type { LedgerEvent } from './events'
import {
  FAST_TRACK_WIN_TARGET,
  MAX_PETS,
  fastTrackProgress,
  monthlyCashFlow,
  passiveIncome,
  totalExpenses,
  totalIncome,
} from './ledger'

function clone(l: Ledger): Ledger {
  return {
    ...l,
    expenses: { ...l.expenses },
    liabilities: { ...l.liabilities },
    stocks: l.stocks.map((x) => ({ ...x })),
    realEstate: l.realEstate.map((x) => ({ ...x })),
    businesses: l.businesses.map((x) => ({ ...x })),
    fastTrack: l.fastTrack
      ? {
          ...l.fastTrack,
          businesses: l.fastTrack.businesses.map((x) => ({ ...x })),
          dream: l.fastTrack.dream ? { ...l.fastTrack.dream } : undefined,
        }
      : undefined,
  }
}

/**
 * Чистый редьюсер кошелька. Никаких побочных эффектов, никакого рандома —
 * всё, что нужно, приходит внутри события.
 */
export function applyEvent(prev: Ledger, e: LedgerEvent): Ledger {
  const l = clone(prev)

  switch (e.type) {
    case 'PAYCHECK':
      l.cash += monthlyCashFlow(l)
      return l

    case 'BUY_STOCK':
      l.cash -= e.shares * e.costPerShare
      l.stocks.push({
        id: e.id,
        symbol: e.symbol.toUpperCase(),
        shares: e.shares,
        costPerShare: e.costPerShare,
        dividendPerShareMonthly: e.dividendPerShareMonthly,
      })
      return l

    case 'SELL_STOCK': {
      const lot = l.stocks.find((x) => x.id === e.lotId)
      if (!lot) return prev
      const n = Math.min(e.shares, lot.shares)
      l.cash += n * e.pricePerShare
      lot.shares -= n
      l.stocks = l.stocks.filter((x) => x.shares > 0)
      return l
    }

    case 'STOCK_SPLIT': {
      const sym = e.symbol.toUpperCase()
      for (const lot of l.stocks) {
        if (lot.symbol !== sym) continue
        lot.shares = e.direction === 'split' ? lot.shares * 2 : Math.floor(lot.shares / 2)
      }
      l.stocks = l.stocks.filter((x) => x.shares > 0)
      return l
    }

    case 'BUY_REAL_ESTATE':
      l.cash -= e.downPayment
      l.realEstate.push({
        id: e.id,
        name: e.name,
        cost: e.cost,
        downPayment: e.downPayment,
        mortgage: e.mortgage,
        cashFlow: e.cashFlow,
        category: e.category,
      })
      return l

    case 'SELL_REAL_ESTATE': {
      const a = l.realEstate.find((x) => x.id === e.assetId)
      if (!a) return prev
      l.cash += e.salePrice - a.mortgage
      l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId)
      return l
    }

    case 'BUY_BUSINESS':
      l.cash -= e.downPayment
      l.businesses.push({
        id: e.id,
        name: e.name,
        cost: e.cost,
        downPayment: e.downPayment,
        liability: e.liability,
        cashFlow: e.cashFlow,
        category: e.category,
      })
      return l

    case 'SELL_BUSINESS': {
      const a = l.businesses.find((x) => x.id === e.assetId)
      if (!a) return prev
      l.cash += e.salePrice - a.liability
      l.businesses = l.businesses.filter((x) => x.id !== e.assetId)
      return l
    }

    case 'DOODAD':
    case 'FT_STAKE_LOST':
    case 'FT_DOWNSIZED':
      l.cash -= e.amount
      return l

    /** Повесить трату на кредитку: +3% к месячному платежу. */
    case 'FINANCE_DOODAD':
      l.liabilities.creditCards += e.amount
      l.expenses.creditCardPayment += Math.ceil(0.03 * e.amount)
      return l

    case 'PET':
      if (l.pets >= MAX_PETS) return prev
      l.pets += 1
      return l

    case 'DOWNSIZED':
      l.cash -= totalExpenses(l)
      l.charityTurnsLeft = 0
      return l

    case 'CHARITY':
      l.cash -= Math.ceil(0.1 * totalIncome(l))
      l.charityTurnsLeft = 3
      return l

    case 'CHARITY_TURN_USED':
      l.charityTurnsLeft = Math.max(0, l.charityTurnsLeft - 1)
      return l

    /** Каждая $1 000 кредита стоит $100 в месяц. */
    case 'TAKE_LOAN':
      l.cash += e.amount
      l.liabilities.bankLoan += e.amount
      l.expenses.bankLoanPayment += e.amount / 10
      return l

    case 'REPAY_LOAN': {
      const n = Math.min(e.amount, l.liabilities.bankLoan)
      l.cash -= n
      l.liabilities.bankLoan -= n
      l.expenses.bankLoanPayment -= n / 10
      return l
    }

    case 'PAY_OFF_DEBT': {
      const balance = l.liabilities[e.debt]
      if (balance <= 0) return prev
      l.cash -= balance
      l.liabilities[e.debt] = 0
      l.expenses[DEBT_TO_PAYMENT[e.debt]] = 0
      return l
    }

    case 'ADJUST_CASH':
      l.cash += e.amount
      return l

    /** Продажа банку за полцены при банкротстве. */
    case 'FORCED_SALE': {
      if (e.assetKind === 'stock') {
        const lot = l.stocks.find((x) => x.id === e.assetId)
        if (!lot) return prev
        l.cash += Math.floor((lot.shares * lot.costPerShare) / 2)
        l.stocks = l.stocks.filter((x) => x.id !== e.assetId)
      } else if (e.assetKind === 'realEstate') {
        const a = l.realEstate.find((x) => x.id === e.assetId)
        if (!a) return prev
        l.cash += Math.floor(a.downPayment / 2)
        l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId)
      } else {
        const a = l.businesses.find((x) => x.id === e.assetId)
        if (!a) return prev
        l.cash += Math.floor(a.downPayment / 2)
        l.businesses = l.businesses.filter((x) => x.id !== e.assetId)
      }
      return l
    }

    case 'HALVE_CONSUMER_DEBT':
      l.liabilities.carLoans = Math.floor(l.liabilities.carLoans / 2)
      l.liabilities.creditCards = Math.floor(l.liabilities.creditCards / 2)
      l.liabilities.retailDebt = Math.floor(l.liabilities.retailDebt / 2)
      l.expenses.carPayment = Math.floor(l.expenses.carPayment / 2)
      l.expenses.creditCardPayment = Math.floor(l.expenses.creditCardPayment / 2)
      l.expenses.retailPayment = Math.floor(l.expenses.retailPayment / 2)
      return l

    case 'DECLARE_GAME_OVER':
      l.phase = 'gameOver'
      return l

    /** Выкуп при выходе из Круга: сто месяцев пассивного дохода. */
    case 'ENTER_FAST_TRACK': {
      if (l.phase !== 'ratRace') return prev
      const buyout = 100 * passiveIncome(l)
      l.cash += buyout
      l.phase = 'fastTrack'
      l.fastTrack = {
        beginningIncome: buyout,
        goalIncome: buyout + FAST_TRACK_WIN_TARGET,
        businesses: [],
      }
      return l
    }

    case 'CASHFLOW_DAY':
      if (!l.fastTrack) return prev
      l.cash += l.fastTrack.beginningIncome + fastTrackProgress(l)
      return l

    case 'BUY_FT_BUSINESS':
      if (!l.fastTrack) return prev
      l.cash -= e.downPayment
      l.fastTrack.businesses.push({
        id: e.id,
        name: e.name,
        downPayment: e.downPayment,
        cashFlow: e.cashFlow,
      })
      if (fastTrackProgress(l) >= FAST_TRACK_WIN_TARGET) {
        l.phase = 'won'
        l.winReason = 'cashflowGoal'
      }
      return l

    case 'BUY_DREAM':
      if (!l.fastTrack) return prev
      l.cash -= e.pricePaid
      l.fastTrack.dream = { name: e.name, pricePaid: e.pricePaid }
      l.phase = 'won'
      l.winReason = 'dream'
      return l

    case 'TAX_AUDIT':
    case 'LAWSUIT':
      l.cash -= Math.ceil(l.cash / 2)
      return l

    case 'DIVORCE':
      l.cash = 0
      return l

    default:
      return prev
  }
}
