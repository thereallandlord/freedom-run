import type { Ledger } from './types'
import { DEBT_TO_PAYMENT } from './types'
import type { LedgerEvent } from './events'
import {
  glInitialState,
  glOnPayday,
  glRankFor,
  glStructureIncome,
  glTotalIncome,
  glНогиЗаМесяц,
} from './greenleaf'
import {
  MAX_CHILDREN,
  RULES,
  zakatDue,
  fastTrackProgress,
  monthlyCashFlow,
  подтянутьРасходы,
  freedomIncome,
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
 * Та же глубокая копия — для стола.
 *
 * 🔴 Стол копировал места ПОВЕРХНОСТНО, и объекты активов оставались общими с
 * предыдущим снимком. Из-за этого «сухой» прогон хода бота — проверка «примет
 * ли движок этот ход» в useGame.ts:557 и :582 — применял событие бизнеса
 * ПО-НАСТОЯЩЕМУ, а потом тот же ход уходил в сеть и применялся ВТОРОЙ раз:
 * −40 000 списывались как −80 000, +10% к доходу выходили +21%.
 */
export const cloneLedger = clone

/**
 * Чистый редьюсер кошелька. Никаких побочных эффектов, никакого рандома —
 * всё, что нужно, приходит внутри события.
 */
/**
 * Погасить рассрочку одного актива на величину его платежа.
 *
 * 🔴 До 18.08 платёж списывался из потока КАЖДЫЙ месяц, но тело долга не
 * трогал: человек платил годами, а остаток стоял на месте. При продаже
 * выручка считалась как цена минус ПОЛНЫЙ остаток — всё уплаченное сгорало.
 * Ровно отсюда и бралась «несходимость денег за партию».
 *
 * Возвращает true, если долг закрылся: тогда платёж исчезает и поток актива
 * вырастает ровно на его величину — тот же хвост, что у досрочного закрытия.
 */
function amortizeAsset(
  a: { cashFlow: number; installmentMonthly?: number; downPayment: number; paidIn?: number; investorShare?: number },
  debtRef: { get(): number; set(v: number): void },
): boolean {
  const monthly = a.installmentMonthly ?? 0
  const debt = debtRef.get()
  if (monthly <= 0 || debt <= 0) return false
  const pay = Math.min(monthly, debt)
  /*
   * 🔴 ПОГАШЕННОЕ ТЕЛО ДОЛГА — ЭТО СВОИ ДЕНЬГИ. Без этой строки каждый
   * заплаченный по рассрочке рубль движок засчитывал в «прибыль» при продаже,
   * и с несуществующего заработка отщипывалась доля владельцу находки:
   * продажа ровно в ноль превращалась в «заработал».
   */
  a.paidIn = (a.paidIn ?? a.downPayment) + Math.round(pay * (1 - (a.investorShare ?? 0)))
  debtRef.set(debt - pay)
  if (debtRef.get() <= 0) {
    debtRef.set(0)
    a.cashFlow += monthly
    a.installmentMonthly = 0
    return true
  }
  return false
}

export function applyEvent(prev: Ledger, e: LedgerEvent): Ledger {
  const l = clone(prev)

  switch (e.type) {
    case 'PAYCHECK': {
      // Объяснения этой зарплаты собираем заново.
      l.glNotes = []
      // Партнёрский бизнес растёт: структура приводит людей между зарплатами.
      for (const b of l.businesses) {
        if (b.gl) {
          // GreenLeaf считает свой движок: объём, ранги, просадки, разгон.
          const { next, note } = glOnPayday(b.gl)
          if (note) l.glNotes.push(note)
          next.age += 1
          // Ноги подтягиваются под доход: слабая объясняет ежемесячные деньги.
          b.gl = glНогиЗаМесяц(next, glStructureIncome(next))
          // cashFlow держим зеркалом — его показывают списки активов.
          b.cashFlow = glTotalIncome(next)
          const rank = glRankFor(next.volume)
          if (rank.level > next.rankPaid) {
            l.cash += rank.bonus
            b.gl = { ...next, rankPaid: rank.level }
            /*
             * Разовая премия за ранг — отдельное событие, и о нём надо
             * сказать отдельно: в жизни это не «доход подрос», а именно
             * премия за закрытую квалификацию.
             */
            l.glNotes.push(
              `Премия за ранг «${rank.name}»: ${rank.bonus.toLocaleString('ru-RU')} ₽ разово, ` +
                `и ${rank.pension.toLocaleString('ru-RU')} ₽ в месяц сверх дохода структуры — навсегда.`,
            )
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
       * Просадка обычного бизнеса тает. Списываем ПОСЛЕ начисления — значит
       * этот чек человек получил уже урезанным, а обещанные «три месяца»
       * ровно три месяца и длятся.
       */
      for (const b of l.businesses) {
        if (!b.gl && (b.dipLeft ?? 0) > 0) {
          b.dipLeft = (b.dipLeft ?? 0) - 1
          if (b.dipLeft === 0) b.dipMul = 1
        }
      }
      /*
       * Уровень жизни подтягивается за доходом — ПОСЛЕ начисления, чтобы этот
       * чек человек получил целиком, а прибавка к расходам пришла со
       * следующего месяца. Так это и ощущается в жизни.
       */
      подтянутьРасходы(l)

      /*
       * Рассрочка за активы гасится ПОСЛЕ начисления потока — иначе последний
       * платёж уйдёт дважды: и из потока этого месяца, и из тела долга.
       */
      for (const a of l.realEstate) {
        amortizeAsset(a, { get: () => a.mortgage, set: (v) => (a.mortgage = v) })
      }
      for (const b of l.businesses) {
        amortizeAsset(b, { get: () => b.liability, set: (v) => (b.liability = v) })
      }

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
      // 🔴 Второй рубеж: журнал переигрывается и на клиенте, и в тестах —
      // отрицательное или дробное количество не должно доезжать сюда никогда.
      const n = Math.min(Math.floor(e.shares), lot.shares)
      if (!Number.isFinite(n) || n <= 0) return prev
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
        // Сколько своих денег ушло — для панели: downPayment у долевой покупки нулевой.
        paidIn: e.paidIn ?? e.downPayment,
        value: e.value,
        profitShareTo: e.profitShareTo,
        profitSharePct: e.profitSharePct,
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
      const net = e.debtTransfers ? e.salePrice : e.salePrice - (a.mortgage - (e.rebate ?? 0))
      l.cash += a.investorShare ? Math.round(net * (1 - a.investorShare)) : net
      l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId)
      return l
    }

    case 'TAKE_RIBA_L': {
      /*
       * 🔴 ЛЬГОТА ДАЁТСЯ ОДИН РАЗ — на ПЕРВЫЙ кредит. Раньше любое добирание,
       * хоть на 10 000, обнуляло уже начисленный платёж и заново открывало
       * беспроцентный период: платить можно было не начинать никогда, а тело
       * долга при этом росло. Вся денежная часть урока обходилась копейками.
       */
      const былоТело = l.liabilities.ribaLoan
      l.cash += e.amount
      l.liabilities.ribaLoan += e.amount
      if (былоТело <= 0) l.ribaGraceLeft = e.grace
      // Пока идёт беспроцентный период, платежа нет — в этом весь соблазн.
      // Кончился — платёж считается от ВСЕГО тела, включая добор.
      l.expenses.ribaPayment = (l.ribaGraceLeft ?? 0) > 0 ? 0 : e.payment
      return l
    }

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

    case 'SET_MANAGER': {
      const b = l.businesses.find((x) => x.id === e.assetId)
      if (!b) return prev
      b.managerPct = e.pct
      return l
    }

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
        // Сколько своих денег ушло — для панели: downPayment у долевой покупки нулевой.
        paidIn: e.paidIn ?? e.downPayment,
        value: e.value,
        profitShareTo: e.profitShareTo,
        profitSharePct: e.profitSharePct,
      })
      return l

    case 'SELL_BUSINESS': {
      const a = l.businesses.find((x) => x.id === e.assetId)
      if (!a) return prev
      const net = e.debtTransfers ? e.salePrice : e.salePrice - (a.liability - (e.rebate ?? 0))
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
      if (l.children >= MAX_CHILDREN) return prev
      l.children += 1
      return l

    case 'DOWNSIZED':
      // Наказание — пропуск ходов (месяцы без зарплаты при живых расходах).
      // Отдельный платёж не берём: это был бы двойной счёт.
      l.charityTurnsLeft = 0
      return l

    case 'CHARITY':
      l.cash -= Math.ceil(0.1 * totalIncome(l))
      /*
       * Три хода. Ослаблять НЕ НАДО: Камиль вернул как было — «чит-код это
       * хорошо, она хоть немного спасала и создавала капиталец». Решение
       * владельца, а не баланс ради баланса.
       */
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

    /*
     * 🔴 Долг гасится и ЧАСТЯМИ, не только целиком.
     *
     * Раньше кнопка была одна — «закрыть весь долг», и она гасла, если денег
     * не хватало. Со стороны это выглядело как поломка: «у одного
     * погасилось, у другого рассрочка на машину не гасится». А человек с
     * половиной суммы вообще ничего сделать не мог — только копить, пока
     * платёж каждый месяц съедает зарплату.
     *
     * Платёж падает ровно во столько же раз, во сколько уменьшился остаток:
     * внёс половину — платишь половину. Никакой переплаты за досрочность:
     * рассрочка тем и отличается от кредита.
     *
     * Сумма НЕОБЯЗАТЕЛЬНА: без неё гасим целиком, как раньше. Это важно —
     * старые партии переигрываются из журнала, и события в нём суммы не
     * несут.
     */
    case 'PAY_OFF_DEBT': {
      const balance = l.liabilities[e.debt]
      if (balance <= 0) return prev
      const pay = e.amount == null ? balance : Math.max(0, Math.min(Math.round(e.amount), balance))
      if (pay <= 0 || l.cash < pay) return prev
      const payment = l.expenses[DEBT_TO_PAYMENT[e.debt]]
      const остаток = balance - pay
      l.cash -= pay
      l.liabilities[e.debt] = остаток
      l.expenses[DEBT_TO_PAYMENT[e.debt]] =
        остаток === 0 ? 0 : Math.round((payment * остаток) / balance)
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
      const debt = re ? re.mortgage : (biz as { liability: number }).liability
      if (debt <= 0) return prev
      /*
       * Гасим целиком или частью. Часть не может быть больше долга и не может
       * быть нулевой: «погасить ноль» — это не действие.
       */
      const часть = e.amount != null ? Math.min(Math.max(0, Math.round(e.amount)), debt) : debt
      if (часть <= 0) return prev
      const pay = Math.round(часть * (1 - e.discountPct / 100))
      if (l.cash < pay) return prev
      l.cash -= pay
      // Досрочное погашение — тоже свои деньги: в ОСНОВУ прибыли, а не в неё.
      a.paidIn = (a.paidIn ?? a.downPayment) + pay
      /*
       * 🔴 ПЛАТЁЖ УМЕНЬШАЕТСЯ ВМЕСТЕ С ДОЛГОМ, и ровно на ту же долю. Иначе
       * частичное погашение не давало бы НИЧЕГО до самого конца — деньги
       * ушли, а доход прежний. Закрыл треть долга — треть платежа сразу
       * вернулась в поток.
       */
      const былПлатёж = a.installmentMonthly ?? 0
      const остаток = debt - часть
      const новыйПлатёж = остаток > 0 ? Math.round((былПлатёж * остаток) / debt) : 0
      a.cashFlow += былПлатёж - новыйПлатёж
      a.installmentMonthly = новыйПлатёж
      if (re) re.mortgage = остаток
      else (biz as { liability: number }).liability = остаток
      return l
    }

    case 'ADJUST_CASH':
      l.cash += e.amount
      return l

    /**
     * Поток одной записи изменился снаружи. Нужно ровно для общих объектов:
     * когда рассрочка закрыта, освободившийся платёж возвращается в поток
     * ОБЕИХ половин, а вторая половина живёт в чужом кошельке.
     */
    case 'SET_ASSET_FLOW': {
      const a =
        l.realEstate.find((x) => x.id === e.assetId) ?? l.businesses.find((x) => x.id === e.assetId)
      if (!a) return prev
      a.cashFlow = e.cashFlow
      return l
    }

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
        // 🔴 Половина ВЛОЖЕННОГО, а не «первого взноса»: у долевой покупки
        // взнос в активе нулевой (его списали двумя переводами), и банк
        // возвращал ноль обоим участникам общего объекта.
        l.cash += Math.floor((a.paidIn ?? a.downPayment) / 2)
        l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId)
      } else {
        const a = l.businesses.find((x) => x.id === e.assetId)
        if (!a) return prev
        l.cash += Math.floor((a.paidIn ?? a.downPayment) / 2)
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
      const buyout = e.buyout ?? RULES.fastTrackMultiplier * freedomIncome(l)
      /*
       * 🔴 БУМАГИ ПРОДАЮТСЯ, А НЕ СГОРАЮТ. Выкуп считается от свободного
       * дохода, а бумаги дают его только дивидендами — у 14 из 15 бумаг колоды
       * дивиденд ноль. Значит пакет в выкуп не входил вообще, а строкой ниже
       * уничтожался: замер на 200 партиях — 634 человека из 728 вышли из Круга
       * с непустым пакетом, сгорело 1 155 227 920 ₽, худший случай 58 925 800 ₽
       * у одного человека. Это и есть «на лям ты нас швырнул».
       * Цену считает стол (там рынок) и передаёт сюда.
       */
      const пакет = Math.max(0, Math.round(e.stocksValue ?? 0))
      l.cash += buyout + пакет
      /*
       * 🔴 Выкуп — это ПРОДАЖА всего нажитого в Круге. Активы обязаны уйти:
       * раньше они оставались в портфеле, и человек продавал их второй раз
       * по картам рынка, получая за один объект деньги дважды.
       */
      l.realEstate = []
      l.businesses = []
      l.stocks = []
      /*
       * 🔴 Выкуп ЗАКРЫВАЕТ все долги Круга, а их сумма из него вычитается.
       *
       * Так и происходит, когда человек распродаёт всё нажитое: сначала
       * рассчитывается по обязательствам, остальное забирает. Раньше долги
       * оставались висеть на Полосе свободы мёртвым грузом: платежей по ним
       * там нет (на Полосе считается только доход), гасить их было незачем —
       * но панель их показывала, и человек честно пытался их закрыть,
       * выбрасывая деньги ни за что. Отсюда и «на большом круге погасить
       * нельзя вовсе»: гасить там нечего и не нужно.
       */
      const долги =
        l.liabilities.homeMortgage +
        l.liabilities.schoolLoans +
        l.liabilities.carLoans +
        l.liabilities.creditCards +
        l.liabilities.retailDebt +
        l.liabilities.bankLoan +
        l.liabilities.ribaLoan
      /*
       * 🔴 БЕЗ Math.max(0, …). Пол на нуле ПЕЧАТАЛ ДЕНЬГИ: если ведомость была
       * больше, чем выкуп плюс наличные, разница просто списывалась в никуда,
       * а долги обнулялись. Стол на этом терял связь с арифметикой. Уйти в
       * минус здесь нельзя — стол не пускает в выход того, кому не хватает
       * (проверка стоит в table.ts, ветка ENTER_FAST_TRACK).
       */
      l.cash -= долги
      l.liabilities = {
        homeMortgage: 0,
        schoolLoans: 0,
        carLoans: 0,
        creditCards: 0,
        retailDebt: 0,
        bankLoan: 0,
        ribaLoan: 0,
      }
      l.expenses = {
        ...l.expenses,
        homeMortgagePayment: 0,
        schoolLoanPayment: 0,
        carPayment: 0,
        creditCardPayment: 0,
        retailPayment: 0,
        bankLoanPayment: 0,
        ribaPayment: 0,
      }
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
      /*
       * 🔴 День потока — ТОЖЕ месяц. Счётчик вёл только PAYCHECK, поэтому на
       * Полосе он замирал на числе, с которым человек вышел из Круга: кратно
       * 12 — закят брали КАЖДЫЙ день потока до конца партии, не кратно — не
       * брали ни разу. Лотерея по чётности, а не правило.
       */
      l.paydays += 1
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
