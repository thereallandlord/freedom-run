/** Хватает ли кредита хоть на что-то. */
import { bigDeals, smallDeals, professionsFor } from './data'
import { createLedger, ribaLimit, dealTerms } from './ledger'

const профессии = professionsFor('ru')
const лимиты = профессии.map((p) => ({ имя: p.name, лимит: ribaLimit(createLedger(p, 'Т')) }))
лимиты.sort((a, b) => a.лимит - b.лимит)
console.log('лимит кредита по профессиям:')
for (const л of лимиты) console.log(`  ${String(л.лимит).padStart(9)} ₽ · ${л.имя}`)
const мин = лимиты[0].лимит
const макс = лимиты[лимиты.length - 1].лимит

for (const [имя, набор] of [['крупные', bigDeals('ru')], ['малые', smallDeals('ru')]] as const) {
  const сделки = (набор as never as { kind: string; title: string; cost: number; downPayment: number; cashFlow: number }[])
    .filter((c) => c.kind !== 'stock')
  const взносы = сделки.map((c) => dealTerms(c as never, c.kind === 'business' ? 'business' : 'realEstate').instDown)
  const покрытоМин = взносы.filter((в) => в <= мин).length
  const покрытоМакс = взносы.filter((в) => в <= макс).length
  console.log(
    `\n${имя} сделки (${сделки.length}): взнос от ${Math.min(...взносы).toLocaleString('ru-RU')} до ${Math.max(...взносы).toLocaleString('ru-RU')} ₽`,
  )
  console.log(`  полный кредит бедной профессии (${мин.toLocaleString('ru-RU')}) покрывает взнос: ${покрытоМин} из ${сделки.length}`)
  console.log(`  полный кредит богатой (${макс.toLocaleString('ru-RU')}) покрывает: ${покрытоМакс} из ${сделки.length}`)
}
