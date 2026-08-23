import { useState } from 'react'
import type { PayableDebt, Seat } from '../engine/types'
import { DEBT_TO_PAYMENT } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { RULES } from '../engine/ledger'
import { money } from './PlayerPanel'

/**
 * 🔴 В халяль-режиме процентных кредитов нет вовсе, поэтому и слов «автокредит»
 * с «учебным кредитом» быть не должно: это рассрочки. Названия зависят от
 * режима, а не зашиты намертво.
 */
const DEBT_LABEL_RIBA: Record<PayableDebt, string> = {
  homeMortgage: 'Ипотека',
  schoolLoans: 'Учебный кредит',
  carLoans: 'Автокредит',
  creditCards: 'Кредитные карты',
  retailDebt: 'Рассрочка',
}
const DEBT_LABEL_HALAL: Record<PayableDebt, string> = {
  homeMortgage: 'Рассрочка за жильё',
  schoolLoans: 'Оплата обучения',
  carLoans: 'Рассрочка за машину',
  creditCards: 'Рассрочка за технику',
  retailDebt: 'Рассрочка за покупки',
}
const debtLabel = (d: PayableDebt) => (RULES.loansEnabled ? DEBT_LABEL_RIBA : DEBT_LABEL_HALAL)[d]

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
  const step = RULES.currency === 'RUB' ? 10_000 : 1000
  const [loan, setLoan] = useState(step)
  const [repay, setRepay] = useState(step)
  const [confirmDebt, setConfirmDebt] = useState<PayableDebt | null>(null)
  /** Сколько вносим по выбранному долгу — гасить можно и частями. */
  const [part, setPart] = useState(0)
  const onFast = seat.track === 'fast'
  // Халяль-режим: процентных займов нет, остаётся только досрочное погашение.
  const noLoans = !RULES.loansEnabled

  return (
    <div className="modal-layer fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4" onClick={onClose}>
      <div
        className="pop-in panel max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{noLoans ? '💼 Финансы' : '🏦 Банк'} — {seat.name}</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--ink)]">
            ✕
          </button>
        </div>

        <div className="panel-2 mb-4 flex items-baseline justify-between rounded-lg px-3 py-2 text-sm">
          <span className="text-[var(--muted)]">Наличные</span>
          <span className="tabnum text-lg font-bold">{money(l.cash)}</span>
        </div>

        {onFast || noLoans ? (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {noLoans
              /*
               * 🔴 Раньше здесь стояло «процентных кредитов в этой игре нет»,
               * а в окне «Сделки» кредит выдаётся. Два окна врали друг про
               * друга. Пишем как есть: кредит существует, но он в стороне от
               * халяльного пути и платится не процентом на экране, а тем,
               * 🔴 О влиянии кредита на удачу не пишем: механика скрытая.
               */
              ? 'Здесь кредитов нет: крупное берётся в рассрочку прямо в сделке или с инвестором. Процентный кредит есть в окне «Сделки» — деньги дают сразу.'
              : 'На Полосе свободы кредитов нет.'}
          </p>
        ) : (
          <>
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                Занять — 10% в месяц от суммы
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={step}
                  max={step * 100}
                  step={step}
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
                    min={step}
                    max={Math.max(step, Math.min(l.liabilities.bankLoan, Math.floor(l.cash / step) * step))}
                    step={step}
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
          <div className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
            Гасить долги — платёж падает вместе с остатком
          </div>
          <div className="space-y-1.5">
            {/*
              🔴 Ключи берём у СЛОВАРЯ, а не у функции debtLabel: у функции их
              нет вовсе, и список долгов был пуст ВСЕГДА. Закрыть долг досрочно
              было физически нельзя, хотя кнопка обещала.
            */}
            {(Object.keys(DEBT_LABEL_RIBA) as PayableDebt[]).map((debt) => {
              const balance = l.liabilities[debt]
              if (balance <= 0) return null
              const payment = l.expenses[DEBT_TO_PAYMENT[debt]]
              const open = confirmDebt === debt
              /* Сколько вообще можно внести прямо сейчас — по деньгам и по долгу. */
              const потолок = Math.floor(Math.min(l.cash, balance) / step) * step
              const внесу = Math.max(step, Math.min(part, потолок))
              const остаток = balance - внесу
              const станет = остаток <= 0 ? 0 : Math.round((payment * остаток) / balance)
              return (
                <div key={debt} className={`panel-2 rounded-lg ${open ? 'border-amber-500' : ''}`}>
                  <button
                    onClick={() => {
                      setConfirmDebt(open ? null : debt)
                      setPart(Math.floor(Math.min(l.cash, balance) / step) * step)
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px]"
                  >
                    <span>
                      {debtLabel(debt)}
                      <span className="ml-2 text-[var(--muted)]">−{money(payment)}/мес</span>
                    </span>
                    <span className="tabnum font-semibold">{money(balance)}</span>
                  </button>
                  {open && (
                    <div className="border-t border-[var(--line)] px-3 py-2.5">
                      {потолок < step ? (
                        /*
                         * 🔴 Говорим ПРЯМО, чего не хватает. Раньше кнопка
                         * просто гасла, и это читалось как «долг не гасится»:
                         * человек жал и не понимал, почему ничего не
                         * происходит.
                         */
                        <p className="text-[12px] leading-snug text-[var(--muted)]">
                          Сейчас вносить нечего: на счету {money(l.cash)}, а вносить можно от{' '}
                          {money(step)}.
                        </p>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={step}
                              max={потолок}
                              step={step}
                              value={внесу}
                              onChange={(e) => setPart(Number(e.target.value))}
                              className="flex-1 accent-emerald-500"
                            />
                            <span className="tabnum w-24 text-right text-sm">{money(внесу)}</span>
                          </div>
                          <p className="mt-1 text-[11.5px] leading-snug text-[var(--muted)]">
                            {остаток <= 0 ? (
                              <>Долг закроется целиком — платёж {money(payment)}/мес исчезнет.</>
                            ) : (
                              <>
                                Останется {money(остаток)}, платёж станет −{money(станет)}/мес
                                {потолок < balance && (
                                  <> · на весь долг не хватает {money(balance - l.cash)}</>
                                )}
                              </>
                            )}
                          </p>
                          <button
                            onClick={() => {
                              dispatch({ type: 'PAY_OFF_DEBT', debt, amount: внесу })
                              setConfirmDebt(null)
                            }}
                            className="btn-primary mt-2 w-full"
                          >
                            Внести {money(внесу)}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
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
