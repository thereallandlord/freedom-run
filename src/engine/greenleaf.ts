/**
 * Партнёрский бизнес GreenLeaf — единственное место, где живут его правила.
 *
 * Почему отдельным файлом: это не «ещё один бизнес с потоком», а своя
 * механика — пакет-множитель, растущая структура, ранги-пенсии, ускорители
 * и замедления. Разбросать её по table.ts значит потерять.
 *
 * 🔴 Язык наружу — только рубли и простые слова. Ни PV, ни «бинара», ни
 * «слабой ноги»: игрок за столом их не понимает, а термин отпугивает.
 * Позиционирование — партнёрский бизнес, слово «сетевой» под запретом.
 *
 * 🔴 Цифры сверены с Камилем 17.08.2026. Прежняя запись «Бриллиант = ×3»
 * оказалась ложной — правда +25%, у Короны +50%.
 */

export type GlPackageId = 'platinum' | 'diamond' | 'crown'

export interface GlPackage {
  id: GlPackageId
  name: string
  price: number
  /** Множитель дохода структуры. */
  mul: number
  hint: string
}

export const GL_PACKAGES: GlPackage[] = [
  {
    id: 'platinum',
    name: 'Платина',
    price: 28_900,
    mul: 1.0,
    hint: 'Самый дешёвый вход. Дохода на рубль вложенного даёт больше всех — но и растёт медленнее.',
  },
  {
    id: 'diamond',
    name: 'Бриллиант',
    price: 86_700,
    mul: 1.25,
    hint: 'Плюс четверть к доходу структуры. Окупается, когда структура уже приносит заметные деньги.',
  },
  {
    id: 'crown',
    name: 'Корона',
    price: 173_400,
    mul: 1.5,
    hint: 'Плюс половина к доходу структуры. На старте переплата, на выросшей структуре — самый сильный.',
  },
]

export const glPackage = (id: GlPackageId): GlPackage =>
  GL_PACKAGES.find((p) => p.id === id) ?? GL_PACKAGES[0]

/**
 * Ранги. Считаются по накопленному объёму — сколько всего рублей структура
 * принесла за партию. Это не карта «вы закрыли ранг», а уведомление: объём
 * набрался сам собой, по чуть-чуть, как в жизни.
 *
 * Ранг даёт ДВЕ вещи: разовый бонус в момент закрытия и пожизненную пенсию.
 * Пенсия идёт СВЕРХ дохода структуры, и ранги, автопромоушен и промоушен на
 * путешествия друг друга не заменяют — всё складывается (правка Камиля 17.08).
 *
 * Чтобы это не ломало счёт, пороги тяжёлые: Менеджера видит почти каждый, кто
 * дожил, Директора — только тот, кто реально работал со структурой.
 */
export interface GlRank {
  level: number
  name: string
  volume: number
  /** Разово в момент закрытия. У Менеджера цифра от Камиля — 70 000 ₽. */
  bonus: number
  pension: number
}

export const GL_RANKS: GlRank[] = [
  { level: 0, name: '—', volume: 0, bonus: 0, pension: 0 },
  { level: 1, name: 'Менеджер', volume: 150_000, bonus: 70_000, pension: 20_000 },
  { level: 2, name: 'Старший менеджер', volume: 500_000, bonus: 105_000, pension: 30_000 },
  { level: 3, name: 'Директор', volume: 1_200_000, bonus: 140_000, pension: 40_000 },
]

export const glRankFor = (volume: number): GlRank =>
  [...GL_RANKS].reverse().find((r) => volume >= r.volume) ?? GL_RANKS[0]

/** Золотой треугольник: три кабинета вместо одного. */
export const GL_TRIANGLE_BONUS = 1.3

/**
 * Промоушены. Складываются с рангами и друг с другом — ничего не заменяют.
 *
 * 🔴 Сроки настоящие и в игре обязательны: сразу после входа промоушен не
 * берётся, разгон нужен. Автопромоушен — раз в год, путешествие — раз в
 * полгода. Иначе игрок купил бизнес и через три хода снял всё сразу, а так не
 * бывает. Зарплата = месяц, отсюда счёт в зарплатах.
 */
export interface GlPromo {
  id: 'auto' | 'travel'
  name: string
  amount: number
  /** Раз во сколько зарплат можно брать. */
  everyPaydays: number
  /** Сколько зарплат должно пройти с покупки бизнеса до ПЕРВОГО раза. */
  warmupPaydays: number
  /**
   * Какой объём структура должна дать ЗА ПЕРИОД с прошлого раза, чтобы план
   * считался закрытым.
   * 🔴 Не «накопленный за всё время»: накопленный набирается сам собой, и тогда
   * тот, кто купил пакет и ничего не делает, снимает премии до конца партии.
   * Замер показал ровно это: структура 23 тыс/мес, а премий на 950 тыс за три
   * года. План закрывают за период, а не однажды.
   */
  needVolume: number
  note: string
}

export const GL_PROMOS: GlPromo[] = [
  {
    id: 'travel',
    name: 'Промоушен на путешествие',
    amount: 200_000,
    everyPaydays: 6,
    warmupPaydays: 6,
    needVolume: 250_000,
    note: 'Компания везёт партнёров в поездку. Можно поехать, а можно забрать деньгами — берём деньгами.',
  },
  {
    id: 'auto',
    name: 'Автопромоушен',
    amount: 150_000,
    everyPaydays: 12,
    warmupPaydays: 12,
    needVolume: 900_000,
    note: 'Годовая премия за объём. Закрыть тяжело, зато и сумма другая.',
  },
]

/** Стартовый доход структуры и её обычная скорость роста. */
export const GL_START_FLOW = 1_700
export const GL_START_GROWTH = 600

/**
 * Разброс удачи. В жизни структура у двух одинаково старательных людей растёт
 * по-разному — этот разброс Камиль просил оставить. Множитель личный,
 * назначается при покупке из зерна партии, дальше не меняется.
 */
export const GL_LUCK_MIN = 0.8
export const GL_LUCK_MAX = 1.25

/** Партнёрский бизнес внутри портфеля игрока. */
export interface GlState {
  packageId: GlPackageId
  /** Доход структуры ДО множителей — «сколько приносят люди». */
  baseFlow: number
  /** Сколько прибавляется само на каждой зарплате. */
  growthPerPayday: number
  /** Сколько всего рублей структура принесла — по нему идут ранги. */
  volume: number
  /** Три кабинета вместо одного. */
  triangle: boolean
  /** Сколько зарплат рост заморожен (команда отдыхает, воронка встала). */
  slowdownLeft: number
  /** Личный разброс удачи. */
  luck: number
  /** На какой зарплате взяли промоушен в последний раз (−1 = ни разу). */
  lastPromo: Record<string, number>
  /** Каким был объём в момент прошлой премии — от него считается «за период». */
  lastPromoVolume: Record<string, number>
  /** Сколько зарплат прошло с покупки бизнеса — по нему считается разгон. */
  age: number
  /** Какой ранг уже закрыт: разовый бонус за него выдан. */
  rankPaid: number
  /**
   * Временная просадка дохода: наставник выгорел, переливы упали.
   * Множитель < 1 и сколько зарплат он ещё действует.
   */
  dipMul: number
  dipLeft: number
}

export const glInitialState = (packageId: GlPackageId, luck: number): GlState => ({
  packageId,
  baseFlow: GL_START_FLOW,
  growthPerPayday: GL_START_GROWTH,
  volume: 0,
  triangle: false,
  slowdownLeft: 0,
  luck,
  lastPromo: {},
  lastPromoVolume: {},
  age: 0,
  rankPaid: 0,
  dipMul: 1,
  dipLeft: 0,
})

/** Можно ли сейчас взять этот промоушен и почему нет. */
export function glPromoReady(g: GlState, p: GlPromo): { ready: boolean; why: string } {
  if (g.age < p.warmupPaydays)
    return { ready: false, why: `Бизнес слишком молодой — нужно ещё ${p.warmupPaydays - g.age} зарплат` }
  const last = g.lastPromo[p.id]
  if (last !== undefined && g.age - last < p.everyPaydays)
    return { ready: false, why: `Брали недавно — можно через ${p.everyPaydays - (g.age - last)} зарплат` }
  const grown = g.volume - (g.lastPromoVolume[p.id] ?? 0)
  if (grown < p.needVolume)
    return {
      ready: false,
      why: `План не закрыт: структура дала ${fmt(grown)} из нужных ${fmt(p.needVolume)} за период`,
    }
  return { ready: true, why: '' }
}

/** Доход структуры со всеми множителями, без пенсии за ранг. */
export function glStructureIncome(g: GlState): number {
  const withPackage = g.baseFlow * glPackage(g.packageId).mul
  const withTriangle = g.triangle ? withPackage * GL_TRIANGLE_BONUS : withPackage
  const withDip = g.dipLeft > 0 ? withTriangle * g.dipMul : withTriangle
  return Math.round(withDip / 100) * 100
}

/** Всё, что партнёрский бизнес приносит в месяц: структура плюс пенсия за ранг. */
export function glTotalIncome(g: GlState): number {
  return glStructureIncome(g) + glRankFor(g.volume).pension
}

/** Доплата до старшего пакета. Апгрейд доступен всегда — как в жизни. */
export function glUpgradeCost(from: GlPackageId, to: GlPackageId): number {
  return Math.max(0, glPackage(to).price - glPackage(from).price)
}

export function glUpgradeOptions(from: GlPackageId): GlPackage[] {
  const cur = glPackage(from)
  return GL_PACKAGES.filter((p) => p.price > cur.price)
}

/**
 * Шаг зарплаты: структура подросла, объём накопился, заморозка оттаяла.
 * Возвращает новое состояние и человеческую строчку для уведомления —
 * игрок должен понимать, ПОЧЕМУ доход изменился.
 */
export function glOnPayday(g: GlState): { next: GlState; note: string | null } {
  const before = glTotalIncome(g)
  const rankBefore = glRankFor(g.volume)

  const next: GlState = { ...g }
  next.volume += glStructureIncome(g)

  if (next.slowdownLeft > 0) {
    next.slowdownLeft -= 1
  } else {
    next.baseFlow += Math.round((g.growthPerPayday * g.luck) / 100) * 100
  }

  const rankAfter = glRankFor(next.volume)
  const after = glTotalIncome(next)

  if (rankAfter.level > rankBefore.level) {
    return {
      next,
      note: `Партнёрский бизнес: вы закрыли ранг «${rankAfter.name}». Это добавляет ${fmt(
        rankAfter.pension,
      )} в месяц сверх дохода структуры — и эти деньги остаются с вами, даже если команда возьмёт паузу.`,
    }
  }
  if (next.slowdownLeft > 0) {
    return { next, note: `Партнёрский бизнес: приток новых людей пока стоит, доход не растёт.` }
  }
  if (after > before) {
    return {
      next,
      note: `Партнёрский бизнес: в структуре прибавилось людей, доход вырос до ${fmt(after)} в месяц.`,
    }
  }
  return { next, note: null }
}

const fmt = (n: number) => `${n.toLocaleString('ru-RU')} ₽`
