/**
 * Разбор в конце партии обязан НАЗЫВАТЬ сделки, а не только считать их.
 *
 * 🔴 Просьба Камиля: «добавь разбор сделок». Счётчики «купил 7, пропустил 12»
 * человеку ничего не говорят — ценят имена: «прошёл мимо пекарни за два
 * миллиона, которая приносила бы 75 тысяч».
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import { buildDebrief } from './debrief'
import type { Table, TableEvent } from './types'

let сРешениями = 0
let сПунктом = 0
let всего = 0
const примеры: string[] = []
for (let seed = 1; seed <= 12; seed++) {
  let t: Table = createTable({
    seed, deckTheme: 'ru',
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`, name: `Б${i}`,
      professionId: ['engineer', 'doctor', 'teacher', 'driver'][i],
      dreamSpace: [2, 13, 24, 39][i], isBot: true, botDifficulty: 'medium' as const,
    })),
  } as never)
  const журнал: TableEvent[] = []
  let к = seed * 7919
  for (let i = 0; i < 600 && t.phase !== 'finished'; i++) {
    const ev = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
    if (!ev) break
    const до = t
    t = applyTableEvent(t, ev)
    if (t === до) {
      const конец = { type: 'END_TURN' } as never
      t = applyTableEvent(до, конец)
      if (t === до) break
      журнал.push(конец); continue
    }
    журнал.push(ev)
  }
  for (const s of t.seats) {
    всего += 1
    if ((s.ledger.решения ?? []).length) сРешениями += 1
    const d = buildDebrief(t, журнал, s)
    const п = d.points.find((x) => x.title.startsWith('Прошёл мимо'))
    if (п) {
      сПунктом += 1
      if (примеры.length < 3) примеры.push(`${п.title} — ${п.text.slice(0, 130)}…`)
    }
  }
}
console.log(`мест разобрано: ${всего}`)
console.log(`у скольких записаны решения по сделкам: ${сРешениями}`)
console.log(`у скольких разбор назвал упущенное: ${сПунктом}`)
примеры.forEach((п) => console.log('  ' + п))
const беды: string[] = []
if (сРешениями < всего * 0.8) беды.push(`решения записаны только у ${сРешениями} из ${всего}`)
if (сПунктом < 1) беды.push('разбор ни разу не назвал упущенную находку')
for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ РАЗБОР СДЕЛОК НЕ РАБОТАЕТ' : '\n✅ РАЗБОР НАЗЫВАЕТ СДЕЛКИ ПОИМЁННО')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
