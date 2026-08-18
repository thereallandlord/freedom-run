/**
 * Мой портфель — всё, чем я владею, и что с этим можно сделать ПРЯМО СЕЙЧАС.
 *
 * 🔴 Зачем отдельное окно. Продать бумагу можно было только в тот момент,
 * когда выпадет рыночная карточка по этой самой бумаге. То есть мировое
 * событие роняет крипту на 60%, ты это видишь — и ничего не можешь сделать,
 * пока игра сама не предложит. Решение о продаже должно быть за человеком:
 * он ждёт своего момента, а не разрешения от колоды.
 *
 * Цена продажи — ТЕКУЩАЯ рыночная, с учётом мировых событий. Та же самая,
 * что считает движок при продаже: одно число в двух местах не разъезжается.
 */
import { useState } from 'react'
import type { Seat, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { stockPriceNow } from '../engine/table'
import { money, signed, tone } from './PlayerPanel'

export function PortfolioModal({
  table,
  seat,
  dispatch,
  onClose,
  onOpenTrades,
  onOpenBank,
}: {
  table: Table
  seat: Seat
  dispatch: (e: TableEvent) => void
  onClose: () => void
  onOpenTrades: () => void
  onOpenBank: () => void
}) {
  const l = seat.ledger
  const empty = !l.stocks.length && !l.realEstate.length && !l.businesses.length

  return (
    <div
      className="modal-layer fixed inset-0 z-[62] grid place-items-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="pop-in panel max-h-[88vh] w-full max-w-md overflow-auto rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Мой портфель</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--ink)]">
            ✕
          </button>
        </div>

        <div className="panel-2 mb-4 flex items-baseline justify-between rounded-lg px-3 py-2 text-sm">
          <span className="text-[var(--muted)]">Наличные</span>
          <span className="tabnum text-lg font-bold">{money(l.cash)}</span>
        </div>

        {empty && (
          <p className="rounded-lg border border-[var(--line)] px-3 py-4 text-center text-[13px] text-[var(--muted)]">
            Пока пусто. Купите первый актив — он появится здесь, и продать его можно будет в любой
            момент, не дожидаясь карточки рынка.
          </p>
        )}

        {l.stocks.length > 0 && (
          <section className="mb-4">
            <div className="caps mb-1.5 text-[10px] font-bold text-[var(--muted)]">
              Бумаги · цена сегодня
            </div>
            <div className="space-y-1.5">
              {l.stocks.map((lot) => (
                <StockRow
                  key={lot.id}
                  lot={lot}
                  price={stockPriceNow(table, lot.symbol)}
                  onSell={(n, price) =>
                    dispatch({
                      type: 'SELL_STOCK_LOT',
                      seatId: seat.id,
                      lotId: lot.id,
                      shares: n,
                      pricePerShare: price,
                    })
                  }
                />
              ))}
            </div>
          </section>
        )}

        {(l.realEstate.length > 0 || l.businesses.length > 0) && (
          <section className="mb-4">
            <div className="caps mb-1.5 text-[10px] font-bold text-[var(--muted)]">
              Объекты и бизнес
            </div>
            <div className="space-y-1.5">
              {[...l.realEstate, ...l.businesses].map((a) => (
                <div
                  key={a.id}
                  className="panel-2 flex items-baseline justify-between gap-2 rounded-lg px-3 py-2 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className={`tabnum shrink-0 ${tone(a.cashFlow)}`}>
                    {signed(a.cashFlow)}/мес
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted)]">
              Продать объект можно другому игроку — через «Сделки». Рыночная карточка на него
              когда-нибудь выпадет и сама, но ждать её не обязательно.
            </p>
          </section>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onOpenTrades} className="btn-ghost w-full">
            🤝 Сделки
          </button>
          <button onClick={onOpenBank} className="btn-ghost w-full">
            💼 Финансы
          </button>
        </div>
      </div>
    </div>
  )
}

/** Строка бумаги: сколько продать и по какой цене сегодня. */
function StockRow({
  lot,
  price,
  onSell,
}: {
  lot: { id: string; symbol: string; shares: number; costPerShare: number }
  price: number
  onSell: (shares: number, price: number) => void
}) {
  const [n, setN] = useState(lot.shares)
  const [armed, setArmed] = useState(false)
  const take = Math.min(n, lot.shares)
  const profit = Math.round((price - lot.costPerShare) * take)

  return (
    <div className="panel-2 rounded-lg px-3 py-2 text-[13px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">
          {lot.symbol} × {lot.shares}
        </span>
        <span className="tabnum text-[var(--muted)]">
          куплено по {money(lot.costPerShare)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="tabnum font-bold">{money(price)} сегодня</span>
        <span className={`tabnum font-semibold ${tone(profit)}`}>{signed(profit)}</span>
      </div>

      {lot.shares > 1 && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={lot.shares}
            value={take}
            onChange={(e) => {
              setN(Number(e.target.value))
              setArmed(false)
            }}
            className="flex-1 accent-emerald-500"
          />
          <span className="tabnum w-16 text-right text-[12px]">{take} шт</span>
        </div>
      )}

      <button
        onClick={() => (armed ? onSell(take, price) : setArmed(true))}
        className={`mt-1.5 w-full rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${
          armed
            ? 'bg-emerald-500 text-[#08150e]'
            : 'border border-[var(--line)] hover:border-emerald-500/60'
        }`}
      >
        {armed
          ? `Точно продать ${take} шт за ${money(take * price)}?`
          : `Продать ${take} шт · ${money(take * price)}`}
      </button>
    </div>
  )
}
