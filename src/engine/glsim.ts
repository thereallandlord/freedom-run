/**
 * Замер: на каком ходу игрок реально видит карту партнёрского бизнеса.
 *
 * Нужен, чтобы обещание «в первые четыре хода» проверялось цифрой, а не
 * ощущением. Запуск: npx tsx src/engine/glsim.ts
 */
import { applyTableEvent, createTable } from './table'
import type { Table } from './types'

const когда: number[] = []
const застряло = new Map<string, number>()
const ПАРТИЙ = 400

for (let партия = 0; партия < ПАРТИЙ; партия++) {
  let t: Table = createTable({
    seed: 1000 + партия,
    deckTheme: 'ru',
    seats: [
      { id: 's1', name: 'Игрок', isBot: false, botDifficulty: 'medium', dreamSpace: 3 },
      { id: 's2', name: 'Бот', isBot: true, botDifficulty: 'medium', dreamSpace: 9 },
    ],
  } as never)

  let ходИгрока = 0
  let увидел = 0
  for (let шаг = 0; шаг < 600 && !увидел; шаг++) {
    const место = t.seats[t.turnIndex]
    const свой = t.turnIndex === 0

    if (t.phase === 'awaitingRoll') {
      if (свой) ходИгрока++
      const бросок = [1 + Math.floor(Math.random() * 6)]
      t = applyTableEvent(t, { type: 'ROLL', by: место.id, dice: бросок } as never)
      continue
    }
    const p = t.pending as { kind?: string; card?: { greenleaf?: boolean } } | null
    if (свой && p?.card?.greenleaf) {
      увидел = ходИгрока
      break
    }
    if (p?.kind === 'chooseDeal') {
      // Человек берёт вперемешку, бот — всегда крупную: так и было в партии.
      const size = свой ? (Math.random() < 0.55 ? 'small' : 'big') : 'big'
      t = applyTableEvent(t, { type: 'CHOOSE_DEAL', by: место.id, size } as never)
      continue
    }
    // Всячину надо оплатить или пропустить — «мимо» её не закрывает.
    if (p?.kind === 'doodad') {
      const до = t
      t = applyTableEvent(t, { type: 'PAY_DOODAD', by: место.id, financed: false } as never)
      if (t === до) t = applyTableEvent(t, { type: 'SKIP_WANT', by: место.id } as never)
      if (t === до) break
      continue
    }
    if (p) {
      const до = t
      t = applyTableEvent(t, { type: 'PASS_CARD', by: место.id } as never)
      if (t === до) застряло.set(p.kind ?? '?', (застряло.get(p.kind ?? '?') ?? 0) + 1)
      if (t === до) break
      continue
    }
    const до = t
    t = applyTableEvent(t, { type: 'END_TURN', by: место.id } as never)
    if (t === до) {
      застряло.set('фаза:' + t.phase, (застряло.get('фаза:' + t.phase) ?? 0) + 1)
      break
    }
  }
  когда.push(увидел || 99)
}

const до = (n: number) => Math.round((когда.filter((x) => x <= n).length / когда.length) * 100)
const дошли = когда.filter((x) => x !== 99)
console.log(`партий: ${когда.length}`)
for (const n of [1, 2, 3, 4, 5, 6, 8, 12]) console.log(`  увидели до ${n}-го хода: ${до(n)}%`)
console.log(`не увидели вовсе: ${когда.length - дошли.length}`)
console.log(`худший случай: ${дошли.length ? Math.max(...дошли) : '—'} ход`)
console.log('где вставало:', [...застряло.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6))
