/**
 * Разбор партии — экран после игры.
 *
 * 🔴 Смысл не в счёте, а в выводе. Партия заканчивалась таблицей «у кого
 * сколько денег» — и на этом всё; человек уходил, не поняв, ЧТО именно он
 * сделал не так и куда идти дальше. Здесь у каждого свой разбор: своё сверху,
 * чужие — вкладками, чтобы за столом можно было обсудить вслух.
 */
import { useEffect, useState } from 'react'
import type { Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { buildAllDebriefs, standings } from '../engine/debrief'
import { money } from './PlayerPanel'
import { fetchAiDebrief } from '../net/debriefApi'
import { saveDebriefText, saveGame } from '../net/gamesApi'
import { currentUser } from '../net/auth'

export function DebriefModal({
  table,
  events,
  meId,
  onClose,
}: {
  table: Table
  events: TableEvent[]
  meId?: string
  onClose: () => void
}) {
  const all = buildAllDebriefs(table, events, meId)
  const [openId, setOpenId] = useState(all[0]?.seatId)
  /*
   * Живой разбор от модели. Пока едет — показываем посчитанный на месте, он
   * готов сразу. Не доехал (сервера нет, сеть легла) — так и остаёмся на нём:
   * человек не должен смотреть на пустой экран из-за нашей инфраструктуры.
   */
  const [ai, setAi] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const shown = all.find((d) => d.seatId === openId) ?? all[0]

  /*
   * Сохранение партии в кабинет.
   *
   * 🔴 Молча и не мешая: не вошёл — просто не сохраняем, экран работает как
   * работал. Присылают партию все игроки сразу, но ключ у неё общий, поэтому
   * в базе она одна, а к себе каждый привязывает только своё место.
   */
  const [gameId, setGameId] = useState<string | null>(null)
  useEffect(() => {
    if (!meId || !currentUser()) return
    let alive = true
    const room = new URLSearchParams(location.search).get('room')
    void saveGame(table, events, meId, room).then((id) => {
      if (alive && id) setGameId(id)
    })
    return () => {
      alive = false
    }
    // Один раз за партию: список ходов дальше не меняется.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId])

  useEffect(() => {
    const id = shown?.seatId
    if (!id || ai[id] || loading === id) return
    setLoading(id)
    let alive = true
    void fetchAiDebrief(table, events, id).then((text) => {
      if (!alive) return
      setLoading(null)
      if (!text) return
      setAi((m) => ({ ...m, [id]: text }))
      if (gameId && id === meId) void saveDebriefText(gameId, id, text)
    })
    return () => {
      alive = false
    }
  }, [shown?.seatId])

  // Разбор мог приехать раньше, чем партия успела записаться, — дошлём.
  useEffect(() => {
    if (!gameId || !meId) return
    const text = ai[meId]
    if (text) void saveDebriefText(gameId, meId, text)
  }, [gameId, meId, ai])

  const rows = standings(table)

  if (!shown) return null

  return (
    <div
      className="modal-layer fixed inset-0 z-[68] grid place-items-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="pop-in panel flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="caps text-[10px] font-bold text-accent">Разбор партии</div>
            <h2 className="mt-0.5 text-lg font-bold leading-tight">{shown.headline}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 text-[var(--muted)] hover:text-[var(--ink)]">
            ✕
          </button>
        </div>

        {/* Вкладки игроков: свой всегда первый. */}
        {all.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {all.map((d) => {
              const seat = table.seats.find((s) => s.id === d.seatId)
              const on = d.seatId === shown.seatId
              return (
                <button
                  key={d.seatId}
                  onClick={() => setOpenId(d.seatId)}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                    on
                      ? 'border-accent bg-accent/12 font-semibold'
                      : 'border-[var(--line)] text-[var(--muted)] hover:border-accent/50'
                  }`}
                >
                  <span style={{ color: seat?.color }}>●</span> {d.name}
                  {d.seatId === meId ? ' · вы' : ''}
                </button>
              )
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {/* Разбор словами модели: она видела ходы и говорит о них человеческим языком. */}
          {ai[shown.seatId] && (
            <div className="rounded-xl border border-accent/40 bg-accent/8 px-3 py-3">
              <div className="caps mb-1.5 text-[10px] font-bold text-accent">Личный разбор</div>
              {ai[shown.seatId].split(/\n{2,}/).map((para, i) => (
                <p key={i} className="mb-2 text-[13px] leading-relaxed last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          )}
          {loading === shown.seatId && !ai[shown.seatId] && (
            <div className="rounded-xl border border-[var(--line)] px-3 py-2 text-[12.5px] text-[var(--muted)]">
              Смотрю вашу партию…
            </div>
          )}

          {shown.points.map((p, i) => (
            <div
              key={i}
              className={`rounded-xl border px-3 py-2.5 ${
                p.tone === 'good'
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : p.tone === 'bad'
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-[var(--line)] bg-[var(--panel-2)]'
              }`}
            >
              <div className="text-[13.5px] font-bold leading-snug">{p.title}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">{p.text}</p>
            </div>
          ))}

          <div className="hairline mt-3 pt-3">
            <div className="caps mb-1.5 text-[10px] font-bold text-[var(--muted)]">
              Куда усиливаться
            </div>
            <ul className="space-y-1.5">
              {shown.next.map((n, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug">
                  <span className="text-accent">→</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Общая таблица: сравнение за столом — половина удовольствия. */}
          <div className="hairline mt-3 pt-3">
            <div className="caps mb-1.5 text-[10px] font-bold text-[var(--muted)]">
              Кто как сыграл
            </div>
            <div className="space-y-1">
              {rows.map((r) => (
                <div
                  key={r.seat.id}
                  className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-[12.5px] odd:bg-[var(--panel-2)]"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span style={{ color: r.seat.color }}>●</span> {r.seat.name}
                  </span>
                  <span className="tabnum shrink-0 text-[var(--muted)]">
                    без него {money(r.passive)}/мес
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button onClick={onClose} className="btn-primary mt-3 w-full">
          Понятно
        </button>
      </div>
    </div>
  )
}
