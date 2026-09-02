/**
 * Что можно сделать с вытянутой карточкой, кроме «купить» и «пропустить»:
 * перепродать право на находку или позвать соинвестора.
 *
 * Обе кнопки живут прямо в окне карточки — решение принимается там же, где
 * человек смотрит на цифры сделки.
 */
import { useState } from 'react'
import type { Seat, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { PRICE_CEIL, PRICE_FLOOR, fairCardPrice, shareOf } from '../engine/trades'
import { dealTerms } from '../engine/ledger'
import { Dropdown, type Option } from './Dropdown'
import { money, signed } from './PlayerPanel'
import { Corridor, MoneySlider, TradeBlock, TradeLine, payback } from './TradeBits'
import { liveOffers, type TradeCard } from './tradeHelpers'

export function DealTradeActions({
  table,
  seat,
  card,
  dispatch,
}: {
  table: Table
  seat: Seat
  card: TradeCard
  dispatch: (e: TableEvent) => void
}) {
  const others = table.seats.filter(
    (s) => s.id !== seat.id && !s.outOfGame && !s.won && s.track === 'rat',
  )
  const fair = fairCardPrice(card.downPayment)
  /*
   * 🔴 ПОТОК БЕРЁМ ИЗ ДВИЖКА, А НЕ С КАРТОЧКИ. Вход вдвоём движок всегда
   * оформляет В РАССРОЧКУ (ветка coInvest зовёт dealAssetEvent с payCash:false),
   * и платёж по ней уже вычтен из дохода. Окно же считало от `card.cashFlow` —
   * от потока НАЛОМ — и обещало кратно больше, чем приходит: «Дарк-стор в
   * Москве» 114 250 ₽/мес против 37 450 ₽/мес на деле. Расходились 63 карты
   * из 64. Это тот же урок, что уже закреплён в dealTerms: одна функция на
   * движок и на интерфейс.
   */
  const потокВдвоём = dealTerms(card, card.kind === 'realEstate' ? 'realEstate' : 'business').instFlow
  const floor = Math.round(fair * PRICE_FLOOR)
  const ceil = Math.round(fair * PRICE_CEIL)

  const [mode, setMode] = useState<null | 'resell' | 'share'>(null)
  const [buyerId, setBuyerId] = useState('all')
  // Начинаем с четверти взноса: «справедливо = взнос» — это верхняя часть
  // разумного, а торг обычно идёт вокруг доли от него.
  const [price, setPrice] = useState(Math.round(fair * 0.25))
  const [partnerId, setPartnerId] = useState('all')
  const [partnerMoney, setPartnerMoney] = useState(Math.round(card.downPayment / 2))

  const mine = liveOffers(table).filter(
    (o) => o.fromId === seat.id && (o.kind === 'resellCard' || o.kind === 'coInvest'),
  )
  if (!others.length) return null

  const who: Option<string>[] = [
    { value: 'all', label: 'Всем за столом' },
    ...others.map((s) => ({ value: s.id, label: s.name, hint: money(s.ledger.cash) })),
  ]

  if (mine.length) {
    return (
      <TradeBlock accent="good">
        <p className="text-[12px] leading-snug text-[var(--muted)]">
          Предложение уже на столе — ждём ответа игроков.
        </p>
      </TradeBlock>
    )
  }

  // Партнёр вносит свою часть входа; остальное — с инициатора.
  const partnerShare = shareOf(partnerMoney, card.downPayment)
  /*
   * 🔴 ПОТОК СЧИТАЕМ ТОЙ ЖЕ ФУНКЦИЕЙ, ЧТО И ДВИЖОК. Вдвоём объект берётся
   * ТОЛЬКО в рассрочку, значит делить надо доход ЗА ВЫЧЕТОМ платежа, а окно
   * показывало доход как при покупке налом: на 63 картах из 64 обещание
   * расходилось с тем, что приходит на счёт.
   */
  const общийПоток = dealTerms(card, card.kind === 'realEstate' ? 'realEstate' : 'business').instFlow
  const myPart = Math.max(0, card.downPayment - partnerMoney)
  const notEnoughForMyPart = seat.ledger.cash < myPart

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => setMode(mode === 'share' ? null : 'share')}
          className={`btn-ghost w-full ${mode === 'share' ? 'border-emerald-500/60' : ''}`}
        >
          🤝 Позвать в долю
        </button>
        <button
          onClick={() => setMode(mode === 'resell' ? null : 'resell')}
          className={`btn-ghost w-full ${mode === 'resell' ? 'border-emerald-500/60' : ''}`}
        >
          💼 Предложить другому
        </button>
      </div>

      {mode === 'resell' && (
        <TradeBlock title="Продать находку">
          <p className="mb-2 text-[12px] leading-snug text-[var(--muted)]">
            Вы продаёте не саму вещь — её у вас ещё нет, — а <b>право на найденную сделку</b>.
            Это плата за находку, посредничество. Условия карточки не меняются: покупатель войдёт
            в неё на тех же цифрах.
          </p>

          <div className="mb-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Кому
            </div>
            <Dropdown value={buyerId} options={who} onChange={setBuyerId} />
          </div>

          <MoneySlider
            label="Ваша цена за право"
            value={price}
            min={floor}
            max={ceil}
            onChange={setPrice}
            note="справедливо = взнос"
          />
          <div className="mt-2">
            <Corridor asked={price} fair={fair} />
          </div>

          <div className="mt-2 border-t border-[var(--line)] pt-2">
            <TradeLine label="Первый взнос по карточке" value={money(card.downPayment)} />
            <TradeLine label="Покупатель отдаст всего" value={money(card.downPayment + price)} strong />
            <TradeLine
              label="Ему будет приносить"
              value={`${signed(card.cashFlow)}/мес`}
              valueClass="text-emerald-400"
            />
            <TradeLine
              label="Окупится за"
              value={payback(card.downPayment + price, card.cashFlow)}
            />
          </div>

          <button
            onClick={() => {
              dispatch({
                type: 'OFFER_CARD',
                amount: price,
                toId: buyerId === 'all' ? undefined : buyerId,
              })
              setMode(null)
            }}
            className="btn-primary mt-3 w-full"
          >
            Предложить за {money(price)}
          </button>
          {/*
            🔴 Отдать просто так — ОТДЕЛЬНОЙ кнопкой, а не нулём на ползунке.
            Раньше карточку можно было передать только за деньги: нижняя
            граница коридора не пускала. Коридор придуман против «продам другу
            за рубль» — сделки, которая притворяется сделкой; открытый подарок
            ничем не притворяется и виден всем в журнале.
          */}
          {buyerId !== 'all' && (
            <button
              onClick={() => {
                dispatch({ type: 'OFFER_CARD', amount: 0, toId: buyerId })
                setMode(null)
              }}
              className="btn-ghost mt-2 w-full"
            >
              🎁 Отдать даром
            </button>
          )}
          <p className="mt-1.5 text-center text-[11px] text-[var(--muted)]">
            За деньги — от {money(floor)} до {money(ceil)}: так ловится «продам другу за рубль».
            Отдать даром можно всегда.
          </p>
        </TradeBlock>
      )}

      {mode === 'share' && (
        <TradeBlock title="Войти в дело вдвоём">
          <p className="mb-2 text-[12px] leading-snug text-[var(--muted)]">
            Мушарака: каждый вносит свои деньги и получает долю по ним. Доход делится по долям —
            и <b>убыток тоже по ним же</b>. Иначе это уже не партнёрство, а заём под процент.
          </p>

          <div className="mb-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Кого зовём
            </div>
            <Dropdown value={partnerId} options={who} onChange={setPartnerId} />
          </div>

          <MoneySlider
            label="Партнёр вносит"
            value={partnerMoney}
            min={Math.ceil(card.downPayment * 0.1)}
            max={Math.floor(card.downPayment * 0.9)}
            onChange={setPartnerMoney}
            note={`вход в сделку ${money(card.downPayment)}`}
          />

          <div className="mt-2 border-t border-[var(--line)] pt-2">
            <TradeLine
              label="Доли по деньгам"
              value={`вы ${Math.round((1 - partnerShare) * 100)}% · партнёр ${Math.round(partnerShare * 100)}%`}
              strong
            />
            <TradeLine label="Ваш взнос" value={money(myPart)} />
            <TradeLine
              label="Вам в месяц"
              value={`${signed(Math.round(общийПоток * (1 - partnerShare)))}/мес`}
              valueClass="text-emerald-400"
            />
            <TradeLine
              label="Партнёру в месяц"
              value={`${signed(Math.round(общийПоток * partnerShare))}/мес`}
            />
          </div>

          <p className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--muted)]">
            🔒 Убыток делится в тех же долях, и это правило не меняется. Продадите в минус —
            партнёр потеряет свою часть наравне с вами.
          </p>

          {notEnoughForMyPart && (
            <p className="mt-2 text-center text-[12px] text-amber-400">
              На вашу часть не хватает {money(myPart - seat.ledger.cash)} — подвиньте ползунок
              вправо.
            </p>
          )}

          <button
            disabled={notEnoughForMyPart}
            onClick={() => {
              dispatch({
                type: 'OFFER_COINVEST',
                amount: partnerMoney,
                share: partnerShare,
                toId: partnerId === 'all' ? undefined : partnerId,
              })
              setMode(null)
            }}
            className="btn-primary mt-3 w-full"
          >
            Позвать за {money(partnerMoney)} · {Math.round(partnerShare * 100)}%
          </button>
        </TradeBlock>
      )}
    </div>
  )
}
