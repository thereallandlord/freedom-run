/**
 * Текст карточки не обещает рассрочку, которой движок не даст.
 *
 * 🔴 11.09: «Барбершоп в Казани» писал «остаток — в рассрочку» при взносе,
 * равном цене, а «Пекарня в Уфе» и «Детский центр в Уфе» обещали рассрочку,
 * которую их доход не тянет, — движок продавал их только целиком. Игрок читает
 * одно, в окне покупки видит другое и перестаёт верить цифрам.
 */
import { полныеКолоды } from './data'
import { dealTerms } from './ledger'

const беды: string[] = []
const колоды = полныеКолоды('ru')
type Карта = { kind: string; title?: string; text?: string; flavor?: string; cost: number; downPayment: number; cashFlow: number; greenleaf?: boolean }
let проверено = 0
for (const c of [...колоды.small, ...колоды.big] as unknown as Карта[]) {
  if ((c.kind !== 'business' && c.kind !== 'realEstate') || c.greenleaf) continue
  if (!/рассроч/i.test(`${c.text ?? ''} ${c.flavor ?? ''}`)) continue
  проверено++
  const условия = dealTerms(c, c.kind === 'realEstate' ? 'realEstate' : 'business')
  if (!условия.financeable) беды.push(`${c.title}: текст обещает рассрочку, а движок продаёт только целиком`)
}
console.log(
  беды.length
    ? '\n❌ ТЕКСТ ОБЕЩАЕТ РАССРОЧКУ, КОТОРОЙ НЕТ:\n  ' + беды.join('\n  ')
    : `\n✅ ТЕКСТЫ НЕ ОБЕЩАЮТ ЛИШНЕЙ РАССРОЧКИ: карточек с рассрочкой в тексте ${проверено}, у всех она есть`,
)
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
