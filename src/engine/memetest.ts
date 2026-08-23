/**
 * Как часто мемкоин выпадает В РЕАЛЬНОЙ ранней партии.
 *
 * 🔴 Мерить надо на СТАРТОВЫХ деньгах (21–95 тысяч), а не на выданном
 * миллионе. Мемкоины стоят 300–1200 ₽, а остальное новичку не по карману, и
 * фильтр «хватает ли денег» сгущает колоду именно на них. На богатом столе
 * замер показывал 3,6% и прятал худший случай — настоящий был вдвое хуже.
 */
import { createTable, applyTableEvent } from './table'

let мем = 0
let всего = 0
for (let seed = 1; seed <= 600; seed++) {
  let t = createTable({
    seed,
    deckTheme: 'ru',
    seats: [
      { id: 'a', name: 'А', professionId: 'engineer', dreamSpace: 3, isBot: false },
      { id: 'b', name: 'Б', professionId: 'doctor', dreamSpace: 7, isBot: false },
    ],
  } as never)
  // Первые восемь находок партии — деньги стартовые, как у живого человека.
  for (let i = 0; i < 8; i++) {
    t.pending = { kind: 'chooseDeal' } as never
    t.phase = 'resolving'
    const после = applyTableEvent(t, { type: 'CHOOSE_DEAL', size: 'small' } as never)
    if (после.pending?.kind === 'deal') {
      всего += 1
      if ((после.pending.card as { meme?: boolean }).meme) мем += 1
    }
    t = после
  }
}
const доля = (мем / всего) * 100
console.log(`мемкоин в первых находках партии: ${мем} из ${всего} = ${доля.toFixed(1)}%`)
console.log(доля <= 5 ? '✅ РЕДКО, КАК И ЗАДУМАНО' : `❌ слишком часто (цель — не больше 5%)`)
if (доля > 5) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
