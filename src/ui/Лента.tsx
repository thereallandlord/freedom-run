/**
 * «Что происходит»: кто из игроков что сделал.
 *
 * 🔴 Зачем. Играют часто БЕЗ созвона, каждый со своего телефона. Человек видит,
 * что у соседа изменились числа, и не понимает почему: журнал спрятан за
 * кнопкой, туда никто не смотрит. Особенно это бьёт в партии с ботом — он
 * ходит молча, и партия выглядит так, будто ничего не происходит.
 *
 * 🔴 ЖИВЁТ В ПРАВОЙ КОЛОНКЕ, А НЕ ПОВЕРХ СТОЛА (правка Камиля 27.08).
 * Плашки висели по центру внизу и накрывали кнопки карточки — «оно закрывает
 * потом эти карточки». Справа под «Что в мире» пустует место: там истории и
 * место. Заодно исчезает целый класс бед — перекрыть собой она больше ничего
 * не может.
 *
 * На телефоне правая колонка уезжает ПОД доску, и заглянуть туда мимоходом
 * нельзя. Там остаётся одна всплывающая плашка — ровно одна, не стопка.
 */
import { useEffect, useRef, useState } from 'react'
import type { Событие, Table } from '../engine/types'

/** Сколько строк держим в колонке. Больше — уже не «что происходит», а журнал. */
const В_КОЛОНКЕ = 4
/** Сколько живёт всплывающая плашка на телефоне. */
const ЖИВЁТ_МС = 5200

/** Отбираем то, что можно показать этому человеку (займы видят лишь участники). */
function мои(лента: Событие[] | undefined, meId?: string): Событие[] {
  return (лента ?? []).filter((e) => !e.кому || !meId || e.кому.includes(meId))
}

function Плашка({ e, table, вид }: { e: Событие; table: Table; вид: 'строка' | 'плашка' }) {
  const цвет = table.seats.find((s) => s.id === e.seatId)?.color
  const тон =
    e.тон === 'добро'
      ? 'border-emerald-500/45 bg-emerald-500/12'
      : e.тон === 'худо'
        ? 'border-rose-500/45 bg-rose-500/12'
        : 'border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))]'
  return (
    <div
      className={
        вид === 'строка'
          ? `flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug ${тон}`
          : `лента-плашка flex max-w-[92vw] items-center gap-2 rounded-full border px-3.5 py-2 text-[12.5px] leading-snug shadow-lg backdrop-blur ${тон}`
      }
    >
      {цвет && (
        <span
          className={`shrink-0 rounded-full ${вид === 'строка' ? 'mt-1 size-1.5' : 'size-2'}`}
          style={{ background: цвет }}
          aria-hidden
        />
      )}
      <span className="min-w-0">{e.text}</span>
    </div>
  )
}

/**
 * Список последних действий — в правую колонку.
 * Ничего не прячется по таймеру: это не всплывашка, а маленькая история.
 */
export function ЛентаКолонка({ table, meId }: { table: Table; meId?: string }) {
  const строки = мои(table.лента, meId).slice(-В_КОЛОНКЕ).reverse()
  if (!строки.length) return null
  return (
    <div aria-live="polite">
      <div className="caps mb-1 px-0.5 text-[9.5px] font-bold text-[var(--t-muted, var(--muted))]">
        Что происходит
      </div>
      <div className="flex flex-col gap-1">
        {строки.map((e) => (
          <Плашка key={e.id} e={e} table={table} вид="строка" />
        ))}
      </div>
    </div>
  )
}

/**
 * Всплывающая плашка — только на узком экране и только ОДНА.
 *
 * 🔴 ТАЙМЕР НЕ ПРИВЯЗАН К ЖИЗНИ ЭФФЕКТА. Прошлая версия ставила
 * `setTimeout` внутри эффекта с `table.лента` в зависимостях и снимала его в
 * cleanup. Стол пересобирается из журнала на КАЖДОЕ событие, то есть массив
 * ленты каждый раз новый — эффект перезапускался, cleanup гасил ещё не
 * сработавший таймер, а новый не ставился (свежих событий-то нет). Плашка
 * оставалась на экране навсегда, их набиралась стопка, и она перекрывала
 * карточку. Ровно на этих же граблях я подрывался в чате Craft с кадрами
 * анимации. Теперь у плашки есть СРОК ГОДНОСТИ, а снимает просроченное
 * отдельный часовой, заведённый один раз.
 */
export function Лента({ table, meId }: { table: Table; meId?: string }) {
  const [видимо, setВидимо] = useState<{ e: Событие; до: number } | null>(null)
  const показаны = useRef<Set<number>>(new Set())
  const первыйРаз = useRef(true)

  useEffect(() => {
    const все = мои(table.лента, meId)
    /*
     * При входе в партию (и при подъёме её из журнала) лента уже полна —
     * вываливать десяток плашек разом незачем, человек их не читал.
     */
    if (первыйРаз.current) {
      первыйРаз.current = false
      for (const e of все) показаны.current.add(e.id)
      return
    }
    const свежие = все.filter((e) => !показаны.current.has(e.id))
    if (!свежие.length) return
    for (const e of свежие) показаны.current.add(e.id)
    // Показываем ПОСЛЕДНЕЕ: если за один ход случилось три вещи, стопка не нужна.
    setВидимо({ e: свежие[свежие.length - 1], до: Date.now() + ЖИВЁТ_МС })
  }, [table.лента, meId])

  // Часовой заводится один раз и живёт до размонтирования — его никто не гасит.
  useEffect(() => {
    const t = window.setInterval(() => {
      setВидимо((было) => (было && Date.now() >= было.до ? null : было))
    }, 400)
    return () => window.clearInterval(t)
  }, [])

  if (!видимо) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[45] flex flex-col items-center px-3 lg:hidden"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
      aria-live="polite"
    >
      <Плашка e={видимо.e} table={table} вид="плашка" />
    </div>
  )
}
