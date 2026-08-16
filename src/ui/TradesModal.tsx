/**
 * Панель сделок между игроками: продать свой актив, попросить в долг,
 * вернуть или простить заём. Здесь же видно, кому я должен и кто должен мне —
 * долг перед игроком не даёт победить, и об этом надо знать заранее.
 */
import { useState } from 'react'
import type { Seat, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { PRICE_CEIL, PRICE_FLOOR, fairAssetPrice } from '../engine/trades'
import { RULES } from '../engine/ledger'
import { Dropdown, type Option } from './Dropdown'
import { money, signed } from './PlayerPanel'
import { Corridor, MoneySlider, SeatTag, TradeBlock, TradeLine, TradeShell, payback } from './TradeBits'
import {
  assetsOf,
  creditsOf,
  debtsOf,
  liveOffers,
  offerResponders,
  offerTitle,
  playerDebt,
  seatOf,
} from './tradeHelpers'

export function TradesModal({
  table,
  seat,
  dispatch,
  onClose,
  onOpenOffer,
}: {
  table: Table
  seat: Seat
  dispatch: (e: TableEvent) => void
  onClose: () => void
  onOpenOffer: (offerId: string) => void
}) {
  const step = RULES.currency === 'RUB' ? 10_000 : 1000
  const others = table.seats.filter((s) => s.id !== seat.id && !s.outOfGame)
  const buyers = others.filter((s) => !s.won && s.track === 'rat')
  const myAssets = assetsOf(seat)

  const [assetId, setAssetId] = useState(myAssets[0]?.id ?? '')
  const [buyerId, setBuyerId] = useState('all')
  const [rawPrice, setRawPrice] = useState<number | null>(null)
  const [lenderId, setLenderId] = useState(
    [...others].sort((a, b) => b.ledger.cash - a.ledger.cash)[0]?.id ?? '',
  )
  const [loanAmount, setLoanAmount] = useState(step)
  const [repay, setRepay] = useState<Record<string, number>>({})
  const [forgiveArmed, setForgiveArmed] = useState<string | null>(null)

  const debts = debtsOf(table.loans, seat.id)
  const credits = creditsOf(table.loans, seat.id)
  const debtTotal = playerDebt(table, seat.id)
  const offers = liveOffers(table)

  const asset = myAssets.find((a) => a.id === assetId) ?? myAssets[0]
  const fair = asset ? fairAssetPrice(asset.cost, asset.debt) : 0
  const priceMin = fair > 0 ? Math.round(fair * PRICE_FLOOR) : 0
  const priceMax = fair > 0 ? Math.round(fair * PRICE_CEIL) : Math.max(step, asset?.cost ?? step)
  const price = Math.min(Math.max(rawPrice ?? fair, priceMin), priceMax)

  const lender = seatOf(table, lenderId)
  const loanMax = Math.max(step, Math.floor((lender?.ledger.cash ?? step) / step) * step)
  const loanValue = Math.min(loanAmount, loanMax)

  const assetOptions: Option<string>[] = myAssets.map((a) => ({
    value: a.id,
    label: a.name,
    hint: `${signed(a.cashFlow)}/мес`,
  }))
  const buyerOptions: Option<string>[] = [
    { value: 'all', label: 'Всем за столом' },
    ...buyers.map((s) => ({ value: s.id, label: s.name, hint: money(s.ledger.cash) })),
  ]
  const lenderOptions: Option<string>[] = others.map((s) => ({
    value: s.id,
    label: s.name,
    hint: money(s.ledger.cash),
  }))

  return (
    <TradeShell
      title={`Сделки — ${seat.name}`}
      icon="🤝"
      subtitle="Всё, что можно сделать с другими игроками: продать актив, попросить в долг, рассчитаться."
      onClose={onClose}
    >
      <div className="panel-2 flex items-baseline justify-between rounded-lg px-3 py-2 text-sm">
        <span className="text-[var(--muted)]">Наличные</span>
        <span className="tabnum text-lg font-bold">{money(seat.ledger.cash)}</span>
      </div>

      {/* ─── Долги перед игроками ─── */}
      {debtTotal > 0 && (
        <TradeBlock title="Я должен игрокам" accent="warn">
          <p className="mb-2 text-[12px] leading-snug">
            🔒 Пока долг не закрыт, <b>мечту купить нельзя</b> — победа не засчитается. Долг перед
            рассрочкой за актив тут ни при чём, речь только о деньгах, которые выручили люди.
          </p>
          {debts.map((ln) => {
            const to = seatOf(table, ln.lenderId)
            const left = ln.amount - ln.repaid
            const max = Math.min(left, seat.ledger.cash)
            const value = Math.min(repay[ln.id] ?? max, max)
            return (
              <div key={ln.id} className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2.5">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span>{to ? <SeatTag seat={to} /> : 'игроку'}</span>
                  <span className="tabnum font-bold">{money(left)}</span>
                </div>
                {max > 0 ? (
                  <>
                    <input
                      type="range"
                      min={Math.min(step, max)}
                      max={max}
                      step={Math.min(step, max)}
                      value={value}
                      onChange={(e) => setRepay((r) => ({ ...r, [ln.id]: Number(e.target.value) }))}
                      className="mt-2 h-6 w-full accent-emerald-500"
                      aria-label="Сколько вернуть"
                    />
                    <button
                      onClick={() => dispatch({ type: 'REPAY_PLAYER_LOAN', loanId: ln.id, amount: value })}
                      className="btn-primary mt-1 w-full"
                    >
                      Вернуть {money(value)}
                    </button>
                  </>
                ) : (
                  <p className="mt-1 text-[12px] text-amber-400">Наличных нет — вернуть пока нечем.</p>
                )}
              </div>
            )
          })}
        </TradeBlock>
      )}

      {credits.length > 0 && (
        <TradeBlock title="Мне должны">
          {credits.map((ln) => {
            const who = seatOf(table, ln.borrowerId)
            const left = ln.amount - ln.repaid
            const armed = forgiveArmed === ln.id
            return (
              <div key={ln.id} className="mt-1.5 flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">{who ? <SeatTag seat={who} /> : 'игрок'}</span>
                <span className="tabnum ml-auto font-semibold">{money(left)}</span>
                <button
                  onClick={() => {
                    if (armed) {
                      dispatch({ type: 'FORGIVE_LOAN', loanId: ln.id })
                      setForgiveArmed(null)
                    } else {
                      setForgiveArmed(ln.id)
                    }
                  }}
                  className={`btn-ghost shrink-0 px-2 py-1 text-[12px] ${armed ? 'border-amber-500 text-amber-400' : ''}`}
                >
                  {armed ? 'Точно простить?' : 'Простить'}
                </button>
              </div>
            )
          })}
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
            Простить долг можно всегда, вернуть прощённое — уже нет. Требовать сверх суммы нельзя:
            заём здесь без надбавки.
          </p>
        </TradeBlock>
      )}

      {/* ─── Продать свой актив ─── */}
      <TradeBlock title="Продать актив игроку">
        {!asset ? (
          <p className="text-[12px] text-[var(--muted)]">
            Активов пока нет. Купите недвижимость или бизнес — потом сможете перепродать их за
            столом.
          </p>
        ) : buyers.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">Некому продавать — в Круге больше никого нет.</p>
        ) : (
          <>
            <Dropdown value={asset.id} options={assetOptions} onChange={setAssetId} />
            <div className="mt-2">
              <Dropdown value={buyerId} options={buyerOptions} onChange={setBuyerId} />
            </div>

            <div className="mt-3">
              <MoneySlider
                label="Цена"
                value={price}
                min={priceMin}
                max={priceMax}
                onChange={setRawPrice}
                note="справедливо = вложено минус долг"
              />
              <div className="mt-2">
                <Corridor asked={price} fair={fair} />
              </div>
            </div>

            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <TradeLine label="Приносит в месяц" value={`${signed(asset.cashFlow)}/мес`} />
              {asset.debt > 0 && (
                <TradeLine label="Остаток рассрочки уйдёт с активом" value={money(asset.debt)} />
              )}
              <TradeLine label="Вам придёт" value={money(Math.max(0, price - asset.debt))} strong />
              <TradeLine label="Покупателю окупится за" value={payback(price, asset.cashFlow)} />
            </div>

            <button
              onClick={() =>
                dispatch({
                  type: 'OFFER_ASSET',
                  assetId: asset.id,
                  amount: price,
                  toId: buyerId === 'all' ? undefined : buyerId,
                })
              }
              className="btn-primary mt-3 w-full"
            >
              Выставить за {money(price)}
            </button>
          </>
        )}
      </TradeBlock>

      {/* ─── Попросить в долг ─── */}
      <TradeBlock title="Попросить в долг — без надбавки">
        {!lender ? (
          <p className="text-[12px] text-[var(--muted)]">Просить не у кого.</p>
        ) : (
          <>
            <p className="mb-2 text-[12px] leading-snug text-[var(--muted)]">
              Кард хасан: сколько взяли — столько и вернули. Ни процента, ни «спасибо деньгами» —
              такую надбавку стол не даст ввести. Пока долг не закрыт, мечту купить нельзя.
            </p>
            <Dropdown value={lenderId} options={lenderOptions} onChange={setLenderId} />
            <div className="mt-3">
              <MoneySlider
                label="Сумма"
                value={loanValue}
                min={step}
                max={loanMax}
                step={step}
                onChange={setLoanAmount}
                note={`у ${lender.name} ${money(lender.ledger.cash)}`}
              />
            </div>
            <button
              disabled={loanValue > lender.ledger.cash}
              onClick={() => dispatch({ type: 'ASK_LOAN', fromId: lender.id, amount: loanValue })}
              className="btn-primary mt-2 w-full"
            >
              Попросить {money(loanValue)} у {lender.name}
            </button>
          </>
        )}
      </TradeBlock>

      {/* ─── Что сейчас на столе ─── */}
      {offers.length > 0 && (
        <TradeBlock title="Предложения на столе">
          {offers.map((o) => {
            const mineOffer = o.fromId === seat.id && o.kind !== 'loan'
            const canAnswer = offerResponders(table, o).some((s) => !s.isBot)
            return (
              <div key={o.id} className="mt-1.5 flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">
                  {offerTitle(table, o)}
                  <span className="tabnum ml-1 text-[var(--muted)]">{money(o.amount)}</span>
                </span>
                {mineOffer ? (
                  <button
                    onClick={() => dispatch({ type: 'CANCEL_OFFER', offerId: o.id })}
                    className="btn-ghost shrink-0 px-2 py-1 text-[12px]"
                  >
                    Снять
                  </button>
                ) : canAnswer ? (
                  <button
                    onClick={() => {
                      onOpenOffer(o.id)
                      onClose()
                    }}
                    className="btn-ghost shrink-0 px-2 py-1 text-[12px]"
                  >
                    Ответить
                  </button>
                ) : (
                  <span className="chip shrink-0">ждём бота</span>
                )}
              </div>
            )
          })}
        </TradeBlock>
      )}

      <button onClick={onClose} className="btn-ghost w-full">
        Готово
      </button>
    </TradeShell>
  )
}
