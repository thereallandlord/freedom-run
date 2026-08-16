import { useEffect, useRef, useState } from 'react'
import type { Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { currentSeat, diceCountFor } from '../engine/table'
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
    <div className="flex flex-wrap gap-1.5">
      {table.seats.map((s, i) => {
        const active = i === table.turnIndex
        const flow = s.track === 'fast' ? fastTrackIncome(s.ledger) : monthlyCashFlow(s.ledger)
        return (
          <button
            key={s.id}
            onClick={() => onView(s.id)}
            className={`panel-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition ${
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

function Log({ table }: { table: Table }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [table.log.length])
  return (
    <div className="panel h-40 overflow-auto rounded-xl p-2.5 text-[12px] leading-relaxed lg:h-[calc(100vh-9.5rem)]">
      {table.log.length === 0 && <div className="text-[var(--muted)]">Партия началась.</div>}
      {table.log.map((e, i) => {
        const seat = table.seats.find((s) => s.id === e.seatId)
        return (
          <div key={i} className="py-[1px]">
            {seat && <span style={{ color: seat.color }}>● </span>}
            <span className={seat ? '' : 'text-[var(--muted)]'}>{e.text}</span>
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

function WinScreen({ table, onNew, onUndo }: { table: Table; onNew: () => void; onUndo: () => void }) {
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

        <div className="mt-5 flex gap-2">
          <button onClick={onNew} className="btn-primary flex-1">
            Новая партия
          </button>
          <button onClick={onUndo} className="btn-ghost">
            Отменить ход
          </button>
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
}: {
  table: Table
  dispatch: (e: TableEvent) => void
  roll: (count: number) => void
  rolling: boolean
  undo: () => void
  reset: () => void
}) {
  const seat = currentSeat(table)
  const [viewId, setViewId] = useState(seat.id)
  const [bankOpen, setBankOpen] = useState(false)
  const viewed = table.seats.find((s) => s.id === viewId) ?? seat

  // Панель следует за активным игроком, пока её не переключили вручную.
  useEffect(() => setViewId(seat.id), [seat.id])

  const diceOptions = diceCountFor(seat)
  const canRoll = table.phase === 'awaitingRoll' && !seat.isBot && !rolling
  const canEscape =
    table.phase === 'awaitingRoll' && seat.track === 'rat' && isOutOfRatRace(seat.ledger) && !seat.isBot

  return (
    <div className="mx-auto max-w-7xl px-3 py-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-black tracking-tight">Freedom Run</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setBankOpen(true)} className="btn-ghost text-xs" disabled={seat.isBot}>
            {RULES.loansEnabled ? '🏦 Банк' : '💼 Финансы'}
          </button>
          <button onClick={undo} className="btn-ghost text-xs" title="Откатить последнее событие">
            ↩️ Отменить
          </button>
          <button onClick={reset} className="btn-ghost text-xs">
            🔄 Заново
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

      <div className="grid items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)_260px]">
        <div className="order-2 max-h-[calc(100vh-9.5rem)] overflow-auto lg:order-1">
          <PlayerPanel seat={viewed} />
        </div>

        <div className="order-1 lg:order-2">
          <div className="panel rounded-2xl p-4">
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

              {canEscape && (
                <button onClick={() => roll(diceOptions[0])} className="text-xs text-[var(--muted)] hover:underline">
                  или остаться и бросить кубик
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="order-3">
          <Log table={table} />
        </div>
      </div>

      {table.pending && table.pending.kind !== 'gameOver' && !seat.isBot && (
        <CardModal table={table} seat={seat} dispatch={dispatch} />
      )}
      {bankOpen && <BankModal seat={seat} dispatch={dispatch} onClose={() => setBankOpen(false)} />}
      {table.phase === 'finished' && <WinScreen table={table} onNew={reset} onUndo={undo} />}
    </div>
  )
}
