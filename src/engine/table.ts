import type {
  BotDifficulty,
  DealCard,
  DeckName,
  DoodadCard,
  Ledger,
  MarketCard,
  Pending,
  Seat,
  StockCard,
  Table,
  TablePhase,
} from './types'
import { DEBT_TO_PAYMENT } from './types'
import type { LedgerEvent, TableEvent, TableEventBody } from './events'
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
  MANAGER_PCT,
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
import { правкиПравил } from './правки'
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
  надбавкаИностранца,
} from './ledger'
import { mulberry32, shuffleIndices } from './rng'
import {
  GL_LUCK_MAX,
  GL_LUCK_MIN,
  GL_START_FLOW,
  GL_PROMOS,
  GL_ACCEL_POINTS,
  GL_MAX_GROWTH_PCT,
  glUpgradeOptions,
  GL_TRIANGLE_BONUS,
  glPackage,
  glPromoReady,
  glTotalIncome,
  glUpgradeCost,
  glПришлиЛюди,
  glПереливНаставника,
  glСтадия,
} from './greenleaf'
import {
  auctionWinner,
  clampPrice,
  fairAssetPrice,
  fairCardPrice,
  loanOutstanding,
  loanOwed,
  offerAlive,
  splitProceeds,
  type Offer,
} from './trades'

export interface SeatSetup {
  /**
   * Идентификатор игрока из комнаты.
   * 🔴 Раньше место звали просто `seat-0`, `seat-1` — по порядку в списке. В
   * сетевой партии порядок у двух клиентов мог разойтись, и тогда «ходит
   * Анвар» на одном экране означало «ходит Камиль» на другом: номер тот же,
   * человек другой. Теперь личность приезжает вместе с составом.
   */
  id?: string
  name: string
  professionId: string
  dreamSpace: number
  /**
   * Цвет фишки, выбранный в лобби.
   *
   * 🔴 Раньше его сюда не клали вовсе, и стол раздавал цвета сам, по порядку
   * мест. Человек выбирал синюю фишку, а по доске ехала зелёная. Функция для
   * переноса цветов в комнате была написана — и НИ РАЗУ не вызывалась.
   * Необязательный: одиночная партия цвет не выбирает, там порядок и решает.
   */
  color?: string
  isBot: boolean
  botDifficulty: BotDifficulty
}

export interface TableSetup {
  seed: number
  deckTheme: DeckTheme
  seats: SeatSetup[]
}


/**
 * Гарантия: партнёрский бизнес показывается не позже четвёртого хода.
 *
 * 🔴 Решение Камиля 20.08: «в один из первых четырёх, но на четвёртый уже
 * обязана». Обычно карта приходит на клетке «возможность» — это красиво, но
 * это не гарантия: клеток «возможность» половина, и по замеру до четвёртого
 * хода их успевали застать 87% игроков. Остальным карта здесь и выдаётся —
 * в свободную минуту хода, когда на столе больше ничего не лежит.
 *
 * Ничего не вытесняет: если на клетке уже что-то разыгралось, ждём следующего
 * свободного момента. Поэтому обычный ход правило не ломает.
 */
const GL_ГАРАНТИЯ_ХОД = 4

function отдатьGreenleafВСрок(t: Table, seatIdx: number) {
  const seat = t.seats[seatIdx]
  if (t.pending) return
  if (seat.track !== 'rat') return
  if (seat.glSeen === true) return
  if ((seat.turnsTaken ?? 0) < GL_ГАРАНТИЯ_ХОД) return
  if (seat.ledger.businesses.some((b) => b.gl)) return
  const card = smallDeals(t.deckTheme).find((c) => (c as { greenleaf?: boolean }).greenleaf)
  if (!card) return
  t.seats[seatIdx] = { ...t.seats[seatIdx], glSeen: true }
  t.pending = { kind: 'deal', deck: 'small', card: scaled(card) }
  t.phase = 'resolving'
}

// ─── Создание стола ───────────────────────────────────────────────────

/**
 * Правила режима: RU = рубли, халяль (без процентных кредитов), реалистичный
 * выкуп при выходе из Круга.
 *
 * 🔴 Вынесено ОТДЕЛЬНО и наружу, потому что эти числа читает не только стол:
 * панель хозяина показывает их владельцу как «правила игры». Пока они жили
 * внутри создания стола, панель, открытая до первой партии, показывала бы
 * не те числа — то есть врала бы ровно в том месте, ради которого её и
 * заводили.
 */
export const THEME_RULES: Record<'ru' | 'classic' | 'offshore', Parameters<typeof setRules>[0]> = {
  ru: {
    currency: 'RUB',
    fastTrackMultiplier: 50,
    fastTrackTarget: 1_000_000,
    loansEnabled: false,
    yieldScale: 1,
    zakat: { enabled: true, pct: 2.5, everyPaydays: 12 },
    lifestyleCreepPct: 33,
  },
  classic: {
    currency: 'USD',
    fastTrackMultiplier: 100,
    fastTrackTarget: 150_000,
    loansEnabled: true,
    yieldScale: 1,
    zakat: { enabled: false, pct: 2.5, everyPaydays: 12 },
  },
  offshore: {
    currency: 'USD',
    fastTrackMultiplier: 100,
    fastTrackTarget: 150_000,
    loansEnabled: true,
    yieldScale: 1,
    zakat: { enabled: false, pct: 2.5, everyPaydays: 12 },
  },
}

export function createTable(setup: TableSetup): Table {
  const theme = setup.deckTheme
  setActiveTheme(theme)
  setFastBoardTheme(theme)
  /*
   * 🔴 Правила темы, а СВЕРХУ — правки хозяина. Порядок важен: тема задаёт
   * основу, панель её точечно поправляет. Наоборот было бы бессмысленно —
   * смена темы стирала бы правку.
   *
   * Берём только числа и только те ключи, что в правилах УЖЕ ЕСТЬ: опечатка в
   * панели иначе добавила бы правилам лишнее поле, а настоящее осталось бы
   * прежним, и правка «не сработала» бы молча.
   */
  const базовые = THEME_RULES[theme] ?? THEME_RULES.classic
  const свои: Record<string, number> = {}
  for (const [k, v] of Object.entries(правкиПравил())) {
    if (typeof v === 'number' && k in RULES) свои[k] = v
  }
  setRules({ ...базовые, ...свои })
  const pool = professionsFor(theme)
  const seats: Seat[] = setup.seats.map((s, i) => {
    const profession = pool.find((p) => p.id === s.professionId) ?? pool[0]
    return {
      id: s.id ?? `seat-${i}`,
      name: s.name,
      color: s.color ?? TOKEN_COLORS[i % TOKEN_COLORS.length],
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
      glEvent: {
        order: shuffleIndices(
          marketCards(theme).filter((c) => c.kind === 'glEvent').length,
          setup.seed + 5,
        ),
        next: 0,
      },
      bizEvent: {
        order: shuffleIndices(
          marketCards(theme).filter((c) => c.kind === 'bizEvent').length,
          setup.seed + 6,
        ),
        next: 0,
      },
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
    лента: [],
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

/**
 * Сколько мировых событий держится эффект рынка.
 *
 * 🔴 БОЛЬШЕ НЕ ИСПОЛЬЗУЕТСЯ движком: новость держится до следующей новости и
 * снимается ею начисто. Число оставлено только затем, чтобы старые партии,
 * записанные прежним кодом, читались без ошибки.
 */
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

/**
 * Событие покупки актива — ОДНА точка сборки на все пути входа в сделку.
 *
 * 🔴 До 18.08 актив собирали в трёх местах по-своему: обычная покупка через
 * dealTerms, а перекуп находки и вход через партнёра — «как получится».
 * Итог: купленный у игрока объект приносил в 5,5 раза больше, чем свой
 * такой же, потому что рассрочки в тех ветках просто не было. Позвать
 * партнёра или перекупить всегда было выгоднее, чем купить самому, и весь
 * урок про то, что под рассрочку объект себя не кормит, обнулялся.
 */
function dealAssetEvent(
  t: Table,
  card: import('./types').DealCard & { category?: string },
  id: string,
  opts: { payCash: boolean; investorShare?: number; partnerId?: string },
): Extract<LedgerEvent, { type: 'BUY_REAL_ESTATE' } | { type: 'BUY_BUSINESS' }> {
  if (card.kind === 'stock') throw new Error('бумаги покупаются другим событием')
  const kind = card.kind === 'realEstate' ? 'realEstate' : 'business'
  const terms = dealTerms(card, kind)
  const payCash = opts.payCash
  const common = {
    id,
    name: localizedCardTitle(card),
    cost: payCash ? terms.cashPrice : terms.instTotal,
    // Рыночная цена одна и та же независимо от способа покупки.
    value: terms.cashPrice,
    downPayment: payCash ? terms.cashPrice : terms.instDown,
    cashFlow: payCash ? terms.cashFlow : terms.instFlow,
    category: card.category ?? '',
    investorShare: opts.investorShare,
    partnerId: opts.partnerId,
    installmentMonthly: payCash ? 0 : terms.instMonthly,
  }
  return card.kind === 'realEstate'
    ? { type: 'BUY_REAL_ESTATE', ...common, mortgage: payCash ? 0 : terms.instDebt }
    : {
        type: 'BUY_BUSINESS',
        ...common,
        liability: payCash ? 0 : terms.instDebt,
        growthPerPayday: (card as { growthPerPayday?: number }).growthPerPayday,
        growthCap: (card as { growthCap?: number }).growthCap,
      }
}

/**
 * Расчёт с соинвестором при продаже объекта.
 *
 * 🔴 Партнёр вкладывал живые деньги и при продаже не получал НИЧЕГО, а его
 * зеркальная доля продолжала приносить доход с уже проданного объекта —
 * деньги из воздуха с одной стороны и обман с другой. Делить выручку можно
 * только на уровне стола: applyEvent видит один кошелёк и не может двигать
 * деньги между игроками.
 */
function settleCoInvestor(
  t: Table,
  owner: Seat,
  asset: { id: string; investorShare?: number; partnerId?: string },
  net: number,
) {
  if (!asset.partnerId || !asset.investorShare) return
  const partner = t.seats.find((x) => x.id === asset.partnerId)
  if (!partner) return
  const cut = Math.round(net * asset.investorShare)
  if (cut !== 0) {
    seatLedgerEvent(t, partner.id, { type: 'ADJUST_CASH', amount: cut })
    log(
      t,
      partner.id,
      `${partner.name} получил ${money(cut)} — доля ${Math.round(asset.investorShare * 100)}% с продажи «${
        (asset as { name?: string }).name ?? 'объекта'
      }» у ${owner.name}`,
    )
  }
  // Зеркальная доля партнёра снимается вместе с объектом — иначе она платила бы вечно.
  const idx = t.seats.findIndex((x) => x.id === partner.id)
  if (idx < 0) return
  const pl = t.seats[idx].ledger
  /*
   * Зеркало партнёра — это `<id карты>-part-<номер>`, а у владельца
   * `<id карты>-<номер>`. Номера разные, поэтому сверяем по ИМЕНИ КАРТЫ:
   * снимаем у владельца хвост «-цифры» и ищем то же начало с «-part-».
   */
  const cardKey = asset.id.replace(/-\d+$/, '')
  const mirror = (a: { partnerId?: string; id: string }) =>
    a.partnerId === owner.id && a.id.startsWith(`${cardKey}-part-`)
  t.seats[idx] = {
    ...t.seats[idx],
    ledger: {
      ...pl,
      realEstate: pl.realEstate.filter((a) => !mirror(a)),
      businesses: pl.businesses.filter((a) => !mirror(a)),
    },
  }
}

/** Списать или начислить по мировому событию, не уводя наличные в минус. */
function payWorldAmount(t: Table, s: Seat, amount: number) {
  const take = amount < 0 ? -Math.min(Math.max(0, s.ledger.cash), -amount) : amount
  if (take === 0) return
  seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount: take })
  if (amount < 0 && take > amount) {
    log(t, s.id, `${s.name}: списано ${money(-take)} — больше на счету не было`)
  }
}

export function applyWorldEvent(prev: Table, index: number): Table {
  const t = cloneTable(prev)
  const ev = WORLD_EVENTS[index]
  if (!ev) return prev
  const e = ev.effect
  const mul = (pct: number) => 1 + pct / 100

  t.worldTick += 1
  /*
   * 🔴 НОВОЕ СОБЫТИЕ СНИМАЕТ ПРЕДЫДУЩЕЕ НАЧИСТО.
   *
   * Раньше эффекты копились по три слоя и медленно рассасывались: на доске
   * одновременно висели три новости, множители перемножались, и понять, во
   * что теперь оценивается твоя квартира, было нельзя. Теперь в мире всегда
   * ровно одна новость — она и объясняет цифры.
   *
   * Сплит бумаг не трогаем: это не новость рынка, а необратимая смена
   * номинала, и она обязана пережить всё.
   */
  t.marketEffects = t.marketEffects.filter((x) => !x.fromWorld)
  const until = Number.MAX_SAFE_INTEGER
  const push = (kind: 'price' | 'flow' | 'stock', keys: string[], pct: number) => {
    for (const key of keys)
      t.marketEffects.push({
        eventId: ev.id,
        title: ev.title,
        kind,
        key,
        mul: mul(pct),
        until,
        fromWorld: true,
      })
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
    case 'glGrowthAll': {
      // Общая новость про партнёрский бизнес — ускоряет (или тормозит) всех, у кого он есть.
      for (const s2 of t.seats) {
        if (s2.outOfGame) continue
        const idx = t.seats.findIndex((x) => x.id === s2.id)
        const biz = s2.ledger.businesses.find((b) => b.gl)
        if (!biz?.gl) continue
        const businesses = s2.ledger.businesses.map((b) =>
          b.id === biz.id && b.gl
            ? {
                ...b,
                gl: {
                  ...b.gl,
                  // Ускорение общее и постоянное: событие поднимает сам темп,
                  // отдельного срока ему не нужно — так же работают карточки.
                  growthPct: Math.max(
                    1,
                    Math.min(GL_MAX_GROWTH_PCT, b.gl.growthPct + e.points),
                  ),
                },
              }
            : b,
        )
        t.seats[idx] = { ...s2, ledger: { ...s2.ledger, businesses } }
      }
      break
    }
    /*
     * 🔴 Мировое событие не может забрать больше, чем у человека есть на руках.
     * Раньше списывало вслепую и уводило наличные в минус, причём БЕЗ экрана
     * банкротства: он открывается только по своей зарплате, а событие приходит
     * посреди чужого хода. Через эту дыру в игре появлялись отрицательные
     * деньги, которых взяться неоткуда.
     */
    /*
     * Событие не может забрать больше, чем есть на руках, — но обязано
     * НАПИСАТЬ, сколько забрало на самом деле. Раньше молча списывало меньше
     * обещанного, и игрок не понимал, почему цифры не сходятся с плашкой.
     */
    case 'cashAll':
      for (const s of t.seats) {
        if (s.outOfGame) continue
        payWorldAmount(t, s, e.amount)
      }
      break
    case 'frictionAll':
      for (const s of t.seats) {
        if (s.outOfGame) continue
        if (s.ledger.citizenship) {
          log(t, s.id, `${s.name}: обошло стороной — выручил второй паспорт`)
          continue
        }
        payWorldAmount(t, s, e.amount)
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
  // Метка «когда»: берём тик мира, а не длину журнала — она обрезается.
  t.lastWorldEvent = { id: ev.id, at: t.worldTick }
  log(t, null, `🌍 ${ev.title}`)
  return t
}

/**
 * Взять следующее мировое событие.
 * 🔴 Колода кончилась — перетасовываем заново. Раньше возвращался order[0], и
 * после 27-го события мир до конца партии крутил ОДНО И ТО ЖЕ.
 */
/**
 * Следующее мировое событие.
 *
 * 🔴 КАЖДОЕ СОБЫТИЕ — НЕ БОЛЬШЕ ОДНОГО РАЗА ЗА ПАРТИЮ (решение Камиля).
 *
 * Раньше колода перетасовывалась при исчерпании, и новости шли по второму
 * кругу. За столом это читается плохо: «дрон попал в склад» второй раз за
 * вечер — уже не новость, а поломка. Мир не повторяется.
 *
 * Кончились — событий больше не будет вовсе, и это правильно: тридцати новостей
 * хватает на любую партию с запасом (при одной раз в десять минут это пять
 * часов игры). Возвращаем -1, вызывающий просто ничего не делает.
 */
/** Выполнено ли условие выхода новости прямо сейчас. */
function новостьУместна(t: Table, ev: import('./types').WorldEvent): boolean {
  const у = ev.требует
  if (!у?.категории?.length) return true
  const надо = Math.max(1, у.минВладельцев ?? 1)
  let сколько = 0
  for (const s of t.seats) {
    if (s.outOfGame) continue
    const есть =
      s.ledger.realEstate.some((a) => у.категории!.includes(a.category)) ||
      s.ledger.businesses.some(
        (a) => !(a as { gl?: unknown }).gl && у.категории!.includes(a.category),
      )
    if (есть) сколько += 1
    if (сколько >= надо) return true
  }
  return false
}

export function nextWorldEventIndex(t: Table): number {
  const d = t.worldDeck
  /*
   * 🔴 Ищем первую УМЕСТНУЮ новость, а не просто следующую. Указ о временном
   * управлении логистикой, когда логистики ни у кого нет, — пустая карточка,
   * а мировых событий за партию всего тридцать, и тратить их впустую нельзя.
   * Неподошедшие не выбрасываем: они остаются в колоде и выйдут, когда у
   * людей появится нужное.
   */
  for (let i = d.next; i < d.order.length; i++) {
    const ev = WORLD_EVENTS[d.order[i]]
    if (ev && новостьУместна(t, ev)) return d.order[i]
  }
  return -1
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
      glEvent: { ...t.decks.glEvent },
      bizEvent: { ...t.decks.bizEvent },
    },
    dreamBumps: { ...t.dreamBumps },
    ftOwnership: { ...t.ftOwnership },
    worldDeck: { ...t.worldDeck },
    market: { price: { ...t.market.price }, flow: { ...t.market.flow }, stock: { ...t.market.stock } },
    marketEffects: t.marketEffects.map((e) => ({ ...e })),
    лента: (t.лента ?? []).map((e) => ({ ...e })),
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

/** Сколько плашек храним. Больше не нужно: они живут секунды. */
const ЛЕНТА_ДЛИНА = 12

/**
 * Показать всем за столом, что сейчас произошло.
 *
 * 🔴 ЗАЧЕМ ОТДЕЛЬНО ОТ ЖУРНАЛА. Играют часто БЕЗ созвона, каждый со своего
 * телефона: человек видит, что у соседа изменились числа, и не понимает,
 * почему. Журнал для этого не годится — он обрезается на трёхстах строках,
 * и на один ход туда набегает до двадцати записей, из которых человеку нужны
 * одна-две.
 *
 * 🔴 `кому` — про тайну переговоров. Займы и предложения долей интерфейс
 * НАМЕРЕННО прячет от посторонних; лента не имеет права это раскрыть.
 *
 * Живёт в самом столе: переигрывается из журнала ходов детерминированно и
 * приезжает всем участникам сети без отдельной проводки.
 */
function плашка(
  t: Table,
  seatId: string | null,
  text: string,
  тон: 'нейтр' | 'добро' | 'худо' = 'нейтр',
  кому?: string[],
) {
  t.лента = [...(t.лента ?? []), { id: (t.лента?.length ?? 0) + t.turnCounter * 1000, seatId, text, тон, кому }]
  if (t.лента.length > ЛЕНТА_ДЛИНА) t.лента = t.лента.slice(-ЛЕНТА_ДЛИНА)
}

/** «12 акций», «1 акцию», «3 акции» — иначе плашка читается как отчёт робота. */
function бумаг(n: number): string {
  const сотня = n % 100
  const единица = n % 10
  if (сотня >= 11 && сотня <= 14) return 'акций'
  if (единица === 1) return 'акцию'
  if (единица >= 2 && единица <= 4) return 'акции'
  return 'акций'
}

/** Со знаком: «+45 000 ₽» читается иначе, чем «45 000 ₽». */
function signedMoney(n: number): string {
  return n > 0 ? `+${money(n)}` : money(n)
}

/** Имя игрока для плашки. Без него строка бесполезна: «купил» — а кто? */
function имя(t: Table, seatId: string | null | undefined): string {
  return t.seats.find((s) => s.id === seatId)?.name ?? 'Игрок'
}

function money(n: number): string {
  if (RULES.currency === 'RUB') {
    const s = Math.abs(Math.round(n)).toLocaleString('ru-RU')
    return n < 0 ? `−${s} ₽` : `${s} ₽`
  }
  const s = Math.abs(n).toLocaleString('en-US')
  return n < 0 ? `−$${s}` : `$${s}`
}

/**
 * Случайное число стола.
 *
 * 🔴 РАНЬШЕ СЛУЧАЙНОСТЬ ЗАВИСЕЛА ОТ ДЛИНЫ ЖУРНАЛА (`t.log.length`), а журнал
 * обрезается на 300 строках и вообще пишется по-разному в разных ветках.
 * В сетевой партии этого достаточно, чтобы у двоих разошлись колоды: у
 * одного выпадает Apple, у другого на том же ходу — Tesla. Теперь у стола
 * есть свой счётчик обращений: он часть состояния, едет вместе с журналом
 * ходов и одинаков у всех.
 */
function rng(t: Table, salt: number): number {
  t.rngCursor = (t.rngCursor ?? 0) + 1
  return mulberry32(t.seed + t.rngCursor * 2654435761 + salt)()
}

/**
 * Тянет из личной колоды первую УМЕСТНУЮ карту, не сжигая остальные.
 *
 * 🔴 Зачем отдельно от `draw`. Личные колоды — событий бизнеса и партнёрского
 * бизнеса — почти целиком состоят из карт «для своей стадии». Простой перебор
 * с `draw` сжигал всю колоду за одну клетку рынка: человек на первом году
 * пролистывал события сети из пяти точек, они уходили в отбой, и до них он
 * больше не доживал. Здесь неподошедшие ОСТАЮТСЯ ждать — как ждут мировые
 * новости, у которых пока нет адресата.
 */
function вытянутьУместную(t: Table, name: DeckName, cards: MarketCard[]): MarketCard | null {
  if (!cards.length) return null
  const d = t.decks[name]
  // Колода сменилась или кончилась — пересобираем и заходим с начала.
  if (d.order.length !== cards.length || d.next >= d.order.length) {
    d.order = shuffleIndices(
      cards.length,
      t.seed + (t.rngCursor = (t.rngCursor ?? 0) + 1) + name.length * 7919,
    )
    d.next = 0
  }
  for (let i = d.next; i < d.order.length; i++) {
    const c = cards[d.order[i]]
    if (!c || !marketCardIsLive(t, c)) continue
    // Найденную поднимаем на место курсора — остальные ждут своей очереди.
    const order = [...d.order]
    order[i] = order[d.next]
    order[d.next] = d.order[i]
    t.decks[name] = { order, next: d.next + 1 }
    return c
  }
  return null
}

/** Взять следующую карту колоды, перетасовав её при исчерпании. */
function draw(t: Table, deck: DeckName, size: number): number {
  const d = t.decks[deck]
  /*
   * 🔴 Размер сменился — колода пересобирается НЕМЕДЛЕННО.
   *
   * Дважды на одни грабли: и события GreenLeaf, и перекос к «своим» бумагам
   * дёргали чужой курсор со своим размером. Порядок оставался коротким до
   * самого исчерпания, и всё это время из большой колоды доставались только
   * первые несколько карт — «опять те же карточки». Теперь несовпадение
   * лечится на месте, а не живёт до конца прохода.
   */
  if (d.order.length !== size) {
    d.order = shuffleIndices(size, t.seed + (t.rngCursor = (t.rngCursor ?? 0) + 1) + deck.length * 7919)
    d.next = 0
  }
  if (d.next >= d.order.length) {
    d.order = shuffleIndices(size, t.seed + (t.rngCursor = (t.rngCursor ?? 0) + 1) + deck.length * 7919)
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

/**
 * Цена бумаги на СЕГОДНЯ — гуляет внутри своего диапазона.
 *
 * 🔴 Раньше у каждой бумаги была одна зашитая цена, и почти у всех она стояла
 * на 60–80% диапазона, то есть у верхней границы: покупать приходилось «на
 * хаях», а вилки цен не было вовсе. Дублировать карточки ради разных цен —
 * плодить колоду; вместо этого цену разыгрываем при выдаче, со смещением к
 * низу (низкие цены встречаются чаще высоких, как и в жизни).
 */
/**
 * Насколько цена жмётся к нижнему краю вилки. Больше число — реже дорого.
 *
 * 🔴 У мемкоинов перекос сильнее (решение Камиля 20.08): «шанс выстрелить
 * пусть будет пониже, но он всё равно будет». Запрещать их незачем — карточка
 * сама говорит, что заработок на таком активе считается недозволенным, а
 * решение остаётся за человеком. Это и есть та развилка, ради которой игра.
 */
const ПЕРЕКОС_ЦЕНЫ = 1.7
const ПЕРЕКОС_МЕМКОИНА = 3

function stockDrawPrice(t: Table, card: DealCard): DealCard {
  if (card.kind !== 'stock') return card
  const [lo, hi] = card.range
  if (!(hi > lo)) return card
  const u = rng(t, 8171)
  const перекос = (card as { meme?: boolean }).meme ? ПЕРЕКОС_МЕМКОИНА : ПЕРЕКОС_ЦЕНЫ
  const price = Math.round((lo + (hi - lo) * Math.pow(u, перекос)) / 100) * 100
  return { ...card, price: Math.max(lo, Math.min(hi, price)) }
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
): {
  seat: Seat
  assets: {
    id: string
    name: string
    kind: 'realEstate' | 'business'
    cost: number
    debt: number
    /** Доля соинвестора — без неё окно обещало владельцу всю выручку. */
    investorShare?: number
  }[]
}[] {
  const out: ReturnType<typeof marketMatches> = []
  for (const seat of t.seats) {
    if (seat.outOfGame || seat.track === 'fast') continue
    const assets = [
      ...seat.ledger.realEstate
        .filter((a) => a.category === category)
        .map((a) => ({
          id: a.id,
          name: a.name,
          kind: 'realEstate' as const,
          cost: a.cost,
          debt: a.mortgage,
          investorShare: a.investorShare,
        })),
      ...seat.ledger.businesses
        .filter((a) => a.category === category)
        .map((a) => ({
          id: a.id,
          name: a.name,
          kind: 'business' as const,
          cost: a.cost,
          debt: a.liability,
          investorShare: a.investorShare,
        })),
    ]
    if (assets.length) out.push({ seat, assets })
  }
  return out
}

/**
 * Может ли кто-то, кроме ходящего, действовать по открытой карте.
 * Нужно, чтобы карту рынка показывали всем, а не только активному игроку.
 */
/**
 * Кто ещё не решил по открытой карте.
 *
 * Считаем владельца находки и тех, кого он пустил. Ботов не считаем: они в
 * чужие сделки не заходят, а ждать их решения означало бы вечное окно.
 */
export function pendingUndecided(t: Table): Seat[] {
  const p = t.pending
  if (!p || (p.kind !== 'deal' && p.kind !== 'market')) return []
  const owner = t.seats[t.turnIndex]
  const decided = new Set(p.decided ?? [])
  const out: Seat[] = []
  if (!decided.has(owner.id) && !owner.isBot) out.push(owner)
  /*
   * 🔴 Рыночная карта ждёт ВСЕХ, кому есть что по ней решать.
   *
   * Раньше ждали только ходящего: он жал «Дальше», карта пропадала со
   * стола — и сосед, которому предлагали 130% за его дом, терял предложение,
   * не успев ответить. Продать по такой карте движок разрешает каждому
   * владельцу, значит и закрывать её раньше времени нельзя.
   *
   * Ждём только тех, у кого актив ЕСТЬ: иначе стол стоял бы на людях,
   * которым и жать-то нечего.
   */
  if (p.kind === 'market') {
    const заинтересован = (s2: Seat): boolean => {
      if (p.card.kind === 'sellOffer')
        return marketMatches(t, p.card.category).some((m) => m.seat.id === s2.id)
      if (p.card.kind === 'stockPrice')
        return stockHolders(t, p.card.symbol).some((h) => h.id === s2.id)
      return false
    }
    for (const s2 of t.seats) {
      if (s2.id === owner.id || s2.isBot || s2.outOfGame) continue
      if (decided.has(s2.id)) continue
      if (заинтересован(s2)) out.push(s2)
    }
    return out
  }
  if (p.access && p.access.mode !== 'closed') {
    for (const s2 of t.seats) {
      if (s2.id === owner.id || s2.isBot || s2.outOfGame) continue
      if (!accessAllows(p.access, s2.id)) continue
      if (!decided.has(s2.id)) out.push(s2)
    }
  }
  return out
}

/** Отметить решение игрока и закрыть карту, когда решили все. */
function markDecided(t: Table, seatId: string): void {
  const p = t.pending
  if (!p || (p.kind !== 'deal' && p.kind !== 'market')) return
  const decided = [...new Set([...(p.decided ?? []), seatId])]
  t.pending = { ...p, decided }
  if (pendingUndecided(t).length === 0) {
    t.pending = null
    t.phase = 'turnEnd'
  }
}

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

/**
 * Базовая цена бумаги — та, что напечатана на карточке сделки.
 * Нужна, чтобы считать ТЕКУЩУЮ стоимость портфеля: рынок двигает множитель,
 * а не цену покупки.
 */
export function stockBasePrice(theme: Table['deckTheme'], symbol: string): number {
  for (const c of smallDeals(theme)) {
    if (c.kind === 'stock' && c.symbol === symbol) return c.price
  }
  return 0
}

/** Цена бумаги СЕЙЧАС, с учётом мировых событий. */
export function stockPriceNow(t: Table, symbol: string): number {
  return marketStockPrice(stockBasePrice(t.deckTheme, symbol), t.market.stock[symbol])
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
/**
 * Скидка с наценки при досрочном закрытии рассрочки.
 *
 * 🔴 Без неё продажа объекта, купленного в рассрочку, почти всегда уходила в
 * минус: долг включает наценку за ВЕСЬ срок, а объект стоит рыночную цену.
 * Квартира за 9 млн превращалась в долг 10,55 млн, и выкуп даже за 115% его
 * не покрывал. В мурабахе так и делают: гасишь раньше — незаработанную часть
 * наценки списывают. Считаем её пропорционально непогашенному долгу.
 */
export function markupRebate(a: { cost: number; value?: number }, debt: number): number {
  const markup = Math.max(0, a.cost - (a.value ?? a.cost))
  if (markup <= 0 || a.cost <= 0) return 0
  return Math.round(markup * (debt / a.cost))
}

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

  /*
   * 🔴 Мемкоины попадаются РЕЖЕ остальных карт (просьба Камиля: «выпадают
   * слишком часто»). Их три штуки в малой колоде — при равных шансах это
   * почти каждая десятая находка, и стол превращался в казино. Сама
   * возможность заработать оставлена сознательно: карточка честно говорит,
   * что такой заработок недозволен, и решение остаётся за человеком — а
   * шанс выстрелить у них и так занижен ценой при выдаче.
   */
  if ((card as { meme?: boolean }).meme && rng(t, 7717) > 0.22) return false

  if (card.kind === 'business') {
    const owned = l.businesses.filter((b) => !b.gl).length
    if (owned === 0) return true
    // 1 бизнес → 55%, 2 → 30%, 3 → 17%, дальше всё реже, но никогда не ноль.
    const chance = Math.pow(0.55, owned)
    return rng(t, 4241) < chance
  }
  return true
}

/**
 * Пускает ли владелец находки этого игрока внутрь.
 * Молчание — отказ: пока условия не заданы, чужая карта закрыта.
 */

/**
 * Класс действия — кому оно вообще доступно.
 *
 * 🔴 Вопрос, на который отвечает класс, один: ЧЕЙ КОШЕЛЁК И ЧЬЯ ВЕЩЬ от этого
 * действия двигаются.
 *
 * · `ход` — двигает стол, а не кошелёк: бросок, выбор колоды, конец хода,
 *   условия входа в СВОЮ находку, распоряжение выпавшей картой, личные
 *   карточки хода. Только тот, чей ход.
 * · `карта` — карта лежит на столе, но платит каждый из своего кармана.
 *   Купить, пропустить, продать свою бумагу. Каждый, кого карта касается.
 * · `своё` — трогает только мой кошелёк и к карте на столе не привязано.
 *   Банк, портфель, управляющий, заём, ставка. В любой момент, но за себя.
 * · `ответ` — с моего согласия двигается ЧУЖОЙ кошелёк. Проверяется в самом
 *   обработчике: только он знает, кого спрашивают в этом предложении.
 * · `служебное` — не от человека: мировое событие, конец партии.
 */
type КлассДействия = 'ход' | 'карта' | 'своё' | 'ответ' | 'служебное'

const КЛАСС_ДЕЙСТВИЯ: Record<TableEventBody['type'], КлассДействия> = {
  // ── ход ──
  ROLL: 'ход',
  CHOOSE_DEAL: 'ход',
  END_TURN: 'ход',
  SET_ACCESS: 'ход',
  PAY_DOODAD: 'ход',
  SKIP_WANT: 'ход',
  ACCEPT_CHARITY: 'ход',
  DECLINE_CHARITY: 'ход',
  PAY_DOWNSIZED: 'ход',
  ENTER_FAST_TRACK: 'ход',
  BUY_FT_BUSINESS: 'ход',
  TRY_VENTURE: 'ход',
  BUY_DREAM: 'ход',
  ACCEPT_FT_CHARITY: 'ход',
  GL_PROMO_TAKE: 'ход',
  GET_CITIZENSHIP: 'ход',
  BANKRUPTCY_SELL: 'ход',
  BANKRUPTCY_HALVE: 'ход',
  BANKRUPTCY_RECOVER: 'ход',
  BANKRUPTCY_QUIT: 'ход',
  /*
   * 🔴 Распорядиться выпавшей картой может ТОЛЬКО тот, кому она выпала.
   * Здесь и была дыра с деньгами: впущенный в чужую сделку продавал чужую
   * находку от своего имени и забирал деньги себе, а у владельца карта
   * пропадала со стола.
   */
  OFFER_CARD: 'ход',
  OFFER_COINVEST: 'ход',

  // ── решение за себя по общей карте ──
  BUY_DEAL: 'карта',
  BUY_STOCK_SHARES: 'карта',
  PASS_CARD: 'карта',
  SELL_STOCK_LOT: 'карта',
  ACCEPT_OFFER: 'карта',

  // ── своё хозяйство ──
  GL_UPGRADE: 'своё',
  GL_BUY_TRIANGLE: 'своё',
  TAKE_RIBA: 'своё',
  REPAY_RIBA: 'своё',
  HIRE_MANAGER: 'своё',
  TAKE_LOAN: 'своё',
  REPAY_LOAN: 'своё',
  PAYOFF_ASSET: 'своё',
  PAY_OFF_DEBT: 'своё',
  OFFER_ASSET: 'своё',
  OFFER_LOAN: 'своё',
  ASK_LOAN: 'своё',
  OFFER_LOAN_WITH_INTEREST: 'своё',
  BID_OFFER: 'своё',
  REPAY_PLAYER_LOAN: 'своё',
  FORGIVE_LOAN: 'своё',

  // ── ответ на адресованное мне ──
  ACCEPT_OFFER_TRADE: 'ответ',
  CANCEL_OFFER: 'ответ',

  // ── служебное ──
  WORLD_EVENT: 'служебное',
  FINISH_GAME: 'служебное',
}

/**
 * Касается ли лежащая на столе карта этого игрока настолько, чтобы он мог
 * принять по ней решение за себя.
 */
function решаетПоКарте(t: Table, seatIdx: number): boolean {
  if (seatIdx === t.turnIndex) return true
  const p = t.pending
  if (!p) return false
  const id = t.seats[seatIdx].id
  // Владелец находки открыл вход — впущенный решает сам за себя.
  if (p.kind === 'deal' && accessAllows(p.access, id)) return true
  /*
   * Рыночная карта общая: обвал бумаг или предложение о покупке касаются
   * каждого, у кого есть подходящий актив, а не только ходящего.
   */
  if (p.kind === 'market') return true
  return false
}

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
    /*
     * 🔴 Объяснения партнёрского бизнеса ПОКАЗЫВАЕМ. Движок писал их и
     * выбрасывал — игра знала, почему изменился доход, и молчала об этом.
     * Живая жалоба 19.08: три раза за партию никто не понял, откуда деньги.
     */
    for (const note of t.seats[seatIdx].ledger.glNotes ?? []) log(t, seat.id, note)
  }
  if (payouts > 0) {
    const l = t.seats[seatIdx].ledger
    const amount = seat.track === 'rat' ? monthlyCashFlow(l, t.market.flow) : fastTrackIncome(l)
    log(t, seat.id, `Зарплата ×${payouts}: ${money(amount)}`)

    /*
     * 🔴 ОБРАЗ ЖИЗНИ РАСТЁТ ВСЛЕД ЗА ДОХОДОМ (правка Камиля: «расходы должны
     * расти с ростом доходов»). Классическая ловушка среднего класса: доход
     * с активов вырос — вырос и уровень жизни, и человек снова бежит по кругу.
     * Берём три процента от того, что активы приносят СВЕРХ зарплаты, и
     * только с ощутимых сумм: мелочь не должна плодить копеечные строки.
     */
    if (seat.track === 'rat') {
      const fromAssets = totalIncome(l, t.market.flow) - l.salary
      const creep = Math.round((fromAssets * 0.03) / 500) * 500
      if (creep >= 500) {
        seatLedgerEvent(t, seat.id, { type: 'ADD_UPKEEP', amount: creep })
        log(t, seat.id, `Образ жизни подрос: расходы +${money(creep)}/мес`)
      }
    }

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
        /*
         * 🔴 У ВЛАДЕЛЬЦА ПАРТНЁРСКОГО БИЗНЕСА события по нему выпадают чаще.
         * Он вложился в этот путь, а карточки роста структуры терялись среди
         * полусотни остальных: за сотню ходов человек видел одну-две. Сначала
         * пробуем найти карту про его бизнес, и только потом обычную.
         */
        const hasGl = seat.ledger.businesses.some((b) => b.gl)
        /*
         * 🔴 У обычного бизнеса та же беда, что была у партнёрского: на двенадцать
         * заведений в колодах приходилось ДВЕ карточки, и обе про выкуп. Человек
         * покупал кафе — и до конца партии с кафе не происходило ничего. Своя
         * колода событий лечит ровно это.
         */
        const hasBiz = seat.ledger.businesses.some((b) => !b.gl)
        if (hasBiz) {
          const bizDeck = deck.filter((c) => c.kind === 'bizEvent')
          // Если бизнесов два вида — кому сегодня событие, решает жребий, а не порядок в коде.
          const сначалаБизнес = !hasGl || rng(t, 7710) < 0.5
          if (сначалаБизнес) card = вытянутьУместную(t, 'bizEvent', bizDeck)
        }
        if (!card && hasGl) {
          const glDeck = deck.filter((c) => c.kind === 'glEvent')
          /*
           * 🔴 Тянем из СВОЕЙ колоды. Раньше здесь стоял курсор рынка, которому
           * подсовывали чужой размер, — и он перетасовывался на 15 позиций
           * вместо 56. После этого из 56 карт рынка доставались только первые
           * 15, и за столом это читалось как «опять те же карточки».
           *
           * Своя колода заодно даёт то, чего просил Камиль: пока не пройдут
           * все пятнадцать событий, ни одно не повторится.
           */
          card = вытянутьУместную(t, 'glEvent', glDeck)
        }
        // Не выпало партнёрское — добираем событие обычного бизнеса.
        if (!card && hasBiz) {
          card = вытянутьУместную(t, 'bizEvent', deck.filter((c) => c.kind === 'bizEvent'))
        }
        for (let tries = 0; !card && tries < 4; tries++) {
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
        if (risk > 0 && rng(t, 991) < risk) {
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
        /*
         * Клетки «baby» на русской доске нет — её заменили рынком. Ветка
         * оставлена для других досок: там она добавляет ребёнка, то есть
         * ПОСТОЯННЫЙ расход, а не разовую трату.
         */
        seatLedgerEvent(t, seat.id, { type: 'PET' })
        const детей = t.seats[seatIdx].ledger.children
        log(t, seat.id, `В семье пополнение (детей: ${детей})`)
        t.phase = 'turnEnd'
        return
      }
      case 'downsized':
        t.pending = { kind: 'downsized' }
        t.phase = 'resolving'
        return
      case 'paycheck': {
        // Встал ровно на зарплату — показываем это окном, а не молчанием.
        const paid =
          seat.track === 'rat' ? monthlyCashFlow(l, t.market.flow) : fastTrackIncome(l)
        t.pending = {
          kind: 'payday',
          amount: paid,
          notes: t.seats[seatIdx].ledger.glNotes?.length
            ? [...t.seats[seatIdx].ledger.glNotes]
            : undefined,
        }
        /*
         * 🔴 ФАЗУ МЕНЯТЬ ОБЯЗАТЕЛЬНО. Здесь её не трогали, и стол оставался в
         * «ждём броска» с открытой карточкой зарплаты. Кнопка кубика про
         * карточку не знает — она смотрит только на фазу, — поэтому висела
         * поверх окна ЖИВОЙ: человек бросал второй раз, карточка зарплаты
         * стиралась непрочитанной, а ход выходил бесплатным. Замер на 400
         * партиях: 19 369 случаев, то есть карточку зарплаты не видел почти
         * никто.
         */
        t.phase = 'resolving'
        return
      }
    }
  }

  // ─── Полоса свободы ───
  const space = fastBoard()[seat.position]
  switch (space.type) {
    case 'cashflowDay':
      t.phase = 'turnEnd'
      return
    /*
     * 🔴 Четыре клетки Полосы списывали деньги МОЛЧА: движок менял счёт, а
     * объяснение уходило строкой в журнал. За столом это выглядело как
     * «просто стало меньше денег, и никто не понял почему». Теперь каждая
     * показывает карточку — с тем, что было и что стало.
     */
    case 'taxAudit':
    case 'lawsuit': {
      const before = l.cash
      seatLedgerEvent(t, seat.id, { type: space.type === 'taxAudit' ? 'TAX_AUDIT' : 'LAWSUIT' })
      const after = t.seats[seatIdx].ledger.cash
      const проверка = space.type === 'taxAudit'
      log(t, seat.id, `${проверка ? 'Налоговая проверка' : 'Иск'}: минус ${money(before - after)}`)
      t.pending = {
        kind: 'ftEvent',
        title: проверка ? 'Налоговая проверка' : 'Иск в суде',
        text: проверка
          ? 'Проверка подняла отчётность за прошлые годы. Доначислили и списали со счёта.'
          : 'На вас подали в суд. Разбирательство закончилось выплатой.',
        before,
        after,
      }
      t.phase = 'resolving'
      return
    }
    case 'divorce': {
      // Имущество супругов раздельное — делить нечего. Бьют разовые расходы:
      // махр, раздел быта, суд, переезд. Считаем от масштаба жизни игрока.
      const before = l.cash
      const cost = Math.min(l.cash, Math.round((totalExpenses(l) * 4) / 1000) * 1000)
      seatLedgerEvent(t, seat.id, { type: 'DIVORCE', amount: cost })
      log(t, seat.id, `Развод: разовые расходы ${money(cost)} — махр, раздел быта, переезд`)
      t.pending = {
        kind: 'ftEvent',
        title: 'Развод',
        text: 'Имущество у супругов раздельное — делить нечего. Бьют разовые траты: махр, раздел быта, суд, переезд.',
        before,
        after: t.seats[seatIdx].ledger.cash,
      }
      t.phase = 'resolving'
      return
    }
    case 'downsized': {
      const before = l.cash
      const amount = fastTrackIncome(l)
      seatLedgerEvent(t, seat.id, { type: 'FT_DOWNSIZED', amount })
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 2 }
      log(t, seat.id, `Сокращение: минус ${money(amount)}, пропуск 2 ходов`)
      t.pending = {
        kind: 'ftEvent',
        title: 'Доход просел',
        text: 'Дела встали: месячный доход в этот раз не пришёл, и на восстановление нужно время.',
        before,
        after: t.seats[seatIdx].ledger.cash,
        skip: 2,
      }
      t.phase = 'resolving'
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

/** «1 месяц / 2 месяца / 5 месяцев» — чтобы в тексте не было «3 месяцов». */
function склонениеЗарплат(n: number): string {
  const д = n % 10
  const дд = n % 100
  if (дд >= 11 && дд <= 14) return 'месяцев'
  if (д === 1) return 'месяц'
  if (д >= 2 && д <= 4) return 'месяца'
  return 'месяцев'
}

/**
 * Стадия жизни обычного бизнеса: 1 — первый год, 2 — встал на ноги, 3 — вырос.
 *
 * 🔴 Считаем по тому, что в игре УЖЕ ЕСТЬ, а не заводим новый счётчик.
 * Управляющий — это и есть «бизнес крутится без тебя»: пока его нет, ты сам за
 * прилавком. Второй бизнес — это уже сеть, и задачи там другие. Отдельный
 * «возраст актива» пришлось бы хранить и переигрывать, а он не дал бы ничего
 * сверх этого.
 */
export function бизнесСтадия(l: import('./types').Ledger): 1 | 2 | 3 {
  const свои = l.businesses.filter((b) => !b.gl)
  if (!свои.length) return 1
  if (!свои.some((b) => b.managerPct)) return 1
  /*
   * 🔴 «Вырос» — это не только вторая точка. Замер на 80 партиях: третья
   * стадия выпадала 2 раза из 90 событий, то есть тринадцать карточек про
   * сеть спали почти всегда. И по жизни неправда: «Сеть шаурмы в Питере
   * (3 точки)» за 183 500 в месяц — уже сеть, сколько бы строк она ни
   * занимала в отчёте. Поэтому второй признак — размер дела.
   */
  const поток = свои.reduce((s, b) => s + b.cashFlow, 0)
  return свои.length >= 2 || поток >= 180_000 ? 3 : 2
}

/** Подходит ли событие бизнеса этому игроку: и по стадии, и по виду дела. */
export function событиеБизнесаУместно(t: Table, card: import('./types').BizEventCard): boolean {
  const свои = currentSeat(t).ledger.businesses.filter((b) => !b.gl)
  if (!свои.length) return false
  if (card.categories?.length && !свои.some((b) => card.categories!.includes(b.category ?? ''))) {
    return false
  }
  if (card.stages?.length && !card.stages.includes(бизнесСтадия(currentSeat(t).ledger))) {
    return false
  }
  return true
}

/** Есть ли в карте рынка хоть какое-то живое действие для стола. */
function marketCardIsLive(t: Table, card: MarketCard): boolean {
  /*
   * 🔴 Событие обычного бизнеса не показываем тому, у кого бизнеса нет: это
   * ровно та ошибка, из-за которой карточки партнёрского бизнеса приходили
   * людям без него и тратились впустую.
   */
  if (card.kind === 'bizEvent') {
    if (!событиеБизнесаУместно(t, card)) return false
    /*
     * Предложение управляющего бессмысленно тому, у кого он уже есть: кнопка
     * была бы, а нажать её движок не дал бы. Такие карточки просто ждут.
     */
    if (card.managerPct != null) {
      const свои = currentSeat(t).ledger.businesses.filter(
        (b) => !b.gl && (!card.categories?.length || card.categories.includes(b.category ?? '')),
      )
      if (!свои.some((b) => !b.managerPct)) return false
    }
  }
  if (card.kind === 'glEvent') {
    const мой = currentSeat(t).ledger.businesses.find((b) => b.gl)?.gl
    const st = (card as unknown as { stages?: number[] }).stages
    if (мой && st && st.length && !st.includes(glСтадия(мой))) return false
  }
  // Окно на повышение пакета показываем только тем, кому есть куда расти.
  if (card.kind === 'glEvent' && card.upgrade) {
    return t.seats.some(
      (s) =>
        !s.outOfGame &&
        s.track === 'rat' &&
        s.ledger.businesses.some((b) => b.gl && glUpgradeOptions(b.gl.packageId).length > 0),
    )
  }
  switch (card.kind) {
    // Уместность уже проверена выше — сюда доходят только подходящие.
    case 'bizEvent':
      return true
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
      /*
       * Промоушен — карта ХОДЯЩЕГО: он её и разыгрывает. Раньше проверяли
       * «есть ли за столом хоть кто-то с закрытым планом», и карта падала
       * человеку без структуры, у которого кнопки не работали вовсе.
       */
      const p = GL_PROMOS.find((x) => x.id === card.promo)
      if (!p) return false
      const g = currentSeat(t).ledger.businesses.find((b) => b.gl)?.gl
      return !!g && glPromoReady(g, p).ready
    }
  }
}

/** Сплиты, выплаты и повышения применяются сразу — решать нечего. */
function applyMarketAuto(t: Table, card: MarketCard) {
  if (card.kind === 'bizEvent') {
    /*
     * 🔴 Событие ЛИЧНОЕ: касается только ходящего и только его обычных
     * бизнесов. Если карточка названа по виду дела — задевает лишь такие
     * заведения. Так пожар в кофейне не бьёт по типографии за соседним столом.
     */
    const seat = currentSeat(t)
    const цели = seat.ledger.businesses.filter(
      (b) => !b.gl && (!card.categories?.length || card.categories.includes(b.category ?? '')),
    )
    if (!цели.length) return
    const заметки: string[] = []
    for (const b of цели) {
      if (card.flowPct) {
        const было = b.cashFlow
        // Навсегда — значит прямо в поток актива, до сотни.
        b.cashFlow = Math.max(0, Math.round((было * (1 + card.flowPct / 100)) / 100) * 100)
        заметки.push(
          `${b.name}: доход ${card.flowPct > 0 ? 'вырос' : 'упал'} с ${money(было)} до ${money(b.cashFlow)} в месяц`,
        )
      }
      if (card.dipPct) {
        b.dipMul = 1 - card.dipPct / 100
        b.dipLeft = card.dipPaydays ?? 3
        заметки.push(
          `${b.name}: доход просел на ${card.dipPct}% на ${b.dipLeft} ${склонениеЗарплат(b.dipLeft)}`,
        )
      }
    }
    if (card.cash) {
      seat.ledger.cash += card.cash
      заметки.push(card.cash > 0 ? `На счёт пришло ${money(card.cash)}` : `Со счёта ушло ${money(-card.cash)}`)
    }
    for (const з of заметки) log(t, seat.id, з)
    if (card.managerPct != null) {
      // Ничего не применяем: это предложение, а не событие. Решает игрок.
      плашка(t, seat.id, `${seat.name}: ${card.title}`, 'добро')
      return
    }
    const тон = (card.flowPct ?? 0) > 0 || (card.cash ?? 0) > 0 ? 'добро' : 'худо'
    плашка(t, seat.id, `${seat.name}: ${card.title}`, тон)
    return
  }
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

      /*
       * 🔴 БИНАР: карточка может привести живых людей в ноги. Тогда игрок
       * получает РАЗОВЫЕ деньги — за лично приглашённого и за закрытый уровень,
       * — и видит, что решает слабая нога. Ежемесячный доход это не трогает:
       * он и есть бонус ширины, второй раз его платить нельзя.
       */
      let разово = 0
      const объяснения: string[] = []
      const c = card as unknown as {
        pvLeft?: number
        pvRight?: number
        pvPersonal?: number
        mentorPv?: number
      }
      if (c.mentorPv) {
        const r = glПереливНаставника(g, c.mentorPv)
        Object.assign(g, r.next)
        разово += r.деньги
        объяснения.push(...r.заметки)
      }
      if (c.pvLeft || c.pvRight) {
        const r = glПришлиЛюди(g, c.pvLeft ?? 0, c.pvRight ?? 0, c.pvPersonal ?? 0)
        Object.assign(g, r.next)
        разово += r.деньги
        объяснения.push(...r.заметки)
      }

      biz.gl = g
      biz.cashFlow = glTotalIncome(g)
      if (разово > 0) seatLedgerEvent(t, s.id, { type: 'ADJUST_CASH', amount: разово })
      log(t, s.id, `${s.name}: ${card.title} — доход по партнёрскому бизнесу теперь ${money(glTotalIncome(g))}/мес`)
      for (const о of объяснения) log(t, s.id, о)
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
    // Личная выплата — только вытянувшему; общая — всем в Рутине.
    const only = card.scope === 'self' ? currentSeat(t).id : null
    for (const s of t.seats) {
      if (s.outOfGame || s.track === 'fast') continue
      if (only && s.id !== only) continue
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

  /*
   * 🔴 ДЕЙСТВУЮЩИЙ — АВТОР СОБЫТИЯ, а не тот, чей ход.
   *
   * Раньше здесь всегда стоял ходящий. На одном устройстве это одно и то же,
   * а в сети приводило к тому, что чужое нажатие тратило чужие деньги: Анвар
   * гасил свой долг, а гасился долг Камиля, потому что ход был его. Автор
   * приезжает в самом событии; если его нет (игра на одном устройстве) —
   * работаем как раньше, по ходящему.
   *
   * Действия, привязанные к ходу (бросок, выбор сделки, покупка, конец хода),
   * дополнительно проверяются ниже: их принимаем только от того, чей ход.
   */
  const byIdx = event.by ? t.seats.findIndex((s2) => s2.id === event.by) : -1
  /*
   * 🔴 Подпись есть, а места с таким идентификатором за столом НЕТ — событие
   * отклоняем. Раньше в этом случае действие молча применялось к ходящему:
   * второй игрок жал «Погасить» у себя, а гасилась рассрочка соседа. Лучше
   * ничего, чем чужой кошелёк.
   */
  if (event.by && byIdx < 0) return prev
  const seatIdx = byIdx >= 0 ? byIdx : t.turnIndex
  const seat = t.seats[seatIdx]
  const l = seat.ledger

  /*
   * 🔴 ЕДИНЫЙ СТРАЖ ПРАВ. Раньше здесь стоял список «действий хода», а всё,
   * чего в нём не было, мог прислать кто угодно — то есть каждая новая кнопка
   * была лотереей. Живая партия 19.08 показала цену: один игрок нажимал «Не
   * беру» за другого, посторонний принимал чужое предложение доли, впущенный
   * в чужую сделку мог ПРОДАТЬ ЧУЖУЮ НАХОДКУ и забрать деньги себе, а кнопка
   * «дать в долг» стояла у заёмщика — человек дал деньги сам себе.
   *
   * Теперь у каждого действия объявлен класс, и умолчания нет: `Record` по
   * всем типам событий не даст собраться, пока новому событию не назначен
   * класс. Правило закреплено в коде, а не в голове.
   */
  const класс = КЛАСС_ДЕЙСТВИЯ[event.type]
  if (byIdx >= 0 && класс !== 'служебное') {
    // Действие хода — только тому, чей ход.
    if (класс === 'ход' && byIdx !== t.turnIndex) return prev
    /*
     * Решение по общей карте принимает КАЖДЫЙ, кого карта касается: владелец
     * находки, кого он впустил, и владельцы подходящих активов на рыночной
     * карте. Ровно этот класс и зарубили 19.08, когда «Пропустить»
     * приглашённого сочли ходом за другого и стол встал намертво.
     */
    if (класс === 'карта' && !решаетПоКарте(t, byIdx)) return prev
    /*
     * Своё хозяйство — в любой момент, но только за себя. Если событие несёт
     * чужое место, это попытка распорядиться чужим кошельком.
     */
    const чужоеМесто = (event as { seatId?: string }).seatId
    if (класс === 'своё' && чужоеМесто && чужоеМесто !== t.seats[byIdx].id) return prev
  }

  switch (event.type) {
    case 'ROLL': {
      if (t.phase !== 'awaitingRoll') return prev
      const allowed = diceCountFor(seat)
      if (!allowed.includes(event.dice.length)) return prev
      if (event.dice.some((d) => d < 1 || d > 6 || !Number.isInteger(d))) return prev

      t.lastRoll = event.dice
      if (l.charityTurnsLeft > 0) seatLedgerEvent(t, seat.id, { type: 'CHARITY_TURN_USED' })

      // Свой ход считаем здесь: по нему открывается партнёрский бизнес.
      t.seats[seatIdx] = {
        ...t.seats[seatIdx],
        turnsTaken: (t.seats[seatIdx].turnsTaken ?? 0) + 1,
      }

      const steps = event.dice.reduce((a, b) => a + b, 0)
      log(t, seat.id, `Бросок: ${event.dice.join(' + ')} = ${steps}`)
      advance(t, seatIdx, steps)
      if ((t.phase as TablePhase) !== 'finished') resolveLanding(t, seatIdx)
      if ((t.phase as TablePhase) !== 'finished') отдатьGreenleafВСрок(t, seatIdx)
      return t
    }

    case 'CHOOSE_DEAL': {
      if (t.pending?.kind !== 'chooseDeal') return prev
      const list = event.size === 'small' ? smallDeals(t.deckTheme) : bigDeals(t.deckTheme)

      /*
       * Партнёрский бизнес открывается В ПЕРВЫЕ ЧЕТЫРЕ ХОДА игрока, на
       * случайном из них (решение Камиля 20.08: «в один из четырёх, но на
       * четвёртый обязана»).
       *
       * 🔴 Считаем СВОИ ХОДЫ, а не выбранные малые сделки. Раньше было по
       * малым сделкам, и это совсем другая единица: клеток «возможность»
       * половина, счётчик двигался только на «Малой», а боты вообще всегда
       * берут крупную. Замер на живом движке: 58% игроков видели карту позже
       * четвёртого хода, каждый десятый ждал 12+, худший случай 27.
       *
       * Поэтому и размер сделки больше не важен: подходит и «Малая», и
       * «Крупная» — человек уже дошёл до своего срока, ждать нечего.
       *
       * Номер хода разыгрывается один раз на игрока и живёт в его месте,
       * поэтому переигровка журнала даёт тот же результат.
       */
      // Карта лежит в малой колоде, но выдаётся независимо от выбранного размера.
      const glCard = smallDeals(t.deckTheme).find(
        (c) => (c as { greenleaf?: boolean }).greenleaf,
      )
      if (glCard && !seat.ledger.businesses.some((b) => b.gl) && seat.glSeen !== true) {
        const ходов = seat.turnsTaken ?? 0
        const slot = seat.glSlot ?? 1 + Math.floor(mulberry32(t.seed + seatIdx * 7717 + 55)() * 4)
        t.seats[seatIdx] = { ...t.seats[seatIdx], glSlot: slot }
        if (ходов >= slot) {
          t.seats[seatIdx] = { ...t.seats[seatIdx], glSeen: true }
          t.pending = { kind: 'deal', deck: event.size, card: scaled(glCard) }
          return t
        }
      }

      /*
       * 🔴 Лёгкий перекос в сторону бумаг, которые УЖЕ есть у кого-то за
       * столом (просьба Камиля). Так рынок вокруг них оживает: событие про
       * такую бумагу касается сразу нескольких, а докупить её можно осознанно.
       * Перекос слабый — одна дополнительная попытка из трёх.
       */
      const owned = new Set(
        t.seats.flatMap((s2) => s2.ledger.stocks.map((x) => x.symbol)),
      )
      let card = stockDrawPrice(t, scaled(list[draw(t, event.size, list.length)]))
      if (owned.size && card.kind !== 'stock' && rng(t, 5501) < 0.33) {
        const pool = list.filter((c) => c.kind === 'stock' && owned.has(c.symbol))
        if (pool.length) {
          /*
           * 🔴 ВОТ ЗДЕСЬ И ЖИЛИ ПОВТОРЫ. Выбор из горстки «своих» бумаг шёл
           * через курсор ОБЩЕЙ колоды, но с чужим размером: при исчерпании
           * колода сделок перетасовывалась на длину этой горстки — три-пять
           * позиций вместо полусотни. После этого из всей колоды доставались
           * только первые несколько карт, и за столом это читалось как
           * «опять те же карточки». Ровно та же мина, что была у событий
           * GreenLeaf.
           *
           * Перекос — это ЛОТЕРЕЯ, а не выдача из колоды: тянем броском,
           * порядок колоды не трогаем.
           */
          const i = Math.min(pool.length - 1, Math.floor(rng(t, 5502) * pool.length))
          card = stockDrawPrice(t, scaled(pool[i]))
        }
      }
      for (let tries = 0; tries < 6 && !dealDrawOk(t, card, event.size); tries++) {
        card = stockDrawPrice(t, scaled(list[draw(t, event.size, list.length)]))
      }
      t.pending = { kind: 'deal', deck: event.size, card }
      return t
    }

    case 'BUY_DEAL': {
      if (t.pending?.kind !== 'deal') return prev
      const card = t.pending.card
      if (card.kind === 'stock') return prev

      /*
       * 🔴 В чужую находку можно войти только с разрешения того, кому она
       * выпала, и на его условиях — ровно как у бумаг. Раньше окно выбора
       * условий у недвижимости было пустым ритуалом: движок его не читал.
       */
      // Владелец находки — ходящий; автор события может быть вошедшим.
      const dealOwner = t.seats[t.turnIndex]
      const dealBuyer = event.seatId ? t.seats.find((x) => x.id === event.seatId) : seat
      if (!dealBuyer || dealBuyer.outOfGame || dealBuyer.track === 'fast') return prev
      if (event.seatId && event.seatId !== seat.id && seat.id !== dealOwner.id) return prev
      if (dealBuyer.id !== dealOwner.id && !accessAllows(t.pending.access, dealBuyer.id)) return prev
      const dealTermsAccess =
        dealBuyer.id !== dealOwner.id ? t.pending.access?.terms : undefined

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
          GL_LUCK_MIN + rng(t, 0) * (GL_LUCK_MAX - GL_LUCK_MIN)
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
        плашка(
          t,
          seat.id,
          `${seat.name} вошёл в партнёрский бизнес, пакет «${glPkg.name}» за ${money(glPkg.price)}`,
          'добро',
        )
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
      const entryFee = dealTermsAccess?.kind === 'fee' ? dealTermsAccess.amount : 0
      if (dealBuyer.ledger.cash < owed + entryFee) return prev
      /*
       * 🔴 РЕЗИДЕНТ ВХОДИТ ДЕШЕВЛЕ ИНОСТРАНЦА — и в этом вся польза второго
       * паспорта. Возвращаем деньгами ПОСЛЕ покупки, а не прячем в цену: так
       * человек видит, за что заплатил за паспорт, и понимает это с первой же
       * сделки. Спрятанная скидка объясняла бы себя только цифрой на карточке,
       * которую не с чем сравнить.
       */
      const скидкаPct = надбавкаИностранца(dealBuyer.ledger, card.category)
      const возврат = скидкаPct > 0 ? Math.round((owed * скидкаPct) / 100) : 0
      if (entryFee > 0) {
        seatLedgerEvent(t, dealBuyer.id, { type: 'ADJUST_CASH', amount: -entryFee })
        seatLedgerEvent(t, dealOwner.id, { type: 'ADJUST_CASH', amount: entryFee })
        log(
          t,
          dealBuyer.id,
          `${dealBuyer.name} заплатил ${money(entryFee)} за вход в находку ${dealOwner.name}`,
        )
      }

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
      const assetEvent =
        card.kind === 'realEstate'
          ? ({
              type: 'BUY_REAL_ESTATE' as const,
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
          : ({
              type: 'BUY_BUSINESS' as const,
              id: `${card.id}-${nextId(t)}`,
              name: localizedCardTitle(card),
              cost: bookCost,
              downPayment: payCash ? fullPrice : card.downPayment,
              liability: debt,
              cashFlow: flow,
              category: card.category,
              growthPerPayday: (card as { growthPerPayday?: number }).growthPerPayday,
              growthCap: (card as { growthCap?: number }).growthCap,
              installmentMonthly: payCash ? 0 : monthly,
            })
      // Актив уходит ПОКУПАТЕЛЮ: им может быть и вошедший по разрешению.
      seatLedgerEvent(t, dealBuyer.id, assetEvent)
      log(
        t,
        dealBuyer.id,
        withInvestor
          ? `Вошёл в долю: ${localizedCardTitle(card)} — свои ${money(owed)}, доход и убыток пополам`
          : payCash
            ? `Купил налом: ${localizedCardTitle(card)} за ${money(fullPrice)} (${money(flow)}/мес, долгов нет)`
            : `Купил в рассрочку: ${localizedCardTitle(card)} — взнос ${money(card.downPayment)}, остаток ${money(debt)} фиксирован (${money(flow)}/мес)`,
      )
      плашка(
        t,
        dealBuyer.id,
        `${dealBuyer.name} купил «${localizedCardTitle(card)}» за ${money(
          payCash ? fullPrice : card.downPayment,
        )} · ${signedMoney(flow)}/мес`,
        flow > 0 ? 'добро' : 'нейтр',
      )
      if (возврат > 0) {
        seatLedgerEvent(t, dealBuyer.id, { type: 'ADJUST_CASH', amount: возврат })
        log(
          t,
          dealBuyer.id,
          `Второй паспорт: надбавку для иностранцев не взяли — вернулось ${money(возврат)}`,
        )
        плашка(
          t,
          dealBuyer.id,
          `${dealBuyer.name} вошёл как резидент — вернулось ${money(возврат)}`,
          'добро',
        )
      }
      /*
       * 🔴 Карта закрывается, когда решили ВСЕ участники, а не когда нажал
       * владелец. Раньше его «Купить» снимало окно у всех разом, и допущенные
       * в сделку не успевали купить свою долю.
       */
      markDecided(t, dealBuyer.id)
      return t
    }

    case 'BUY_STOCK_SHARES': {
      /*
       * 🔴 ДОКУПКА НА ПРОСАДКЕ. Карточка рынка «акции −45%» сообщала о
       * падении и предлагала только продать. Но именно в такой момент их и
       * докупают — и это решение игрока, а не колоды. Докупить можно ТУ ЖЕ
       * бумагу, которая у тебя уже есть: событие про неё и рассказывает.
       */
      if (t.pending?.kind === 'market' && t.pending.card.kind === 'stockPrice') {
        const mc = t.pending.card
        const shares2 = Math.floor(event.shares)
        if (shares2 <= 0) return prev
        const buyer2 = t.seats.find((x) => x.id === (event.seatId ?? seat.id))
        if (!buyer2 || buyer2.outOfGame || buyer2.track === 'fast') return prev
        if (event.by && (event.seatId ?? seat.id) !== event.by) return prev
        if (!buyer2.ledger.stocks.some((x) => x.symbol === mc.symbol)) return prev
        const total2 = shares2 * mc.price
        if (buyer2.ledger.cash < total2) return prev
        seatLedgerEvent(t, buyer2.id, {
          type: 'BUY_STOCK',
          id: `${mc.symbol}-${nextId(t)}`,
          symbol: mc.symbol,
          shares: shares2,
          costPerShare: mc.price,
          dividendPerShareMonthly: 0,
        })
        log(t, buyer2.id, `${buyer2.name} докупил ${shares2} × ${mc.symbol} по ${money(mc.price)}`)
        markDecided(t, buyer2.id)
        return t
      }
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
      /*
       * 🔴 ВЛАДЕЛЕЦ НАХОДКИ — ЭТО ХОДЯЩИЙ, а не автор события. Когда действие
       * подписано вошедшим, `seat` — это он сам, и сравнение «покупатель ==
       * seat» давало ложное «я владелец»: плата за вход не бралась, доля с
       * прибыли не записывалась, а чужая покупка закрывала карту всем.
       */
      const owner = t.seats[t.turnIndex]
      const buyer = event.seatId ? t.seats.find((x) => x.id === event.seatId) : seat
      if (!buyer || buyer.outOfGame || buyer.track === 'fast') return prev
      // Покупать за другого нельзя: либо за себя, либо это подделка события.
      if (event.seatId && event.seatId !== seat.id && seat.id !== owner.id) return prev
      if (buyer.id !== owner.id && !accessAllows(t.pending.access, buyer.id)) return prev

      const price = marketStockPrice(card.price, t.market.stock[card.symbol])
      const total = shares * price
      if (buyer.ledger.cash < total) return prev

      // Условия входа: разовая плата уходит владельцу находки сразу,
      // доля с прибыли вешается на лот и отщипнётся при продаже.
      const terms = buyer.id !== owner.id ? t.pending.access?.terms : undefined
      if (terms?.kind === 'fee') {
        if (buyer.ledger.cash < total + terms.amount) return prev
        seatLedgerEvent(t, buyer.id, { type: 'ADJUST_CASH', amount: -terms.amount })
        seatLedgerEvent(t, owner.id, { type: 'ADJUST_CASH', amount: terms.amount })
        log(t, buyer.id, `${buyer.name} заплатил ${money(terms.amount)} за вход в находку ${owner.name}`)
      }

      seatLedgerEvent(t, buyer.id, {
        type: 'BUY_STOCK',
        id: `${card.symbol}-${nextId(t)}`,
        symbol: card.symbol,
        profitShareTo: terms?.kind === 'profitShare' ? owner.id : undefined,
        profitSharePct: terms?.kind === 'profitShare' ? terms.pct : undefined,
        shares,
        costPerShare: price,
        dividendPerShareMonthly: card.dividendPerShare ?? 0,
      })
      log(t, buyer.id, `${buyer.name} купил ${shares} × ${card.symbol} по ${money(price)}`)
      // 🔴 В плашке ИТОГО, а не цена за штуку: за столом считают потраченное.
      плашка(t, buyer.id, `${buyer.name} купил ${shares} ${бумаг(shares)} ${card.symbol} за ${money(total)}`)
      markDecided(t, buyer.id)
      return t
    }

    /** Продать может любой держатель, пока карта на столе. */
    case 'SELL_STOCK_LOT': {
      /*
       * 🔴 СВОИ БУМАГИ ПРОДАЁТ ТОЛЬКО ВЛАДЕЛЕЦ. Раньше карточка рынка
       * показывала строки продажи по ВСЕМ держателям, и любой участник мог
       * продать чужие акции за него — деньги списывались и начислялись
       * человеку, который об этом даже не знал.
       */
      if (event.by && event.seatId !== event.by) return prev
      const holder = t.seats.find((s) => s.id === event.seatId)
      if (!holder || holder.outOfGame) return prev
      const lot = holder.ledger.stocks.find((x) => x.id === event.lotId)
      if (!lot) return prev
      const soldN = Math.min(event.shares, lot.shares)
      /*
       * 🔴 Цену берём СВОЮ, рыночную на сейчас, а не ту, что прислал клиент.
       * Иначе продать можно было бы по любому числу, а с появлением продажи
       * из портфеля (в любой момент, а не только по карточке рынка) это
       * перестало быть теорией.
       */
      /*
       * Цена продажи: если открыта карточка рынка по этой бумаге — её цена
       * (она и есть событие), иначе текущая рыночная. Присланную клиентом
       * цену не берём: продать можно было бы по любому числу.
       */
      const openCard =
        t.pending?.kind === 'market' && t.pending.card.kind === 'stockPrice'
          ? t.pending.card
          : null
      const fair =
        openCard && openCard.symbol === lot.symbol
          ? openCard.price
          : stockPriceNow(t, lot.symbol)
      const price = fair > 0 ? fair : event.pricePerShare
      seatLedgerEvent(t, event.seatId, {
        type: 'SELL_STOCK',
        lotId: event.lotId,
        shares: event.shares,
        pricePerShare: price,
      })
      log(
        t,
        event.seatId,
        `${holder.name} продал ${soldN} × ${lot.symbol} по ${money(price)}`,
      )
      /*
       * 🔴 Самый незаметный ход в игре: продать можно из портфеля в любой
       * момент, даже на чужом ходу, и на экране у остальных не менялось
       * НИЧЕГО, кроме числа наличных. Человек мог выйти в кэш, и стол не
       * замечал.
       */
      плашка(
        t,
        holder.id,
        `${holder.name} продал ${soldN} ${бумаг(soldN)} ${lot.symbol} за ${money(soldN * price)}`,
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
      /*
       * 🔴 СВОЙ ОБЪЕКТ ПРОДАЁТ ТОЛЬКО ВЛАДЕЛЕЦ. Карточка рынка перечисляла
       * подходящие объекты ВСЕХ игроков и любой мог нажать на чужую строку —
       * продать студию соседа за него. Та же дыра, что была с бумагами.
       */
      if (event.by && event.seatId !== event.by) return prev
      const card = t.pending.card
      const holder = t.seats.find((s) => s.id === event.seatId)
      if (!holder || holder.outOfGame || holder.track === 'fast') return prev

      const re = holder.ledger.realEstate.find((a) => a.id === event.assetId)
      const biz = holder.ledger.businesses.find((a) => a.id === event.assetId)
      const asset = re ?? biz
      if (!asset || asset.category !== card.category) return prev

      // Считаем от рыночной стоимости, а не от суммы с наценкой за рассрочку.
      const price = sellOfferPrice(
        asset.value ?? asset.cost,
        card.multiplierPct,
        t.market.price[asset.category] ?? 1,
      )
      const debtOnSale = re ? re.mortgage : (biz as { liability: number }).liability
      /*
       * При продаже рассрочка закрывается досрочно, значит незаработанную
       * наценку списывают — иначе продать купленное в рассрочку было бы
       * всегда убыточно, каким бы хорошим ни был рынок.
       */
      const rebate = markupRebate(asset, debtOnSale)
      // Расчёт с партнёром — до снятия актива, пока его доля ещё видна.
      settleCoInvestor(t, holder, asset, price - (debtOnSale - rebate))
      if (re) {
        seatLedgerEvent(t, event.seatId, { type: 'SELL_REAL_ESTATE', assetId: event.assetId, salePrice: price, rebate })
      } else {
        seatLedgerEvent(t, event.seatId, { type: 'SELL_BUSINESS', assetId: event.assetId, salePrice: price, rebate })
      }
      log(t, event.seatId, `${holder.name} продал «${asset.name}» за ${money(price)} (${card.multiplierPct}%)`)
      плашка(
        t,
        holder.id,
        `${holder.name} продал «${asset.name}» за ${money(price)} — это ${card.multiplierPct}% стоимости`,
        card.multiplierPct >= 100 ? 'добро' : 'худо',
      )
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
      }
      /*
       * 🔴 Постоянная добавка к расходам работает на ЛЮБОЙ карточке, а не
       * только на купленной хотелке. Без этого целый класс событий — «теперь
       * это с тобой каждый месяц» — существовать не мог, а именно такие
       * расходы и делают партию длиннее.
       */
      if (card.upkeep) {
        seatLedgerEvent(t, seat.id, { type: 'ADD_UPKEEP', amount: card.upkeep })
        log(t, seat.id, `Теперь это с вами каждый месяц: +${money(card.upkeep)} к расходам`)
      }
      if (card.child) {
        const было = t.seats[seatIdx].ledger.children
        seatLedgerEvent(t, seat.id, { type: 'PET' })
        const стало = t.seats[seatIdx].ledger.children
        if (стало > было) {
          const добавка = t.seats[seatIdx].ledger.profession.perChildExpense
          log(t, seat.id, `В семье пополнение: +${money(добавка)}/мес навсегда (детей: ${стало})`)
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
      if (balance <= 0) return prev
      const pay =
        event.amount == null ? balance : Math.max(0, Math.min(Math.round(event.amount), balance))
      if (pay <= 0 || l.cash < pay) return prev
      const payment = l.expenses[DEBT_TO_PAYMENT[event.debt]]
      const остаток = balance - pay
      seatLedgerEvent(t, seat.id, { type: 'PAY_OFF_DEBT', debt: event.debt, amount: event.amount })
      log(
        t,
        seat.id,
        остаток === 0
          ? `Закрыл долг: ${money(pay)} — платёж ${money(payment)}/мес больше не идёт`
          : `Внёс по долгу ${money(pay)}: осталось ${money(остаток)}, платёж стал ${money(
              Math.round((payment * остаток) / balance),
            )}/мес`,
      )
      return t
    }

    case 'ENTER_FAST_TRACK': {
      if (seat.track !== 'rat' || !isOutOfRatRace(l)) return prev
      // 🔴 Множитель берём из правил: в русском режиме он 50, а не 100 —
      // журнал обещал игроку вдвое больше, чем приходило на счёт.
      const buyout = RULES.fastTrackMultiplier * freedomIncome(l)
      const долгиБыли =
        l.liabilities.homeMortgage +
        l.liabilities.schoolLoans +
        l.liabilities.carLoans +
        l.liabilities.creditCards +
        l.liabilities.retailDebt +
        l.liabilities.bankLoan +
        l.liabilities.ribaLoan
      seatLedgerEvent(t, seat.id, { type: 'ENTER_FAST_TRACK' })
      t.seats[seatIdx] = { ...t.seats[seatIdx], track: 'fast', position: 0 }
      log(
        t,
        seat.id,
        долгиБыли > 0
          ? `🎉 Вырвался из Круга! Выкуп ${money(buyout)}, из него закрыты долги на ${money(долгиБыли)}`
          : `🎉 Вырвался из Круга! Выкуп ${money(buyout)}`,
      )
      плашка(t, seat.id, `🎉 ${seat.name} вырвался из Круга! Выкуп ${money(buyout)}`, 'добро')
      /*
       * 🔴 Показываем это ВСЕМ отдельным окном. Раньше выход из Круга
       * выглядел так: полоска цели дошла до ста процентов — и всё. Главный
       * момент игры проходил незамеченным.
       */
      t.pending = { kind: 'freedom', seatId: seat.id, buyout, долги: долгиБыли }
      /*
       * 🔴 И здесь фаза оставалась «ждём броска». Дальше выходило хуже, чем с
       * зарплатой: игрок бросал поверх карточки «Свобода», попадал на клетку
       * «день потока», та ставила конец хода — и стол оказывался в состоянии
       * «ход закончен, но карточка не погашена». Конец хода в нём
       * отклоняется, а он отправляется сам каждые три секунды: стол честно
       * замирал, и это ровно та жалоба «ход не передаётся».
       */
      t.phase = 'resolving'
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
      // Второй раз по той же карточке не бросают: исход уже на столе.
      if (t.pending.rolled != null) return prev
      const die = event.die
      if (!Number.isInteger(die) || die < 1 || die > 6) return prev
      const before = l.cash

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
        плашка(t, seat.id, `${seat.name}: выпало ${die} — проект выстрелил, +${money(space.cashFlow)}/мес`, 'добро')
      } else {
        seatLedgerEvent(t, seat.id, { type: 'FT_STAKE_LOST', amount: space.downPayment })
        log(t, seat.id, `🎲 ${die} — ставка ${money(space.downPayment)} сгорела`)
        плашка(t, seat.id, `${seat.name}: выпало ${die} — ставка ${money(space.downPayment)} сгорела`, 'худо')
      }
      /*
       * 🔴 Карточку НЕ убираем — показываем на ней, что выпало и чем это
       * кончилось. Раньше она исчезала мгновенно, и вся механика риска
       * проходила мимо человека: он видел только, что денег стало меньше.
       * Закроет её сам, нажав «Понятно».
       */
      if ((t.phase as TablePhase) !== 'finished') {
        t.pending = {
          ...t.pending,
          rolled: die,
          won: die >= space.threshold,
          before,
          after: t.seats[seatIdx].ledger.cash,
        }
        t.phase = 'resolving'
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
      /*
       * 🔴 Карточку и ход трогаем ТОЛЬКО если это твоя карточка. Событие
       * помечено «своё» — его вправе прислать кто угодно и в любой момент, — а
       * здесь оно обнуляло общий стол: сосед покупал себе два кабинета, и у
       * ходящего карточка исчезала из-под рук вместе с ходом.
       */
      if (seatIdx === t.turnIndex) {
        t.pending = null
        t.phase = 'turnEnd'
      }
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
        const r = () => rng(t, 3771)
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
          askedBy: seat.id,
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
      /*
       * 🔴 `null` — это «передумать»: условия снимаются и человек возвращается
       * к выбору. Раньше кнопка «передумать» слала «никого не пускаю» — то
       * есть меняла одно решение на другое, а не отменяла его, и выйти к
       * выбору было нельзя вовсе.
       */
      if (!event.access) {
        t.pending = { ...t.pending, access: undefined }
        log(t, seat.id, `${seat.name} передумал насчёт условий входа`)
        return t
      }
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
      /*
       * 🔴 ДОЛЮ НАЗНАЧАЕТ НЕ КЛИЕНТ. Раньше `pct` приходил из события как есть,
       * и ничто не мешало прислать ноль: управляющий работал бы даром, а бизнес
       * шёл бы в зачёт свободы целиком. Своя цена бывает только у предложения,
       * которое сейчас лежит на столе, — и только у ходящего.
       */
      const предложение =
        t.pending?.kind === 'market' &&
        t.pending.card.kind === 'bizEvent' &&
        t.pending.card.managerPct != null &&
        seatIdx === t.turnIndex
          ? t.pending.card.managerPct
          : null
      if (event.pct !== MANAGER_PCT && event.pct !== предложение) return prev
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
      /*
       * «Пропустить» — это тоже РЕШЕНИЕ, а не закрытие окна для всех. Пока
       * кто-то из допущенных не ответил, карта остаётся на столе.
       */
      if (t.pending.kind === 'deal' || t.pending.kind === 'market') {
        /*
         * 🔴 Владелец хода может СНЯТЬ карту со стола. Нажал «Пропустить»
         * второй раз — карта уходит, даже если кто-то из приглашённых так и
         * не ответил (отвлёкся, закрыл вкладку, потерял сеть). Без этого
         * выхода стол зависал навсегда и партию приходилось бросать.
         */
        const alreadyDecided = (t.pending.decided ?? []).includes(seat.id)
        if (alreadyDecided && seatIdx === t.turnIndex) {
          t.pending = null
          t.phase = 'turnEnd'
          return t
        }
        markDecided(t, seat.id)
        return t
      }
      t.pending = null
      t.phase = 'turnEnd'
      return t
    }

    case 'WORLD_EVENT': {
      const t2 = applyWorldEvent(t, event.index)
      /*
       * 🔴 Съедаем ИМЕННО ту новость, что вышла, а не «следующую по счёту».
       * Отложенные ждут своего часа: меняем вышедшую местами с текущей
       * позицией и двигаем курсор на одну. Без этого пропущенные новости
       * терялись бы навсегда, стоило один раз перескочить через них.
       */
      const order = [...t2.worldDeck.order]
      const где = order.indexOf(event.index, t2.worldDeck.next)
      if (где >= 0) {
        order[где] = order[t2.worldDeck.next]
        order[t2.worldDeck.next] = event.index
      }
      t2.worldDeck = { order, next: t2.worldDeck.next + 1 }
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
          askedBy: seat.id,
          expiresAtTurn: t.turnCounter + 1,
          bids: [],
        },
      ]
      log(
        t,
        seat.id,
        amount === 0
          ? `Отдаёт свою находку «${localizedCardTitle(card)}» даром`
          : `Предложил другим свою находку «${localizedCardTitle(card)}» за ${money(amount)}`,
      )
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
          askedBy: seat.id,
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
          askedBy: seat.id,
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
          askedBy: seat.id,
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
          askedBy: seat.id,
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
      /*
       * 🔴 ОТВЕЧАЕТ ТОТ, КОМУ ПРЕДЛОЖИЛИ. Раньше согласие принималось от кого
       * угодно: сосед мог согласиться за тебя — войти в долю твоими деньгами
       * или принять сделку, которую предлагали не ему. Подпись события
       * говорит, кто нажал; сверяем её с адресатом.
       */
      /*
       * 🔴 Отвечает ТА СТОРОНА, КОТОРУЮ СПРАШИВАЮТ, — то есть не автор.
       *
       * Раньше здесь стояли три проверки, написанные под одну сторону сделки
       * («я продаю — ты покупаешь»), и на займе они выворачивались наизнанку:
       * требовали, чтобы нажал получатель денег, и ПРЯМО ЗАПРЕЩАЛИ нажать
       * владельцу денег. Отсюда живой случай 19.08 — кнопка «Дать» стояла у
       * заёмщика, и человек дал деньги сам себе.
       */
      const автор = o.askedBy ?? o.fromId
      if (event.by && event.by === автор) return prev
      const ктоОтвечает = o.toId ? (o.toId === автор ? o.fromId : o.toId) : null
      if (event.by && ктоОтвечает && ктоОтвечает !== event.by) return prev
      // Отвечать можно только за себя.
      if (event.by && event.seatId !== event.by) return prev

      const from = t.seats.find((x) => x.id === o.fromId)
      const winner = auctionWinner(o)
      /*
       * 🔴 Деньги идут по СВОЕЙ дороге, а не туда, где нажали. У займа
       * получатель — всегда должник (toId), кто бы ни нажал кнопку.
       */
      const buyerId =
        o.kind === 'loan' ? (o.toId ?? event.seatId) : (winner?.seatId ?? event.seatId)
      const price = winner?.amount ?? o.amount
      const buyer = t.seats.find((x) => x.id === buyerId)
      if (!from || !buyer || buyer.outOfGame) return prev
      if (o.kind !== 'loan' && o.toId && o.toId !== buyer.id) return prev

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
          /*
           * 🔴 Через ОБЩИЙ сборщик. Раньше здесь актив собирали вручную,
           * без рассрочки, и перекупленная находка приносила в разы больше,
           * чем та же карта, купленная самому. Перекуп берёт её в рассрочку —
           * взнос он уже заплатил вместе с ценой права.
           */
          seatLedgerEvent(
            t,
            buyer.id,
            dealAssetEvent(t, card, `${card.id}-${nextId(t)}`, { payCash: false }),
          )
          log(t, buyer.id, `${buyer.name} выкупил находку у ${from.name} за ${money(price)} и вошёл в сделку`)
          плашка(
            t,
            buyer.id,
            price === 0
              ? `${from.name} отдал свою находку ${buyer.name} даром`
              : `${buyer.name} выкупил находку у ${from.name} за ${money(price)}`,
          )
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
            /*
             * 🔴 Платёж по рассрочке переезжает вместе с долгом. Без него у
             * покупателя объект с долгом гасился «из воздуха», а расшить его
             * досрочно было нечем: поток не возвращался.
             */
            installmentMonthly: (asset as { installmentMonthly?: number }).installmentMonthly ?? 0,
          }
          if (re) seatLedgerEvent(t, buyer.id, { type: 'BUY_REAL_ESTATE', ...common, mortgage: debt })
          else seatLedgerEvent(t, buyer.id, { type: 'BUY_BUSINESS', ...common, liability: debt })
          log(t, buyer.id, `${buyer.name} купил «${asset.name}» у ${from.name} за ${money(price)}`)
          плашка(t, buyer.id, `${buyer.name} купил «${asset.name}» у ${from.name} за ${money(price)}`)
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
          /*
           * 🔴 Тот же общий сборщик, что и у обычной покупки. Раньше здесь
           * актив собирали вручную по цифрам с карточки — и двое, сложившись,
           * получали доход как при покупке НАЛОМ, хотя платили только взнос.
           * Вход через партнёра был выгоднее покупки, и это ломало всю игру.
           * Взнос уже списан выше двумя переводами, поэтому downPayment=0.
           */
          const base = dealAssetEvent(t, card, `${card.id}-${nextId(t)}`, {
            payCash: false,
            investorShare: share,
            partnerId: buyer.id,
          })
          // paidIn — сколько инициатор реально достал из кармана (взнос минус доля партнёра).
          seatLedgerEvent(t, from.id, { ...base, downPayment: 0, paidIn: mine })
          /*
           * 🔴 Доля соинвестора должна лечь ЕМУ В ПОРТФЕЛЬ, иначе он платит
           * деньги и не получает ничего: у инициатора доход уже урезан на
           * investorShare, а этот кусок просто испарялся. Долг остаётся на том,
           * кто ведёт объект, — соинвестор внёс живые деньги, а не обязательство.
           */
          // Доля партнёра — от ТОГО ЖЕ расчёта, что и у инициатора: он вошёл
          // в объект в рассрочку, значит и его доля считается от потока в рассрочку.
          const partShare = {
            id: `${card.id}-part-${nextId(t)}`,
            name: `${localizedCardTitle(card)} · доля ${Math.round(share * 100)}%`,
            cost: Math.round((base.cost as number) * share),
            downPayment: 0,
            // Столько внёс сам партнёр — иначе в его панели тоже стоял бы ноль.
            paidIn: o.amount,
            cashFlow: Math.round((base.cashFlow as number) * share),
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
              /* 🔴 Надбавку храним в самом займе: без неё движок закрывал долг
                 по телу, а окно обещало вернуть с процентом. */
              interestPct: o.interestPct,
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
            /*
             * 🔴 ТОЛЬКО ДВОИМ. Переговоры о деньгах интерфейс намеренно прячет
             * от посторонних, и лента не имеет права это раскрыть: иначе весь
             * стол видит, кто у кого занимает.
             */
            плашка(
              t,
              buyer.id,
              `${buyer.name} взял у ${from.name} ${money(o.amount)} без надбавки`,
              'нейтр',
              [buyer.id, from.id],
            )
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
      /*
       * 🔴 Возвращать нужно С НАДБАВКОЙ, если давали под процент. Раньше долг
       * закрывался по телу: обещали вернуть 250 000, движок отпускал за 200 000.
       */
      const owed = loanOwed(ln)
      const left = owed - ln.repaid
      const pay = Math.min(Math.max(0, Math.round(event.amount)), left, l.cash)
      if (pay <= 0) return prev
      seatLedgerEvent(t, seat.id, { type: 'ADJUST_CASH', amount: -pay })
      seatLedgerEvent(t, ln.lenderId, { type: 'ADJUST_CASH', amount: pay })
      ln.repaid += pay
      const lender = t.seats.find((x) => x.id === ln.lenderId)
      const closed = ln.repaid >= owed
      log(t, seat.id, `Вернул ${lender?.name ?? 'игроку'} ${money(pay)}${closed ? ' — долг закрыт' : ''}`)
      if (closed) {
        /*
         * 🔴 Долговая нагрузка снимается с ОБОИХ. Раньше она оставалась
         * навсегда: человек рассчитался, а неприятности продолжали ходить
         * к нему чаще до конца партии.
         */
        if (ln.interestPct) {
          seatLedgerEvent(t, seat.id, { type: 'ADJUST_RIBA_EXPOSURE', amount: -owed })
          seatLedgerEvent(t, ln.lenderId, { type: 'ADJUST_RIBA_EXPOSURE', amount: -ln.amount })
        }
        t.loans = t.loans.filter((x) => x.id !== ln.id)
      }
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
      /*
       * 🔴 ЗАЩЁЛКА ОТ ПОВТОРА. Конец хода шлют двое: хозяин комнаты и сам
       * ходящий. Так задумано — иначе стол замирает навсегда, стоит хозяину
       * свернуть вкладку. Но без этой строки второй экземпляр доезжал уже
       * ПОСЛЕ перехода и закрывал ход СЛЕДУЮЩЕМУ игроку: за круг из троих
       * один не ходил вовсе. Плюс страховочный повтор раз в три секунды
       * множил пропуски дальше.
       *
       * Номер хода растёт при каждом переходе, поэтому опоздавший экземпляр
       * приходит со старым номером и отсеивается здесь.
       */
      if (event.turn != null && event.turn !== t.turnCounter) return prev
      /*
       * 🔴 Карточки, где решать нечего («Понятно»), конец хода не запирают.
       * Иначе достаточно потерянного нажатия — и стол стоит навсегда. Заодно
       * так переигрываются партии, записанные до появления этих карточек.
       */
      const безРешения =
        t.pending &&
        (t.pending.kind === 'payday' ||
          t.pending.kind === 'ftEvent' ||
          // Поздравление с выходом из Круга — тоже просто «Понятно».
          t.pending.kind === 'freedom')
      if (t.pending && !безРешения && t.pending.kind !== 'market' && t.pending.kind !== 'deal')
        return prev
      t.pending = null
      /*
       * Последняя возможность отдать партнёрский бизнес в срок: карточка хода
       * уже закрыта, ход ещё не ушёл. Так обещание «не позже четвёртого хода»
       * выполняется даже у того, кому все четыре хода выпадали другие карты.
       */
      отдатьGreenleafВСрок(t, seatIdx)
      if (t.pending) return t
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
