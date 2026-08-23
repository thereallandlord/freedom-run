/** Чистая доходность объектов малой колоды: что реально остаётся после платежа. */
import { smallDeals } from './data'
import { installmentPrice, installmentMonthly } from './ledger'

const rows = smallDeals('ru')
  .filter((c) => c.kind === 'realEstate')
  .map((c: any) => {
    const финанс = c.downPayment < c.cost
    const всего = финанс ? installmentPrice(c.cost, 'realEstate') : c.cost
    const долг = Math.max(0, всего - c.downPayment)
    const платёж = финанс ? installmentMonthly(долг, 'realEstate') : 0
    const чисто = c.cashFlow - платёж
    return { t: c.title, d: c.downPayment, gross: c.cashFlow, платёж, чисто, pct: (чисто / c.downPayment) * 100 }
  })
  .sort((a, b) => a.d - b.d)

for (const r of rows) {
  console.log(
    `${String(r.d).padStart(8)} взнос · брутто ${String(r.gross).padStart(6)} − платёж ${String(r.платёж).padStart(6)} = ${String(r.чисто).padStart(7)}/мес · ${r.pct.toFixed(1).padStart(5)}%/мес · ${r.t.slice(0, 44)}`,
  )
}
const плохие = rows.filter((r) => r.чисто <= 0)
console.log(плохие.length ? `\n❌ убыточных: ${плохие.length}` : '\n✅ убыточных нет')
const мин = Math.min(...rows.map((r) => r.pct))
const макс = Math.max(...rows.map((r) => r.pct))
console.log(`разброс доходности: ${мин.toFixed(1)}% … ${макс.toFixed(1)}% (во сколько раз: ${(макс / мин).toFixed(1)})`)
