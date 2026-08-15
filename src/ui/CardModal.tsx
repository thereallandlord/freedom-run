import { useState } from 'react'
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
import { monthlyCashFlow, totalExpenses } from '../engine/ledger'
import { FAST_BOARD, cardText, fastSpaceText } from '../engine/data'
import { money, signed, tone } from './PlayerPanel'

function Shell({
  badge,
  title,
  flavor,
  children,
  accent = '#10b981',
}: {
  badge: string
  title: string
  flavor?: string
  children: React.ReactNode
  accent?: string
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4">
      <div className="pop-in panel w-full max-w-md rounded-2xl p-5 shadow-2xl shadow-black/70">
        <div
          className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: `${accent}22`, color: accent }}
        >
          {badge}
        </div>
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        {flavor && <p className="mt-1.5 text-sm italic text-[var(--muted)]">{flavor}</p>}
        <div className="mt-4 space-y-3">{children}</div>
      </div>
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`tabnum ${strong ? 'font-bold' : ''}`}>{value}</span>
    </div>
  )
}

export function CardModal({
  table,
  seat,
  dispatch,
}: {
  table: Table
  seat: Seat
  dispatch: (e: TableEvent) => void
}) {
  const p = table.pending
  const [shares, setShares] = useState(1)
  if (!p) return null
  const l = seat.ledger
  const locale = 'ru' as const

  switch (p.kind) {
    case 'chooseDeal':
      return (
        <Shell badge="Возможность" title="Малая или крупная сделка?">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => dispatch({ type: 'CHOOSE_DEAL', size: 'small' })} className="btn-ghost py-3">
              <div className="text-base">Малая</div>
              <div className="text-[11px] text-[var(--muted)]">взнос до $5 000</div>
            </button>
            <button onClick={() => dispatch({ type: 'CHOOSE_DEAL', size: 'big' })} className="btn-ghost py-3">
              <div className="text-base">Крупная</div>
              <div className="text-[11px] text-[var(--muted)]">от $8 000</div>
            </button>
          </div>
        </Shell>
      )

    case 'deal': {
      const card = p.card
      const txt = cardText(card, locale)
      const badge = p.deck === 'small' ? 'Малая сделка' : 'Крупная сделка'

      if (card.kind === 'stock') {
        const s = card as StockCard
        const max = Math.floor(l.cash / s.price)
        const holders = stockHolders(table, s.symbol)
        return (
          <Shell badge={badge} title={txt.title} flavor={txt.flavor} accent="#38bdf8">
            <div className="panel-2 space-y-1 rounded-lg p-3">
              <Stat label="Тикер" value={s.symbol} />
              <Stat label="Цена сегодня" value={money(s.price)} strong />
              <Stat label="Диапазон" value={`${money(s.range[0])} – ${money(s.range[1])}`} />
              {!!s.dividendPerShare && (
                <Stat label="Дивиденд" value={`${money(s.dividendPerShare)}/шт/мес`} />
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

            <div className="flex gap-2">
              <button
                disabled={max < 1}
                onClick={() => dispatch({ type: 'BUY_STOCK_SHARES', shares: Math.min(shares, max) })}
                className="btn-primary flex-1"
              >
                Купить
              </button>
              <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-ghost">
                Пропустить
              </button>
            </div>

            {holders.length > 0 && (
              <div className="panel-2 rounded-lg p-2">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Продать по этой цене может любой держатель
                </div>
                {holders.map((h) =>
                  h.ledger.stocks
                    .filter((lot) => lot.symbol === s.symbol)
                    .map((lot) => (
                      <button
                        key={lot.id}
                        onClick={() =>
                          dispatch({
                            type: 'SELL_STOCK_LOT',
                            seatId: h.id,
                            lotId: lot.id,
                            shares: lot.shares,
                            pricePerShare: s.price,
                          })
                        }
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--panel)]"
                      >
                        <span>
                          <span style={{ color: h.color }}>●</span> {h.name} · {lot.shares} шт по{' '}
                          {money(lot.costPerShare)}
                        </span>
                        <span className={`tabnum ${tone(s.price - lot.costPerShare)}`}>
                          {money(lot.shares * s.price)}
                        </span>
                      </button>
                    )),
                )}
              </div>
            )}
          </Shell>
        )
      }

      const debt = card.kind === 'realEstate' ? card.mortgage : card.liability
      const affordable = l.cash >= card.downPayment
      return (
        <Shell badge={badge} title={txt.title} flavor={txt.flavor}>
          <div className="panel-2 space-y-1 rounded-lg p-3">
            <Stat label="Стоимость" value={money(card.cost)} />
            <Stat label="Первый взнос" value={money(card.downPayment)} strong />
            <Stat label={card.kind === 'realEstate' ? 'Ипотека' : 'Обязательство'} value={money(debt)} />
            <Stat label="Денежный поток" value={signed(card.cashFlow)} strong />
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>
          <div className="flex gap-2">
            <button disabled={!affordable} onClick={() => dispatch({ type: 'BUY_DEAL' })} className="btn-primary flex-1">
              Купить за {money(card.downPayment)}
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-ghost">
              Пропустить
            </button>
          </div>
          {!affordable && (
            <p className="text-center text-xs text-amber-400">
              Не хватает наличных — возьмите кредит в банке
            </p>
          )}
        </Shell>
      )
    }

    case 'market': {
      const card = p.card
      const txt = cardText(card, locale)

      if (card.kind === 'sellOffer') {
        const matches = marketMatches(table, card.category)
        return (
          <Shell badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8">
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
                    const price = sellOfferPrice(a.cost, card.multiplierPct)
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
                          {money(price - a.debt)} чистыми
                        </span>
                      </button>
                    )
                  }),
                )}
              </div>
            )}
            <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-ghost w-full">
              Дальше
            </button>
          </Shell>
        )
      }

      if (card.kind === 'stockPrice') {
        const holders = stockHolders(table, card.symbol)
        return (
          <Shell badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8">
            <div className="panel-2 rounded-lg p-3">
              <Stat label={card.symbol} value={money(card.price)} strong />
            </div>
            {holders.length === 0 ? (
              <p className="text-center text-sm text-[var(--muted)]">Ни у кого нет этих бумаг.</p>
            ) : (
              <div className="space-y-1">
                {holders.map((h) =>
                  h.ledger.stocks
                    .filter((lot) => lot.symbol === card.symbol)
                    .map((lot) => (
                      <button
                        key={lot.id}
                        onClick={() =>
                          dispatch({
                            type: 'SELL_STOCK_LOT',
                            seatId: h.id,
                            lotId: lot.id,
                            shares: lot.shares,
                            pricePerShare: card.price,
                          })
                        }
                        className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:border-emerald-500/60"
                      >
                        <span>
                          <span style={{ color: h.color }}>●</span> {h.name} · {lot.shares} шт по{' '}
                          {money(lot.costPerShare)}
                        </span>
                        <span className={`tabnum font-semibold ${tone(card.price - lot.costPerShare)}`}>
                          {money(lot.shares * card.price)}
                        </span>
                      </button>
                    )),
                )}
              </div>
            )}
            <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-ghost w-full">
              Дальше
            </button>
          </Shell>
        )
      }

      // Сплит и разовая выплата применились автоматически.
      return (
        <Shell badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8">
          <button onClick={() => dispatch({ type: 'END_TURN' })} className="btn-primary w-full">
            Понятно
          </button>
        </Shell>
      )
    }

    case 'doodad': {
      const card = p.card
      const txt = cardText(card, locale)
      const monthly = Math.ceil(0.03 * card.amount)
      return (
        <Shell badge="Трата" title={txt.title} flavor={txt.flavor} accent="#fb7185">
          <div className="panel-2 rounded-lg p-3">
            <Stat label="К оплате" value={money(card.amount)} strong />
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>
          <div className="flex flex-col gap-2">
            <button
              disabled={l.cash < card.amount}
              onClick={() => dispatch({ type: 'PAY_DOODAD', financed: false })}
              className="btn-primary"
            >
              Заплатить {money(card.amount)}
            </button>
            {card.financeable && (
              <button onClick={() => dispatch({ type: 'PAY_DOODAD', financed: true })} className="btn-ghost">
                На кредитку (+{money(monthly)}/мес навсегда)
              </button>
            )}
            {l.cash < card.amount && !card.financeable && (
              <p className="text-center text-xs text-amber-400">
                Только наличными — возьмите кредит в банке
              </p>
            )}
          </div>
        </Shell>
      )
    }

    case 'charity': {
      const cost = charityCost(l)
      return (
        <Shell badge="Благотворительность" title="Пожертвовать 10% дохода?" accent="#f59e0b">
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
        </Shell>
      )
    }

    case 'downsized': {
      const cost = totalExpenses(l)
      return (
        <Shell badge="Увольнение" title="Вы временно потеряли работу" accent="#64748b">
          <p className="text-sm text-[var(--muted)]">
            Оплатите полный месяц расходов и пропустите 2 хода. Бонус благотворительности сгорает.
          </p>
          <div className="panel-2 rounded-lg p-3">
            <Stat label="К оплате" value={money(cost)} strong />
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>
          <button
            disabled={l.cash < cost}
            onClick={() => dispatch({ type: 'PAY_DOWNSIZED' })}
            className="btn-danger w-full"
          >
            Заплатить {money(cost)} и пропустить 2 хода
          </button>
          {l.cash < cost && (
            <p className="text-center text-xs text-amber-400">Не хватает — возьмите кредит в банке</p>
          )}
        </Shell>
      )
    }

    case 'ftBusiness': {
      const space = FAST_BOARD[p.space]
      if (space.type !== 'business') return null
      const txt = fastSpaceText(p.space, locale)
      return (
        <Shell badge="Инвестиция Полосы" title={txt?.name ?? space.name} flavor={txt?.flavor}>
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
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-ghost">
              Мимо
            </button>
          </div>
        </Shell>
      )
    }

    case 'ftVenture': {
      const space = FAST_BOARD[p.space]
      if (space.type !== 'venture') return null
      const txt = fastSpaceText(p.space, locale)
      return (
        <Shell badge="Рисковый проект" title={txt?.name ?? space.name} flavor={txt?.flavor} accent="#f97316">
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
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-ghost">
              Мимо
            </button>
          </div>
        </Shell>
      )
    }

    case 'ftDream': {
      const space = FAST_BOARD[p.space]
      if (space.type !== 'dream') return null
      const price = dreamPriceAt(table, p.space)
      const bumps = table.dreamBumps[p.space] ?? 0
      const txt = fastSpaceText(p.space, locale)
      return (
        <Shell badge="Ваша мечта" title={txt?.name ?? space.name} flavor={txt?.flavor} accent="#f472b6">
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Базовая цена" value={money(space.price)} />
            {bumps > 0 && <Stat label={`Соперники поднимали ×${bumps}`} value={money(price)} strong />}
            <Stat label="Цена сейчас" value={money(price)} strong />
            <Stat label="Ваши наличные" value={money(l.cash)} />
          </div>
          <div className="flex gap-2">
            <button
              disabled={l.cash < price}
              onClick={() => dispatch({ type: 'BUY_DREAM' })}
              className="btn-primary flex-1"
            >
              🏆 Купить мечту и выиграть
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-ghost">
              Пока нет
            </button>
          </div>
        </Shell>
      )
    }

    case 'ftCharity': {
      const cost = ftCharityCost(l)
      return (
        <Shell badge="Благотворительность" title="Пожертвовать 10% дохода свободы?" accent="#f59e0b">
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
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-ghost">
              Нет
            </button>
          </div>
        </Shell>
      )
    }

    case 'bankruptcy': {
      const flow = monthlyCashFlow(l)
      const recover = canRecover(l)
      return (
        <Shell badge="Банкротство" title={`${seat.name} не свёл концы с концами`} accent="#f43f5e">
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Наличные" value={money(l.cash)} strong />
            <Stat label="Поток в месяц" value={signed(flow)} strong />
          </div>
          <p className="text-sm text-[var(--muted)]">
            {recover
              ? 'Вы снова на плаву — можно вернуться в игру.'
              : 'Продавайте активы банку за полцены, пока поток не станет положительным.'}
          </p>

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
        </Shell>
      )
    }

    default:
      return null
  }
}
