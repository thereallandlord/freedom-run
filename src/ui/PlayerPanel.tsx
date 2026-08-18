import { useEffect, useRef, useState } from 'react'
import type { RealEstateAsset, BusinessAsset, Seat } from '../engine/types'
import {
  dividendLines,
  fastTrackIncome,
  fastTrackProgress,
  isOutOfRatRace,
  freedomIncome,
  monthlyCashFlow,
  passiveIncome,
  petExpenses,
  totalExpenses,
  totalIncome,
  fastTrackTarget,
  RULES,
  ribaRisk,
  MANAGER_PCT,
} from '../engine/ledger'
import type { TableEvent } from '../engine/events'
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

/**
 * Прибавка к наличным всплывающей цифрой.
 *
 * 🔴 Окно для зарплаты не годится: она приходит каждый круг, и закрывать его
 * по три раза за круг — мучение (правка Камиля). Деньги должны просто
 * «прилететь» рядом со счётом и растаять.
 */
function CashBump({ cash }: { cash: number }) {
  const prev = useRef(cash)
  const [bump, setBump] = useState<{ id: number; delta: number } | null>(null)
  useEffect(() => {
    const d = cash - prev.current
    prev.current = cash
    if (Math.abs(d) < 100) return
    const id = Date.now()
    setBump({ id, delta: d })
    const t = window.setTimeout(() => setBump((b) => (b?.id === id ? null : b)), 1600)
    return () => window.clearTimeout(t)
  }, [cash])
  if (!bump) return null
  return (
    <span
      key={bump.id}
      className={`cash-bump tabnum pointer-events-none absolute -top-1 left-0 text-[15px] font-black ${
        bump.delta > 0 ? 'text-emerald-400' : 'text-rose-400'
      }`}
    >
      {bump.delta > 0 ? '+' : '−'}
      {money(Math.abs(bump.delta))}
    </span>
  )
}

function AssetRow({
  a,
  kind,
  dispatch,
  cash,
}: {
  a: RealEstateAsset | BusinessAsset
  kind: 'realEstate' | 'business'
  dispatch?: (e: TableEvent) => void
  cash?: number
}) {
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
          {(a as RealEstateAsset).installmentMonthly ? (
            <div className="flex justify-between">
              <span>Платёж по рассрочке</span>
              <span className="tabnum">−{money((a as RealEstateAsset).installmentMonthly ?? 0)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span>Приносит в месяц</span>
            <span className="tabnum">{signed(mine)}</span>
          </div>
          {/*
            🔴 Закрыть рассрочку можно ПРЯМО ЗДЕСЬ. Движок это умел с самого
            начала, а кнопки не было нигде — Камиль искал её и не нашёл.
            После погашения платёж исчезает и доход по объекту растёт на его
            величину: это самый наглядный способ показать, чем рассрочка
            отличается от покупки за наличные.
          */}
          {/*
            🔴 Управляющий — переход от самозанятости к владению. Пока его нет,
            бизнес приносит деньги, но не приближает свободу: перестал ходить —
            перестало платить. Нанял — отдал долю, зато остаток пошёл в зачёт.
          */}
          {kind === 'business' && !(a as BusinessAsset).gl && dispatch && (
            (a as BusinessAsset).managerPct ? (
              <div className="mt-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[11px] leading-snug">
                Управляющий забирает {(a as BusinessAsset).managerPct}% — остальное работает без вас
                и идёт в зачёт свободы
              </div>
            ) : (
              <button
                disabled={(cash ?? 0) < Math.max(30_000, Math.round((mine * MANAGER_PCT * 3) / 100 / 1000) * 1000)}
                onClick={() => dispatch({ type: 'HIRE_MANAGER', assetId: a.id, pct: MANAGER_PCT })}
                className="mt-1.5 w-full rounded-lg border border-[var(--t-line, var(--line))] px-2 py-1.5 text-[11px] font-semibold leading-snug transition hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                Нанять управляющего за{' '}
                {money(Math.max(30_000, Math.round((mine * MANAGER_PCT * 3) / 100 / 1000) * 1000))}
                <span className="mt-0.5 block font-normal text-[var(--t-muted, var(--muted))]">
                  заберёт {MANAGER_PCT}%, зато {money(Math.round((mine * (100 - MANAGER_PCT)) / 100))}/мес
                  пойдут в зачёт свободы
                </span>
              </button>
            )
          )}
          {debt > 0 && dispatch && (
            <button
              disabled={(cash ?? 0) < debt}
              onClick={() => dispatch({ type: 'PAYOFF_ASSET', assetId: a.id, discountPct: 0 })}
              className="mt-1.5 w-full rounded-lg border border-[var(--t-line, var(--line))] px-2 py-1.5 text-[11px] font-semibold transition hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
            >
              Закрыть рассрочку за {money(debt)}
              {(a as RealEstateAsset).installmentMonthly
                ? ` — доход вырастет на ${money((a as RealEstateAsset).installmentMonthly ?? 0)}/мес`
                : ''}
            </button>
          )}
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
        <span className={`caps text-[10px] font-bold ${t.ink}`}>{title}</span>
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
function GoalCard({ seat, flowMul }: { seat: Seat; flowMul?: Record<string, number> }) {
  const l = seat.ledger
  const onFast = seat.track === 'fast'
  // 🔴 Шкала свободы считает то, что работает БЕЗ тебя, а не весь доход с активов.
  const done = onFast ? fastTrackProgress(l) : freedomIncome(l, flowMul)
  const need = onFast ? fastTrackTarget() : totalExpenses(l)
  const pct = Math.max(0, Math.min(100, (done / Math.max(1, need)) * 100))
  const won = onFast ? done >= need : isOutOfRatRace(l)

  return (
    <div className="rounded-xl border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel))] p-3.5 backdrop-blur-md">
      <div className="flex items-baseline gap-2">
        <span className="caps text-[10px] font-bold text-[var(--t-muted, var(--muted))]">
          {onFast ? 'Цель Полосы свободы' : 'Цель: вырваться из крысиных бегов'}
        </span>
        <span className="tabnum ml-auto text-[11px] font-bold text-[var(--t-accent,rgb(var(--c-accent)))]">{Math.round(pct)}%</span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tabnum text-2xl font-black leading-none text-[var(--t-accent,rgb(var(--c-accent)))]">{money(done)}</span>
        <span className="text-[11px] text-[var(--t-muted, var(--muted))]">из {money(need)}</span>
      </div>

      {/*
        🔴 Дорожка должна быть ВИДНА и пустой. Раньше она красилась в --t-line,
        а это почти прозрачная линия: на светлой панели шкалы просто не было.
        Теперь заметная подложка, и заполнение никогда не тоньше волоска —
        иначе при одном проценте кажется, что полосы нет вовсе.
      */}
      <div
        className="mt-2.5 h-[7px] overflow-hidden rounded-full"
        style={{ background: 'color-mix(in srgb, var(--t-ink, #000) 14%, transparent)' }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: pct > 0 ? `max(5px, ${pct}%)` : '0%',
            background: 'var(--t-accent, rgb(var(--c-accent)))',
          }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[var(--t-muted, var(--muted))]">
        {won
          ? onFast
            ? 'Цель достигнута — победа ваша.'
            : 'Доход, который работает без вас, перерос расходы — можно уходить.'
          : onFast
            ? 'Соберите новый доход на Полосе свободы.'
            : 'Доход, который работает без вас, должен перерасти расходы — тогда работа больше не нужна.'}
      </p>
    </div>
  )
}

/**
 * 🔴 Панель обязана считать доход С УЧЁТОМ рынка: зарплату движок платит с
 * ним, а панель показывала без него. «Анталья забита, +30%» — на экране
 * прежние цифры, на счёте другие, и человек считает, что игра врёт.
 */
export function PlayerPanel({
  seat,
  dispatch,
  flowMul,
}: {
  seat: Seat
  dispatch?: (e: TableEvent) => void
  flowMul?: Record<string, number>
}) {
  const l = seat.ledger
  const income = totalIncome(l, flowMul)
  const expenses = totalExpenses(l)
  const flow = monthlyCashFlow(l, flowMul)
  const passive = passiveIncome(l, flowMul)
  const onFast = seat.track === 'fast'

  return (
    /*
      Отступы сверху и снизу — внутри прокручиваемого содержимого, а не у
      коробки. Так в покое панель не приклеена к краям, а при прокрутке
      блоки уходят под края окна, а не обрываются об них.
    */
    <div className="space-y-2 pb-4 pt-3">
      <GoalCard seat={seat} flowMul={flowMul} />
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
            <div className="caps text-[10px] text-[var(--t-muted, var(--muted))]">Наличные</div>
            <div className="relative">
              <div className="tabnum text-2xl font-black">{money(l.cash)}</div>
              <CashBump cash={l.cash} />
            </div>
          </div>
          <div className="text-right">
            <div className="caps text-[10px] text-[var(--t-muted, var(--muted))]">
              {/* «Поток» — слово из учебника. Человеку понятнее «чистый доход». */}
              {onFast ? 'Доход свободы' : 'Чистый доход в месяц'}
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
          <Section title="Доходы" tone="income" end={money(l.salary + passiveIncome(l, flowMul))}>
            <Row label="Зарплата" value={money(l.salary)} />
            {dividendLines(l).map((d) => (
              <Row key={d.symbol} label={`Дивиденды ${d.symbol}`} value={money(d.amount)} dim />
            ))}
            {l.realEstate.map((a) => (
              <AssetRow key={a.id} a={a} kind="realEstate" dispatch={dispatch} cash={l.cash} />
            ))}
            {l.businesses.map((a) => (
              <AssetRow key={a.id} a={a} kind="business" dispatch={dispatch} cash={l.cash} />
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
              <Row label="Доход с активов" value={money(passive)} />
              {/*
                🔴 Две разные вещи, и в этом весь смысл игры. Деньги от кафе
                приходят и тратятся, но пока ты сам за прилавком — свободу они
                не приближают. В зачёт идёт только то, что крутится без тебя.
              */}
              <Row label="Из них работает без вас" value={money(freedomIncome(l, flowMul))} />
              <Row label="Всего доходов" value={money(income)} />
            </div>
          </Section>

          {/*
            🔴 Показываем ТОЛЬКО деньги: сумму кредита и платёж. Влияние
            кредита на то, какие карты выпадают, — механика СКРЫТАЯ (решение
            Камиля 18.08): «просто как функция она есть, но мы не пишем, что
            это влияет на игру». Раньше здесь стояла шкала «долговая
            нагрузка» и прямая подпись — это выдавало правило целиком.
          */}
          {l.liabilities.ribaLoan > 0 && (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-2 text-[11px] leading-snug">
              <div className="font-bold">Кредит</div>
              <div className="tabnum mt-0.5">
                {money(l.liabilities.ribaLoan)}
                {(l.ribaGraceLeft ?? 0) > 0
                  ? ` · без платежей ещё ${l.ribaGraceLeft} зарплат`
                  : ` · платёж ${money(l.expenses.ribaPayment)}/мес`}
              </div>
            </div>
          )}

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
            {/* 🔴 Без этой строки сумма раздела не сходилась с итогом. */}
            {l.expenses.ribaPayment > 0 && (
              <Row label="Платёж по кредиту" value={money(l.expenses.ribaPayment)} dim />
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
          // 🔴 В халяль-режиме это РАССРОЧКИ, а не кредиты: слово «автокредит»
          // в игре без процентов противоречит самой её сути.
          [RULES.loansEnabled ? 'Ипотека' : 'Рассрочка за жильё', l.liabilities.homeMortgage],
          [RULES.loansEnabled ? 'Учебный кредит' : 'Оплата обучения', l.liabilities.schoolLoans],
          [RULES.loansEnabled ? 'Автокредит' : 'Рассрочка за машину', l.liabilities.carLoans],
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
