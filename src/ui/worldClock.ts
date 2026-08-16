/**
 * Часы мировых событий.
 *
 * Сам таймер живёт в useGame: раз в WORLD_EVENT_MIN минут реального времени
 * рынок двигается сам. Показывать остаток надо в другом углу экрана, поэтому
 * срок следующего события лежит здесь — таймер сюда пишет, индикатор читает.
 *
 * Состояние партии это не трогает: в журнал событий ничего не попадает,
 * игра остаётся воспроизводимой.
 */

let deadline = 0
const listeners = new Set<() => void>()

/** Таймер сообщает: следующее мировое событие ждём через `ms` миллисекунд. */
export function scheduleWorldEvent(ms: number) {
  deadline = Date.now() + ms
  for (const notify of listeners) notify()
}

/** Срок следующего события (миллисекунды эпохи). Ноль — таймер ещё не заведён. */
export function worldEventDeadline() {
  return deadline
}

export function subscribeWorldClock(notify: () => void) {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}
