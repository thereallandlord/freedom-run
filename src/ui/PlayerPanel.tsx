import { useState } from 'react'
import type { RealEstateAsset, BusinessAsset, Seat } from '../engine/types'
import {
  dividendLines,
  fastTrackIncome,
  fastTrackProgress,
  isOutOfRatRace,
  monthlyCashFlow,
  passiveIncome,
  petExpenses,
  totalExpenses,
  totalIncome,
  fastTrackTarget,
  RULES,
} from '../engine/ledger'
import { professionName } from '../engine/data'

export function money(n: number) {
  if (RULES.currency === 'RUB') {
    const s = Math.abs(Math.round(n)).toLocaleString('ru-RU')
    return n < 0 ? `−${s} ₽` : `${s} ₽`
  }
  const s = Math.abs(Math.round(n)).toLocaleString('en-US')
  return n < 0 ? `−$${s}` : `$${s}`
}
export function signed(n: number) {
  if (RULES.currency === 'RUB') {
    const s = Math.abs(Math.round(n)).toLocaleString('ru-RU')
    return n < 0 ? `−${s} ₽` : `+${s} ₽`
  }
  const s = Math.abs(Math.round(n)).toLocaleString('en-US')
  return n < 0 ? `−$${s}` : `+$${s}`
}
export function tone(n: number) {
  return n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-[var(--muted)]'
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[13px]">
      <span className={dim ? 'text-[var(--muted)]' : ''}>{label}</span>
      <span className="tabnum">{value}</span>
    </div>
  )
}

/** Актив с раскрытием: сколько стоил, сколько должен, сколько приносит. */
function AssetRow({ a, kind }: { a: RealEstateAsset | BusinessAsset; kind: 'realEstate' | 'business' }) {
  const [open, setOpen] = useState(false)
  const debt = kind === 'realEstate' ? (a as RealEstateAsset).mortgage : (a as BusinessAsset).liability
  const mine = Math.round(a.cashFlow * (1 - (a.investorShare ?? 0)))
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 py-[3px] text-left text-[13px] hover:text-emerald-300"
      >
        <span className="truncate text-[var(--muted)]">
          <span className="mr-1 inline-block text-[9px] text-[var(--muted)]">{open ? '▾' : '▸'}</span>
          {a.name}
          {a.investorShare ? ' · 50% инвестору' : ''}
        </span>
        <span className="tabnum shrink-0">{signed(mine)}</span>
      </button>
      {open && (
        <div className="mb-1 ml-3 space-y-0.5 border-l border-[var(--line)] pl-2 text-[11px] text-[var(--muted)]">
          <div className="flex justify-between">
            <span>Стоимость</span>
            <span className="tabnum">{money(a.cost)}</span>
          </div>
          <div className="flex justify-between">
            <span>Вложено своих</span>
            <span className="tabnum">{money(a.investorShare ? 0 : a.downPayment)}</span>
          </div>
          {debt > 0 && (
            <div className="flex justify-between">
              <span>Остаток рассрочки</span>
              <span className="tabnum">{money(debt)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Приносит в месяц</span>
            <span className="tabnum">{signed(mine)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-2 rounded-lg px-3 py-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </div>
      {children}
    </div>
  )
}

export function PlayerPanel({ seat }: { seat: Seat }) {
  const l = seat.ledger
  const income = totalIncome(l)
  const expenses = totalExpenses(l)
  const flow = monthlyCashFlow(l)
  const passive = passiveIncome(l)
  const onFast = seat.track === 'fast'

  return (
    <div className="space-y-2">
      <div className="panel rounded-xl p-3">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full ring-2 ring-white/15" style={{ background: seat.color }} />
          <span className="font-bold">{seat.name}</span>
          {seat.isBot && <span className="text-[10px] text-violet-300">🤖</span>}
          {seat.outOfGame && <span className="text-[10px] text-rose-400">банкрот</span>}
          <span className="ml-auto text-[11px] text-[var(--muted)]">
            {professionName(l.profession, 'ru')}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Наличные</div>
            <div className="tabnum text-2xl font-black">{money(l.cash)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {onFast ? 'Доход свободы' : 'Поток в месяц'}
            </div>
            <div className={`tabnum text-xl font-bold ${tone(onFast ? 1 : flow)}`}>
              {onFast ? money(fastTrackIncome(l)) : signed(flow)}
            </div>
          </div>
        </div>
        {seat.skipTurns > 0 && (
          <div className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300">
            Пропускает ходов: {seat.skipTurns}
          </div>
        )}
        {l.charityTurnsLeft > 0 && (
          <div className="mt-2 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-300">
            Благотворительность: 2 кубика ещё {l.charityTurnsLeft} хода
          </div>
        )}
      </div>

      {onFast ? (
        <Section title="Цель Полосы свободы">
          <Row label="Новый доход собран" value={money(fastTrackProgress(l))} />
          <Row label="Нужно для победы" value={money(fastTrackTarget())} dim />
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${Math.min(100, (fastTrackProgress(l) / fastTrackTarget()) * 100)}%`,
              }}
            />
          </div>
          {l.fastTrack && l.fastTrack.businesses.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {l.fastTrack.businesses.map((b) => (
                <Row key={b.id} label={b.name} value={signed(b.cashFlow)} dim />
              ))}
            </div>
          )}
        </Section>
      ) : (
        <>
          <Section title="Доходы">
            <Row label="Зарплата" value={money(l.salary)} />
            {dividendLines(l).map((d) => (
              <Row key={d.symbol} label={`Дивиденды ${d.symbol}`} value={money(d.amount)} dim />
            ))}
            {l.realEstate.map((a) => (
              <AssetRow key={a.id} a={a} kind="realEstate" />
            ))}
            {l.businesses.map((a) => (
              <AssetRow key={a.id} a={a} kind="business" />
            ))}
            <div className="mt-1 border-t border-[var(--line)] pt-1">
              <Row label="Пассивный доход" value={money(passive)} />
              <Row label="Всего доходов" value={money(income)} />
            </div>
          </Section>

          <Section title="Расходы">
            <Row label="Налоги" value={money(l.expenses.taxes)} dim />
            {l.expenses.homeMortgagePayment > 0 && (
              <Row label={RULES.loansEnabled ? "Ипотека" : "Рассрочка за жильё"} value={money(l.expenses.homeMortgagePayment)} dim />
            )}
            {l.expenses.schoolLoanPayment > 0 && (
              <Row label={RULES.loansEnabled ? "Учебный кредит" : "Оплата обучения"} value={money(l.expenses.schoolLoanPayment)} dim />
            )}
            {l.expenses.carPayment > 0 && (
              <Row label={RULES.loansEnabled ? "Автокредит" : "Рассрочка за машину"} value={money(l.expenses.carPayment)} dim />
            )}
            {l.expenses.creditCardPayment > 0 && (
              <Row label={RULES.loansEnabled ? "Кредитки" : "Долг за технику"} value={money(l.expenses.creditCardPayment)} dim />
            )}
            {l.expenses.retailPayment > 0 && (
              <Row label="Рассрочка" value={money(l.expenses.retailPayment)} dim />
            )}
            <Row label="Прочее" value={money(l.expenses.otherExpenses)} dim />
            {l.pets > 0 && (
              <Row label={`Питомцы (${l.pets})`} value={money(petExpenses(l))} dim />
            )}
            {l.expenses.bankLoanPayment > 0 && (
              <Row label="Банковский кредит" value={money(l.expenses.bankLoanPayment)} dim />
            )}
            <div className="mt-1 border-t border-[var(--line)] pt-1">
              <Row label="Всего расходов" value={money(expenses)} />
            </div>
          </Section>

          <div
            className={`rounded-lg px-3 py-2 text-[13px] ${
              isOutOfRatRace(l)
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'panel-2 text-[var(--muted)]'
            }`}
          >
            {isOutOfRatRace(l) ? (
              '🎉 Пассивный доход перерос расходы — можно уходить из Круга!'
            ) : (
              <>
                <div className="mb-1">
                  <div>Цель: пассивный доход выше расходов</div>
                  <div className="tabnum mt-0.5 text-[var(--ink)]">
                    {money(passive)} <span className="text-[var(--muted)]">из</span> {money(expenses)}
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, (passive / Math.max(1, expenses)) * 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}

      {l.stocks.length > 0 && (
        <Section title="Портфель">
          {l.stocks.map((s) => (
            <Row
              key={s.id}
              label={`${s.symbol} × ${s.shares}`}
              value={`по ${money(s.costPerShare)}`}
              dim
            />
          ))}
        </Section>
      )}

      <Section title="Обязательства">
        {[
          ['Жильё', l.liabilities.homeMortgage],
          ['Обучение', l.liabilities.schoolLoans],
          ['Машина', l.liabilities.carLoans],
          [RULES.loansEnabled ? 'Кредитные карты' : 'Техника', l.liabilities.creditCards],
          ['Рассрочка', l.liabilities.retailDebt],
          [RULES.loansEnabled ? 'Банковский кредит' : 'Заём', l.liabilities.bankLoan],
        ]
          .filter(([, v]) => (v as number) > 0)
          .map(([label, v]) => (
            <Row key={label as string} label={label as string} value={money(v as number)} dim />
          ))}
        {l.realEstate.filter((a) => a.mortgage > 0).map((a) => (
          <Row key={a.id} label={`↳ ${a.name}`} value={money(a.mortgage)} dim />
        ))}
        {l.businesses.filter((a) => a.liability > 0).map((a) => (
          <Row key={a.id} label={`↳ ${a.name}`} value={money(a.liability)} dim />
        ))}
      </Section>
    </div>
  )
}
