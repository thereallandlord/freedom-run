/**
 * Стол, собранный не всеми странами, обязан оставаться играбельным.
 *
 * 🔴 ЗАЧЕМ. Выбор стран режет колоду, и режет неравномерно: все обычные дела
 * до 05.09 были российскими — стол «без России» оставался вообще без дел, а
 * значит и без единственного дохода, которым в этой игре выбираются из Круга.
 * Проверка ловит именно это: не «фильтр работает», а «в оставшейся колоде
 * есть чем играть».
 */
import { smallDeals, bigDeals, marketCards, setActiveMarkets, полныеКолоды } from './data'
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import { ВСЕ_РЫНКИ, РЫНКИ, нормализоватьРынки, type Рынок } from './рынки'

const беды: string[] = []
function проверка(имя: string, ок: boolean, что: string) {
  console.log(`  ${ок ? '✅' : '❌'} ${имя}: ${что}`)
  if (!ок) беды.push(`${имя} — ${что}`)
}

function срез(выбор: Рынок[] | undefined) {
  setActiveMarkets(выбор)
  const s = smallDeals('ru')
  const b = bigDeals('ru')
  const m = marketCards('ru')
  const дела = [...s, ...b].filter(
    (c) => c.kind === 'business' && (c as { category?: string }).category !== 'partnership',
  )
  const объекты = [...s, ...b].filter((c) => c.kind === 'realEstate')
  return {
    малых: s.length,
    крупных: b.length,
    дела: дела.length,
    объекты: объекты.length,
    выкупы: m.filter((c) => c.kind === 'sellOffer').length,
    гринлиф: s.some((c) => (c as { greenleaf?: boolean }).greenleaf),
  }
}

console.log('\n=== Каждая страна поодиночке ===')
for (const р of РЫНКИ) {
  const с = срез([р.код])
  console.log(
    `  ${р.имя.padEnd(18)} малых ${String(с.малых).padStart(2)} · крупных ${String(с.крупных).padStart(2)} · дел ${String(с.дела).padStart(2)} · объектов ${String(с.объекты).padStart(2)} · выкупов ${с.выкупы}`,
  )
  проверка(`${р.имя}: есть дела`, с.дела >= 1, `${с.дела}`)
  проверка(`${р.имя}: есть недвижимость`, с.объекты >= 1, `${с.объекты}`)
  проверка(`${р.имя}: партнёрский бизнес на месте`, с.гринлиф, с.гринлиф ? 'есть' : 'ПРОПАЛ')
}

console.log('\n=== Без России ===')
const безРФ = ВСЕ_РЫНКИ.filter((к) => к !== 'RU')
const б = срез(безРФ)
console.log(
  `  малых ${б.малых} · крупных ${б.крупных} · дел ${б.дела} · объектов ${б.объекты} · выкупов ${б.выкупы}`,
)
проверка('без России: дел хватает', б.дела >= 8, `${б.дела}`)
проверка('без России: крупных сделок хватает', б.крупных >= 25, `${б.крупных}`)
проверка('без России: выкуп есть', б.выкупы >= 5, `${б.выкупы}`)

console.log('\n=== Всё вместе ===')
setActiveMarkets(undefined)
const всё = срез(undefined)
console.log(`  малых ${всё.малых} · крупных ${всё.крупных} · дел ${всё.дела} · объектов ${всё.объекты}`)
проверка(
  'отметить все страны = не ограничивать',
  нормализоватьРынки(ВСЕ_РЫНКИ) === undefined,
  'полный набор не попадает в настройки',
)
проверка(
  'порядок галочек не меняет колоду',
  JSON.stringify(нормализоватьРынки(['TUR', 'RU'] as Рынок[])) ===
    JSON.stringify(нормализоватьРынки(['RU', 'TUR'] as Рынок[])),
  'список приводится к одному порядку',
)

console.log('\n=== У каждой карточки известный рынок ===')
setActiveMarkets(undefined)
const чужие = [...smallDeals('ru'), ...bigDeals('ru'), ...marketCards('ru')].filter((c) => {
  const м = (c as { рынок?: string }).рынок
  return м != null && !(ВСЕ_РЫНКИ as string[]).includes(м)
})
проверка('нет карточек с неизвестной страной', чужие.length === 0, чужие.map((c) => c.id).join(', ') || 'ни одной')

/*
 * 🔴 ГЛАВНАЯ ПРОВЕРКА: не «фильтр вернул нужный список», а «за столом НЕ
 * ВЫПАЛА» карточка выключенной страны. Колоды тасуются НОМЕРАМИ карт: поставь
 * фильтр после перемешивания — номера будут указывать в колоду другой длины,
 * список при этом останется правильным, а игрок начнёт получать чужие
 * карточки. Списком это не ловится, только живой раздачей.
 */
console.log('\n=== Живая партия без России: чужих карточек быть не должно ===')
setActiveMarkets(безРФ)
const запрещены = new Set(
  полныеКолоды('ru')
    .small.concat(полныеКолоды('ru').big as never[])
    .filter((c) => (c as { рынок?: string }).рынок === 'RU')
    .map((c) => c.id),
)
const чужиеВыпали = new Set<string>()
let ходов = 0
for (let seed = 1; seed <= 6; seed++) {
  let t = createTable({
    seed,
    deckTheme: 'ru',
    рынки: безРФ,
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      name: `Б${i}`,
      professionId: ['engineer', 'doctor', 'teacher', 'driver'][i],
      dreamSpace: [2, 13, 24, 39][i],
      isBot: true,
      botDifficulty: 'medium' as const,
    })),
  })
  let к = seed * 7919
  for (let i = 0; i < 400 && t.phase !== 'finished'; i++) {
    const p = t.pending as { card?: { id?: string } } | null
    const id = p?.card?.id
    if (id && запрещены.has(id)) чужиеВыпали.add(id)
    const ev = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
    if (!ev) break
    const до = t
    t = applyTableEvent(t, ev)
    if (t === до) {
      // Отказ движка ход не вешает — как у живого водителя ботов.
      t = applyTableEvent(до, { type: 'END_TURN' } as never)
      if (t === до) break
      continue
    }
    ходов += 1
  }
}
проверка(
  `за ${ходов} ходов не выпало ни одной российской карточки`,
  чужиеВыпали.size === 0,
  чужиеВыпали.size ? [...чужиеВыпали].join(', ') : 'ни одной',
)

setActiveMarkets(undefined)
console.log(беды.length ? '\n❌ СТОЛ БЕЗ ЧАСТИ СТРАН НЕИГРАБЕЛЕН' : '\n✅ ЛЮБОЙ НАБОР СТРАН ИГРАБЕЛЕН')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
