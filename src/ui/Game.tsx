import { useEffect, useRef, useState } from 'react'
import type { Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { currentSeat, diceCountFor, pendingInvolvesOthers } from '../engine/table'
import {
  RULES,
  fastTrackIncome,
  isOutOfRatRace,
  monthlyCashFlow,
  netWorth,
  passiveIncome,
} from '../engine/ledger'
import { Board } from './Board'
import { PlayerPanel, money, signed, tone } from './PlayerPanel'
import { CardModal } from './CardModal'
import { BankModal } from './BankModal'
import { TradesModal } from './TradesModal'
import { OfferInbox } from './OfferInbox'
import { Wordmark } from './Wordmark'
import { liveOffers, offerResponders, playerDebt } from './tradeHelpers'
import type { Offer } from '../engine/trades'
import { WorldEvents } from './WorldEvents'
import { BOARD_THEMES, setBoardTheme, themeVars, useBoardTheme } from './theme-board'
import { Dropdown } from './Dropdown'

function Scoreboard({
  table,
  viewId,
  onView,
}: {
  table: Table
  viewId: string
  onView: (id: string) => void
}) {
  return (
    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      {table.seats.map((s, i) => {
        const active = i === table.turnIndex
        const flow = s.track === 'fast' ? fastTrackIncome(s.ledger) : monthlyCashFlow(s.ledger)
        return (
          <button
            key={s.id}
            onClick={() => onView(s.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] px-2.5 py-1.5 text-xs text-[var(--t-ink)] backdrop-blur-md transition ${
              viewId === s.id ? 'border-emerald-500/70' : ''
            } ${s.outOfGame ? 'opacity-40' : ''}`}
          >
            <span
              className={`size-2.5 rounded-full ${active ? 'ring-2 ring-white/70' : ''}`}
              style={{ background: s.color }}
            />
            <span className="font-semibold">{s.name}</span>
            <span className="tabnum text-[var(--t-muted, var(--muted))]">{money(s.ledger.cash)}</span>
            <span className={`tabnum ${tone(flow)}`}>{signed(flow)}</span>
            {s.won && <span className="text-[10px]">🏆</span>}
            {!s.won && s.track === 'fast' && (
              <span className="text-[10px] text-emerald-400">свобода</span>
            )}
            {s.skipTurns > 0 && <span className="text-[10px] text-amber-400">−{s.skipTurns}</span>}
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
      .find((e) => /Зарплата|выплата|Повышение|вычет|Автопромоушен/i.test(e.text))
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
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4">
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
  undo,
  reset,
  rematch,
  topRight,
}: {
  table: Table
  dispatch: (e: TableEvent) => void
  roll: (count: number) => void
  rolling: boolean
  undo: () => void
  reset: () => void
  rematch: () => void
  topRight?: React.ReactNode
}) {
  const seat = currentSeat(table)
  const [viewId, setViewId] = useState(seat.id)
  const [bankOpen, setBankOpen] = useState(false)
  const [tradesOpen, setTradesOpen] = useState(false)
  /** Предложения, которые отложили кнопкой «Позже» — не лезут снова сами. */
  const [hiddenOffers, setHiddenOffers] = useState<string[]>([])
  const viewed = table.seats.find((s) => s.id === viewId) ?? seat

  // Панель следует за активным игроком, пока её не переключили вручную.
  useEffect(() => setViewId(seat.id), [seat.id])

  const myDebt = playerDebt(table, seat.id)
  // Сначала показываем то, где ответ за человеком; предложения ботам — фоном.
  const openOffers = liveOffers(table).filter((o) => !hiddenOffers.includes(o.id))
  const inbox =
    openOffers.find((o) => offerResponders(table, o).some((s) => !s.isBot)) ?? openOffers[0] ?? null

  const theme = useBoardTheme()
  const diceOptions = diceCountFor(seat)
  const canRoll = table.phase === 'awaitingRoll' && !seat.isBot && !rolling
  const canEscape =
    table.phase === 'awaitingRoll' && seat.track === 'rat' && isOutOfRatRace(seat.ledger) && !seat.isBot

  return (
    <div
      className="relative flex h-[100dvh] flex-col"
      style={{ ...themeVars(theme), color: 'var(--t-ink)' }}
    >
      {/* Фон темы — отдельный слой: доска и панели ложатся поверх. */}
      <img
        src={theme.bg}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full object-cover"
      />
      <div className="relative flex min-h-0 flex-1 flex-col px-3 py-3">
      <header className="mb-2.5 flex shrink-0 items-center gap-2">
        <Wordmark size="sm" />
        <div className="ml-auto flex items-center gap-1.5">
          {topRight}
          <button
            onClick={() => setTradesOpen(true)}
            className="btn-ghost border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] !text-[var(--t-ink)] text-xs backdrop-blur-md"
            disabled={seat.isBot}
            title="Сделки между игроками"
          >
            🤝<span className="ml-1 hidden sm:inline">Сделки</span>
            {myDebt > 0 && <span className="ml-1 text-[10px] text-amber-400">●</span>}
          </button>
          <button
            onClick={() => setBankOpen(true)}
            className="btn-ghost border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] !text-[var(--t-ink)] text-xs backdrop-blur-md"
            disabled={seat.isBot}
            title={RULES.loansEnabled ? 'Банк' : 'Финансы'}
          >
            {RULES.loansEnabled ? '🏦' : '💼'}
            <span className="ml-1 hidden sm:inline">{RULES.loansEnabled ? 'Банк' : 'Финансы'}</span>
          </button>
          <button onClick={undo} className="btn-ghost border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] !text-[var(--t-ink)] text-xs backdrop-blur-md" title="Откатить последнее событие">
            ↩️<span className="ml-1 hidden sm:inline">Отменить</span>
          </button>
          <button onClick={reset} className="btn-ghost border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] !text-[var(--t-ink)] text-xs backdrop-blur-md" title="Начать заново">
            🔄<span className="ml-1 hidden sm:inline">Заново</span>
          </button>
        </div>
      </header>

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

      <div className="mb-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Scoreboard table={table} viewId={viewId} onView={setViewId} />
          </div>
          <WorldEvents table={table} compact />
        </div>
      </div>

      {/*
        Стол занимает ровно остаток окна: панель игрока прокручивается ВНУТРИ
        себя, доска подгоняется под свободную высоту. Прокручивать всю страницу
        во время партии неудобно — доска должна быть видна целиком.
      */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/*
          🔴 Панель прокручивается ДО САМОГО НИЗА окна, а не обрезается по краю
          сетки: обрубленный список выглядит поломкой. Отступ снизу нулевой,
          последняя строка уходит под нижний край, как в обычной странице.
        */}
        <div className="player-scroll order-2 min-h-0 overflow-y-auto overflow-x-hidden pb-6 lg:order-1">
          <PlayerPanel seat={viewed} dispatch={viewed.id === seat.id && !seat.isBot ? dispatch : undefined} />
        </div>

        <div className="order-1 flex min-h-0 lg:order-2">
          {/*
            🔴 Никакой подложки под доской. Задумка была такая: фон темы во весь
            экран, доска лежит НА нём, панели плавают сверху стеклом. Класс
            panel рисовал белый прямоугольник, и получалась «карта внутри
            коробочки» — Камиль это и поймал.
          */}
          <div className="relative flex h-full min-h-0 w-full gap-3">
            <MoneyToast table={table} />
            <TradeToast table={table} />

            <div className="board-slot grid h-full min-h-0 flex-1 place-items-center">
              <Board table={table}>
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ color: 'var(--t-muted)' }}
                >
                  Ходит
                </span>
                <span
                  className="font-display text-lg font-bold leading-tight sm:text-xl"
                  style={{ color: seat.color }}
                >
                  {seat.name}
                </span>
                {!seat.isBot && canRoll && (
                  <button
                    onClick={() => roll(diceOptions[0])}
                    className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-bold shadow-lg transition hover:scale-[1.03]"
                    style={{ background: 'var(--t-accent)', color: 'var(--t-on-accent)' }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px] shrink-0"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /></svg>
                    Бросок
                  </button>
                )}
              </Board>
            </div>

            {/*
              Кнопка и цифры — в правой колонке (правка Камиля). Раньше они
              лежали под доской и съедали высоту, из-за чего доска мельчала.
            */}
            <div className="flex w-[150px] shrink-0 flex-col gap-2 self-center">
              {seat.isBot ? (
                <div className="rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] px-3 py-4 text-center text-[12px] leading-snug text-[var(--t-muted, var(--muted))]">
                  {seat.name} думает…
                </div>
              ) : canEscape ? (
                <button
                  onClick={() => dispatch({ type: 'ENTER_FAST_TRACK' })}
                  className="btn-primary w-full px-3 py-3.5 text-[13px] leading-tight"
                >
                  Выйти из Круга
                  <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                    выкуп {money(100 * passiveIncome(seat.ledger))}
                  </span>
                </button>
              ) : canRoll ? (
                <>
                  {diceOptions.map((n) => (
                    <button
                      key={n}
                      onClick={() => roll(n)}
                      className="btn-primary flex w-full items-center justify-center gap-2 px-3 py-4 text-[15px]"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px] shrink-0"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /></svg>
                      Бросок
                      {diceOptions.length > 1 && (
                        <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                          {n} {n === 1 ? 'кубик' : 'кубика'}
                        </span>
                      )}
                    </button>
                  ))}
                </>
              ) : rolling ? (
                <div className="dice-rolling grid place-items-center rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] py-5 text-3xl">
                  🎲
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

              <div className="rounded-xl border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel-2))] px-3 py-2.5 text-[var(--t-ink)] backdrop-blur-md">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-[var(--t-muted, var(--muted))]">
                  Наличные
                </div>
                <div className="tabnum mt-1 text-[15px] font-bold leading-none">
                  {money(seat.ledger.cash)}
                </div>
              </div>

              {/*
                Поле — оформление, а не правила: меняется прямо в партии.
                🔴 Одной кнопкой со списком: семь строк подряд съедали половину
                колонки, а место справа нужно под игроков и события.
              */}
              <div className="text-[var(--t-ink)]">
                <div className="mb-1 px-0.5 text-[9.5px] font-bold uppercase tracking-[0.09em] text-[var(--t-muted, var(--muted))]">
                  Поле
                </div>
                <Dropdown
                  value={theme.id}
                  onChange={(id) => setBoardTheme(id)}
                  options={BOARD_THEMES.map((t2) => ({ value: t2.id, label: t2.name }))}
                />
              </div>

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
      {table.pending && table.pending.kind !== 'gameOver' && (
        <CardModal
          table={table}
          seat={seat}
          dispatch={dispatch}
          spectate={seat.isBot && !pendingInvolvesOthers(table)}
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
        />
      )}
      {table.phase === 'finished' && (
        <WinScreen table={table} onNew={reset} onUndo={undo} onRematch={rematch} />
      )}
      </div>
    </div>
  )
}
