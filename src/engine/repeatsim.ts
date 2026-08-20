/**
 * Замер повторов: сколько РАЗНЫХ карточек человек успевает увидеть.
 *
 * Скука за столом рождается не из числа карт в колоде, а из того, сколько
 * разных он реально встретил. Запуск: npx tsx src/engine/repeatsim.ts
 */
import { applyTableEvent, createTable } from './table'
import type { Table } from './types'

const рынок: string[] = []
const гл: string[] = []

for (let партия = 0; партия < 60; партия++) {
  let t: Table = createTable({
    seed: 7000 + партия,
    deckTheme: 'ru',
    seats: [
      { id: 's1', name: 'Игрок', isBot: false, botDifficulty: 'medium', dreamSpace: 3 },
      { id: 's2', name: 'Бот', isBot: true, botDifficulty: 'medium', dreamSpace: 9 },
    ],
  } as never)

  let последняя = ''
  for (let шаг = 0; шаг < 700; шаг++) {
    if (t.phase === 'finished') break
    const место = t.seats[t.turnIndex]
    if (t.phase === 'awaitingRoll') {
      t = applyTableEvent(t, {
        type: 'ROLL', by: место.id, dice: [1 + Math.floor(Math.random() * 6)],
      } as never)
      continue
    }
    const p = t.pending as { kind?: string; card?: { id?: string; kind?: string } } | null
    if (p?.kind === 'market' && p.card?.id && p.card.id !== последняя) {
      последняя = p.card.id
      ;(p.card.kind === 'glEvent' ? гл : рынок).push(p.card.id)
    }
    if (!p) последняя = ''
    if (p?.kind === 'chooseDeal') {
      t = applyTableEvent(t, {
        type: 'CHOOSE_DEAL', by: место.id, size: Math.random() < 0.5 ? 'small' : 'big',
      } as never)
      continue
    }
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
      if (t === до) break
      continue
    }
    const до = t
    t = applyTableEvent(t, { type: 'END_TURN', by: место.id } as never)
    if (t === до) break
  }
}

function сводка(имя: string, все: string[], всегоВКолоде: number) {
  const счёт = new Map<string, number>()
  for (const id of все) счёт.set(id, (счёт.get(id) ?? 0) + 1)
  const топ = [...счёт.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  console.log(`\n█ ${имя}`)
  console.log(`  выдач всего: ${все.length}`)
  console.log(`  разных карточек встретилось: ${счёт.size} из ${всегоВКолоде}`)
  console.log(`  в среднем повторов на карточку: ${(все.length / (счёт.size || 1)).toFixed(1)}`)
  console.log(`  чаще всего: ${топ.map(([id, n]) => `${id} ×${n}`).join(', ')}`)
}

import decksRu from '../data/decks_ru.json'
const всеРынка = decksRu.MARKET_CARDS_RU as { kind: string }[]
сводка('Рынок и события', рынок, всеРынка.filter((c) => c.kind !== 'glEvent').length)
сводка('События партнёрского бизнеса', гл, всеРынка.filter((c) => c.kind === 'glEvent').length)
