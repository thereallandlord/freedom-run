import type {
  BotDifficulty,
  DealCard,
  DoodadCard,
  Ledger,
  MarketCard,
  Pending,
  Seat,
  StockCard,
  Table,
  TablePhase,
} from './types'
import type { LedgerEvent, TableEvent } from './events'
import { applyEvent } from './applyEvent'
import {
  FAST_TRACK_WIN_TARGET,
  createLedger,
  fastTrackIncome,
  fastTrackProgress,
  isOutOfRatRace,
  monthlyCashFlow,
  passiveIncome,
  totalExpenses,
  totalIncome,
} from './ledger'
import {
  DOODADS,
  FAST_BOARD,
  FAST_BOARD_SIZE,
  PROFESSIONS,
  RAT_BOARD,
  RAT_BOARD_SIZE,
  TOKEN_COLORS,
  bigDeals,
  marketCards,
  smallDeals,
  localizedCardTitle,
  localizedSpaceName,
  type DeckTheme,
} from './data'
import { shuffleIndices } from './rng'

export interface SeatSetup {
  name: string
  professionId: string
  dreamSpace: number
  isBot: boolean
  botDifficulty: BotDifficulty
}

export interface TableSetup {
  seed: number
  deckTheme: DeckTheme
  seats: SeatSetup[]
}

// ─── Создание стола ───────────────────────────────────────────────────

export function createTable(setup: TableSetup): Table {
  const theme = setup.deckTheme
  const seats: Seat[] = setup.seats.map((s, i) => {
    const profession = PROFESSIONS.find((p) => p.id === s.professionId) ?? PROFESSIONS[0]
    return {
      id: `seat-${i}`,
      name: s.name,
      color: TOKEN_COLORS[i % TOKEN_COLORS.length],
      track: 'rat',
      position: 0,
      ledger: createLedger(profession, s.name),
      dreamSpace: s.dreamSpace,
      skipTurns: 0,
      outOfGame: false,
      isBot: s.isBot,
      botDifficulty: s.botDifficulty,
      ftCharity: false,
    }
  })

  return {
    seed: setup.seed,
    rngCursor: 0,
    deckTheme: theme,
    seats,
    turnIndex: 0,
    phase: 'awaitingRoll',
    pending: null,
    decks: {
      small: { order: shuffleIndices(smallDeals(theme).length, setup.seed + 1), next: 0 },
      big: { order: shuffleIndices(bigDeals(theme).length, setup.seed + 2), next: 0 },
      market: { order: shuffleIndices(marketCards(theme).length, setup.seed + 3), next: 0 },
      doodad: { order: shuffleIndices(DOODADS.length, setup.seed + 4), next: 0 },
    },
    lastRoll: null,
    dreamBumps: {},
    ftOwnership: {},
    log: [],
    winnerId: null,
    turnCounter: 0,
  }
}

// ─── Вспомогательные ──────────────────────────────────────────────────

export function currentSeat(t: Table): Seat {
  return t.seats[t.turnIndex]
}

function cloneTable(t: Table): Table {
  return {
    ...t,
    seats: t.seats.map((s) => ({ ...s })),
    decks: {
      small: { ...t.decks.small },
      big: { ...t.decks.big },
      market: { ...t.decks.market },
      doodad: { ...t.decks.doodad },
    },
    dreamBumps: { ...t.dreamBumps },
    ftOwnership: { ...t.ftOwnership },
    log: [...t.log],
    pending: t.pending ? ({ ...t.pending } as Pending) : null,
    lastRoll: t.lastRoll ? [...t.lastRoll] : null,
  }
}

function log(t: Table, seatId: string | null, text: string) {
  t.log.push({ at: t.log.length, seatId, text })
  if (t.log.length > 300) t.log.shift()
}

function money(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US')
  return n < 0 ? `−$${s}` : `$${s}`
}

/** Взять следующую карту колоды, перетасовав её при исчерпании. */
function draw(t: Table, deck: 'small' | 'big' | 'market' | 'doodad', size: number): number {
  const d = t.decks[deck]
  if (d.next >= d.order.length) {
    d.order = shuffleIndices(size, t.seed + t.log.length + deck.length * 7919)
    d.next = 0
  }
  const idx = d.order[d.next]
  d.next += 1
  return idx
}

function seatLedgerEvent(t: Table, seatId: string, e: LedgerEvent) {
  const i = t.seats.findIndex((s) => s.id === seatId)
  if (i < 0) return
  t.seats[i] = { ...t.seats[i], ledger: applyEvent(t.seats[i].ledger, e) }
  if (t.seats[i].ledger.phase === 'won') {
    t.winnerId = t.seats[i].id
    t.phase = 'finished'
    t.pending = { kind: 'gameOver' }
  }
}

export function dealCardAt(t: Table, deck: 'small' | 'big', index: number): DealCard {
  const list = deck === 'small' ? smallDeals(t.deckTheme) : bigDeals(t.deckTheme)
  return list[index]
}

export function diceCountFor(seat: Seat): number[] {
  if (seat.track === 'fast') return seat.ftCharity ? [3] : [2]
  return seat.ledger.charityTurnsLeft > 0 ? [1, 2] : [1]
}

/** Игроки Круга, у которых есть актив нужной категории — им адресовано предложение. */
export function marketMatches(
  t: Table,
  category: string,
): { seat: Seat; assets: { id: string; name: string; kind: 'realEstate' | 'business'; cost: number; debt: number }[] }[] {
  const out: ReturnType<typeof marketMatches> = []
  for (const seat of t.seats) {
    if (seat.outOfGame || seat.track === 'fast') continue
    const assets = [
      ...seat.ledger.realEstate
        .filter((a) => a.category === category)
        .map((a) => ({ id: a.id, name: a.name, kind: 'realEstate' as const, cost: a.cost, debt: a.mortgage })),
      ...seat.ledger.businesses
        .filter((a) => a.category === category)
        .map((a) => ({ id: a.id, name: a.name, kind: 'business' as const, cost: a.cost, debt: a.liability })),
    ]
    if (assets.length) out.push({ seat, assets })
  }
  return out
}

export function stockHolders(t: Table, symbol: string): Seat[] {
  return t.seats.filter(
    (s) => !s.outOfGame && s.track === 'rat' && s.ledger.stocks.some((l) => l.symbol === symbol),
  )
}

export function sellOfferPrice(cost: number, multiplierPct: number): number {
  return Math.round((cost * multiplierPct) / 100)
}

export function dreamPriceAt(t: Table, spaceIndex: number): number {
  const s = FAST_BOARD[spaceIndex]
  if (s.type !== 'dream') return 0
  return s.price * (1 + (t.dreamBumps[spaceIndex] ?? 0))
}

export function charityCost(l: Ledger): number {
  return Math.ceil(0.1 * totalIncome(l))
}

export function ftCharityCost(l: Ledger): number {
  return Math.ceil(0.1 * fastTrackIncome(l))
}

export function canRecover(l: Ledger): boolean {
  return l.cash >= 0 && monthlyCashFlow(l) >= 0
}

export function hasSellableAssets(l: Ledger): boolean {
  return l.stocks.length > 0 || l.realEstate.length > 0 || l.businesses.length > 0
}

export function hasConsumerDebt(l: Ledger): boolean {
  return l.liabilities.carLoans > 0 || l.liabilities.creditCards > 0 || l.liabilities.retailDebt > 0
}

// ─── Движение и клетки ────────────────────────────────────────────────

function advance(t: Table, seatIdx: number, steps: number) {
  const seat = t.seats[seatIdx]
  const size = seat.track === 'rat' ? RAT_BOARD_SIZE : FAST_BOARD_SIZE
  let payouts = 0
  for (let i = 1; i <= steps; i++) {
    const pos = (seat.position + i) % size
    const isPayday =
      seat.track === 'rat' ? RAT_BOARD[pos] === 'paycheck' : FAST_BOARD[pos].type === 'cashflowDay'
    if (isPayday) payouts++
  }
  t.seats[seatIdx] = { ...seat, position: (seat.position + steps) % size }

  for (let i = 0; i < payouts; i++) {
    if (seat.track === 'rat') {
      seatLedgerEvent(t, seat.id, { type: 'PAYCHECK' })
    } else {
      seatLedgerEvent(t, seat.id, { type: 'CASHFLOW_DAY' })
    }
  }
  if (payouts > 0) {
    const l = t.seats[seatIdx].ledger
    const amount = seat.track === 'rat' ? monthlyCashFlow(l) : fastTrackIncome(l)
    log(t, seat.id, `Зарплата ×${payouts}: ${money(amount)}`)
  }
}

function resolveLanding(t: Table, seatIdx: number) {
  const seat = t.seats[seatIdx]
  const l = seat.ledger

  // Отрицательный чек, который нечем закрыть, — это банкротство.
  if (l.cash < 0) {
    t.pending = { kind: 'bankruptcy' }
    t.phase = 'resolving'
    log(t, seat.id, 'Наличных не хватило — банкротство')
    return
  }

  if (seat.track === 'rat') {
    const space = RAT_BOARD[seat.position]
    switch (space) {
      case 'opportunity':
        t.pending = { kind: 'chooseDeal' }
        t.phase = 'resolving'
        return
      case 'market': {
        const idx = draw(t, 'market', marketCards(t.deckTheme).length)
        const card = marketCards(t.deckTheme)[idx]
        applyMarketAuto(t, card)
        if (card.kind === 'windfall' || card.kind === 'stockSplit') {
          t.pending = { kind: 'market', card }
          t.phase = 'resolving'
        } else {
          t.pending = { kind: 'market', card }
          t.phase = 'resolving'
        }
        return
      }
      case 'doodad': {
        const idx = draw(t, 'doodad', DOODADS.length)
        t.pending = { kind: 'doodad', card: DOODADS[idx] }
        t.phase = 'resolving'
        return
      }
      case 'charity':
        t.pending = { kind: 'charity' }
        t.phase = 'resolving'
        return
      case 'baby': {
        seatLedgerEvent(t, seat.id, { type: 'PET' })
        const pets = t.seats[seatIdx].ledger.pets
        log(t, seat.id, `В доме появился питомец (всего ${pets})`)
        t.phase = 'turnEnd'
        return
      }
      case 'downsized':
        t.pending = { kind: 'downsized' }
        t.phase = 'resolving'
        return
      case 'paycheck':
        t.phase = 'turnEnd'
        return
    }
  }

  // ─── Полоса свободы ───
  const space = FAST_BOARD[seat.position]
  switch (space.type) {
    case 'cashflowDay':
      t.phase = 'turnEnd'
      return
    case 'taxAudit':
    case 'lawsuit': {
      const before = l.cash
      seatLedgerEvent(t, seat.id, { type: space.type === 'taxAudit' ? 'TAX_AUDIT' : 'LAWSUIT' })
      const lost = before - t.seats[seatIdx].ledger.cash
      log(t, seat.id, `${space.type === 'taxAudit' ? 'Налоговая проверка' : 'Иск'}: минус ${money(lost)}`)
      t.phase = 'turnEnd'
      return
    }
    case 'divorce':
      seatLedgerEvent(t, seat.id, { type: 'DIVORCE' })
      log(t, seat.id, 'Развод: наличные обнулены')
      t.phase = 'turnEnd'
      return
    case 'downsized': {
      const amount = fastTrackIncome(l)
      seatLedgerEvent(t, seat.id, { type: 'FT_DOWNSIZED', amount })
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 2 }
      log(t, seat.id, `Сокращение: минус ${money(amount)}, пропуск 2 ходов`)
      t.phase = 'turnEnd'
      return
    }
    case 'charity':
      if (seat.ftCharity) {
        t.phase = 'turnEnd'
        return
      }
      t.pending = { kind: 'ftCharity' }
      t.phase = 'resolving'
      return
    case 'business':
      if (t.ftOwnership[seat.position]) {
        log(t, seat.id, 'Инвестиция уже выкуплена другим игроком')
        t.phase = 'turnEnd'
        return
      }
      t.pending = { kind: 'ftBusiness', space: seat.position }
      t.phase = 'resolving'
      return
    case 'venture':
      if (t.ftOwnership[seat.position]) {
        log(t, seat.id, 'Проект уже забрали')
        t.phase = 'turnEnd'
        return
      }
      t.pending = { kind: 'ftVenture', space: seat.position }
      t.phase = 'resolving'
      return
    case 'dream': {
      if (seat.dreamSpace === seat.position) {
        t.pending = { kind: 'ftDream', space: seat.position }
        t.phase = 'resolving'
        return
      }
      // Чужая мечта дорожает на 100% от базовой цены.
      t.dreamBumps[seat.position] = (t.dreamBumps[seat.position] ?? 0) + 1
      log(t, seat.id, `Чужая мечта «${localizedSpaceName(seat.position)}» подорожала`)
      t.phase = 'turnEnd'
      return
    }
  }
}

/** Сплиты и разовые выплаты применяются сразу ко всем — решать нечего. */
function applyMarketAuto(t: Table, card: MarketCard) {
  if (card.kind === 'stockSplit') {
    for (const s of t.seats) {
      if (s.outOfGame || s.track === 'fast') continue
      seatLedgerEvent(t, s.id, { type: 'STOCK_SPLIT', symbol: card.symbol, direction: card.direction })
    }
    log(t, null, `${card.symbol}: ${card.direction === 'split' ? 'сплит ×2' : 'обратный сплит ÷2'}`)
  } else if (card.kind === 'windfall') {
    for (const s of t.seats) {
      if (s.outOfGame || s.track === 'fast') continue
      let amount = card.flatAmount ?? 0
      if (card.amountPerRealEstate) amount += card.amountPerRealEstate * s.ledger.realEstate.length
      if (amount > 0) seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount })
    }
    log(t, null, `Разовая выплата: ${card.title}`)
  }
}

// ─── Переход хода ─────────────────────────────────────────────────────

function nextTurn(t: Table) {
  const alive = t.seats.filter((s) => !s.outOfGame)
  if (alive.length === 0) {
    t.phase = 'finished'
    t.pending = { kind: 'gameOver' }
    return
  }
  if (alive.length === 1 && t.seats.length > 1) {
    t.winnerId = alive[0].id
    t.phase = 'finished'
    t.pending = { kind: 'gameOver' }
    return
  }

  let guard = 0
  let i = t.turnIndex
  while (guard++ < t.seats.length * 5) {
    i = (i + 1) % t.seats.length
    const s = t.seats[i]
    if (s.outOfGame) continue
    if (s.skipTurns > 0) {
      t.seats[i] = { ...s, skipTurns: s.skipTurns - 1 }
      const left = s.skipTurns - 1
      log(t, s.id, left > 0 ? `Пропускает ход, осталось ещё ${left}` : 'Пропускает ход — последний')
      continue
    }
    break
  }
  t.turnIndex = i
  t.turnCounter += 1
  t.phase = 'awaitingRoll'
  t.pending = null
  t.lastRoll = null
}

// ─── Главный редьюсер стола ───────────────────────────────────────────

export function applyTableEvent(prev: Table, event: TableEvent): Table {
  if (prev.phase === 'finished' && event.type !== 'END_TURN') return prev

  const t = cloneTable(prev)
  const seatIdx = t.turnIndex
  const seat = t.seats[seatIdx]
  const l = seat.ledger

  switch (event.type) {
    case 'ROLL': {
      if (t.phase !== 'awaitingRoll') return prev
      const allowed = diceCountFor(seat)
      if (!allowed.includes(event.dice.length)) return prev
      if (event.dice.some((d) => d < 1 || d > 6 || !Number.isInteger(d))) return prev

      t.lastRoll = event.dice
      if (l.charityTurnsLeft > 0) seatLedgerEvent(t, seat.id, { type: 'CHARITY_TURN_USED' })

      const steps = event.dice.reduce((a, b) => a + b, 0)
      log(t, seat.id, `Бросок: ${event.dice.join(' + ')} = ${steps}`)
      advance(t, seatIdx, steps)
      if ((t.phase as TablePhase) !== 'finished') resolveLanding(t, seatIdx)
      return t
    }

    case 'CHOOSE_DEAL': {
      if (t.pending?.kind !== 'chooseDeal') return prev
      const list = event.size === 'small' ? smallDeals(t.deckTheme) : bigDeals(t.deckTheme)
      const idx = draw(t, event.size, list.length)
      t.pending = { kind: 'deal', deck: event.size, card: list[idx] }
      return t
    }

    case 'BUY_DEAL': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card
      if (card.kind === 'stock') return prev
      if (l.cash < card.downPayment) return prev

      if (card.kind === 'realEstate') {
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_REAL_ESTATE',
          id: `${card.id}-${t.log.length}`,
          name: localizedCardTitle(card),
          cost: card.cost,
          downPayment: card.downPayment,
          mortgage: card.mortgage,
          cashFlow: card.cashFlow,
          category: card.category,
        })
      } else {
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_BUSINESS',
          id: `${card.id}-${t.log.length}`,
          name: localizedCardTitle(card),
          cost: card.cost,
          downPayment: card.downPayment,
          liability: card.liability,
          cashFlow: card.cashFlow,
          category: card.category,
        })
      }
      log(t, seat.id, `Купил: ${localizedCardTitle(card)} за ${money(card.downPayment)} (${money(card.cashFlow)}/мес)`)
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'BUY_STOCK_SHARES': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card as StockCard
      if (card.kind !== 'stock') return prev
      const shares = Math.floor(event.shares)
      if (shares <= 0) return prev
      const total = shares * card.price
      if (l.cash < total) return prev

      seatLedgerEvent(t, seat.id, {
        type: 'BUY_STOCK',
        id: `${card.symbol}-${t.log.length}`,
        symbol: card.symbol,
        shares,
        costPerShare: card.price,
        dividendPerShareMonthly: card.dividendPerShare ?? 0,
      })
      log(t, seat.id, `Купил ${shares} × ${card.symbol} по ${money(card.price)}`)
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    /** Продать может любой держатель, пока карта на столе. */
    case 'SELL_STOCK_LOT': {
      const holder = t.seats.find((s) => s.id === event.seatId)
      if (!holder || holder.outOfGame) return prev
      const lot = holder.ledger.stocks.find((x) => x.id === event.lotId)
      if (!lot) return prev
      seatLedgerEvent(t, event.seatId, {
        type: 'SELL_STOCK',
        lotId: event.lotId,
        shares: event.shares,
        pricePerShare: event.pricePerShare,
      })
      log(
        t,
        event.seatId,
        `${holder.name} продал ${event.shares} × ${lot.symbol} по ${money(event.pricePerShare)}`,
      )
      return t
    }

    case 'ACCEPT_OFFER': {
      if (t.pending?.kind !== 'market' || t.pending.card.kind !== 'sellOffer') return prev
      const card = t.pending.card
      const holder = t.seats.find((s) => s.id === event.seatId)
      if (!holder || holder.outOfGame || holder.track === 'fast') return prev

      const re = holder.ledger.realEstate.find((a) => a.id === event.assetId)
      const biz = holder.ledger.businesses.find((a) => a.id === event.assetId)
      const asset = re ?? biz
      if (!asset || asset.category !== card.category) return prev

      const price = sellOfferPrice(asset.cost, card.multiplierPct)
      if (re) {
        seatLedgerEvent(t, event.seatId, { type: 'SELL_REAL_ESTATE', assetId: event.assetId, salePrice: price })
      } else {
        seatLedgerEvent(t, event.seatId, { type: 'SELL_BUSINESS', assetId: event.assetId, salePrice: price })
      }
      log(t, event.seatId, `${holder.name} продал «${asset.name}» за ${money(price)} (${card.multiplierPct}%)`)
      return t
    }

    case 'PAY_DOODAD': {
      if (t.pending?.kind !== 'doodad') return prev
      const card: DoodadCard = t.pending.card
      if (event.financed) {
        if (!card.financeable) return prev
        seatLedgerEvent(t, seat.id, { type: 'FINANCE_DOODAD', amount: card.amount })
        log(t, seat.id, `«${card.title}» на кредитку: +${money(Math.ceil(0.03 * card.amount))}/мес`)
      } else {
        if (l.cash < card.amount) return prev
        seatLedgerEvent(t, seat.id, { type: 'DOODAD', amount: card.amount })
        log(t, seat.id, `Трата: ${card.title} — ${money(card.amount)}`)
      }
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'ACCEPT_CHARITY': {
      if (t.pending?.kind !== 'charity') return prev
      const cost = charityCost(l)
      if (l.cash < cost) return prev
      seatLedgerEvent(t, seat.id, { type: 'CHARITY' })
      log(t, seat.id, `Пожертвовал ${money(cost)} — 3 хода можно кидать 2 кубика`)
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'DECLINE_CHARITY': {
      if (t.pending?.kind !== 'charity') return prev
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'PAY_DOWNSIZED': {
      if (t.pending?.kind !== 'downsized') return prev
      const cost = totalExpenses(l)
      if (l.cash < cost) return prev
      seatLedgerEvent(t, seat.id, { type: 'DOWNSIZED' })
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 2 }
      log(t, seat.id, `Увольнение: заплатил ${money(cost)}, пропуск 2 ходов`)
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'TAKE_LOAN': {
      if (seat.track === 'fast') return prev
      const amount = Math.round(event.amount / 1000) * 1000
      if (amount < 1000) return prev
      seatLedgerEvent(t, seat.id, { type: 'TAKE_LOAN', amount })
      log(t, seat.id, `Взял кредит ${money(amount)} (+${money(amount / 10)}/мес)`)
      return t
    }

    case 'REPAY_LOAN': {
      const amount = Math.round(event.amount / 1000) * 1000
      if (amount < 1000 || l.cash < amount || l.liabilities.bankLoan < amount) return prev
      seatLedgerEvent(t, seat.id, { type: 'REPAY_LOAN', amount })
      log(t, seat.id, `Погасил кредит на ${money(amount)}`)
      return t
    }

    case 'PAY_OFF_DEBT': {
      const balance = l.liabilities[event.debt]
      if (balance <= 0 || l.cash < balance) return prev
      seatLedgerEvent(t, seat.id, { type: 'PAY_OFF_DEBT', debt: event.debt })
      log(t, seat.id, `Закрыл долг: ${money(balance)}`)
      return t
    }

    case 'ENTER_FAST_TRACK': {
      if (seat.track !== 'rat' || !isOutOfRatRace(l)) return prev
      const buyout = 100 * passiveIncome(l)
      seatLedgerEvent(t, seat.id, { type: 'ENTER_FAST_TRACK' })
      t.seats[seatIdx] = { ...t.seats[seatIdx], track: 'fast', position: 0 }
      log(t, seat.id, `🎉 Вырвался из Круга! Выкуп ${money(buyout)}`)
      return t
    }

    /*
     * Индекс клетки берём ДО seatLedgerEvent: покупка может привести к победе,
     * и тогда pending подменяется на gameOver, а space из него читать уже нельзя.
     */
    case 'BUY_FT_BUSINESS': {
      if (t.pending?.kind !== 'ftBusiness') return prev
      const spaceIdx = t.pending.space
      const space = FAST_BOARD[spaceIdx]
      if (space.type !== 'business') return prev
      if (l.cash < space.downPayment) return prev
      const name = localizedSpaceName(spaceIdx)
      seatLedgerEvent(t, seat.id, {
        type: 'BUY_FT_BUSINESS',
        id: `ft-${spaceIdx}`,
        name,
        downPayment: space.downPayment,
        cashFlow: space.cashFlow,
      })
      t.ftOwnership[spaceIdx] = seat.id
      log(t, seat.id, `Инвестировал в «${name}»: +${money(space.cashFlow)}/мес`)
      if ((t.phase as TablePhase) !== 'finished') {
        t.pending = null
        t.phase = 'turnEnd'
      }
      return t
    }

    case 'TRY_VENTURE': {
      if (t.pending?.kind !== 'ftVenture') return prev
      const spaceIdx = t.pending.space
      const space = FAST_BOARD[spaceIdx]
      if (space.type !== 'venture') return prev
      if (l.cash < space.downPayment) return prev
      const die = event.die
      if (!Number.isInteger(die) || die < 1 || die > 6) return prev

      if (die >= space.threshold) {
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_FT_BUSINESS',
          id: `ft-${spaceIdx}`,
          name: localizedSpaceName(spaceIdx),
          downPayment: space.downPayment,
          cashFlow: space.cashFlow,
        })
        t.ftOwnership[spaceIdx] = seat.id
        log(t, seat.id, `🎲 ${die} — проект выстрелил! +${money(space.cashFlow)}/мес`)
      } else {
        seatLedgerEvent(t, seat.id, { type: 'FT_STAKE_LOST', amount: space.downPayment })
        log(t, seat.id, `🎲 ${die} — ставка ${money(space.downPayment)} сгорела`)
      }
      if ((t.phase as TablePhase) !== 'finished') {
        t.pending = null
        t.phase = 'turnEnd'
      }
      return t
    }

    case 'BUY_DREAM': {
      if (t.pending?.kind !== 'ftDream') return prev
      const spaceIdx = t.pending.space
      const space = FAST_BOARD[spaceIdx]
      if (space.type !== 'dream') return prev
      const price = dreamPriceAt(t, spaceIdx)
      if (l.cash < price) return prev
      const name = localizedSpaceName(spaceIdx)
      seatLedgerEvent(t, seat.id, { type: 'BUY_DREAM', name, pricePaid: price })
      log(t, seat.id, `🏆 Купил мечту «${name}» за ${money(price)}`)
      return t
    }

    case 'ACCEPT_FT_CHARITY': {
      if (t.pending?.kind !== 'ftCharity') return prev
      const cost = ftCharityCost(l)
      if (l.cash < cost) return prev
      seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: -cost })
      t.seats[seatIdx] = { ...t.seats[seatIdx], ftCharity: true }
      log(t, seat.id, `Пожертвовал ${money(cost)} — теперь 3 кубика до конца игры`)
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    // ─── Банкротство ───

    case 'BANKRUPTCY_SELL': {
      if (t.pending?.kind !== 'bankruptcy') return prev
      seatLedgerEvent(t, seat.id, {
        type: 'FORCED_SALE',
        assetKind: event.assetKind,
        assetId: event.assetId,
      })
      log(t, seat.id, 'Продал актив банку за полцены')
      return t
    }

    case 'BANKRUPTCY_HALVE': {
      if (t.pending?.kind !== 'bankruptcy') return prev
      if (hasSellableAssets(l) || !hasConsumerDebt(l)) return prev
      seatLedgerEvent(t, seat.id, { type: 'HALVE_CONSUMER_DEBT' })
      log(t, seat.id, 'Потребительские долги уполовинены')
      return t
    }

    case 'BANKRUPTCY_RECOVER': {
      if (t.pending?.kind !== 'bankruptcy' || !canRecover(l)) return prev
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 3 }
      log(t, seat.id, 'Выкарабкался — пропускает 3 хода')
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'BANKRUPTCY_QUIT': {
      if (t.pending?.kind !== 'bankruptcy') return prev
      seatLedgerEvent(t, seat.id, { type: 'DECLARE_GAME_OVER' })
      t.seats[seatIdx] = { ...t.seats[seatIdx], outOfGame: true }
      log(t, seat.id, `${seat.name} банкрот и выбывает`)
      t.pending = null
      nextTurn(t)
      return t
    }

    case 'PASS_CARD': {
      if (!t.pending) return prev
      if (t.pending.kind === 'doodad' || t.pending.kind === 'bankruptcy') return prev
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'END_TURN': {
      if (t.phase === 'finished') return prev
      if (t.pending && t.pending.kind !== 'market' && t.pending.kind !== 'deal') return prev
      t.pending = null
      nextTurn(t)
      return t
    }
  }

  return prev
}

/** Пересборка партии из журнала событий — основа отката и онлайна. */
export function replayTable(setup: TableSetup, events: TableEvent[]): Table {
  let t = createTable(setup)
  for (const e of events) t = applyTableEvent(t, e)
  return t
}
