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
import { liveOffers, offerResponders, playerDebt } from './tradeHelpers'
import type { Offer } from '../engine/trades'
import { WorldEvents } from './WorldEvents'

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
            className={`panel-2 flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition ${
              viewId === s.id ? 'border-emerald-500/70' : ''
            } ${s.outOfGame ? 'opacity-40' : ''}`}
          >
            <span
              className={`size-2.5 rounded-full ${active ? 'ring-2 ring-white/70' : ''}`}
              style={{ background: s.color }}
            />
            <span className="font-semibold">{s.name}</span>
            <span className="tabnum text-[var(--muted)]">{money(s.ledger.cash)}</span>
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
      className="pop-in pointer-events-none absolute left-1/2 top-3 z-20 max-w-[90%] -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-1.5 text-center text-sm font-semibold shadow-[var(--shadow-pop)]"
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
          <p className="mt-1 text-sm text-[var(--muted)]">
            Цели достигли: {table.seats.filter((s) => s.won).map((s) => s.name).join(', ')}
          </p>
        )}
        {winner?.ledger.winReason === 'dream' && winner.ledger.fastTrack?.dream && (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Купил мечту «{winner.ledger.fastTrack.dream.name}» за{' '}
            {money(winner.ledger.fastTrack.dream.pricePaid)}
          </p>
        )}
        {winner?.ledger.winReason === 'cashflowGoal' && (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Собрал цель по доходу на Полосе свободы
          </p>
        )}

        <div className="mt-5 space-y-1 text-left">
          {standings.map((s, i) => (
            <div key={s.id} className="panel-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="text-[var(--muted)]">{i + 1}.</span>
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
                {s.won && <span className="text-xs text-emerald-400">🏆</span>}
                {s.outOfGame && <span className="text-xs text-rose-400">(банкрот)</span>}
              </span>
              <span className="tabnum text-[var(--muted)]">
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

  const diceOptions = diceCountFor(seat)
  const canRoll = table.phase === 'awaitingRoll' && !seat.isBot && !rolling
  const canEscape =
    table.phase === 'awaitingRoll' && seat.track === 'rat' && isOutOfRatRace(seat.ledger) && !seat.isBot

  return (
    <div className="mx-auto max-w-7xl px-3 py-4">
      <header className="mb-3 flex items-center gap-2">
        <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">Cashflow</h1>
        <div className="ml-auto flex items-center gap-1.5">
          {topRight}
          <button
            onClick={() => setTradesOpen(true)}
            className="btn-ghost text-xs"
            disabled={seat.isBot}
            title="Сделки между игроками"
          >
            🤝<span className="ml-1 hidden sm:inline">Сделки</span>
            {myDebt > 0 && <span className="ml-1 text-[10px] text-amber-400">●</span>}
          </button>
          <button
            onClick={() => setBankOpen(true)}
            className="btn-ghost text-xs"
            disabled={seat.isBot}
            title={RULES.loansEnabled ? 'Банк' : 'Финансы'}
          >
            {RULES.loansEnabled ? '🏦' : '💼'}
            <span className="ml-1 hidden sm:inline">{RULES.loansEnabled ? 'Банк' : 'Финансы'}</span>
          </button>
          <button onClick={undo} className="btn-ghost text-xs" title="Откатить последнее событие">
            ↩️<span className="ml-1 hidden sm:inline">Отменить</span>
          </button>
          <button onClick={reset} className="btn-ghost text-xs" title="Начать заново">
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
        <Scoreboard table={table} viewId={viewId} onView={setViewId} />
      </div>

      <WorldEvents table={table} />

      <div className="grid items-start gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="order-2 max-h-[calc(100vh-9.5rem)] overflow-auto lg:order-1">
          <PlayerPanel seat={viewed} />
        </div>

        <div className="order-1 lg:order-2">
          <div className="panel relative rounded-2xl p-4">
            <MoneyToast table={table} />
            <TradeToast table={table} />
            <Board table={table} />

            <div className="mt-4 flex flex-col items-center gap-2">
              {seat.isBot ? (
                <div className="text-sm text-[var(--muted)]">
                  🤖 {seat.name} думает…
                </div>
              ) : canEscape ? (
                <button
                  onClick={() => dispatch({ type: 'ENTER_FAST_TRACK' })}
                  className="btn-primary px-6 py-3 text-base"
                >
                  🎉 Выйти из Круга — выкуп {money(100 * passiveIncome(seat.ledger))}
                </button>
              ) : canRoll ? (
                <div className="flex gap-2">
                  {diceOptions.map((n) => (
                    <button key={n} onClick={() => roll(n)} className="btn-primary px-6 py-3 text-base">
                      🎲 Бросок {diceOptions.length > 1 ? `— ${n} ${n === 1 ? 'кубик' : 'кубика'}` : ''}
                    </button>
                  ))}
                </div>
              ) : rolling ? (
                <div className="dice-rolling text-3xl">🎲</div>
              ) : table.phase === 'turnEnd' ? (
                <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-primary px-6 py-3 text-base">
                  Передать ход →
                </button>
              ) : null}

              <p className="max-w-sm text-center text-[11px] leading-relaxed text-[var(--muted)]">
                {seat.track === 'rat'
                  ? 'Цель: пассивный доход выше расходов — тогда выходишь из Рутины.'
                  : 'Победа: встать на свою мечту и купить её — или собрать цель по доходу.'}
              </p>

              {canEscape && (
                <button onClick={() => roll(diceOptions[0])} className="text-xs text-[var(--muted)] hover:underline">
                  или остаться и бросить кубик
                </button>
              )}

              {/* Про долг перед людьми говорим вслух: молча погашенная кнопка «купить мечту» — это загадка. */}
              {myDebt > 0 && !seat.isBot && (
                <div className="flex w-full max-w-sm flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-[12px] leading-snug">
                  <span>
                    🔒 Долг перед игроками <span className="tabnum font-semibold">{money(myDebt)}</span> —
                    пока не вернёте, мечту купить нельзя.
                  </span>
                  <button
                    onClick={() => setTradesOpen(true)}
                    className="btn-ghost px-2 py-1 text-[11px]"
                  >
                    Рассчитаться
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {table.pending &&
        table.pending.kind !== 'gameOver' &&
        (!seat.isBot || pendingInvolvesOthers(table)) && (
          <CardModal table={table} seat={seat} dispatch={dispatch} />
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
  )
}
