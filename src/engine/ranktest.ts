/** Приходит ли закрытие ранга отдельной карточкой и не теряется ли зарплата. */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import type { Table } from './types'

let рангов = 0
let зарплатПослеРанга = 0
const пропажи: string[] = []
const примеры: string[] = []
for (let seed = 1; seed <= 30; seed++) {
  let t: Table = createTable({
    seed, deckTheme: 'ru',
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`, name: `Б${i}`,
      professionId: ['engineer', 'doctor', 'teacher', 'driver'][i],
      dreamSpace: [2, 13, 24, 39][i], isBot: true, botDifficulty: 'medium' as const,
    })),
  } as never)
  let к = seed * 7919
  let ждёмЗарплату = false
  for (let i = 0; i < 600 && t.phase !== 'finished'; i++) {
    const p = t.pending as { kind?: string; rank?: string; bonus?: number } | null
    if (p?.kind === 'glRank') {
      рангов += 1
      ждёмЗарплату = true
      if (примеры.length < 4) примеры.push(`ранг «${p.rank}», премия ${p.bonus}`)
    } else if (ждёмЗарплату) {
      if (p?.kind === 'payday') зарплатПослеРанга += 1
      else пропажи.push(`${p?.kind ?? 'нет карточки'} · фаза ${t.phase}`)
      ждёмЗарплату = false
    }
    const ev = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
    if (!ev) break
    const до = t
    t = applyTableEvent(t, ev)
    if (t === до) { t = applyTableEvent(до, { type: 'END_TURN' } as never); if (t === до) break }
  }
}
console.log(`карточек ранга показано: ${рангов}`)
console.log(`из них зарплата пришла следом: ${зарплатПослеРанга} (${рангов - зарплатПослеРанга - пропажи.length} партий кончились на самой карточке)`)
примеры.forEach((п) => console.log('  ' + п))
if (пропажи.length) { console.log('\nчто пришло вместо зарплаты:'); const c: Record<string, number> = {}; for (const п of пропажи) c[п] = (c[п] ?? 0) + 1; for (const [k, v] of Object.entries(c)) console.log(`  ${v} × ${k}`) }
/*
 * 🔴 Часть партий кончается ПРЯМО НА карточке ранга — там проверять нечего,
 * и в знаменатель они не идут. Считаем только те случаи, где партия
 * продолжилась и следующая карточка вообще была.
 */
const проверено = зарплатПослеРанга + пропажи.length
const ок = рангов > 0 && проверено > 0 && зарплатПослеРанга === проверено
console.log(ок ? '\n✅ РАНГ ОТДЕЛЬНОЙ КАРТОЧКОЙ, ЗАРПЛАТА НЕ ПОТЕРЯЛАСЬ' : '\n❌ ЧТО-ТО ТЕРЯЕТСЯ')
if (!ок) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
