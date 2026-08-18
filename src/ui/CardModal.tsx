import { createContext, useContext, useState } from 'react'
import type { Seat, StockCard, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import {
  charityCost,
  dreamPriceAt,
  ftCharityCost,
  marketMatches,
  sellOfferPrice,
  stockHolders,
  canRecover,
  hasConsumerDebt,
  hasSellableAssets,
} from '../engine/table'
import {
  RULES,
  monthlyCashFlow,
  totalExpenses,
  installmentPrice,
  installmentMonthly,
  marketStockPrice,
  dealTerms,
  marketDealFlow,
} from '../engine/ledger'
import { fastBoard, cardText, fastSpaceText, smallDeals, bigDeals } from '../engine/data'
import { loanOutstanding, fairCardPrice, PRICE_CEIL, PRICE_FLOOR } from '../engine/trades'
import { money, signed, tone } from './PlayerPanel'
import {
  GL_PACKAGES,
  GL_PROMOS,
  glInitialState,
  glStructureIncome,
  glTotalIncome,
} from '../engine/greenleaf'
import { RIBA, ribaLimit } from '../engine/ledger'
import { HalalNote } from './HalalNote'
import { DealTradeActions } from './DealTradeActions'
import { AccessPicker } from './AccessPicker'
import { artByDream, artById, artBySpace, artByTicker } from './cardArt'
import { debtsOf, seatOf } from './tradeHelpers'

/** Картинка карточки: иконка по типу актива поверх фирменного градиента. */
const CARD_ART: Record<string, string> = {
  roomUFA: '🏚️', aptKZN: '🏢', aptMSK: '🌆', aptSPB: '🌉', aptDXB: '🕌', aptTUR: '🏖️',
  parking: '🅿️', land: '🌾', houseRF: '🏡',
  bizFood: '🍽️', bizService: '🔧', bizDigital: '💻', partnership: '🤝',
  condo2br: '🏢', fourplex: '🏘️', eightplex: '🏘️', duplex: '🏘️', aptSmall: '🏢', aptLarge: '🏢',
  franchise: '🍔', localBiz: '🏪', dairyUY: '🐄', villaPDE: '🏝️', landUY: '🌾', aptMVD: '🏢', aptPDE: '🌊',
}

function CardArt({ icon, accent, photo }: { icon: string; accent: string; photo?: string | null }) {
  /*
   * Картинка есть почти у каждой карточки, но не у всех — служебные клетки и
   * новые карты могут быть ещё не нарисованы. Поэтому эмодзи не выкидываем:
   * это честный запасной вариант, а не заглушка «загружается».
   */
  if (photo) {
    return (
      <div
        className="mb-3 overflow-hidden rounded-xl border"
        style={{ borderColor: `${accent}33` }}
      >
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          className="block h-32 w-full object-cover sm:h-36"
        />
      </div>
    )
  }
  return (
    <div
      className="mb-3 grid h-24 place-items-center overflow-hidden rounded-xl border text-5xl"
      style={{
        borderColor: `${accent}44`,
        background: `radial-gradient(120% 140% at 50% 0%, ${accent}33 0%, ${accent}0d 55%, transparent 100%)`,
      }}
    >
      <span className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">{icon}</span>
    </div>
  )
}

function Shell({
  badge,
  title,
  flavor,
  children,
  accent = '#10b981',
  watching,
  art,
  photo,
}: {
  badge: string
  title: string
  flavor?: string
  children: React.ReactNode
  accent?: string
  art?: string
  photo?: string | null
  /** Имя того, чей сейчас ход, если смотрим со стороны. */
  watching?: string | null
}) {
  return (
    <div className="modal-layer fixed inset-0 z-40 grid place-items-center bg-black/70 p-4">
      <div className="card-fly-in panel max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl p-5 shadow-[var(--shadow-pop)]">
        {art && <CardArt icon={art} accent={accent} photo={photo} />}
        <div
          className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: `${accent}22`, color: accent }}
        >
          {badge}
        </div>
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        {flavor && <p className="mt-1.5 text-sm italic text-[var(--muted)]">{flavor}</p>}
        {/*
          На чужом ходу кнопки не просто выключены, а не нажимаются вовсе:
          показываем карту как зрителю. Так за столом видно, что тянет сосед.
        */}
        <div
          className={`mt-4 space-y-3 ${watching ? 'pointer-events-none select-none opacity-70' : ''}`}
        >
          {children}
        </div>
        {watching && (
          <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-center text-[12px] text-[var(--muted)]">
            Ходит {watching} — вы смотрите
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Строка продажи бумаги: сколько продать и подтверждение.
 *
 * 🔴 Раньше нажатие сразу продавало ВЕСЬ лот, без вопроса и без выбора
 * количества. Продать часть было нельзя вовсе, а промах по кнопке стоил
 * позиции целиком. Камиль: «продать сколько? Может, ты только часть хочешь».
 */
function SellLotRow({
  holder,
  lot,
  price,
  onSell,
}: {
  holder: Seat
  lot: { id: string; shares: number; costPerShare: number }
  price: number
  onSell: (shares: number) => void
}) {
  const [n, setN] = useState(lot.shares)
  const [armed, setArmed] = useState(false)
  const take = Math.min(n, lot.shares)
  const profit = (price - lot.costPerShare) * take
  return (
    <div className="panel-2 rounded-lg px-3 py-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span style={{ color: holder.color }}>●</span> {holder.name} · {lot.shares} шт по{' '}
          {money(lot.costPerShare)}
        </span>
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
          <span className="tabnum w-20 text-right text-[12px]">{take} шт</span>
        </div>
      )}
      <button
        onClick={() => (armed ? onSell(take) : setArmed(true))}
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

/** Диапазон взносов колоды — коротко, из настоящих карт. */
function deckHint(cards: { downPayment?: number; price?: number }[]): string {
  const downs = cards
    .map((c) => c.downPayment ?? c.price ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (!downs.length) return ''
  /*
   * Показываем ПОРОГ входа, а не весь размах. Размах у малых сделок идёт от
   * трёхсот рублей за акцию до девяти миллионов за дом — такая «подсказка»
   * не подсказывает ничего.
   */
  return `взнос от ${money(downs[0])}`
}

/**
 * Строка показателя. `big` — для главного числа карточки (обычно доход):
 * оно набирается заметно крупнее остальных, чтобы считываться первым.
 */
function Stat({
  label,
  value,
  strong,
  big,
  good,
}: {
  label: string
  value: string
  strong?: boolean
  big?: boolean
  /** Зелёным — приход, красным — расход. */
  good?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between ${big ? 'text-sm' : 'text-sm'}`}>
      <span className="text-[var(--muted)]">{label}</span>
      <span
        className={`tabnum ${strong || big ? 'font-bold' : ''} ${
          big ? 'text-[19px] leading-tight' : ''
        } ${good === true ? 'text-emerald-600 dark:text-emerald-400' : ''} ${
          good === false ? 'text-rose-600 dark:text-rose-400' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Имя ходящего, когда мы смотрим со стороны. Через контекст, а НЕ через
 * обёртку внутри рендера.
 *
 * 🔴 Здесь была одна из самых злых поломок: `const S = (props) => <Shell/>`
 * объявлялся ВНУТРИ компонента, и React на каждом рендере видел новый тип —
 * то есть сносил всю карточку и собирал заново. Стоило тронуть ползунок, как
 * карточка «открывалась заново» с анимацией, состояние обнулялось и выбрать
 * число было почти невозможно. Компонент, объявленный в рендере, обязан жить
 * снаружи — иначе любое локальное состояние под ним обречено.
 */
const WatchingCtx = createContext<string | null>(null)

function S(props: React.ComponentProps<typeof Shell>) {
  return <Shell {...props} watching={useContext(WatchingCtx)} />
}

export function CardModal(props: {
  table: Table
  seat: Seat
  dispatch: (e: TableEvent) => void
  /** Чужой ход: карту показываем, но решать нечего — кнопок нет. */
  spectate?: boolean
  /** Открыть экран сделок поверх карточки: занять, позвать в долю. */
  onOpenTrades?: () => void
  /** Условия входа назначает ТОЛЬКО владелец находки. */
  canSetAccess?: boolean
}) {
  const actor = props.table.seats[props.table.turnIndex]
  return (
    <WatchingCtx.Provider value={props.spectate ? (actor?.name ?? null) : null}>
      <CardBody {...props} />
    </WatchingCtx.Provider>
  )
}

function CardBody({
  table,
  seat,
  dispatch,
  spectate = false,
  onOpenTrades,
  canSetAccess = false,
}: {
  table: Table
  seat: Seat
  dispatch: (e: TableEvent) => void
  spectate?: boolean
  onOpenTrades?: () => void
  canSetAccess?: boolean
}) {
  /** Соседи по столу — у кого вообще можно занять. */
  const others = table.seats.filter((x) => x.id !== seat.id && !x.outOfGame)
  /** Сколько банк ещё готов дать сверх уже взятого. */
  const ribaFree = Math.max(0, ribaLimit(seat.ledger) - seat.ledger.liabilities.ribaLoan)
  const p = table.pending
  const [shares, setShares] = useState(1)
  if (!p) return null
  const l = seat.ledger
  const actor = table.seats[table.turnIndex]
  const locale = 'ru' as const

  switch (p.kind) {
    case 'chooseDeal':
      return (
        <S badge="Возможность" title="Малая или крупная сделка?">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                /*
                 * 🔴 Пороги считаются ИЗ КОЛОДЫ, а не зашиты. Зашитые
                 * разъехались с данными: обещали «взнос до 150 000», а малые
                 * сделки давно стоят до 9,5 млн. Так подсказка не соврёт снова.
                 */
                ['small', 'Малая', deckHint(smallDeals(table.deckTheme))],
                ['big', 'Крупная', deckHint(bigDeals(table.deckTheme))],
              ] as const
            ).map(([size, name, hint]) => (
              <button
                key={size}
                onClick={() => dispatch({ type: 'CHOOSE_DEAL', size })}
                className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3 text-left transition duration-150 hover:border-accent/60"
              >
                <span className="block text-[15px] font-bold">{name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-[var(--muted)]">{hint}</span>
              </button>
            ))}
          </div>
        </S>
      )

    case 'deal': {
      const card = p.card
      const txt = cardText(card, locale)
      const badge = p.deck === 'small' ? 'Малая сделка' : 'Крупная сделка'

      if (card.kind === 'stock') {
        const raw = card as StockCard
        /*
         * 🔴 Цена с поправкой на рынок — ровно та, по которой купит движок
         * (table.ts зовёт marketStockPrice). Раньше карточка показывала цену
         * с карты, а списывалось другое: игрок жал «купить» и не понимал,
         * почему ушла не та сумма, а при сильном движении рынка кнопка
         * вообще молчала — денег «не хватало» на цену, которой он не видел.
         */
        const s = { ...raw, price: marketStockPrice(raw.price, table.market.stock[raw.symbol]) }
        const max = Math.floor(l.cash / s.price)
        const holders = stockHolders(table, s.symbol)
        return (
          <S
            badge={badge}
            title={txt.title}
            flavor={txt.flavor}
            accent="#38bdf8"
            art="📈"
            photo={artByTicker((card as any).symbol) ?? artById(card.id)}
          >
            <div className="panel-2 space-y-1 rounded-lg p-3">
              <Stat label="Тикер" value={s.symbol} />
              <Stat label="Цена сегодня" value={money(s.price)} strong />
              {(s as any).hideRange ? (
                <Stat label="Диапазон" value="никто не знает 🎲" />
              ) : (
                <Stat label="Диапазон" value={`${money(s.range[0])} – ${money(s.range[1])}`} />
              )}
              {!!s.dividendPerShare && (
                <Stat label="Дивиденд" value={`${signed(s.dividendPerShare)}/шт/мес`} />
              )}
              <Stat label="Ваши наличные" value={money(l.cash)} />
            </div>

            {max > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={max}
                  value={Math.min(shares, max)}
                  onChange={(e) => setShares(Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="tabnum w-24 text-right text-sm">
                  {Math.min(shares, max)} шт · {money(Math.min(shares, max) * s.price)}
                </span>
              </div>
            )}

            {/*
              🔴 Доход считается ПОД ВЫБРАННОЕ КОЛИЧЕСТВО и меняется вместе с
              ползунком. Выше стоит дивиденд за одну бумагу — по нему нельзя
              решать: человек двигает ползунок и должен видеть, сколько будет
              приходить ему, а не умножать в уме.
            */}
            {max > 0 && !!s.dividendPerShare && (
              <div className="flex items-baseline justify-between rounded-lg bg-emerald-500/10 px-3 py-2">
                <span className="text-[13px] text-[var(--muted)]">Будет приходить</span>
                <span className="tabnum text-[19px] font-bold leading-tight text-emerald-600 dark:text-emerald-400">
                  {signed(Math.min(shares, max) * s.dividendPerShare)}
                  <span className="text-[12px] font-semibold"> /мес</span>
                </span>
              </div>
            )}

            {/*
              Доли от того, что по карману. Ползунком целиться в «половину
              денег» неудобно, а решение чаще всего именно в долях: взять
              четверть или зайти на всё.
            */}
            {max > 1 && (
              <div className="grid grid-cols-5 gap-1.5">
                {[10, 25, 50, 75, 100].map((pct) => {
                  const n = Math.max(1, Math.floor((max * pct) / 100))
                  const on = Math.min(shares, max) === n
                  return (
                    <button
                      key={pct}
                      onClick={() => setShares(n)}
                      className={`rounded-lg border px-1 py-1.5 text-[11.5px] font-semibold transition ${
                        on
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--line)] text-[var(--muted)] hover:border-emerald-500/50'
                      }`}
                      title={`${n} шт · ${money(n * s.price)}`}
                    >
                      {pct}%
                    </button>
                  )
                })}
              </div>
            )}

            <div className="flex gap-2">
              <button
                disabled={max < 1}
                onClick={() => dispatch({ type: 'BUY_STOCK_SHARES', shares: Math.min(shares, max) })}
                className="btn-primary flex-1"
              >
                Купить
              </button>
              <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
                Пропустить
              </button>
            </div>

            {/* Кто нашёл — тот и решает, кого пускать и на каких условиях. */}
            {canSetAccess && (
              <div className="hairline mt-3 pt-3">
                <AccessPicker table={table} seat={seat} access={p.access} dispatch={dispatch} />
              </div>
            )}

            {p.access &&
              p.access.mode !== 'closed' &&
              table.seats.filter(
                (x) =>
                  !x.outOfGame &&
                  x.track === 'rat' &&
                  x.id !== seat.id &&
                  x.ledger.cash >= s.price &&
                  (p.access!.mode === 'open' || p.access!.allow.includes(x.id)),
              ).length > 0 && (
              <div className="panel-2 rounded-lg p-2">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {p.access.terms.kind === 'free'
                    ? 'Вход открыт — можно войти по этой цене'
                    : p.access.terms.kind === 'fee'
                      ? `Вход открыт · плата ${money(p.access.terms.amount)}`
                      : `Вход открыт · ${p.access.terms.pct}% с прибыли при продаже`}
                </div>
                {table.seats
                  .filter(
                    (x) =>
                      !x.outOfGame &&
                      x.track === 'rat' &&
                      x.id !== seat.id &&
                      x.ledger.cash >= s.price &&
                      (p.access!.mode === 'open' || p.access!.allow.includes(x.id)),
                  )
                  .map((x) => {
                    const canBuy = Math.floor(x.ledger.cash / s.price)
                    return (
                      <button
                        key={x.id}
                        onClick={() =>
                          dispatch({ type: 'BUY_STOCK_SHARES', shares: canBuy, seatId: x.id })
                        }
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--panel)]"
                      >
                        <span>
                          <span style={{ color: x.color }}>●</span> {x.name} — взять {canBuy} шт
                        </span>
                        <span className="tabnum text-[var(--muted)]">{money(canBuy * s.price)}</span>
                      </button>
                    )
                  })}
              </div>
            )}

            {holders.length > 0 && (
              <div className="panel-2 space-y-1 rounded-lg p-2">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {/* 🔴 Продажа идёт по РЫНОЧНОЙ цене — той же, что списывает движок.
                      Раньше карточка продавала по цене с карты: при обвале держатель
                      сбрасывал бумагу по докризисной цене, то есть делал деньги из воздуха. */}
                  Продать по цене сегодня — {money(s.price)}
                </div>
                {holders.map((h) =>
                  h.ledger.stocks
                    .filter((lot) => lot.symbol === s.symbol)
                    .map((lot) => (
                      <SellLotRow
                        key={lot.id}
                        holder={h}
                        lot={lot}
                        price={s.price}
                        onSell={(n) =>
                          dispatch({
                            type: 'SELL_STOCK_LOT',
                            seatId: h.id,
                            lotId: lot.id,
                            shares: n,
                            pricePerShare: s.price,
                          })
                        }
                      />
                    )),
                )}
              </div>
            )}
          </S>
        )
      }

      const halal = !RULES.loansEnabled
      const growth = (card as any).growthPerPayday as number | undefined
      const kind = card.kind === 'realEstate' ? 'realEstate' : 'business'

      // Две цены: налом дороже на входе, но доход весь твой и долгов нет.
      /*
       * 🔴 Условия берём из ОБЩЕЙ функции движка. Раньше здесь была своя
       * формула, и окно обещало одно, а начислялось другое — Камиль поймал это
       * на машиноместе: карточка показывала 800 ₽, приходило 100.
       */
      const terms = dealTerms(card, kind)
      // Что сейчас творится на рынке для этого класса активов.
      const mktMul = table.market.flow[card.category] ?? 1
      const isGl = !!(card as { greenleaf?: boolean }).greenleaf
      const instTotal = terms.instTotal
      const instDebt = terms.instDebt
      const monthly = terms.instMonthly
      const flowCash = terms.cashFlow

      const canCash = l.cash >= card.cost
      // Рассрочки нет там, где взнос равен цене — не показываем пустой выбор.
      const canInstallment = terms.financeable && l.cash >= card.downPayment
      /* Сколько не хватает до взноса — столько и просим у банка, с округлением. */
      const ribaWant = Math.min(
        ribaFree,
        Math.max(10_000, Math.ceil(Math.max(0, card.downPayment - l.cash) / 10_000) * 10_000),
      )
      // 🔴 И на ПОЛОВИНУ взноса деньги тоже нужны: кнопка была активна при пустом кошельке.
      const investorHalf = Math.round(card.downPayment / 2)
      const investorAvailable =
        halal &&
        !canInstallment &&
        p.deck === 'big' &&
        card.kind === 'realEstate' &&
        card.cashFlow > 0 &&
        l.cash >= investorHalf
      return (
        <S
          badge={card.category === 'partnership' ? 'Партнёрский бизнес' : badge}
          title={txt.title}
          flavor={txt.flavor}
          accent={card.category === 'partnership' ? '#22c55e' : '#10b981'}
          art={CARD_ART[card.category] ?? (card.kind === 'business' ? '🏭' : '🏠')}
          photo={artById(card.id) ?? artByTicker((card as any).symbol)}
        >
          {/*
            🔴 Все числа сделки на виду и подписаны словами, а не терминами.
            Требование Камиля: «сразу должно быть видно, сколько съедает платёж,
            сколько объект приносит и сколько сам стоит — чтобы посчитать за
            секунду». Раньше половина этих чисел пряталась внутри кнопок.
          */}
          <div className="panel-2 space-y-1 rounded-lg p-3">
            {/* У GreenLeaf цена и доход зависят от пакета — они на кнопках ниже. */}
            {!isGl && <Stat label="Стоит целиком" value={money(terms.cashPrice)} strong />}
            {terms.financeable && !isGl && (
              <>
                <Stat label="Первый взнос" value={money(terms.instDown)} />
                <Stat label="Платёж по рассрочке" value={`−${money(terms.instMonthly)}/мес`} />
                <Stat label="Всего с наценкой" value={money(terms.instTotal)} />
              </>
            )}
            {!isGl && <div className="my-1 border-t border-[var(--line)]" />}
            {/* Показываем то, что реально придёт при нынешнем рынке. */}
            {!isGl && <Stat
              label={kind === 'realEstate' ? 'Приносит аренды' : 'Приносит дохода'}
              value={`${signed(marketDealFlow(terms.cashFlow, mktMul))}/мес`}
              big
              good
            />}
            {mktMul !== 1 && (
              <p className="text-[11px] leading-snug text-[var(--muted)]">
                С учётом того, что сейчас на рынке. По карте было{' '}
                {signed(terms.cashFlow)}/мес.
              </p>
            )}
            {terms.financeable && (
              <Stat
                label="Останется в рассрочку"
                value={`${signed(marketDealFlow(terms.cashFlow, mktMul) - terms.instMonthly)}/мес`}
                strong
              />
            )}
            {growth ? (
              <Stat
                label="Рост структуры"
                value={`+${money(growth)}/мес за каждую зарплату, до ${money((card as any).growthCap ?? 0)}`}
              />
            ) : null}
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>

          {/*
            GreenLeaf: одна карта, три цены. Выбор игрока, а не то, что выпало —
            иначе главный урок (когда стоит подниматься) до человека не доходит.
          */}
          {(card as { greenleaf?: boolean }).greenleaf ? (
            <div className="space-y-2">
              {/*
                🔴 Доход на КАЖДОЙ кнопке. Раньше в общей панели стояли цена и
                поток только младшего пакета, и на флагманской карте два числа
                из трёх врали: человек выбирал вслепую и не понимал, за что
                доплачивает. Считаем движковой функцией, а не своей формулой —
                вторая копия расчёта неизбежно разойдётся с первой.
              */}
              {GL_PACKAGES.map((pk) => {
                const start = glStructureIncome(glInitialState(pk.id, 1))
                const base = glStructureIncome(glInitialState('platinum', 1))
                return (
                  <button
                    key={pk.id}
                    disabled={l.cash < pk.price}
                    onClick={() => dispatch({ type: 'BUY_DEAL', glPackage: pk.id })}
                    className="w-full rounded-xl border border-[var(--line)] p-3 text-left transition hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-black">{pk.name}</span>
                      <span className="tabnum text-lg font-black">{money(pk.price)}</span>
                    </div>
                    {/* Приход крупнее цены пакета: решение принимают по нему. */}
                    <div className="tabnum mt-1 text-[17px] font-bold leading-tight text-emerald-600 dark:text-emerald-400">
                      {signed(start)}
                      <span className="text-[12px] font-semibold"> /мес на старте</span>
                      {start > base && (
                        <span className="ml-1 text-[12px] font-normal text-[var(--muted)]">
                          (+{money(start - base)} к Платине)
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{pk.hint}</div>
                  </button>
                )
              })}
              <p className="text-[11px] leading-snug text-[var(--muted)]">
                Поднять пакет можно в любой момент — доплатите разницу. Считать выгодно тогда,
                когда структура уже приносит заметные деньги.
              </p>
            </div>
          ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              disabled={!canCash}
              onClick={() => dispatch({ type: 'BUY_DEAL', payCash: true })}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                canCash ? 'border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/15' : 'border-[var(--line)]'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Налом</div>
              <div className="tabnum mt-0.5 text-lg font-black">{money(card.cost)}</div>
              <div className={`tabnum mt-1 text-[13px] ${tone(flowCash)}`}>{signed(flowCash)}/мес</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">долгов нет, доход весь ваш</div>
            </button>

            {/* 🔴 Кнопки рассрочки нет там, где рассрочки нет: раньше она
                висела с нулями и предлагала «купить за 0». */}
            {terms.financeable && (
            <button
              disabled={!canInstallment}
              onClick={() => dispatch({ type: 'BUY_DEAL' })}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                canInstallment ? 'border-[var(--line)] bg-[var(--panel-2)] hover:border-emerald-500/50' : 'border-[var(--line)]'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                В рассрочку · {money(instTotal)}
              </div>
              <div className="tabnum mt-0.5 text-lg font-black">{money(card.downPayment)}</div>
              <div className={`tabnum mt-1 text-[13px] ${tone(terms.instFlow)}`}>{signed(terms.instFlow)}/мес</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                остаток {money(instDebt)} · платёж {money(monthly)}/мес
              </div>
            </button>
            )}
          </div>
          )}

          {investorAvailable && (
            <button
              onClick={() => dispatch({ type: 'BUY_DEAL', withInvestor: true })}
              className="btn-ghost w-full border-emerald-500/50"
            >
              🤝 Войти в долю с партнёром — пополам взнос, пополам доход и убыток
            </button>
          )}

          {/* Кто нашёл — тот и решает, кого пускать и на каких условиях. */}
          {canSetAccess && (
              <div className="hairline mt-3 pt-3">
                <AccessPicker table={table} seat={seat} access={p.access} dispatch={dispatch} />
              </div>
            )}

          {/*
            🔴 «Предложить свою цену» — обратная сторона «продать находку».
            Раньше цену называл только владелец; теперь и остальные могут
            перебить друг друга, а он выбирает. Механика ставок в движке лежала
            готовая (BID_OFFER), ей просто никто не пользовался.
          */}
          {/* Сделку можно не только купить: право на неё продаётся, а вход делится с партнёром. */}
          <DealTradeActions table={table} seat={seat} card={card} dispatch={dispatch} />

          <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
            Пропустить
          </button>

          {halal && <HalalNote topic={investorAvailable ? 'musharaka' : 'murabaha'} />}

          {!canInstallment && !investorAvailable && (
            /*
             * 🔴 Тупик убран. Раньше здесь просто сообщали «не хватает» — и
             * человек оставался без единого хода, хотя занять у соседей можно
             * было всегда: кнопка «Сделки» скрыта под карточкой, и до неё
             * было не дотянуться. Теперь заём предлагается прямо тут.
             */
            <div className="space-y-2">
              <p className="text-center text-xs text-amber-500 dark:text-amber-400">
                {halal
                  ? 'Не хватает даже на взнос — займите у соседей по столу или дождитесь сделки по карману'
                  : 'Не хватает наличных — займите у соседей или возьмите кредит в банке'}
              </p>
              {/*
                🔴 Оба пути к деньгам стоят ПРЯМО ЗДЕСЬ. Кредит в игре был
                всегда, но жил внутри окна «Сделки» — то есть ровно там, куда
                из карточки не попасть. Камиль его не нашёл и решил, что
                механики нет вовсе. Долг у соседей — без надбавки; кредит —
                сразу и без спроса, но пока он открыт, неприятности приходят
                чаще; это написано на самой кнопке, а не мелким шрифтом.
              */}
              <div className="grid gap-2 sm:grid-cols-2">
                {onOpenTrades && others.length > 0 && (
                  <button onClick={onOpenTrades} className="btn-ghost w-full">
                    🤝 Занять у игроков
                  </button>
                )}
                {ribaFree > 0 && (
                  <button
                    onClick={() => dispatch({ type: 'TAKE_RIBA', amount: ribaWant })}
                    className="btn-ghost w-full border-rose-500/40 hover:border-rose-500/70"
                    title={`Дадут до ${money(ribaFree)}. Первые ${RIBA.gracePaydays} зарплат без платежей, потом ${RIBA.ratePctMonthly}% в месяц`}
                  >
                    🏦 Кредит {money(ribaWant)}
                  </button>
                )}
              </div>
              {ribaFree > 0 && (
                <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
                  Кредит дают сразу: первые {RIBA.gracePaydays} зарплат без платежей, потом{' '}
                  {RIBA.ratePctMonthly}% в месяц от суммы.
                </p>
              )}
            </div>
          )}
        </S>
      )
    }

    case 'market': {
      const card = p.card
      const txt = cardText(card, locale)

      if (card.kind === 'sellOffer') {
        const matches = marketMatches(table, card.category)
        return (
          <S
            badge="Рынок"
            title={txt.title}
            flavor={txt.flavor}
            accent="#38bdf8"
            art="🤝"
            photo={artById(card.id) ?? artBySpace('market')}
          >
            <div className="panel-2 rounded-lg p-3">
              <Stat label="Покупатель даёт" value={`${card.multiplierPct}% от стоимости`} strong />
            </div>
            {matches.length === 0 ? (
              <p className="text-center text-sm text-[var(--muted)]">
                Ни у кого нет подходящих активов.
              </p>
            ) : (
              <div className="space-y-1">
                {matches.map((m) =>
                  m.assets.map((a) => {
                    const price = sellOfferPrice(a.cost, card.multiplierPct, table.market.price[card.category] ?? 1)
                    return (
                      <button
                        key={a.id}
                        onClick={() => dispatch({ type: 'ACCEPT_OFFER', seatId: m.seat.id, assetId: a.id })}
                        className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:border-emerald-500/60"
                      >
                        <span>
                          <span style={{ color: m.seat.color }}>●</span> {m.seat.name} · {a.name}
                        </span>
                        <span className="tabnum font-semibold text-emerald-400">
                          {/* 🔴 Доля партнёра вычитается: без неё окно обещало
                              владельцу вдвое больше, чем придёт на руки. */}
                          {money(
                            Math.round((price - a.debt) * (1 - (a.investorShare ?? 0))),
                          )}{' '}
                          чистыми
                        </span>
                      </button>
                    )
                  }),
                )}
              </div>
            )}
            <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-quiet w-full">
              Дальше
            </button>
          </S>
        )
      }

      if (card.kind === 'glEvent') {
        const biz = seat.ledger.businesses.find((b) => b.gl)
        return (
          <S badge="Партнёрский бизнес" title={txt.title} flavor={txt.flavor} accent="#22c55e">
            {card.promo ? (
              <>
                <div className="panel-2 rounded-lg p-3">
                  <Stat
                    label="Компания выкупает место за"
                    value={money(GL_PROMOS.find((p) => p.id === card.promo)?.amount ?? 0)}
                    strong
                  />
                </div>
                <button
                  disabled={!biz?.gl}
                  onClick={() => dispatch({ type: 'GL_PROMO_TAKE', promo: card.promo! })}
                  className="btn-primary w-full disabled:opacity-40"
                >
                  Взять деньгами
                </button>
                {card.promo === 'travel' && biz?.gl && (
                  <button
                    onClick={() => dispatch({ type: 'GL_PROMO_TAKE', promo: 'travel', go: true })}
                    className="btn-ghost w-full"
                  >
                    Поехать самому
                  </button>
                )}
                {/*
                  🔴 Выход обязателен. Без партнёрского бизнеса кнопки выше
                  ничего не делают (движок возвращает prev), а закрыть карточку
                  было нечем — партия вставала намертво.
                */}
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
                  {biz?.gl ? 'Пропустить' : 'Это не про вас — дальше'}
                </button>
              </>
            ) : card.triangle ? (
              <>
                <div className="panel-2 rounded-lg p-3">
                  <Stat label="Стоит" value={money(card.triangleCost ?? 0)} strong />
                  <Stat label="Доход по структуре вырастет на" value="30%" />
                </div>
                <button
                  disabled={!biz || seat.ledger.cash < (card.triangleCost ?? 0)}
                  onClick={() => dispatch({ type: 'GL_BUY_TRIANGLE', cost: card.triangleCost ?? 0 })}
                  className="btn-primary w-full disabled:opacity-40"
                >
                  Открыть ещё два кабинета
                </button>
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
                  Не сейчас
                </button>
              </>
            ) : (
              <>
                <div className="panel-2 space-y-1 rounded-lg p-3 text-[13px]">
                  {card.boostPct ? <Stat label="Доход структуры" value={`+${card.boostPct}% сразу`} /> : null}
                  {card.growthPct ? <Stat label="Дальше расти будет" value={`быстрее на ${card.growthPct}%`} /> : null}
                  {card.dipPct ? (
                    <Stat label="Доход просядет" value={`на ${card.dipPct}%, это ${card.dipPaydays ?? 4} зарплат`} />
                  ) : null}
                  {card.freezePaydays ? (
                    <Stat label="Приток новых людей встал" value={`на ${card.freezePaydays} зарплат`} />
                  ) : null}
                  {biz?.gl ? <Stat label="Теперь приносит" value={`${signed(glTotalIncome(biz.gl))}/мес`} big good /> : null}
                </div>
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
                  Понятно
                </button>
              </>
            )}
          </S>
        )
      }

      if (card.kind === 'stockPrice') {
        const holders = stockHolders(table, card.symbol)
        // Цена с поправкой на мировые события — иначе баннер обещает одно, а платят другое.
        const px = marketStockPrice(card.price, table.market.stock[card.symbol])
        return (
          <S badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8">
            <div className="panel-2 rounded-lg p-3">
              <Stat label={card.symbol} value={money(px)} strong />
              {px !== card.price && (
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  С учётом того, что сейчас творится на рынке. По карте было {money(card.price)}.
                </p>
              )}
            </div>
            {holders.length === 0 ? (
              <p className="text-center text-sm text-[var(--muted)]">Ни у кого нет этих бумаг.</p>
            ) : (
              <div className="space-y-1">
                {holders.map((h) =>
                  h.ledger.stocks
                    .filter((lot) => lot.symbol === card.symbol)
                    .map((lot) => (
                      <SellLotRow
                        key={lot.id}
                        holder={h}
                        lot={lot}
                        price={px}
                        onSell={(n) =>
                          dispatch({
                            type: 'SELL_STOCK_LOT',
                            seatId: h.id,
                            lotId: lot.id,
                            shares: n,
                            pricePerShare: px,
                          })
                        }
                      />
                    )),
                )}
              </div>
            )}
            <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-quiet w-full">
              Дальше
            </button>
          </S>
        )
      }

      // Сплит и разовая выплата применились автоматически.
      return (
        <S badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8">
          <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-primary w-full">
            Понятно
          </button>
        </S>
      )
    }

    case 'doodad': {
      const card = p.card
      const txt = cardText(card, locale)
      const monthly = Math.ceil(0.03 * card.amount)
      return (
        <S
          badge="Трата"
          title={txt.title}
          flavor={txt.flavor}
          accent="#fb7185"
          art="🛍️"
          photo={artById(card.id) ?? artBySpace('doodad')}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label={card.want ? 'Стоит' : 'К оплате'} value={money(card.amount)} strong />
            {card.upkeep ? (
              <Stat label="И потом каждый месяц" value={`${money(card.upkeep)} на содержание`} />
            ) : null}
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>
          {/*
            Хотелка — не обязательная трата. Можно пройти мимо, и это правильно.
            Но кто отказывается всё время, тот в какой-то момент выгорает: жить
            тоже надо. Счётчик отказов показываем честно, без нравоучений.
          */}
          {card.want && (l.wantsRefused ?? 0) >= 2 && (
            <p className="text-center text-[12px] text-amber-400">
              Подряд отказов: {l.wantsRefused}. Вы давно ничего себе не позволяли.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {card.want && (
              <button onClick={() => dispatch({ type: 'SKIP_WANT' })} className="btn-ghost w-full">
                Пройти мимо — не сейчас
              </button>
            )}
            <button
              disabled={l.cash < card.amount}
              onClick={() => dispatch({ type: 'PAY_DOODAD', financed: false })}
              className="btn-primary"
            >
              Заплатить {money(card.amount)}
            </button>
            {(card.financeable || (!RULES.loansEnabled && l.cash < card.amount)) && (
              <button onClick={() => dispatch({ type: 'PAY_DOODAD', financed: true })} className="btn-ghost">
                {RULES.loansEnabled
                  ? `На кредитку (+${money(monthly)}/мес навсегда)`
                  : `В рассрочку — ${money(Math.ceil(card.amount / 10))}/мес × 10`}
              </button>
            )}
            {l.cash < card.amount && !card.financeable && RULES.loansEnabled && (
              <p className="text-center text-xs text-amber-400">
                Только наличными — возьмите кредит в банке
              </p>
            )}
          </div>
        </S>
      )
    }

    case 'charity': {
      const cost = charityCost(l)
      return (
        <S
          badge="Благотворительность"
          title="Пожертвовать 10% дохода?"
          accent="#f59e0b"
          art="❤️"
          photo={artBySpace('charity')}
        >
          <p className="text-sm text-[var(--muted)]">
            Отдайте {money(cost)} — и следующие 3 хода сможете бросать два кубика вместо одного.
          </p>
          <div className="flex gap-2">
            <button
              disabled={l.cash < cost}
              onClick={() => dispatch({ type: 'ACCEPT_CHARITY' })}
              className="btn-primary flex-1"
            >
              Пожертвовать {money(cost)}
            </button>
            <button onClick={() => dispatch({ type: 'DECLINE_CHARITY' })} className="btn-ghost">
              Нет
            </button>
          </div>
        </S>
      )
    }

    case 'downsized': {
      const cost = totalExpenses(l)
      return (
        <S
          badge="Увольнение"
          title="Вы временно потеряли работу"
          accent="#64748b"
          art="📉"
          photo={artBySpace('downsized')}
        >
          {/*
            🔴 Кнопка обещала списать сумму, а движок не списывал ни рубля —
            и правильно делал: расходы и так уходят каждую зарплату, отдельное
            списание было бы двойным счётом. Наказание здесь — простой без
            зарплаты при живых счетах. Текст приведён в соответствие.
          */}
          <p className="text-sm text-[var(--muted)]">
            Два месяца без зарплаты, а счета идут своим чередом. Бонус
            благотворительности сгорает.
          </p>
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Расходы за месяц" value={money(cost)} />
            <Stat label="Ваши наличные" value={money(l.cash)} strong />
          </div>
          <button onClick={() => dispatch({ type: 'PAY_DOWNSIZED' })} className="btn-danger w-full">
            Пропустить 2 хода
          </button>

        </S>
      )
    }

    case 'ftBusiness': {
      const space = fastBoard()[p.space]
      if (space.type !== 'business') return null
      const txt = fastSpaceText(p.space, locale)
      return (
        <S
          badge="Инвестиция Полосы"
          title={txt?.name ?? space.name}
          flavor={txt?.flavor}
          art="🏢"
          photo={artById((space as any).id)}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Взнос" value={money(space.downPayment)} strong />
            <Stat label="Добавит дохода" value={`${signed(space.cashFlow)}/мес`} strong />
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>
          <div className="flex gap-2">
            <button
              disabled={l.cash < space.downPayment}
              onClick={() => dispatch({ type: 'BUY_FT_BUSINESS' })}
              className="btn-primary flex-1"
            >
              Инвестировать {money(space.downPayment)}
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Мимо
            </button>
          </div>
        </S>
      )
    }

    case 'ftVenture': {
      const space = fastBoard()[p.space]
      if (space.type !== 'venture') return null
      const txt = fastSpaceText(p.space, locale)
      return (
        <S
          badge="Рисковый проект"
          title={txt?.name ?? space.name}
          flavor={txt?.flavor}
          accent="#f97316"
          art="🛢️"
          photo={artById((space as any).id)}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Ставка (невозвратная)" value={money(space.downPayment)} strong />
            <Stat label="При удаче" value={`${signed(space.cashFlow)}/мес`} strong />
            <Stat label="Нужно выбросить" value={`${space.threshold} или больше`} />
          </div>
          <div className="flex gap-2">
            <button
              disabled={l.cash < space.downPayment}
              onClick={() =>
                dispatch({ type: 'TRY_VENTURE', die: 1 + Math.floor(Math.random() * 6) })
              }
              className="btn-primary flex-1"
            >
              🎲 Рискнуть — {money(space.downPayment)}
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Мимо
            </button>
          </div>
        </S>
      )
    }

    case 'ftDream': {
      const space = fastBoard()[p.space]
      if (space.type !== 'dream') return null
      const price = dreamPriceAt(table, p.space)
      const bumps = table.dreamBumps[p.space] ?? 0
      const txt = fastSpaceText(p.space, locale)
      // 🔒 С долгом перед игроком победа не засчитывается — иначе выигрышной
      // стратегией стало бы «занять у всех и уйти». Говорим это прямо, а не гасим кнопку.
      const owed = loanOutstanding(table.loans, seat.id)
      const creditors = debtsOf(table.loans, seat.id)
        .map((ln) => seatOf(table, ln.lenderId)?.name ?? 'игрок')
        .join(', ')
      return (
        <S
          badge="Ваша мечта"
          title={txt?.name ?? space.name}
          flavor={txt?.flavor}
          accent="#f472b6"
          art="⭐"
          photo={artByDream(space.name)}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Базовая цена" value={money(space.price)} />
            {bumps > 0 && <Stat label={`Соперники поднимали ×${bumps}`} value={money(price)} strong />}
            <Stat label="Цена сейчас" value={money(price)} strong />
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>

          {owed > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] leading-snug">
              <div className="font-bold">🔒 Сначала рассчитайтесь с людьми</div>
              <p className="mt-1 text-[var(--muted)]">
                До победы закрыть {money(owed)} — {creditors}. Долг перед игроком победу не
                пропускает: рассрочка за актив здесь ни при чём, речь о деньгах, которые вас
                выручили.
              </p>
              <button
                disabled={l.cash < owed + price}
                onClick={() => {
                  for (const ln of debtsOf(table.loans, seat.id)) {
                    dispatch({ type: 'REPAY_PLAYER_LOAN', loanId: ln.id, amount: ln.amount - ln.repaid })
                  }
                  dispatch({ type: 'BUY_DREAM' })
                }}
                className="btn-primary mt-2 w-full"
              >
                Погасить {money(owed)} и купить мечту
              </button>
              {l.cash < owed + price && (
                <p className="mt-1.5 text-center text-[12px] text-amber-400">
                  На всё сразу не хватает {money(owed + price - l.cash)}.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={l.cash < price || owed > 0}
              onClick={() => dispatch({ type: 'BUY_DREAM' })}
              className="btn-primary flex-1"
            >
              🏆 Купить мечту и выиграть
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Пока нет
            </button>
          </div>
        </S>
      )
    }

    case 'ftCharity': {
      const cost = ftCharityCost(l)
      return (
        <S
          badge="Благотворительность"
          title="Пожертвовать 10% дохода свободы?"
          accent="#f59e0b"
          art="❤️"
          photo={artBySpace('charity')}
        >
          <p className="text-sm text-[var(--muted)]">
            Отдайте {money(cost)} — и до конца партии будете бросать три кубика.
          </p>
          <div className="flex gap-2">
            <button
              disabled={l.cash < cost}
              onClick={() => dispatch({ type: 'ACCEPT_FT_CHARITY' })}
              className="btn-primary flex-1"
            >
              Пожертвовать {money(cost)}
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Нет
            </button>
          </div>
        </S>
      )
    }

    case 'bankruptcy': {
      const flow = monthlyCashFlow(l)
      const recover = canRecover(l)
      return (
        <S badge="Банкротство" title={`${seat.name} не свёл концы с концами`} accent="#f43f5e" art="🆘">
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Наличные" value={money(l.cash)} strong />
            <Stat label="Поток в месяц" value={signed(flow)} strong />
          </div>
          <p className="text-sm text-[var(--muted)]">
            {recover
              ? 'Вы снова на плаву — можно вернуться в игру.'
              : 'Продавайте активы банку за полцены, пока поток не станет положительным.'}
          </p>

          {/*
            🔴 Самый нужный момент для помощи раньше был единственным, где её не
            предлагали. Теперь развилка та же, что и в жизни: попросить у
            человека — неловко, но чисто; взять в банке — быстро и никто не
            увидит, но потом идёт тяжелее.
          */}
          {!recover && (
            <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
              <p className="text-[12px] font-bold">Можно не распродавать нажитое</p>
              {table.seats
                .filter((x) => x.id !== seat.id && !x.outOfGame && x.ledger.cash > 0)
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() =>
                      dispatch({ type: 'ASK_LOAN', fromId: x.id, amount: Math.max(50_000, -flow * 6) })
                    }
                    className="btn-ghost w-full border-emerald-500/50"
                  >
                    Попросить {money(Math.max(50_000, -flow * 6))} у игрока{' '}
                    <span style={{ color: x.color }}>●</span> {x.name} — без надбавки
                  </button>
                ))}
              <button
                onClick={() => dispatch({ type: 'TAKE_RIBA', amount: Math.max(100_000, -flow * 12) })}
                className="btn-ghost w-full"
              >
                Взять кредит в банке — дают сразу, первые {RIBA.gracePaydays} зарплат без платежей
              </button>

            </div>
          )}

          {!recover && (
            <div className="max-h-52 space-y-1 overflow-auto">
              {l.realEstate.map((a) => (
                <button
                  key={a.id}
                  onClick={() => dispatch({ type: 'BANKRUPTCY_SELL', assetKind: 'realEstate', assetId: a.id })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
                >
                  <span>{a.name}</span>
                  <span className="tabnum">{money(Math.floor(a.downPayment / 2))}</span>
                </button>
              ))}
              {l.businesses.map((a) => (
                <button
                  key={a.id}
                  onClick={() => dispatch({ type: 'BANKRUPTCY_SELL', assetKind: 'business', assetId: a.id })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
                >
                  <span>{a.name}</span>
                  <span className="tabnum">{money(Math.floor(a.downPayment / 2))}</span>
                </button>
              ))}
              {l.stocks.map((a) => (
                <button
                  key={a.id}
                  onClick={() => dispatch({ type: 'BANKRUPTCY_SELL', assetKind: 'stock', assetId: a.id })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
                >
                  <span>
                    {a.symbol} × {a.shares}
                  </span>
                  <span className="tabnum">{money(Math.floor((a.shares * a.costPerShare) / 2))}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {recover ? (
              <button onClick={() => dispatch({ type: 'BANKRUPTCY_RECOVER' })} className="btn-primary">
                Выкарабкаться — пропустить 3 хода
              </button>
            ) : (
              <>
                {!hasSellableAssets(l) && hasConsumerDebt(l) && (
                  <button onClick={() => dispatch({ type: 'BANKRUPTCY_HALVE' })} className="btn-ghost">
                    Уполовинить потребительские долги
                  </button>
                )}
                <button onClick={() => dispatch({ type: 'BANKRUPTCY_QUIT' })} className="btn-danger">
                  Сдаться — выйти из игры
                </button>
              </>
            )}
          </div>
        </S>
      )
    }

    default:
      return null
  }
}
