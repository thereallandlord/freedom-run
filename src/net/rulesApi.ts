/**
 * Правки хозяина игры: забрать с сервера и положить в движок.
 *
 * 🔴 ЗАБИРАЕМ ДО ПЕРВОЙ ОТРИСОВКИ. Правки меняют числа карточек, а стол
 * пересобирается из журнала ходов и берёт карты по индексу в перетасованной
 * колоде. Приди правка посреди партии — половина ходов посчиталась бы по
 * старым числам, половина по новым, и пересборка развалилась бы. Поэтому
 * загрузка одна, до того как появится любой стол.
 *
 * 🔴 СЕТЬ МОЖЕТ НЕ ОТВЕТИТЬ — И ЭТО НЕ ПОВОД НЕ ДАТЬ ПОИГРАТЬ. Не ответила за
 * полторы секунды, отдала мусор, лежит сервер — играем на числах из колод.
 * Ждать дольше нельзя: человек смотрит в пустой экран.
 */
import { установитьПравки, type Правки } from '../engine/правки'

const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''
/** Дольше ждать нечего: игра прекрасно живёт и без правок. */
const ЖДЁМ_МС = 1500

export async function загрузитьПравки(): Promise<void> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ЖДЁМ_МС)
    const res = await fetch(`${BASE}/api/rules`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return
    const d = (await res.json()) as Правки
    if (d && typeof d === 'object') установитьПравки(d)
  } catch {
    /* Молча: правок нет — играем на числах из колод. */
  }
}

/** Может ли этот человек править правила. Панель по этому решает, показывать ли поля. */
export async function могуПравить(токен?: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/can-edit`, {
      headers: токен ? { Authorization: `Bearer ${токен}` } : undefined,
    })
    if (!res.ok) return false
    return !!(await res.json())?.can
  } catch {
    return false
  }
}

export async function сохранитьПравки(правки: Правки, токен: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/rules`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${токен}` },
      body: JSON.stringify(правки),
    })
    if (res.ok) {
      установитьПравки(правки)
      return null
    }
    const d = await res.json().catch(() => ({}))
    return (d as { error?: string })?.error || `не сохранилось (${res.status})`
  } catch (e) {
    return String((e as Error)?.message || e).slice(0, 160)
  }
}
