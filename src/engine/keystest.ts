/**
 * Ни один опознаватель не должен доехать до человека сырым.
 *
 * 🔴 На живой игре Камиль прочитал на карточке «аутел» — это был ключ
 * `hotelRF`, которого не оказалось в словаре категорий, и он вылез как есть.
 * Такие дыры глазами не ловятся: словарь и колоды живут в разных файлах и
 * расходятся молча. Проверка сверяет их множества.
 */
import { smallDeals, bigDeals, marketCards, WORLD_EVENTS } from './data'
import { CAT_SHORT, CAT_FULL } from './категории'

const кат = new Set<string>()
for (const набор of [smallDeals('ru'), bigDeals('ru'), marketCards('ru')]) {
  for (const c of набор as { category?: string; categories?: string[] }[]) {
    if (c.category) кат.add(c.category)
    for (const x of c.categories ?? []) кат.add(x)
  }
}
for (const e of WORLD_EVENTS as { effect?: { price?: Record<string, number>; flow?: Record<string, number> }; требует?: { категории?: string[] } }[]) {
  for (const поле of ['price', 'flow'] as const)
    for (const k of Object.keys(e.effect?.[поле] ?? {})) кат.add(k)
  for (const k of e.требует?.категории ?? []) кат.add(k)
}

const словари: [string, Set<string>][] = [
  ['коротко', new Set(Object.keys(CAT_SHORT))],
  ['полностью', new Set(Object.keys(CAT_FULL))],
]
const беды: string[] = []
console.log(`категорий в колодах и новостях: ${кат.size}`)
for (const [имя, есть] of словари) {
  for (const k of [...кат].sort()) if (!есть.has(k)) беды.push(`${имя}: нет названия для «${k}»`)
}
for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ СЫРЫЕ КЛЮЧИ ДОЕДУТ ДО ЧЕЛОВЕКА' : '\n✅ ВСЕ КАТЕГОРИИ НАЗВАНЫ ПО-РУССКИ')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
