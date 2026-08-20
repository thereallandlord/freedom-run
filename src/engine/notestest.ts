/**
 * Объяснения партнёрского бизнеса обязаны доходить до игрока.
 * 🔴 Движок писал их и выбрасывал: в разборе зарплаты бралось только новое
 * состояние. Живая жалоба 19.08 — «никто не понял, откуда взялся доход».
 * Запуск: npx tsx src/engine/notestest.ts
 */
import { applyEvent } from './applyEvent'
import { createLedger } from './ledger'
import { professionsFor } from './data'
import { glInitialState } from './greenleaf'
import type { Ledger } from './types'

let l: Ledger = createLedger(professionsFor('ru')[0], 'Игрок')
l.businesses.push({
  id: 'gl-1',
  name: 'Партнёрский бизнес GreenLeaf',
  cashFlow: 1700,
  liability: 0,
  gl: glInitialState('platinum', 1),
} as never)

const всё: string[] = []
for (let i = 0; i < 16; i++) {
  l = applyEvent(l, { type: 'PAYCHECK' } as never)
  for (const n of l.glNotes ?? []) всё.push(`зарплата ${i + 1}: ${n}`)
}

console.log('█ ЧТО УВИДЕЛ БЫ ИГРОК\n')
for (const s of всё) console.log('  •', s)

const естьРост = всё.some((s) => /к доходу/.test(s))
const естьРанг = всё.some((s) => /ранг/i.test(s))
const естьПремия = всё.some((s) => /Премия за ранг/.test(s))
console.log(`\nобъяснений всего: ${всё.length}`)
const ок = всё.length > 0 && естьРост && естьРанг && естьПремия
console.log(ок ? '✅ ОБЪЯСНЕНИЯ ДОХОДЯТ' : '❌ ОБЪЯСНЕНИЯ ТЕРЯЮТСЯ')
if (!ок) throw new Error('объяснения партнёрского бизнеса не доходят до игрока')
