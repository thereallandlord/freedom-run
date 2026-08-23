/**
 * Плашки «что сейчас произошло».
 *
 * 🔴 Зачем. Играют часто БЕЗ созвона, каждый со своего телефона. Человек видит,
 * что у соседа изменились числа, и не понимает почему: журнал спрятан за
 * кнопкой, туда никто не смотрит. Особенно это бьёт в партии с ботом — он
 * ходит молча, и партия выглядит так, будто ничего не происходит.
 *
 * 🔴 Плашки НЕ ЛОВЯТ КЛИКИ и НЕ ПЕРЕКРЫВАЮТ карточку: они висят внизу колонки
 * с доской и уходят сами. Всё, что требует решения, живёт в карточке; лента
 * только рассказывает.
 */
import { useEffect, useRef, useState } from 'react'
import type { Событие, Table } from '../engine/types'

/** Сколько плашка висит. Меньше — не успеть прочитать, больше — копится хвост. */
const ЖИВЁТ_МС = 5200
/** Больше трёх на экране — это уже стена текста, а не подсказка. */
const МАКС_НА_ЭКРАНЕ = 3

export function Лента({ table, meId }: { table: Table; meId?: string }) {
  const [видимые, setВидимые] = useState<Событие[]>([])
  /*
   * 🔴 Помним, что уже показали, ПО НОМЕРУ. Иначе на каждой перерисовке стола
   * (а он пересобирается из журнала на каждое событие) плашки всплывали бы
   * заново — и последняя строка мигала бы весь ход.
   */
  const показаны = useRef<Set<number>>(new Set())
  const первыйРаз = useRef(true)

  useEffect(() => {
    const все = table.лента ?? []
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

    const мои = свежие.filter((e) => !e.кому || !meId || e.кому.includes(meId))
    if (!мои.length) return
    setВидимые((было) => [...было, ...мои].slice(-МАКС_НА_ЭКРАНЕ))

    const t = window.setTimeout(() => {
      setВидимые((было) => было.filter((x) => !мои.some((m) => m.id === x.id)))
    }, ЖИВЁТ_МС)
    return () => window.clearTimeout(t)
  }, [table.лента, meId])

  if (!видимые.length) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[45] flex flex-col items-center gap-1.5 px-3"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}
      aria-live="polite"
    >
      {видимые.map((e) => {
        const цвет = table.seats.find((s) => s.id === e.seatId)?.color
        return (
          <div
            key={e.id}
            className={`лента-плашка flex max-w-[min(30rem,92vw)] items-center gap-2 rounded-full border px-3.5 py-2 text-[12.5px] leading-snug shadow-lg backdrop-blur ${
              e.тон === 'добро'
                ? 'border-emerald-500/45 bg-emerald-500/12'
                : e.тон === 'худо'
                  ? 'border-rose-500/45 bg-rose-500/12'
                  : 'border-[var(--t-line,var(--line))] bg-[var(--t-panel,var(--panel))]/92'
            }`}
          >
            {цвет && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: цвет }}
                aria-hidden
              />
            )}
            <span className="min-w-0">{e.text}</span>
          </div>
        )
      })}
    </div>
  )
}
