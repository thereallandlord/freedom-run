import { useState } from 'react'
import type { PayableDebt, Seat } from '../engine/types'
import { DEBT_TO_PAYMENT } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { money } from './PlayerPanel'

const DEBT_LABEL: Record<PayableDebt, string> = {
  homeMortgage: 'Ипотека',
  schoolLoans: 'Учебный кредит',
  carLoans: 'Автокредит',
  creditCards: 'Кредитные карты',
  retailDebt: 'Рассрочка',
}

export function BankModal({
  seat,
  dispatch,
  onClose,
}: {
  seat: Seat
  dispatch: (e: TableEvent) => void
  onClose: () => void
}) {
  const l = seat.ledger
  const [loan, setLoan] = useState(1000)
  const [repay, setRepay] = useState(1000)
  const onFast = seat.track === 'fast'

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4" onClick={onClose}>
      <div
        className="pop-in panel max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">🏦 Банк — {seat.name}</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--ink)]">
            ✕
          </button>
        </div>

        <div className="panel-2 mb-4 flex items-baseline justify-between rounded-lg px-3 py-2 text-sm">
          <span className="text-[var(--muted)]">Наличные</span>
          <span className="tabnum text-lg font-bold">{money(l.cash)}</span>
        </div>

        {onFast ? (
          <p className="text-sm text-[var(--muted)]">На Полосе свободы кредитов нет.</p>
        ) : (
          <>
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                Занять — $100/мес за каждую $1 000
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1000}
                  max={100000}
                  step={1000}
                  value={loan}
                  onChange={(e) => setLoan(Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="tabnum w-24 text-right text-sm">{money(loan)}</span>
              </div>
              <button
                onClick={() => dispatch({ type: 'TAKE_LOAN', amount: loan })}
                className="btn-primary mt-2 w-full"
              >
                Взять {money(loan)} · +{money(loan / 10)}/мес
              </button>
            </div>

            {l.liabilities.bankLoan > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                  Погасить кредит — остаток {money(l.liabilities.bankLoan)}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1000}
                    max={Math.max(1000, Math.min(l.liabilities.bankLoan, Math.floor(l.cash / 1000) * 1000))}
                    step={1000}
                    value={repay}
                    onChange={(e) => setRepay(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="tabnum w-24 text-right text-sm">{money(repay)}</span>
                </div>
                <button
                  disabled={l.cash < repay || l.liabilities.bankLoan < repay}
                  onClick={() => dispatch({ type: 'REPAY_LOAN', amount: repay })}
                  className="btn-ghost mt-2 w-full"
                >
                  Погасить {money(repay)}
                </button>
              </div>
            )}
          </>
        )}

        <div>
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
            Закрыть долг целиком — платёж исчезает
          </div>
          <div className="space-y-1.5">
            {(Object.keys(DEBT_LABEL) as PayableDebt[]).map((debt) => {
              const balance = l.liabilities[debt]
              if (balance <= 0) return null
              const payment = l.expenses[DEBT_TO_PAYMENT[debt]]
              return (
                <button
                  key={debt}
                  disabled={l.cash < balance}
                  onClick={() => dispatch({ type: 'PAY_OFF_DEBT', debt })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] disabled:opacity-40"
                >
                  <span>
                    {DEBT_LABEL[debt]}
                    <span className="ml-2 text-[var(--muted)]">−{money(payment)}/мес</span>
                  </span>
                  <span className="tabnum font-semibold">{money(balance)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <button onClick={onClose} className="btn-ghost mt-4 w-full">
          Готово
        </button>
      </div>
    </div>
  )
}
