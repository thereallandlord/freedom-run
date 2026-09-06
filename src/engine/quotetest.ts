/**
 * Как ходит цена и чем кончается продажа.
 *
 * 🔴 Замер, а не рассуждение: Камиль просил, чтобы «в большинстве случаев
 * продажа была в минус — или как это в реальной жизни». Здесь видно, что
 * получилось на самом деле.
 */
import { createTable, applyTableEvent } from './table'
import { smallDeals } from './data'
import { классБумаги } from './котировки'
import type { Table } from './types'

const бумаги = smallDeals('ru').filter((c) => c.kind === 'stock') as never as {
  symbol: string
  price: number
  range: [number, number]
  meme?: boolean
}[]

const ХОДОВ = 175
const ПАРТИЙ = 60

type Итог = { вверх: number; вниз: number; путь: number[]; конец: number[] }
const по: Record<string, Итог> = {}
for (const b of бумаги) по[b.symbol] = { вверх: 0, вниз: 0, путь: [], конец: [] }

for (let seed = 1; seed <= ПАРТИЙ; seed++) {
  let t: Table = createTable({
    seed,
    deckTheme: 'ru',
    seats: [0, 1].map((i) => ({
      id: `s${i}`, name: `Б${i}`,
      professionId: ['engineer', 'doctor'][i],
      dreamSpace: [2, 13][i], isBot: true, botDifficulty: 'medium' as const,
    })),
  } as never)
  const старт = { ...(t.котировки ?? {}) }
  /* Гоняем только часы цены: нас интересует движение, а не игра. */
  for (let i = 0; i < ХОДОВ; i++) t = applyTableEvent(t, { type: 'END_TURN' } as never)
  for (const b of бумаги) {
    const было = старт[b.symbol.toUpperCase()] ?? b.price
    const стало = t.котировки?.[b.symbol.toUpperCase()] ?? было
    по[b.symbol][стало >= было ? 'вверх' : 'вниз'] += 1
    по[b.symbol].конец.push(стало / было)
  }
}

const медиана = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }
console.log(`партий: ${ПАРТИЙ}, ходов в каждой: ${ХОДОВ}\n`)
console.log('бумага   класс      старт     медиана в конце   выросла   упала')
const беды: string[] = []
for (const b of бумаги) {
  const и = по[b.symbol]
  const к = медиана(и.конец)
  const доля = Math.round((и.вверх / ПАРТИЙ) * 100)
  console.log(
    `${b.symbol.padEnd(8)} ${классБумаги(b).padEnd(9)} ${String(b.price).padStart(8)} ` +
      `${(к * 100).toFixed(0).padStart(12)}%   ${String(доля).padStart(5)}%  ${String(100 - доля).padStart(5)}%`,
  )
  /*
   * 🔴 МЕМКОИН УБИВАЮТ ДВЕ РАЗНЫЕ ВЕЩИ, И МЕРИТЬ ИХ НАДО ПОРОЗНЬ.
   *
   * Здесь проверяется только ход цены — он обязан тянуть монету ВНИЗ, и
   * тянет: медиана в конце партии около пятой части от старта. А до полного
   * нуля её доводит отдельная механика — шесть карточек обнуления («кошелёк
   * создателей опустел», «биржу сняли с торгов»). По жизни почти до нуля
   * доходят 85–90% таких монет, но это цифра ПО ОБОИМ путям сразу, и
   * требовать её от одного лишь хода цены значило бы подкрутить снос до
   * неправдоподобного.
   */
  if (классБумаги(b) === 'мемкоин' && к > 0.45)
    беды.push(`${b.symbol}: мемкоин в конце стоит ${(к * 100).toFixed(0)}% от старта — снос слишком слабый`)
  if (классБумаги(b) === 'мемкоин' && доля > 35)
    беды.push(`${b.symbol}: мемкоин вырос в ${доля}% партий — это уже не ловушка`)
  if (классБумаги(b) === 'фишка' && (к < 1.02 || доля < 55))
    беды.push(`${b.symbol}: голубая фишка не растёт (${(к * 100).toFixed(0)}%, вверх в ${доля}%) — по замеру это +9% годовых`)
  if (классБумаги(b) === 'сукук' && (к > 1.6 || к < 0.9)) беды.push(`${b.symbol}: сукук ушёл в ${(к * 100).toFixed(0)}% — он должен быть спокойным`)
  if (к > 6 || к < 0.02) беды.push(`${b.symbol}: цена уехала в ${(к * 100).toFixed(0)}% от старта — вилка ничего не держит`)
}
for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ ДВИЖЕНИЕ ЦЕНЫ НЕПРАВДОПОДОБНО' : '\n✅ ЦЕНА ХОДИТ ПРАВДОПОДОБНО')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
