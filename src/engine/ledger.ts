import type { Ledger, Profession } from './types'

/** Сколько нового дохода в месяц нужно собрать на Полосе свободы для победы. */
export const FAST_TRACK_WIN_TARGET = 150_000

/** Потолок питомцев в семье. */
export const MAX_PETS = 3

export function petExpenses(l: Ledger): number {
  return l.pets * l.profession.perChildExpense
}

export function dividendLines(l: Ledger): { symbol: string; amount: number }[] {
  const map = new Map<string, number>()
  for (const lot of l.stocks) {
    if (lot.dividendPerShareMonthly === 0) continue
    map.set(lot.symbol, (map.get(lot.symbol) ?? 0) + lot.shares * lot.dividendPerShareMonthly)
  }
  return [...map.entries()].map(([symbol, amount]) => ({ symbol, amount }))
}

/** Аренда + дивиденды + поток бизнесов. Именно это должно перерасти расходы. */
export function passiveIncome(l: Ledger): number {
  const stocks = l.stocks.reduce((s, lot) => s + lot.shares * lot.dividendPerShareMonthly, 0)
  const realEstate = l.realEstate.reduce((s, a) => s + a.cashFlow, 0)
  const businesses = l.businesses.reduce((s, a) => s + a.cashFlow, 0)
  return stocks + realEstate + businesses
}

export function totalIncome(l: Ledger): number {
  return l.salary + passiveIncome(l)
}

export function totalExpenses(l: Ledger): number {
  const e = l.expenses
  return (
    e.taxes +
    e.homeMortgagePayment +
    e.schoolLoanPayment +
    e.carPayment +
    e.creditCardPayment +
    e.retailPayment +
    e.otherExpenses +
    e.bankLoanPayment +
    petExpenses(l)
  )
}

export function monthlyCashFlow(l: Ledger): number {
  return totalIncome(l) - totalExpenses(l)
}

/** Поток одной профессии без активов — по нему считается стартовый капитал. */
export function professionMonthlyCashFlow(p: Profession): number {
  const e = p.expenses
  return (
    p.salary -
    (e.taxes +
      e.homeMortgagePayment +
      e.schoolLoanPayment +
      e.carPayment +
      e.creditCardPayment +
      e.retailPayment +
      e.otherExpenses)
  )
}

export function startingCash(p: Profession): number {
  return professionMonthlyCashFlow(p) + p.savings
}

/** Условие выхода из Круга: строго больше, не «больше или равно». */
export function isOutOfRatRace(l: Ledger): boolean {
  return passiveIncome(l) > totalExpenses(l)
}

/** Новый доход, собранный на Полосе свободы. */
export function fastTrackProgress(l: Ledger): number {
  return l.fastTrack ? l.fastTrack.businesses.reduce((s, b) => s + b.cashFlow, 0) : 0
}

export function fastTrackIncome(l: Ledger): number {
  return l.fastTrack ? l.fastTrack.beginningIncome + fastTrackProgress(l) : 0
}

/** Зарплата пришла отрицательной, а наличных не хватает — это банкротство. */
export function paycheckShortfall(l: Ledger): boolean {
  const flow = monthlyCashFlow(l)
  return flow < 0 && l.cash < -flow
}

export function netWorth(l: Ledger): number {
  const assets =
    l.cash +
    l.stocks.reduce((s, x) => s + x.shares * x.costPerShare, 0) +
    l.realEstate.reduce((s, x) => s + x.cost, 0) +
    l.businesses.reduce((s, x) => s + x.cost, 0)
  const debts =
    l.liabilities.homeMortgage +
    l.liabilities.schoolLoans +
    l.liabilities.carLoans +
    l.liabilities.creditCards +
    l.liabilities.retailDebt +
    l.liabilities.bankLoan +
    l.realEstate.reduce((s, x) => s + x.mortgage, 0) +
    l.businesses.reduce((s, x) => s + x.liability, 0)
  return assets - debts
}

export function createLedger(p: Profession, playerName: string): Ledger {
  return {
    playerName,
    phase: 'ratRace',
    cash: startingCash(p),
    profession: p,
    salary: p.salary,
    expenses: { ...p.expenses, bankLoanPayment: 0 },
    liabilities: { ...p.liabilities, bankLoan: 0 },
    pets: 0,
    stocks: [],
    realEstate: [],
    businesses: [],
    charityTurnsLeft: 0,
  }
}
