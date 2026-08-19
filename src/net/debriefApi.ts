/**
 * Разбор партии словами модели.
 *
 * 🔴 Ключ от модели живёт ТОЛЬКО на сервере. Отсюда уходит выжимка партии,
 * оттуда приходит текст. Если сервер недоступен — а у части людей он может
 * быть недоступен, — игра обязана продолжать работать: показываем разбор,
 * посчитанный на месте, и ничего не ломаем.
 */
import type { Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { buildDebrief } from '../engine/debrief'
import { freedomIncome, totalExpenses, totalIncome, netWorth } from '../engine/ledger'
import { glTotalIncome } from '../engine/greenleaf'

/** Куда стучаться. Пусто — значит игра открыта не со своего сервера. */
const BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''

/**
 * Выжимка партии для модели: без внутренних идентификаторов и без всего, что
 * ей не поможет. Чем короче, тем точнее ответ.
 */
export function debriefPayload(table: Table, events: TableEvent[], seatId: string) {
  const seat = table.seats.find((s) => s.id === seatId)
  if (!seat) return null
  const l = seat.ledger

  const mine = events.filter((e) => !('by' in e) || !e.by || e.by === seatId)
  const moves: string[] = []
  for (const e of mine) {
    switch (e.type) {
      case 'BUY_DEAL':
        moves.push('купил сделку')
        break
      case 'BUY_STOCK_SHARES':
        moves.push(`купил бумаги: ${e.shares} шт`)
        break
      case 'SELL_STOCK_LOT':
        moves.push(`продал бумаги: ${e.shares} шт`)
        break
      case 'PASS_CARD':
        moves.push('прошёл мимо карточки')
        break
      case 'TAKE_RIBA':
        moves.push(`взял кредит ${e.amount} ₽`)
        break
      case 'ASK_LOAN':
        moves.push(`попросил в долг ${e.amount} ₽`)
        break
      case 'OFFER_COINVEST':
        moves.push(`позвал в долю: ${Math.round((e.share ?? 0) * 100)}%`)
        break
      case 'HIRE_MANAGER':
        moves.push('нанял управляющего в бизнес')
        break
      case 'PAYOFF_ASSET':
        moves.push('закрыл рассрочку досрочно')
        break
      case 'GL_BUY_TRIANGLE':
        moves.push('открыл ещё два кабинета партнёрского бизнеса')
        break
      case 'GL_UPGRADE':
        moves.push('поднял пакет партнёрского бизнеса')
        break
      default:
        break
    }
  }

  const gl = l.businesses.find((b) => b.gl)?.gl

  return {
    игрок: seat.name,
    профессия: l.profession?.name ?? '',
    ходов: table.turnCounter,
    вышелИзКруга: seat.track === 'fast',
    деньги: {
      наличные: Math.round(l.cash),
      зарплата: Math.round(l.salary),
      доходВсего: Math.round(totalIncome(l, table.market.flow)),
      расходы: Math.round(totalExpenses(l)),
      доходБезУчастия: Math.round(freedomIncome(l, table.market.flow)),
      капитал: Math.round(netWorth(l)),
    },
    долги: {
      кредитПодПроцент: Math.round(l.liabilities.ribaLoan),
      платёжПоКредиту: Math.round(l.expenses.ribaPayment),
      рассрочки: Math.round(
        l.liabilities.homeMortgage + l.liabilities.carLoans + l.liabilities.retailDebt,
      ),
    },
    активы: {
      недвижимость: l.realEstate.map((a) => ({
        что: a.name,
        приносит: Math.round(a.cashFlow),
        остатокДолга: Math.round(a.mortgage),
      })),
      бизнес: l.businesses.map((b) => ({
        что: b.name,
        приносит: Math.round(b.cashFlow),
        управляющий: !!b.managerPct,
      })),
      бумаги: l.stocks.map((x) => ({ бумага: x.symbol, штук: x.shares })),
    },
    партнёрскийБизнес: gl
      ? {
          пакет: gl.packageId,
          приносит: Math.round(glTotalIncome(gl)),
          триКабинета: !!gl.triangle,
        }
      : null,
    ходы: moves,
    посчитаноНаМесте: buildDebrief(table, events, seat),
  }
}

/**
 * Просим у сервера живой разбор. Не ответил — возвращаем null, и экран
 * покажет то, что посчитано на месте.
 */
export async function fetchAiDebrief(
  table: Table,
  events: TableEvent[],
  seatId: string,
): Promise<string | null> {
  const payload = debriefPayload(table, events, seatId)
  if (!payload) return null
  try {
    const ctrl = new AbortController()
    // Ждать разбор дольше половины минуты человек не станет.
    const timer = window.setTimeout(() => ctrl.abort(), 30_000)
    const res = await fetch(`${BASE}/api/debrief`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    window.clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as { text?: string }
    return data.text?.trim() || null
  } catch {
    return null
  }
}
