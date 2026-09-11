/**
 * На второй круг выходят абсолютно все — цель Камиля 11.09: «глобально надо
 * сделать, что на второй круг выходят абсолютно все».
 *
 * Проверка на ботах двумя столами: где один не берёт GreenLeaf (трое берут) и
 * где его не берёт никто. Партия идёт, пока все не вышли, — дальше не нужно.
 * Ломается, если вернуть двойной рост трат (+3% от дохода с активов каждую
 * зарплату), рост трат от любого дохода или конец партии, который выкидывает
 * последнего игрока из Круга.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import type { Table } from './types'

const беды: string[] = []

function стол(seed: number, отказ: (i: number) => boolean) {
  let t: Table = createTable({
    seed,
    deckTheme: 'ru',
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      name: `Б${i}`,
      professionId: ['engineer', 'doctor', 'teacher', 'taxi'][i],
      dreamSpace: [2, 13, 24, 39][i],
      isBot: true,
      botDifficulty: 'medium' as const,
    })),
  } as never)
  let к = seed * 977 + 3
  const rnd = () => ((к = (к * 9301 + 49297) % 233280) / 233280)
  const вышел: (number | null)[] = t.seats.map(() => null)
  const ещёВКруге = () => t.seats.some((s, i) => вышел[i] === null && !s.outOfGame)
  for (let шаг = 0; шаг < 12_000 && t.phase !== 'finished' && ещёВКруге(); шаг++) {
    let ev = decideBotEvent(t, rnd) ?? ({ type: 'END_TURN' } as never)
    const карта = (t.pending as { card?: { greenleaf?: boolean } } | null)?.card
    if (ev.type === 'BUY_DEAL' && карта?.greenleaf && отказ(t.turnIndex)) ev = { type: 'PASS_CARD' } as never
    let n = applyTableEvent(t, ev)
    if (n === t) {
      n = applyTableEvent(t, { type: 'END_TURN' } as never)
      if (n === t) break
    }
    t = n
    t.seats.forEach((s, i) => {
      if (s.track === 'fast' && вышел[i] === null) вышел[i] = t.turnCounter
    })
  }
  return { t, вышел }
}

function проверить(имя: string, seeds: number[], отказ: (i: number) => boolean) {
  const ходыБез: number[] = []
  for (const seed of seeds) {
    const { t, вышел } = стол(seed, отказ)
    t.seats.forEach((s, i) => {
      if (s.outOfGame) беды.push(`${имя}, стол ${seed}: ${s.name} разорился на ходу ${t.turnCounter}`)
      else if (вышел[i] === null) беды.push(`${имя}, стол ${seed}: ${s.name} не вышел из Круга (ход ${t.turnCounter}, партия ${t.phase})`)
      else if (отказ(i)) ходыБез.push(вышел[i]!)
    })
  }
  const м = [...ходыБез].sort((a, b) => a - b)
  console.log(`  ${имя}: столов ${seeds.length}, без GreenLeaf выход — медиана ${м[Math.floor(м.length / 2)] ?? '—'}-й ход`)
}

проверить('один без GreenLeaf', [1, 2, 3, 4, 5, 6], (i) => i === 0)
проверить('никто без GreenLeaf', [1, 2, 3], () => true)

console.log(
  беды.length
    ? '\n❌ НЕ ВСЕ ВЫХОДЯТ НА ВТОРОЙ КРУГ:\n  ' + беды.join('\n  ')
    : '\n✅ ВСЕ ВЫХОДЯТ НА ВТОРОЙ КРУГ: и с GreenLeaf, и без, разорений нет',
)
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
