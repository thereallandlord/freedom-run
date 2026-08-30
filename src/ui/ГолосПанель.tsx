/**
 * Кнопка голоса и кто сейчас говорит.
 *
 * 🔴 Живёт отдельным компонентом со своим состоянием: если голос отвалится или
 * браузер откажет в микрофоне, партия не должна этого заметить. Игра про голос
 * не знает ничего.
 */
import { useEffect, useMemo, useState } from 'react'
import { голосДоступен, создатьГолос, type Голос } from '../net/voice'

export function ГолосПанель({
  комната,
  я,
}: {
  комната: string
  я: { id: string; имя: string }
}) {
  /*
   * 🔴 ОБЪЕКТ ГОЛОСА ЖИВЁТ В СОСТОЯНИИ, А НЕ В ref.
   *
   * Сначала он лежал в ref: отрисовка читала `голос.current`, а он появляется
   * только в эффекте — то есть ПОСЛЕ первой отрисовки. Кнопка «Включить голос»
   * замыкала на себе `null` и не делала ничего вовсе, молча. Поймано живой
   * проверкой: микрофон был запрещён, а сообщения об этом не появилось —
   * потому что включать никто и не пробовал.
   */
  const [г, setГ] = useState<Голос | null>(null)
  const [, перерисовать] = useState(0)
  const доступен = useMemo(() => голосДоступен(), [])

  useEffect(() => {
    if (!доступен) return
    const голос = создатьГолос(комната, я)
    setГ(голос)
    const off = голос.наИзменение(() => перерисовать((n) => n + 1))
    return () => {
      off()
      голос.выключить()
      setГ(null)
    }
    // Комнату и себя внутри партии не меняем — пересоздавать связь незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [комната, доступен])

  if (!доступен) return null
  const с = г?.состояние() ?? { включён: false, микрофонВкл: true, участники: [] }
  const ошибка = г?.ошибка() ?? null

  return (
    <div>
      <div className="caps mb-1 px-0.5 text-[9.5px] font-bold text-[var(--t-muted, var(--muted))]">
        Голос
      </div>

      {!с.включён ? (
        <button
          onClick={() => void г?.включить()}
          className="w-full rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] px-2.5 py-2 text-[12px] font-semibold transition hover:border-accent/60"
        >
          🎙 Включить голос
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <button
              onClick={() => г?.микрофон(!с.микрофонВкл)}
              className={`flex-1 rounded-lg border px-2.5 py-2 text-[12px] font-semibold transition ${
                с.микрофонВкл
                  ? 'border-emerald-500/50 bg-emerald-500/15'
                  : 'border-rose-500/50 bg-rose-500/15'
              }`}
            >
              {с.микрофонВкл ? '🎙 Микрофон' : '🔇 Выключен'}
            </button>
            <button
              onClick={() => г?.выключить()}
              className="rounded-lg border border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))] px-2.5 py-2 text-[12px] transition hover:border-rose-500/60"
              title="Выйти из голоса"
            >
              ✕
            </button>
          </div>

          {с.участники.length === 0 ? (
            <p className="px-0.5 text-[11px] leading-snug text-[var(--t-muted, var(--muted))]">
              Ждём остальных — голос включает каждый у себя.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {с.участники.map((u) => (
                <div
                  key={u.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug transition ${
                    u.говорит
                      ? 'border-emerald-500/60 bg-emerald-500/15 font-semibold'
                      : 'border-[var(--t-line,var(--line))] bg-[var(--t-glass,var(--panel-2))]'
                  }`}
                >
                  <span aria-hidden>{u.говорит ? '🔊' : u.состояние === 'слышно' ? '🎧' : '⏳'}</span>
                  <span className="min-w-0 truncate">{u.имя}</span>
                  {u.состояние === 'не вышло' && (
                    <span className="ml-auto shrink-0 text-[10.5px] text-rose-400">нет связи</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {ошибка && (
        <p className="mt-1 px-0.5 text-[11px] leading-snug text-amber-400">{ошибка}</p>
      )}
    </div>
  )
}
