/**
 * Панель хозяина игры.
 *
 * 🔴 Зачем она. Владелец видел игру только глазами игрока — из-за стола не
 * видно ни состава колод, ни того, что какая-то статья расходов обнулилась,
 * ни того, что все дешёвые объекты недвижимости однажды уехали под нож вместе
 * с ловушками. Оба этих случая уже произошли и оба вскрылись только на живой
 * партии, спустя сутки. Панель показывает игру изнутри, чтобы такое было
 * видно за десять секунд, а не за два часа игры.
 *
 * 🔴 Читает данные ТЕМИ ЖЕ функциями, что и сам движок. Не своей копией и не
 * пересказом: панель, которая расходится с игрой, хуже, чем её отсутствие.
 *
 * 🔴 Работает целиком в браузере, без сервера — иначе она не открылась бы на
 * копии игры, которая лежит на GitHub Pages. Отсюда же ограничение: пока
 * только смотреть. Менять числа насовсем можно будет, когда появится, куда
 * их сохранять.
 */
import { useEffect, useMemo, useState } from 'react'
import { MANAGER_PCT, MANAGER_RARE_PCT, RIBA, RULES } from '../engine/ledger'
import {
  GL_MAX_GROWTH_PCT,
  GL_PACKAGES,
  GL_START_FLOW,
  GL_START_GROWTH_PCT,
  GL_TRIANGLE_BONUS,
} from '../engine/greenleaf'
import {
  RAT_BOARD,
  TICKERS,
  WORLD_EVENTS,
  bigDeals,
  doodads,
  marketCards,
  professionsFor,
  smallDeals,
} from '../engine/data'
import { THEME_RULES, WANTS_BEFORE_BURNOUT } from '../engine/table'
import { artForCard } from './cardArt'
import { accessToken, currentUser, onAuth } from '../net/auth'
import { могуПравить, сохранитьПравки } from '../net/rulesApi'
import { всеПравки } from '../engine/правки'
/*
 * Большой круг берём из файла напрямую, а не через `fastBoard()`: та функция
 * читает глобально выбранную тему, и обращение к ней из панели переключило бы
 * тему у самой игры. Панель обязана быть безобидной.
 */
import decksRu from '../data/decks_ru.json'
import worklog from '../data/worklog.json'
import type { DealCard, DoodadCard, MarketCard, Profession } from '../engine/types'

const ДЕНЬГИ = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const ПРОЦЕНТ = (n: number) => `${Math.round(n * 10) / 10}%`

type Раздел = 'сходится' | 'правки' | 'карточки' | 'профессии' | 'правила' | 'шансы'

const РАЗДЕЛЫ: { id: Раздел; имя: string }[] = [
  { id: 'сходится', имя: 'Что не сходится' },
  { id: 'правки', имя: 'Баги и правки' },
  { id: 'карточки', имя: 'Карточки' },
  { id: 'профессии', имя: 'Профессии' },
  { id: 'правила', имя: 'Правила и числа' },
  { id: 'шансы', имя: 'Шансы' },
]

const СТАТУСЫ = ['в работе', 'найдено', 'ждёт решения', 'исправлено'] as const
const ЦВЕТ_СТАТУСА: Record<string, string> = {
  исправлено: 'border-accent/40 bg-accent/10 text-accent',
  'в работе': 'border-[rgb(var(--c-warn))]/40 bg-[rgb(var(--c-warn))]/10 text-[rgb(var(--c-warn))]',
  найдено: 'border-[rgb(var(--c-bad))]/35 bg-[rgb(var(--c-bad))]/8 text-[rgb(var(--c-bad))]',
  'ждёт решения': 'border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)]',
}
const ИМЯ_ГРУППЫ: Record<string, string> = {
  ломает: 'Ломает игру',
  механика: 'Механика и баланс',
  удобство: 'Понятность и удобство',
  вход: 'Вход и кабинет',
  идея: 'Идеи на потом',
}

/** Русские имена видов карт — в данных они по-английски. */
const ВИДЫ: Record<string, string> = {
  realEstate: 'недвижимость',
  stock: 'бумаги',
  business: 'бизнес',
  sellOffer: 'предложение о покупке',
  windfall: 'нежданные деньги',
  payRaise: 'прибавка к зарплате',
  stockPrice: 'цена бумаги',
  stockSplit: 'дробление бумаг',
  glEvent: 'событие партнёрского бизнеса',
  cashflowDay: 'день дохода',
  dream: 'мечта',
  venture: 'рисковый проект',
  taxAudit: 'налоговая проверка',
  lawsuit: 'иск',
  divorce: 'развод',
  downsized: 'сокращение',
  charity: 'благотворительность',
}
const вид = (k?: string) => (k ? (ВИДЫ[k] ?? k) : '—')

// ─────────────────────────── проверки ───────────────────────────

interface Проверка {
  имя: string
  тревога: boolean
  цифра: string
  что: string
}

/**
 * Автоматические проверки — главное, ради чего панель существует.
 *
 * Каждая выросла из настоящего случая, а не из воображения: так уже ломалось.
 */
function собратьПроверки(): Проверка[] {
  // Правила режима, а не то, что осталось в памяти от прошлой партии.
  const пр = { ...RULES, ...THEME_RULES.ru }
  const малые = smallDeals('ru')
  const крупные = bigDeals('ru')
  const рынок = marketCards('ru')
  const всячина = doodads('ru')
  const профессии = professionsFor('ru')
  const из: Проверка[] = []

  // ── 1. Порог входа против стартовых денег ──
  // Так сломалась недвижимость: дешёвые объекты удалили вместе с ловушками,
  // минимальный вход стал больше миллиона, а фильтр «хватает ли денег»
  // молча отбраковывал ВСЕ объекты, пока игрок не разбогатеет.
  const деньгиНаСтарте = профессии.map((p) => p.savings)
  const богатейший = Math.max(...деньгиНаСтарте)
  for (const [видКарт, имяВида] of [
    ['realEstate', 'недвижимости'],
    ['business', 'бизнеса'],
  ] as const) {
    const свои = малые.filter((c) => videKind(c) === видКарт)
    const входы = свои.map((c) => поле(c, 'downPayment')).filter((n) => n > 0)
    if (!входы.length) continue
    const минимум = Math.min(...входы)
    из.push({
      имя: `Самый дешёвый вход в ${имяВида}`,
      тревога: минимум > богатейший,
      цифра: `${ДЕНЬГИ(минимум)} против ${ДЕНЬГИ(богатейший)} на старте`,
      что:
        минимум > богатейший
          ? `Ни один игрок не может купить это на старте: карта показывается только тому, кому хватает денег, поэтому все ${свои.length} шт. отбраковываются, пока человек не разбогатеет.`
          : `Порог по силам самой богатой профессии — карта будет попадаться с первых ходов.`,
    })
  }

  // ── 2. Статьи расходов, нулевые у ВСЕХ ──
  // Так обнаружились налоги: ноль у всех восемнадцати профессий.
  const статьи = Object.keys(профессии[0]?.expenses ?? {})
  for (const статья of статьи) {
    const всеНули = профессии.every(
      (p) => !(p.expenses as unknown as Record<string, number>)[статья],
    )
    if (!всеНули) continue
    из.push({
      имя: `Статья «${имяСтатьи(статья)}» пустая у всех профессий`,
      тревога: true,
      цифра: `0 ₽ у всех ${профессии.length}`,
      что: 'Строка есть, а денег не забирает. Либо это забытая правка, либо статью надо убрать с экрана — сейчас игрок видит её нулём.',
    })
  }

  // ── 3. Доля бед в партнёрском бизнесе ──
  const глСобытия = рынок.filter((c) => c.kind === 'glEvent')
  const беды = глСобытия.filter((c) => естьБеда(c))
  const доляБед = глСобытия.length ? (беды.length / глСобытия.length) * 100 : 0
  из.push({
    имя: 'Доля бед в партнёрском бизнесе',
    тревога: доляБед > 30,
    цифра: `${беды.length} из ${глСобытия.length} — ${ПРОЦЕНТ(доляБед)}`,
    что: 'Считается по колоде. За столом ощущается сильнее: беды применимы всегда, а часть хороших карточек отсеивается как неподходящая и отдаёт свою вероятность бедам.',
  })

  // ── 4. Разрыв между малыми и крупными сделками ──
  const верхМалых = Math.max(...малые.map((c) => поле(c, 'downPayment')))
  const низКрупных = Math.min(...крупные.map((c) => поле(c, 'downPayment')))
  из.push({
    имя: 'Разрыв между малыми и крупными сделками',
    тревога: низКрупных > верхМалых * 2,
    цифра: `малые до ${ДЕНЬГИ(верхМалых)}, крупные от ${ДЕНЬГИ(низКрупных)}`,
    что:
      низКрупных > верхМалых * 2
        ? 'Между колодами дыра: на крупные ещё не хватает, а в малых уже нечего брать.'
        : 'Колоды стыкуются, провала по деньгам нет.',
  })

  // ── 5. Карточки без картинки ──
  const всеСId = [...малые, ...крупные].filter((c) => c.id)
  const безКартинки = всеСId.filter((c) => !artForCard(c))
  из.push({
    имя: 'Карточки без картинки',
    тревога: безКартинки.length > 0,
    цифра: `${безКартинки.length} из ${всеСId.length}`,
    что: безКартинки.length
      ? `По отсутствию картинки видно, какие карточки новые: ${безКартинки
          .slice(0, 4)
          .map((c) => c.title)
          .join(', ')}${безКартинки.length > 4 ? ' и другие' : ''}.`
      : 'У всех сделок есть картинка.',
  })

  // ── 6. Одинаковые названия ──
  const счёт = new Map<string, number>()
  for (const c of [...малые, ...крупные, ...всячина]) {
    const t = (c as { title?: string }).title ?? ''
    счёт.set(t, (счёт.get(t) ?? 0) + 1)
  }
  const повторы = [...счёт.entries()].filter(([, n]) => n > 1)
  из.push({
    имя: 'Карточки с одинаковым названием',
    тревога: повторы.length > 0,
    цифра: `${повторы.length}`,
    что: повторы.length
      ? `Игроку они читаются как повтор: ${повторы.map(([t]) => t).join(', ')}.`
      : 'Названия не повторяются. Ощущение «одно и то же выпадает» даёт не колода, а то, что выпавшая карта не вычёркивается.',
  })

  // ── 7. Доходность классов активов ──
  /*
   * 🔴 Считаем ЧИСТЫЙ доход на ВЛОЖЕННЫЕ ДЕНЬГИ, а не на полную цену объекта.
   *
   * Первая версия этой проверки сравнивала несравнимое: недвижимость и бизнес
   * мерились доходом к полной цене, а партнёрский бизнес — к тому, что человек
   * реально заплатил. Партнёрский на этом «отрывался» вчетверо, и вывод
   * получался ложный. Игрок платит взнос и каждый месяц отдаёт платёж по
   * рассрочке — вот от этих двух чисел он и живёт.
   */
  const чистыйГод = (c: DealCard) => {
    const взнос = поле(c, 'downPayment')
    const цена = поле(c, 'cost')
    if (!взнос) return 0
    const вид = videKind(c)
    const наценка = вид === 'realEstate' ? пр.installmentMarkup.realEstate : пр.installmentMarkup.business
    const срок = вид === 'realEstate' ? пр.installmentTerm.realEstate : пр.installmentTerm.business
    const долг = Math.max(0, цена * наценка - взнос)
    const платёж = срок ? долг / срок : 0
    return ((поле(c, 'cashFlow') - платёж) * 12 * 100) / взнос
  }
  const срПо = (вид: string, где: DealCard[]) => {
    const свои = где.filter((c) => videKind(c) === вид && поле(c, 'downPayment'))
    if (!свои.length) return 0
    return свои.reduce((s, c) => s + чистыйГод(c), 0) / свои.length
  }
  const недв = срПо('realEstate', [...малые, ...крупные])
  const биз = срПо('business', [...малые, ...крупные])
  const глГод = (GL_START_FLOW * 12 * 100) / GL_PACKAGES[0].price
  const разрыв = глГод > Math.max(недв, биз) * 1.8
  из.push({
    имя: 'Чистая доходность на вложенные деньги, в год',
    тревога: разрыв,
    цифра: `недвижимость ${ПРОЦЕНТ(недв)} · бизнес ${ПРОЦЕНТ(биз)} · партнёрский ${ПРОЦЕНТ(глГод)}`,
    что: разрыв
      ? 'Партнёрский бизнес отрывается от остальных активов уже на входе — выбор игрока перестаёт быть выбором.'
      : 'На входе классы сопоставимы. Разрыв в партии создаёт не эта цифра, а то, что структура растёт сама, а недвижимость и бизнес — нет.',
  })

  // ── 8. Шансы рискованных проектов ──
  const проекты = (decksRu.FAST_BOARD_RU as { type: string; threshold?: number; downPayment?: number }[])
    .filter((s) => s.type === 'venture')
  if (проекты.length) {
    const шанс = проекты.map((s) => ((7 - (s.threshold ?? 7)) / 6) * 100)
    const средний = шанс.reduce((a, b) => a + b, 0) / шанс.length
    const ставка = Math.max(...проекты.map((s) => s.downPayment ?? 0))
    из.push({
      имя: 'Шанс выиграть в рисковом проекте',
      тревога: средний < 40,
      цифра: `${ПРОЦЕНТ(средний)} при ставке до ${ДЕНЬГИ(ставка)}`,
      что: 'Ставка невозвратная. При таком шансе потерять два раза подряд — обычное дело, и со стороны игрока это неотличимо от поломки.',
    })
  }

  // ── 9. Неравные шансы внутри колоды партнёрского бизнеса ──
  const рынокВсего = рынок.length
  const остаток = рынокВсего % (глСобытия.length || 1)
  из.push({
    имя: 'Равны ли шансы карточек партнёрского бизнеса между собой',
    тревога: остаток !== 0,
    цифра:
      остаток === 0
        ? 'равны'
        : `первые ${остаток} из ${глСобытия.length} выпадают чаще остальных`,
    что:
      остаток === 0
        ? 'Все карточки этой колоды равновероятны.'
        : `Карта выбирается остатком от деления по колоде рынка (${рынокВсего} карт), и он делится на ${глСобытия.length} неровно. Первые карточки получают лишний шанс.`,
  })

  return из
}

/** У карт малой колоды вид лежит в kind; вынесено, чтобы не спорить с типами. */
function videKind(c: DealCard): string {
  return поле(c, 'kind') as unknown as string
}

/**
 * Безопасное чтение поля карты.
 *
 * 🔴 Колода сделок — это несколько разных видов карт в одном списке: у бумаг
 * нет ни взноса, ни месячного дохода. Обращаться к таким полям напрямую
 * нельзя, а разбирать каждый вид отдельно ради показа в таблице — лишнее.
 */
function поле(c: unknown, имя: string): number {
  const v = (c as Record<string, unknown>)[имя]
  return typeof v === 'number' ? v : (v as unknown as number) ?? (0 as number)
}

function имяСтатьи(k: string): string {
  const имена: Record<string, string> = {
    taxes: 'налоги',
    homeMortgagePayment: 'платёж за жильё',
    schoolLoanPayment: 'оплата обучения',
    carPayment: 'платёж за машину',
    creditCardPayment: 'кредитная карта',
    retailPayment: 'долг за технику',
    otherExpenses: 'жизнь: еда, ЖКХ, транспорт',
  }
  return имена[k] ?? k
}

/** Считаем карточку бедой, если она что-то отнимает или замораживает. */
function естьБеда(c: MarketCard): boolean {
  const x = c as unknown as Record<string, number | undefined>
  return Boolean(
    (x.boostPct !== undefined && (x.boostPct as number) < 0) ||
      (x.growthPct !== undefined && (x.growthPct as number) < 0) ||
      x.freezePaydays ||
      x.dipPct,
  )
}

// ─────────────────────────── экран ───────────────────────────


/**
 * Правки, с которыми работает панель: что уже наложено и что можно менять.
 *
 * 🔴 Правка НЕ применяется на лету. Меняешь число — оно ложится в черновик, и
 * пока не нажал «Применить всем», игра идёт по-старому. Иначе одна опечатка в
 * поле сразу уехала бы всем за столом, и откатывать её пришлось бы вслепую.
 */
interface РабочиеПравки {
  можно: boolean
  /** Ключ учётки того, кто вошёл: его и вносят в список хозяев. */
  ключ: string | null
  карточки: Record<string, Record<string, string | number>>
  правила: Record<string, number>
  грязно: boolean
  поставить: (id: string, поле: string, знач: string | number | null) => void
  правило: (ключ: string, знач: number | null) => void
  сохранить: () => void
  сбросить: () => void
  занят: boolean
  ошибка: string | null
}

function useПравки(): РабочиеПравки {
  const [можно, setМожно] = useState(false)
  const [ключ, setКлюч] = useState<string | null>(null)
  const [карточки, setКарточки] = useState<Record<string, Record<string, string | number>>>(
    () => ({ ...(всеПравки().карточки ?? {}) }) as Record<string, Record<string, string | number>>,
  )
  const [правила, setПравила] = useState<Record<string, number>>(() => ({
    ...(всеПравки().правила ?? {}),
  }))
  const [грязно, setГрязно] = useState(false)
  const [занят, setЗанят] = useState(false)
  const [ошибка, setОшибка] = useState<string | null>(null)

  useEffect(() => {
    void accessToken().then((t) => могуПравить(t ?? undefined)).then(setМожно)
    setКлюч(currentUser()?.id ?? null)
    // Учётка может появиться позже: вход открывается прямо из шапки.
    return onAuth((u) => setКлюч(u?.id ?? null))
  }, [])

  const поставить = (id: string, поле: string, знач: string | number | null) => {
    if (!id) return
    setКарточки((было) => {
      const своя = { ...(было[id] ?? {}) }
      if (знач === null) delete своя[поле]
      else своя[поле] = знач
      const дальше = { ...было }
      if (Object.keys(своя).length) дальше[id] = своя
      else delete дальше[id]
      return дальше
    })
    setГрязно(true)
  }

  const правило = (ключ: string, знач: number | null) => {
    setПравила((было) => {
      const дальше = { ...было }
      if (знач === null) delete дальше[ключ]
      else дальше[ключ] = знач
      return дальше
    })
    setГрязно(true)
  }

  const сохранить = () => {
    setЗанят(true)
    setОшибка(null)
    void accessToken()
      .then((токен) => {
        if (!токен) return 'нужно войти в кабинет'
        return сохранитьПравки({ карточки, правила }, токен)
      })
      .then((e) => {
        setЗанят(false)
        setОшибка(e ?? null)
        if (!e) setГрязно(false)
      })
  }

  const сбросить = () => {
    setКарточки({})
    setПравила({})
    setГрязно(true)
  }

  return { можно, ключ, карточки, правила, грязно, поставить, правило, сохранить, сбросить, занят, ошибка }
}

export function Admin({ onClose }: { onClose: () => void }) {
  const [раздел, setРаздел] = useState<Раздел>('сходится')
  const правки = useПравки()
  const проверки = useMemo(собратьПроверки, [])
  const тревог = проверки.filter((p) => p.тревога).length
  const осталось = worklog.правки.filter((p) => p.статус !== 'исправлено').length

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="caps text-[10px] font-bold text-accent">Панель хозяина</div>
            <h1 className="font-display text-2xl font-bold leading-tight">Игра изнутри</h1>
            <p className="mt-1 max-w-[60ch] text-[13.5px] text-[var(--muted)]">
              Всё содержимое игры одним списком: карточки, профессии, правила и числа.
              Читается прямо из того же места, откуда их берёт сама игра, — разойтись
              с партией эта страница не может.
            </p>
          </div>
          <button onClick={onClose} className="topbtn shrink-0">
            ← В игру
          </button>
        </header>

        <nav className="flex flex-wrap gap-1.5">
          {РАЗДЕЛЫ.map((р) => (
            <button
              key={р.id}
              onClick={() => setРаздел(р.id)}
              className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                раздел === р.id
                  ? 'border-accent bg-accent/12 font-semibold'
                  : 'border-[var(--line)] text-[var(--muted)] hover:border-accent/50'
              }`}
            >
              {р.имя}
              {р.id === 'правки' && осталось > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--panel-2)] px-1.5 text-[10px] font-bold text-[var(--muted)]">
                  {осталось}
                </span>
              )}
              {р.id === 'сходится' && тревог > 0 && (
                <span className="ml-1.5 rounded-full bg-[rgb(var(--c-bad))] px-1.5 text-[10px] font-bold text-white">
                  {тревог}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/*
          🔴 ПОЛОСА СОХРАНЕНИЯ ВИСИТ ВНИЗУ И ТОЛЬКО КОГДА ЕСТЬ ЧТО СОХРАНЯТЬ.
          Правка не применяется на лету: пока не нажал «Применить всем», игра
          идёт по-старому. Иначе одна опечатка в поле сразу уехала бы всем за
          столом, а откатывать её пришлось бы вслепую.
        */}
        {/*
          🔴 Кто хозяин — решает СЕРВЕР по списку учёток, а не браузер. Поэтому
          свой ключ надо один раз показать: без него список не заполнить, а
          догадаться о нём нельзя. Показываем только тому, кто вошёл и хозяином
          пока не значится, — остальным эта строка не нужна.
        */}
        {!правки.можно && правки.ключ && (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3">
            <div className="text-[13px] font-semibold">Править правила пока нельзя</div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--muted)]">
              Смотреть можно всё. Чтобы разрешить правку, твой ключ хозяина надо один раз
              внести в настройки игры:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="tabnum select-all break-all rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[12px]">
                {правки.ключ}
              </code>
              <button
                onClick={() => void navigator.clipboard?.writeText(правки.ключ ?? '')}
                className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[12px] hover:border-accent"
              >
                Скопировать
              </button>
            </div>
          </div>
        )}

        {правки.можно && правки.грязно && (
          <div
            className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-accent bg-[var(--panel)] px-4 py-3 shadow-lg"
            style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.18)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">
                Правок в черновике: {Object.keys(правки.карточки).length} карточек
                {Object.keys(правки.правила).length
                  ? `, ${Object.keys(правки.правила).length} правил`
                  : ''}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">
                Пока не применил — игра идёт по-старому.{' '}
                <b className="text-[rgb(var(--c-warn))]">
                  Применишь — незаконченные партии восстановить будет нельзя:
                </b>{' '}
                стол собирается из журнала ходов, и по новым числам те же ходы дадут
                другие карты.
              </p>
              {правки.ошибка && (
                <p className="mt-1 text-[12px] font-semibold text-[rgb(var(--c-bad))]">
                  {правки.ошибка}
                </p>
              )}
            </div>
            <button
              onClick={правки.сбросить}
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-[12.5px] text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Снять всё
            </button>
            <button
              onClick={правки.сохранить}
              disabled={правки.занят}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-[rgb(var(--c-accent-ink))] disabled:opacity-50"
            >
              {правки.занят ? 'Применяю…' : 'Применить всем'}
            </button>
          </div>
        )}

        {раздел === 'сходится' && <ЧтоНеСходится проверки={проверки} />}
        {раздел === 'правки' && <Правки />}
        {раздел === 'карточки' && <Карточки правки={правки} />}
        {раздел === 'профессии' && <Профессии />}
        {раздел === 'правила' && <Правила />}
        {раздел === 'шансы' && <Шансы />}
      </div>
    </div>
  )
}

function ЧтоНеСходится({ проверки }: { проверки: Проверка[] }) {
  const плохо = проверки.filter((p) => p.тревога)
  const норм = проверки.filter((p) => !p.тревога)
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-[14px] text-[var(--muted)]">
        Считается на месте по живым данным игры. Каждая проверка выросла из того,
        что однажды сломалось и всплыло только за столом.
      </p>
      {[...плохо, ...норм].map((p) => (
        <div
          key={p.имя}
          className={`rounded-xl border px-4 py-3 ${
            p.тревога
              ? 'border-[rgb(var(--c-bad))]/40 bg-[rgb(var(--c-bad))]/8'
              : 'border-[var(--line)] bg-[var(--panel)]'
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[15px] font-semibold">{p.имя}</div>
            <div
              className={`tabnum text-[13px] font-semibold ${
                p.тревога ? 'text-[rgb(var(--c-bad))]' : 'text-accent'
              }`}
            >
              {p.цифра}
            </div>
          </div>
          <p className="mt-1 max-w-[76ch] text-[13.5px] leading-relaxed text-[var(--muted)]">
            {p.что}
          </p>
        </div>
      ))}
    </div>
  )
}


/**
 * Журнал правок: что нашли, что чинится, что ждёт решения владельца.
 *
 * 🔴 Ведётся руками вместе с работой — это не автоматика, а честный список.
 * Просьба Камиля 20.08: панель должна быть главной по игре, чтобы статус
 * каждого бага был виден здесь, а не в переписке.
 */
function Правки() {
  const [группа, setГруппа] = useState<string>('всё')
  const все = worklog.правки as {
    id: string
    название: string
    группа: string
    статус: string
    сказал: string
    что: string
    когда: string
    коммит?: string
  }[]

  const группы = ['всё', ...Object.keys(ИМЯ_ГРУППЫ)]
  const видно = все.filter((p) => группа === 'всё' || p.группа === группа)
  const поСтатусу = (ст: string) => видно.filter((p) => p.статус === ст)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {группы.map((g) => (
            <button
              key={g}
              onClick={() => setГруппа(g)}
              className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${
                группа === g
                  ? 'border-accent bg-accent/10 font-semibold'
                  : 'border-[var(--line)] text-[var(--muted)] hover:border-accent/50'
              }`}
            >
              {g === 'всё' ? 'Всё' : ИМЯ_ГРУППЫ[g]}
              <span className="ml-1.5 text-[var(--muted)]">
                {g === 'всё' ? все.length : все.filter((p) => p.группа === g).length}
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto text-[12.5px] text-[var(--muted)]">
          обновлено {worklog.обновлено}
        </div>
      </div>

      {СТАТУСЫ.map((ст) => {
        const строки = поСтатусу(ст)
        if (!строки.length) return null
        return (
          <div key={ст} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span
                className={`rounded-md border px-2 py-0.5 text-[11.5px] font-semibold ${ЦВЕТ_СТАТУСА[ст]}`}
              >
                {ст}
              </span>
              <span className="text-[12.5px] text-[var(--muted)]">{строки.length}</span>
            </div>
            {строки.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="text-[14.5px] font-semibold">{p.название}</div>
                  <div className="shrink-0 text-[11.5px] text-[var(--muted)]">
                    {ИМЯ_ГРУППЫ[p.группа]} · {p.когда}
                    {p.коммит ? ` · ${p.коммит}` : ''}
                  </div>
                </div>
                {/* Кавычки ставим только если их нет: часть записей — уже цитаты. */}
                <p className="mt-1 max-w-[76ch] text-[13px] italic text-[var(--muted)]">
                  {p.сказал.startsWith('«') ? p.сказал : `«${p.сказал}»`}
                </p>
                {p.что && p.что !== '—' && (
                  <p className="mt-1.5 max-w-[76ch] text-[13.5px] leading-relaxed">{p.что}</p>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

const КОЛОДЫ = [
  { id: 'малые', имя: 'Малые сделки' },
  { id: 'крупные', имя: 'Крупные сделки' },
  { id: 'рынок', имя: 'Рынок и события' },
  { id: 'всячина', имя: 'Всячина и траты' },
  { id: 'полоса', имя: 'Большой круг' },
] as const

function Карточки({ правки }: { правки: РабочиеПравки }) {
  const [колода, setКолода] = useState<(typeof КОЛОДЫ)[number]['id']>('малые')
  const [искать, setИскать] = useState('')
  const [открыта, setОткрыта] = useState<Record<string, unknown> | null>(null)

  const карты = useMemo(() => {
    if (колода === 'малые') return smallDeals('ru') as unknown as Record<string, unknown>[]
    if (колода === 'крупные') return bigDeals('ru') as unknown as Record<string, unknown>[]
    if (колода === 'рынок') return marketCards('ru') as unknown as Record<string, unknown>[]
    if (колода === 'всячина') return doodads('ru') as unknown as Record<string, unknown>[]
    return decksRu.FAST_BOARD_RU as unknown as Record<string, unknown>[]
  }, [колода])

  const видно = карты.filter((c) => {
    if (!искать.trim()) return true
    return JSON.stringify(c).toLowerCase().includes(искать.toLowerCase())
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {КОЛОДЫ.map((k) => (
          <button
            key={k.id}
            onClick={() => setКолода(k.id)}
            className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${
              колода === k.id
                ? 'border-accent bg-accent/10 font-semibold'
                : 'border-[var(--line)] text-[var(--muted)] hover:border-accent/50'
            }`}
          >
            {k.имя}
          </button>
        ))}
        <input
          value={искать}
          onChange={(e) => setИскать(e.target.value)}
          placeholder="Найти по любому слову или числу"
          className="login-input ml-auto max-w-[280px]"
        />
      </div>

      <div className="text-[13px] text-[var(--muted)]">
        Показано {видно.length} из {карты.length}
      </div>

      <div className="flex flex-col gap-2">
        {/*
          🔴 Ключ строки — КОЛОДА плюс ключ карты. По одному ключу карты было
          мало: у двух разных квартир в Дубай-Марине он совпадал, и при
          переключении колод одна из них оставалась висеть на экране. Ключ в
          данных я развёл, но опираться на его единственность больше не буду.
        */}
        {видно.map((c, i) => (
          <КартаСтрока
            key={`${колода}:${(c.id as string) ?? ''}:${i}`}
            c={c}
            onOpen={() => setОткрыта(c)}
            правка={правки.карточки[(c.id as string) ?? '']}
            наПравку={
              правки.можно
                ? (поле, знач) => правки.поставить((c.id as string) ?? '', поле, знач)
                : undefined
            }
          />
        ))}
      </div>

      {открыта && <ПоказКарты c={открыта} onClose={() => setОткрыта(null)} />}
    </div>
  )
}

function КартаСтрока({
  c,
  onOpen,
  правка,
  наПравку,
}: {
  c: Record<string, unknown>
  onOpen: () => void
  /** Что уже поправлено у этой карточки. Пусто — правок нет. */
  правка?: Record<string, string | number>
  /** Пусто — править нельзя (не хозяин): полей не показываем вовсе. */
  наПравку?: (поле: string, значение: string | number | null) => void
}) {
  const [раскрыто, setРаскрыто] = useState(false)
  const [правлю, setПравлю] = useState(false)
  const фото = artForCard(c as { id?: string; symbol?: string })
  const название = (c.title ?? c.name ?? вид(c.type as string)) as string
  const текст = (c.text ?? c.flavor ?? '') as string

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="flex items-start gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-[var(--panel-2)]">
          {фото ? (
            <img src={фото} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="grid size-full place-items-center text-[10px] text-[var(--muted)]">
              нет фото
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-semibold">{название}</span>
            <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
              {вид((c.kind ?? c.type) as string)}
            </span>
            {c.category ? (
              <span className="text-[11.5px] text-[var(--muted)]">{c.category as string}</span>
            ) : null}
          </div>
          {текст && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--muted)]">{текст}</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            {['cost', 'downPayment', 'mortgage', 'cashFlow', 'price', 'amount', 'liability'].map(
              (поле) =>
                typeof c[поле] === 'number' ? (
                  <span key={поле} className="tabnum">
                    <span className="text-[var(--muted)]">{имяПоля(поле)}: </span>
                    {ДЕНЬГИ(c[поле] as number)}
                  </span>
                ) : null,
            )}
            {typeof c.threshold === 'number' && (
              <span className="tabnum text-[rgb(var(--c-warn))]">
                нужен кубик {c.threshold as number}+ — шанс{' '}
                {ПРОЦЕНТ(((7 - (c.threshold as number)) / 6) * 100)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={onOpen} className="text-[12px] font-semibold text-accent hover:underline">
            как в игре
          </button>
          <button
            onClick={() => setРаскрыто((v) => !v)}
            className="text-[12px] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            {раскрыто ? 'свернуть' : 'все поля'}
          </button>
          {наПравку && (
            <button
              onClick={() => setПравлю((v) => !v)}
              className="text-[12px] font-semibold text-[rgb(var(--c-warn))] hover:underline"
            >
              {правлю ? 'готово' : 'править'}
            </button>
          )}
        </div>
      </div>

      {/*
        🔴 Правим только то, что у карточки УЖЕ ЕСТЬ. Список полей строится из
        самой карточки, а не из общего перечня: у бумаги нет взноса, у траты нет
        дохода, и показывать пустые поля — верный способ завести число, которое
        движок никогда не прочитает.
      */}
      {правлю && наПравку && (
        <div className="mt-2 grid gap-2 rounded-lg border border-[rgb(var(--c-warn))]/40 bg-[rgb(var(--c-warn))]/8 p-2.5">
          {['title', 'name', 'text', 'flavor'].map((поле) =>
            typeof c[поле] === 'string' ? (
              <label key={поле} className="grid gap-1 text-[12px]">
                <span className="text-[var(--muted)]">{имяПоля(поле)}</span>
                <textarea
                  defaultValue={String(правка?.[поле] ?? c[поле])}
                  onBlur={(e) => {
                    const v = e.target.value
                    наПравку(поле, v === String(c[поле]) ? null : v)
                  }}
                  rows={поле === 'text' || поле === 'flavor' ? 3 : 1}
                  className="w-full resize-y rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[12.5px] outline-none focus:border-accent"
                />
              </label>
            ) : null,
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.keys(c)
              .filter((k) => typeof c[k] === 'number')
              .map((поле) => (
                <label key={поле} className="grid gap-1 text-[12px]">
                  <span className="text-[var(--muted)]">{имяПоля(поле)}</span>
                  <input
                    type="number"
                    defaultValue={Number(правка?.[поле] ?? (c[поле] as number))}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      наПравку(поле, !Number.isFinite(v) || v === c[поле] ? null : v)
                    }}
                    className="tabnum w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[12.5px] outline-none focus:border-accent"
                  />
                </label>
              ))}
          </div>
          <p className="text-[11px] leading-snug text-[var(--muted)]">
            Значение применяется, когда уходишь из поля. Совпало с исходным — правка
            снимается сама.
          </p>
        </div>
      )}

      {раскрыто && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[var(--panel-2)] p-2.5 text-[11.5px] leading-relaxed">
          {JSON.stringify(c, null, 2)}
        </pre>
      )}
    </div>
  )
}

function имяПоля(k: string): string {
  const имена: Record<string, string> = {
    cost: 'цена',
    downPayment: 'взнос',
    mortgage: 'остаток долга',
    cashFlow: 'доход в месяц',
    price: 'цена',
    amount: 'сумма',
    liability: 'обязательство',
  }
  return имена[k] ?? k
}


/** Оформление карточки в игре: цвет, значок и подпись зависят от вида. */
const ОФОРМЛЕНИЕ: Record<string, { цвет: string; знак: string; ярлык: string }> = {
  realEstate: { цвет: '#047c54', знак: '🏢', ярлык: 'Недвижимость' },
  business: { цвет: '#0369a1', знак: '🏪', ярлык: 'Бизнес' },
  stock: { цвет: '#7c3aed', знак: '📈', ярлык: 'Бумаги' },
  sellOffer: { цвет: '#b45309', знак: '🤝', ярлык: 'Предложение о покупке' },
  stockPrice: { цвет: '#7c3aed', знак: '📊', ярлык: 'Рынок' },
  stockSplit: { цвет: '#7c3aed', знак: '✂️', ярлык: 'Дробление' },
  windfall: { цвет: '#047c54', знак: '🎁', ярлык: 'Нежданные деньги' },
  payRaise: { цвет: '#047c54', знак: '📌', ярлык: 'Прибавка' },
  glEvent: { цвет: '#15803d', знак: '🌿', ярлык: 'Партнёрский бизнес' },
  venture: { цвет: '#f97316', знак: '🛢️', ярлык: 'Рисковый проект' },
  dream: { цвет: '#be185d', знак: '🏆', ярлык: 'Мечта' },
  doodad: { цвет: '#b45309', знак: '🧾', ярлык: 'Трата' },
}

/**
 * Карточка так, как её видит игрок.
 *
 * 🔴 Не сам игровой компонент: тот живёт внутри партии и требует стола, места,
 * денег и фазы хода. Здесь — та же вёрстка на голых данных карты. Поэтому
 * рядом стоит честная пометка: это вид карточки, а не работающая карточка.
 */
function ПоказКарты({ c, onClose }: { c: Record<string, unknown>; onClose: () => void }) {
  const видКарты = (c.kind ?? c.type ?? 'doodad') as string
  const о = ОФОРМЛЕНИЕ[видКарты] ?? ОФОРМЛЕНИЕ.doodad
  const фото = artForCard(c as { id?: string; symbol?: string })
  const название = (c.title ?? c.name ?? о.ярлык) as string
  const текст = (c.text ?? c.flavor ?? '') as string

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const строки: [string, string][] = []
  const число = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null)
  if (число('cost')) строки.push(['Цена', ДЕНЬГИ(число('cost')!)])
  if (число('downPayment')) строки.push(['Первый взнос', ДЕНЬГИ(число('downPayment')!)])
  if (число('cashFlow')) строки.push(['Доход в месяц', `+${ДЕНЬГИ(число('cashFlow')!)}`])
  if (число('price') && видКарты !== 'dream') строки.push(['Цена за бумагу', ДЕНЬГИ(число('price')!)])
  if (число('price') && видКарты === 'dream') строки.push(['Цена мечты', ДЕНЬГИ(число('price')!)])
  if (число('amount')) строки.push(['Сумма', ДЕНЬГИ(число('amount')!)])
  if (число('upkeep')) строки.push(['Останется в расходах', `+${ДЕНЬГИ(число('upkeep')!)}/мес`])
  if (число('threshold'))
    строки.push([
      'Нужно выбросить',
      `${число('threshold')} или больше — шанс ${ПРОЦЕНТ(((7 - число('threshold')!) / 6) * 100)}`,
    ])
  if (Array.isArray(c.range)) {
    const [a, b] = c.range as number[]
    строки.push(['Вилка цены', `${ДЕНЬГИ(a)} — ${ДЕНЬГИ(b)}`])
  }

  return (
    <div
      className="modal-layer fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="pop-in panel w-full max-w-md overflow-auto rounded-2xl p-5"
        style={{ maxHeight: '90dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {фото ? (
          <div
            className="mb-3 overflow-hidden rounded-xl border"
            style={{ borderColor: `${о.цвет}33` }}
          >
            <img src={фото} alt="" className="block h-36 w-full object-cover" />
          </div>
        ) : (
          <div
            className="mb-3 grid h-24 place-items-center overflow-hidden rounded-xl border text-5xl"
            style={{ borderColor: `${о.цвет}33`, background: `${о.цвет}0f` }}
          >
            {о.знак}
          </div>
        )}

        <div
          className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: `${о.цвет}22`, color: о.цвет }}
        >
          {о.ярлык}
        </div>
        <h2 className="text-lg font-bold leading-tight">{название}</h2>
        {текст && <p className="mt-1.5 text-sm italic text-[var(--muted)]">{текст}</p>}

        {строки.length > 0 && (
          <div className="panel-2 mt-4 rounded-lg p-3">
            {строки.map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1.5 last:border-0"
              >
                <span className="text-[13px] text-[var(--muted)]">{k}</span>
                <span className="tabnum text-[13.5px] font-semibold">{v}</span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--muted)]">
          Так карточка выглядит на столе. Кнопки решения здесь не показаны: они зависят
          от того, чей ход, сколько у человека денег и что уже куплено.
        </p>

        <button onClick={onClose} className="btn-primary mt-3 w-full">
          Закрыть
        </button>
      </div>
    </div>
  )
}

function Профессии() {
  const список = professionsFor('ru')
  const строки = список
    .map((p) => {
      const расходы = Object.values(p.expenses as unknown as Record<string, number>).reduce(
        (a, b) => a + (b || 0),
        0,
      )
      return { p, расходы, остаток: p.salary - расходы }
    })
    .sort((a, b) => a.p.salary - b.p.salary)

  const статьи = Object.keys(список[0]?.expenses ?? {})

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[70ch] text-[14px] text-[var(--muted)]">
        Остаток — это скорость, с которой человек может покупать активы. Чем он больше,
        тем быстрее партия.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2 pr-3">Профессия</th>
              <th className="py-2 pr-3 text-right">Зарплата</th>
              {статьи.map((s) => (
                <th key={s} className="py-2 pr-3 text-right">
                  {имяСтатьи(s)}
                </th>
              ))}
              <th className="py-2 pr-3 text-right">Остаток</th>
              <th className="py-2 text-right">На старте</th>
            </tr>
          </thead>
          <tbody>
            {строки.map(({ p, остаток }) => (
              <tr key={p.id} className="border-b border-[var(--line-soft,var(--line))] last:border-0">
                <td className="py-2 pr-3 font-medium">{p.name}</td>
                <td className="tabnum py-2 pr-3 text-right">{ДЕНЬГИ(p.salary)}</td>
                {статьи.map((s) => {
                  const v = (p.expenses as unknown as Record<string, number>)[s] || 0
                  return (
                    <td
                      key={s}
                      className={`tabnum py-2 pr-3 text-right ${v ? '' : 'text-[rgb(var(--c-bad))]'}`}
                    >
                      {v ? ДЕНЬГИ(v) : '0'}
                    </td>
                  )
                })}
                <td className="tabnum py-2 pr-3 text-right font-semibold text-accent">
                  {ДЕНЬГИ(остаток)}
                </td>
                <td className="tabnum py-2 text-right text-[var(--muted)]">{ДЕНЬГИ(p.savings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Строка({ имя, знач, что }: { имя: string; знач: string; что?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--line)] py-2 last:border-0">
      <div className="min-w-[220px] flex-1">
        <div className="text-[14px] font-medium">{имя}</div>
        {что && <div className="text-[12.5px] text-[var(--muted)]">{что}</div>}
      </div>
      <div className="tabnum shrink-0 text-[14px] font-semibold text-accent">{знач}</div>
    </div>
  )
}

function Блок({ имя, children }: { имя: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <div className="caps mb-1 text-[10px] font-bold text-[var(--muted)]">{имя}</div>
      {children}
    </div>
  )
}

function Правила() {
  const проф = professionsFor('ru')
  /*
   * 🔴 Берём правила ИЗ ОПИСАНИЯ РЕЖИМА, а не из живых RULES: живые
   * настраиваются в момент создания стола, и панель, открытая до первой
   * партии, показала бы числа классической колоды вместо русской.
   */
  const пр = { ...RULES, ...THEME_RULES.ru }
  return (
    <div className="flex flex-col gap-3">
      <Блок имя="Поле и победа">
        <Строка имя="Клеток в Рутине" знач={String(RAT_BOARD.length)} />
        <Строка
          имя="Клеток на большом круге"
          знач={String((decksRu.FAST_BOARD_RU as unknown[]).length)}
        />
        <Строка
          имя="Цель по доходу на большом круге"
          знач={ДЕНЬГИ(пр.fastTrackTarget)}
          что="Второй способ победить, кроме покупки мечты"
        />
        <Строка
          имя="Во сколько раз выкупают при выходе из Круга"
          знач={`×${пр.fastTrackMultiplier}`}
          что="Множитель к доходу, который приходит без вашего участия"
        />
      </Блок>

      <Блок имя="Деньги и долги">
        <Строка
          имя="Наценка рассрочки на недвижимость"
          знач={`×${пр.installmentMarkup.realEstate}`}
          что={`Срок ${пр.installmentTerm.realEstate} месяцев`}
        />
        <Строка
          имя="Наценка рассрочки на бизнес"
          знач={`×${пр.installmentMarkup.business}`}
          что={`Срок ${пр.installmentTerm.business} месяцев`}
        />
        <Строка
          имя="Банк с процентным кредитом"
          знач={пр.loansEnabled ? 'есть' : 'нет — халяльный режим'}
          что="На русском столе банка нет: вместо кредита рассрочка и вход в долю"
        />
        <Строка
          имя="Если кредит всё же включат"
          знач={`${RIBA.ratePctMonthly}% в месяц от тела, до ${RIBA.limitIncomeMul} доходов`}
          что={`Первые ${RIBA.gracePaydays} зарплат без платежа. Тело долга платежами не гасится — это ловушка, а не путь`}
        />
        <Строка
          имя="Занять у другого игрока"
          знач="есть всегда"
          что="Между людьми, без процента — это не банк и режимом не выключается"
        />
        <Строка
          имя="Закят"
          знач={пр.zakat.enabled ? `${пр.zakat.pct}%` : 'выключен'}
          что={`Раз в ${пр.zakat.everyPaydays} зарплат`}
        />
      </Блок>

      <Блок имя="Бизнес и управляющий">
        <Строка
          имя="Доля управляющего"
          знач={`${MANAGER_PCT}%`}
          что="Пока управляющего нет, доход бизнеса не идёт в зачёт свободы"
        />
        <Строка имя="Редкий управляющий" знач={`${MANAGER_RARE_PCT}%`} что="Берёт меньше" />
      </Блок>

      <Блок имя="Партнёрский бизнес">
        <Строка имя="Стартовый доход структуры" знач={`${ДЕНЬГИ(GL_START_FLOW)}/мес`} />
        <Строка
          имя="Рост структуры"
          знач={`${GL_START_GROWTH_PCT}% → ${GL_MAX_GROWTH_PCT}%`}
          что="За зарплату, ускоряется по мере закрытия рангов"
        />
        <Строка
          имя="Прибавка за три кабинета"
          знач={`×${GL_TRIANGLE_BONUS}`}
          что="Та же работа, доход выше"
        />
        {GL_PACKAGES.map((p) => (
          <Строка key={p.id} имя={`Пакет «${p.name}»`} знач={ДЕНЬГИ(p.price)} />
        ))}
      </Блок>

      <Блок имя="Прочее">
        <Строка
          имя="Хотелок до выгорания"
          знач={String(WANTS_BEFORE_BURNOUT)}
          что="Столько раз подряд отказал себе — и выгорел"
        />
        <Строка
          имя="Сколько живёт мировое событие"
          знач="до следующего события"
          что="Новость снимает предыдущую начисто: в мире всегда ровно одна"
        />
        <Строка имя="Мировых событий в колоде" знач={String(WORLD_EVENTS.length)} />
        <Строка имя="Профессий" знач={String(проф.length)} />
        <Строка имя="Бумаг на рынке" знач={String(Object.keys(TICKERS).length)} />
      </Блок>
    </div>
  )
}

function Шансы() {
  const малые = smallDeals('ru')
  const крупные = bigDeals('ru')
  const рынок = marketCards('ru')
  const всячина = doodads('ru')

  const состав = (карты: { kind?: string }[]) => {
    const c = new Map<string, number>()
    for (const k of карты) c.set(k.kind ?? '—', (c.get(k.kind ?? '—') ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }

  const колоды = [
    { имя: 'Малые сделки', карты: малые },
    { имя: 'Крупные сделки', карты: крупные },
    { имя: 'Рынок и события', карты: рынок },
  ]

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[72ch] text-[14px] text-[var(--muted)]">
        Шанс встретить карточку — это её доля в колоде. Но на неё сверху ложится
        отбор: карта, которую игрок не может себе позволить, не показывается вовсе
        и уходит обратно в колоду. Поэтому дорогие карточки в начале партии не
        выпадают почти никогда, сколько бы их ни было.
      </p>

      {колоды.map(({ имя, карты }) => (
        <Блок key={имя} имя={`${имя} — ${карты.length} карт`}>
          {состав(карты as { kind?: string }[]).map(([k, n]) => (
            <Строка
              key={k}
              имя={вид(k)}
              знач={`${n} шт · ${ПРОЦЕНТ((n / карты.length) * 100)}`}
            />
          ))}
        </Блок>
      ))}

      <Блок имя={`Всячина и траты — ${всячина.length} карт`}>
        <Строка
          имя="Из них «хотелки» (можно пропустить)"
          знач={String((всячина as DoodadCard[]).filter((d) => (d as { want?: boolean }).want).length)}
        />
        <Строка
          имя="Можно взять в рассрочку"
          знач={String(
            (всячина as DoodadCard[]).filter((d) => (d as { financeable?: boolean }).financeable)
              .length,
          )}
        />
        <Строка
          имя="Разброс сумм"
          знач={`${ДЕНЬГИ(
            Math.min(...(всячина as unknown as { amount: number }[]).map((d) => d.amount)),
          )} — ${ДЕНЬГИ(
            Math.max(...(всячина as unknown as { amount: number }[]).map((d) => d.amount)),
          )}`}
        />
      </Блок>

      <Блок имя="Бумаги: разброс цены">
        {Object.entries(TICKERS).map(([символ, t]) => (
          <Строка
            key={символ}
            имя={`${символ} · ${t.name}`}
            знач={`${ДЕНЬГИ(t.range[0])} — ${ДЕНЬГИ(t.range[1])}`}
            что={`Во сколько раз может вырасти: ×${Math.round((t.range[1] / t.range[0]) * 10) / 10}`}
          />
        ))}
      </Блок>
    </div>
  )
}

/** Панель открывается адресом `?admin=1` и нигде не показана ссылкой. */
export function хочетПанель(): boolean {
  try {
    return new URLSearchParams(location.search).get('admin') === '1'
  } catch {
    return false
  }
}

export type { Profession, DealCard, DoodadCard, MarketCard }
