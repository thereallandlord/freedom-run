import type { Ledger, Profession } from './types'
import { glTotalIncome, type GlState } from './greenleaf'

/**
 * Правила режима. РУ-режим: рубли, без процентных кредитов (халяль),
 * реалистичный выкуп при выходе из Круга.
 */
export interface Rules {
  currency: 'USD' | 'RUB'
  /** Выкуп при входе на Полосу свободы = пассивный доход × множитель. */
  fastTrackMultiplier: number
  /** Сколько нового дохода в месяц нужно собрать на Полосе для победы. */
  fastTrackTarget: number
  /** Банковские кредиты под процент доступны (false = халяль-режим). */
  loansEnabled: boolean
  /**
   * Масштаб доходности активов.
   * 1.0 — реальные рыночные цифры (недвижимость 3–6% годовых, бизнес 18–26%):
   *       честно, но одна удачная сделка выносит из Рутины, партия ~110 ходов.
   * 0.3 — игровой баланс: сделка даёт 15–30% от расходов, как в классике,
   *       нужно 4–8 покупок, партия ~210 ходов. 🔴 Дефолт: Камиль выбрал длину.
   */
  yieldScale: number
  /**
   * Наценка за рассрочку по классам активов. Дозволена единогласно
   * (резолюция Академии фикха ОИС № 51): «сроку принадлежит доля цены».
   * 🔴 Привязана к ТОВАРУ и фиксируется в момент сделки — от срока и просрочки не растёт.
   */
  installmentMarkup: { realEstate: number; business: number }
  /** На сколько месяцев расписывается рассрочка. */
  installmentTerm: number
  /** Закят: доля в процентах и период в «зарплатах» (12 = раз в год). */
  zakat: { enabled: boolean; pct: number; everyPaydays: number }
}

export const RULES: Rules = {
  currency: 'USD',
  fastTrackMultiplier: 100,
  fastTrackTarget: 150_000,
  loansEnabled: true,
  yieldScale: 1,
  installmentMarkup: { realEstate: 1.25, business: 1.2 },
  installmentTerm: 120,
  zakat: { enabled: false, pct: 2.5, everyPaydays: 12 },
}

export function setRules(patch: Partial<Rules>) {
  Object.assign(RULES, patch)
}

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

/**
 * Множители дохода по классам активов — то, что сейчас творится на рынке.
 * Приходят снаружи, из состояния стола.
 *
 * 🔴 Почему множитель, а не правка cashFlow у самого объекта (так было раньше
 * и это было неверно): (1) эффект должен быть ВРЕМЕННЫМ, а переписанное число
 * назад не вернёшь; (2) −25% и потом +25% из-за округления до сотен не давали
 * исходное; (3) объект, купленный ПОСЛЕ события, оставался с базовым доходом,
 * хотя рынок для него тот же.
 */
export type FlowMul = Record<string, number> | undefined

const mulFor = (m: FlowMul, category: string) => (m && m[category]) || 1

/** Доля потока, достающаяся игроку (инвестор забирает свою часть). */
export function ownShare(a: { cashFlow: number; investorShare?: number }): number {
  return Math.round(a.cashFlow * (1 - (a.investorShare ?? 0)))
}

/**
 * То же, но с поправкой на текущий рынок.
 * У партнёрского бизнеса доход считает свой движок — cashFlow там не источник
 * правды, а только зеркало для показа.
 */
export function ownShareAt(
  a: { cashFlow: number; investorShare?: number; category?: string; gl?: GlState },
  m: FlowMul,
): number {
  const base = a.gl ? glTotalIncome(a.gl) : ownShare(a)
  return Math.round(base * mulFor(m, a.category ?? ''))
}

/** Аренда + дивиденды + поток бизнесов. Именно это должно перерасти расходы. */
export function passiveIncome(l: Ledger, m?: FlowMul): number {
  const stocks = l.stocks.reduce((s, lot) => s + lot.shares * lot.dividendPerShareMonthly, 0)
  const realEstate = l.realEstate.reduce((s, a) => s + ownShareAt(a, m), 0)
  const businesses = l.businesses.reduce((s, a) => s + ownShareAt(a, m), 0)
  return stocks + realEstate + businesses
}

export function totalIncome(l: Ledger, m?: FlowMul): number {
  return l.salary + passiveIncome(l, m)
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

export function monthlyCashFlow(l: Ledger, m?: FlowMul): number {
  return totalIncome(l, m) - totalExpenses(l)
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

export function fastTrackTarget(): number {
  return RULES.fastTrackTarget
}

/**
 * Цена бумаги с поправкой на рынок.
 *
 * 🔴 До 17.08 мировые события про котировки были ЧИСТО ДЕКОРАТИВНЫМИ: событие
 * писало множитель в market.stock, баннер его показывал, а карта цены брала
 * свою цену напрямую. «Золото — 5589 долларов за унцию» на золото игрока не
 * влияло никак. Семь событий из двадцати четырёх не делали ничего.
 */
export function marketStockPrice(base: number, mul: number | undefined): number {
  if (!mul || mul === 1) return base
  return Math.max(10, Math.round((base * mul) / 10) * 10)
}

/** Цена вещи при покупке в рассрочку: цена налом плюс наценка за товар. */
export function installmentPrice(cost: number, kind: 'realEstate' | 'business'): number {
  return Math.round((cost * RULES.installmentMarkup[kind]) / 1000) * 1000
}

/** Ежемесячный платёж по рассрочке — тело, разложенное на срок. Процентов нет. */
export function installmentMonthly(debt: number): number {
  return Math.round(debt / RULES.installmentTerm / 100) * 100
}

export function fastTrackIncome(l: Ledger): number {
  return l.fastTrack ? l.fastTrack.beginningIncome + fastTrackProgress(l) : 0
}

/** Зарплата пришла отрицательной, а наличных не хватает — это банкротство. */
export function paycheckShortfall(l: Ledger): boolean {
  const flow = monthlyCashFlow(l)
  return flow < 0 && l.cash < -flow
}

/**
 * База закята — то, что лежит без дела: наличные и вложения в бумаги.
 * НЕ входят жильё, в котором живёшь, и активы, которыми зарабатываешь, —
 * поэтому закят сам выталкивает деньги из-под матраса в дело.
 * Долги перед другими из базы вычитаются.
 */
export function zakatBase(l: Ledger): number {
  const idle = l.cash + l.stocks.reduce((s, x) => s + x.shares * x.costPerShare, 0)
  const owed = l.liabilities.bankLoan
  return Math.max(0, idle - owed)
}

export function zakatDue(l: Ledger): number {
  if (!RULES.zakat.enabled) return 0
  return Math.round((zakatBase(l) * RULES.zakat.pct) / 100 / 100) * 100
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
    paydays: 0,
  }
}
