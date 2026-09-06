/**
 * Проверка партнёрской колоды после разбора.
 *
 * 🔴 ЗАЧЕМ. Три поломки жили в колоде месяцами и ни один тест их не видел:
 * последствие поездки требовало саму поездку, но выпадало на стадии, где
 * поездки ещё не бывает; в карман партнёрский бизнес не лез никогда, поэтому
 * читался как беспроигрышный; а объём в пяти карточках был написан не по
 * сетке «один человек = 275» и тихо ломал единицу измерения.
 */
import { createTable, applyTableEvent } from './table'
import { decideBotEvent } from './bots'
import type { Table } from './types'
import decks from '../data/decks_ru.json'

const gl = (decks as any).MARKET_CARDS_RU.filter((c: any) => String(c.id).startsWith('gl-'))
let плохо = 0
const провал = (м: string) => {
  console.log('  ✗ ' + м)
  плохо++
}

// 1. Карточка-последствие не может выпадать раньше своей причины.
for (const c of gl) {
  if (!c.требуетПромо) continue
  const источник = gl.find((x: any) => x.promo === c.требуетПромо)
  if (!источник) { провал(`${c.id}: промо «${c.требуетПромо}» не выдаёт ни одна карточка`); continue }
  const рано = (c.stages ?? [1, 2, 3]).filter((s: number) => !(источник.stages ?? []).includes(s) && s < Math.min(...источник.stages))
  if (рано.length) провал(`${c.id}: выпадает на стадии ${рано.join(',')}, а «${источник.id}» — только с ${Math.min(...источник.stages)}`)
}

// 2. Объём измеряется людьми: один человек = 275. Дробных людей не бывает.
for (const c of gl) {
  for (const поле of ['pvLeft', 'pvRight', 'mentorPv', 'потеряЛюдей']) {
    const v = c[поле]
    if (v != null && v % 275 !== 0) провал(`${c.id}.${поле} = ${v} — это ${(v / 275).toFixed(2)} человека`)
  }
}

// 3. У беды должны быть зубы: деньги из кармана и безвозвратная потеря людей.
const беды = gl.filter((c: any) => c.dipPct || c.freezePaydays || c.тратаДенег || c.потеряЛюдей)
if (беды.length / gl.length < 0.25) провал(`бед всего ${беды.length} из ${gl.length} — партнёрский бизнес выглядит беспроигрышным`)
if (!gl.some((c: any) => c.тратаДенег)) провал('ни одна карточка не стоит живых денег')
if (!gl.some((c: any) => c.потеряЛюдей)) провал('ни одна карточка не отнимает людей навсегда')

// 4. У каждой стадии должно быть чем играть.
for (const s of [1, 2, 3]) {
  const n = gl.filter((c: any) => (c.stages ?? [1, 2, 3]).includes(s)).length
  if (n < 8) провал(`на стадии ${s} доступно всего ${n} карточек`)
}

// 5. Живой прогон: карточки с новыми полями реально доезжают до стола.
{
  const выпало = new Set<string>()
  let деньгиУшли = false
  let людиУшли = false
  for (let seed = 1; seed <= 40 && !(деньгиУшли && людиУшли); seed++) {
    let t: Table = createTable({
      seed,
      deckTheme: 'ru',
      seats: [0, 1, 2, 3].map((i) => ({
        id: `s${i}`,
        name: `Б${i}`,
        professionId: ['engineer', 'doctor', 'teacher', 'driver'][i],
        dreamSpace: [2, 13, 24, 39][i],
        isBot: true,
        botDifficulty: 'medium',
      })),
    } as never)
    let к = seed * 1013 + 7
    const rnd = () => ((к = (к * 9301 + 49297) % 233280) / 233280)
    for (let ход = 0; ход < 600 && t.phase !== 'finished'; ход++) {
      const ev = decideBotEvent(t, rnd)
      if (!ev) {
        t = applyTableEvent(t, { type: 'END_TURN' } as never)
        continue
      }
      t = applyTableEvent(t, ev)
      const карта = (t.pending as { card?: { id?: string } } | null)?.card
      if (карта?.id && String(карта.id).startsWith('gl-')) выпало.add(карта.id)
      /*
       * 🔴 Проверяем по тому, что видит игрок. Рыночная карточка срабатывает в
       * момент вытягивания, поэтому сравнивать состояние «до и после события»
       * бесполезно — к этому моменту всё уже случилось. А слова в ленте есть
       * ровно тогда, когда эффект реально применился.
       */
      for (const строка of t.log.slice(-6)) {
        const txt = typeof строка === 'string' ? строка : ((строка as { text?: string }).text ?? '')
        if (txt.includes('Из кармана ушло') || txt.includes('ушли в долг')) деньгиУшли = true
        if (txt.includes('Ушла часть сильной стороны') || txt.includes('Ушли и те, по кому шёл доход'))
          людиУшли = true
      }
    }
  }
  if (выпало.size < 10) провал(`за 40 партий выпало всего ${выпало.size} партнёрских карточек`)
  if (!деньгиУшли) провал('карточка с тратой ни разу не залезла в карман — поле не работает')
  if (!людиУшли) провал('карточка с потерей людей ни разу не убавила объём — поле не работает')
  console.log(
    `  прогон: выпало ${выпало.size} карточек, деньги из кармана ${деньгиУшли ? 'да' : 'НЕТ'}, потеря людей ${людиУшли ? 'да' : 'НЕТ'}`,
  )
}

// 6. Слова карточки не должны спорить с её числами: «растёт само» = рост выше разовой прибавки.
for (const c of gl) {
  const ростовые = /растут сами|идёт само|каждый месяц их прибавляется|растёт сама/i.test(c.text ?? '')
  if (ростовые && c.boostPct != null && c.growthPct != null && c.boostPct > c.growthPct)
    провал(`${c.id}: текст обещает рост, а разовая прибавка (${c.boostPct}) выше роста (${c.growthPct})`)
}

// 7. Жаргон, который за столом никто не поймёт.
const ЖАРГОН = ['перелив', 'по промоушену', 'PV', 'считается друг на друга']
for (const c of gl)
  for (const ж of ЖАРГОН)
    if ((c.text ?? '').includes(ж) || (c.title ?? '').includes(ж)) провал(`${c.id}: жаргон «${ж}» в тексте карточки`)

console.log(плохо === 0 ? `\n✅ ПАРТНЁРСКАЯ КОЛОДА: ${gl.length} карточек, бед ${беды.length}, проверки прошли` : `\n❌ ПАРТНЁРСКАЯ КОЛОДА: ${плохо} замечаний`)
if (плохо) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
