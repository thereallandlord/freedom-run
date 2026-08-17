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
import { artById } from './cardArt'
import { GL_RANKS, glPackage, glRankFor, glStructureIncome } from '../engine/greenleaf'

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
  return n > 0
    ? 'text-[var(--t-in,#1F9D6B)]'
    : n < 0
      ? 'text-[var(--t-out,#D6425B)]'
      : 'text-[var(--t-muted, var(--muted))]'
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[13px]">
      <span className={dim ? 'text-[var(--t-muted, var(--muted))]' : ''}>{label}</span>
      <span className="tabnum">{value}</span>
    </div>
  )
}

/** Актив с раскрытием: сколько стоил, сколько должен, сколько приносит. */
const ICO = 'size-[15px] block'
const IconKey = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={ICO}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
)
const IconShop = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={ICO}>
    <path d="M3.5 9.5 5 3.5h14l1.5 6" />
    <path d="M4.5 9.5v11h15v-11" />
    <path d="M3.5 9.5a2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0" />
  </svg>
)

function AssetRow({ a, kind }: { a: RealEstateAsset | BusinessAsset; kind: 'realEstate' | 'business' }) {
  const [open, setOpen] = useState(false)
  const shot = artById(a.id)
  const debt = kind === 'realEstate' ? (a as RealEstateAsset).mortgage : (a as BusinessAsset).liability
  const mine = Math.round(a.cashFlow * (1 - (a.investorShare ?? 0)))
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1 text-left text-[13px] transition hover:text-[var(--t-accent,rgb(var(--c-accent)))]"
      >
        {/* Миниатюра того, что купил: строка «Однушка в Бутово» без картинки
            читается как бухгалтерия, а не как своя недвижимость. */}
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--t-line, var(--line))] bg-[var(--t-glass, var(--panel))]">
          {shot ? (
            <img src={shot} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            <span className="text-[var(--t-muted, var(--muted))]">
              {kind === 'business' ? <IconShop /> : <IconKey />}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{a.name}</span>
          {a.investorShare ? (
            <span className="block text-[10.5px] text-[var(--t-muted, var(--muted))]">50% инвестору</span>
          ) : null}
        </span>
        <span className="tabnum shrink-0">{signed(mine)}</span>
      </button>
      {open && (
        <div className="mb-1 ml-3 space-y-0.5 border-l border-[var(--t-line, var(--line))] pl-2 text-[11px] text-[var(--t-muted, var(--muted))]">
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

/**
 * Раздел панели. Раньше все четыре блока выглядели одинаково — чёрным по
 * белому, — и глазом не отделялись друг от друга. Теперь у каждого свой цвет:
 * полоса слева и заголовок в тон. Цвет несёт смысл (доход зелёный, расход
 * красный), но не остаётся единственным признаком — заголовок подписан словами.
 */
const SECTION_TONE = {
  income: { bar: '#047C54', ink: 'text-[#047C54]' },
  expense: { bar: '#BE123C', ink: 'text-[#BE123C]' },
  debt: { bar: '#B45309', ink: 'text-[#B45309]' },
  asset: { bar: '#0369A1', ink: 'text-[#0369A1]' },
  neutral: { bar: 'var(--t-line, var(--line))', ink: 'text-[var(--t-muted, var(--muted))]' },
} as const

function Section({
  title,
  tone = 'neutral',
  end,
  children,
}: {
  title: string
  tone?: keyof typeof SECTION_TONE
  end?: React.ReactNode
  children: React.ReactNode
}) {
  const t = SECTION_TONE[tone]
  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] py-2 pl-3.5 pr-3 backdrop-blur-md">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] rounded-r"
        style={{ background: t.bar }}
      />
      <div className="mb-1 flex items-baseline gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${t.ink}`}>{title}</span>
        {end && <span className="tabnum ml-auto text-[11px] font-semibold">{end}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * Главная цель партии. Раньше жила в самом низу панели — под доходами,
 * расходами и обязательствами, — и чтобы понять, далеко ли до выхода,
 * приходилось прокручивать. Теперь это первое, что видно.
 *
 * Шкала сделана по образцу панели GreenLeaf: крупное число, под ним полоса,
 * рядом процент.
 */
function GoalCard({ seat }: { seat: Seat }) {
  const l = seat.ledger
  const onFast = seat.track === 'fast'
  const done = onFast ? fastTrackProgress(l) : passiveIncome(l)
  const need = onFast ? fastTrackTarget() : totalExpenses(l)
  const pct = Math.max(0, Math.min(100, (done / Math.max(1, need)) * 100))
  const won = onFast ? done >= need : isOutOfRatRace(l)

  return (
    <div className="rounded-xl border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel))] p-3.5 backdrop-blur-md">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--t-muted, var(--muted))]">
          {onFast ? 'Цель Полосы свободы' : 'Цель: выйти из Круга'}
        </span>
        <span className="tabnum ml-auto text-[11px] font-bold text-[var(--t-accent,rgb(var(--c-accent)))]">{Math.round(pct)}%</span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tabnum text-2xl font-black leading-none text-[var(--t-accent,rgb(var(--c-accent)))]">{money(done)}</span>
        <span className="text-[11px] text-[var(--t-muted, var(--muted))]">из {money(need)}</span>
      </div>

      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[var(--t-line, var(--line))]">
        <div
          className="h-full rounded-full bg-[var(--t-accent,rgb(var(--c-accent)))] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[var(--t-muted, var(--muted))]">
        {won
          ? onFast
            ? 'Цель достигнута — победа ваша.'
            : 'Пассивный доход перерос расходы — можно уходить из Круга.'
          : onFast
            ? 'Соберите новый доход на Полосе свободы.'
            : 'Пассивный доход должен перерасти расходы — тогда работа больше не нужна.'}
      </p>
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
      <GoalCard seat={seat} />
      <div className="rounded-xl border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel))] p-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full ring-2 ring-white/15" style={{ background: seat.color }} />
          <span className="font-bold">{seat.name}</span>
          {seat.isBot && <span className="text-[10px] text-violet-300">🤖</span>}
          {seat.outOfGame && <span className="text-[10px] text-rose-400">банкрот</span>}
          <span className="ml-auto text-[11px] text-[var(--t-muted, var(--muted))]">
            {professionName(l.profession, 'ru')}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--t-muted, var(--muted))]">Наличные</div>
            <div className="tabnum text-2xl font-black">{money(l.cash)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--t-muted, var(--muted))]">
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
        <Section title="Цель Полосы свободы" tone="asset">
          <Row label="Новый доход собран" value={money(fastTrackProgress(l))} />
          <Row label="Нужно для победы" value={money(fastTrackTarget())} dim />
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
          <Section title="Доходы" tone="income" end={money(l.salary + passiveIncome(l))}>
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
            {/*
              Партнёрский бизнес объясняет себя человеческим языком: игрок должен
              понимать, ПОЧЕМУ доход растёт. Никаких PV и терминов — только рубли.
            */}
            {l.businesses
              .filter((b) => b.gl)
              .map((b) => {
                const g = b.gl!
                const rank = glRankFor(g.volume)
                const next = GL_RANKS.find((r) => r.level === rank.level + 1)
                return (
                  <div
                    key={`gl-${b.id}`}
                    className="mt-1 rounded-lg border border-[var(--t-line, var(--line))] p-2 text-[11px] leading-snug"
                  >
                    <div className="font-bold">Партнёрский бизнес · {glPackage(g.packageId).name}</div>
                    <div className="mt-0.5 text-[var(--muted)]">
                      Структура приносит {money(glStructureIncome(g))} в месяц
                      {rank.pension > 0 ? `, сверху пенсия за ранг ${money(rank.pension)}` : ''}.
                    </div>
                    {rank.level > 0 && <div className="mt-0.5">Ранг: {rank.name}</div>}
                    {next && (
                      <div className="mt-0.5 text-[var(--muted)]">
                        До ранга «{next.name}» структуре осталось заработать{' '}
                        {money(Math.max(0, next.volume - g.volume))}.
                      </div>
                    )}
                    {g.dipLeft > 0 && (
                      <div className="mt-0.5 text-amber-400">
                        Наставник выгорел — приток новых людей просел, это ещё {g.dipLeft} зарплат.
                      </div>
                    )}
                    {g.slowdownLeft > 0 && (
                      <div className="mt-0.5 text-amber-400">
                        Команда взяла паузу — доход пока не растёт, ещё {g.slowdownLeft} зарплат.
                      </div>
                    )}
                  </div>
                )
              })}
            <div className="mt-1 border-t border-[var(--t-line, var(--line))] pt-1">
              <Row label="Пассивный доход" value={money(passive)} />
              <Row label="Всего доходов" value={money(income)} />
            </div>
          </Section>

          <Section title="Расходы" tone="expense" end={money(expenses)}>
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
            <div className="mt-1 border-t border-[var(--t-line, var(--line))] pt-1">
              <Row label="Всего расходов" value={money(expenses)} />
            </div>
          </Section>

        </>
      )}

      {l.stocks.length > 0 && (
        <Section title="Портфель" tone="asset">
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

      <Section title="Обязательства" tone="debt">
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
