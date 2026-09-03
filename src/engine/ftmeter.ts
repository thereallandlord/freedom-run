/**
 * Замер ВТОРОГО КРУГА: сколько он идёт и чем живёт.
 *
 * 🔴 ЗАЧЕМ. Камиль назвал мерку прямо: второй круг должен идти полчаса-час
 * после выхода, не дольше. Проверить это было нечем — ни один замер в
 * репозитории не смотрел, что происходит ПОСЛЕ увольнения: botmeter считает
 * партию целиком, creepsim останавливается на первом выходе. Планку свободы
 * (доход вдвое выше расходов) без такого стенда пришлось бы подбирать на глаз.
 *
 * Что печатает: на каком ходу человек увольняется, сколько ходов идёт от
 * увольнения до победы, с чем он выходит (доход, расходы, наличные, долги) и
 * из чего складывается его пассив — партнёрский бизнес, обычные дела,
 * недвижимость, бумаги.
 */
import { createTable, applyTableEvent } from './table'
import { fastBoard } from './data'
import { decideBotEvent } from './bots'
import { freedomIncome, totalExpenses, ownShareAt, RULES } from './ledger'
import type { Table, BotDifficulty, Seat } from './types'

const ПАРТИЙ = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.G || 40)
const ПОТОЛОК_ХОДОВ = 4000

const ф = (n: number) => Math.round(n).toLocaleString('ru-RU')
const медиана = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const процентиль = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))]
}

/** Из чего складывается пассивный доход — по источникам. */
function разбивкаПассива(seat: Seat, m?: Record<string, number>) {
  const l = seat.ledger
  let гл = 0
  let дела = 0
  for (const b of l.businesses) {
    const своё = ownShareAt(b, m)
    if (b.gl) гл += своё
    else if (b.managerPct) дела += своё
  }
  const недвижимость = l.realEstate.reduce((s, a) => s + ownShareAt(a, m), 0)
  const бумаги = l.stocks.reduce((s, lot) => s + lot.shares * lot.dividendPerShareMonthly, 0)
  return { гл, дела, недвижимость, бумаги }
}

type Снимок = {
  ходВыхода: number
  ходовПослеВыхода: number | null
  рубежНаХоде: number | null
  доход: number
  расходы: number
  наличные: number
  активов: number
  источники: ReturnType<typeof разбивкаПассива>
  причина: string | null
  ценаМечты: number
}

function партия(seed: number, уровень: BotDifficulty): Снимок[] {
  let t = createTable({
    seed,
    deckTheme: 'ru',
    seats: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      name: `И${i}`,
      professionId: i % 2 ? 'doctor' : 'engineer',
      // 🔴 Мечты берём НАСТОЯЩИМИ клетками поля: произвольный индекс ловил
      // не мечту, и весь разбор по цене выходил пустым.
      dreamSpace: [2, 13, 24, 39][i],
      isBot: true,
      botDifficulty: уровень,
    })),
  } as never) as Table

  const снимки = new Map<string, Снимок>()
  let к = seed
  let ход = 0

  for (let i = 0; i < ПОТОЛОК_ХОДОВ && t.phase !== 'finished'; i++) {
    const h = decideBotEvent(t, () => ((к = (к * 9301 + 49297) % 233280) / 233280))
    if (!h) break
    const до = t
    t = applyTableEvent(t, h)
    if (t === до) break
    if ((h as { type?: string }).type === 'END_TURN') ход += 1

    for (const s of t.seats) {
      // Момент увольнения: снимаем ведомость ровно тогда, когда он вышел.
      if (s.track === 'fast' && !снимки.has(s.id)) {
        снимки.set(s.id, {
          ходВыхода: ход,
          ходовПослеВыхода: null,
          рубежНаХоде: null,
          доход: freedomIncome(s.ledger, t.market.flow),
          расходы: totalExpenses(s.ledger),
          наличные: s.ledger.cash,
          активов: s.ledger.realEstate.length + s.ledger.businesses.length,
          источники: разбивкаПассива(s, t.market.flow),
          причина: null,
          ценаМечты: (() => {
            const кл = (fastBoard() as { type: string; price?: number }[])[s.dreamSpace]
            return кл && кл.type === 'dream' ? (кл.price ?? 0) : 0
          })(),
        })
      }
      const сн = снимки.get(s.id)
      if (сн && сн.рубежНаХоде === null && s.ledger.свободенС != null) сн.рубежНаХоде = ход - сн.ходВыхода
      if (сн && сн.ходовПослеВыхода === null && s.won) {
        сн.ходовПослеВыхода = ход - сн.ходВыхода
        сн.причина = s.ledger.winReason ?? 'неизвестно'
      }
    }
  }
  return [...снимки.values()]
}

const все: Снимок[] = []
for (const уровень of ['medium', 'high'] as BotDifficulty[]) {
  for (let s = 1; s <= ПАРТИЙ; s++) все.push(...партия(s * 17 + (уровень === 'high' ? 5000 : 0), уровень))
}

const дошли = все.filter((с) => с.ходовПослеВыхода !== null)
const после = дошли.map((с) => с.ходовПослеВыхода as number)
const выходы = все.map((с) => с.ходВыхода)

console.log(`планка свободы: доход ×${RULES.freedomMultiple ?? 2} от расходов`)
console.log(`увольнений: ${все.length} · из них дошли до победы: ${дошли.length}`)
console.log(`ход увольнения — медиана ${медиана(выходы)}, p90 ${процентиль(выходы, 90)}`)
console.log(
  `ходов ПОСЛЕ увольнения до победы — медиана ${медиана(после)}, p90 ${процентиль(после, 90)}`,
)
const причины = new Map<string, number>()
for (const с of дошли) причины.set(с.причина ?? '?', (причины.get(с.причина ?? '?') ?? 0) + 1)
const рубежи = все.filter((с) => с.рубежНаХоде !== null).map((с) => с.рубежНаХоде as number)
console.log(`рубеж «доход вдвое выше расходов» взяли ${рубежи.length} из ${все.length}, медиана ${медиана(рубежи)} ходов после увольнения`)
console.log('причины побед:', [...причины.entries()].map(([k, v]) => `${k}=${v}`).join(' · ') || '—')

console.log('\nв момент увольнения (медианы):')
console.log(`  доход с активов ${ф(медиана(все.map((с) => с.доход)))}/мес`)
console.log(`  расходы ${ф(медиана(все.map((с) => с.расходы)))}/мес`)
console.log(`  наличные ${ф(медиана(все.map((с) => с.наличные)))}`)
console.log(`  активов на руках ${медиана(все.map((с) => с.активов))}`)
const и = (k: keyof Снимок['источники']) => ф(медиана(все.map((с) => с.источники[k])))
console.log(
  `  из чего доход: партнёрский ${и('гл')} · дела ${и('дела')} · недвижимость ${и('недвижимость')} · бумаги ${и('бумаги')}`,
)
const доля = медиана(все.map((с) => (с.доход > 0 ? (с.источники.гл * 100) / с.доход : 0)))
console.log(`  доля партнёрского бизнеса в пассиве: ${Math.round(доля)}%`)

console.log('\nпо цене мечты — сколько ходов до покупки:')
const пороги: [number, number][] = [[0, 6e6], [6e6, 15e6], [15e6, 30e6], [30e6, 1e9]]
for (const [ло, хи] of пороги) {
  const груп = все.filter((с) => с.ценаМечты >= ло && с.ценаМечты < хи)
  const куп = груп.filter((с) => с.причина === 'dream')
  console.log(
    `  ${ф(ло)}–${хи > 1e8 ? '∞' : ф(хи)}: увольнений ${груп.length}, купили мечту ${куп.length}` +
      (куп.length ? `, медиана ${медиана(куп.map((с) => с.ходовПослеВыхода as number))} ходов` : ''),
  )
}

/*
 * 🔴 МЕРКА КАМИЛЯ, ПЕРЕВЕДЁННАЯ В ХОДЫ СТОЛА. Считаем ходы ВСЕГО стола, а не
 * одного человека: за столом ждёшь и чужие ходы тоже, и время идёт по ним.
 *
 * Живая партия 31 августа: четверо игроков, 214 бросков на всех за вечер в
 * полтора-два часа — то есть ход стола это примерно полминуты. Значит
 * «полчаса-час второго круга» = 60–120 ходов стола после увольнения.
 *
 * Ошибиться тут легко и дорого: сначала я взял ходы НА ИГРОКА и получил
 * ориентир 15–35, после чего стенд четырежды кричал «затянут» на цифрах,
 * которые на деле укладывались в мерку.
 */
const мед = медиана(после)
if (!дошли.length) console.log('\n❌ до победы не дошёл НИКТО — мечта недостижима')
else if (мед > 120) console.log(`\n⚠️ второй круг длиннее часа: ${мед} ходов стола при ориентире 60–120`)
else if (мед < 30) console.log(`\n⚠️ второй круг проскакивает быстрее получаса: ${мед} ходов стола`)
else console.log(`\n✅ второй круг укладывается в получас-час: ${мед} ходов стола`)
