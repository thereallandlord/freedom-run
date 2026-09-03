/**
 * События обычного бизнеса: приходят по стадии и только тому, у кого бизнес есть.
 *
 * 🔴 Зачем этот замер. В колодах двенадцать обычных бизнесов и ДВЕ карточки,
 * которые их задевали, — обе про выкуп. Человек покупал кафе, и до конца партии
 * с кафе не происходило ничего, тогда как у партнёрского бизнеса событий было
 * семнадцать. Здесь проверяется, что перекос закрыт по-настоящему: карточки
 * есть, стадии расставлены, каждой стадии есть чем наполниться, суммы соразмерны
 * самому бедному объекту категории — и ни одна карточка не приходит человеку,
 * которому она не адресована.
 */
import { marketCards, bigDeals, smallDeals } from './data'
import { dealTerms } from './ledger'
import { createTable, бизнесСтадия, событиеБизнесаУместно } from './table'
import type { BizEventCard, BusinessAsset, Table } from './types'

const карты = marketCards('ru').filter((c): c is BizEventCard => c.kind === 'bizEvent')
const дела = [...bigDeals('ru'), ...smallDeals('ru')].filter((c) => c.kind === 'business')
const обычные = дела.filter((c) => (c as { category?: string }).category !== 'partnership')

console.log(`обычных бизнесов в колодах: ${обычные.length}`)
console.log(`событий обычного бизнеса:   ${карты.length}`)

const беды: string[] = []

/* 1. Каждой стадии есть чем наполниться, и радость не задавлена бедой. */
const счёт: Record<number, [number, number]> = { 1: [0, 0], 2: [0, 0], 3: [0, 0] }
for (const c of карты) {
  const радость = (c.flowPct ?? 0) > 0 || (c.cash ?? 0) > 0 || c.managerPct != null
  for (const s of c.stages ?? [1, 2, 3]) счёт[s][радость ? 0 : 1] += 1
}
for (const s of [1, 2, 3]) {
  const [р, б] = счёт[s]
  console.log(`стадия ${s}: радостей ${р}, бед ${б}`)
  if (р + б < 8) беды.push(`стадии ${s} нечем наполниться (${р + б} карточек)`)
  if (р * 2 < б) беды.push(`стадия ${s} читается как наказание: ${б} бед против ${р} радостей`)
}

/* 2. Просадка — всегда положительный модуль: движок считает 1 − dipPct/100. */
for (const c of карты) {
  if ((c.dipPct ?? 0) < 0) беды.push(`${c.id}: dipPct отрицательный — доход ВЫРАСТЕТ вместо просадки`)
  if (c.dipPct != null && !c.dipPaydays) беды.push(`${c.id}: просадка без срока`)
}

/*
 * 3. Разовые суммы — не больше двух месяцев того, что человек РЕАЛЬНО держит.
 *
 * 🔴 Считать от цифры на карточке сделки нельзя. Почти все покупают в
 * рассрочку, а платёж съедает основную часть потока: халяль-кафе обещает
 * 103 000, на руках остаётся 26 800; барбершоп обещает 39 000, на руках 8 000.
 * Замер живых партий это и показал — медиана владения 22 000, максимум 41 800.
 * Поэтому порог берётся от дохода В РАССРОЧКУ, иначе «умеренные» 50 000
 * оказываются полугодом дохода барбершопа.
 */
const держит: Record<string, number[]> = {}
for (const b of обычные) {
  const k = (b as { category?: string }).category ?? ''
  const т = dealTerms(b as never, 'business')
  ;(держит[k] ??= []).push(т.instFlow)
}
const порогПо: Record<string, number> = {}
for (const [k, v] of Object.entries(держит))
  порогПо[k] = Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 2)
console.log('\nпотолок разовой суммы по категории:', порогПо)
for (const c of карты) {
  if (c.cash == null) continue
  const виды = c.categories?.length ? c.categories : Object.keys(порогПо)
  const порог = Math.min(...виды.map((k) => порогПо[k] ?? Infinity))
  if (Math.abs(c.cash) > порог)
    беды.push(`${c.id}: разово ${c.cash} при потолке ${порог} — это месяцы дохода владельца`)
}

/* 4. Карточка, названная по виду дела, обязана иметь адресата в колодах. */
const виды = new Set(обычные.map((b) => (b as { category?: string }).category ?? ''))
for (const c of карты)
  if (c.categories?.length && !c.categories.some((k) => виды.has(k)))
    беды.push(`${c.id}: некому прийти — вида ${c.categories} в колодах нет`)

/* 5. Живая проверка стадий на настоящем столе. */
const стол: Table = createTable({
  seed: 7,
  deckTheme: 'ru',
  seats: [
    { id: 'a', name: 'А', professionId: 'engineer', dreamSpace: 3, isBot: false },
    { id: 'b', name: 'Б', professionId: 'doctor', dreamSpace: 7, isBot: false },
  ],
} as never)

/*
 * 🔴 ИДЕНТИФИКАТОР БЕРЁМ ОТ НАСТОЯЩЕЙ КАРТОЧКИ, а не выдуманный. Ремесло дела
 * (барбершоп, автомойка, типография) движок узнаёт по началу его id — по нему
 * же отбираются карточки, названные по ремеслу. С выдуманным `xbizService0`
 * ремесла нет вовсе, и проверка считала доступными только те карточки, что
 * бьют по всему рынку разом: получалось, будто владельцу одной точки нечего
 * вытянуть, хотя у настоящего барбершопа выбор шире.
 */
const бизнес = (category: string, managerPct?: number): BusinessAsset => {
  const образец = [...bigDeals('ru'), ...smallDeals('ru')].find(
    (c) => c.kind === 'business' && (c as { category?: string }).category === category,
  )
  return {
    id: `${образец?.id ?? `x${category}`}-1`,
    name: образец?.title ?? category,
    cost: 1,
    downPayment: 1,
    liability: 0,
    cashFlow: 50_000,
    category,
    managerPct,
  } as BusinessAsset
}

const с = стол.seats[0].ledger
с.businesses = []
console.log('\nбез бизнеса — стадия', бизнесСтадия(с))
const пришлоБезБизнеса = карты.filter((c) => событиеБизнесаУместно(стол, c))
if (пришлоБезБизнеса.length) беды.push(`без бизнеса пришло ${пришлоБезБизнеса.length} карточек`)

с.businesses = [бизнес('bizService')]
const ст1 = бизнесСтадия(с)
с.businesses = [бизнес('bizService', 35)]
const ст2 = бизнесСтадия(с)
с.businesses = [бизнес('bizService', 35), бизнес('bizFood', 35)]
const ст3 = бизнесСтадия(с)
/* Крупное одиночное дело — тоже сеть: «Сеть шаурмы (3 точки)» строкой одна. */
const крупный = бизнес('bizFood', 35)
крупный.cashFlow = 183_500
с.businesses = [крупный]
const стКрупный = бизнесСтадия(с)
console.log(
  `сам за прилавком → ${ст1}, управляющий → ${ст2}, две точки → ${ст3}, одно крупное → ${стКрупный}`,
)
if (ст1 !== 1 || ст2 !== 2 || ст3 !== 3) беды.push('стадии считаются не так, как обещано')
if (стКрупный !== 3) беды.push('крупное дело не считается выросшим')

/* И чужая стадия не приходит: на первом году не бывает событий сети. */
с.businesses = [бизнес('bizService')]
const чужие = карты.filter(
  (c) => событиеБизнесаУместно(стол, c) && c.stages?.length && !c.stages.includes(1),
)
if (чужие.length) беды.push(`на первом году пришло ${чужие.length} карточек чужой стадии`)
const свои = карты.filter((c) => событиеБизнесаУместно(стол, c))
console.log(`владельцу ПВЗ на первом году доступно: ${свои.length} карточек`)
if (свои.length < 8) беды.push('владельцу одной точки почти нечего вытянуть')

for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ ЕСТЬ ПРОБЛЕМЫ' : '\n✅ У ОБЫЧНОГО БИЗНЕСА ЕСТЬ ЖИЗНЬ')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
