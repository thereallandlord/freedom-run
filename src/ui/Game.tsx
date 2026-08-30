import { useEffect, useRef, useState } from 'react'
import type { Table, Seat } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { currentSeat, diceCountFor, pendingInvolvesOthers, stockPriceNow,
  pendingUndecided,
} from '../engine/table'
import {
  RULES,
  fastTrackIncome,
  fastTrackProgress,
  fastTrackTarget,
  isOutOfRatRace,
  freedomIncome,
  monthlyCashFlow,
  netWorth,
  passiveIncome,
  totalExpenses,
} from '../engine/ledger'
import { Board } from './Board'
import { PlayerPanel, money, signed, tone } from './PlayerPanel'
import { CardModal } from './CardModal'
import { Pips } from './Pips'
import { Лента, ЛентаКолонка } from './Лента'
import { ГолосПанель } from './ГолосПанель'
import { BankModal } from './BankModal'
import { PortfolioModal } from './PortfolioModal'
import { DebriefModal } from './DebriefModal'
import { TradesModal } from './TradesModal'
import { OfferInbox } from './OfferInbox'
import { Wordmark } from './Wordmark'
import { liveOffers, offerResponders, playerDebt } from './tradeHelpers'
import type { Offer } from '../engine/trades'
import { WorldEvents } from './WorldEvents'
import { BOARD_THEMES, setBoardTheme, themeVars, useBoardTheme } from './theme-board'
import { warmNow, warmRestWhenIdle } from './preloadArt'
import { useTheme } from './theme'
import { Dropdown } from './Dropdown'

/**
 * Игроки за столом.
 *
 * 🔴 Столбиком в правой колонке (правка Камиля): полоской наверху они съедали
 * высоту у доски, а справа было пусто. Столбиком помещается больше — видно и
 * наличные, и доход, и насколько человек близок к свободе.
 */
function Scoreboard({
  table,
  viewId,
  onView,
  stacked,
}: {
  table: Table
  viewId: string
  onView: (id: string) => void
  stacked?: boolean
}) {
  return (
    <div
      className={
        stacked
          ? 'grid gap-1.5'
          : '-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0'
      }
    >
      {table.seats.map((s, i) => {
        const active = i === table.turnIndex
        const flow = s.track === 'fast' ? fastTrackIncome(s.ledger) : monthlyCashFlow(s.ledger, table.market.flow)
        /*
         * Насколько человек близок к цели — считаем ТЕМ ЖЕ способом, что и его
         * собственная панель (PlayerPanel).
         *
         * 🔴 На Полосе свободы цель другая: не «доход перерос расходы», а
         * «доход дошёл до цели». Расходов Круга там уже нет, поэтому прежняя
         * формула делила на ноль и показывала всем 0%, пока слева честно рос
         * процент. Живая жалоба 19.08: «справа до свободы висит 0%».
         */
        const наПолосе = s.track === 'fast'
        const have = наПолосе ? fastTrackProgress(s.ledger) : freedomIncome(s.ledger, table.market.flow)
        const need = наПолосе ? fastTrackTarget() : totalExpenses(s.ledger)
        const pct = Math.max(0, Math.min(100, Math.round((have / Math.max(1, need)) * 100)))
        return (
          <button
            key={s.id}
            onClick={() => onView(s.id)}
            className={`shrink-0 rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] px-2.5 py-1.5 text-left text-xs text-[var(--t-ink)] backdrop-blur-md transition ${
              stacked ? 'w-full' : 'flex items-center gap-2'
            } ${viewId === s.id ? 'border-emerald-500/70' : ''} ${s.outOfGame ? 'opacity-40' : ''}`}
          >
            <span className={stacked ? 'flex items-center gap-2' : 'contents'}>
              <span
                className={`size-2.5 shrink-0 rounded-full ${active ? 'ring-2 ring-white/70' : ''}`}
                style={{ background: s.color }}
              />
              <span className="font-semibold">{s.name}</span>
              <span className={`tabnum text-[var(--t-muted, var(--muted))] ${stacked ? 'ml-auto' : ''}`}>
                {money(s.ledger.cash)}
              </span>
              {!stacked && <span className={`tabnum ${tone(flow)}`}>{signed(flow)}</span>}
              {s.won && <span className="text-[10px]">🏆</span>}
              {!s.won && s.track === 'fast' && (
                <span className="text-[10px] text-emerald-400">свобода</span>
              )}
              {s.skipTurns > 0 && <span className="text-[10px] text-amber-400">−{s.skipTurns}</span>}
            </span>
            {stacked && (
              <>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--t-line,var(--line))]">
                  <span
                    className="block h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${pct}%`, background: 'var(--t-accent)' }}
                  />
                </span>
                <span className="mt-1 flex justify-between text-[10.5px]">
                  {/*
                    🔴 «До свободы 39%» читалось как «осталось 39%», а это
                    доля УЖЕ СОБРАННОГО — и полоска рядом заполнена ровно на
                    неё. Камиль поймал на живой игре: «по факту это 39% у тебя
                    собрано, до свободы получается 61%».
                  */}
                  <span className="text-[var(--t-muted, var(--muted))]">собрано {pct}%</span>
                  <span className={`tabnum ${tone(flow)}`}>{signed(flow)}</span>
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Всплывашка над доской: откуда пришли деньги. Жалоба с созвона — «бабки растут, непонятно». */
function MoneyToast({ table }: { table: Table }) {
  const [note, setNote] = useState<{ text: string; key: number } | null>(null)
  const lastLen = useRef(table.log.length)

  useEffect(() => {
    if (table.log.length <= lastLen.current) {
      lastLen.current = table.log.length
      return
    }
    const fresh = table.log.slice(lastLen.current)
    lastLen.current = table.log.length
    const hit = [...fresh]
      .reverse()
      .find((e) => /Зарплата|выплата|Повышение|вычет|Автопромоушен|Партнёрский бизнес|Образ жизни/i.test(e.text))
    if (hit) setNote({ text: hit.text, key: Date.now() })
  }, [table.log.length])

  useEffect(() => {
    if (!note) return
    const id = window.setTimeout(() => setNote(null), 2600)
    return () => window.clearTimeout(id)
  }, [note])

  if (!note) return null
  return (
    <div
      key={note.key}
      className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-4 py-1.5 text-sm font-semibold text-emerald-300 shadow-lg backdrop-blur pop-in"
    >
      {note.text}
    </div>
  )
}

/**
 * Ответ бота на предложение сделки. Согласие движок пишет в журнал сам,
 * а отказ — это просто исчезнувшее предложение, и без строки он выглядел бы
 * как «ничего не произошло».
 */
function TradeToast({ table }: { table: Table }) {
  const [note, setNote] = useState<{ text: string; key: number } | null>(null)
  const seen = useRef<{ offers: Offer[]; logLen: number }>({
    offers: table.offers,
    logLen: table.log.length,
  })

  useEffect(() => {
    const prev = seen.current
    seen.current = { offers: table.offers, logLen: table.log.length }
    const gone = prev.offers.filter((o) => !table.offers.some((x) => x.id === o.id))
    if (!gone.length) return
    // Интересны только те, где решал бот: свой отказ человек и так видел.
    const byBot = gone.find((o) => {
      const r = offerResponders(table, o)
      return r.length > 0 && r.every((s) => s.isBot)
    })
    if (!byBot) return
    const who = offerResponders(table, byBot).map((s) => s.name).join(', ')
    const accepted = table.log.length > prev.logLen
    setNote({
      text: accepted ? table.log[table.log.length - 1].text : `🤖 ${who}: пас — предложение снято`,
      key: Date.now(),
    })
  }, [table])

  useEffect(() => {
    if (!note) return
    const id = window.setTimeout(() => setNote(null), 3200)
    return () => window.clearTimeout(id)
  }, [note])

  if (!note) return null
  return (
    <div
      key={note.key}
      className="pop-in pointer-events-none absolute left-1/2 top-3 z-20 max-w-[90%] -translate-x-1/2 rounded-full border border-[var(--t-line, var(--line))] bg-[var(--panel)] px-4 py-1.5 text-center text-sm font-semibold shadow-[var(--shadow-pop)]"
    >
      {note.text}
    </div>
  )
}

function WinScreen({
  table,
  onNew,
  onUndo,
  onRematch,
}: {
  table: Table
  onNew: () => void
  onUndo: () => void
  onRematch: () => void
}) {
  const winner = table.seats.find((s) => s.id === table.winnerId)
  const standings = [...table.seats].sort((a, b) => netWorth(b.ledger) - netWorth(a.ledger))
  return (
    <div className="modal-layer fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4">
      <div className="pop-in panel w-full max-w-md rounded-2xl p-6 text-center">
        <div className="text-5xl">🏆</div>
        <h2 className="mt-3 text-2xl font-black">
          {winner ? `${winner.name} побеждает!` : 'Все обанкротились'}
        </h2>
        {table.seats.filter((s) => s.won).length > 1 && (
          <p className="mt-1 text-sm text-[var(--t-muted, var(--muted))]">
            Цели достигли: {table.seats.filter((s) => s.won).map((s) => s.name).join(', ')}
          </p>
        )}
        {winner?.ledger.winReason === 'dream' && winner.ledger.fastTrack?.dream && (
          <p className="mt-1 text-sm text-[var(--t-muted, var(--muted))]">
            Купил мечту «{winner.ledger.fastTrack.dream.name}» за{' '}
            {money(winner.ledger.fastTrack.dream.pricePaid)}
          </p>
        )}
        {winner?.ledger.winReason === 'cashflowGoal' && (
          <p className="mt-1 text-sm text-[var(--t-muted, var(--muted))]">
            Собрал цель по доходу на Полосе свободы
          </p>
        )}

        <div className="mt-5 space-y-1 text-left">
          {standings.map((s, i) => (
            <div key={s.id} className="panel-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="text-[var(--t-muted, var(--muted))]">{i + 1}.</span>
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
                {s.won && <span className="text-xs text-emerald-400">🏆</span>}
                {s.outOfGame && <span className="text-xs text-rose-400">(банкрот)</span>}
              </span>
              <span className="tabnum text-[var(--t-muted, var(--muted))]">
                капитал {money(netWorth(s.ledger))}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <button onClick={onRematch} className="btn-primary w-full py-2.5">
            🔁 Реванш — те же игроки, свежие колоды
          </button>
          <div className="flex gap-2">
            <button onClick={onNew} className="btn-ghost flex-1">
              Новая партия
            </button>
            <button onClick={onUndo} className="btn-ghost">
              Отменить ход
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Game({
  table,
  dispatch,
  roll,
  rolling,
  rolled,
  undo,
  redo,
  canRedo,
  canUndo,
  reset,
  rematch,
  onExit,
  callUrl,
  meId,
  events,
  topRight,
  хозяин,
  ходитЗа,
  подхватить,
  моёМесто,
  голосКомната,
  голосЯ,
}: {
  table: Table
  dispatch: (e: TableEvent) => void
  roll: (count: number) => void
  rolling: boolean
  rolled: number[] | null
  undo: () => void
  redo: () => void
  canRedo: boolean
  /** Отменять ход может только хозяин стола: иначе каждый крутил бы общий журнал. */
  canUndo: boolean
  reset: () => void
  rematch: () => void
  /** Уйти на главную, НЕ стирая партию. */
  onExit: () => void
  /** Ссылка на созвон из настроек комнаты. Пусто — кнопки нет. */
  callUrl?: string
  /** Журнал ходов — из него собирается разбор партии. */
  events: TableEvent[]
  /**
   * Моё место за столом в сетевой партии.
   *
   * 🔴 Без него экран считал «своим» ТОГО, ЧЕЙ СЕЙЧАС ХОД. В игре на одном
   * устройстве это верно — кубик переходит из рук в руки. Но онлайн это
   * означало, что каждый видел чужие финансы в левой панели и мог бросить
   * кубик за соседа. Пусто — значит хот-сит, поведение прежнее.
   */
  meId?: string
  topRight?: React.ReactNode
  /** Я хозяин стола — значит могу походить за отошедшего. */
  хозяин?: boolean
  /** За кого сейчас ходит хозяин. Пусто — за себя. */
  ходитЗа?: string | null
  подхватить?: (seatId: string | null) => void
  /** Моё собственное место — за себя ходить не «подхватывают». */
  моёМесто?: string
  /** Код комнаты для голоса. Пусто — партия местная, голос не нужен. */
  голосКомната?: string
  голосЯ?: { id: string; имя: string }
}) {
  const actor = currentSeat(table)
  /** Кем я играю: онлайн — своим местом, на одном устройстве — тем, чей ход. */
  const seat = (meId ? table.seats.find((x) => x.id === meId) : null) ?? actor
  /** Мой ли сейчас ход. */
  const myTurn = actor.id === seat.id
  /**
   * 🔴 Левая панель показывает ТОЛЬКО МОИ деньги и никогда чужие.
   * Раньше клик по игроку справа подменял в ней человека — и через пару
   * кликов было не понять, чьи цифры перед тобой и чей долг ты гасишь.
   * Чужое теперь открывается отдельным окном и только на просмотр.
   */
  const [peekId, setPeekId] = useState<string | null>(null)
  const [bankOpen, setBankOpen] = useState(false)
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [debriefOpen, setDebriefOpen] = useState(false)
  const [tradesOpen, setTradesOpen] = useState(false)
  /** Предложения, которые отложили кнопкой «Позже» — не лезут снова сами. */
  const [hiddenOffers, setHiddenOffers] = useState<string[]>([])
  const peeked = peekId ? (table.seats.find((s) => s.id === peekId) ?? null) : null

  /*
   * Слева — ВСЕГДА мои деньги. На одном устройстве «мои» меняются вместе с
   * ходом, онлайн — нет. Чужое видно по клику на карточку игрока справа.
   */
  // Сменился ход — закрываем чужое окно: оно про прошлый момент.
  useEffect(() => setPeekId(null), [table.turnIndex])

  const myDebt = playerDebt(table, seat.id)

  /** Пустил ли меня владелец находки в свою сделку. */
  const pendingAccess =
    table.pending && (table.pending.kind === 'deal' || table.pending.kind === 'market')
      ? table.pending.access
      : undefined
  const allowedIn =
    !!pendingAccess &&
    (pendingAccess.mode === 'open' ||
      (pendingAccess.mode === 'chosen' && pendingAccess.allow.includes(seat.id)))
  // Сначала показываем то, где ответ за человеком; предложения ботам — фоном.
  const openOffers = liveOffers(table).filter((o) => !hiddenOffers.includes(o.id))
  const inbox =
    openOffers.find((o) => offerResponders(table, o).some((s) => !s.isBot)) ?? openOffers[0] ?? null

  const theme = useBoardTheme()
  const { isDark } = useTheme()

  /*
   * Картинки греем заранее: ближний круг — то, что вот-вот выпадет, дальше в
   * простое дотягиваем остальное. Иначе иллюстрация карточки проявляется уже
   * после того, как человек её прочитал.
   */
  useEffect(() => {
    warmNow([theme.bg, theme.board])
    warmRestWhenIdle()
  }, [theme])

  // Пока стол открыт, страница целиком не прокручивается — только её колонки.
  /*
   * Партия закончилась — разбор открывается сам. Ради него игра и затевалась:
   * человек должен уйти с выводом, а не со счётом.
   */
  useEffect(() => {
    if (table.phase === 'finished') setDebriefOpen(true)
  }, [table.phase])

  useEffect(() => {
    document.documentElement.classList.add('table-open')
    return () => document.documentElement.classList.remove('table-open')
  }, [])

  /*
   * 🔴 «Белая полоска сверху» — это НЕ элемент страницы, а панель браузера:
   * Safari красит её в meta theme-color, а там стоял почти белый цвет главной.
   * За столом фон другой, и полоса читалась как чужая деталь интерфейса.
   * Пока идёт партия, держим theme-color равным краю сцены.
   */
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const before = meta.getAttribute('content')
    meta.setAttribute('content', isDark ? '#20242A' : theme.edge)
    return () => {
      if (before) meta.setAttribute('content', before)
    }
  }, [theme, isDark])

  /*
   * 🔴 Название стоит по центру КАРТЫ, а не колонки. Поле квадратное и в
   * невысоком окне уже своей колонки — центр колонки тогда не совпадает с
   * центром карты, и надпись съезжает вбок. Считать это в CSS нечем: ширину
   * поля задаёт запрос к контейнеру, наружу она не видна. Поэтому меряем
   * само поле и кладём центр в переменную корня.
   */
  const rootRef = useRef<HTMLDivElement>(null)
  /*
   * 🔴 Меряем ВЫСОТУ ШАПКИ и кладём её в переменную. Карточка после этого
   * начинается ПОД кнопками и ровно на столько же становится ниже — раньше
   * она наезжала на них сверху, и до «Портфеля» было не дотянуться.
   *
   * Именно замер, а не постоянная величина: число кнопок меняется по ходу
   * партии («Отменить», «Вернуть», «Созвон» появляются и исчезают), и на
   * узком экране ряд переносится на две-три строки. Любое вшитое число
   * оказалось бы неверным ровно тогда, когда оно важнее всего.
   */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const head = root.querySelector('header')
    if (!head) return
    const put = () => {
      const h = head.getBoundingClientRect()
      root.style.setProperty('--topbar-h', `${Math.ceil(h.bottom)}px`)
    }
    put()
    const ro = new ResizeObserver(put)
    ro.observe(head)
    ro.observe(root)
    window.addEventListener('orientationchange', put)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', put)
    }
  }, [table.phase, theme])
  const diceOptions = diceCountFor(actor)
  const canRoll = table.phase === 'awaitingRoll' && myTurn && !seat.isBot && !rolling && !rolled
  const canEscape =
    table.phase === 'awaitingRoll' && myTurn && seat.track === 'rat' && isOutOfRatRace(seat.ledger) && !seat.isBot

  /*
   * 🔴 Прокрутка запрещена ТОЛЬКО на большом экране.
   *
   * Было `overflow-hidden` без условия — и на всём, что уже 1024 точек
   * (любой телефон, айпэд в портретной ориентации), содержимое просто
   * ОБРЕЗАЛОСЬ: своя панель с деньгами начиналась ниже края окна, а
   * прокрутить туда было нечем. Человек физически не видел, сколько у него
   * денег, и починить это со своей стороны не мог.
   *
   * На большом экране всё по-прежнему помещается целиком и страница стоит
   * на месте — там прокручиваются только сами панели внутри себя.
   */
  return (
    <div
      ref={rootRef}
      className="relative flex h-[100dvh] flex-col overflow-y-auto overscroll-contain bg-[var(--t-edge)] lg:overflow-hidden"
      style={{ ...themeVars(theme, isDark), color: 'var(--t-ink)' }}
    >
      {/* Фон темы — отдельный слой: доска и панели ложатся поверх. */}
      <img
        src={theme.bg}
        alt=""
        aria-hidden
        /*
          🔴 Картинка вылезает на несколько пикселей ВЫШЕ окна, а под ней лежит
          заливка цветом края сцены. Светлая полоска сверху бралась именно из
          этого зазора: где картинка не доставала до края, просвечивал фон
          страницы. Теперь просвечивать нечему.
        */
        className="pointer-events-none absolute -inset-y-2 inset-x-0 w-full object-cover"
        style={{ height: 'calc(100% + 1rem)' }}
      />
      {/* Затемнение сцены в тёмной теме: светлая карта иначе слепит. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[#12151A]"
        style={{ opacity: 'var(--t-scene-dim, 0)' }}
      />

      {/*
        Логотип — в правом нижнем углу окна (решение Камиля 19.08). Место там
        свободно на любом экране и в любой ориентации, поэтому спорить ему не
        с чем. Кликов не ловит и живёт под всеми окнами: это подпись сцены, а
        не элемент управления.
        Отступ считается с учётом «безопасной зоны» — на планшетах и телефонах
        со скруглёнными углами иначе срезался бы край.

        🔴 На телефоне его НЕТ намеренно. Там стол прокручивается, и «всегда
        свободный угол» превращается в надпись поверх чужих строк: логотип
        висел бы прямо на панели с деньгами. Пустой угол — это свойство
        неподвижного стола, то есть планшета и компьютера.
      */}
      <Wordmark
        size="sm"
        edition={false}
        className="pointer-events-none fixed z-10 hidden opacity-45 lg:inline-flex"
        style={{
          right: 'calc(env(safe-area-inset-right, 0px) + 14px)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        }}
      />
      {/*
        🔴 Снизу отступа НЕТ. Боковые колонки должны доходить до самого края
        окна и уходить под него при прокрутке. С py-3 они обрывались на
        двенадцать пикселей выше, и скруглённый край читался как обрезка.
      */}
      <div className="relative flex flex-col px-3 pb-4 pt-0 lg:min-h-0 lg:flex-1 lg:pb-0">
      {/*
        🔴 Ряд кнопок ПЕРЕНОСИТСЯ. На телефоне он требовал 533 px при экране
        375: выбор доски и «Выйти» уезжали за край и были недоступны вовсе.
      */}

      {table.winnerId && table.phase !== 'finished' && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span>
            🏆 <b>{table.seats.find((s) => s.id === table.winnerId)?.name}</b> уже победил — остальные
            доигрывают, как в живой игре.
          </span>
          <button
            onClick={() => dispatch({ type: 'FINISH_GAME' })}
            className="btn-ghost ml-auto text-xs"
          >
            Завершить партию
          </button>
        </div>
      )}

      {/*
        🔴 ПРО ПОДМЕНУ НАПОМИНАЕМ ГРОМКО. Хозяин подхватывает чужой ход на
        минуту, а забыть про это можно на весь круг — и тогда он сходит за
        соседа на СВОЁМ ходу, никого не спросив. Полоса висит поверх всего,
        пока подмена включена, и снимается прямо с неё.
      */}
      {хозяин && ходитЗа && подхватить && (
        <div className="sticky top-0 z-30 -mx-1 mb-2 flex items-center gap-2 rounded-xl border border-amber-500/60 bg-amber-500/15 px-3 py-2 text-[12.5px] leading-snug">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: table.seats.find((s) => s.id === ходитЗа)?.color }}
            aria-hidden
          />
          <span className="min-w-0">
            Вы ходите за{' '}
            <b>{table.seats.find((s) => s.id === ходитЗа)?.name ?? 'игрока'}</b> — все действия
            и деньги на экране его.
          </span>
          <button onClick={() => подхватить(null)} className="btn-quiet ml-auto shrink-0 text-xs">
            Вернуться к себе
          </button>
        </div>
      )}

      {/*
        🔴 Игроки и рынок переехали в ПРАВУЮ колонку (правка Камиля): та стояла
        полупустой, а верхняя строка съедала высоту у доски. Теперь всю партию
        видно сразу и левую панель не надо крутить.
      */}

      {/*
        Стол занимает ровно остаток окна: панель игрока прокручивается ВНУТРИ
        себя, доска подгоняется под свободную высоту. Прокручивать всю страницу
        во время партии неудобно — доска должна быть видна целиком.
      */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[var(--rail)_minmax(0,1fr)]">
        {/*
          🔴 Панель прокручивается ДО САМОГО НИЗА окна, а не обрезается по краю
          сетки: обрубленный список выглядит поломкой. Отступ снизу нулевой,
          последняя строка уходит под нижний край, как в обычной странице.
        */}
        <div className="player-scroll order-2 overflow-x-hidden pb-0 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          <PlayerPanel
            seat={seat}
            dispatch={!seat.isBot ? dispatch : undefined}
            priceNow={(sym) => stockPriceNow(table, sym)}
            flowMul={table.market.flow}
          />
        </div>

        <div className="order-1 flex flex-col lg:order-2 lg:min-h-0">
          {/*
            🔴 Никакой подложки под доской. Задумка была такая: фон темы во весь
            экран, доска лежит НА нём, панели плавают сверху стеклом. Класс
            panel рисовал белый прямоугольник, и получалась «карта внутри
            коробочки» — Камиль это и поймал.
          */}
          {/*
            🔴 Сетка с ФИКСИРОВАННОЙ правой колонкой, а не flex. Раньше её
            ширина зависела от содержимого — приходило событие или менялись
            цифры игроков, колонка дёргалась, а вместе с ней прыгала доска:
            её размер считается от свободного места. Теперь место под колонку
            занято заранее и не двигается.
          */}
          {/*
            🔴 Две колонки — ТОЛЬКО на большом экране. Правило было без
            условия, и на телефоне 320 px честно отдавались панели игроков, а
            полю оставалось 19 px: доски на экране не было вовсе. Узкий экран
            складывает их друг под друга.
          */}
      {/*
      🔴 Логотип ушёл из общей шапки В КОЛОНКУ С ПОЛЕМ (правка Камиля): он
        занимал строку над левой панелью, из-за чего вся панель начиналась
        ниже кнопок и её приходилось крутить сильнее. Теперь он стоит над
        картой, а панели поднялись на уровень кнопок.
      */}
            {/*
              🔴 Название стоит ПО СЕРЕДИНЕ поля (правка Камиля), кнопки — у
              правого края. Раскладка повторяет колонки стола, поэтому центр
              названия совпадает с центром карты, а не с центром всей строки.
              На узком экране колонка одна, и всё честно переносится.
            */}
            {/*
              🔴 Шапка ВЫШЕ подложки карточки (правка Камиля 19.08). Подложка
              ужата по бокам, но сверху идёт от нуля и накрывала ряд кнопок:
              «Портфель» и часть соседних не нажимались, пока карта на столе.
              Поднимаем шапку, а не двигаем подложку вниз: высота шапки
              меняется при переносе кнопок, фиксированный отступ это не
              переживёт.
            */}
            {/*
              🔴 Логотипа в шапке БОЛЬШЕ НЕТ (решение Камиля 19.08). Он стоял
              по центру карты и налезал на ряд кнопок: чем шире экран, тем
              сильнее — на 1366 перекрытие доходило до 245 точек. Любая
              попытка ужиться в одной строке упирается в то, что кнопок много
              и их число меняется по ходу партии.
              Теперь он живёт в правом нижнем углу — там место есть всегда,
              и ни с чем спорить не может.
            */}
            <header className="relative mb-1.5 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 pt-1.5">
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {topRight}
          <button
            onClick={() => setTradesOpen(true)}
            className="topbtn"
            disabled={seat.isBot}
            title="Сделки между игроками"
          >
            🤝<span className="ml-1 hidden sm:max-lg:inline xl:inline">Сделки</span>
            {myDebt > 0 && <span className="ml-1 text-[10px] text-amber-400">●</span>}
          </button>
          {/*
            🔴 Журнал партии. Движок писал его с самого начала — кто что купил,
            кто кому заплатил, что сделал рынок, — а посмотреть было негде:
            строки мелькали всплывающими подсказками и пропадали. За настоящим
            столом спорные моменты разбирают, глядя на записи.
          */}
          {/*
            Разбор партии: смысл игры не в счёте, а в выводе. Доступен и по
            ходу — посмотреть, как идёшь, — и открывается сам, когда партия
            закончилась.
          */}
          <button
            onClick={() => setDebriefOpen(true)}
            className="topbtn"
            title="Разбор: как вы играете и куда усиливаться"
          >
            🧭<span className="ml-1 hidden sm:max-lg:inline xl:inline">Разбор</span>
          </button>
          <button
            onClick={() => setLogOpen(true)}
            className="topbtn"
            title="Журнал партии: что происходило по ходам"
          >
            📜<span className="ml-1 hidden sm:max-lg:inline xl:inline">Журнал</span>
          </button>
          {/* Портфель доступен ВСЕГДА: продать своё можно, не дожидаясь карточки. */}
          <button
            onClick={() => setPortfolioOpen(true)}
            className="topbtn"
            disabled={seat.isBot}
            title="Мой портфель: продать бумаги по цене сегодня"
          >
            🎒<span className="ml-1 hidden sm:max-lg:inline xl:inline">Портфель</span>
          </button>
          <button
            onClick={() => setBankOpen(true)}
            className="topbtn"
            disabled={seat.isBot}
            title={RULES.loansEnabled ? 'Банк' : 'Финансы'}
          >
            {RULES.loansEnabled ? '🏦' : '💼'}
            <span className="ml-1 hidden sm:max-lg:inline xl:inline">{RULES.loansEnabled ? 'Банк' : 'Финансы'}</span>
          </button>
          {/*
            🔴 Отмена — ТОЛЬКО у хозяина стола. Журнал общий: если крутить его
            может каждый, партия разъедется. «Вернуть» стоит рядом и появляется
            лишь когда есть что возвращать — промах по «Отменить» иначе стоил
            бы хода безвозвратно.
          */}
          {canUndo && (
            <button onClick={undo} className="topbtn" title="Откатить последнее событие">
              ↩️<span className="ml-1 hidden sm:max-lg:inline xl:inline">Отменить</span>
            </button>
          )}
          {canUndo && canRedo && (
            <button onClick={redo} className="topbtn" title="Вернуть отменённое">
              ↪️<span className="ml-1 hidden sm:max-lg:inline xl:inline">Вернуть</span>
            </button>
          )}
      {/*
      🔴 «Заново» стирало партию без вопроса. Теперь выход на главную —
            стол остаётся, на главной он ждёт карточкой «Продолжить». Начать
            всё сначала можно оттуда же, кнопкой «Забыть».
      */}
          <button onClick={onExit} className="topbtn" title="На главную. Партия сохранится">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
            <span className="ml-0.5 hidden sm:max-lg:inline xl:inline">Выйти</span>
          </button>
      {/*
            Созвон. Неприметная кнопка (просьба Камиля: «выделять не надо»):
            играют голосом, и опоздавший не должен искать ссылку в переписке.
      */}
          {callUrl && (
            <a
              href={callUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="topbtn"
              title="Открыть созвон в новой вкладке"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0"><rect x="2" y="6" width="13" height="12" rx="2.5" /><path d="m15 11 6-3.5v9L15 13" /></svg>
              <span className="ml-0.5 hidden sm:max-lg:inline xl:inline">Созвон</span>
            </a>
          )}

      {/* Оформление поля — наверх к кнопкам: в правой колонке оно лишнее. */}
      {/* Оформление поля — той же кнопкой, что и соседи: белая коробка
              с обрезанным названием выпадала из ряда. */}
          {BOARD_THEMES.length > 1 && (
            <Dropdown
              value={theme.id}
              onChange={(id) => setBoardTheme(id)}
              options={BOARD_THEMES.map((t2) => ({ value: t2.id, label: t2.name }))}
              buttonClassName="topbtn"
              minListWidth={210}
            />
          )}
        </div>
            </header>
          <div className="relative grid min-h-0 w-full grid-cols-1 gap-3 lg:h-full lg:grid-cols-[minmax(0,1fr)_var(--rail)]">
            <MoneyToast table={table} />
            <TradeToast table={table} />

            {/*
              На узком экране высота свободного места ничего не подсказывает —
              там страница прокручивается. Поэтому на телефоне поле квадратное
              по ШИРИНЕ, а «во весь остаток высоты» включается с большого
              экрана, где стол помещается целиком.
            */}
            <div className="board-slot grid aspect-square min-h-0 w-full flex-1 place-items-center lg:aspect-auto lg:h-full">
              <Board table={table}>
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ color: 'var(--t-muted)' }}
                >
                  Ходит
                </span>
                <span
                  className="font-display text-lg font-bold leading-tight sm:text-xl"
                  style={{ color: actor.color }}
                >
                  {actor.name}
                </span>
                {!seat.isBot && canRoll && (
                  /*
                   * 🔴 Благотворительность даёт ПРАВО ВЫБОРА: один кубик или
                   * два. Кнопка звала roll(diceOptions[0]) — то есть всегда
                   * первый вариант, всегда один кубик. Механика была
                   * оплачена, но недоступна: игрок жертвовал деньги и не
                   * получал ничего.
                   */
                  <div className="mt-1 flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => roll(diceOptions[diceOptions.length - 1])}
                      className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-bold shadow-lg transition hover:scale-[1.03]"
                      style={{ background: 'var(--t-accent)', color: 'var(--t-on-accent)' }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px] shrink-0"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /></svg>
                      {diceOptions.length > 1 ? 'Бросок · 2 кубика' : 'Бросок'}
                    </button>
                    {diceOptions.length > 1 && (
                      <button
                        onClick={() => roll(1)}
                        className="text-[11px] underline decoration-dotted underline-offset-2"
                        style={{ color: 'var(--t-muted)' }}
                        title="Благотворительность позволяет выбрать, сколько кубиков бросать"
                      >
                        бросить один
                      </button>
                    )}
                  </div>
                )}
              </Board>
            </div>

            {/*
              Кнопка и цифры — в правой колонке (правка Камиля). Раньше они
              лежали под доской и съедали высоту, из-за чего доска мельчала.
            */}
            <div className="player-scroll flex flex-col gap-2 overflow-x-hidden pb-4 lg:min-h-0 lg:overflow-y-auto">
              {actor.isBot ? (
                <div className="rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] px-3 py-4 text-center text-[12px] leading-snug text-[var(--t-muted, var(--muted))]">
                  {actor.name} думает…
                </div>
              ) : canEscape ? (
                <button
                  onClick={() => dispatch({ type: 'ENTER_FAST_TRACK' })}
                  className="btn-primary w-full px-3 py-3.5 text-[13px] leading-tight"
                >
                  Вырваться из крысиных бегов
                  <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                    выкуп {money(RULES.fastTrackMultiplier * freedomIncome(seat.ledger))}
                  </span>
                </button>
              ) : canRoll ? (
                /* Кнопка броска живёт ТОЛЬКО по центру доски — там, куда смотрят. */
                null
              ) : rolling ? (
                <div className="dice-rolling grid place-items-center rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] py-5">
                  <Pips n={0} spinning />
                </div>
              ) : rolled ? (
                /* Кубик замер — число видно, и только потом фишка пойдёт. */
                <div className="dice-stop grid place-items-center gap-2 rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] py-4">
                  <div className="flex gap-2">
                    {rolled.map((d, i) => (
                      <Pips key={i} n={d} />
                    ))}
                  </div>
                  <div className="tabnum text-2xl font-black leading-none">
                    {rolled.reduce((a, b) => a + b, 0)}
                  </div>
                </div>
              ) : table.phase === 'turnEnd' ? (
                /*
                 * 🔴 Кнопки «Передать ход» нет. Ход отработан — он уходит сам,
                 * как за настоящим столом: там никто не жмёт кнопку, чтобы
                 * отдать кубик соседу. Пауза нужна только чтобы человек успел
                 * прочитать, что произошло.
                 */
                <div className="grid place-items-center rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] py-4 text-[13px] text-[var(--t-muted, var(--muted))]">
                  Ход переходит дальше…
                </div>
              ) : null}

              {canEscape && (
                <button
                  onClick={() => roll(diceOptions[0])}
                  className="text-[11px] text-[var(--t-muted, var(--muted))] hover:underline"
                >
                  или остаться и бросить
                </button>
              )}

              {/* Что выпало — рядом с кнопкой, а не в центре доски. */}
              <div className="rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] px-3 py-2.5 text-center">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-[var(--t-muted, var(--muted))]">
                  Кубики
                </div>
                <div className="tabnum mt-1 text-xl font-black leading-none">
                  {table.lastRoll
                    ? table.lastRoll.reduce((a, b) => a + b, 0)
                    : <span className="text-[var(--t-muted, var(--muted))]">—</span>}
                </div>
                {table.lastRoll && table.lastRoll.length > 1 && (
                  <div className="mt-0.5 text-[10px] text-[var(--t-muted, var(--muted))]">
                    {table.lastRoll.join(' + ')}
                  </div>
                )}
              </div>

              {/* Сначала игроки, потом события — так стабильнее: игроки не прыгают. */}
              <div className="shrink-0">
                <div className="caps mb-1 px-0.5 text-[9.5px] font-bold text-[var(--t-muted, var(--muted))]">
                  Игроки
                </div>
                <Scoreboard table={table} viewId={peekId ?? seat.id} onView={setPeekId} stacked />
              </div>

              <div>
                <div className="caps mb-1 px-0.5 text-[9.5px] font-bold text-[var(--t-muted, var(--muted))]">
                  Что в мире
                </div>
                <WorldEvents table={table} seat={seat} compact />
              </div>

              {/*
                Голос — рядом с игроками: смотришь, кто ходит, и видишь, кто
                говорит. Партии он не касается: отвалится — стол не заметит.
              */}
              {голосКомната && голосЯ && <ГолосПанель комната={голосКомната} я={голосЯ} />}

              {/* Кто что сделал — здесь, а не поверх стола: карточке не мешает. */}
              <ЛентаКолонка table={table} meId={meId ?? seat.id} />

              {/*
                🔴 ПОДХВАТИТЬ ЧУЖОЙ ХОД — ТОЛЬКО ХОЗЯИНУ СТОЛА.
                Партия на десятерых идёт вживую: кто-то отошёл, у кого-то завис
                телефон, у кого-то отвалилась сеть — и стол стоит, потому что
                ход не перейдёт, пока человек не нажмёт. Раньше выход был один:
                сделать его ботом насовсем. Теперь хозяин ходит за него, пока
                тот не вернётся.
              */}
              {хозяин && подхватить && (
                <div>
                  <div className="caps mb-1 px-0.5 text-[9.5px] font-bold text-[var(--t-muted, var(--muted))]">
                    Походить за игрока
                  </div>
                  <div className="flex flex-col gap-1">
                    {table.seats
                      .filter((s) => !s.isBot && !s.outOfGame && s.id !== моёМесто)
                      .map((s) => {
                        const я = s.id === ходитЗа
                        return (
                          <button
                            key={s.id}
                            onClick={() => подхватить(я ? null : s.id)}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] leading-snug transition ${
                              я
                                ? 'border-amber-500/60 bg-amber-500/15 font-semibold'
                                : 'border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] hover:border-accent/60'
                            }`}
                          >
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: s.color }}
                              aria-hidden
                            />
                            <span className="min-w-0 truncate">{s.name}</span>
                            <span className="ml-auto shrink-0 text-[10.5px] text-[var(--t-muted, var(--muted))]">
                              {я ? 'вернуть' : 'ходить'}
                            </span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Про долг перед людьми говорим вслух: молча погашенная кнопка «купить мечту» — загадка. */}
              {myDebt > 0 && !seat.isBot && (
                <button
                  onClick={() => setTradesOpen(true)}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-left text-[11px] leading-snug"
                >
                  Долг перед игроками{' '}
                  <span className="tabnum font-semibold">{money(myDebt)}</span> — пока не
                  вернёте, мечту купить нельзя. Рассчитаться →
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {/*
        🔴 Карточку видно ВСЕГДА, чей бы ход ни был. Раньше на ходу бота её
        просто не рисовали, если она тебя не касается, — и человек не видел,
        что выпадает соперникам. За настоящим столом карту видят все,
        и половина интереса именно в этом.
        На чужом ходу окно показывается без кнопок: смотреть можно, жать нечего.
      */}
      {/*
        Плашки «кто что сделал». Стоят выше карточки в разметке, но ниже по
        слою и не ловят клики — карточке они не мешают.
      */}
      <Лента table={table} meId={meId ?? seat.id} />

      {table.pending && table.pending.kind !== 'gameOver' && (
        <CardModal
          table={table}
          seat={seat}
          dispatch={dispatch}
          /*
           * 🔴 Карточка принадлежит ТОМУ, КОМУ ВЫПАЛА. Остальные её видят, но
           * нажимать могут, только если владелец открыл вход — им или всем.
           * Раньше правило было «карта касается других, если у кого-то за
           * столом хватает денег»: тогда кнопки оживали у ВСЕХ, и любой
           * посторонний покупал бумаги за чужой счёт.
           */
          /*
           * 🔴 Рыночная карта — исключение: она общая. Обвал бумаг или
           * предложение о покупке касаются КАЖДОГО, у кого есть такой актив,
           * и движок это прямо разрешает. А здесь всех, кроме ходящего,
           * записывали в зрители — кнопки гасли, и человек, которому давали
           * 130% за его дом, не мог ни продать, ни закрыть окно. На месте
           * кнопки оставалось бледное пятно.
           */
          /*
           * 🔴 ЗРИТЕЛЬ — ТОТ, КОГО КАРТОЧКА НЕ ЖДЁТ. Спрашиваем об этом сам
           * движок, а не гадаем по виду карты.
           *
           * Раньше рыночную карту исключали целиком, и на чужом событии
           * партнёрского бизнеса у соседа была ЖИВАЯ кнопка «Понятно». Он
           * жал — карточка не уходила (движок правильно ждёт только хозяина),
           * и это читалось как «оба должны нажать». Ровно на это Камиль и
           * пожаловался в игре: «теперь на все карточки засунул, что нужно
           * ждать других участников».
           *
           * Теперь: ждут тебя — есть кнопки; не ждут — честно написано, что
           * ты смотришь.
           */
          spectate={
            table.pending?.kind === 'deal' || table.pending?.kind === 'market'
              ? !pendingUndecided(table).some((x: Seat) => x.id === seat.id)
              : !myTurn && !allowedIn
          }
          canSetAccess={myTurn && !actor.isBot}
          /*
            🔴 Быстрые кнопки у карточки. Пока она на столе, до шапки надо
            ехать глазами через весь экран, а решение по сделке чаще всего
            требует заглянуть именно в деньги. «Сделки» — только на своём
            ходу: занимать и звать в долю за другого нельзя.
          */
          onOpenTrades={seat.isBot || !myTurn ? undefined : () => setTradesOpen(true)}
          onOpenBank={seat.isBot ? undefined : () => setBankOpen(true)}
          onOpenPortfolio={seat.isBot ? undefined : () => setPortfolioOpen(true)}
        />
      )}
      {/*
        Чужой портфель — отдельным окном и БЕЗ кнопок: посмотреть, как идут
        дела у соседа, можно всегда; трогать его деньги — никогда.
      */}
      {/*
        🔴 СВОЮ карточку тоже открываем. Здесь стояло `peeked.id !== seat.id`:
        по чужому имени окно открывалось, по своему — не происходило ничего, и
        человек жал по себе несколько раз, решив, что сломалось. Своя панель
        есть сбоку, но на телефоне и планшете её надо ещё долистать, а имя в
        списке — вот оно.
      */}
      {peeked && (
        <div
          className="modal-layer fixed inset-0 z-[65] grid place-items-center bg-black/70 p-4"
          onClick={() => setPeekId(null)}
        >
          <div
            className="pop-in panel max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <span style={{ color: peeked.color }}>●</span> {peeked.name}
              </h2>
              <button
                onClick={() => setPeekId(null)}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
              >
                ✕
              </button>
            </div>
            <PlayerPanel
              seat={peeked}
              flowMul={table.market.flow}
              priceNow={(sym) => stockPriceNow(table, sym)}
              /*
               * 🔴 Кнопки — только в СВОЕЙ карточке. Посмотреть, как идут дела
               * у соседа, можно всегда; трогать его деньги — никогда.
               */
              dispatch={peeked.id === seat.id && !seat.isBot ? dispatch : undefined}
            />
          </div>
        </div>
      )}

      {debriefOpen && (
        <DebriefModal
          table={table}
          events={events}
          meId={meId ?? seat.id}
          onClose={() => setDebriefOpen(false)}
        />
      )}

      {logOpen && (
        <div
          className="modal-layer fixed inset-0 z-[66] grid place-items-center bg-black/70 p-4"
          onClick={() => setLogOpen(false)}
        >
          <div
            className="pop-in panel flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Журнал партии</h2>
              <button
                onClick={() => setLogOpen(false)}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
              {table.log.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[var(--muted)]">
                  Пока ничего не произошло.
                </p>
              ) : (
                [...table.log].reverse().map((row, i) => {
                  const who = table.seats.find((x) => x.id === row.seatId)
                  return (
                    <div
                      key={`${row.at}-${i}`}
                      className="flex gap-2 rounded-lg px-2 py-1.5 text-[12.5px] leading-snug odd:bg-[var(--panel-2)]"
                    >
                      {who && (
                        <span className="shrink-0" style={{ color: who.color }}>
                          ●
                        </span>
                      )}
                      <span className="min-w-0 flex-1">{row.text}</span>
                    </div>
                  )
                })
              )}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
              Последние записи сверху. Журнал общий: у всех за столом он одинаковый.
            </p>
          </div>
        </div>
      )}

      {portfolioOpen && !seat.isBot && (
        <PortfolioModal
          table={table}
          seat={seat}
          dispatch={dispatch}
          onClose={() => setPortfolioOpen(false)}
          onOpenTrades={() => {
            setPortfolioOpen(false)
            setTradesOpen(true)
          }}
          onOpenBank={() => {
            setPortfolioOpen(false)
            setBankOpen(true)
          }}
        />
      )}
      {bankOpen && <BankModal seat={seat} dispatch={dispatch} onClose={() => setBankOpen(false)} />}
      {tradesOpen && !seat.isBot && (
        <TradesModal
          table={table}
          seat={seat}
          dispatch={dispatch}
          onClose={() => setTradesOpen(false)}
          onOpenOffer={(id) => setHiddenOffers((h) => h.filter((x) => x !== id))}
        />
      )}
      {inbox && table.phase !== 'finished' && (
        <OfferInbox
          table={table}
          offer={inbox}
          dispatch={dispatch}
          onHide={() => setHiddenOffers((h) => [...h, inbox.id])}
          meId={meId}
        />
      )}
      {table.phase === 'finished' && (
        <WinScreen table={table} onNew={reset} onUndo={undo} onRematch={rematch} />
      )}
      </div>
    </div>
  )
}

