/**
 * Входящее предложение: что предлагают, за сколько и честная ли это цена.
 * Показывается тому, кто должен ответить, — в хот-сит партии это тот же экран,
 * поэтому имя отвечающего всегда на виду.
 */
import { useState } from 'react'
import type { Seat, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { PRICE_CEIL, PRICE_FLOOR, auctionWinner, type Offer } from '../engine/trades'
import { money, signed } from './PlayerPanel'
import { Corridor, MoneySlider, SeatTag, TradeBlock, TradeLine, TradeShell, payback } from './TradeBits'
import {
  offerBiddable,
  offerBuyerId,
  offerFair,
  offerGain,
  offerNeed,
  offerPrice,
  offerResponders,
  offerTitle,
  openDealCard,
  seatOf,
  findAsset,
} from './tradeHelpers'

export function OfferInbox({
  table,
  offer,
  dispatch,
  onHide,
}: {
  table: Table
  offer: Offer
  dispatch: (e: TableEvent) => void
  onHide: () => void
}) {
  const [bidFor, setBidFor] = useState<string | null>(null)
  const [bid, setBid] = useState(0)
  /** Кто из отвечающих уже сказал «не беру» — предложение при этом живо для остальных. */
  const [declined, setDeclined] = useState<string[]>([])

  const from = seatOf(table, offer.fromId)
  const responders = offerResponders(table, offer)
  const humans = responders.filter((s) => !s.isBot)
  const card = openDealCard(table)
  const asset = findAsset(table, offer.fromId, offer.assetId)
  const fair = offerFair(table, offer)
  const gain = offerGain(table, offer)
  const price = offerPrice(offer)
  const winner = auctionWinner(offer)
  const winnerSeat = seatOf(table, winner?.seatId)
  const turnsLeft = offer.expiresAtTurn - table.turnCounter
  const borrower = seatOf(table, offer.toId)

  if (!from || !responders.length) return null

  // Отвечают одни боты — человеку остаётся подождать; ответ придёт от водителя ботов.
  if (!humans.length) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[62] flex justify-center px-4">
        <div className="pop-in panel flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-[var(--shadow-pop)]">
          <span className="dice-rolling">🤖</span>
          <span>
            {responders.map((s) => s.name).join(', ')} думает над предложением…
          </span>
        </div>
      </div>
    )
  }

  const accept = (responder: Seat) =>
    dispatch({ type: 'ACCEPT_OFFER_TRADE', offerId: offer.id, seatId: offerBuyerId(offer, responder) })
  const cancel = () => dispatch({ type: 'CANCEL_OFFER', offerId: offer.id })

  const title =
    offer.kind === 'loan'
      ? `${borrower?.name ?? 'Игрок'} просит в долг`
      : `${from.name} предлагает`

  const canBid = offerBiddable(offer) && !offer.bids.length

  return (
    <TradeShell
      title={title}
      icon={offer.kind === 'loan' ? '🤲' : '🤝'}
      subtitle={offerTitle(table, offer)}
      layer="z-[62]"
    >
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {/* Слева тот, кто просит: по займу это заёмщик, по остальному — автор. */}
        <span className="chip">
          <SeatTag seat={offer.kind === 'loan' ? (borrower ?? from) : from} />
        </span>
        <span className="text-[var(--muted)]">→</span>
        <span className="chip">
          {responders.length === 1 ? <SeatTag seat={responders[0]} /> : 'всем за столом'}
        </span>
        <span className="chip ml-auto">
          {turnsLeft > 0 ? `живёт ещё ${turnsLeft} ход${turnsLeft > 1 ? 'а' : ''}` : 'последний ход'}
        </span>
      </div>

      {/* ─── Что именно предлагают ─── */}
      {offer.kind === 'resellCard' && (
        <TradeBlock title="Право на найденную сделку">
          <p className="mb-1.5 text-[12px] leading-snug text-[var(--muted)]">
            Покупается право войти в сделку на её же условиях. Посреднику — плата за находку.
          </p>
          <TradeLine label="Первый взнос по карточке" value={money(card?.downPayment ?? 0)} />
          <TradeLine label="Посреднику за находку" value={money(price)} />
          <TradeLine label="Итого наличными" value={money(offerNeed(table, offer, price))} strong />
          <TradeLine label="Будет приносить" value={`${signed(gain)}/мес`} valueClass="text-emerald-400" />
          <TradeLine label="Окупится за" value={payback(offerNeed(table, offer, price), gain)} />
          <div className="mt-2">
            <Corridor asked={price} fair={fair} />
          </div>
        </TradeBlock>
      )}

      {offer.kind === 'coInvest' && (
        <TradeBlock title="Доля в общей сделке">
          <TradeLine label="Ваш вход деньгами" value={money(offer.amount)} strong />
          <TradeLine label="Ваша доля" value={`${Math.round((offer.share ?? 0) * 100)}%`} strong />
          <TradeLine label="Вносит инициатор" value={money(Math.max(0, (card?.downPayment ?? 0) - offer.amount))} />
          <TradeLine label="Вам в месяц" value={`${signed(gain)}/мес`} valueClass="text-emerald-400" />
          <TradeLine label="Окупится за" value={payback(offer.amount, gain)} />
          {/*
            🔴 Объясняем, что месячная сумма — УЖЕ ЧИСТАЯ. Объект берётся в
            рассрочку, платёж по ней вычтен из дохода: отдельной строкой
            расхода он не появится, и без этой подписи кажется, что вошёл
            один раз и больше ничего не платишь.
          */}
          <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
            Это уже чистыми: ваша доля аренды за вычетом вашей доли платежа по рассрочке. Отдельной
            строкой расход не появится — он вычтен здесь.
          </p>
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
            🔒 Прибыль идёт по долям, и убыток тоже по долям — если актив уйдёт в минус, ваша часть
            потери такая же, как доля. Гарантий дохода тут нет и быть не может.
          </p>
        </TradeBlock>
      )}

      {offer.kind === 'sellAsset' && (
        <TradeBlock title="Готовый актив от игрока">
          <TradeLine label="Актив" value={asset?.name ?? '—'} />
          <TradeLine label="Цена" value={money(price)} strong />
          {!!asset?.debt && (
            <TradeLine label="Остаток рассрочки перейдёт к вам" value={money(asset.debt)} />
          )}
          <TradeLine label="Приносит" value={`${signed(gain)}/мес`} valueClass="text-emerald-400" />
          <TradeLine label="Окупится за" value={payback(price, gain)} />
          <div className="mt-2">
            <Corridor asked={price} fair={fair} />
          </div>
        </TradeBlock>
      )}

      {offer.kind === 'loan' && (
        <TradeBlock title="Беспроцентный заём — кард хасан">
          <TradeLine label="Просят" value={money(offer.amount)} strong />
          <TradeLine label="Вернёт ровно" value={money(offer.amount)} strong valueClass="text-emerald-400" />
          <TradeLine label="Ваши наличные" value={money(from.ledger.cash)} />
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
            Ни рубля сверху: надбавку за срок стол не даст ввести. Вернуть больше по своей воле
            заёмщик может, требовать этого нельзя. Пока долг не закрыт, он не сможет купить мечту.
          </p>
        </TradeBlock>
      )}

      {/* ─── Ставки, если начался торг ─── */}
      {!!offer.bids.length && (
        <TradeBlock title="Ставки" accent="warn">
          {[...offer.bids]
            .sort((a, b) => b.amount - a.amount)
            .map((b) => {
              const s = seatOf(table, b.seatId)
              return (
                <div key={b.seatId} className="flex items-center justify-between py-[3px] text-[13px]">
                  <span>{s ? <SeatTag seat={s} /> : b.seatId}</span>
                  <span className="tabnum font-semibold">{money(b.amount)}</span>
                </div>
              )
            })}
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--muted)]">
            Решает {from.name}: сделка уйдёт по лучшей ставке.
          </p>
          <button
            onClick={() => winnerSeat && accept(winnerSeat)}
            className="btn-primary mt-2 w-full"
            disabled={!winnerSeat}
          >
            Продать {winnerSeat?.name} за {money(price)}
          </button>
        </TradeBlock>
      )}

      {/* ─── Ответ ─── */}
      {!offer.bids.length &&
        humans
          .filter((r) => !declined.includes(r.id))
          .map((r) => {
          const need = offerNeed(table, offer, offer.amount)
          // Партнёрство собирается только целиком: если у инициатора не осталось
          // на его часть входа, движок сделку не соберёт — говорим это заранее.
          const initiatorPart =
            offer.kind === 'coInvest' ? Math.max(0, (card?.downPayment ?? 0) - offer.amount) : 0
          const initiatorShort = Math.max(0, initiatorPart - from.ledger.cash)
          const short = Math.max(0, need - r.ledger.cash)
          const blocked = short > 0 || initiatorShort > 0
          const bidCeil = Math.min(
            Math.round(fair * PRICE_CEIL),
            r.ledger.cash - (offer.kind === 'resellCard' ? (card?.downPayment ?? 0) : 0),
          )
          const bidFloor = Math.round(fair * PRICE_FLOOR)
          return (
            <div key={r.id} className="rounded-xl border border-[var(--line)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
                <SeatTag seat={r} />
                <span className="tabnum text-[var(--muted)]">наличные {money(r.ledger.cash)}</span>
              </div>

              {short > 0 ? (
                <p className="mb-2 text-[12px] text-amber-400">
                  Не хватает {money(short)} — принять нельзя.
                </p>
              ) : initiatorShort > 0 ? (
                <p className="mb-2 text-[12px] text-amber-400">
                  У {from.name} не осталось на свою часть входа — не хватает {money(initiatorShort)}.
                  Партнёрство собирается только целиком.
                </p>
              ) : (
                <p className="mb-2 text-[12px] text-[var(--muted)]">
                  Спишется наличными: <span className="tabnum">{money(need)}</span>
                </p>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  disabled={blocked}
                  onClick={() => accept(r)}
                  className="btn-primary w-full sm:col-span-2"
                >
                  {offer.kind === 'loan' ? `Дать ${money(offer.amount)}` : `Принять — ${money(need)}`}
                </button>
                {canBid && bidCeil >= bidFloor && (
                  <button
                    onClick={() => {
                      setBidFor(bidFor === r.id ? null : r.id)
                      setBid(Math.min(bidCeil, Math.max(bidFloor, offer.amount)))
                    }}
                    className="btn-ghost w-full"
                  >
                    Торговаться
                  </button>
                )}
                <button
                  onClick={() =>
                    humans.length === 1 ? cancel() : setDeclined((d) => [...d, r.id])
                  }
                  className={`btn-ghost w-full ${canBid && bidCeil >= bidFloor ? '' : 'sm:col-span-2'}`}
                >
                  {humans.length === 1 ? 'Отказаться' : 'Не беру'}
                </button>
              </div>

              {bidFor === r.id && (
                <div className="mt-3 border-t border-[var(--line)] pt-3">
                  <MoneySlider
                    label="Ваша цена"
                    value={bid}
                    min={bidFloor}
                    max={bidCeil}
                    onChange={setBid}
                    note={`просят ${money(offer.amount)}`}
                  />
                  <div className="mt-2">
                    <Corridor asked={bid} fair={fair} />
                  </div>
                  <button
                    onClick={() => {
                      dispatch({ type: 'BID_OFFER', offerId: offer.id, seatId: r.id, amount: bid })
                      setBidFor(null)
                    }}
                    className="btn-ghost mt-2 w-full border-emerald-500/50"
                  >
                    Предложить {money(bid)}
                  </button>
                  <p className="mt-1.5 text-center text-[11px] text-[var(--muted)]">
                    Ставку увидит продавец — согласится, и сделка пройдёт по ней.
                  </p>
                </div>
              )}
            </div>
          )
        })}

      {humans.every((r) => declined.includes(r.id)) && !offer.bids.length && (
        <p className="text-center text-[12px] text-[var(--muted)]">
          Никто не взял. Такое бывает — цена решает.
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={onHide} className="btn-ghost flex-1">
          Позже
        </button>
        {humans.length > 1 && !offer.bids.length && (
          <button onClick={cancel} className="btn-ghost flex-1">
            Снять предложение
          </button>
        )}
      </div>
    </TradeShell>
  )
}
