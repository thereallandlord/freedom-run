/**
 * Каждое мировое событие бьёт по тому, что в колодах ЕСТЬ.
 *
 * 🔴 Опечатка в названии категории или тикера не ломает ничего видимого:
 * событие выходит, объявляет «недвижимость в Казани подорожала» — и не двигает
 * ни одной цифры, потому что такой категории нет. За столом это выглядит как
 * «новость ни на что не влияет», а найти причину можно только чтением данных.
 * Поэтому сверяем механически.
 */
import { WORLD_EVENTS, smallDeals, bigDeals } from './data'

const категории = new Set<string>()
const тикеры = new Set<string>()
for (const c of [...smallDeals('ru'), ...bigDeals('ru')]) {
  const кат = (c as { category?: string }).category
  if (кат) категории.add(кат)
  if (c.kind === 'stock') тикеры.add((c as { symbol: string }).symbol)
}

let плохо = 0
for (const e of WORLD_EVENTS) {
  const f = e.effect as { categories?: string[]; symbols?: string[] }
  for (const c of f.categories ?? [])
    if (!категории.has(c)) {
      console.log(`❌ ${e.id}: категории «${c}» нет ни в одной колоде`)
      плохо += 1
    }
  for (const s of f.symbols ?? [])
    if (!тикеры.has(s)) {
      console.log(`❌ ${e.id}: бумаги «${s}» нет ни в одной колоде`)
      плохо += 1
    }
  // Условие выхода тоже ссылается на категории — и тоже может промахнуться.
  for (const c of e.требует?.категории ?? [])
    if (!категории.has(c)) {
      console.log(`❌ ${e.id}: условие ждёт категорию «${c}», которой нет`)
      плохо += 1
    }
}

const пусто = WORLD_EVENTS.filter((e) => {
  const f = e.effect as { kind: string; pct?: number; points?: number; amount?: number }
  return (f.pct ?? f.points ?? f.amount ?? 0) === 0
})
for (const e of пусто) {
  console.log(`❌ ${e.id}: событие ничего не двигает (ноль)`)
  плохо += 1
}

console.log(`\nсобытий ${WORLD_EVENTS.length} · категорий в колодах ${категории.size} · бумаг ${тикеры.size}`)
console.log(плохо === 0 ? '✅ ВСЕ СОБЫТИЯ БЬЮТ ПО СУЩЕСТВУЮЩЕМУ' : `❌ битых мест: ${плохо}`)
if (плохо) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
