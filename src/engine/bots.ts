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
} from './table'
import {
  RULES,
  isOutOfRatRace,
  monthlyCashFlow,
  totalExpenses,
} from './ledger'
import { fastBoard } from './data'

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
  charity: 'never' | 'sometimes' | 'rich' | 'always'
  ventureCashFraction: number
  laneBuyCashMultiple: number
  repayIdle: boolean
}

export const BOT_PROFILES = botProfilesJson as unknown as Record<BotDifficulty, BotProfile>

const inf = (v: number | null) => (v === null ? Infinity : v)

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
  if (t.phase === 'awaitingRoll' && seat.track === 'rat' && isOutOfRatRace(l)) {
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
      if (p.repayIdle && l.liabilities.bankLoan >= 1000 && l.cash >= 1000 + cashBuffer(seat, p)) {
        return { type: 'REPAY_LOAN', amount: 1000 }
      }
      return { type: 'END_TURN' }
    }
    return null
  }

  switch (pending.kind) {
    case 'chooseDeal': {
      const canBig = l.cash >= inf(p.bigDealCash)
      return { type: 'CHOOSE_DEAL', size: canBig ? 'big' : 'small' }
    }

    case 'deal': {
      const card = pending.card
      if (card.kind === 'stock') {
        const s = card as StockCard
        const buyBelow = quantilePrice(s.range, p.stockBuyQuantile)
        const worthIt = s.price <= buyBelow || (s.dividendPerShare ?? 0) > 0
        if (!worthIt) return { type: 'PASS_CARD' }
        const spendable = Math.max(0, l.cash - cashBuffer(seat, p)) * p.stockCashFraction
        const shares = Math.floor(spendable / s.price)
        if (shares < 1) return { type: 'PASS_CARD' }
        return { type: 'BUY_STOCK_SHARES', shares }
      }

      if (rnd() > p.buyDealChance) return { type: 'PASS_CARD' }
      if (p.requirePositiveFlow && card.cashFlow <= 0) return { type: 'PASS_CARD' }

      const need = card.downPayment
      if (l.cash - need < cashBuffer(seat, p)) {
        if (RULES.loansEnabled) {
          // Плечо: добираем кредитом, если профиль это позволяет.
          if (p.leverage && seat.track === 'rat' && card.cashFlow > 0) {
            const short = need + cashBuffer(seat, p) - l.cash
            const loan = Math.ceil(short / 1000) * 1000
            // Кредит стоит 10% в месяц — берём, только если сделка это отбивает.
            if (loan > 0 && card.cashFlow > loan / 10) return { type: 'TAKE_LOAN', amount: loan }
          }
        } else if (p.leverage && card.kind === 'realEstate' && card.cashFlow > 0 && l.cash < need) {
          // Халяль-режим: агрессивные боты зовут инвестора на крупную недвижимость.
          return { type: 'BUY_DEAL', withInvestor: true }
        }
        return { type: 'PASS_CARD' }
      }
      return { type: 'BUY_DEAL' }
    }

    case 'market': {
      const card = pending.card
      if (card.kind === 'sellOffer') {
        const mult = inf(p.marketSellMultiple)
        for (const m of marketMatches(t, card.category)) {
          if (m.seat.id !== seat.id) continue
          for (const a of m.assets) {
            const price = sellOfferPrice(a.cost, card.multiplierPct)
            if (price >= a.cost * mult) {
              return { type: 'ACCEPT_OFFER', seatId: seat.id, assetId: a.id }
            }
          }
        }
      }
      if (card.kind === 'stockPrice') {
        const sellAbove = quantilePrice(
          [1, 40],
          p.stockSellQuantile,
        )
        const lot = l.stocks.find((x) => x.symbol === card.symbol)
        if (lot && card.price >= lot.costPerShare && card.price >= sellAbove) {
          return {
            type: 'SELL_STOCK_LOT',
            seatId: seat.id,
            lotId: lot.id,
            shares: lot.shares,
            pricePerShare: card.price,
          }
        }
      }
      return { type: 'END_TURN' }
    }

    case 'doodad': {
      const card = pending.card
      if (l.cash >= card.amount) return { type: 'PAY_DOODAD', financed: false }
      if (card.financeable || !RULES.loansEnabled) return { type: 'PAY_DOODAD', financed: true }
      const loan = Math.ceil((card.amount - l.cash) / 1000) * 1000
      if (seat.track === 'rat' && loan > 0) return { type: 'TAKE_LOAN', amount: loan }
      return { type: 'PAY_DOODAD', financed: false }
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

    case 'downsized': {
      const cost = totalExpenses(l)
      if (l.cash < cost && RULES.loansEnabled) {
        const loan = Math.ceil((cost - l.cash) / 1000) * 1000
        return { type: 'TAKE_LOAN', amount: loan }
      }
      return { type: 'PAY_DOWNSIZED' }
    }

    case 'ftBusiness': {
      const space = fastBoard()[pending.space]
      if (space.type !== 'business') return { type: 'END_TURN' }
      if (l.cash >= space.downPayment * p.laneBuyCashMultiple) return { type: 'BUY_FT_BUSINESS' }
      return { type: 'PASS_CARD' }
    }

    case 'ftVenture': {
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
