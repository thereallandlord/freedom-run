/**
 * Земля в аренде: доход идёт как обычно, а капитал горит.
 *
 * 🔴 Разбор живых объявлений (06.09) поймал то, чего мы не знали: на Бали
 * иностранцу землю в собственность не продают. Все сделки — аренда на 19–30
 * лет, после чего дом возвращается владельцу земли. Решение Камиля: показать
 * это как есть, отдельным классом.
 */
import { createLedger } from './ledger'
import { applyEvent } from './applyEvent'
import { professionsFor, smallDeals, bigDeals } from './data'
import type { Ledger } from './types'

const беды: string[] = []
const колода = [...smallDeals('ru'), ...bigDeals('ru')] as never as { id: string; title: string; category?: string; арендаЗемлиЛет?: number }[]
const бали = колода.filter((c) => c.category === 'aptBALI')
console.log(`балийских карточек: ${бали.length}`)
const безСрока = бали.filter((c) => !c.арендаЗемлиЛет)
if (безСрока.length) беды.push(`без срока аренды: ${безСрока.map((c) => c.title).join(', ')}`)
const чужие = колода.filter((c) => c.арендаЗемлиЛет && c.category !== 'aptBALI')
if (чужие.length) беды.push(`срок стоит там, где не должен: ${чужие.map((c) => c.title).join(', ')}`)

/* Живая проверка: доход не падает, стоимость тает. */
const prof = professionsFor('ru')[0]
let l: Ledger = createLedger(prof, 'Тест')
l = applyEvent(l, {
  type: 'BUY_REAL_ESTATE',
  id: 'вилла', name: 'Вилла', cost: 18_500_000, downPayment: 18_500_000,
  mortgage: 0, cashFlow: 83_000, category: 'aptBALI', value: 18_500_000,
  арендаЗемлиЛет: 25,
} as never)
const актив = () => l.realEstate.find((a) => a.id === 'вилла')!
const срокДо = актив().арендаЗемли?.осталосьМес ?? 0
const ценаДо = актив().value ?? 0
const доходДо = актив().cashFlow
for (let i = 0; i < 12; i++) l = applyEvent(l, { type: 'PAYCHECK' } as never)
const срокПосле = актив().арендаЗемли?.осталосьМес ?? 0
const ценаПосле = актив().value ?? 0
const доходПосле = актив().cashFlow

console.log(`\nза 12 зарплат (год жизни):`)
console.log(`  срок аренды: ${срокДо} → ${срокПосле} мес`)
console.log(`  стоимость:   ${ценаДо.toLocaleString('ru-RU')} → ${ценаПосле.toLocaleString('ru-RU')} ₽`)
console.log(`  доход:       ${доходДо.toLocaleString('ru-RU')} → ${доходПосле.toLocaleString('ru-RU')} ₽/мес`)

if (срокПосле !== срокДо - 12) беды.push(`срок ушёл на ${срокДо - срокПосле} мес вместо 12`)
if (ценаПосле >= ценаДо) беды.push('стоимость не тает — капитал не горит')
if (доходПосле !== доходДо) беды.push('доход изменился, а не должен: горит капитал, а не поток')
const ожидание = Math.round(ценаДо * (срокДо - 12) / срокДо)
if (Math.abs(ценаПосле - ожидание) > ценаДо * 0.02)
  беды.push(`стоимость ${ценаПосле} против ожидаемых ~${ожидание}`)

for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ АРЕНДА ЗЕМЛИ РАБОТАЕТ НЕ ТАК' : '\n✅ ДОХОД ИДЁТ, КАПИТАЛ ГОРИТ')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
