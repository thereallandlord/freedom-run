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
  /** Платёж по рассрочке, уже вычтенный из cashFlow. Ноль — куплено налом. */
  installmentMonthly?: number
  /** Кто соинвестор, если актив куплен в долях. */
  partnerId?: string
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
  /**
   * Партнёрский бизнес GreenLeaf. Если поле есть — доход этого актива считает
   * НЕ cashFlow, а движок GreenLeaf: пакет-множитель, растущая структура,
   * пенсия за ранг, просадки. Правила живут в engine/greenleaf.ts.
   */
  gl?: import('./greenleaf').GlState
  installmentMonthly?: number
  partnerId?: string
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
  /** Сколько зарплат получено — по нему наступает срок закята. */
  paydays: number
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

/**
 * Один живой эффект рынка. Живёт заданное число мировых событий и гаснет.
 * Срок нужен, чтобы обстановка менялась: рынок дышит, а не застывает навсегда.
 */
export interface MarketEffect {
  /** Из какого мирового события пришёл — для подписи игроку. */
  eventId: string
  title: string
  kind: 'price' | 'flow' | 'stock'
  /** Категория актива или тикер бумаги. */
  key: string
  mul: number
  /** До какого значения worldTick действует. */
  until: number
}

export interface StockSplitCard {
  kind: 'stockSplit'
  id: string
  title: string
  flavor: string
  symbol: string
  direction: 'split' | 'reverse'
  /** Настоящий коэффициент сплита: Nvidia 10:1 в 2024-м, Apple 4:1 в 2020-м. По умолчанию 2. */
  ratio?: number
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

/**
 * Событие партнёрского бизнеса. Приходит ТОЛЬКО тому, у кого этот бизнес есть —
 * как и беды по кафе приходят владельцу кафе.
 *
 * 🔴 Беда здесь особого рода: она не забирает деньги, а ТОРМОЗИТ рост. Ровно
 * одно исключение — выбывший лидер, там доход правда проседает. Так это и в
 * жизни: худшее, что бывает, — потраченное впустую время, а не потеря вложенного.
 */
export interface GlEventCard {
  kind: 'glEvent'
  id: string
  title: string
  flavor: string
  /** Разовая ступенька: доход структуры сразу вырастет на столько процентов. */
  boostPct?: number
  /** Насколько ускорится дальнейший рост — накопительный эффект. */
  growthPct?: number
  /** Просадка дохода на время (выбыл лидер, выгорел наставник). */
  dipPct?: number
  dipPaydays?: number
  /** Рост встал: воронку заблокировали, команда ушла отдыхать. */
  freezePaydays?: number
  /** Золотой треугольник: предложение купить ещё два кабинета. */
  triangle?: boolean
  triangleCost?: number
}

export type MarketCard =
  | SellOfferCard
  | StockPriceCard
  | StockSplitCard
  | WindfallCard
  | PayRaiseCard
  | GlEventCard

export interface DoodadCard {
  id: string
  title: string
  flavor: string
  amount: number
  financeable: boolean
}

export type DeckName = 'small' | 'big' | 'market' | 'doodad'

/** Мировое событие: приходит по таймеру, а не по ходу, и задевает всех. */
export type WorldEffect =
  | { kind: 'assetPrice'; categories: string[]; pct: number }
  | { kind: 'assetFlow'; categories: string[]; pct: number }
  | { kind: 'stockPrice'; symbols: string[]; pct: number }
  | { kind: 'cashAll'; amount: number }
  | { kind: 'expenseAll'; pct: number }
  | { kind: 'salaryAll'; pct: number }

export interface WorldEvent {
  id: string
  title: string
  flavor: string
  effect: WorldEffect
  severity: 'мягкое' | 'заметное' | 'сильное'
}

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
  /** Порядок мировых событий и сколько уже сыграно. */
  worldDeck: { order: number[]; next: number }
  /** Множители рынка, накопленные мировыми событиями. */
  /**
   * Что сейчас творится на рынке. Три словаря — это ПРОИЗВОДНОЕ от списка
   * живых эффектов, их пересчитывает `recalcMarket` после каждого события.
   *
   * 🔴 Раньше словари были источником правды и копились НАВСЕГДА: «Анталья
   * забита» поднимала доход и не отпускала до конца партии, а «Дубай прижал
   * посуточку» после неё не возвращала исходное из-за округления. Плюс
   * `assetFlow` переписывал доход прямо у объектов — и купленный ПОЗЖЕ объект
   * оставался с базовым доходом, хотя рынок для него тот же.
   */
  market: {
    /** Цена класса активов при продаже: категория → множитель. */
    price: Record<string, number>
    /** Доход класса активов: категория → множитель. */
    flow: Record<string, number>
    /** Котировки тикеров: символ → множитель. */
    stock: Record<string, number>
  }
  /** Живые эффекты рынка со сроком годности. */
  marketEffects: MarketEffect[]
  /** Сколько мировых событий уже прошло — часы для срока годности эффектов. */
  worldTick: number
  /** Последнее мировое событие — чтобы показать его всем. */
  lastWorldEvent: { id: string; at: number } | null
  /** Живые предложения между игроками. */
  offers: import('./trades').Offer[]
  /** Беспроцентные займы между игроками. */
  loans: import('./trades').PlayerLoan[]
}
