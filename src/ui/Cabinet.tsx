/**
 * Кабинет: сыгранные партии и разбор к каждой.
 *
 * 🔴 Зачем он вообще. Разбор считался на лету и жил до закрытия вкладки —
 * человек уходил с игры, а назавтра вспомнить, что ему сказали, было негде.
 * Теперь партия остаётся: список слева, разбор внутри.
 */
import { useEffect, useState } from 'react'
import { myGames, type SavedGame } from '../net/gamesApi'
import { currentUser, signOut } from '../net/auth'

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

function когда(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function Cabinet({
  onClose,
  поднять,
}: {
  onClose: () => void
  /**
   * Поднять незаконченную партию из журнала.
   *
   * 🔴 Ради этого кабинет и хранит журнал. Пока партия жила только в
   * браузерах игроков, комната, из которой вышли все, пропадала навсегда —
   * поднять стол было неоткуда.
   */
  поднять?: (setup: unknown, journal: unknown) => void
}) {
  const me = currentUser()
  const [games, setGames] = useState<SavedGame[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void myGames().then((g) => alive && setGames(g))
    return () => {
      alive = false
    }
  }, [])

  const shown = games?.find((g) => g.id === openId) ?? null

  return (
    <div
      className="modal-layer fixed inset-0 z-[78] grid place-items-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="pop-in panel flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="caps text-[10px] font-bold text-accent">Кабинет</div>
            <h2 className="mt-0.5 truncate text-lg font-bold leading-tight">
              {me?.name ?? 'Мои партии'}
            </h2>
            {me?.email && (
              <div className="truncate text-[12px] text-[var(--muted)]">{me.email}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {games === null && (
            <div className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-[13px] text-[var(--muted)]">
              Смотрю ваши партии…
            </div>
          )}

          {games?.length === 0 && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-4 text-[13px] leading-relaxed text-[var(--muted)]">
              Здесь появятся сыгранные партии. Сыграйте до конца — и разбор
              сохранится сюда, его можно будет открыть в любой момент.
            </div>
          )}

          {/* Разбор одной партии. Открыт — список прячем, чтобы не мельтешил. */}
          {shown ? (
            <div>
              <button
                onClick={() => setOpenId(null)}
                className="mb-3 text-[12.5px] text-accent hover:underline"
              >
                ← ко всем партиям
              </button>
              <div className="mb-2 text-[13px] font-bold">{когда(shown.finishedAt)}</div>
              <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-[var(--muted)]">
                <span>{shown.me.profession ?? '—'}</span>
                <span>ходов: {shown.turns}</span>
                <span className="tabnum">без вас {money(shown.me.passive)}/мес</span>
                {shown.me.track === 'fast' && <span className="text-accent">вышли из круга</span>}
              </div>
              {shown.me.debrief ? (
                <div className="rounded-xl border border-accent/40 bg-accent/8 px-3 py-3">
                  {shown.me.debrief.split(/\n{2,}/).map((p, i) => (
                    <p key={i} className="mb-2 text-[13px] leading-relaxed last:mb-0">
                      {p}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-[12.5px] text-[var(--muted)]">
                  Разбор к этой партии не сохранился.
                </div>
              )}
              <div className="hairline mt-3 pt-3">
                <div className="caps mb-1.5 text-[10px] font-bold text-[var(--muted)]">
                  Кто был за столом
                </div>
                <div className="text-[12.5px] text-[var(--muted)]">
                  {shown.seats.map((s) => s.name).join(' · ')}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {games?.map((g) => {
                const незакончена = !g.finishedAt
                return (
                  <div
                    key={g.id}
                    className={`rounded-xl border bg-[var(--panel-2)] ${
                      незакончена ? 'border-accent/50' : 'border-[var(--line)]'
                    }`}
                  >
                    <button
                      onClick={() => !незакончена && setOpenId(g.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">
                          {незакончена ? 'Партия не доиграна' : когда(g.finishedAt)}
                        </div>
                        <div className="truncate text-[12px] text-[var(--muted)]">
                          {g.me.profession ?? '—'} · {g.seats.length} за столом · ходов {g.turns}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tabnum text-[12.5px] font-semibold text-accent">
                          {money(g.me.passive)}
                        </div>
                        <div className="text-[10.5px] text-[var(--muted)]">без вас в месяц</div>
                      </div>
                    </button>
                    {незакончена && поднять && !!g.setup && !!g.journal && (
                      <div className="border-t border-[var(--line)] px-3 py-2">
                        <button
                          onClick={() => {
                            поднять(g.setup, g.journal)
                            onClose()
                          }}
                          className="btn-primary w-full py-2 text-[13px]"
                        >
                          Поднять партию с того же места
                        </button>
                        <p className="mt-1 text-center text-[11px] leading-snug text-[var(--muted)]">
                          Стол соберётся заново по журналу ходов. Дальше играете за одним экраном —
                          или заводите комнату и зовёте своих обратно.
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="hairline mt-3 flex items-center justify-between gap-3 pt-3">
          <button
            onClick={() => {
              signOut()
              onClose()
            }}
            className="text-[12.5px] text-[var(--muted)] hover:text-[rgb(var(--c-bad))]"
          >
            Выйти из аккаунта
          </button>
          <button onClick={onClose} className="btn-primary px-5">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
