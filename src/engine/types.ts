// ─── Профессии и финансы ──────────────────────────────────────────────

export interface Expenses {
  taxes: number
  homeMortgagePayment: number
  schoolLoanPayment: number
  carPayment: number
  creditCardPayment: number
  retailPayment: number
  otherExpenses: number
  bankLoanPayment: number
}

export interface Liabilities {
  homeMortgage: number
  schoolLoans: number
  carLoans: number
  creditCards: number
  retailDebt: number
  bankLoan: number
}

/** Долги, которые можно погасить целиком, и платёж, который при этом исчезает. */
export const DEBT_TO_PAYMENT = {
  homeMortgage: 'homeMortgagePayment',
  schoolLoans: 'schoolLoanPayment',
  carLoans: 'carPayment',
  creditCards: 'creditCardPayment',
  retailDebt: 'retailPayment',
} as const

export type PayableDebt = keyof typeof DEBT_TO_PAYMENT

export interface Profession {
  id: string
  name: string
  salary: number
  savings: number
  perChildExpense: number
  expenses: Omit<Expenses, 'bankLoanPayment'>
  liabilities: Omit<Liabilities, 'bankLoan'>
}

// ─── Активы ───────────────────────────────────────────────────────────

export interface StockLot {
  id: string
  symbol: string
  shares: number
  costPerShare: number
  dividendPerShareMonthly: number
}

export interface RealEstateAsset {
  id: string
  name: string
  cost: number
  downPayment: number
  mortgage: number
  cashFlow: number
  category: string
  investorShare?: number
}

export interface BusinessAsset {
  id: string
  name: string
  cost: number
  downPayment: number
  liability: number
  cashFlow: number
  category: string
  /** Доля инвестора в потоке и выручке (0–1). Хозяин получает (1 − share). */
  investorShare?: number
  /** Партнёрский бизнес: прирост потока на каждый день зарплаты, до потолка. */
  growthPerPayday?: number
  growthCap?: number
}

export interface FtBusiness {
  id: string
  name: string
  downPayment: number
  cashFlow: number
}

export interface FastTrackState {
  beginningIncome: number
  goalIncome: number
  businesses: FtBusiness[]
  dream?: { name: string; pricePaid: number }
}

export type LedgerPhase = 'ratRace' | 'fastTrack' | 'won' | 'gameOver'

/** Финансовое состояние одного игрока. */
export interface Ledger {
  playerName: string
  phase: LedgerPhase
  cash: number
  profession: Profession
  salary: number
  expenses: Expenses
  liabilities: Liabilities
  /** Питомцы (в оригинале — «дети»). Максимум 3. */
  pets: number
  stocks: StockLot[]
  realEstate: RealEstateAsset[]
  businesses: BusinessAsset[]
  charityTurnsLeft: number
  fastTrack?: FastTrackState
  winReason?: 'dream' | 'cashflowGoal'
}

// ─── Карты ────────────────────────────────────────────────────────────

export interface StockCard {
  kind: 'stock'
  id: string
  symbol: string
  title: string
  flavor: string
  price: number
  range: [number, number]
  dividendPerShare?: number
}

export interface RealEstateCard {
  kind: 'realEstate'
  id: string
  title: string
  flavor: string
  category: string
  cost: number
  downPayment: number
  mortgage: number
  cashFlow: number
}

export interface BusinessCard {
  kind: 'business'
  id: string
  title: string
  flavor: string
  category: string
  cost: number
  downPayment: number
  liability: number
  cashFlow: number
  /** Партнёрский бизнес: поток растёт со временем. */
  growthPerPayday?: number
  growthCap?: number
}

export type DealCard = StockCard | RealEstateCard | BusinessCard

export interface SellOfferCard {
  kind: 'sellOffer'
  id: string
  title: string
  flavor: string
  category: string
  multiplierPct: number
}

export interface StockPriceCard {
  kind: 'stockPrice'
  id: string
  title: string
  flavor: string
  symbol: string
  price: number
}

export interface StockSplitCard {
  kind: 'stockSplit'
  id: string
  title: string
  flavor: string
  symbol: string
  direction: 'split' | 'reverse'
}

export interface WindfallCard {
  kind: 'windfall'
  id: string
  title: string
  flavor: string
  flatAmount?: number
  amountPerRealEstate?: number
  /** Выплата только владельцам партнёрского бизнеса (автопромоушен и т.п.). */
  amountPerPartnership?: number
}

export interface PayRaiseCard {
  kind: 'payRaise'
  id: string
  title: string
  flavor: string
  amount: number
}

export type MarketCard = SellOfferCard | StockPriceCard | StockSplitCard | WindfallCard | PayRaiseCard

export interface DoodadCard {
  id: string
  title: string
  flavor: string
  amount: number
  financeable: boolean
}

export type DeckName = 'small' | 'big' | 'market' | 'doodad'

// ─── Поля ─────────────────────────────────────────────────────────────

export type RatSpace =
  | 'opportunity'
  | 'market'
  | 'doodad'
  | 'charity'
  | 'paycheck'
  | 'baby'
  | 'downsized'

export type FastSpace =
  | { type: 'cashflowDay' }
  | { type: 'taxAudit' }
  | { type: 'lawsuit' }
  | { type: 'divorce' }
  | { type: 'downsized' }
  | { type: 'charity' }
  | { type: 'business'; name: string; flavor: string; downPayment: number; cashFlow: number }
  | { type: 'venture'; name: string; flavor: string; downPayment: number; cashFlow: number; threshold: number }
  | { type: 'dream'; name: string; flavor: string; price: number }

// ─── Стол ─────────────────────────────────────────────────────────────

export type BotDifficulty = 'easy' | 'medium' | 'high' | 'unreal'

export interface Seat {
  id: string
  name: string
  color: string
  track: 'rat' | 'fast'
  position: number
  ledger: Ledger
  /** Индекс клетки мечты на Полосе свободы. */
  dreamSpace: number
  skipTurns: number
  outOfGame: boolean
  /** Уже победил — выходит из очереди ходов, остальные доигрывают. */
  won: boolean
  isBot: boolean
  botDifficulty: BotDifficulty
  /** Пожертвование на Полосе свободы: даёт 3 кубика до конца партии. */
  ftCharity: boolean
}

/** Что сейчас требует решения игрока. */
export type Pending =
  | { kind: 'chooseDeal' }
  | { kind: 'deal'; deck: 'small' | 'big'; card: DealCard }
  | { kind: 'market'; card: MarketCard }
  | { kind: 'doodad'; card: DoodadCard }
  | { kind: 'charity' }
  | { kind: 'downsized' }
  | { kind: 'ftBusiness'; space: number }
  | { kind: 'ftVenture'; space: number; rolled?: number }
  | { kind: 'ftDream'; space: number }
  | { kind: 'ftCharity' }
  | { kind: 'bankruptcy' }
  | { kind: 'gameOver' }

export interface LogEntry {
  at: number
  seatId: string | null
  text: string
}

export type TablePhase = 'awaitingRoll' | 'resolving' | 'turnEnd' | 'finished'

export interface Table {
  seed: number
  /** Счётчик обращений к ГПСЧ — состояние генератора живёт в самом столе. */
  rngCursor: number
  deckTheme: 'classic' | 'offshore' | 'ru'
  seats: Seat[]
  turnIndex: number
  phase: TablePhase
  pending: Pending | null
  /** Очередь клеток/карт, которые ещё надо разрешить в этот ход. */
  decks: Record<DeckName, { order: number[]; next: number }>
  lastRoll: number[] | null
  /** Сколько раз соперники вставали на каждую клетку мечты. */
  dreamBumps: Record<number, number>
  /** Кто уже выкупил инвестиционную клетку Полосы. */
  ftOwnership: Record<number, string>
  log: LogEntry[]
  winnerId: string | null
  turnCounter: number
}
