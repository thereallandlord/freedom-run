/** Доходность — считаем ЧЕРЕЗ dealTerms движка, а не своей формулой. */
import { smallDeals, bigDeals } from './data'
import { dealTerms } from './ledger'

type R = { deck: string; id: string; kind: string; down: number; cost: number; flow: number; net: number; roe: number; cap: number; title: string }
const rows: R[] = []
for (const [name, deck] of [['малая', smallDeals('ru')], ['крупная', bigDeals('ru')]] as const) {
  for (const c of deck as any[]) {
    if (c.kind !== 'realEstate' && c.kind !== 'business') continue
    const t = dealTerms(c, c.kind)
    rows.push({
      deck: name,
      id: c.id,
      kind: c.kind,
      down: c.downPayment,
      cost: c.cost,
      flow: c.cashFlow,
      net: t.instFlow,
      roe: (t.instFlow / c.downPayment) * 100,
      cap: (c.cashFlow / c.cost) * 100,
      title: c.title,
    })
  }
}

function блок(имя: string, sel: R[]) {
  if (!sel.length) return
  const roe = sel.map((r) => r.roe).sort((a, b) => a - b)
  const cap = sel.map((r) => r.cap).sort((a, b) => a - b)
  const med = (a: number[]) => a[Math.floor(a.length / 2)]
  console.log(
    `\n${имя}  n=${sel.length}\n  доход на ВЗНОС (в рассрочку): ${roe[0].toFixed(2)}% … ${roe[roe.length - 1].toFixed(2)}% · медиана ${med(roe).toFixed(2)}% · ×${(roe[roe.length - 1] / roe[0]).toFixed(1)}` +
      `\n  доход на ЦЕНУ (налом):       ${cap[0].toFixed(2)}% … ${cap[cap.length - 1].toFixed(2)}% · медиана ${med(cap).toFixed(2)}% · ×${(cap[cap.length - 1] / cap[0]).toFixed(1)}`,
  )
  for (const r of [...sel].sort((a, b) => a.roe - b.roe)) {
    console.log(
      `    ${r.roe.toFixed(2).padStart(5)}% на взнос · ${r.cap.toFixed(2).padStart(5)}% на цену · взнос ${String(r.down).padStart(8)} · чисто ${String(r.net).padStart(7)} · ${r.id.padEnd(24)} ${r.title.slice(0, 34)}`,
    )
  }
}
блок('МАЛАЯ · недвижимость', rows.filter((r) => r.deck === 'малая' && r.kind === 'realEstate'))
блок('КРУПНАЯ · недвижимость', rows.filter((r) => r.deck === 'крупная' && r.kind === 'realEstate'))
блок('МАЛАЯ · бизнес', rows.filter((r) => r.deck === 'малая' && r.kind === 'business'))
блок('КРУПНАЯ · бизнес', rows.filter((r) => r.deck === 'крупная' && r.kind === 'business'))
