import type { Ledger, Profession } from './types'
import { glFreedomShare, glTotalIncome, type GlState } from './greenleaf'

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
   * 🔴 В русском режиме теперь 1.0 — НАСТОЯЩИЕ цифры (правка 18.08).
   * Урезание втрое считало аренду однушки в Казани за 9 300 ₽ при цене
   * 6,5 млн, то есть 1,7% годовых. Такой доходности не бывает, и на ней не
   * сходилась ни одна покупка в рассрочку: платёж выходил вчетверо больше
   * аренды, и пассивный доход у всех уходил в минус.
   */
  yieldScale: number
  /**
   * Наценка за рассрочку по классам активов. Дозволена единогласно
   * (резолюция Академии фикха ОИС № 51): «сроку принадлежит доля цены».
   * 🔴 Привязана к ТОВАРУ и фиксируется в момент сделки — от срока и просрочки не растёт.
   */
  installmentMarkup: { realEstate: number; business: number }
  /**
   * На сколько месяцев расписывается рассрочка, по видам.
   * 🔴 Жильё покупают на четверть века, а не на десять лет. При сроке 120
   * платёж выходил вдвое-втрое больше аренды, и любая покупка в рассрочку
   * гарантированно уводила пассивный доход в минус.
   */
  installmentTerm: { realEstate: number; business: number }
  /** Закят: доля в процентах и период в «зарплатах» (12 = раз в год). */
  zakat: { enabled: boolean; pct: number; everyPaydays: number }
  /** Какая доля прироста дохода уходит в расходы. 0 — уровень жизни не растёт. */
  lifestyleCreepPct?: number
}

export const RULES: Rules = {
  currency: 'USD',
  fastTrackMultiplier: 100,
  fastTrackTarget: 150_000,
  loansEnabled: true,
  yieldScale: 1,
  installmentMarkup: { realEstate: 1.25, business: 1.2 },
  installmentTerm: { realEstate: 300, business: 84 },
  zakat: { enabled: false, pct: 2.5, everyPaydays: 12 },
  lifestyleCreepPct: 33,
}

export function setRules(patch: Partial<Rules>) {
  Object.assign(RULES, patch)
}

/** Потолок питомцев в семье. */
export const MAX_CHILDREN = 3

export function childExpenses(l: Ledger): number {
  return l.children * l.profession.perChildExpense
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

/**
 * Применить рыночный множитель к потоку.
 *
 * 🔴 Знак имеет значение. Наивное `поток × 1,2` на УБЫТОЧНОМ объекте делает
 * убыток больше: −8 200 превращается в −9 840, то есть хорошая новость бьёт по
 * владельцу. Игрок читает зелёную плашку «аренда подорожала» и уходит в минус —
 * объяснить это за столом нечем. Для минусового потока процент инвертируем:
 * хорошая новость сокращает убыток, плохая — углубляет.
 */
function applyFlowMul(flow: number, mul: number): number {
  if (mul === 1) return flow
  const k = flow < 0 ? 2 - mul : mul
  return Math.round(flow * k)
}

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
  a: { cashFlow: number; investorShare?: number; category?: string; gl?: GlState; managerPct?: number },
  m: FlowMul,
): number {
  const base = a.gl ? glTotalIncome(a.gl) : ownShare(a)
  /*
   * 🔴 Управляющий забирает долю из ЖИВЫХ ДЕНЕГ, а не только из зачёта свободы.
   * Иначе найм был бы бесплатной выгодой: доход тот же, а к свободе ближе.
   * Настоящий размен именно в этом — платишь частью дохода за то, чтобы
   * бизнес крутился без тебя.
   */
  const afterManager = a.managerPct ? Math.round((base * (100 - a.managerPct)) / 100) : base
  return applyFlowMul(afterManager, mulFor(m, a.category ?? ''))
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
    e.ribaPayment +
    childExpenses(l)
  )
}

/**
 * Насколько расходы подтягиваются за выросшим доходом.
 *
 * 🔴 Главная причина, по которой партию проходили за час (решение Камиля
 * 20.08 — вместо замедления партнёрского бизнеса). В жизни выросший доход
 * почти сразу утягивает за собой уровень жизни: квартира побольше, машина
 * поновее, школа получше. В игре доход рос, а расходы стояли — и свобода
 * наступала неправдоподобно быстро.
 *
 * Берём ТРЕТЬ прироста: две трети остаются человеку, и разрыв всё равно
 * растёт — просто медленнее. Половина уже душит, четверть почти незаметна.
 */
export const РОСТ_РАСХОДОВ_ЗА_ДОХОДОМ_PCT = 33
/* Живое значение лежит в правилах режима (RULES.lifestyleCreepPct) — его надо
   крутить при подборе баланса и показывать в панели хозяина. Константа выше —
   значение по умолчанию. */

/**
 * Подтянуть расходы за выросшим доходом. Возвращает добавку.
 *
 * Считается от НАИВЫСШЕГО дохода, который человек видел, а не от текущего:
 * иначе просадка рынка «возвращала» бы уровень жизни назад, а в жизни от
 * привычек так просто не отказываются.
 */
export function подтянутьРасходы(l: Ledger): number {
  const доход = totalIncome(l)
  const пик = l.incomePeak ?? доход
  if (доход <= пик) {
    l.incomePeak = пик
    return 0
  }
  const доля = RULES.lifestyleCreepPct ?? РОСТ_РАСХОДОВ_ЗА_ДОХОДОМ_PCT
  const добавка = Math.round(((доход - пик) * доля) / 100 / 100) * 100
  l.incomePeak = доход
  if (добавка > 0) l.expenses.otherExpenses += добавка
  return добавка
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

/**
 * Управляющий: сколько забирает и сколько остаётся владельцу.
 * Обычного нанимают за деньги в любой момент, редкий приходит картой.
 */
export const MANAGER_PCT = 35
export const MANAGER_RARE_PCT = 20

/**
 * Доход, который работает БЕЗ ТЕБЯ. Именно он выводит из круга.
 *
 * 🔴 Это НЕ то же самое, что пассивный доход в старом смысле. Деньги от кафе
 * приходят и тратятся как обычно — но пока ты сам стоишь за прилавком, они
 * не приближают свободу: перестал ходить, перестало платить. Свободу даёт
 * только то, что крутится само:
 *   · аренда и дивиденды — сразу;
 *   · бизнес — после того, как нанят управляющий, и только его остаток;
 *   · партнёрский бизнес — по мере роста структуры (см. glFreedomShare):
 *     в начале ты в нём работаешь так же, как в любом деле.
 */
export function freedomIncome(l: Ledger, m?: FlowMul): number {
  const stocks = l.stocks.reduce((s, lot) => s + lot.shares * lot.dividendPerShareMonthly, 0)
  const realEstate = l.realEstate.reduce((s, a) => s + ownShareAt(a, m), 0)
  const businesses = l.businesses.reduce((s, a) => {
    // ownShareAt уже вычел долю управляющего — здесь только решаем,
    // идёт ли остаток в зачёт свободы.
    const mine = ownShareAt(a, m)
    if (a.gl) return s + Math.round((mine * glFreedomShare(a.gl)) / 100)
    return a.managerPct ? s + mine : s
  }, 0)
  return stocks + realEstate + businesses
}

/** Условие выхода из Круга: строго больше, не «больше или равно». */
export function isOutOfRatRace(l: Ledger): boolean {
  return freedomIncome(l) > totalExpenses(l)
}

/** Новый доход, собранный на Полосе свободы. */
export function fastTrackProgress(l: Ledger): number {
  return l.fastTrack ? l.fastTrack.businesses.reduce((s, b) => s + b.cashFlow, 0) : 0
}

export function fastTrackTarget(): number {
  return RULES.fastTrackTarget
}

/**
 * Второе гражданство. Не даёт дохода — даёт устойчивость.
 * Настоящие условия: Турция — 400 000 $ в недвижимости этой страны;
 * Карибы — прямой взнос, недвижимость не нужна.
 */
export const CITIZENSHIP = [
  {
    id: 'tr',
    name: 'Гражданство Турции',
    /** Нужно держать турецкой недвижимости на эту сумму. */
    needCategory: 'aptTUR',
    needAmount: 31_600_000,
    fee: 900_000,
    note: 'Программа даёт паспорт за 400 000 $ в недвижимости. Объекты остаются вашими — их не продают, а держат три года.',
  },
  {
    id: 'carib',
    name: 'Паспорт Карибов',
    needCategory: '',
    needAmount: 0,
    fee: 17_400_000,
    note: 'Прямой взнос в фонд государства, недвижимость не нужна. Деньги уходят безвозвратно и потока не дают.',
  },
]

export function citizenshipReady(l: Ledger, id: string): { ok: boolean; why: string } {
  const c = CITIZENSHIP.find((x) => x.id === id)
  if (!c) return { ok: false, why: '' }
  if (l.citizenship) return { ok: false, why: 'Второй паспорт у вас уже есть' }
  if (c.needAmount > 0) {
    const held = l.realEstate
      .filter((a) => a.category === c.needCategory)
      .reduce((s, a) => s + a.cost, 0)
    if (held < c.needAmount)
      return {
        ok: false,
        why: `Нужно держать недвижимости этой страны на ${c.needAmount.toLocaleString('ru-RU')} ₽, у вас на ${held.toLocaleString('ru-RU')} ₽`,
      }
  }
  if (l.cash < c.fee) return { ok: false, why: 'Не хватает наличных на сборы и оформление' }
  return { ok: true, why: '' }
}

/**
 * Процентный кредит. Условия НАМЕРЕННО заманчивые: дают много, сразу, никого
 * просить не надо, и первые месяцы вообще без платежей. Так это и работает в
 * жизни — иначе никто бы и не брал.
 *
 * 🔴 Плата не в процентах на экране, а в том, что жизнь идёт тяжелее: пока
 * кредит открыт, неприятности приходят чаще. Игра ничего не запрещает и не
 * читает нотаций — связь человек достраивает сам, глядя на строку «долговая
 * нагрузка» в панели.
 */
export const RIBA = {
  /** Сколько дают: кратно месячному доходу. */
  limitIncomeMul: 6,
  /** Месячный платёж — доля тела. Это плата за деньги, тело им не гасится. */
  ratePctMonthly: 2,
  /** Сколько зарплат идёт беспроцентный период. */
  gracePaydays: 3,
  /** Шаг долговой нагрузки: сколько тела приходится на одну «ступень» риска. */
  loadStep: 300_000,
  /** Потолок добавочного риска. */
  maxRisk: 0.6,
}

/** Долговая нагрузка от 0 до 1 — её видно в панели, по ней растёт частота бед. */
export function ribaRisk(l: Ledger): number {
  const load = l.liabilities.ribaLoan + (l.ribaExposure ?? 0)
  if (load <= 0) return 0
  return Math.min(RIBA.maxRisk, (load / RIBA.loadStep) * 0.2)
}

export function ribaLimit(l: Ledger): number {
  const base = Math.max(l.salary, totalIncome(l))
  return Math.round((base * RIBA.limitIncomeMul) / 10_000) * 10_000
}

export function ribaMonthly(principal: number): number {
  return Math.round((principal * RIBA.ratePctMonthly) / 100 / 100) * 100
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

/**
 * Условия сделки: что заплатишь и что будешь получать при каждом из двух
 * способов покупки.
 *
 * 🔴 ОДНА функция на движок и на интерфейс. Раньше окно карточки считало поток
 * своей формулой, а движок — своей, и они разошлись: карточка обещала одно,
 * начислялось другое. Игрок это видит сразу и перестаёт верить цифрам.
 *
 * 🔴 Если взнос равен цене, рассрочки НЕТ. У машиномест, кладовок и участков
 * так и заведено в колоде: их покупают целиком. Начислять им наценку за
 * рассрочку — выдумывать долг, которого нет.
 */
export function dealTerms(card: { cost: number; downPayment: number; cashFlow: number }, kind: 'realEstate' | 'business') {
  const financeable = card.downPayment < card.cost
  const instTotal = financeable ? installmentPrice(card.cost, kind) : card.cost
  const instDebt = financeable ? Math.max(0, instTotal - card.downPayment) : 0
  const monthly = financeable ? installmentMonthly(instDebt, kind) : 0
  return {
    financeable,
    /** Налом: платишь всю цену, долгов нет, доход весь твой. */
    cashPrice: card.cost,
    cashFlow: card.cashFlow,
    /** В рассрочку: платишь взнос, остаток с наценкой, платёж съедает доход. */
    instTotal,
    instDebt,
    instDown: card.downPayment,
    instMonthly: monthly,
    instFlow: card.cashFlow - monthly,
  }
}

/**
 * Поток сделки с поправкой на текущий рынок — ТОЛЬКО ДЛЯ ПОКАЗА.
 *
 * 🔴 Внутрь dealTerms этот множитель вносить нельзя: её же зовёт покупка,
 * чтобы записать БАЗОВЫЙ поток актива, и рынок применился бы второй раз на
 * зарплате. Здесь он нужен затем, чтобы карточка не обещала 103 000, когда
 * при живом событии придёт 77 250.
 */
export function marketDealFlow(base: number, mul: number | undefined): number {
  return applyFlowMul(base, mul ?? 1)
}

/** Цена вещи при покупке в рассрочку: цена налом плюс наценка за товар. */
export function installmentPrice(cost: number, kind: 'realEstate' | 'business'): number {
  return Math.round((cost * RULES.installmentMarkup[kind]) / 1000) * 1000
}

/** Ежемесячный платёж по рассрочке — тело, разложенное на срок. Процентов нет. */
export function installmentMonthly(debt: number, kind: 'realEstate' | 'business' = 'realEstate'): number {
  return Math.round(debt / RULES.installmentTerm[kind] / 100) * 100
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
  const owed = l.liabilities.bankLoan + l.liabilities.ribaLoan
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
    // 🔴 Процентный кредит — такой же долг: без него капитал завышен.
    l.liabilities.ribaLoan +
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
    expenses: { ...p.expenses, bankLoanPayment: 0, ribaPayment: 0 },
    liabilities: { ...p.liabilities, bankLoan: 0, ribaLoan: 0 },
    children: 0,
    incomePeak: undefined,
    stocks: [],
    realEstate: [],
    businesses: [],
    charityTurnsLeft: 0,
    paydays: 0,
  }
}
