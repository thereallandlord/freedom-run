/**
 * Банкрот с деньгами на руках урезает образ жизни и остаётся в игре.
 *
 * 🔴 11.09: учитель с 327 000 ₽ на руках и минусом 1 100 ₽ в месяц выбывал из
 * игры — выйти из банкротства разрешалось только с неотрицательным потоком, а
 * быт за долгую партию перерос зарплату. Цель Камиля: «на второй круг выходят
 * абсолютно все» — выбывать с деньгами на руках нельзя.
 */
import { createTable, applyTableEvent, canRecover } from './table'
import { monthlyCashFlow } from './ledger'
import type { Ledger, Table } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

function стол(правка: (l: Ledger) => void): Table {
  const t0 = createTable({
    seed: 3,
    deckTheme: 'ru',
    seats: [{ id: 'a', name: 'Учитель', professionId: 'teacher', dreamSpace: 2 }],
  } as never)
  const l = structuredClone(t0.seats[0].ledger)
  правка(l)
  return { ...t0, seats: [{ ...t0.seats[0], ledger: l }], pending: { kind: 'bankruptcy' }, phase: 'resolving' } as Table
}

// 1. Деньги есть, месяц в минус на 1 100 ₽ — урезает быт ровно на минус и остаётся.
{
  const t = стол((l) => {
    l.cash = 327_255
    l.expenses.otherExpenses += monthlyCashFlow(l) + 1_100
  })
  п('минус в месяц подготовлен', monthlyCashFlow(t.seats[0].ledger) === -1_100, String(monthlyCashFlow(t.seats[0].ledger)))
  п('с деньгами на руках выкарабкаться можно', canRecover(t.seats[0].ledger))
  const n = applyTableEvent(t, { type: 'BANKRUPTCY_RECOVER' } as never)
  п('выкарабкался и в игре', n !== t && !n.seats[0].outOfGame && n.pending === null)
  const l = n.seats[0].ledger
  п('месяц больше не в минусе', monthlyCashFlow(l) >= 0, String(monthlyCashFlow(l)))
  п('урезано ровно на минус', t.seats[0].ledger.expenses.otherExpenses - l.expenses.otherExpenses === 1_100)
  п('деньги на руках не тронуты', l.cash === 327_255, String(l.cash))
  п('пропускает 3 хода', n.seats[0].skipTurns === 3)
}

// 2. Деньги на руках в минусе — сперва продавать, выкарабкаться нельзя.
п('с минусом на руках не выкарабкаться', !canRecover(стол((l) => (l.cash = -10_000)).seats[0].ledger))

// 3. Минус в месяц больше всего быта — урезать нечем.
п(
  'урезать нечем — не выкарабкаться',
  !canRecover(
    стол((l) => {
      l.cash = 100_000
      l.expenses.otherExpenses = 0
      l.salary = 10_000
    }).seats[0].ledger,
  ),
)

console.log(
  беды.length
    ? '\n❌ БАНКРОТ С ДЕНЬГАМИ:\n  ' + беды.join('\n  ')
    : '\n✅ БАНКРОТ С ДЕНЬГАМИ НА РУКАХ УРЕЗАЕТ БЫТ И ОСТАЁТСЯ В ИГРЕ',
)
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
