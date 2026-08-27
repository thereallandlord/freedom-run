/** Сколько карточек остались без картинки — по каждой колоде и виду. */
import manifest from '../data/card-art.json'
import { smallDeals, bigDeals, marketCards, doodads } from './data'
import { WORLD_EVENTS } from './data'

const M = manifest as Record<string, Record<string, string>>
const byId = M.byId ?? {}
const byTicker = M.byTicker ?? {}
const есть = (id?: string, sym?: string) => {
  if (id && (byId[id] || byId[id.replace(/-\d+$/, '')])) return true
  if (sym && byTicker[sym]) return true
  return false
}
const темы = ['ru', 'uy', 'classic'] as const
const пусто: Record<string, string[]> = {}
let всего = 0
let без = 0
for (const тема of темы) {
  const наборы: [string, { id?: string; kind?: string; symbol?: string; title?: string }[]][] = [
    ['малые', smallDeals(тема) as never],
    ['крупные', bigDeals(тема) as never],
    ['рынок', marketCards(тема) as never],
    ['траты', doodads(тема) as never],
  ]
  for (const [имя, набор] of наборы) {
    for (const c of набор) {
      всего++
      if (!есть(c.id, c.symbol)) {
        без++
        ;(пусто[`${тема}/${имя}${c.kind ? '/' + c.kind : ''}`] ??= []).push(`${c.id} · ${c.title ?? ''}`)
      }
    }
  }
}
for (const e of WORLD_EVENTS as { id: string; title?: string }[]) {
  всего++
  if (!(M.byWorld ?? {})[e.id]) {
    без++
    ;(пусто['мир/новости'] ??= []).push(`${e.id} · ${e.title ?? ''}`)
  }
}
console.log(`всего карточек ${всего}, без картинки ${без} (${((без / всего) * 100).toFixed(0)}%)\n`)
for (const [k, v] of Object.entries(пусто).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${k}: ${v.length}`)
  for (const x of v.slice(0, 6)) console.log('    ', x.slice(0, 78))
  if (v.length > 6) console.log(`     … и ещё ${v.length - 6}`)
}
console.log(`\nв манифесте: byId ${Object.keys(byId).length}, byTicker ${Object.keys(byTicker).length}, byWorld ${Object.keys(M.byWorld ?? {}).length}`)
