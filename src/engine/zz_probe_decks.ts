/**
 * Придирки к колодам: доходность обеих колод и бизнесов, cost = down + mortgage,
 * дубликаты id, категории рыночных карт без единого объекта.
 */
import { smallDeals, bigDeals, marketCards } from './data'
import { installmentPrice, installmentMonthly, RULES } from './ledger'

console.log('RULES.installmentMarkup', JSON.stringify(RULES.installmentMarkup), 'term', JSON.stringify(RULES.installmentTerm), 'yieldScale', RULES.yieldScale)

type Row = {
  deck: string
  id: string
  kind: string
  title: string
  cost: number
  down: number
  mortgage: number
  gross: number
  pay: number
  net: number
  pct: number
}

const rows: Row[] = []
for (const [name, deck] of [
  ['малая', smallDeals('ru')],
  ['крупная', bigDeals('ru')],
] as const) {
  for (const c of deck as any[]) {
    if (c.kind !== 'realEstate' && c.kind !== 'business') continue
    const kind = c.kind as 'realEstate' | 'business'
    const финанс = c.downPayment < c.cost
    const всего = финанс ? installmentPrice(c.cost, kind) : c.cost
    const долг = Math.max(0, всего - c.downPayment)
    const платёж = финанс ? installmentMonthly(долг, kind) : 0
    const net = (c.cashFlow ?? 0) - платёж
    rows.push({
      deck: name,
      id: c.id,
      kind,
      title: c.title,
      cost: c.cost,
      down: c.downPayment,
      mortgage: c.mortgage ?? 0,
      gross: c.cashFlow ?? 0,
      pay: платёж,
      net,
      pct: c.downPayment > 0 ? (net / c.downPayment) * 100 : NaN,
    })
  }
}

// ── 1. cost = downPayment + mortgage ──
console.log('\n=== cost ≠ downPayment + mortgage ===')
let рассх = 0
for (const r of rows) {
  if (r.cost !== r.down + r.mortgage) {
    рассх++
    console.log(
      `  ${r.deck} ${r.id}: cost ${r.cost} ≠ ${r.down} + ${r.mortgage} = ${r.down + r.mortgage} (расхождение ${r.cost - r.down - r.mortgage})`,
    )
  }
}
console.log(рассх ? `  всего расхождений: ${рассх}` : '  ✅ сходится у всех')

// ── 2. дубликаты id по всем колодам ──
console.log('\n=== дубликаты id ===')
const все = [
  ...smallDeals('ru').map((c: any) => ['малая', c] as const),
  ...bigDeals('ru').map((c: any) => ['крупная', c] as const),
]
const поId = new Map<string, string[]>()
for (const [d, c] of все) поId.set(c.id, [...(поId.get(c.id) ?? []), d])
let дублей = 0
for (const [id, где] of поId) {
  if (где.length > 1) {
    дублей++
    console.log(`  ${id}: ${где.join(' + ')}`)
  }
}
console.log(дублей ? `  всего: ${дублей}` : '  ✅ дубликатов нет')

// ── 3. чистый поток ──
console.log('\n=== нулевой или отрицательный чистый поток ===')
const плохие = rows.filter((r) => r.net <= 0)
for (const r of плохие)
  console.log(
    `  ${r.deck} ${r.kind} ${r.id}: брутто ${r.gross} − платёж ${r.pay} = ${r.net} · взнос ${r.down} · ${r.title.slice(0, 40)}`,
  )
console.log(плохие.length ? `  всего: ${плохие.length}` : '  ✅ таких нет')

// ── 4. доходность по группам ──
console.log('\n=== доходность (чистый поток / взнос, % в месяц) ===')
for (const [g, sel] of [
  ['малая · недвижимость', rows.filter((r) => r.deck === 'малая' && r.kind === 'realEstate')],
  ['крупная · недвижимость', rows.filter((r) => r.deck === 'крупная' && r.kind === 'realEstate')],
  ['малая · бизнес', rows.filter((r) => r.deck === 'малая' && r.kind === 'business')],
  ['крупная · бизнес', rows.filter((r) => r.deck === 'крупная' && r.kind === 'business')],
] as const) {
  if (!sel.length) continue
  const p = sel.map((r) => r.pct).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
  const мин = p[0]
  const макс = p[p.length - 1]
  const мед = p[Math.floor(p.length / 2)]
  console.log(
    `${g.padEnd(24)} n=${String(sel.length).padStart(2)} · ${мин.toFixed(2)}% … ${макс.toFixed(2)}% · медиана ${мед.toFixed(2)}% · разброс ×${(макс / мин).toFixed(1)}`,
  )
  const хвост = sel.filter((r) => r.pct < мед * 0.6 || r.pct > мед * 1.8)
  for (const r of хвост)
    console.log(
      `      ⚠ ${r.pct.toFixed(2)}%  взнос ${r.down} · чисто ${r.net} · ${r.id} · ${r.title.slice(0, 40)}`,
    )
}

// ── 5. границы колод по взносу ──
console.log('\n=== граница колод по взносу (заявлено 1 000 000) ===')
for (const [name, deck] of [
  ['малая', smallDeals('ru')],
  ['крупная', bigDeals('ru')],
] as const) {
  const d = (deck as any[]).filter((c) => c.kind !== 'stock').map((c) => c.downPayment)
  console.log(`  ${name}: взнос ${Math.min(...d)} … ${Math.max(...d)} (карт ${d.length})`)
}
const малыеВыше = (smallDeals('ru') as any[]).filter((c) => c.kind !== 'stock' && c.downPayment > 1_000_000)
const крупныеНиже = (bigDeals('ru') as any[]).filter((c) => c.kind !== 'stock' && c.downPayment < 1_000_000)
for (const c of малыеВыше) console.log(`  ⚠ малая, но взнос ${c.downPayment}: ${c.id}`)
for (const c of крупныеНиже) console.log(`  ⚠ крупная, но взнос ${c.downPayment}: ${c.id}`)

// ── 6. категории рыночных карт без объектов ──
console.log('\n=== категории ===')
const катОбъектов = new Map<string, number>()
for (const [, c] of все) {
  const k = (c as any).category
  if (!k) continue
  катОбъектов.set(k, (катОбъектов.get(k) ?? 0) + 1)
}
const катРынка = new Map<string, string[]>()
for (const m of marketCards('ru') as any[]) {
  const k = m.category
  if (!k) continue
  катРынка.set(k, [...(катРынка.get(k) ?? []), m.id])
}
console.log('  категории объектов:', [...катОбъектов.entries()].map(([k, v]) => `${k}=${v}`).join(' '))
let сирот = 0
for (const [k, ids] of катРынка) {
  if (!катОбъектов.has(k)) {
    сирот += ids.length
    console.log(`  ❌ рыночная категория «${k}» — ни одного объекта. Карты: ${ids.join(', ')}`)
  }
}
console.log(сирот ? `  всего сиротских рыночных карт: ${сирот} из ${(marketCards('ru') as any[]).length}` : '  ✅ сирот нет')

// категории объектов, к которым не приходит ни одна рыночная карта — тоже плохо
for (const [k] of катОбъектов) {
  if (!катРынка.has(k)) console.log(`  ⚠ объекты категории «${k}» есть, а рыночных карт под неё нет`)
}
console.log(
  '  виды рыночных карт:',
  [...new Set((marketCards('ru') as any[]).map((m) => m.kind))].join(' '),
)
const безКатегории = (marketCards('ru') as any[]).filter((m) => !m.category)
console.log(`  рыночных карт без категории: ${безКатегории.length} (виды: ${[...new Set(безКатегории.map((m) => m.kind))].join(' ')})`)
