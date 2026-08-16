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
  RAT_BOARD,
  RAT_BOARD_SIZE,
  WORLD_EVENTS,
  TOKEN_COLORS,
  bigDeals,
  doodads,
  fastBoard,
  fastBoardSize,
  marketCards,
  professionsFor,
  setActiveTheme,
  setFastBoardTheme,
  smallDeals,
  localizedCardTitle,
  localizedSpaceName,
  type DeckTheme,
} from './data'
import { RULES, setRules, installmentPrice, installmentMonthly, zakatDue } from './ledger'
import { shuffleIndices } from './rng'
import {
  auctionWinner,
  clampPrice,
  fairAssetPrice,
  fairCardPrice,
  loanOutstanding,
  offerAlive,
  splitProceeds,
  type Offer,
} from './trades'

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
  // Правила режима: RU = рубли, халяль (без кредитов), реалистичный выкуп.
  setActiveTheme(theme)
  setFastBoardTheme(theme)
  if (theme === 'ru') {
    setRules({
      currency: 'RUB',
      fastTrackMultiplier: 50,
      fastTrackTarget: 1_000_000,
      loansEnabled: false,
      yieldScale: 0.3,
      zakat: { enabled: true, pct: 2.5, everyPaydays: 12 },
    })
  } else {
    setRules({
      currency: 'USD',
      fastTrackMultiplier: 100,
      fastTrackTarget: 150_000,
      loansEnabled: true,
      yieldScale: 1,
      zakat: { enabled: false, pct: 2.5, everyPaydays: 12 },
    })
  }
  const pool = professionsFor(theme)
  const seats: Seat[] = setup.seats.map((s, i) => {
    const profession = pool.find((p) => p.id === s.professionId) ?? pool[0]
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
      won: false,
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
      doodad: { order: shuffleIndices(doodads(theme).length, setup.seed + 4), next: 0 },
    },
    lastRoll: null,
    dreamBumps: {},
    ftOwnership: {},
    log: [],
    winnerId: null,
    turnCounter: 0,
    worldDeck: { order: shuffleIndices(WORLD_EVENTS.length, setup.seed + 5), next: 0 },
    market: { price: {}, flow: {}, stock: {} },
    lastWorldEvent: null,
    offers: [],
    loans: [],
  }
}

/**
 * Мировое событие. Приходит по таймеру реального времени, а не по чьему-то ходу,
 * и задевает всех сразу — так в игру попадает настоящий рынок.
 */
export function applyWorldEvent(prev: Table, index: number): Table {
  const t = cloneTable(prev)
  const ev = WORLD_EVENTS[index]
  if (!ev) return prev
  const e = ev.effect
  const mul = (pct: number) => 1 + pct / 100

  switch (e.kind) {
    case 'assetPrice':
      for (const c of e.categories) t.market.price[c] = (t.market.price[c] ?? 1) * mul(e.pct)
      break
    case 'assetFlow':
      // Доход активов меняется сразу и у всех, кто ими владеет.
      for (const c of e.categories) t.market.flow[c] = (t.market.flow[c] ?? 1) * mul(e.pct)
      t.seats = t.seats.map((s) => {
        if (s.outOfGame) return s
        const l = { ...s.ledger }
        const touch = <T extends { category: string; cashFlow: number }>(a: T): T =>
          e.categories.includes(a.category)
            ? { ...a, cashFlow: Math.round((a.cashFlow * mul(e.pct)) / 100) * 100 }
            : a
        l.realEstate = l.realEstate.map(touch)
        l.businesses = l.businesses.map(touch)
        return { ...s, ledger: l }
      })
      break
    case 'stockPrice':
      for (const sym of e.symbols) t.market.stock[sym] = (t.market.stock[sym] ?? 1) * mul(e.pct)
      break
    case 'cashAll':
      for (const s of t.seats) if (!s.outOfGame) seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount: e.amount })
      break
    case 'expenseAll':
      t.seats = t.seats.map((s) => {
        if (s.outOfGame) return s
        const x = { ...s.ledger, expenses: { ...s.ledger.expenses } }
        x.expenses.otherExpenses = Math.round((x.expenses.otherExpenses * mul(e.pct)) / 100) * 100
        return { ...s, ledger: x }
      })
      break
    case 'salaryAll':
      t.seats = t.seats.map((s) =>
        s.outOfGame ? s : { ...s, ledger: { ...s.ledger, salary: Math.round((s.ledger.salary * mul(e.pct)) / 100) * 100 } },
      )
      break
  }

  t.lastWorldEvent = { id: ev.id, at: t.log.length }
  log(t, null, `🌍 ${ev.title}`)
  return t
}

/** Взять следующее мировое событие из перетасованной колоды. */
export function nextWorldEventIndex(t: Table): number {
  const d = t.worldDeck
  if (d.next >= d.order.length) return d.order[0] ?? 0
  return d.order[d.next]
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
    worldDeck: { ...t.worldDeck },
    market: { price: { ...t.market.price }, flow: { ...t.market.flow }, stock: { ...t.market.stock } },
    offers: t.offers.map((o) => ({ ...o, bids: [...o.bids] })),
    loans: t.loans.map((l) => ({ ...l })),
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
  if (RULES.currency === 'RUB') {
    const s = Math.abs(Math.round(n)).toLocaleString('ru-RU')
    return n < 0 ? `−${s} ₽` : `${s} ₽`
  }
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
  if (t.seats[i].ledger.phase === 'won' && !t.seats[i].won) {
    t.seats[i] = { ...t.seats[i], won: true }
    t.winnerId ??= t.seats[i].id
    log(t, seatId, `🏆 ${t.seats[i].name} достиг цели!`)
    // Остальные доигрывают — как в живой игре. Финиш, когда активных не осталось.
    const active = t.seats.filter((s) => !s.outOfGame && !s.won)
    if (active.length === 0) {
      t.phase = 'finished'
      t.pending = { kind: 'gameOver' }
    }
  }
}

/** Карта сделки в масштабе режима: партнёрский бизнес не трогаем — у него своя экономика. */
function scaled(card: DealCard): DealCard {
  if (RULES.yieldScale === 1 || card.kind === 'stock') return card
  if ((card as any).category === 'partnership') return card
  return { ...card, cashFlow: Math.round((card.cashFlow * RULES.yieldScale) / 100) * 100 }
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

/**
 * Может ли кто-то, кроме ходящего, действовать по открытой карте.
 * Нужно, чтобы карту рынка показывали всем, а не только активному игроку.
 */
export function pendingInvolvesOthers(t: Table): boolean {
  const p = t.pending
  if (!p) return false
  const me = currentSeat(t).id
  if (p.kind === 'market') {
    if (p.card.kind === 'sellOffer')
      return marketMatches(t, p.card.category).some((m) => m.seat.id !== me)
    if (p.card.kind === 'stockPrice')
      return stockHolders(t, p.card.symbol).some((s) => s.id !== me)
    return false
  }
  if (p.kind === 'deal' && p.card.kind === 'stock') {
    const price = p.card.price
    return t.seats.some(
      (s) => s.id !== me && !s.outOfGame && s.track === 'rat' && s.ledger.cash >= price,
    )
  }
  return false
}

export function stockHolders(t: Table, symbol: string): Seat[] {
  return t.seats.filter(
    (s) => !s.outOfGame && s.track === 'rat' && s.ledger.stocks.some((l) => l.symbol === symbol),
  )
}

export function sellOfferPrice(cost: number, multiplierPct: number, marketMul = 1): number {
  return Math.round((cost * multiplierPct * marketMul) / 100)
}

export function dreamPriceAt(t: Table, spaceIndex: number): number {
  const s = fastBoard()[spaceIndex]
  if (s.type !== 'dream') return 0
  return s.price * (1 + (t.dreamBumps[spaceIndex] ?? 0))
}

export function charityCost(l: Ledger): number {
  return Math.ceil(0.1 * totalIncome(l))
}

export function ftCharityCost(l: Ledger): number {
  return Math.ceil(0.1 * fastTrackIncome(l))
}

/** Хватает ли игроку на сделку — наличными или через инвестора. */
export function dealAffordable(t: Table, card: import('./types').DealCard, deckSize: 'small' | 'big'): boolean {
  const l = currentSeat(t).ledger
  if (card.kind === 'stock') return l.cash >= card.price // хотя бы одна акция
  if (l.cash >= card.downPayment) return true
  // С партнёром хватит половины взноса — но не нуля.
  return (
    !RULES.loansEnabled &&
    deckSize === 'big' &&
    card.kind === 'realEstate' &&
    card.cashFlow > 0 &&
    l.cash >= Math.round(card.downPayment / 2)
  )
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
  const size = seat.track === 'rat' ? RAT_BOARD_SIZE : fastBoardSize()
  let payouts = 0
  for (let i = 1; i <= steps; i++) {
    const pos = (seat.position + i) % size
    const isPayday =
      seat.track === 'rat' ? RAT_BOARD[pos] === 'paycheck' : fastBoard()[pos].type === 'cashflowDay'
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

    // Год прошёл — время закята. Берётся с того, что лежало без дела.
    if (RULES.zakat.enabled) {
      const before = t.seats[seatIdx].ledger
      if (before.paydays > 0 && before.paydays % RULES.zakat.everyPaydays === 0) {
        const due = zakatDue(before)
        if (due > 0) {
          seatLedgerEvent(t, seat.id, { type: 'ZAKAT' })
          log(t, seat.id, `Закят за год: ${money(due)} (2,5% с накоплений, активы не в счёт)`)
        }
      }
    }
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
        const deck = marketCards(t.deckTheme)
        // Пустой рынок — сгоревший ход. Ищем карту, которая хоть кого-то касается;
        // не нашли за 4 попытки — превращаем клетку в «возможность».
        let card = null as import('./types').MarketCard | null
        for (let tries = 0; tries < 4; tries++) {
          const candidate = deck[draw(t, 'market', deck.length)]
          if (marketCardIsLive(t, candidate)) {
            card = candidate
            break
          }
        }
        if (!card) {
          log(t, seat.id, 'Рынок пуст — вместо него возможность')
          t.pending = { kind: 'chooseDeal' }
          t.phase = 'resolving'
          return
        }
        applyMarketAuto(t, card)
        t.pending = { kind: 'market', card }
        t.phase = 'resolving'
        return
      }
      case 'doodad': {
        const deck = doodads(t.deckTheme)
        const idx = draw(t, 'doodad', deck.length)
        t.pending = { kind: 'doodad', card: deck[idx] }
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
  const space = fastBoard()[seat.position]
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
    case 'divorce': {
      // Имущество супругов раздельное — делить нечего. Бьют разовые расходы:
      // махр, раздел быта, суд, переезд. Считаем от масштаба жизни игрока.
      const cost = Math.min(l.cash, Math.round((totalExpenses(l) * 4) / 1000) * 1000)
      seatLedgerEvent(t, seat.id, { type: 'DIVORCE', amount: cost })
      log(t, seat.id, `Развод: разовые расходы ${money(cost)} — махр, раздел быта, переезд`)
      t.phase = 'turnEnd'
      return
    }
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

/** Есть ли в карте рынка хоть какое-то живое действие для стола. */
function marketCardIsLive(t: Table, card: MarketCard): boolean {
  switch (card.kind) {
    case 'sellOffer':
      return marketMatches(t, card.category).length > 0
    case 'stockPrice':
      return stockHolders(t, card.symbol).length > 0
    case 'stockSplit':
      return t.seats.some(
        (s) => !s.outOfGame && s.track === 'rat' && s.ledger.stocks.some((l) => l.symbol === card.symbol.toUpperCase()),
      )
    case 'windfall':
      if (card.amountPerPartnership)
        return t.seats.some((s) => !s.outOfGame && s.ledger.businesses.some((b) => b.category === 'partnership'))
      return true
    case 'payRaise':
      return true
  }
}

/** Сплиты, выплаты и повышения применяются сразу — решать нечего. */
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
      if (card.amountPerPartnership)
        amount += card.amountPerPartnership * s.ledger.businesses.filter((b) => b.category === 'partnership').length
      if (amount > 0) {
        seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount })
        log(t, s.id, `${card.title}: +${money(amount)}`)
      }
    }
  } else if (card.kind === 'payRaise') {
    const seat = currentSeat(t)
    seatLedgerEvent(t, seat.id, { type: 'SALARY_RAISE', amount: card.amount })
    log(t, seat.id, `Повышение: зарплата +${money(card.amount)}/мес`)
  }
}

// ─── Переход хода ─────────────────────────────────────────────────────

function nextTurn(t: Table) {
  // Победители выходят из очереди — доигрывают только остальные.
  const alive = t.seats.filter((s) => !s.outOfGame && !s.won)
  if (alive.length === 0) {
    t.phase = 'finished'
    t.pending = { kind: 'gameOver' }
    return
  }
  if (alive.length === 1 && t.seats.filter((s) => !s.outOfGame).length > 1 && t.winnerId) {
    // Остался один играющий при уже известном победителе — партия окончена.
    t.phase = 'finished'
    t.pending = { kind: 'gameOver' }
    return
  }
  if (alive.length === 1 && t.seats.length > 1 && t.seats.every((s) => s.outOfGame || s.id === alive[0].id)) {
    t.winnerId ??= alive[0].id
    t.phase = 'finished'
    t.pending = { kind: 'gameOver' }
    return
  }

  let guard = 0
  let i = t.turnIndex
  while (guard++ < t.seats.length * 5) {
    i = (i + 1) % t.seats.length
    const s = t.seats[i]
    if (s.outOfGame || s.won) continue
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
      // Сделка не по карману = сгоревший ход. До 4 перетягов ищем ту, на которую
      // хватает наличных (или инвестора на крупную в халяль-режиме).
      let card = scaled(list[draw(t, event.size, list.length)])
      for (let tries = 0; tries < 4 && !dealAffordable(t, card, event.size); tries++) {
        card = scaled(list[draw(t, event.size, list.length)])
      }
      t.pending = { kind: 'deal', deck: event.size, card }
      return t
    }

    case 'BUY_DEAL': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card
      if (card.kind === 'stock') return prev

      const kind = card.kind === 'realEstate' ? 'realEstate' : 'business'
      // Партнёр входит долей: складываемся, доход и убыток делим в тех же долях.
      const withInvestor = !!event.withInvestor && !RULES.loansEnabled && card.kind !== 'business'
      const investorShare = withInvestor ? 0.5 : undefined

      /*
       * Две цены, и выбрать надо одну прямо сейчас — «решу потом» это
       * недействительная сделка («две сделки в одной»).
       *   налом       — платишь всю цену, доход весь твой, долгов нет
       *   в рассрочку — платишь взнос, остаток с наценкой ЗА ТОВАР зафиксирован
       *                 навсегда, платёж по нему съедает часть дохода
       */
      const fullPrice = card.cost
      const instTotal = installmentPrice(card.cost, kind)
      const instDebt = Math.max(0, instTotal - card.downPayment)
      const monthly = installmentMonthly(instDebt)

      const payCash = !!event.payCash
      const owed = payCash
        ? Math.round(fullPrice * (1 - (investorShare ?? 0)))
        : Math.round(card.downPayment * (1 - (investorShare ?? 0)))
      if (l.cash < owed) return prev

      // В колоде поток записан УЖЕ за вычетом платежа по рассрочке.
      // Налом платежа нет — доход выше ровно на его величину.
      const flow = payCash ? card.cashFlow + monthly : card.cashFlow
      const debt = payCash ? 0 : instDebt

      if (card.kind === 'realEstate') {
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_REAL_ESTATE',
          id: `${card.id}-${t.log.length}`,
          name: localizedCardTitle(card),
          cost: card.cost,
          downPayment: payCash ? fullPrice : card.downPayment,
          mortgage: debt,
          cashFlow: flow,
          category: card.category,
          investorShare,
          installmentMonthly: payCash ? 0 : monthly,
        })
      } else {
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_BUSINESS',
          id: `${card.id}-${t.log.length}`,
          name: localizedCardTitle(card),
          cost: card.cost,
          downPayment: payCash ? fullPrice : card.downPayment,
          liability: debt,
          cashFlow: flow,
          category: card.category,
          growthPerPayday: (card as any).growthPerPayday,
          growthCap: (card as any).growthCap,
          installmentMonthly: payCash ? 0 : monthly,
        })
      }
      log(
        t,
        seat.id,
        withInvestor
          ? `Вошёл в долю: ${localizedCardTitle(card)} — свои ${money(owed)}, доход и убыток пополам`
          : payCash
            ? `Купил налом: ${localizedCardTitle(card)} за ${money(fullPrice)} (${money(flow)}/мес, долгов нет)`
            : `Купил в рассрочку: ${localizedCardTitle(card)} — взнос ${money(card.downPayment)}, остаток ${money(debt)} фиксирован (${money(flow)}/мес)`,
      )
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

      // Рынок для всех: пока карта на столе, купить может любой игрок Круга.
      const buyer = event.seatId ? t.seats.find((x) => x.id === event.seatId) : seat
      if (!buyer || buyer.outOfGame || buyer.track === 'fast') return prev
      const total = shares * card.price
      if (buyer.ledger.cash < total) return prev

      seatLedgerEvent(t, buyer.id, {
        type: 'BUY_STOCK',
        id: `${card.symbol}-${t.log.length}`,
        symbol: card.symbol,
        shares,
        costPerShare: card.price,
        dividendPerShareMonthly: card.dividendPerShare ?? 0,
      })
      log(t, buyer.id, `${buyer.name} купил ${shares} × ${card.symbol} по ${money(card.price)}`)
      // Ход закрывает только активный игрок; чужая покупка карту не снимает.
      if (buyer.id === seat.id) {
        t.pending = null
        t.phase = 'turnEnd'
      }
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

      const price = sellOfferPrice(asset.cost, card.multiplierPct, t.market.price[asset.category] ?? 1)
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
        // В халяль-режиме неподъёмная трата всегда уходит в рассрочку —
        // кредитов нет, а застрять на карточке нельзя.
        const forced = !RULES.loansEnabled && l.cash < card.amount
        if (!card.financeable && !forced) return prev
        seatLedgerEvent(t, seat.id, { type: 'FINANCE_DOODAD', amount: card.amount })
        log(
          t,
          seat.id,
          RULES.loansEnabled
            ? `«${card.title}» на кредитку: +${money(Math.ceil(0.03 * card.amount))}/мес`
            : `«${card.title}» в рассрочку: ${money(Math.ceil(card.amount / 10))}/мес × 10`,
        )
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
      seatLedgerEvent(t, seat.id, { type: 'DOWNSIZED' })
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 2 }
      log(t, seat.id, 'Потерял работу: два месяца без зарплаты, счета идут')
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'TAKE_LOAN': {
      if (seat.track === 'fast') return prev
      const step = RULES.currency === 'RUB' ? 10_000 : 1000
      const amount = Math.round(event.amount / step) * step
      if (amount < step) return prev
      seatLedgerEvent(t, seat.id, { type: 'TAKE_LOAN', amount })
      log(
        t,
        seat.id,
        RULES.loansEnabled
          ? `Взял кредит ${money(amount)} (+${money(amount / 10)}/мес)`
          : `Беспроцентный заём ${money(amount)} — вернёт ровно столько же, ${money(amount / 10)}/мес`,
      )
      return t
    }

    case 'REPAY_LOAN': {
      const step = RULES.currency === 'RUB' ? 10_000 : 1000
      const amount = Math.round(event.amount / step) * step
      if (amount < step || l.cash < amount || l.liabilities.bankLoan < amount) return prev
      seatLedgerEvent(t, seat.id, { type: 'REPAY_LOAN', amount })
      log(t, seat.id, `Погасил кредит на ${money(amount)}`)
      return t
    }

    /** Закрыть рассрочку досрочно. Скидка — жест продавца, заранее не обещана. */
    case 'PAYOFF_ASSET': {
      const re = l.realEstate.find((x) => x.id === event.assetId)
      const biz = l.businesses.find((x) => x.id === event.assetId)
      const asset = re ?? biz
      if (!asset) return prev
      const debt = re ? re.mortgage : (biz as any).liability
      if (debt <= 0) return prev
      const pay = Math.round(debt * (1 - event.discountPct / 100))
      if (l.cash < pay) return prev
      seatLedgerEvent(t, seat.id, { type: 'PAYOFF_ASSET', assetId: event.assetId, discountPct: event.discountPct })
      log(
        t,
        seat.id,
        event.discountPct > 0
          ? `Закрыл рассрочку по «${asset.name}» досрочно: ${money(pay)}, продавец скинул ${event.discountPct}%`
          : `Закрыл рассрочку по «${asset.name}»: ${money(pay)}`,
      )
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
      const space = fastBoard()[spaceIdx]
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
      const space = fastBoard()[spaceIdx]
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
      // Нельзя уйти победителем, не рассчитавшись с теми, кто выручил.
      if (loanOutstanding(t.loans, seat.id) > 0) return prev
      const spaceIdx = t.pending.space
      const space = fastBoard()[spaceIdx]
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

    case 'WORLD_EVENT': {
      const t2 = applyWorldEvent(t, event.index)
      t2.worldDeck = { ...t2.worldDeck, next: t2.worldDeck.next + 1 }
      return t2
    }

    // ─── Сделки между игроками ────────────────────────────────────────
    /*
     * Продаётся ПРАВО на найденную сделку, а не сама вещь — вещи у игрока ещё
     * нет, продавать чужое нельзя. Это посредничество, и оно дозволено.
     * Цена держится в коридоре ±100% от справедливой: так ловится сговор
     * вроде «продам другу за рубль», не запрещая торг как таковой.
     */
    case 'OFFER_CARD': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card
      if (card.kind === 'stock') return prev
      const fair = fairCardPrice(card.downPayment)
      const amount = clampPrice(event.amount, fair)
      t.offers = [
        ...t.offers,
        {
          id: `of-${t.log.length}`,
          kind: 'resellCard',
          fromId: seat.id,
          toId: event.toId,
          amount,
          expiresAtTurn: t.turnCounter + 1,
          bids: [],
        },
      ]
      log(t, seat.id, `Предложил другим свою находку «${localizedCardTitle(card)}» за ${money(amount)}`)
      return t
    }

    /** Позвать соинвестора: доля партнёра считается по внесённым деньгам. */
    case 'OFFER_COINVEST': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card
      if (card.kind === 'stock') return prev
      const share = Math.min(0.9, Math.max(0.1, event.share))
      t.offers = [
        ...t.offers,
        {
          id: `of-${t.log.length}`,
          kind: 'coInvest',
          fromId: seat.id,
          amount: Math.max(0, Math.round(event.amount)),
          share,
          expiresAtTurn: t.turnCounter + 1,
          bids: [],
        },
      ]
      log(
        t,
        seat.id,
        `Ищет партнёра в «${localizedCardTitle(card)}»: ${money(event.amount)} за ${Math.round(share * 100)}% доли`,
      )
      return t
    }

    case 'OFFER_ASSET': {
      const re = l.realEstate.find((x) => x.id === event.assetId)
      const biz = l.businesses.find((x) => x.id === event.assetId)
      const asset = re ?? biz
      if (!asset) return prev
      const debt = re ? re.mortgage : (biz as any).liability
      const amount = clampPrice(event.amount, fairAssetPrice(asset.cost, debt))
      t.offers = [
        ...t.offers,
        {
          id: `of-${t.log.length}`,
          kind: 'sellAsset',
          fromId: seat.id,
          toId: event.toId,
          assetId: event.assetId,
          amount,
          expiresAtTurn: t.turnCounter + 2,
          bids: [],
        },
      ]
      log(t, seat.id, `Продаёт «${asset.name}» игрокам за ${money(amount)}`)
      return t
    }

    /** Заём между игроками только беспроцентный: сколько взял, столько вернул. */
    case 'OFFER_LOAN': {
      const to = t.seats.find((x) => x.id === event.toId)
      if (!to || to.outOfGame || to.id === seat.id) return prev
      const amount = Math.max(0, Math.round(event.amount))
      if (l.cash < amount) return prev
      t.offers = [
        ...t.offers,
        {
          id: `of-${t.log.length}`,
          kind: 'loan',
          fromId: seat.id,
          toId: to.id,
          amount,
          expiresAtTurn: t.turnCounter + 2,
          bids: [],
        },
      ]
      log(t, seat.id, `Предлагает ${to.name} беспроцентный заём ${money(amount)}`)
      return t
    }

    /** Ставка в мини-аукционе, если желающих несколько. */
    case 'BID_OFFER': {
      const o = t.offers.find((x) => x.id === event.offerId)
      if (!o || !offerAlive(o, t)) return prev
      const bidder = t.seats.find((x) => x.id === event.seatId)
      if (!bidder || bidder.outOfGame || bidder.id === o.fromId) return prev
      if (bidder.ledger.cash < event.amount) return prev
      o.bids = [...o.bids.filter((b) => b.seatId !== event.seatId), { seatId: event.seatId, amount: event.amount }]
      log(t, event.seatId, `${bidder.name} предлагает ${money(event.amount)}`)
      return t
    }

    case 'CANCEL_OFFER': {
      t.offers = t.offers.filter((o) => o.id !== event.offerId)
      return t
    }

    case 'ACCEPT_OFFER_TRADE': {
      const o = t.offers.find((x) => x.id === event.offerId)
      if (!o || !offerAlive(o, t)) return prev
      const from = t.seats.find((x) => x.id === o.fromId)
      const winner = auctionWinner(o)
      const buyerId = winner?.seatId ?? event.seatId
      const price = winner?.amount ?? o.amount
      const buyer = t.seats.find((x) => x.id === buyerId)
      if (!from || !buyer || buyer.outOfGame) return prev
      if (o.toId && o.toId !== buyer.id) return prev

      switch (o.kind) {
        case 'resellCard': {
          if (t.pending?.kind !== 'deal') return prev
          const card = t.pending.card
          if (card.kind === 'stock') return prev
          // Покупатель платит и за право, и за сам первый взнос.
          const total = price + card.downPayment
          if (buyer.ledger.cash < total) return prev
          seatLedgerEvent(t, buyer.id, { type: 'ADJUST_CASH', amount: -price })
          seatLedgerEvent(t, from.id, { type: 'ADJUST_CASH', amount: price })
          const common = {
            id: `${card.id}-${t.log.length}`,
            name: localizedCardTitle(card),
            cost: card.cost,
            downPayment: card.downPayment,
            cashFlow: card.cashFlow,
            category: card.category,
          }
          if (card.kind === 'realEstate') {
            seatLedgerEvent(t, buyer.id, { type: 'BUY_REAL_ESTATE', ...common, mortgage: card.mortgage })
          } else {
            seatLedgerEvent(t, buyer.id, { type: 'BUY_BUSINESS', ...common, liability: card.liability })
          }
          log(t, buyer.id, `${buyer.name} выкупил находку у ${from.name} за ${money(price)} и вошёл в сделку`)
          t.offers = t.offers.filter((x) => x.id !== o.id)
          t.pending = null
          t.phase = 'turnEnd'
          return t
        }

        case 'sellAsset': {
          const re = from.ledger.realEstate.find((x) => x.id === o.assetId)
          const biz = from.ledger.businesses.find((x) => x.id === o.assetId)
          const asset = re ?? biz
          if (!asset) return prev
          const debt = re ? re.mortgage : (biz as any).liability
          if (buyer.ledger.cash < price) return prev
          seatLedgerEvent(t, buyer.id, { type: 'ADJUST_CASH', amount: -price })
          // Продавец получает цену за вычетом долга, который уходит вместе с активом.
          if (re) seatLedgerEvent(t, from.id, { type: 'SELL_REAL_ESTATE', assetId: o.assetId!, salePrice: price })
          else seatLedgerEvent(t, from.id, { type: 'SELL_BUSINESS', assetId: o.assetId!, salePrice: price })
          const common = {
            id: `${o.assetId}-${t.log.length}`,
            name: asset.name,
            cost: asset.cost,
            downPayment: price,
            cashFlow: asset.cashFlow,
            category: asset.category,
          }
          if (re) seatLedgerEvent(t, buyer.id, { type: 'BUY_REAL_ESTATE', ...common, mortgage: debt })
          else seatLedgerEvent(t, buyer.id, { type: 'BUY_BUSINESS', ...common, liability: debt })
          log(t, buyer.id, `${buyer.name} купил «${asset.name}» у ${from.name} за ${money(price)}`)
          t.offers = t.offers.filter((x) => x.id !== o.id)
          return t
        }

        case 'coInvest': {
          if (t.pending?.kind !== 'deal') return prev
          const card = t.pending.card
          if (card.kind === 'stock') return prev
          if (buyer.ledger.cash < o.amount) return prev
          const mine = Math.max(0, card.downPayment - o.amount)
          if (from.ledger.cash < mine) return prev
          // Каждый вносит свою часть; доля партнёра записана в актив инициатора.
          seatLedgerEvent(t, buyer.id, { type: 'ADJUST_CASH', amount: -o.amount })
          seatLedgerEvent(t, from.id, { type: 'ADJUST_CASH', amount: -mine })
          const share = o.share ?? 0.5
          const common = {
            id: `${card.id}-${t.log.length}`,
            name: localizedCardTitle(card),
            cost: card.cost,
            downPayment: 0,
            cashFlow: card.cashFlow,
            category: card.category,
            investorShare: share,
            partnerId: buyer.id,
          }
          if (card.kind === 'realEstate') {
            seatLedgerEvent(t, from.id, { type: 'BUY_REAL_ESTATE', ...common, mortgage: card.mortgage })
          } else {
            seatLedgerEvent(t, from.id, { type: 'BUY_BUSINESS', ...common, liability: card.liability })
          }
          log(
            t,
            from.id,
            `${from.name} и ${buyer.name} вошли в «${localizedCardTitle(card)}» долями ${Math.round((1 - share) * 100)}/${Math.round(share * 100)} — прибыль и убыток пополам по долям`,
          )
          t.offers = t.offers.filter((x) => x.id !== o.id)
          t.pending = null
          t.phase = 'turnEnd'
          return t
        }

        case 'loan': {
          if (from.ledger.cash < o.amount) return prev
          seatLedgerEvent(t, from.id, { type: 'ADJUST_CASH', amount: -o.amount })
          seatLedgerEvent(t, buyer.id, { type: 'ADJUST_CASH', amount: o.amount })
          t.loans = [
            ...t.loans,
            {
              id: `ln-${t.log.length}`,
              lenderId: from.id,
              borrowerId: buyer.id,
              amount: o.amount,
              repaid: 0,
              atTurn: t.turnCounter,
            },
          ]
          log(t, buyer.id, `${buyer.name} взял у ${from.name} ${money(o.amount)} без надбавки — вернуть столько же`)
          t.offers = t.offers.filter((x) => x.id !== o.id)
          return t
        }
      }
      return prev
    }

    case 'REPAY_PLAYER_LOAN': {
      const ln = t.loans.find((x) => x.id === event.loanId)
      if (!ln || ln.borrowerId !== seat.id) return prev
      const left = ln.amount - ln.repaid
      const pay = Math.min(Math.max(0, Math.round(event.amount)), left, l.cash)
      if (pay <= 0) return prev
      seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: -pay })
      seatLedgerEvent(t, ln.lenderId, { type: 'ADJUST_CASH', amount: pay })
      ln.repaid += pay
      const lender = t.seats.find((x) => x.id === ln.lenderId)
      log(t, seat.id, `Вернул ${lender?.name ?? 'игроку'} ${money(pay)}${ln.repaid >= ln.amount ? ' — долг закрыт' : ''}`)
      if (ln.repaid >= ln.amount) t.loans = t.loans.filter((x) => x.id !== ln.id)
      return t
    }

    /** Простить долг — дело доброе и разрешённое. */
    case 'FORGIVE_LOAN': {
      const ln = t.loans.find((x) => x.id === event.loanId)
      if (!ln || ln.lenderId !== seat.id) return prev
      t.loans = t.loans.filter((x) => x.id !== ln.id)
      const borrower = t.seats.find((x) => x.id === ln.borrowerId)
      log(t, seat.id, `${seat.name} простил долг ${borrower?.name ?? ''} — ${money(ln.amount - ln.repaid)}`)
      return t
    }

    /** Досрочно завершить партию — победители уже известны, остальные согласились. */
    case 'FINISH_GAME': {
      t.phase = 'finished'
      t.pending = { kind: 'gameOver' }
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
