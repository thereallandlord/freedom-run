/**
 * Сделки между игроками: перепродажа найденной сделки, партнёрство долями,
 * беспроцентный заём и прямая продажа актива.
 *
 * 🔴 Правила взяты из спецификации в vault и выверены по исследованию фикха:
 *   — продаётся ПРАВО на сделку (посредничество), а не сама вещь, которой ещё нет;
 *   — в партнёрстве прибыль по договорённости, а УБЫТОК строго по долям капитала;
 *   — заём между игроками только беспроцентный, возврат ровно той же суммой.
 */
import type { Ledger, Seat, Table } from './types'

export type OfferKind =
  /** Перепродать вытянутую карточку сделки другому игроку. */
  | 'resellCard'
  /** Позвать соинвестора в свою покупку. */
  | 'coInvest'
  /** Продать уже купленный актив напрямую другому игроку. */
  | 'sellAsset'
  /** Беспроцентный заём. */
  | 'loan'

export interface Offer {
  id: string
  kind: OfferKind
  fromId: string
  /** Пусто — предложение всем; иначе адресное. */
  toId?: string
  /**
   * Кто предложение СОЗДАЛ. Отвечает всегда другая сторона.
   *
   * 🔴 Без этого поля движок не мог отличить «я предлагаю тебе денег» от
   * «я прошу у тебя денег»: у обоих кредитор записан в fromId, а должник в
   * toId. Из-за этого кнопку «Дать» видел ЗАЁМЩИК, кредитор нажать не мог, и
   * человек в живой партии дал деньги сам себе.
   */
  askedBy?: string
  /** Цена/сумма, которую называет инициатор. */
  amount: number
  /** Для coInvest — какую долю отдают партнёру, 0..1. */
  share?: number
  /** Для sellAsset — что продаём. */
  assetId?: string
  /**
   * Для loan — надбавка сверху, если дают НЕ беспроцентно.
   * 🔴 Такой заём кладёт долговую нагрузку на ОБОИХ участников.
   */
  interestPct?: number
  /** Ход, на котором предложение сгорит. */
  expiresAtTurn: number
  /** Кто уже согласился (для мини-аукциона). */
  bids: { seatId: string; amount: number }[]
}

/** Беспроцентный заём между игроками. Возврат ровно тем же. */
export interface PlayerLoan {
  id: string
  lenderId: string
  borrowerId: string
  amount: number
  repaid: number
  atTurn: number
  /**
   * Надбавка сверху, если дали НЕ беспроцентно.
   * 🔴 Пока такой долг открыт, неприятности чаще приходят ОБОИМ — и тому, кто
   * взял, и тому, кто дал. Риба портит сделку с двух сторон, а не с одной.
   */
  interestPct?: number
}

// ─── Коридор честной цены: защита от «продам другу за рубль» ──────────

/**
 * Сговор ловится не запретом, а коридором: цена сделки между игроками
 * должна лежать в разумных границах вокруг её настоящей стоимости.
 */
/*
 * 🔴 Нижняя граница была ПОЛОВИНОЙ справедливой цены: за право на сделку с
 * взносом 2 000 000 нельзя было попросить меньше миллиона. Камиль: «я хочу
 * сам назначать цену, а миллион за карточку — неадекватно». Коридор нужен
 * только чтобы ловить «продам другу за рубль», поэтому опускаем пол до
 * десятой части: назвать можно почти любую цену, а подарок за копейку
 * по-прежнему не пройдёт.
 */
export const PRICE_FLOOR = 0.1
export const PRICE_CEIL = 2.0

export function priceAllowed(asked: number, fair: number): boolean {
  if (fair <= 0) return asked >= 0
  const k = asked / fair
  return k >= PRICE_FLOOR && k <= PRICE_CEIL
}

export function clampPrice(asked: number, fair: number): number {
  if (fair <= 0) return Math.max(0, asked)
  return Math.min(Math.max(asked, Math.round(fair * PRICE_FLOOR)), Math.round(fair * PRICE_CEIL))
}

/** Справедливая цена права на сделку — это её первый взнос. */
export function fairCardPrice(downPayment: number): number {
  return downPayment
}

/** Справедливая цена уже купленного актива — вложенные деньги за вычетом долга. */
export function fairAssetPrice(cost: number, debt: number): number {
  return Math.max(0, cost - debt)
}

// ─── Партнёрство ──────────────────────────────────────────────────────

/**
 * Доли считаются строго по внесённым деньгам. Это и есть требование,
 * без которого партнёрство превращается в заём под процент.
 */
export function shareOf(myMoney: number, totalMoney: number): number {
  if (totalMoney <= 0) return 0
  return myMoney / totalMoney
}

/**
 * Убыток делится по долям капитала — всегда, без исключений.
 * Прибыль может делиться иначе, если так договорились.
 */
export function splitProceeds(
  net: number,
  myShare: number,
  agreedProfitShare?: number,
): { mine: number; partner: number } {
  const share = net >= 0 ? (agreedProfitShare ?? myShare) : myShare
  const mine = Math.round(net * share)
  return { mine, partner: net - mine }
}

// ─── Заём ─────────────────────────────────────────────────────────────

/**
 * Сколько заёмщик обязан вернуть ВСЕГО, с надбавкой.
 * 🔴 Одна функция на движок и на интерфейс: раньше окно обещало вернуть
 * 250 000, а движок закрывал долг за 200 000 — надбавку просто не сохраняли.
 */
export function loanOwed(l: PlayerLoan): number {
  return Math.round((l.amount * (100 + (l.interestPct ?? 0))) / 100)
}

export function loanOutstanding(loans: PlayerLoan[], seatId: string): number {
  return loans
    .filter((l) => l.borrowerId === seatId)
    .reduce((s, l) => s + Math.max(0, l.amount - l.repaid), 0)
}

/**
 * 🔴 Долг перед другим игроком не даёт победить: нельзя купить мечту,
 * пока не рассчитался. Иначе выигрышная стратегия — занять у всех и уйти.
 */
export function canWinWithLoans(loans: PlayerLoan[], seatId: string): boolean {
  return loanOutstanding(loans, seatId) === 0
}

// ─── Боты ─────────────────────────────────────────────────────────────

/** Согласится ли бот на предложение. Осторожно и по цифрам, без эмоций. */
export function botAcceptsOffer(
  offer: Offer,
  bot: Seat,
  fair: number,
  monthlyGain: number,
): boolean {
  const l: Ledger = bot.ledger
  if (l.cash < offer.amount) return false
  switch (offer.kind) {
    case 'resellCard':
    case 'sellAsset':
      // Берём, если не переплачиваем и сделка окупается меньше чем за 40 месяцев.
      return offer.amount <= fair * 1.15 && monthlyGain > 0 && offer.amount / monthlyGain < 40
    case 'coInvest':
      // Входим долей, только если доля соразмерна деньгам.
      return (offer.share ?? 0) >= shareOf(offer.amount, fair) * 0.9 && monthlyGain > 0
    case 'loan':
      // Даём в долг только явный излишек и только заметно богаче должника.
      return l.cash > offer.amount * 4
    default:
      return false
  }
}

/** Живо ли предложение на текущем ходу. */
export function offerAlive(o: Offer, t: Table): boolean {
  return t.turnCounter <= o.expiresAtTurn
}

/** Победитель мини-аукциона: наибольшая ставка, при равенстве — кто раньше. */
export function auctionWinner(o: Offer): { seatId: string; amount: number } | null {
  if (!o.bids.length) return null
  return [...o.bids].sort((a, b) => b.amount - a.amount)[0]
}
