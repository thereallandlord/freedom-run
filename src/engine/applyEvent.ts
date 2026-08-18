import type { Ledger } from './types'
import { DEBT_TO_PAYMENT } from './types'
import type { LedgerEvent } from './events'
import { glInitialState, glOnPayday, glRankFor, glTotalIncome } from './greenleaf'
import {
  MAX_PETS,
  RULES,
  zakatDue,
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
    case 'PAYCHECK': {
      // Партнёрский бизнес растёт: структура приводит людей между зарплатами.
      for (const b of l.businesses) {
        if (b.gl) {
          // GreenLeaf считает свой движок: объём, ранги, просадки, разгон.
          const { next } = glOnPayday(b.gl)
          next.age += 1
          b.gl = next
          // cashFlow держим зеркалом — его показывают списки активов.
          b.cashFlow = glTotalIncome(next)
          const rank = glRankFor(next.volume)
          if (rank.level > next.rankPaid) {
            l.cash += rank.bonus
            b.gl = { ...next, rankPaid: rank.level }
          }
          continue
        }
        if (b.growthPerPayday && b.cashFlow < (b.growthCap ?? Infinity)) {
          b.cashFlow = Math.min(b.growthCap ?? Infinity, b.cashFlow + b.growthPerPayday)
        }
      }
      /*
       * Беспроцентный период кончается — и вот тогда появляется платёж.
       * Считаем ДО начисления, чтобы первый же чек после льготы был честным.
       */
      if ((l.ribaGraceLeft ?? 0) > 0) {
        l.ribaGraceLeft = (l.ribaGraceLeft ?? 0) - 1
        if (l.ribaGraceLeft === 0 && l.liabilities.ribaLoan > 0) {
          l.expenses.ribaPayment = Math.round((l.liabilities.ribaLoan * 2) / 100 / 100) * 100
        }
      }
      l.cash += monthlyCashFlow(l, e.flowMul)
      l.paydays += 1

      /*
       * Беспроцентный заём гасится сам: платёж уменьшает тело долга.
       * Процентный кредит так себя не ведёт — там платёж это плата за деньги,
       * и тело гасится только отдельным погашением.
       */
      /*
       * 🔴 Беспроцентная рассрочка за траты ГАСИТСЯ платежами. Раньше долг и
       * платёж просто оставались навсегда: «10 платежей» на карточке было
       * обещанием, а в цифрах — вечный расход, и к середине партии игрок таскал
       * платежи за холодильник, купленный полтора часа назад.
       */
      // Страховка: платёж без тела долга — всегда ошибка, откуда бы он ни взялся.
      if (l.liabilities.retailDebt === 0) l.expenses.retailPayment = 0
      if (l.liabilities.creditCards === 0) l.expenses.creditCardPayment = 0
      if (l.liabilities.carLoans === 0) l.expenses.carPayment = 0
      if (l.liabilities.bankLoan === 0) l.expenses.bankLoanPayment = 0
      if (l.liabilities.ribaLoan === 0) l.expenses.ribaPayment = 0

      if (!RULES.loansEnabled && l.liabilities.retailDebt > 0) {
        const pay = Math.min(l.expenses.retailPayment, l.liabilities.retailDebt)
        l.liabilities.retailDebt -= pay
        if (l.liabilities.retailDebt <= 0) {
          l.liabilities.retailDebt = 0
          l.expenses.retailPayment = 0
        }
      }
      if (RULES.loansEnabled && l.liabilities.creditCards > 0) {
        // Процентная карта так себя не ведёт: платёж — плата за деньги, тело стоит.
      }

      if (!RULES.loansEnabled && l.liabilities.bankLoan > 0) {
        const pay = Math.min(l.expenses.bankLoanPayment, l.liabilities.bankLoan)
        l.liabilities.bankLoan -= pay
        if (l.liabilities.bankLoan <= 0) {
          l.liabilities.bankLoan = 0
          l.expenses.bankLoanPayment = 0
        }
      }
      return l
    }

    /** Закят: 2,5% с того, что лежало без дела. Раз в год, по счётчику зарплат. */
    case 'ZAKAT': {
      const due = zakatDue(l)
      if (due <= 0) return prev
      l.cash -= due
      return l
    }

    case 'SALARY_RAISE':
      l.salary += e.amount
      return l

    case 'BUY_STOCK':
      l.cash -= e.shares * e.costPerShare
      l.stocks.push({
        id: e.id,
        symbol: e.symbol.toUpperCase(),
        shares: e.shares,
        costPerShare: e.costPerShare,
        dividendPerShareMonthly: e.dividendPerShareMonthly,
        profitShareTo: e.profitShareTo,
        profitSharePct: e.profitSharePct,
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
        /*
         * Коэффициент настоящий: у Nvidia в 2024-м был 10:1, у Apple в 2020-м 4:1.
         *
         * 🔴 Цена ОБЯЗАНА делиться вместе с количеством. Раньше делилось только
         * количество — и карта становилась принтером денег: 100 акций после
         * сплита 10:1 продавались по старой цене, то есть ×100 вместо ×10.
         * Текст карты «богатства не прибавилось ни на рубль» был просто ложью.
         */
        const k = e.ratio ?? 2
        if (e.direction === 'split') {
          lot.shares *= k
          lot.costPerShare = Math.max(1, Math.round(lot.costPerShare / k))
          lot.dividendPerShareMonthly = Math.round(lot.dividendPerShareMonthly / k)
        } else {
          lot.shares = Math.floor(lot.shares / k)
          lot.costPerShare = Math.round(lot.costPerShare * k)
          lot.dividendPerShareMonthly = Math.round(lot.dividendPerShareMonthly * k)
        }
      }
      l.stocks = l.stocks.filter((x) => x.shares > 0)
      return l
    }

    case 'BUY_REAL_ESTATE':
      // Мушарака: каждый вносит свою долю и в той же доле получает доход.
      l.cash -= Math.round(e.downPayment * (1 - (e.investorShare ?? 0)))
      l.realEstate.push({
        id: e.id,
        name: e.name,
        cost: e.cost,
        downPayment: e.downPayment,
        mortgage: e.mortgage,
        cashFlow: e.cashFlow,
        category: e.category,
        investorShare: e.investorShare,
        installmentMonthly: e.installmentMonthly,
        partnerId: e.partnerId,
      })
      return l

    case 'SELL_REAL_ESTATE': {
      const a = l.realEstate.find((x) => x.id === e.assetId)
      if (!a) return prev
      /*
       * 🔴 Долг вычитаем ТОЛЬКО когда он гасится при продаже. Если объект
       * уходит к другому игроку вместе с долгом, вычитать нельзя: покупатель
       * долг уже принял на себя. Раньше вычитали всегда — и продавец квартиры
       * с рассрочкой не получал выручку, а ПЛАТИЛ 6,6 млн, чтобы её отдать.
       */
      const net = e.debtTransfers ? e.salePrice : e.salePrice - a.mortgage
      l.cash += a.investorShare ? Math.round(net * (1 - a.investorShare)) : net
      l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId)
      return l
    }

    case 'TAKE_RIBA_L':
      l.cash += e.amount
      l.liabilities.ribaLoan += e.amount
      // Пока идёт беспроцентный период, платежа нет — в этом весь соблазн.
      l.ribaGraceLeft = e.grace
      l.expenses.ribaPayment = e.grace > 0 ? 0 : e.payment
      return l

    case 'REPAY_RIBA_L': {
      const pay = Math.min(e.amount, l.cash, l.liabilities.ribaLoan)
      if (pay <= 0) return prev
      l.cash -= pay
      l.liabilities.ribaLoan -= pay
      l.expenses.ribaPayment =
        l.liabilities.ribaLoan > 0 && !(l.ribaGraceLeft ?? 0)
          ? Math.round((l.liabilities.ribaLoan * 2) / 100 / 100) * 100
          : l.liabilities.ribaLoan > 0
            ? l.expenses.ribaPayment
            : 0
      if (l.liabilities.ribaLoan <= 0) {
        l.liabilities.ribaLoan = 0
        l.expenses.ribaPayment = 0
        l.ribaGraceLeft = 0
      }
      return l
    }

    /** Купил хотелку — с ней приходит содержание. Расходы растут вместе с доходом. */
    case 'ADD_UPKEEP':
      l.expenses.otherExpenses += e.amount
      return l

    case 'REFUSE_WANT':
      l.wantsRefused = (l.wantsRefused ?? 0) + 1
      return l

    /** Позволил себе — счётчик отказов обнуляется, выгорание отодвигается. */
    case 'INDULGE':
      l.wantsRefused = 0
      return l

    case 'ADJUST_RIBA_EXPOSURE':
      l.ribaExposure = Math.max(0, (l.ribaExposure ?? 0) + e.amount)
      return l

    case 'SET_CITIZENSHIP':
      l.cash -= e.fee
      l.citizenship = e.name
      return l

    case 'BUY_BUSINESS':
      // Партнёрских кабинетов держат считанные штуки — иначе это принтер денег.
      if (e.category === 'partnership' && l.businesses.filter((b) => b.category === 'partnership').length >= 3)
        return prev
      l.cash -= Math.round(e.downPayment * (1 - (e.investorShare ?? 0)))
      l.businesses.push({
        id: e.id,
        name: e.name,
        cost: e.cost,
        downPayment: e.downPayment,
        liability: e.liability,
        cashFlow: e.cashFlow,
        category: e.category,
        investorShare: e.investorShare,
        growthPerPayday: e.glPackage ? undefined : e.growthPerPayday,
        growthCap: e.glPackage ? undefined : e.growthCap,
        gl: e.glPackage ? glInitialState(e.glPackage, e.glLuck ?? 1) : undefined,
        installmentMonthly: e.installmentMonthly,
        partnerId: e.partnerId,
      })
      return l

    case 'SELL_BUSINESS': {
      const a = l.businesses.find((x) => x.id === e.assetId)
      if (!a) return prev
      const net = e.debtTransfers ? e.salePrice : e.salePrice - a.liability
      l.cash += a.investorShare ? Math.round(net * (1 - a.investorShare)) : net
      l.businesses = l.businesses.filter((x) => x.id !== e.assetId)
      return l
    }

    case 'DOODAD':
    case 'FT_STAKE_LOST':
    case 'FT_DOWNSIZED':
      /*
       * 🔴 Больше, чем есть на руках, не забираем. Раньше списывали вслепую и
       * наличные уходили в минус, а экран банкротства на Полосе не открывается —
       * получались отрицательные деньги, которых взяться неоткуда.
       */
      l.cash -= Math.min(l.cash, e.amount)
      return l

    /**
     * Трата в долг. Кредитный режим: +3%/мес на кредитку навсегда.
     * Халяль-режим: беспроцентная рассрочка — 10 равных платежей,
     * долг гасится досрочно целиком через PAY_OFF_DEBT.
     */
    case 'FINANCE_DOODAD':
      if (RULES.loansEnabled) {
        l.liabilities.creditCards += e.amount
        l.expenses.creditCardPayment += Math.ceil(0.03 * e.amount)
      } else {
        l.liabilities.retailDebt += e.amount
        l.expenses.retailPayment += Math.ceil(e.amount / 10)
      }
      return l

    case 'PET':
      if (l.pets >= MAX_PETS) return prev
      l.pets += 1
      return l

    case 'DOWNSIZED':
      // Наказание — пропуск ходов (месяцы без зарплаты при живых расходах).
      // Отдельный платёж не берём: это был бы двойной счёт.
      l.charityTurnsLeft = 0
      return l

    case 'CHARITY':
      l.cash -= Math.ceil(0.1 * totalIncome(l))
      l.charityTurnsLeft = 3
      return l

    case 'CHARITY_TURN_USED':
      l.charityTurnsLeft = Math.max(0, l.charityTurnsLeft - 1)
      return l

    /**
     * Заём. Процентный режим: платёж 10% в месяц — это плата за деньги, вечная.
     * Халяль-режим (кард хасан): возвращаешь РОВНО столько же, десятью равными
     * платежами — платёж гасит тело долга и исчезает вместе с ним.
     */
    case 'TAKE_LOAN':
      l.cash += e.amount
      l.liabilities.bankLoan += e.amount
      l.expenses.bankLoanPayment += e.amount / 10
      return l

    case 'REPAY_LOAN': {
      const n = Math.min(e.amount, l.liabilities.bankLoan)
      l.cash -= n
      l.liabilities.bankLoan -= n
      l.expenses.bankLoanPayment = Math.max(0, l.expenses.bankLoanPayment - n / 10)
      // 🔴 Долг закрыт — платёж исчезает СРАЗУ, а не на следующей зарплате.
      if (l.liabilities.bankLoan <= 0) {
        l.liabilities.bankLoan = 0
        l.expenses.bankLoanPayment = 0
      }
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

    /**
     * Досрочно закрыть рассрочку. Сумма долга сама по себе не уменьшается —
     * скидка возможна только как жест продавца по факту (ضع وتعجل), а не как
     * обещанная заранее экономия. Тем рассрочка и отличается от кредита.
     */
    case 'PAYOFF_ASSET': {
      const re = l.realEstate.find((x) => x.id === e.assetId)
      const biz = l.businesses.find((x) => x.id === e.assetId)
      const a = re ?? biz
      if (!a) return prev
      const debt = re ? re.mortgage : (biz as any).liability
      if (debt <= 0) return prev
      const pay = Math.round(debt * (1 - e.discountPct / 100))
      if (l.cash < pay) return prev
      l.cash -= pay
      // Платёж по рассрочке больше не съедает доход — поток актива вырастает.
      a.cashFlow += a.installmentMonthly ?? 0
      a.installmentMonthly = 0
      if (re) re.mortgage = 0
      else (biz as any).liability = 0
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
      /*
       * 🔴 Округление вниз может обнулить ТЕЛО долга, оставив платёж живым:
       * долг 1 → 0, платёж 3 → 1, и дальше он висит вечно, потому что гасить
       * уже нечего. Подчищаем все три сразу.
       */
      if (l.liabilities.carLoans === 0) l.expenses.carPayment = 0
      if (l.liabilities.creditCards === 0) l.expenses.creditCardPayment = 0
      if (l.liabilities.retailDebt === 0) l.expenses.retailPayment = 0
      return l

    case 'DECLARE_GAME_OVER':
      l.phase = 'gameOver'
      return l

    /**
     * Выкуп при выходе из Круга: активы выкупаются как готовый бизнес —
     * N месячных потоков (в RU-режиме 50: реалистичная оценка ~4 года прибыли).
     */
    case 'ENTER_FAST_TRACK': {
      if (l.phase !== 'ratRace') return prev
      const buyout = RULES.fastTrackMultiplier * passiveIncome(l)
      l.cash += buyout
      /*
       * 🔴 Выкуп — это ПРОДАЖА всего нажитого в Круге. Активы обязаны уйти:
       * раньше они оставались в портфеле, и человек продавал их второй раз
       * по картам рынка, получая за один объект деньги дважды.
       */
      l.realEstate = []
      l.businesses = []
      l.stocks = []
      l.phase = 'fastTrack'
      l.fastTrack = {
        beginningIncome: buyout,
        goalIncome: buyout + RULES.fastTrackTarget,
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
      if (fastTrackProgress(l) >= RULES.fastTrackTarget) {
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

    /**
     * Развод. 🔴 Переделан 16.08: «отнимает половину» — это норма российского
     * права об общей совместной собственности, а в шариате имущество супругов
     * РАЗДЕЛЬНОЕ. Делить нечего. Реальные последствия — разовые расходы:
     * махр, раздел совместно нажитого быта, судебные и переезд.
     */
    case 'DIVORCE':
      l.cash -= Math.min(l.cash, e.amount)
      return l

    default:
      return prev
  }
}
