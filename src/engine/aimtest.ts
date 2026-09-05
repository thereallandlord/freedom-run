/**
 * У каждого вида дела должны быть СВОИ события, и чужие прилетать не должны.
 * Проверяется тем же кодом, которым движок решает, кому карточка адресована.
 */
import { marketCards, bigDeals, smallDeals } from './data'
import { делоПодходит, бизнесСтадия } from './table'
import type { BizEventCard } from './types'

const события = marketCards('ru').filter((c): c is BizEventCard => c.kind === 'bizEvent')
const дела = [...bigDeals('ru'), ...smallDeals('ru')].filter(
  (c) => c.kind === 'business' && (c as { category?: string }).category !== 'partnership',
)

const беды: string[] = []
console.log(`событий дел: ${события.length} · дел в колоде: ${дела.length}\n`)
console.log('сколько событий может прилететь каждому делу:')
for (const b of дела) {
  const актив = {
    id: `${b.id}-1`,
    category: (b as { category?: string }).category,
  }
  const свои = события.filter((c) => делоПодходит(c, актив))
  const метка = свои.length < 6 ? '❌' : '  '
  console.log(`${метка} ${String(свои.length).padStart(2)} · ${b.title.slice(0, 46)}`)
  if (свои.length < 6) беды.push(`${b.title}: всего ${свои.length} событий`)
}

/* Ремесло не должно бить по чужому: событие про стрижку — только в барбершоп. */
const ремесленные = события.filter((c) => c.ремесло?.length)
console.log(`\nсобытий про конкретное ремесло: ${ремесленные.length}`)
for (const c of ремесленные) {
  const чужие = дела.filter((b) => {
    const рем = (b as { ремесло?: string }).ремесло
    return делоПодходит(c, { id: `${b.id}-1`, category: (b as { category?: string }).category }) &&
      (!рем || !c.ремесло!.includes(рем))
  })
  if (чужие.length)
    беды.push(`${c.id} («${c.title}») прилетает не по адресу: ${чужие.map((x) => x.title).join(', ')}`)
}

for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ СОБЫТИЯ БЬЮТ НЕ ПО АДРЕСУ' : '\n✅ У КАЖДОГО ДЕЛА ЕСТЬ СВОИ СОБЫТИЯ, ЧУЖИЕ НЕ ПРИЛЕТАЮТ')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
