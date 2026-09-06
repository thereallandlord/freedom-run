/**
 * Объект дорожает сам — проверяем, что это правда и что это видно.
 *
 * 🔴 ЗАЧЕМ. Замер 06.09: бизнесы в колоде дают 38% годовых на свои деньги,
 * недвижимость 19%, худшие объекты 0–5% — однушка в Бутово окупалась 2417
 * месяцев. Боты не покупали 30 карточек из 83 и были правы: игра показывала
 * только половину правды. Московскую квартиру берут не ради потока, а потому
 * что дорожает она сама, — и пока роста не было, половина колоды состояла из
 * заведомо плохих сделок.
 */
import { createTable } from './table'
import { applyEvent } from './applyEvent'
import { РОСТ_ЦЕНЫ_ГОД, множительРостаЗаМесяц } from './категории'
import decks from '../data/decks_ru.json'
import type { Ledger } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

// 1. У каждой категории объектов в колоде должна быть ставка роста.
{
  const кат = new Set<string>()
  for (const k of ['SMALL_DEALS_RU', 'BIG_DEALS_RU'] as const)
    for (const c of (decks as never as Record<string, { kind?: string; category?: string }[]>)[k])
      if (c.kind === 'realEstate' && c.category) кат.add(c.category)
  const без = [...кат].filter((k) => РОСТ_ЦЕНЫ_ГОД[k] == null)
  п('у каждой категории объектов задан рост цены', без.length === 0, `без ставки: ${без.join(', ')}`)
  п('Бали не растёт — там земля в аренде и стоимость тает', РОСТ_ЦЕНЫ_ГОД.aptBALI === 0)
}

// 2. Живьём: объект дорожает каждую зарплату, а вилла на Бали — дешевеет.
{
  const пустой = createTable({
    seed: 11,
    deckTheme: 'ru',
    seats: [{ id: 'a', name: 'Камиль', professionId: 'engineer', dreamSpace: 2 }],
  } as never)
  let l: Ledger = {
    ...пустой.seats[0].ledger,
    realEstate: [
      {
        id: 'msk', name: 'Однушка в Бутово', cost: 14_500_000, downPayment: 2_900_000,
        mortgage: 11_600_000, cashFlow: 4_000, category: 'aptMSK',
        value: 14_500_000, стоимостьПриПокупке: 14_500_000,
      },
      {
        id: 'bali', name: 'Вилла в Убуде', cost: 18_500_000, downPayment: 3_700_000,
        mortgage: 14_800_000, cashFlow: 30_000, category: 'aptBALI',
        value: 18_500_000, стоимостьПриПокупке: 18_500_000,
        арендаЗемли: { всегоЛет: 25, осталосьМес: 300 },
      },
    ],
  }
  const было = { msk: 14_500_000, bali: 18_500_000 }
  const ЗАРПЛАТ = 23 // столько их и проходит за партию — замерено ботометром
  for (let i = 0; i < ЗАРПЛАТ; i++) l = applyEvent(l, { type: 'PAYCHECK' } as never)
  const msk = l.realEstate.find((a) => a.id === 'msk')!
  const bali = l.realEstate.find((a) => a.id === 'bali')!
  const ждём = Math.round(было.msk * Math.pow(множительРостаЗаМесяц('aptMSK'), ЗАРПЛАТ))
  п('московская квартира подорожала', (msk.value ?? 0) > было.msk, `было ${было.msk}, стало ${msk.value}`)
  п('рост совпал со ставкой категории', Math.abs((msk.value ?? 0) - ждём) / ждём < 0.01,
    `ждали ${ждём}, вышло ${msk.value}`)
  п('вилла на Бали подешевела — срок аренды земли тает', (bali.value ?? 0) < было.bali,
    `было ${было.bali}, стало ${bali.value}`)
  const рост = Math.round((((msk.value ?? 0) - было.msk) / было.msk) * 100)
  п('за партию рост заметен человеку (больше 10%)', рост >= 10, `${рост}%`)
  console.log(
    `  за ${ЗАРПЛАТ} зарплат: Бутово ${рост > 0 ? '+' : ''}${рост}%, ` +
      `вилла на Бали ${Math.round((((bali.value ?? 0) - было.bali) / было.bali) * 100)}%`,
  )
}

// 3. Из объекта должен быть выход: одной карточки продажи на категорию мало.
{
  const рын = (decks as never as Record<string, { kind?: string; category?: string }[]>).MARKET_CARDS_RU
  const продажи = рын.filter((c) => c.kind === 'sellOffer')
  const кат = new Set<string>()
  for (const k of ['SMALL_DEALS_RU', 'BIG_DEALS_RU'] as const)
    for (const c of (decks as never as Record<string, { kind?: string; category?: string }[]>)[k])
      if (c.kind === 'realEstate' && c.category) кат.add(c.category)
  const мало = [...кат].filter((k) => продажи.filter((c) => c.category === k).length < 2)
  п('у каждой категории объектов не меньше двух выходов', мало.length === 0,
    `по одному выходу: ${мало.join(', ')}`)
  console.log(`  карточек продажи: ${продажи.length} из ${рын.length} рыночных`)
}

console.log(беды.length ? '\n❌ РОСТ ЦЕНЫ:\n  ' + беды.join('\n  ') : '\n✅ РОСТ ЦЕНЫ: объект дорожает, Бали тает, выход есть')
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
