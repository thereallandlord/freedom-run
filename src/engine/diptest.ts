/**
 * Просадка дохода обязана кончаться. Живой случай 19.08: карточка «из
 * структуры выбыл лидер» роняла доход на 20% НАВСЕГДА.
 * Запуск: npx tsx src/engine/diptest.ts
 */
import { glInitialState, glOnPayday, glTotalIncome } from './greenleaf'

let g = glInitialState('platinum', 1)
for (let i = 0; i < 6; i++) g = glOnPayday(g).next
const доКарточки = glTotalIncome(g)

// Карточка «выбыл лидер»: минус 20% на 5 зарплат.
g = { ...g, dipMul: 0.8, dipLeft: 5 }
const сразуПосле = glTotalIncome(g)

const путь: number[] = []
for (let i = 0; i < 10; i++) {
  g = glOnPayday(g).next
  путь.push(glTotalIncome(g))
}

console.log(`до карточки:      ${доКарточки} ₽`)
console.log(`сразу после:      ${сразуПосле} ₽ (просадка ${Math.round((1 - сразуПосле / доКарточки) * 100)}%)`)
console.log(`дальше по зарплатам: ${путь.join(' → ')}`)
console.log(`остаток просадки:  dipLeft=${g.dipLeft}, dipMul=${g.dipMul}`)

const ок = g.dipLeft === 0 && g.dipMul === 1 && путь[путь.length - 1] > доКарточки
console.log(ок ? '\n✅ ПРОСАДКА КОНЧИЛАСЬ И ДОХОД ВЕРНУЛСЯ' : '\n❌ ПРОСАДКА НЕ КОНЧАЕТСЯ')
if (!ок) throw new Error('просадка дохода не кончается')
