import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Table, WorldEffect, WorldEvent } from '../engine/types'
import { WORLD_EVENTS } from '../engine/data'
import { artByWorld } from './cardArt'
import { money } from './PlayerPanel'
import { WORLD_EVENT_MIN } from './useGame'
import { subscribeWorldClock, worldEventDeadline } from './worldClock'

/** Сколько карточка события висит на экране. Ход она не блокирует — только показывается. */
// Карточка события больше не уходит по таймеру — закрывается кнопкой «Понятно».

/**
 * Когда какое событие выпало — в этой сессии. В сохранение попадают только
 * сетап и журнал ходов, времени там нет: после перезагрузки партия
 * проигрывается мгновенно, и «12 минут назад» было бы выдумкой.
 * Поэтому время знаем только про то, что видели своими глазами.
 */
const SEEN_AT = new Map<string, number>()

// ─── Человеческие имена классов активов ───────────────────────────────

/** Коротко — для тесной строки индикатора. */
const CAT_SHORT: Record<string, string> = {
  roomUFA: 'Уфа',
  aptKZN: 'Казань',
  aptMSK: 'Москва',
  aptSPB: 'Питер',
  aptDXB: 'Дубай',
  aptTUR: 'Турция',
  parking: 'машиноместа',
  land: 'участки',
  houseRF: 'загород',
  bizFood: 'общепит',
  bizService: 'услуги',
  bizDigital: 'цифровой бизнес',
  partnership: 'партнёрские доли',
}

/** Полностью — для карточки события и истории. */
const CAT_FULL: Record<string, string> = {
  roomUFA: 'комнаты в Уфе',
  aptKZN: 'квартиры в Казани',
  aptMSK: 'квартиры в Москве',
  aptSPB: 'квартиры в Питере',
  aptDXB: 'квартиры в Дубае',
  aptTUR: 'квартиры в Турции',
  parking: 'машиноместа',
  land: 'участки',
  houseRF: 'дома за городом',
  bizFood: 'общепит',
  bizService: 'услуги',
  bizDigital: 'цифровой бизнес',
  partnership: 'партнёрские доли',
}

const SYM_FULL: Record<string, string> = {
  GOLD: 'золото',
  SUKUK: 'сукук',
  VLT4: 'сберсертификат',
  USDR: 'стейблкоин',
}

/**
 * Наборы, которые в игре всегда ходят вместе. Нужны, чтобы вместо
 * «Уфа, Казань, Москва, Питер и ещё 3 дороже на 12%» получалось
 * «жильё дороже на 12%» — то есть фраза, а не список.
 */
const FAMILIES: { keys: string[]; short: string; full: string }[] = [
  {
    keys: ['roomUFA', 'aptKZN', 'aptMSK', 'aptSPB', 'houseRF', 'parking', 'land'],
    short: 'жильё',
    full: 'жильё в России',
  },
  { keys: ['roomUFA', 'aptKZN', 'aptMSK', 'aptSPB', 'parking'], short: 'аренда', full: 'аренда в городах' },
  { keys: ['bizFood', 'bizService', 'bizDigital', 'partnership'], short: 'бизнес', full: 'весь бизнес' },
  { keys: ['bizFood', 'bizService'], short: 'бизнес', full: 'общепит и услуги' },
  /*
   * 🔴 Наборы должны совпадать с ТИКЕРАМИ ИЗ КОЛОДЫ, иначе группировка не
   * срабатывает и в строке рынка печатаются сырые AAPL/TSLA/TON. Здесь стояли
   * тикеры старых колод, которых в русской нет вовсе.
   */
  { keys: ['SHIB', 'PEPE', 'MOONX'], short: 'мемкоины', full: 'мемкоины' },
  { keys: ['BTC', 'ETH', 'SOL', 'TON'], short: 'крипта', full: 'криптовалюты' },
  { keys: ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOGL'], short: 'технологии', full: 'технологические акции' },
  { keys: ['AAPL', 'NVDA', 'MSFT', 'PLZL', 'GOOGL'], short: 'акции', full: 'акции' },
]

const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function joinRu(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`
}

/** Список категорий/тикеров одной фразой: сначала целые семейства, потом остатки. */
function labelSet(keys: string[], short: boolean): string {
  const rest = [...keys]
  const parts: string[] = []
  for (const f of [...FAMILIES].sort((a, b) => b.keys.length - a.keys.length)) {
    if (!f.keys.every((k) => rest.includes(k))) continue
    parts.push(short ? f.short : f.full)
    for (const k of f.keys) rest.splice(rest.indexOf(k), 1)
  }
  for (const k of rest) parts.push((short ? CAT_SHORT[k] : CAT_FULL[k]) ?? SYM_FULL[k] ?? k)
  const cap = short ? 3 : 4
  if (parts.length <= cap) return joinRu(parts)
  return `${parts.slice(0, cap).join(', ')} и ещё ${parts.length - cap}`
}

// ─── Состояние рынка человеческим языком ──────────────────────────────

export interface MarketMove {
  kind: 'price' | 'flow' | 'stock'
  keys: string[]
  /** Накопленный сдвиг в процентах, уже округлённый. */
  pct: number
}

const KIND_LABEL: Record<MarketMove['kind'], string> = {
  price: 'Цены',
  flow: 'Доходы',
  stock: 'Котировки',
}

/**
 * Множители стола → набор фраз. Одинаковые сдвиги склеиваются в одну строку,
 * поэтому «+12% на семи категориях» читается как одно изменение, а не как семь.
 */
export function marketMoves(market: Table['market']): MarketMove[] {
  const out: MarketMove[] = []
  const collect = (kind: MarketMove['kind'], dict: Record<string, number>) => {
    const byPct = new Map<number, string[]>()
    for (const [key, mul] of Object.entries(dict)) {
      const pct = Math.round((mul - 1) * 100)
      if (!pct) continue
      const list = byPct.get(pct)
      if (list) list.push(key)
      else byPct.set(pct, [key])
    }
    for (const [pct, keys] of byPct) out.push({ kind, keys, pct })
  }
  collect('price', market.price)
  collect('flow', market.flow)
  collect('stock', market.stock)
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
}

export function movePhrase(m: MarketMove, short = false): string {
  const who = labelSet(m.keys, short)
  const p = Math.abs(m.pct)
  if (m.kind === 'price') return `${who} ${m.pct > 0 ? 'дороже' : 'дешевле'} на ${p}%`
  if (m.kind === 'flow') return `${who} ${m.pct > 0 ? 'прибыльнее' : 'слабее'} на ${p}%`
  return `${who} ${m.pct > 0 ? '+' : '−'}${p}%`
}

// ─── Что именно поменяло событие ──────────────────────────────────────

export function effectKindLabel(e: WorldEffect): string {
  switch (e.kind) {
    case 'assetPrice':
      return 'Цены'
    case 'assetFlow':
      return 'Доходы'
    case 'stockPrice':
      return 'Котировки'
    case 'cashAll':
      return 'Деньги'
    case 'expenseAll':
      return 'Расходы'
    case 'salaryAll':
      return 'Зарплата'
    case 'frictionAll':
      return 'Трение'
  }
}

/** Одна строка: что конкретно поменялось. Без неё событие — просто новость. */
export function effectText(e: WorldEffect, short = false): string {
  const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v)}%`
  switch (e.kind) {
    case 'assetPrice':
      return movePhrase({ kind: 'price', keys: e.categories, pct: e.pct }, short)
    case 'assetFlow':
      return movePhrase({ kind: 'flow', keys: e.categories, pct: e.pct }, short)
    case 'stockPrice':
      return movePhrase({ kind: 'stock', keys: e.symbols, pct: e.pct }, short)
    case 'cashAll':
      return e.amount < 0 ? `у каждого спишется ${money(-e.amount)}` : `каждому придёт ${money(e.amount)}`
    // Названия видов не повторяем: перед текстом уже стоит «Расходы»/«Зарплата».
    case 'expenseAll':
      return `прочие ${pct(e.pct)} у всех`
    case 'salaryAll':
      return `${pct(e.pct)} у всех`
    case 'frictionAll':
      return `${money(-e.amount)} со всех, кроме тех, у кого второй паспорт`
  }
}

/** Приятно это игрокам или нет — только для цвета плашки. */
function goodness(e: WorldEffect): 1 | -1 {
  switch (e.kind) {
    case 'assetPrice':
    case 'assetFlow':
    case 'stockPrice':
    case 'salaryAll':
      return e.pct >= 0 ? 1 : -1
    case 'cashAll':
      return e.amount >= 0 ? 1 : -1
    case 'expenseAll':
      // Рост расходов — плохая новость, знак процента здесь читается наоборот.
      return e.pct > 0 ? -1 : 1
    case 'frictionAll':
      return e.amount >= 0 ? 1 : -1
  }
}

// ─── Обратный отсчёт до следующего события ────────────────────────────

function useWorldCountdown(): number | null {
  const deadline = useSyncExternalStore(subscribeWorldClock, worldEventDeadline, worldEventDeadline)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  if (!deadline) return null
  return Math.max(0, deadline - now)
}

/** Так мировое событие подписано в журнале стола (см. applyWorldEvent). */
const WORLD_LOG_MARK = '🌍 '

/**
 * Что уже выпадало за партию.
 *
 * Считаем по журналу стола: там записано то, что действительно случилось,
 * даже если событие пришло не по порядку колоды. Журнал обрезается на
 * 300 строках, поэтому начало длинной партии добираем из самой колоды —
 * она не обрезается никогда.
 */
function playedEvents(table: Table): WorldEvent[] {
  const byTitle = new Map(WORLD_EVENTS.map((e) => [e.title, e]))
  const fromLog = table.log
    .filter((l) => l.seatId === null && l.text.startsWith(WORLD_LOG_MARK))
    .map((l) => byTitle.get(l.text.slice(WORLD_LOG_MARK.length)))
    .filter((e): e is WorldEvent => !!e)

  const order = table.worldDeck.order
  const missing = Math.min(Math.max(table.worldDeck.next - fromLog.length, 0), order.length)
  const head = order
    .slice(0, missing)
    .map((i) => WORLD_EVENTS[i])
    .filter((e): e is WorldEvent => !!e)

  return [...head, ...fromLog]
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  return `${h} ч ${min % 60} мин назад`
}

// ─── Карточка события: прилетает на стол, ход не блокирует ────────────

/**
 * Карточка мирового события.
 *
 * 🔴 Сама НЕ исчезает и закрывается кнопкой «Понятно». Раньше уходила по
 * таймеру, и Камиль не успевал прочитать: «уведомление уходит очень быстро,
 * потом его нельзя посмотреть заново». Мир двигается редко и сильно —
 * все за столом должны успеть прочитать. Перечитать можно в истории.
 */
function EventToast({ event, onClose }: { event: WorldEvent; onClose: () => void }) {
  const good = goodness(event.effect)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
      <div className="card-fly-in panel w-full max-w-md overflow-hidden rounded-2xl shadow-[var(--shadow-pop)]">
        {/* Событие двигает рынок у всех — пусть и выглядит как новость. */}
        {artByWorld(event.id) && (
          <img
            src={artByWorld(event.id)!}
            alt=""
            className="h-36 w-full object-cover sm:h-44"
            loading="lazy"
          />
        )}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className="chip chip-accent">🌍 Мировое событие</span>
            <span className="text-[11px] text-[var(--muted)]">{event.severity}</span>

          </div>

          <h3 className="mt-2.5 text-base font-bold leading-tight">{event.title}</h3>
          <p className="mt-1.5 text-[13px] leading-snug text-[var(--muted)]">{event.flavor}</p>

          {/* Пилюлей не делаем: на телефоне длинная фраза в неразрывном чипе уезжает за край. */}
          <div className="hairline mt-3 pt-3">
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="shrink-0 text-[var(--muted)]">{effectKindLabel(event.effect)}:</span>
              <span className={`font-semibold ${good > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {effectText(event.effect)}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">сразу у всех за столом</div>
          </div>

          <button onClick={onClose} className="btn-primary mt-4 w-full">
            Понятно
          </button>
          <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
            Перечитать можно в строке рынка наверху
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── История мировых событий партии ───────────────────────────────────

function HistoryModal({ table, onClose }: { table: Table; onClose: () => void }) {
  const left = useWorldCountdown()
  const now = Date.now()
  const moves = marketMoves(table.market)
  const history = playedEvents(table)
  const items = history
    .map((ev, i) => ({ ev, no: i + 1, at: SEEN_AT.get(`${table.seed}#${i}`) }))
    .reverse()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="pop-in panel max-h-[88vh] w-full max-w-lg overflow-auto rounded-2xl p-4 shadow-[var(--shadow-pop)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">🌍 Мировые события</h2>
          <button onClick={onClose} aria-label="Закрыть" className="-m-2 p-2 text-[var(--muted)] hover:text-[var(--ink)]">
            ✕
          </button>
        </div>

        <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
          Сейчас на рынке
        </div>
        {moves.length ? (
          <div className="space-y-1.5">
            {moves.map((m, i) => (
              <div key={i} className="panel-2 flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-[13px]">
                <span className="text-[var(--muted)]">{KIND_LABEL[m.kind]}</span>
                <span className={m.pct > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {cap1(movePhrase(m))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-2 rounded-lg px-3 py-2 text-[13px] text-[var(--muted)]">
            Рынок спокоен — цены и доходы стоят там, где начинали.
          </p>
        )}

        <div className="panel-2 mt-3 flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-[13px]">
          <span className="text-[var(--muted)]">Следующее событие</span>
          <span className="tabnum font-semibold">{left === null ? '—' : `через ${clock(left)}`}</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted)]">
          Мир двигается сам раз в {WORLD_EVENT_MIN} минут реального времени — независимо от того, чей ход.
          Событие задевает всех сразу.
        </p>

        <div className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
          Что уже выпадало — {history.length} из {WORLD_EVENTS.length}
        </div>
        {items.length ? (
          <div className="space-y-1.5">
            {items.map((it) => (
              <div key={`${it.ev.id}-${it.no}`} className="panel-2 rounded-lg px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="tabnum shrink-0 text-[11px] font-bold text-[var(--muted)]">{it.no}.</span>
                  <span className="text-[13px] font-semibold leading-snug">{it.ev.title}</span>
                  {/* Время знаем только про события этой сессии — см. SEEN_AT. */}
                  {it.at && (
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--muted)]">{ago(it.at, now)}</span>
                  )}
                </div>
                <div className="mt-1 pl-5 text-[12px] text-[var(--muted)]">
                  {effectKindLabel(it.ev.effect)}: {effectText(it.ev.effect)} · {it.ev.severity}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-2 rounded-lg px-3 py-2 text-[13px] text-[var(--muted)]">
            Пока ничего не случилось. Первое событие придёт по таймеру.
          </p>
        )}

        <button onClick={onClose} className="btn-ghost mt-4 w-full">
          Понятно
        </button>
      </div>
    </div>
  )
}

// ─── Постоянный индикатор рынка ───────────────────────────────────────

function MarketBar({
  table,
  onOpen,
  compact,
}: {
  table: Table
  onOpen: () => void
  /** Рядом с игроками: без своей строки, короче и с меньшим числом плашек. */
  compact?: boolean
}) {
  const left = useWorldCountdown()
  const moves = marketMoves(table.market)
  const shown = moves.slice(0, 3)
  const hidden = moves.length - shown.length

  /*
   * 🔴 В колонке рядом с игроками полоса раскладывается В ДВА ЭТАЖА, а не в
   * одну строку с горизонтальной прокруткой. Одной строкой фраза «Казань и
   * Уфа дешевле на 12%» не помещалась и обрывалась на полуслове, а песочные
   * часы налезали на текст. Здесь ширина конечна — значит, переносим.
   */
  if (compact) {
    return (
      <button
        onClick={onOpen}
        title="История мировых событий"
        aria-label="Состояние рынка и история мировых событий"
        className="flex w-full flex-col gap-1.5 rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] px-2.5 py-2 text-left text-[var(--t-ink)] backdrop-blur-md transition hover:border-[var(--t-accent)]"
      >
        <span className="flex w-full items-center gap-1.5">
          <span className="shrink-0 text-sm leading-none">🌍</span>
          <span
            className="tabnum ml-auto shrink-0 text-[12px] font-semibold text-[var(--muted)]"
            title={`До следующего мирового события. Мир двигается раз в ${WORLD_EVENT_MIN} минут.`}
          >
            ⏳ {left === null ? '—:—' : clock(left)}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--muted)]">›</span>
        </span>
        <span className="flex flex-wrap gap-1">
          {shown.length ? (
            shown.map((m, i) => (
              <span
                key={i}
                className={`chip max-w-full whitespace-normal text-left leading-snug ${m.pct > 0 ? 'chip-good' : 'chip-bad'}`}
              >
                {movePhrase(m, true)}
              </span>
            ))
          ) : (
            <span className="chip">спокойно</span>
          )}
          {hidden > 0 && <span className="chip">+{hidden}</span>}
        </span>
      </button>
    )
  }

  return (
    <button
      onClick={onOpen}
      title="История мировых событий"
      aria-label="Состояние рынка и история мировых событий"
      className="mb-3 flex w-full items-center gap-1.5 rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] px-2.5 py-2 text-left text-[var(--t-ink)] backdrop-blur-md transition hover:border-[var(--t-accent)]"
    >
      <span className="shrink-0 text-sm leading-none">🌍</span>
      <span className="hidden shrink-0 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)] xs:inline">
        Рынок
      </span>

      <span className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {shown.length ? (
          shown.map((m, i) => (
            <span key={i} className={`chip ${m.pct > 0 ? 'chip-good' : 'chip-bad'}`}>
              {movePhrase(m, true)}
            </span>
          ))
        ) : (
          <span className="chip">спокойно</span>
        )}
        {hidden > 0 && <span className="chip">+{hidden}</span>}
      </span>

      <span
        className="tabnum shrink-0 text-[12px] font-semibold text-[var(--muted)]"
        title={`До следующего мирового события. Мир двигается раз в ${WORLD_EVENT_MIN} минут.`}
      >
        ⏳ {left === null ? '—:—' : clock(left)}
      </span>
      <span className="shrink-0 text-[10px] text-[var(--muted)]">›</span>
    </button>
  )
}

// ─── Точка монтирования ───────────────────────────────────────────────

/**
 * Мировые события целиком: полоса состояния рынка, карточка нового события
 * и история партии. В Game.tsx вставляется одной строкой.
 */
export function WorldEvents({ table, compact }: { table: Table; compact?: boolean }) {
  const [history, setHistory] = useState(false)
  const [fresh, setFresh] = useState<{ ev: WorldEvent; key: string } | null>(null)
  const stamp = table.lastWorldEvent ? `${table.lastWorldEvent.id}#${table.lastWorldEvent.at}` : ''
  // Первый кадр — точка отсчёта: восстановленную из сохранения партию
  // не встречаем карточкой события, которое случилось до перезагрузки.
  const seen = useRef<string | null>(null)

  useEffect(() => {
    if (seen.current === null) {
      seen.current = stamp
      return
    }
    if (!stamp || stamp === seen.current) return
    seen.current = stamp
    const idx = table.worldDeck.next - 1
    if (idx >= 0) SEEN_AT.set(`${table.seed}#${idx}`, Date.now())
    const ev = WORLD_EVENTS.find((e) => e.id === table.lastWorldEvent?.id)
    if (ev) setFresh({ ev, key: stamp })
  }, [stamp, table])

  /*
   * 🔴 Событие само НЕ исчезает. Камиль: «уведомление уходит очень быстро,
   * потом его нельзя посмотреть заново». Мир двигается редко и сильно — все
   * за столом должны успеть прочитать, что произошло, и закрыть по кнопке.
   * История всё равно остаётся: её открывает строка рынка.
   */

  return (
    <>
      <MarketBar table={table} compact={compact} onOpen={() => setHistory(true)} />
      {fresh && <EventToast key={fresh.key} event={fresh.ev} onClose={() => setFresh(null)} />}
      {history && <HistoryModal table={table} onClose={() => setHistory(false)} />}
    </>
  )
}
