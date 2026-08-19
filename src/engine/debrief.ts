/**
 * Разбор партии — личная обратная связь каждому игроку.
 *
 * Идея Анвара (созвон 19.08, обсуждение с Дениславом): после игры человек
 * должен получить не только счёт, а понимание — как он играл, что его
 * тормозило и куда усиливаться в жизни. Игра для того и сделана, чтобы
 * показывать модель на своих деньгах; разбор превращает партию в вывод.
 *
 * 🔴 Всё считается ПО ФАКТАМ партии: журнал ходов и конечное состояние.
 * Никаких «наверное» и придуманных сумм — если данных нет, пункта нет.
 * Каждый пункт обязан отвечать на вопрос «откуда это число».
 */
import type { Seat, Table } from './types'
import type { TableEvent } from './events'
import {
  RIBA,
  fastTrackIncome,
  freedomIncome,
  monthlyCashFlow,
  netWorth,
  totalExpenses,
  totalIncome,
} from './ledger'
import { GL_PACKAGES, glStructureIncome, glTotalIncome } from './greenleaf'

export interface DebriefPoint {
  /** Короткий заголовок: что произошло. */
  title: string
  /** Разбор: откуда число и что оно значит. */
  text: string
  /** Хорошо это, плохо или просто факт. */
  tone: 'good' | 'bad' | 'neutral'
}

export interface Debrief {
  seatId: string
  name: string
  /** Одна фраза о том, как прошла партия. */
  headline: string
  points: DebriefPoint[]
  /** Что делать дальше — в жизни, а не в игре. */
  next: string[]
}

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

/** Сколько ходов сделал игрок и что он с ними сделал. */
function countActions(events: TableEvent[], seatId: string) {
  let rolls = 0
  let bought = 0
  let passed = 0
  let tookCredit = 0
  let creditSum = 0
  let borrowed = 0
  for (const e of events) {
    const mine = !('by' in e) || !e.by || e.by === seatId
    if (!mine) continue
    if (e.type === 'ROLL') rolls++
    if (e.type === 'BUY_DEAL' || e.type === 'BUY_STOCK_SHARES') bought++
    if (e.type === 'PASS_CARD') passed++
    if (e.type === 'TAKE_RIBA') {
      tookCredit++
      creditSum += e.amount
    }
    if (e.type === 'ASK_LOAN') borrowed++
  }
  return { rolls, bought, passed, tookCredit, creditSum, borrowed }
}

/**
 * Разбор для одного игрока.
 *
 * Порядок пунктов — от того, что сильнее всего повлияло на результат, к
 * мелочам: человек читает сверху вниз и первым видит главное.
 */
export function buildDebrief(table: Table, events: TableEvent[], seat: Seat): Debrief {
  const l = seat.ledger
  const acts = countActions(events, seat.id)
  const points: DebriefPoint[] = []
  const next: string[] = []

  /*
   * 🔴 На Полосе свободы деньги считаются ДРУГИМ способом: там нет зарплаты и
   * расходов Круга, там доход с вложений. Без этой развилки разбор выдавал
   * победителю «без вас работает 0 ₽» — то есть поздравлял и тут же обвинял.
   */
  const onFast = seat.track === 'fast'
  const income = onFast ? fastTrackIncome(l) : totalIncome(l, table.market.flow)
  const expenses = totalExpenses(l)
  const passive = onFast ? fastTrackIncome(l) : freedomIncome(l, table.market.flow)
  const share = onFast ? 100 : expenses > 0 ? Math.round((passive / expenses) * 100) : 0

  // ─── Главное: сколько дохода работает без тебя ───
  points.push({
    title: onFast
      ? `На Полосе свободы: ${money(passive)} в месяц`
      : `Без вас работает ${money(passive)} в месяц`,
    text: onFast
      ? 'Круг пройден: доход перестал зависеть от того, ходите вы на работу или нет. Дальше игра идёт про мечту, а не про выживание.'
      : passive <= 0
        ? 'Ни один рубль дохода не приходит без вашего участия: перестанете ходить — деньги закончатся. Это и есть то положение, из которого игра предлагает выбраться.'
        : `Расходы — ${money(expenses)}. Свобода наступает, когда доход без вас перерастает их: вы прошли ${share}% пути.`,
    tone: onFast || share >= 100 ? 'good' : passive <= 0 ? 'bad' : 'neutral',
  })

  // ─── Кредит: сколько он реально стоил ───
  if (acts.tookCredit > 0) {
    const paid = l.expenses.ribaPayment * 12
    points.push({
      title: `Кредит: взяли ${money(acts.creditSum)}`,
      text:
        `Платёж по нему — ${money(l.expenses.ribaPayment)} в месяц, это ${money(paid)} в год, и тело долга ими не гасится. ` +
        'Дело даже не в самой сумме: пока долг открыт, любая неприятность бьёт больнее, а хорошие возможности проходят мимо — на них просто не остаётся денег. В жизни это работает так же.',
      tone: 'bad',
    })
    next.push(
      'Закрыть процентный долг раньше, чем начинать новое. Свобода манёвра дороже, чем скорость на старте.',
    )
  } else if (l.liabilities.retailDebt + l.liabilities.homeMortgage > 0) {
    points.push({
      title: 'Обошлись без процентного долга',
      text: 'Всё крупное взято рассрочкой: наценка известна заранее и не растёт со временем. Это самый спокойный способ покупать большое.',
      tone: 'good',
    })
  }

  // ─── Пропущенные возможности ───
  if (acts.passed > 0) {
    points.push({
      title: `Пропустили сделок: ${acts.passed}`,
      text:
        acts.bought === 0
          ? 'И не купили ни одной. Осторожность бережёт деньги, но не создаёт доход: он появляется только у того, кто входит.'
          : `Купили ${acts.bought}. Часть пропусков — правильная осторожность, часть — нехватка денег в нужный момент; именно её и лечит доход, который приходит без вас.`,
      tone: acts.bought === 0 ? 'bad' : 'neutral',
    })
  }

  // ─── Партнёрский бизнес: главный разговор ───
  const gl = l.businesses.find((b) => b.gl)?.gl
  if (!gl) {
    points.push({
      title: 'Партнёрский бизнес вы не взяли',
      text:
        `Вход в него — ${money(GL_PACKAGES[0].price)}, дешевле любой недвижимости в игре, а доход растёт сам по мере роста структуры. ` +
        'Остальные активы стоят миллионы и растут только вместе с рынком.',
      tone: 'bad',
    })
    next.push(
      'Посмотреть партнёрский бизнес всерьёз: это единственный в игре актив, где вход измеряется десятками тысяч, а доход не упирается в потолок.',
    )
  } else {
    const pkg = GL_PACKAGES.find((p) => p.id === gl.packageId)
    points.push({
      title: `Партнёрский бизнес: ${pkg?.name ?? ''} → ${money(glTotalIncome(gl))} в месяц`,
      text:
        `Структура выросла с ${money(GL_PACKAGES[0].price ? glStructureIncome({ ...gl, baseFlow: 1700 }) : 0)} на старте. ` +
        (gl.triangle
          ? 'Три кабинета вы открыли — это та самая треть сверху, которая копится каждый месяц.'
          : 'Три кабинета вы не открывали: это примерно на треть больше дохода при том же объёме работы.'),
      tone: 'good',
    })
    if (!gl.triangle) {
      next.push('Открыть ещё два кабинета: та же работа, доход примерно на треть выше.')
    }
    if (gl.packageId !== 'crown') {
      next.push(
        'Поднять пакет до Короны: ставка выше на каждом объёме, а разницу доплачивают один раз.',
      )
    }
  }

  // ─── Расходы и образ жизни (в Круге; на Полосе они уже не про это) ───
  if (!onFast && l.expenses.otherExpenses > 0 && income > 0) {
    const pct = Math.round((expenses / income) * 100)
    points.push({
      title: `Расходы съедали ${pct}% дохода`,
      text:
        pct >= 80
          ? 'Почти всё, что приходило, тут же уходило. Пока разрыв между доходом и расходами такой узкий, копить не из чего — и любая неожиданность становится долгом.'
          : 'Разрыв между доходом и расходами — это и есть скорость, с которой можно покупать активы.',
      tone: pct >= 80 ? 'bad' : 'neutral',
    })
  }

  // ─── Итог ───
  const headline =
    seat.track === 'fast'
      ? 'Вы вышли из Круга — доход без вас перерос расходы.'
      : passive <= 0
        ? 'Партия прошла на зарплате: доход целиком зависел от вас.'
        : `Вы прошли ${share}% пути к свободе.`

  if (next.length === 0) {
    next.push('Продолжать то же самое: выбранная стратегия работает.')
  }

  return { seatId: seat.id, name: seat.name, headline, points, next }
}

/** Разборы всем игрокам: свой первым, дальше остальные. */
export function buildAllDebriefs(table: Table, events: TableEvent[], meId?: string): Debrief[] {
  const list = table.seats.filter((s) => !s.isBot || table.seats.every((x) => x.isBot))
  const out = list.map((s) => buildDebrief(table, events, s))
  if (!meId) return out
  return [...out.filter((d) => d.seatId === meId), ...out.filter((d) => d.seatId !== meId)]
}

/** Кто чего добился — общая таблица к разбору. */
export function standings(table: Table): { seat: Seat; worth: number; passive: number }[] {
  return [...table.seats]
    .map((s) => ({
      seat: s,
      worth: netWorth(s.ledger),
      passive: freedomIncome(s.ledger, table.market.flow),
    }))
    .sort((a, b) => b.passive - a.passive || b.worth - a.worth)
}

export { RIBA }
