/**
 * Своё дело растёт: ещё одна точка и франшиза собственного дела.
 *
 * 🔴 Решение Камиля 11.09 (вариант Б). Без GreenLeaf из Круга выходили 5%:
 * настоящие дела за партию до свободы не дорастали. Здесь проверяются правила
 * механики; сдвиг выхода из Круга меряется отдельным замером.
 */
import { createTable, applyTableEvent } from './table'
import { applyEvent } from './applyEvent'
import { freedomIncome, MANAGER_PCT } from './ledger'
import { ценаТочки, ценаФраншизы, ФРАНШИЗА_СТАРТ, ФРАНШИЗА_РОСТ, ФРАНШИЗА_ПОТОЛОК, ТОЧЕК_СВЕРХ_ПЕРВОЙ } from './своёДело'
import type { BusinessAsset, Ledger, Table } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

const кофейня = (сУправляющим: boolean): BusinessAsset =>
  ({
    id: 'coffee',
    name: 'Кофейня навынос',
    cost: 2_500_000,
    downPayment: 2_500_000,
    liability: 0,
    cashFlow: 90_000,
    category: 'bizFood',
    value: 2_500_000,
    ...(сУправляющим ? { managerPct: MANAGER_PCT } : {}),
  }) as BusinessAsset

function стол(сУправляющим: boolean): Table {
  const t0 = createTable({
    seed: 4,
    deckTheme: 'ru',
    seats: [{ id: 'a', name: 'Камиль', professionId: 'engineer', dreamSpace: 2 }],
  } as never)
  return {
    ...t0,
    seats: t0.seats.map((s) => ({
      ...s,
      ledger: { ...s.ledger, cash: 20_000_000, businesses: [кофейня(сУправляющим)] },
    })),
  } as Table
}
const точка = (t: Table) => applyTableEvent(t, { type: 'OPEN_BRANCH', assetId: 'coffee' } as never)
const франшиза = (t: Table) => applyTableEvent(t, { type: 'FRANCHISE_OWN', assetId: 'coffee' } as never)

// 1. Без управляющего в первой точке вторую не открыть: в двух местах сразу не постоишь.
{
  const t = стол(false)
  п('без управляющего вторую точку не открыть', точка(t).seats[0].ledger.businesses.length === 1)
}

// 2. Точка открывается с управляющим, стоит свою долю цены и сразу идёт в зачёт свободы.
{
  const t0 = стол(true)
  const до = { cash: t0.seats[0].ledger.cash, свобода: freedomIncome(t0.seats[0].ledger) }
  const l = точка(t0).seats[0].ledger
  const новая = l.businesses.find((b) => b.точкаОт === 'coffee')
  п('точка появилась', !!новая)
  п('точка сразу с управляющим', новая?.managerPct === MANAGER_PCT, `${новая?.managerPct}`)
  п('списана цена точки', до.cash - l.cash === ценаТочки(кофейня(true)), `${до.cash - l.cash} вместо ${ценаТочки(кофейня(true))}`)
  const прибавка = freedomIncome(l) - до.свобода
  const ждём = Math.round((90_000 * (100 - MANAGER_PCT)) / 100)
  п('в зачёт свободы пошёл доход точки за вычетом управляющего', Math.abs(прибавка - ждём) <= 1, `${прибавка} вместо ${ждём}`)
  console.log(`  точка: −${(до.cash - l.cash).toLocaleString('ru')} ₽, +${прибавка.toLocaleString('ru')} ₽/мес в зачёт свободы`)
}

// 3. Сеть не бесконечна: точек сверх первой — не больше положенного.
{
  let t = стол(true)
  for (let i = 0; i < ТОЧЕК_СВЕРХ_ПЕРВОЙ + 2; i++) t = точка(t)
  const точек = t.seats[0].ledger.businesses.filter((b) => b.точкаОт === 'coffee').length
  п(`точек сверх первой не больше ${ТОЧЕК_СВЕРХ_ПЕРВОЙ}`, точек === ТОЧЕК_СВЕРХ_ПЕРВОЙ, `${точек}`)
}

// 4. Франшиза — только от трёх своих точек; растёт каждую зарплату до потолка и идёт в зачёт без управляющего.
{
  let t = точка(стол(true))
  п('при двух точках франшизу не продать', франшиза(t).seats[0].ledger.businesses.every((b) => !b.франшизаОт))
  t = точка(t)
  const до = { cash: t.seats[0].ledger.cash, свобода: freedomIncome(t.seats[0].ledger) }
  t = франшиза(t)
  let l: Ledger = t.seats[0].ledger
  const ф = l.businesses.find((b) => b.франшизаОт === 'coffee')
  п('при трёх точках франшиза продаётся', !!ф)
  п('списана цена упаковки', до.cash - l.cash === ценаФраншизы(кофейня(true)))
  п('роялти на старте — доля дохода точки', ф?.cashFlow === Math.round((90_000 * ФРАНШИЗА_СТАРТ) / 100) * 100, `${ф?.cashFlow}`)
  п('роялти идут в зачёт свободы целиком, без управляющего', freedomIncome(l) - до.свобода === ф?.cashFlow, `${freedomIncome(l) - до.свобода}`)
  п('вторую франшизу того же дела не продать', франшиза(t).seats[0].ledger.businesses.filter((b) => b.франшизаОт).length === 1)
  for (let i = 0; i < 40; i++) l = applyEvent(l, { type: 'PAYCHECK' } as never)
  const потом = l.businesses.find((b) => b.франшизаОт === 'coffee')!
  п('роялти выросли до потолка', потом.cashFlow === Math.round(90_000 * ФРАНШИЗА_ПОТОЛОК), `${потом.cashFlow}`)
  console.log(`  франшиза: старт ${ф?.cashFlow?.toLocaleString('ru')} ₽/мес, +${(90_000 * ФРАНШИЗА_РОСТ).toLocaleString('ru')} за зарплату, потолок ${потом.cashFlow.toLocaleString('ru')} ₽/мес`)
}

// 5. Во франшизу управляющего не нанять: роялти идут в зачёт и так, он только забрал бы долю (12.09).
{
  const безУпр = стол(false)
  п('в обычное дело управляющий нанимается', applyTableEvent(безУпр, { type: 'HIRE_MANAGER', assetId: 'coffee', pct: MANAGER_PCT } as never) !== безУпр)
  const t = франшиза(точка(точка(стол(true))))
  const ф = t.seats[0].ledger.businesses.find((b) => b.франшизаОт === 'coffee')
  п('франшиза есть', !!ф)
  п('во франшизу управляющего не нанять', applyTableEvent(t, { type: 'HIRE_MANAGER', assetId: ф?.id ?? '', pct: MANAGER_PCT } as never) === t)
}

console.log(беды.length ? '\n❌ СВОЁ ДЕЛО РАСТЁТ:\n  ' + беды.join('\n  ') : '\n✅ СВОЁ ДЕЛО РАСТЁТ: точка с управляющим, франшиза от трёх точек, роялти до потолка')
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
