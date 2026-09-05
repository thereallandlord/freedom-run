/**
 * Ручки характера ботов.
 *
 * 🔴 Числа подобраны ЗАМЕРОМ (`npm run bots`), а не на глаз: до правок бот
 * брал крупную колоду в 100% случаев и не видел бумаг вовсе, продавал лот
 * целиком при первой же цене и ни разу не отказывал себе в хотелке.
 */
/** Как часто бот идёт в крупную колоду, когда денег хватает на обе. */
const ДОЛЯ_КРУПНОЙ = 0.6
/** Ниже этой доли от цены входа бот режет убыток и выходит из бумаги. */
const СТОП_УБЫТОК = 0.6
/** Сколько лота продаёт на хорошей цене: человек редко выходит разом. */
const ДОЛЯ_ПРОДАЖИ = 0.6
/** Цена «двух кабинетов» как доля от цены пакета. */
const ЦЕНА_КАБИНЕТОВ = 0.5
/** За сколько месяцев доплата за пакет должна отбиться, чтобы бот её сделал. */
const ОКУПАЕМОСТЬ_ПАКЕТА = 18

import botProfilesJson from '../data/bot-profiles.json'
import type { BotDifficulty, Seat, StockCard, Table } from './types'
import type { TableEvent } from './events'
import {
  charityCost,
  currentSeat,
  diceCountFor,
  dreamPriceAt,
  ftCharityCost,
  hasConsumerDebt,
  hasSellableAssets,
  canRecover,
  marketMatches,
  sellOfferPrice,
  stockPriceNow,
  можноВыйтиИзКруга,
} from './table'
import {
  RULES,
  isOutOfRatRace,
  monthlyCashFlow,
  totalExpenses,
  freedomIncome,
  dealTerms,
  marketStockPrice,
  ownShare,
  MANAGER_PCT,
} from './ledger'
import { TICKERS, bigDeals, fastBoard, smallDeals } from './data'
import { loanOwed } from './trades'
import {
  GL_PROMOS,
  glPackage,
  glPromoReady,
  glStructureIncome,
  glUpgradeCost,
  glUpgradeOptions,
} from './greenleaf'

export interface BotProfile {
  buyDealChance: number
  requirePositiveFlow: boolean
  bufferMonths: number
  /** null = порог никогда не достигается (в оригинале Infinity). */
  bigDealCash: number | null
  leverage: boolean
  stockBuyQuantile: number
  stockSellQuantile: number
  stockCashFraction: number
  marketSellMultiple: number | null
  dumpNegativeFlowAt: number | null
  /** Как часто отказывает себе в хотелке, даже когда деньги есть. */
  skipWantChance: number
  charity: 'never' | 'sometimes' | 'rich' | 'always'
  ventureCashFraction: number
  laneBuyCashMultiple: number
  repayIdle: boolean
}

export const BOT_PROFILES = botProfilesJson as unknown as Record<BotDifficulty, BotProfile>

const inf = (v: number | null) => (v === null ? Infinity : v)

/**
 * Вилка цены бумаги: от чего считать «дорого» и «дёшево».
 *
 * 🔴 БРАТЬ ЕЁ ИЗ КОЛОДЫ, А НЕ ИЗ tickers.json. Я на этом уже ошибся: взял
 * `TICKERS[symbol]`, а там лежат тикеры КЛАССИЧЕСКОЙ колоды (GRIT, SNAIL,
 * MYCO…). В русской они свои — AAPL, GOLD, BTC, SUKUK, — и пересекаются
 * ровно двумя мемкоинами. То есть для тринадцати бумаг из пятнадцати вилка
 * не находилась вовсе, порог молча падал на «цену покупки», и настройка
 * `stockSellQuantile` опять не делала ничего — та самая мина, которую я
 * только что чинил.
 *
 * У карточек колоды вилка есть у всех до одной — её и спрашиваем.
 */
function вилкаЦены(t: Table, symbol: string): [number, number] | null {
  for (const c of [...smallDeals(t.deckTheme), ...bigDeals(t.deckTheme)]) {
    if (c.kind === 'stock' && (c as StockCard).symbol === symbol) {
      const r = (c as StockCard).range
      if (r) return r
    }
  }
  return TICKERS[symbol]?.range ?? null
}

/** Порог в диапазоне цены тикера: 0 — дно, 1 — потолок. */
function quantilePrice(range: [number, number], q: number): number {
  return range[0] + (range[1] - range[0]) * q
}

function cashBuffer(seat: Seat, p: BotProfile): number {
  return Math.round(totalExpenses(seat.ledger) * p.bufferMonths)
}

/**
 * Решение бота на текущем состоянии стола.
 * Возвращает одно событие; водитель вызывает функцию, пока ход не закончится.
 */
export function decideBotEvent(t: Table, rnd: () => number): TableEvent | null {
  const seat = currentSeat(t)
  if (!seat.isBot) return null
  const p = BOT_PROFILES[seat.botDifficulty]
  const l = seat.ledger

  // 1. Банкротство разбираем в первую очередь.
  if (t.pending?.kind === 'bankruptcy') {
    if (canRecover(l)) return { type: 'BANKRUPTCY_RECOVER' }
    if (hasSellableAssets(l)) {
      const worst =
        [...l.realEstate].sort((a, b) => a.cashFlow - b.cashFlow)[0] ??
        [...l.businesses].sort((a, b) => a.cashFlow - b.cashFlow)[0]
      if (worst) {
        const kind = l.realEstate.includes(worst as any) ? 'realEstate' : 'business'
        return { type: 'BANKRUPTCY_SELL', assetKind: kind, assetId: worst.id }
      }
      if (l.stocks.length) {
        return { type: 'BANKRUPTCY_SELL', assetKind: 'stock', assetId: l.stocks[0].id }
      }
    }
    if (hasConsumerDebt(l)) return { type: 'BANKRUPTCY_HALVE' }
    return { type: 'BANKRUPTCY_QUIT' }
  }

  // 2. Пора на Полосу свободы — уходим сразу.
  if (t.phase === 'awaitingRoll' && можноВыйтиИзКруга(t, seat)) {
    return { type: 'ENTER_FAST_TRACK' }
  }

  // 3. Бросок.
  if (t.phase === 'awaitingRoll') {
    const allowed = diceCountFor(seat)
    const count = allowed[allowed.length - 1] // при выборе берём максимум
    const dice = Array.from({ length: count }, () => 1 + Math.floor(rnd() * 6))
    return { type: 'ROLL', dice }
  }

  // 4. Разбор карты/клетки.
  const pending = t.pending
  if (!pending) {
    if (t.phase === 'turnEnd') {
      const step = RULES.currency === 'RUB' ? 10_000 : 1000

      /*
       * 🔴 БОТ ПОЛЬЗУЕТСЯ СВОИМ ПАРТНЁРСКИМ БИЗНЕСОМ.
       *
       * Замер до правки: 259 входов в GreenLeaf — и НИ ОДНОГО действия по нему
       * дальше. У «среднего» за 20 партий лежало доступными 181 промоушен на
       * 33,7 млн ₽ (около 420 тысяч на бота за партию), взято ноль. Пакет во
       * всех 259 случаях выходил «Платина» — не по выбору, а потому что движок
       * подставляет умолчание, когда бот не назвал ничего. Повышения пакета и
       * покупки кабинетов — ноль за все прогоны.
       *
       * Человеку за столом это видно напрямую: у соседа-бота структура стоит
       * на месте всю партию, и половина смысла игры про партнёрский бизнес
       * просто не показывается.
       */
      const бизнес = l.businesses.find((b) => b.gl)
      if (бизнес?.gl) {
        const g = бизнес.gl
        // 1. Промоушен: живые деньги, которые лежат и ждут.
        for (const promo of GL_PROMOS) {
          if (!glPromoReady(g, promo).ready) continue
          /* Жадный берёт деньгами; «мягкий» иногда едет сам — так за столом
             видно, что у этого выбора есть две стороны. */
          const деньгами = promo.id !== 'travel' || rnd() > (p.skipWantChance ?? 0)
          return { type: 'GL_PROMO_TAKE', promo: promo.id, go: !деньгами }
        }
        // 2. Кабинеты: разовая покупка, дальше просто больше дохода.
        const кабинеты = Math.round(glPackage(g.packageId).price * ЦЕНА_КАБИНЕТОВ)
        if (!g.triangle && l.cash - кабинеты >= cashBuffer(seat, p) * 2) {
          return { type: 'GL_BUY_TRIANGLE', cost: кабинеты }
        }
        // 3. Пакет повыше — когда доплата отбивается за разумный срок.
        for (const pk of glUpgradeOptions(g.packageId).reverse()) {
          const доплата = glUpgradeCost(g.packageId, pk.id)
          if (доплата <= 0 || l.cash - доплата < cashBuffer(seat, p) * 2) continue
          const станет = glStructureIncome({ ...g, packageId: pk.id })
          const прибавка = станет - glStructureIncome(g)
          if (прибавка > 0 && доплата / прибавка <= ОКУПАЕМОСТЬ_ПАКЕТА) {
            return { type: 'GL_UPGRADE', assetId: бизнес.id, to: pk.id }
          }
        }
      }

      /*
       * 🔴 Актив, который каждый месяц ЕСТ деньги, бот держал до конца партии.
       * Ручка `dumpNegativeFlowAt` была объявлена в профиле и заполнена во всех
       * четырёх сложностях — и не читалась НИ РАЗУ. То есть настройка выглядела
       * настройкой, а не меняла ничего: ловушка для того, кто станет
       * калибровать ботов.
       */
      const порогСброса = p.dumpNegativeFlowAt
      if (порогСброса !== null && monthlyCashFlow(l, t.market.flow) < порогСброса) {
        const худший = [...l.realEstate, ...l.businesses]
          .filter((a) => !(a as { gl?: unknown }).gl)
          .sort((a, b) => a.cashFlow - b.cashFlow)[0]
        if (худший && худший.cashFlow < 0) {
          const вид = l.realEstate.some((x) => x.id === худший.id) ? 'realEstate' : 'business'
          return {
            type: 'OFFER_ASSET',
            assetId: худший.id,
            amount: Math.round(худший.cost * 0.8),
            kind: вид,
          } as TableEvent
        }
      }

      if (p.repayIdle && l.liabilities.bankLoan >= step && l.cash >= step + cashBuffer(seat, p)) {
        return { type: 'REPAY_LOAN', amount: step }
      }
      return { type: 'END_TURN' }
    }
    return null
  }

  /*
   * Перед разбором карты: если есть бизнес без управляющего и хватает денег —
   * нанимаем. Без этого бот копил бы доход, который никогда не станет свободой,
   * и прогон показал бы длину партии неверно.
   */
  {
    /*
     * Если на столе лежит предложение управляющего — берём ЕГО долю: она
     * меньше рыночной, а карточка одноразовая. Без этого бот нанимал бы за
     * полную цену прямо поверх выгодного предложения.
     */
    const предложение =
      pending?.kind === 'market' &&
      pending.card.kind === 'bizEvent' &&
      pending.card.managerPct != null &&
      t.turnIndex === t.seats.findIndex((s) => s.id === seat.id)
        ? { pct: pending.card.managerPct, виды: pending.card.categories }
        : null
    const подходит = (b: { category?: string }) =>
      !предложение?.виды?.length || предложение.виды.includes(b.category ?? '')
    /*
     * 🔴 ЗЕРКАЛО ОБЩЕГО ДЕЛА БОТ НЕ БЕРЁТ, а цену считает от ПОЛНОГО потока.
     * Формула ниже осталась старой (`ownShare` — доля нанимающего), тогда как
     * движок берёт дело целиком: на кофейне 300 000 ₽ бот думал 158 000, а
     * движок просил 315 000. При наличных 250–314 тыс. бот присылал найм,
     * движок отклонял, и useGame вместо хода слал END_TURN — ход сгорал молча.
     */
    const hireable = seat.ledger.businesses.find(
      (b) =>
        !b.gl &&
        !b.managerPct &&
        !(b.partnerId && !b.investorShare) &&
        (!предложение || подходит(b)),
    )
    if (hireable && seat.track === 'rat') {
      const pct = предложение?.pct ?? MANAGER_PCT
      const cost = Math.max(30_000, Math.round((hireable.cashFlow * pct * 3) / 100 / 1000) * 1000)
      if (seat.ledger.cash - cost >= cashBuffer(seat, p)) {
        return { type: 'HIRE_MANAGER', assetId: hireable.id, pct }
      }
    }
  }

  switch (pending.kind) {
    case 'chooseDeal': {
      /*
       * 🔴 РАНЬШЕ ЭТО БЫЛ ЖЁСТКИЙ ПОРОГ, и он выключал половину игры. Замер:
       * «средний», «сильный» и «нереальный» брали крупную колоду в 100%
       * случаев, «лёгкий» — малую в 100%. Значит бот посильнее за всю партию
       * НИ РАЗУ не видел бумаг: покупок акций ноль, продаж ноль, и 21
       * рыночная карта про котировки для него не существовала.
       *
       * Человек так не играет: он смотрит и туда, и туда. Порог остаётся
       * (без денег в крупную не лезут), но выше него выбор — монетка с
       * перекосом, и малая колода открывается регулярно.
       */
      const хватаетНаКрупную = l.cash >= inf(p.bigDealCash)
      if (!хватаетНаКрупную) return { type: 'CHOOSE_DEAL', size: 'small' }
      return { type: 'CHOOSE_DEAL', size: rnd() < ДОЛЯ_КРУПНОЙ ? 'big' : 'small' }
    }

    case 'deal': {
      const card = pending.card
      /*
       * 🔴 БОТ ПУСКАЕТ ЛЮДЕЙ В СВОЮ НАХОДКУ.
       *
       * Замер: SET_ACCESS у ботов — ноль за все прогоны. Значит найденная
       * ботом сделка закрыта наглухо: человек видит карточку, видит цифры и
       * не может ничего — вход не открыт, а открыть его может только тот,
       * кому карта выпала. За настоящим столом сосед говорит «берите, мне не
       * потянуть»; молчаливый отказ — худшее, что бот может сделать с
       * половиной находок партии.
       *
       * Открываем ОДИН РАЗ и бесплатно: торговаться бот пока не умеет, а
       * брать с людей плату, не умея объяснить за что, — хуже, чем не брать.
       */
      /*
       * 🔴 КРОМЕ ПАРТНЁРСКОГО БИЗНЕСА — его вход не открывается никому.
       * Без этой оговорки бот попадает в мёртвую петлю: он предлагает открыть
       * вход, движок такое событие для партнёрского бизнеса отклоняет,
       * состояние не меняется — и бот предлагает то же самое снова.
       */
      const партнёрский = !!(card as { greenleaf?: boolean }).greenleaf
      if (
        !партнёрский &&
        !pending.access &&
        t.seats.some((x) => !x.isBot && !x.outOfGame && x.id !== seat.id)
      ) {
        return { type: 'SET_ACCESS', access: { mode: 'open', allow: [], terms: { kind: 'free' } } }
      }
      if (card.kind === 'stock') {
        const s = card as StockCard
        const buyBelow = quantilePrice(s.range, p.stockBuyQuantile)
        /*
         * 🔴 И НА ПОКУПКЕ ТОЖЕ ЦЕНА СТОЛА, А НЕ ЦИФРА КАРТЫ. Движок списывает
         * marketStockPrice(цена карты × множитель новости), а бот считал по
         * сырой: на удвоении рынка он планировал потратить 884 000, а платил
         * 1 768 000 — вдвое больше собственного потолка, а на просадке проходил
         * мимо подешевевшей бумаги, хотя докупать надо как раз тогда.
         */
        const цена = marketStockPrice(s.price, t.market.stock[s.symbol])
        const worthIt = цена <= buyBelow || (s.dividendPerShare ?? 0) > 0
        if (!worthIt) return { type: 'PASS_CARD' }
        const spendable = Math.max(0, l.cash - cashBuffer(seat, p)) * p.stockCashFraction
        const shares = Math.floor(spendable / цена)
        if (shares < 1) return { type: 'PASS_CARD' }
        return { type: 'BUY_STOCK_SHARES', shares }
      }

      if (rnd() > p.buyDealChance) return { type: 'PASS_CARD' }
      if (p.requirePositiveFlow && card.cashFlow <= 0) return { type: 'PASS_CARD' }

      const need = card.downPayment
      /*
       * 🔴 Считаем НАСТОЯЩИЙ поток, а не цифру с карточки. Гостевой дом обещает
       * 165 000, но в рассрочку после платежа остаётся 25 700 — и бот брал под
       * него заём с платежом 163 000 в месяц, после чего разорялся за десять
       * ходов. Ровно та же ошибка, что была у окна карточки: заголовок карты
       * и то, что реально придёт на счёт, — разные числа.
       */
      const realTerms = dealTerms(card, card.kind === 'realEstate' ? 'realEstate' : 'business')
      const flowIfFinanced = realTerms.financeable ? realTerms.instFlow : realTerms.cashFlow
      if (l.cash - need < cashBuffer(seat, p)) {
        const step = RULES.currency === 'RUB' ? 10_000 : 1000
        if (p.leverage && seat.track === 'rat' && flowIfFinanced > 0) {
          const short = need + cashBuffer(seat, p) - l.cash
          const loan = Math.ceil(short / step) * step
          // Платёж по займу обязан отбиваться НАСТОЯЩИМ потоком сделки.
          if (loan > 0 && flowIfFinanced > loan / 10) return { type: 'TAKE_LOAN', amount: loan }
        }
        /*
         * 🔴 ЗДЕСЬ БОТ ТЕРЯЛ ХОДЫ. Стояла ветка «хватает на ПОЛОВИНУ взноса —
         * покупаем»: она осталась от стороннего инвестора, которого в игре
         * больше нет. Половины взноса не хватает ни на что — ни налом, ни в
         * рассрочку (рассрочка уменьшает цену, а не взнос), движок такую
         * покупку отклоняет, и живой водитель ботов молча заканчивает ход.
         * Замер: 190 потерянных ходов за 20 партий у «среднего», 132 у
         * «сильного» — то есть каждая шестая находка уходила в никуда, и
         * партия с ботом от этого выглядела безжизненной.
         *
         * Карта при этом ПОКАЗЫВАЕТСЯ: фильтр выдачи считает, что войти можно
         * вдвоём. Звать людей в долю бот пока не умеет — значит проходит мимо
         * честно, а не делает вид, что покупает.
         */
        return { type: 'PASS_CARD' }
      }

      /*
       * 🔴 Налом или в рассрочку — считаем, а не берём вслепую.
       *
       * Под длинную рассрочку платёж почти всегда БОЛЬШЕ аренды: за квартиру в
       * Азино платишь 63 500 при доходе 31 000. Раньше бот этого не видел и
       * всегда брал в рассрочку — за партию накапливал минусовой поток и уходил
       * в отрицательный капитал. Теперь: хватает на всю цену — берём налом;
       * не хватает — берём в рассрочку ТОЛЬКО если поток остаётся положительным.
       */
      const canCash = l.cash - card.cost >= cashBuffer(seat, p)
      if (canCash) return { type: 'BUY_DEAL', payCash: true }
      if (flowIfFinanced <= 0) {
        // В рассрочку объект будет съедать деньги каждый месяц — не берём.
        return { type: 'PASS_CARD' }
      }
      return { type: 'BUY_DEAL' }
    }

    case 'market': {
      const card = pending.card
      /*
       * Беда с выбором: чинить сразу или терпеть просадку. Бот чинит, когда
       * деньги есть с запасом — как поступил бы человек, у которого сейчас
       * не решается судьба партии; иначе живёт с поломкой.
       */
      if (pending.выбор === 'беда') {
        const надо = Math.abs((card as { cash?: number }).cash ?? 0)
        return l.cash >= надо * 3 ? { type: 'PAY_BIZ_TROUBLE' } : { type: 'ENDURE_BIZ_TROUBLE' }
      }
      if (card.kind === 'sellOffer') {
        const mult = inf(p.marketSellMultiple)
        /*
         * 🔴 НА ВТОРОМ КРУГЕ ПРОДАЖА ДОХОДА — САМОУБИЙСТВО, и бот этого не
         * знал. Замер: с клетками продажи на большом поле до мечты доходили 52
         * человека из 172, без них — 150 из 200. Бот распродавал то, что его
         * кормит, ради наличных, и дальше расти было нечем.
         *
         * В Круге продажа осмысленна: там копят на выход. На Полосе она
         * осмысленна ровно в одном случае — когда вырученного ХВАТИТ НА МЕЧТУ
         * прямо сейчас. Иначе актив нужнее.
         */
        const наПолосе = seat.track === 'fast'
        const ценаМечты = (() => {
          if (!наПолосе) return 0
          const кл = (fastBoard() as { type: string; price?: number }[])[seat.dreamSpace]
          return кл && кл.type === 'dream' ? (кл.price ?? 0) : 0
        })()
        for (const m of marketMatches(t, card.category)) {
          if (m.seat.id !== seat.id) continue
          for (const a of m.assets) {
            // База — та же, по которой платит стол: рыночная цена, не цена с наценкой.
            const база = a.value ?? a.cost
            const price = sellOfferPrice(база, card.multiplierPct, t.market.price[card.category] ?? 1)
            const выручка = Math.max(0, price - a.debt)
            /*
             * 🔴 НЕ ПРОДАВАЙ СЕБЯ НИЖЕ СВОБОДЫ. Первая версия правила была
             * «продаю, если хватит на мечту» — и бот всё равно проваливался:
             * до мечты доходили 82 из 189 против 150 из 200 без этих клеток.
             * Он выручал деньги, лишался дохода и не успевал доехать до своей
             * клетки. Правило, которого и в жизни надо держаться: продавать
             * можно только то, без чего доход ВСЁ РАВНО перекрывает расходы.
             */
            const свой =
              [...l.realEstate, ...l.businesses].find((x) => x.id === a.id) ?? null
            const доходАктива = свой ? ownShare(свой) : 0
            const послеПродажи = freedomIncome(l, t.market.flow) - доходАктива
            /*
             * 🔴 И ТРЕТЬЕ УСЛОВИЕ: МЕЧТА ДОЛЖНА БЫТЬ БЛИЗКО. Двух прежних не
             * хватило — бот выручал деньги заранее, лишался дохода и колесил
             * по доске без него, пока не выпадала нужная клетка. Замер держался
             * на 82 из 189 против 150 без этих клеток. Человек так не делает:
             * он продаёт, когда до мечты рукой подать.
             */
            const доМечты = (() => {
              const всего = (fastBoard() as unknown[]).length
              return (seat.dreamSpace - seat.position + всего) % всего
            })()
            const продаватьМожно = наПолосе
              ? ценаМечты > 0 &&
                l.cash + выручка >= ценаМечты &&
                послеПродажи >= totalExpenses(l) &&
                доМечты <= 8
              : price >= база * mult
            if (продаватьМожно) {
              return { type: 'ACCEPT_OFFER', seatId: seat.id, assetId: a.id }
            }
          }
        }
      }
      if (card.kind === 'stockPrice') {
        const lot = l.stocks.find((x) => x.symbol === card.symbol)
        if (lot) {
          /*
           * 🔴 ПОРОГ СЧИТАЛСЯ ОТ ДИАПАЗОНА [1, 40] — это осталось от
           * долларовой колоды. В рублёвой бумаги стоят 300–100 000 ₽, медиана
           * 16 000, поэтому условие «цена выше порога» было истинным ВСЕГДА:
           * замер — 131 возможность продать в плюс, 131 продажа. Бот сбрасывал
           * весь лот при первой же цене не ниже своей, никогда не держал до
           * роста и никогда не резал убыток. Ручка stockSellQuantile при этом
           * не влияла ни на что.
           *
           * Считаем от диапазона САМОЙ бумаги — ровно так, как это уже сделано
           * на покупке.
           */
          const вилка = вилкаЦены(t, card.symbol)
          const продаватьВыше = вилка ? quantilePrice(вилка, p.stockSellQuantile) : lot.costPerShare
          /*
           * 🔴 РЕШАЕМ ПО ТОЙ ЖЕ ЦЕНЕ, ПО КОТОРОЙ ПЛАТИТ СТОЛ. `card.price` —
           * это число, напечатанное на карточке, БЕЗ множителя мировой
           * новости; движок продаёт по stockPriceNow. Бот думал, что фиксирует
           * прибыль, а резал убыток: золото с карты 12 000 при себестоимости
           * 9 500 на обвале золота стоит 6 000 — вместо +150 000 выходит
           * −210 000. Соседняя ветка sellOffer уже считает правильно: база —
           * рыночная цена, а не цифра карты.
           */
          const цена = stockPriceNow(t, card.symbol)
          const хорошаяЦена = цена >= продаватьВыше && цена >= lot.costPerShare
          /*
           * Резать убыток — тоже человеческое решение, и без него бот выглядел
           * упрямым: держал падающую бумагу до конца партии.
           */
          const глубокийМинус = цена <= lot.costPerShare * СТОП_УБЫТОК
          if (хорошаяЦена || глубокийМинус) {
            // Продаём ЧАСТЬ на хорошей цене и всё — на стоп-убытке: так делают люди.
            const штук = глубокийМинус ? lot.shares : Math.max(1, Math.round(lot.shares * ДОЛЯ_ПРОДАЖИ))
            return {
              type: 'SELL_STOCK_LOT',
              seatId: seat.id,
              lotId: lot.id,
              shares: штук,
              pricePerShare: цена,
            }
          }
        }
      }
      return { type: 'END_TURN' }
    }

    case 'doodad': {
      const card = pending.card
      /*
       * 🔴 БОТ НИКОГДА СЕБЕ НЕ ОТКАЗЫВАЛ: замер — 260 хотелок, 260 оплат, ноль
       * отказов. Из-за этого механика выгорания (отказал себе четыре раза
       * подряд — перегорел) на ботах не срабатывала НИ РАЗУ, и человек за
       * столом не видел, чем кончаются годы «нет, потом».
       *
       * Хуже: при нехватке денег бот брал БАНКОВСКИЙ ЗАЁМ ради хотелки. Так не
       * делает никто.
       */
      if ((card as { want?: boolean }).want) {
        const свободно = l.cash - cashBuffer(seat, p)
        // Не по карману — просто проходим мимо, без всяких займов.
        if (свободно < card.amount) return { type: 'SKIP_WANT' }
        // По карману — но иногда всё равно откажем: у каждого свой характер.
        if (rnd() < (p.skipWantChance ?? 0)) return { type: 'SKIP_WANT' }
      }
      if (l.cash >= card.amount) return { type: 'PAY_DOODAD', financed: false }
      if (card.financeable) return { type: 'PAY_DOODAD', financed: true }
      /*
       * 🔴 ОБЯЗАТЕЛЬНУЮ трату закрыть НЕЧЕМ, кроме займа, и это не прихоть
       * бота, а устройство классической колоды: «пройти мимо» там нет, в
       * рассрочку такая карта не берётся, а `financed:false` без денег движок
       * отклоняет. Убрав отсюда заём заодно с хотелками, я подвесил стол:
       * прогон дал 3 зависших партии в «классике» и 7 в «оффшоре» при нуле в
       * русской колоде — там займов нет и карты все финансируемые.
       *
       * Хотелки сюда уже не доходят: они отсеяны выше и уходят в SKIP_WANT.
       */
      const шаг = RULES.currency === 'RUB' ? 10_000 : 1000
      const заём = Math.ceil((card.amount - l.cash) / шаг) * шаг
      if (RULES.loansEnabled && seat.track === 'rat' && заём > 0) {
        return { type: 'TAKE_LOAN', amount: заём }
      }
      return { type: 'PAY_DOODAD', financed: !RULES.loansEnabled }
    }

    case 'charity': {
      const cost = charityCost(l)
      const want =
        p.charity === 'always'
          ? true
          : p.charity === 'rich'
            ? l.cash > cost * 4
            : p.charity === 'sometimes'
              ? l.cash > cost * 8 && rnd() < 0.5
              : false
      if (want && l.cash >= cost) return { type: 'ACCEPT_CHARITY' }
      return { type: 'DECLINE_CHARITY' }
    }

    case 'downsized':
      return { type: 'PAY_DOWNSIZED' }

    case 'ftWant': {
      /*
       * Желание на большом круге. Берём, только если после покупки остаётся
       * запас: главная цель там — мечта, и спускать на машину деньги, которых
       * не хватит на неё, бот не должен. Человек, конечно, волен наоборот.
       */
      const желание = pending as { amount: number }
      const запас = seat.ledger.cash - желание.amount
      return { type: запас > желание.amount * 2 ? 'BUY_FT_WANT' : 'SKIP_FT_WANT' }
    }

    // Бот на зарплате просто закрывает окно: деньги уже начислены.
    case 'payday':
    // Поздравление с выходом из Круга — тоже просто закрыть.
    case 'freedom':
    // Событие Полосы (проверка, иск, развод, просадка) — деньги уже списаны.

    case 'ftEvent': {
      /*
       * 🔴 БЕДА С ВЫБОРОМ ЖДЁТ РЕШЕНИЯ, А НЕ «ПОНЯТНО». Без этой ветки бот
       * слал PASS_CARD, движок его отклонял, и стол вставал намертво — ровно
       * та поломка, из-за которой партия умирала 31 августа.
       *
       * Решает как человек: платит, если после расчёта остаётся хотя бы
       * три месяца расходов; иначе тянет и живёт с просадкой.
       */
      const беда = pending as { выбор?: { сумма: number } }
      if (беда.выбор) {
        const запас = seat.ledger.cash - беда.выбор.сумма
        const тянуть = запас < totalExpenses(seat.ledger) * 3
        return { type: тянуть ? 'ENDURE_FT_TROUBLE' : 'PAY_FT_TROUBLE' }
      }
      return { type: 'PASS_CARD' }
    }

    case 'ftBusiness': {
      const space = fastBoard()[pending.space]
      if (space.type !== 'business') return { type: 'END_TURN' }
      /*
       * 🔴 БОТ ЦЕЛИТСЯ В ПОБЕДУ, А НЕ В ДОХОД. Победа на втором круге одна —
       * купить свою мечту, и она покупается НАЛИЧНЫМИ. Бот же скупал дела
       * большого поля при первой возможности и спускал на них всё, что успел
       * накопить: замер показал, что до мечты он идёт двести с лишним ходов,
       * хотя весь первый круг занимает сто сорок.
       *
       * Правило простое и человеческое: пока до мечты далеко — вкладывайся,
       * дело приблизит её быстрее, чем накопления. Как накопил половину —
       * больше не трогай кубышку.
       */
      const мечта = dreamPriceAt(t, seat.dreamSpace)
      const хватитПотом = l.cash - space.downPayment
      if (мечта > 0 && l.cash >= мечта * 0.5 && хватитПотом < мечта) return { type: 'PASS_CARD' }
      if (l.cash >= space.downPayment * p.laneBuyCashMultiple) return { type: 'BUY_FT_BUSINESS' }
      return { type: 'PASS_CARD' }
    }

    case 'ftVenture': {
      // Исход уже на столе — закрываем карточку, а не бросаем второй раз.
      if (pending.rolled != null) return { type: 'PASS_CARD' }
      const space = fastBoard()[pending.space]
      if (space.type !== 'venture') return { type: 'END_TURN' }
      if (p.ventureCashFraction <= 0) return { type: 'PASS_CARD' }
      if (l.cash * p.ventureCashFraction >= space.downPayment) {
        return { type: 'TRY_VENTURE', die: 1 + Math.floor(rnd() * 6) }
      }
      return { type: 'PASS_CARD' }
    }

    case 'ftDream': {
      const price = dreamPriceAt(t, pending.space)
      /*
       * 🔴 СНАЧАЛА РАССЧИТАТЬСЯ С ЛЮДЬМИ. Победа с непогашенным долгом перед
       * игроком не засчитывается — иначе выигрышной стратегией стало бы
       * «занять у всех и уйти». Человеку об этом говорит сама карточка и
       * даёт кнопку; бот же молча жал «купить», получал отказ движка и
       * заканчивал ход — и так до конца партии.
       */
      const долг = t.loans.find(
        (ln) => ln.borrowerId === seat.id && loanOwed(ln) - ln.repaid > 0,
      )
      if (долг) {
        const надо = loanOwed(долг) - долг.repaid
        if (l.cash >= надо + price) {
          return { type: 'REPAY_PLAYER_LOAN', loanId: долг.id, amount: надо }
        }
        return { type: 'PASS_CARD' }
      }
      if (l.cash >= price) return { type: 'BUY_DREAM' }
      return { type: 'PASS_CARD' }
    }

    case 'ftCharity': {
      const cost = ftCharityCost(l)
      if (p.charity !== 'never' && l.cash > cost * 3) return { type: 'ACCEPT_FT_CHARITY' }
      return { type: 'PASS_CARD' }
    }

    case 'gameOver':
      return null
  }

  return { type: 'END_TURN' }
}
