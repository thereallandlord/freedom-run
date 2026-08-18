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
  freedomIncome,
  monthlyCashFlow,
  ownShare,
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
import {
  RULES,
  setRules,
  installmentPrice,
  installmentMonthly,
  zakatDue,
  marketStockPrice,
  dealTerms,
  ribaRisk,
  ribaLimit,
  ribaMonthly,
  RIBA,
  CITIZENSHIP,
  citizenshipReady,
} from './ledger'
import { mulberry32, shuffleIndices } from './rng'
import {
  GL_LUCK_MAX,
  GL_LUCK_MIN,
  GL_START_FLOW,
  GL_PROMOS,
  GL_ACCEL_POINTS,
  GL_MAX_GROWTH_PCT,
  GL_TRIANGLE_BONUS,
  glPackage,
  glPromoReady,
  glTotalIncome,
  glUpgradeCost,
} from './greenleaf'
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
      yieldScale: 1,
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
    idSeq: 0,
    worldDeck: { order: shuffleIndices(WORLD_EVENTS.length, setup.seed + 5), next: 0 },
    market: { price: {}, flow: {}, stock: {} },
    marketEffects: [],
    worldTick: 0,
    lastWorldEvent: null,
    offers: [],
    loans: [],
  }
}

/**
 * Мировое событие. Приходит по таймеру реального времени, а не по чьему-то ходу,
 * и задевает всех сразу — так в игру попадает настоящий рынок.
 */
/** Сколько отказов от хотелок подряд приводят к выгоранию. */
export const WANTS_BEFORE_BURNOUT = 4
export const BURNOUT_TURNS = 4

/** Сколько мировых событий держится эффект рынка. */
export const MARKET_EFFECT_LIFE = 3

/**
 * Пересобирает словари множителей из списка живых эффектов.
 * Протухшие выбрасываются — так рынок возвращается к норме сам, и два
 * противоположных события гасят друг друга ТОЧНО, без остатка от округления.
 */
export function recalcMarket(t: Table) {
  t.marketEffects = t.marketEffects.filter((e) => e.until > t.worldTick)
  const price: Record<string, number> = {}
  const flow: Record<string, number> = {}
  const stock: Record<string, number> = {}
  for (const e of t.marketEffects) {
    const bag = e.kind === 'price' ? price : e.kind === 'flow' ? flow : stock
    bag[e.key] = (bag[e.key] ?? 1) * e.mul
  }
  t.market = { price, flow, stock }
}

export function applyWorldEvent(prev: Table, index: number): Table {
  const t = cloneTable(prev)
  const ev = WORLD_EVENTS[index]
  if (!ev) return prev
  const e = ev.effect
  const mul = (pct: number) => 1 + pct / 100

  t.worldTick += 1
  const until = t.worldTick + MARKET_EFFECT_LIFE
  const push = (kind: 'price' | 'flow' | 'stock', keys: string[], pct: number) => {
    for (const key of keys)
      t.marketEffects.push({ eventId: ev.id, title: ev.title, kind, key, mul: mul(pct), until })
  }

  switch (e.kind) {
    case 'assetPrice':
      push('price', e.categories, e.pct)
      break
    case 'assetFlow':
      /*
       * 🔴 Доход НЕ переписывается у самих объектов — только множитель.
       * Иначе эффект нельзя отменить, он не действует на купленное позже,
       * а округление до сотен не даёт вернуться к исходному числу.
       */
      push('flow', e.categories, e.pct)
      break
    case 'stockPrice':
      push('stock', e.symbols, e.pct)
      break
    /*
     * 🔴 Мировое событие не может забрать больше, чем у человека есть на руках.
     * Раньше списывало вслепую и уводило наличные в минус, причём БЕЗ экрана
     * банкротства: он открывается только по своей зарплате, а событие приходит
     * посреди чужого хода. Через эту дыру в игре появлялись отрицательные
     * деньги, которых взяться неоткуда.
     */
    case 'cashAll':
      for (const s of t.seats) {
        if (s.outOfGame) continue
        const take = e.amount < 0 ? -Math.min(s.ledger.cash, -e.amount) : e.amount
        if (take !== 0) seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount: take })
      }
      break
    case 'frictionAll':
      for (const s of t.seats) {
        if (s.outOfGame) continue
        if (s.ledger.citizenship) {
          log(t, s.id, `${s.name}: обошло стороной — выручил второй паспорт`)
          continue
        }
        const take = e.amount < 0 ? -Math.min(s.ledger.cash, -e.amount) : e.amount
        if (take !== 0) seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount: take })
      }
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

  recalcMarket(t)
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

/**
 * Следующий уникальный номер для идентификатора актива.
 * 🔴 Не длина журнала: журнал обрезается на 300 строках, и номера начинали
 * повторяться — продажа одного актива уносила другой с тем же id.
 */
function nextId(t: Table): number {
  t.idSeq = (t.idSeq ?? 0) + 1
  return t.idSeq
}

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
    marketEffects: t.marketEffects.map((e) => ({ ...e })),
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
    const price = marketStockPrice(p.card.price, t.market.stock[p.card.symbol])
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

/**
 * Цена выкупа с учётом того, что творится на рынке.
 * 🔴 Множитель ОБЯЗАТЕЛЬНЫЙ, без значения по умолчанию: раньше бот забывал его
 * передать и решал продавать по цифре, которой в игре не существует.
 */
export function sellOfferPrice(cost: number, multiplierPct: number, marketMul: number): number {
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

/**
 * Годится ли вытянутая карта этому игроку прямо сейчас.
 *
 * Кроме «по карману ли» тут два правила, о которых просил Камиль:
 *
 * 🔴 Партнёрский бизнес не показываем тому, у кого он уже есть, — КРОМЕ случая,
 * когда за столом остался кто-то без него: тогда карту можно вытянуть, чтобы
 * перепродать соседу. Если он есть у всех — карта из игры уходит совсем.
 *
 * 🔴 Чем больше у игрока бизнесов, тем реже выпадает следующий. Никто не
 * покупает пятьдесят бизнесов подряд. Шанс падает, но в ноль не уходит.
 */
function dealDrawOk(t: Table, card: import('./types').DealCard, size: 'small' | 'big'): boolean {
  const seat = currentSeat(t)
  const l = seat.ledger
  if (!dealAffordable(t, card, size)) return false

  if ((card as { greenleaf?: boolean }).greenleaf) {
    const mineAlready = l.businesses.some((b) => b.gl)
    if (!mineAlready) return true
    const someoneWithout = t.seats.some(
      (s) => !s.outOfGame && s.id !== seat.id && !s.ledger.businesses.some((b) => b.gl),
    )
    return someoneWithout
  }

  if (card.kind === 'business') {
    const owned = l.businesses.filter((b) => !b.gl).length
    if (owned === 0) return true
    // 1 бизнес → 55%, 2 → 30%, 3 → 17%, дальше всё реже, но никогда не ноль.
    const chance = Math.pow(0.55, owned)
    return mulberry32(t.seed + t.log.length + 4241)() < chance
  }
  return true
}

/**
 * Пускает ли владелец находки этого игрока внутрь.
 * Молчание — отказ: пока условия не заданы, чужая карта закрыта.
 */
function accessAllows(a: import('./types').DealAccess | undefined, seatId: string): boolean {
  if (!a || a.mode === 'closed') return false
  if (a.mode === 'open') return true
  return a.allow.includes(seatId)
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
      seatLedgerEvent(t, seat.id, { type: 'PAYCHECK', flowMul: t.market.flow })
    } else {
      seatLedgerEvent(t, seat.id, { type: 'CASHFLOW_DAY' })
    }
  }
  if (payouts > 0) {
    const l = t.seats[seatIdx].ledger
    const amount = seat.track === 'rat' ? monthlyCashFlow(l, t.market.flow) : fastTrackIncome(l)
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
        let card = deck[idx]
        /*
         * Долговая нагрузка: пока открыт процентный кредит, беды приходят чаще
         * и бьют больнее. Наказание не спрятано — нагрузку видно в панели, и
         * связь игрок достраивает сам. Ничего не запрещаем.
         */
        const risk = ribaRisk(l)
        if (risk > 0 && mulberry32(t.seed + t.log.length + 991)() < risk) {
          const idx2 = draw(t, 'doodad', deck.length)
          const extra = deck[idx2]
          card = {
            ...card,
            title: `${card.title} — и сразу следом: ${extra.title.toLowerCase()}`,
            amount: card.amount + extra.amount,
          }
          log(t, seat.id, 'Долги тянут за собой: неприятности пришли парой')
        }
        t.pending = { kind: 'doodad', card }
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
    case 'glEvent': {
      // Приходит только владельцу партнёрского бизнеса — как беды по кафе владельцу кафе.
      const owners = t.seats.filter(
        (s) => !s.outOfGame && s.track === 'rat' && s.ledger.businesses.some((b) => b.gl),
      )
      if (!owners.length) return false
      if (!card.promo) return true
      // Промоушен показываем, только если план правда закрыт и сроки вышли.
      const p = GL_PROMOS.find((x) => x.id === card.promo)
      if (!p) return false
      return owners.some((s) => {
        const g = s.ledger.businesses.find((b) => b.gl)?.gl
        return !!g && glPromoReady(g, p).ready
      })
    }
  }
}

/** Сплиты, выплаты и повышения применяются сразу — решать нечего. */
function applyMarketAuto(t: Table, card: MarketCard) {
  if (card.kind === 'glEvent' && !card.triangle) {
    /*
     * События партнёрского бизнеса. Применяются владельцу — и объясняются
     * человеческой фразой: игрок должен понимать, почему доход изменился.
     */
    for (const s of t.seats) {
      if (s.outOfGame || s.track === 'fast') continue
      const biz = s.ledger.businesses.find((b) => b.gl)
      if (!biz?.gl) continue
      const g = { ...biz.gl }
      if (card.boostPct) g.baseFlow = Math.round((g.baseFlow * (1 + card.boostPct / 100)) / 100) * 100
      if (card.growthPct)
        /*
         * Ускоритель поднимает СКОРОСТЬ роста — эффект накопительный.
         * 🔴 Прибавкой в пунктах, а не умножением: умножение на длинной партии
         * разгоняет доход до миллиардов, чего не бывает ни у кого.
         */
        g.growthPct = Math.min(
          GL_MAX_GROWTH_PCT,
          Math.round((g.growthPct + (card.growthPct / 100) * GL_ACCEL_POINTS * 2.5) * 10) / 10,
        )
      if (card.dipPct) {
        g.dipMul = 1 - card.dipPct / 100
        g.dipLeft = card.dipPaydays ?? 4
      }
      if (card.freezePaydays) g.slowdownLeft = Math.max(g.slowdownLeft, card.freezePaydays)
      biz.gl = g
      biz.cashFlow = glTotalIncome(g)
      log(t, s.id, `${s.name}: ${card.title} — доход по партнёрскому бизнесу теперь ${money(glTotalIncome(g))}/мес`)
    }
    return
  }
  if (card.kind === 'stockSplit') {
    for (const s of t.seats) {
      if (s.outOfGame || s.track === 'fast') continue
      seatLedgerEvent(t, s.id, {
        type: 'STOCK_SPLIT',
        symbol: card.symbol,
        direction: card.direction,
        ratio: card.ratio,
      })
    }
    const k = card.ratio ?? 2
    /*
     * 🔴 И цена по этому символу тоже делится. Иначе карта «цена бумаги» после
     * сплита продаст удесятерённое количество по прежней цене — деньги из
     * воздуха. Множитель живёт до конца партии: сплит не «событие рынка на
     * три хода», а разовая и необратимая смена номинала.
     */
    const sym = card.symbol.toUpperCase()
    t.marketEffects.push({
      eventId: card.id,
      title: card.title,
      kind: 'stock',
      key: sym,
      mul: card.direction === 'split' ? 1 / k : k,
      until: Number.MAX_SAFE_INTEGER,
    })
    recalcMarket(t)
    log(t, null, `${card.symbol}: ${card.direction === 'split' ? `сплит ${k}:1` : `обратный сплит 1:${k}`}`)
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

      /*
       * Партнёрский бизнес показываем ОДНИМ ИЗ ПЕРВЫХ (решение Камиля).
       * Причина: карта лежит в общей колоде и может не выпасть за всю партию,
       * а весь смысл игры — чтобы человек её увидел и попробовал. Вход у неё
       * самый дешёвый в игре, так что ранний показ никого не ломает.
       */
      const glCard = list.find((c) => (c as { greenleaf?: boolean }).greenleaf)
      if (glCard && !seat.ledger.businesses.some((b) => b.gl) && seat.glSeen !== true) {
        t.seats[seatIdx] = { ...t.seats[seatIdx], glSeen: true }
        t.pending = { kind: 'deal', deck: event.size, card: scaled(glCard) }
        return t
      }

      let card = scaled(list[draw(t, event.size, list.length)])
      for (let tries = 0; tries < 6 && !dealDrawOk(t, card, event.size); tries++) {
        card = scaled(list[draw(t, event.size, list.length)])
      }
      t.pending = { kind: 'deal', deck: event.size, card }
      return t
    }

    case 'BUY_DEAL': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card
      if (card.kind === 'stock') return prev

      /*
       * GreenLeaf: цена берётся не из карты, а из ВЫБРАННОГО пакета.
       * Карта одна, цен три — решение игрока, а не то, что ему выпало.
       */
      const glPkg = (card as { greenleaf?: boolean }).greenleaf
        ? glPackage(event.glPackage ?? 'platinum')
        : null
      if (glPkg) {
        if (l.cash < glPkg.price) return prev
        // Разброс удачи: у двух одинаково старательных структура растёт по-разному.
        // Детерминированно от зерна и длины журнала — повтор партии даст то же.
        const luck =
          GL_LUCK_MIN + mulberry32(t.seed + t.log.length)() * (GL_LUCK_MAX - GL_LUCK_MIN)
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_BUSINESS',
          id: `${card.id}-${nextId(t)}`,
          name: `${localizedCardTitle(card)} · ${glPkg.name}`,
          cost: glPkg.price,
          downPayment: glPkg.price,
          liability: 0,
          cashFlow: GL_START_FLOW,
          category: 'partnership',
          glPackage: glPkg.id,
          glLuck: luck,
        })
        log(t, seat.id, `Вошёл в партнёрский бизнес, пакет «${glPkg.name}» за ${money(glPkg.price)}`)
        t.pending = null
        t.phase = 'turnEnd'
        return t
      }

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
      // Условия считает общая функция — та же, что показывает окно карточки.
      const terms = dealTerms(card, kind)
      const fullPrice = terms.cashPrice
      const instTotal = terms.instTotal
      const instDebt = terms.instDebt
      const monthly = terms.instMonthly

      const payCash = !!event.payCash
      const owed = payCash
        ? Math.round(fullPrice * (1 - (investorShare ?? 0)))
        : Math.round(card.downPayment * (1 - (investorShare ?? 0)))
      if (l.cash < owed) return prev

      /*
       * 🔴 В колоде поток — это ОБЫЧНАЯ чистая аренда, как если купил налом.
       * Раньше код считал наоборот («поток уже за вычетом платежа») и при
       * покупке налом ПРИБАВЛЯЛ платёж сверху. Получалась выдуманная доходность:
       * апартаменты у «Сити» давали −27 500 в рассрочку и +268 300 налом, то
       * есть 129% годовых на московскую квартиру, и убыточные карты
       * превращались в лучшие покупки в игре.
       *
       * Правда простая и полезная: под длинную рассрочку объект почти всегда
       * не кормит себя — платёж больше аренды. Поэтому в начале работают
       * дешёвые покупки за наличные, а не плечо.
       */
      const flow = payCash ? terms.cashFlow : terms.instFlow
      const debt = payCash ? 0 : instDebt

      /*
       * 🔴 Стоимость актива записываем ТУ, за которую его купили: налом — цену
       * налом, в рассрочку — цену с наценкой. Раньше долг вешали с наценкой, а
       * объект ставили по цене без неё — и каждая покупка в рассрочку сразу
       * давала минус в четверть стоимости. У ботов к концу партии выходил
       * отрицательный капитал на ровном месте.
       */
      const bookCost = payCash ? fullPrice : instTotal
      if (card.kind === 'realEstate') {
        seatLedgerEvent(t, seat.id, {
          type: 'BUY_REAL_ESTATE',
          id: `${card.id}-${nextId(t)}`,
          name: localizedCardTitle(card),
          cost: bookCost,
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
          id: `${card.id}-${nextId(t)}`,
          name: localizedCardTitle(card),
          cost: bookCost,
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

      /*
       * 🔴 Чужая находка — не общий рынок. Войти можно ТОЛЬКО с разрешения
       * того, кому выпала карта, и на его условиях. Раньше любой покупал ту же
       * бумагу по той же цене без спроса, и удачный ход ничего не стоил.
       */
      const buyer = event.seatId ? t.seats.find((x) => x.id === event.seatId) : seat
      if (!buyer || buyer.outOfGame || buyer.track === 'fast') return prev
      if (buyer.id !== seat.id && !accessAllows(t.pending.access, buyer.id)) return prev

      const price = marketStockPrice(card.price, t.market.stock[card.symbol])
      const total = shares * price
      if (buyer.ledger.cash < total) return prev

      // Условия входа: разовая плата уходит владельцу находки сразу,
      // доля с прибыли вешается на лот и отщипнётся при продаже.
      const terms = buyer.id !== seat.id ? t.pending.access?.terms : undefined
      if (terms?.kind === 'fee') {
        if (buyer.ledger.cash < total + terms.amount) return prev
        seatLedgerEvent(t, buyer.id, { type: 'ADJUST_CASH', amount: -terms.amount })
        seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: terms.amount })
        log(t, buyer.id, `${buyer.name} заплатил ${money(terms.amount)} за вход в находку ${seat.name}`)
      }

      seatLedgerEvent(t, buyer.id, {
        type: 'BUY_STOCK',
        id: `${card.symbol}-${nextId(t)}`,
        symbol: card.symbol,
        profitShareTo: terms?.kind === 'profitShare' ? seat.id : undefined,
        profitSharePct: terms?.kind === 'profitShare' ? terms.pct : undefined,
        shares,
        costPerShare: price,
        dividendPerShareMonthly: card.dividendPerShare ?? 0,
      })
      log(t, buyer.id, `${buyer.name} купил ${shares} × ${card.symbol} по ${money(price)}`)
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
      const soldN = Math.min(event.shares, lot.shares)
      seatLedgerEvent(t, event.seatId, {
        type: 'SELL_STOCK',
        lotId: event.lotId,
        shares: event.shares,
        pricePerShare: event.pricePerShare,
      })
      log(
        t,
        event.seatId,
        `${holder.name} продал ${soldN} × ${lot.symbol} по ${money(event.pricePerShare)}`,
      )

      /*
       * 🔴 Вошёл в чужую находку на долю с прибыли — доля отщипывается ЗДЕСЬ,
       * автоматически. Иначе договорённость остаётся честным словом, а не
       * правилом, и её просто забывают.
       * Считается только с ПРИБЫЛИ: продал в минус — не должен ничего.
       */
      if (lot.profitShareTo && lot.profitSharePct) {
        const profit = (event.pricePerShare - lot.costPerShare) * soldN
        if (profit > 0) {
          const cut = Math.round((profit * lot.profitSharePct) / 100)
          const owner = t.seats.find((x) => x.id === lot.profitShareTo)
          if (owner && cut > 0) {
            seatLedgerEvent(t, event.seatId, { type: 'ADJUST_CASH', amount: -cut })
            seatLedgerEvent(t, owner.id, { type: 'ADJUST_CASH', amount: cut })
            log(
              t,
              owner.id,
              `${owner.name} получил ${money(cut)} — ${lot.profitSharePct}% с прибыли ${holder.name} по договорённости о входе`,
            )
          }
        }
      }
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
      if (card.want) {
        // Позволил себе — счётчик отказов обнуляется.
        seatLedgerEvent(t, seat.id, { type: 'INDULGE' })
        if (card.upkeep) {
          seatLedgerEvent(t, seat.id, { type: 'ADD_UPKEEP', amount: card.upkeep })
          log(t, seat.id, `С покупкой пришло содержание: +${money(card.upkeep)}/мес к расходам`)
        }
      }
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    /**
     * Пройти мимо хотелки. Экономить правильно — но не бесконечно.
     * 🔴 После WANTS_BEFORE_BURNOUT отказов подряд человек выгорает и выпадает
     * из игры на BURNOUT_TURNS ходов. Это не наказание за бережливость, а
     * правда жизни: если годами только пахать и ни разу себя не порадовать,
     * рано или поздно встанешь.
     */
    case 'SKIP_WANT': {
      if (t.pending?.kind !== 'doodad' || !t.pending.card.want) return prev
      const title = t.pending.card.title
      seatLedgerEvent(t, seat.id, { type: 'REFUSE_WANT' })
      const refused = t.seats[seatIdx].ledger.wantsRefused ?? 0
      log(t, seat.id, `Прошёл мимо: ${title}`)
      t.pending = null
      if (refused >= WANTS_BEFORE_BURNOUT) {
        seatLedgerEvent(t, seat.id, { type: 'INDULGE' })
        t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: BURNOUT_TURNS }
        log(
          t,
          seat.id,
          `${seat.name} выгорел: ${refused} раз подряд себе ни в чём не позволил. Пропускает ${BURNOUT_TURNS} хода`,
        )
      }
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
      // 🔴 Множитель берём из правил: в русском режиме он 50, а не 100 —
      // журнал обещал игроку вдвое больше, чем приходило на счёт.
      const buyout = RULES.fastTrackMultiplier * freedomIncome(l)
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
      // 🔴 Карту надо снять и ход закрыть: иначе окно мечты оставалось открытым
      // и победитель мог заплатить за неё ещё раз, и ещё раз.
      t.pending = null
      t.phase = 'turnEnd'
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

    /*
     * Поднять пакет GreenLeaf. Доступно В ЛЮБОЙ МОМЕНТ, а не по карте:
     * в жизни это решение, а не удача. Платишь только разницу.
     */
    case 'GL_UPGRADE': {
      const biz = l.businesses.find((b) => b.id === event.assetId)
      if (!biz?.gl) return prev
      const cost = glUpgradeCost(biz.gl.packageId, event.to)
      if (cost <= 0 || l.cash < cost) return prev
      seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: -cost })
      const after = t.seats[seatIdx].ledger.businesses.find((b) => b.id === event.assetId)
      if (after?.gl) after.gl = { ...after.gl, packageId: event.to }
      log(
        t,
        seat.id,
        `Поднял пакет до «${glPackage(event.to).name}», доплатив ${money(cost)} — доход со структуры вырос`,
      )
      return t
    }

    /** Золотой треугольник: ещё два кабинета, доход растёт на треть. */
    case 'GL_BUY_TRIANGLE': {
      const biz = l.businesses.find((b) => b.gl && !b.gl.triangle)
      if (!biz?.gl || l.cash < event.cost) return prev
      seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: -event.cost })
      const after = t.seats[seatIdx].ledger.businesses.find((b) => b.id === biz.id)
      if (after?.gl) {
        after.gl = { ...after.gl, triangle: true }
        after.cashFlow = glTotalIncome(after.gl)
      }
      log(
        t,
        seat.id,
        `Открыл ещё два кабинета за ${money(event.cost)} — доход по структуре вырос на ${Math.round(
          (GL_TRIANGLE_BONUS - 1) * 100,
        )}%`,
      )
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    /** Взять кредит. Условия заманчивые — в этом и ловушка. */
    case 'TAKE_RIBA': {
      const limit = ribaLimit(l)
      const free = Math.max(0, limit - l.liabilities.ribaLoan)
      const amount = Math.min(Math.max(0, Math.round(event.amount / 10_000) * 10_000), free)
      if (amount <= 0) return prev
      seatLedgerEvent(t, seat.id, {
        type: 'TAKE_RIBA_L',
        amount,
        payment: ribaMonthly(l.liabilities.ribaLoan + amount),
        grace: RIBA.gracePaydays,
      })
      log(
        t,
        seat.id,
        `Взял кредит ${money(amount)} — первые ${RIBA.gracePaydays} зарплат без платежей`,
      )
      return t
    }

    case 'REPAY_RIBA': {
      if (l.liabilities.ribaLoan <= 0) return prev
      seatLedgerEvent(t, seat.id, { type: 'REPAY_RIBA_L', amount: event.amount })
      const left = t.seats[seatIdx].ledger.liabilities.ribaLoan
      log(t, seat.id, left > 0 ? `Погасил часть кредита, осталось ${money(left)}` : 'Кредит закрыт полностью')
      return t
    }

    /**
     * Промоушен. Автопромоушен — только деньгами. Путешествие — на выбор.
     *
     * 🔴 Поездка выглядит как ХУДШИЙ выбор: вместо живых денег — отдых. Но
     * именно там знакомятся с людьми, которые потом двигают структуру. Прибавка
     * случайная (0–20%) и на случайный срок, и в карточке о ней не сказано ни
     * слова: узнать можно только съездив. Так это и в жизни работает.
     */
    case 'GL_PROMO_TAKE': {
      const biz = l.businesses.find((b) => b.gl)
      const promo = GL_PROMOS.find((x) => x.id === event.promo)
      if (!biz?.gl || !promo || !glPromoReady(biz.gl, promo).ready) return prev

      const mark = (g: typeof biz.gl) => ({
        ...g,
        lastPromo: { ...g.lastPromo, [promo.id]: g.age },
        lastPromoVolume: { ...g.lastPromoVolume, [promo.id]: g.volume },
      })

      if (event.go && promo.id === 'travel') {
        const r = mulberry32(t.seed + t.log.length + 3771)
        const gainPct = Math.round(r() * 20)
        const forPaydays = 4 + Math.floor(r() * 9)
        const after = t.seats[seatIdx].ledger.businesses.find((b) => b.id === biz.id)
        if (after?.gl) {
          const g = mark(after.gl)
          after.gl = gainPct > 0 ? { ...g, dipMul: 1 + gainPct / 100, dipLeft: forPaydays } : g
          after.cashFlow = glTotalIncome(after.gl)
        }
        log(
          t,
          seat.id,
          gainPct > 0
            ? `Съездил по промоушену. Познакомился с людьми — доход по структуре вырос на ${gainPct}% на ${forPaydays} зарплат`
            : 'Съездил по промоушену. Отдохнул, но полезных знакомств не завёл',
        )
      } else {
        seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: promo.amount })
        const after = t.seats[seatIdx].ledger.businesses.find((b) => b.id === biz.id)
        if (after?.gl) after.gl = mark(after.gl)
        log(t, seat.id, `${promo.name}: забрал деньгами ${money(promo.amount)}`)
      }
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    /** Второй паспорт. Покупается решением в любой момент, а не по карте. */
    case 'GET_CITIZENSHIP': {
      const c = CITIZENSHIP.find((x) => x.id === event.id)
      if (!c || !citizenshipReady(l, c.id).ok) return prev
      seatLedgerEvent(t, seat.id, { type: 'SET_CITIZENSHIP', name: c.name, fee: c.fee })
      log(t, seat.id, `${seat.name} получил ${c.name.toLowerCase()} — дохода не прибавилось, зато стало спокойнее`)
      return t
    }

    /** Дать в долг с надбавкой. Игра не запрещает — показывает последствия. */
    case 'OFFER_LOAN_WITH_INTEREST': {
      const to = t.seats.find((x) => x.id === event.toId)
      if (!to || to.outOfGame || to.id === seat.id) return prev
      const amount = Math.max(0, Math.round(event.amount))
      if (amount <= 0 || l.cash < amount) return prev
      t.offers = [
        ...t.offers,
        {
          id: `of-${nextId(t)}`,
          kind: 'loan',
          fromId: seat.id,
          toId: to.id,
          amount,
          interestPct: Math.max(1, Math.round(event.interestPct)),
          expiresAtTurn: t.turnCounter + 2,
          bids: [],
        },
      ]
      log(
        t,
        seat.id,
        `Предлагает ${to.name} ${money(amount)} под ${Math.round(event.interestPct)}% — вернуть ${money(Math.round((amount * (100 + event.interestPct)) / 100))}`,
      )
      return t
    }

    /** Владелец находки задаёт, кого и на каких условиях пускать. */
    case 'SET_ACCESS': {
      if (t.pending?.kind !== 'deal' && t.pending?.kind !== 'market') return prev
      t.pending = { ...t.pending, access: event.access }
      const a = event.access
      const who =
        a.mode === 'closed'
          ? 'никого не пускает'
          : a.mode === 'open'
            ? 'открыл вход всем'
            : `пускает: ${a.allow.map((id) => t.seats.find((s2) => s2.id === id)?.name).filter(Boolean).join(', ')}`
      const how =
        a.terms.kind === 'free'
          ? 'без условий'
          : a.terms.kind === 'fee'
            ? `плата за вход ${money(a.terms.amount)}`
            : `${a.terms.pct}% с прибыли при продаже`
      log(t, seat.id, `${seat.name} ${who}${a.mode === 'closed' ? '' : ` — ${how}`}`)
      return t
    }

    /**
     * Нанять управляющего. Решение, а не удача: в жизни ты решаешь нанять,
     * а потом ищешь. Берёт свою долю навсегда, зато остаток идёт в свободу.
     */
    case 'HIRE_MANAGER': {
      const b = l.businesses.find((x) => x.id === event.assetId)
      if (!b || b.gl || b.managerPct) return prev
      // Найм стоит трёх месяцев его доли — поиск, ввод в дело, первый аванс.
      const hireCost = Math.max(30_000, Math.round((ownShare(b) * event.pct * 3) / 100 / 1000) * 1000)
      if (l.cash < hireCost) return prev
      seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: -hireCost })
      seatLedgerEvent(t, seat.id, { type: 'SET_MANAGER', assetId: event.assetId, pct: event.pct })
      const after = t.seats[seatIdx].ledger.businesses.find((x) => x.id === event.assetId)
      log(
        t,
        seat.id,
        `Нанял управляющего в «${b.name}» за ${money(hireCost)}: забирает ${event.pct}%, остальное теперь работает без вас — ${money(
          Math.round((ownShare(after ?? b) * (100 - event.pct)) / 100),
        )}/мес в зачёт свободы`,
      )
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
          id: `of-${nextId(t)}`,
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
          id: `of-${nextId(t)}`,
          kind: 'coInvest',
          fromId: seat.id,
          toId: event.toId,
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
          id: `of-${nextId(t)}`,
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
          id: `of-${nextId(t)}`,
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

    /*
     * Обратная сторона займа: в жизни просит тот, кому нужно, а не предлагает
     * тот, у кого есть. Предложение записывается на будущего кредитора
     * (fromId) — он же его и принимает, деньги идут тем же путём, что и в
     * OFFER_LOAN. Согласие остаётся за владельцем денег.
     */
    case 'ASK_LOAN': {
      const lender = t.seats.find((x) => x.id === event.fromId)
      if (!lender || lender.outOfGame || lender.id === seat.id) return prev
      const amount = Math.max(0, Math.round(event.amount))
      if (amount <= 0) return prev
      t.offers = [
        ...t.offers,
        {
          id: `of-${nextId(t)}`,
          kind: 'loan',
          fromId: lender.id,
          toId: seat.id,
          amount,
          expiresAtTurn: t.turnCounter + 2,
          bids: [],
        },
      ]
      log(t, seat.id, `${seat.name} просит у ${lender.name} ${money(amount)} без надбавки`)
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
            id: `${card.id}-${nextId(t)}`,
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
          /*
           * 🔴 Деньги у покупателя списывает САМ BUY_REAL_ESTATE / BUY_BUSINESS
           * (там downPayment = price). Отдельный ADJUST_CASH здесь снимал цену
           * ВТОРОЙ раз — покупатель платил вдвое и часто уходил в минус.
           */
          // Продавец получает цену за вычетом долга, который уходит вместе с активом.
          if (re)
            seatLedgerEvent(t, from.id, {
              type: 'SELL_REAL_ESTATE',
              assetId: o.assetId!,
              salePrice: price,
              debtTransfers: true,
            })
          else
            seatLedgerEvent(t, from.id, {
              type: 'SELL_BUSINESS',
              assetId: o.assetId!,
              salePrice: price,
              debtTransfers: true,
            })
          const common = {
            id: `${o.assetId}-${nextId(t)}`,
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
            id: `${card.id}-${nextId(t)}`,
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
          /*
           * 🔴 Доля соинвестора должна лечь ЕМУ В ПОРТФЕЛЬ, иначе он платит
           * деньги и не получает ничего: у инициатора доход уже урезан на
           * investorShare, а этот кусок просто испарялся. Долг остаётся на том,
           * кто ведёт объект, — соинвестор внёс живые деньги, а не обязательство.
           */
          const partShare = {
            id: `${card.id}-part-${nextId(t)}`,
            name: `${localizedCardTitle(card)} · доля ${Math.round(share * 100)}%`,
            cost: Math.round(card.cost * share),
            downPayment: 0,
            cashFlow: Math.round(card.cashFlow * share),
            category: card.category,
            partnerId: from.id,
          }
          if (card.kind === 'realEstate') {
            seatLedgerEvent(t, buyer.id, { type: 'BUY_REAL_ESTATE', ...partShare, mortgage: 0 })
          } else {
            seatLedgerEvent(t, buyer.id, { type: 'BUY_BUSINESS', ...partShare, liability: 0 })
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
              id: `ln-${nextId(t)}`,
              lenderId: from.id,
              borrowerId: buyer.id,
              amount: o.amount,
              repaid: 0,
              atTurn: t.turnCounter,
            },
          ]
          if (o.interestPct) {
            /*
             * 🔴 Надбавка сверху — и оба получают долговую нагрузку. Не только
             * должник: дал под процент — беды приходят и к тебе. Это и есть
             * разница между займом и ростовщичеством.
             */
            const owe = Math.round((o.amount * (100 + o.interestPct)) / 100)
            seatLedgerEvent(t, buyer.id, { type: 'ADJUST_RIBA_EXPOSURE', amount: owe })
            seatLedgerEvent(t, from.id, { type: 'ADJUST_RIBA_EXPOSURE', amount: o.amount })
            log(
              t,
              buyer.id,
              `${buyer.name} взял у ${from.name} ${money(o.amount)} под ${o.interestPct}% — вернуть ${money(owe)}. Нагрузка легла на обоих`,
            )
          } else {
            log(t, buyer.id, `${buyer.name} взял у ${from.name} ${money(o.amount)} без надбавки — вернуть столько же`)
          }
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
