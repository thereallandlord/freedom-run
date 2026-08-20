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
  /** Платёж по процентному кредиту: это плата за деньги, тело им не гасится. */
  ribaPayment: number
}

export interface Liabilities {
  homeMortgage: number
  schoolLoans: number
  carLoans: number
  creditCards: number
  retailDebt: number
  /** Беспроцентный заём: платёж уменьшает тело, переплаты нет. */
  bankLoan: number
  /**
   * Процентный кредит — отдельно от беспроцентного, они не смешиваются.
   * Пока он открыт, у игрока чаще случаются неприятности: это не скрытый
   * штраф, а видимая в панели долговая нагрузка. Решение брать или нет —
   * его собственное, и игра его не запрещает.
   */
  ribaLoan: number
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
  /**
   * Вошёл в чужую находку на условиях доли с прибыли: кому и сколько процентов
   * отдать при продаже. Отщипывается автоматически и только с ПРИБЫЛИ — делить
   * убыток нечестно.
   */
  profitShareTo?: string
  profitSharePct?: number
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
  /**
   * 🔴 РЫНОЧНАЯ СТОИМОСТЬ объекта — то, за сколько он стоит НА РЫНКЕ, без
   * наценки за рассрочку. У купленного в рассрочку `cost` — это цена с
   * наценкой (6 млн превращаются в 7,5 млн), и выкуп «за 140% стоимости»
   * считался от неё: игрок получал вдвое больше вложенного и рынок работал
   * печатным станком. Продажа считается от этой величины.
   */
  value?: number
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
   * Нанят управляющий: какую долю потока он забирает.
   * 🔴 Пока управляющего нет, бизнес приносит ДЕНЬГИ, но не приближает свободу:
   * ты в нём работаешь сам. Наняли — часть дохода уходит ему, зато остаток
   * идёт в зачёт выхода из круга. Это и есть переход от самозанятости
   * к владению, и ради него игра и затевалась.
   */
  managerPct?: number
  /**
   * Партнёрский бизнес GreenLeaf. Если поле есть — доход этого актива считает
   * НЕ cashFlow, а движок GreenLeaf: пакет-множитель, растущая структура,
   * пенсия за ранг, просадки. Правила живут в engine/greenleaf.ts.
   */
  gl?: import('./greenleaf').GlState
  installmentMonthly?: number
  partnerId?: string
  /** Рыночная стоимость без наценки за рассрочку — от неё считается выкуп. */
  value?: number
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
  /** Сколько зарплат ещё идёт беспроцентный период по кредиту. */
  ribaGraceLeft?: number
  /** Подряд отказов от хотелок — по ним наступает выгорание. */
  wantsRefused?: number
  /**
   * Долг с надбавкой, в котором игрок участвует ЛЮБОЙ стороной.
   * 🔴 Считается в риск наравне с банковским кредитом: дал под процент —
   * неприятности приходят и к тебе. Риба портит сделку с обеих сторон.
   */
  ribaExposure?: number
  /**
   * Второй паспорт. Не инвестиция: потока не даёт вообще, зато снимает целый
   * класс бед — «платёж не прошёл», «счёт не открыть», «сервис недоступен».
   * Условие настоящее: Турция даёт гражданство за 400 тысяч долларов в
   * недвижимости, Карибы — за взнос без всякой недвижимости.
   */
  citizenship?: string
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
  /**
   * Кому платят: всем за столом или только тому, кто вытянул карту.
   * 🔴 Поле было В ДАННЫХ, но нигде не объявлено и нигде не прочитано:
   * «Кэшбек года» писал «тебе упало 8000 ₽», а деньги получали ВСЕ.
   */
  scope?: 'all' | 'self'
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
  /**
   * Окно на повышение пакета. Анвар за всю партию так и не увидел
   * предложения перейти с Бриллианта на Корону — карточки просто не было,
   * хотя сама доплата в игре есть.
   */
  upgrade?: boolean
  /**
   * Промоушен. Приходит только тому, у кого закрыт план и прошли сроки.
   * У путешествия есть ВЫБОР: забрать деньгами или поехать.
   * 🔴 Про награду за поездку в карточке НЕ пишем — её узнают, только если поедут.
   */
  promo?: 'travel' | 'auto'
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
  /**
   * Хотелка — трата по желанию, а не по нужде. От неё МОЖНО отказаться.
   * 🔴 Но кто отказывается всё время и только копит — выгорает и выпадает из
   * игры на несколько ходов. Жить тоже надо.
   */
  want?: boolean
  /** Что останется в расходах навсегда: содержание, подписка, страховка. */
  upkeep?: number
}

/**
 * На каких условиях владелец находки пускает в неё остальных.
 *
 * 🔴 По умолчанию НИКОГО: карта выпала одному человеку, это его находка.
 * Раньше любой мог купить ту же бумагу по той же цене без спроса — и вся
 * ценность удачного хода испарялась. За офлайновым столом так не играют:
 * там спрашивают разрешения и договариваются об условиях.
 */
export interface DealAccess {
  mode: 'closed' | 'open' | 'chosen'
  /** Кого пускаем поимённо при mode='chosen'. За столом можно объединяться. */
  allow: string[]
  terms:
    | { kind: 'free' }
    /** Вошедший при продаже отдаёт долю СВОЕЙ прибыли владельцу карты. */
    | { kind: 'profitShare'; pct: number }
    /** Разовая плата за вход, дальше никаких хвостов. */
    | { kind: 'fee'; amount: number }
}

export type DeckName = 'small' | 'big' | 'market' | 'doodad'

/** Мировое событие: приходит по таймеру, а не по ходу, и задевает всех. */
export type WorldEffect =
  | { kind: 'assetPrice'; categories: string[]; pct: number }
  | { kind: 'assetFlow'; categories: string[]; pct: number }
  | { kind: 'stockPrice'; symbols: string[]; pct: number }
  | { kind: 'cashAll'; amount: number }
  /**
   * Бьёт по всем, КРОМЕ тех, у кого второй паспорт. Ровно та польза, ради
   * которой его и получают: платежи проходят, счета открываются, сервисы
   * работают. Дохода паспорт не даёт — он снимает трение.
   */
  | { kind: 'frictionAll'; amount: number }
  | { kind: 'expenseAll'; pct: number }
  | { kind: 'salaryAll'; pct: number }
  /**
   * Событие про партнёрский бизнес: структуры у ВСЕХ владельцев растут быстрее
   * (или медленнее) несколько ближайших зарплат. Просьба Камиля: партнёрский
   * путь должен жить не только своими карточками, но и общими новостями.
   */
  | { kind: 'glGrowthAll'; points: number; paydays: number }

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
  /** Показывали ли уже карту партнёрского бизнеса — она выдаётся одной из первых. */
  glSeen?: boolean
  /** Сколько малых сделок игрок уже открыл. Оставлено для старых партий. */
  smallSeen?: number
  /**
   * На каком по счёту СВОЁМ ходу игроку откроется партнёрский бизнес.
   * 🔴 Раньше здесь был номер малой сделки, и это оказалось совсем другой
   * единицей: клеток «возможность» половина, счётчик двигался только на
   * «Малой», а боты всегда берут крупную. По замеру 58% игроков видели карту
   * позже четвёртого хода, каждый десятый ждал больше двенадцати.
   */
  glSlot?: number
  /** Сколько ходов игрок сделал сам. Считается при переигровке журнала. */
  turnsTaken?: number
  isBot: boolean
  botDifficulty: BotDifficulty
  /** Пожертвование на Полосе свободы: даёт 3 кубика до конца партии. */
  ftCharity: boolean
}

/** Что сейчас требует решения игрока. */
export type Pending =
  | { kind: 'chooseDeal' }
  /**
   * `decided` — кто уже решил по этой карте (купил или пропустил).
   * 🔴 Раньше карта закрывалась в тот момент, когда владелец нажимал
   * «Купить», — и допущенные в сделку не успевали ничего сделать: окно
   * исчезало у них из-под рук. Теперь карта живёт, пока не решат все.
   */
  | {
      kind: 'deal'
      deck: 'small' | 'big'
      card: DealCard
      access?: DealAccess
      decided?: string[]
    }
  | { kind: 'market'; card: MarketCard; access?: DealAccess; decided?: string[] }
  | { kind: 'doodad'; card: DoodadCard }
  /**
   * Встал ровно на клетку зарплаты. Отдельное окно, потому что иначе ход
   * выглядел как «ничего не произошло»: деньги приходили молча, а карточки
   * не было — человек не понимал, за что.
   */
  | { kind: 'payday'; amount: number }
  /**
   * Кто-то вырвался из Круга. Событие стола, а не личное: за настоящим столом
   * это видят все и это главный момент партии.
   */
  | { kind: 'freedom'; seatId: string; buyout: number }
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
  /**
   * Счётчик выданных идентификаторов активов.
   * 🔴 Раньше id собирали из длины журнала, а журнал обрезается на 300 строках:
   * после этого номера начинали повторяться, и продажа одного актива уносила
   * другой с тем же id.
   */
  idSeq: number
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
