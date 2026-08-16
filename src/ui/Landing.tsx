import { useState, type ReactNode } from 'react'
import { ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode } from '../engine/room'

/**
 * Стартовый экран: два больших пути — «на одном устройстве» и «онлайн».
 * Всё остальное на странице объясняет игру тому, кто пришёл по ссылке
 * и не знает, куда попал.
 */

export interface LandingProps {
  /** Код из ссылки ?room=. Есть — показываем приглашение первым экраном. */
  joinCode?: string | null
  onLocal: () => void
  onCreate: () => void
  onJoin: (code: string, role: 'player' | 'spectator') => void
  /** Открыть правила. Нет обработчика — кнопки правил не будет. */
  onRules?: () => void
  /** Слот в шапке — сюда встаёт переключатель темы. */
  topRight?: ReactNode
}

/**
 * Картинка карты с запасным вариантом: файлы лежат в /cards, но на чужом
 * хостинге их может не оказаться, а пустая рамка на первом экране — плохо.
 */
function Art({
  src,
  emoji,
  className = '',
  gradient,
}: {
  src: string
  emoji: string
  className?: string
  gradient: string
}) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: gradient }}>
      {!broken ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center text-4xl">{emoji}</div>
      )}
    </div>
  )
}

const STEPS: { icon: string; title: string; text: string }[] = [
  {
    icon: '💼',
    title: 'Профессия и расходы',
    text: 'Зарплата, ипотека, кредиты, дети. Всё как в жизни — и всё против вас.',
  },
  {
    icon: '🏠',
    title: 'Покупайте активы',
    text: 'Квартиры, бизнес, доли, акции. Каждый актив приносит доход каждый месяц.',
  },
  {
    icon: '🕊️',
    title: 'Выход из Круга',
    text: 'Пассивный доход перерос расходы — работа больше не нужна. Дальше мечта.',
  },
]

export function Landing({ joinCode, onLocal, onCreate, onJoin, onRules, topRight }: LandingProps) {
  const [code, setCode] = useState('')
  const typed = normalizeRoomCode(code)
  const canJoinTyped = isValidRoomCode(typed)

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6">
        {/* ─── Шапка ─── */}
        <header className="mb-8 flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-accent text-lg text-accent-ink shadow-glow">
            🕊️
          </div>
          <div className="font-black tracking-tight">Freedom Run</div>
          <div className="ml-auto flex items-center gap-2">{topRight}</div>
        </header>

        {/* ─── Приглашение по ссылке ─── */}
        {joinCode && (
          <section className="pop-in panel mb-8 overflow-hidden rounded-2xl">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Вас пригласили в игру
                </div>
                <div className="mt-1.5 flex items-baseline gap-3">
                  <span className="tabnum text-3xl font-black tracking-[0.2em] sm:text-4xl">
                    {joinCode}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Комната ждёт. Займите место за столом или смотрите со стороны.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onJoin(joinCode, 'player')}
                  className="btn-primary flex-1 px-5 py-3 text-base sm:flex-none"
                >
                  Играть
                </button>
                <button
                  onClick={() => onJoin(joinCode, 'spectator')}
                  className="btn-ghost flex-1 px-4 py-3 sm:flex-none"
                  title="Войти зрителем — без места за столом"
                >
                  👀 Смотреть
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ─── Герой ─── */}
        <section className="mb-9 text-center">
          <h1 className="text-[2.1rem] font-black leading-[1.05] tracking-tight sm:text-6xl">
            Вырвись из
            <br className="sm:hidden" />
            <span className="text-accent"> денежной рутины</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-lg">
            Настольная игра про личные финансы. Нарастите пассивный доход выше расходов —
            и мчитесь к мечте. Партия на 2–10 человек, с телефона тоже.
          </p>
        </section>

        {/* ─── Два пути ─── */}
        <section className="mb-4 grid gap-4 sm:grid-cols-2">
          <button
            onClick={onLocal}
            className="panel group relative overflow-hidden rounded-2xl p-0 text-left transition duration-150 hover:-translate-y-0.5 hover:border-accent/60 active:scale-[0.995]"
          >
            <Art
              src="/cards/big-partner-start-team.webp"
              emoji="🎲"
              className="h-36 w-full sm:h-44"
              gradient="linear-gradient(135deg,#34d399,#0ea5e9)"
            />
            <div className="p-5">
              <div className="text-lg font-bold">На одном устройстве</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Все за одним экраном, ход передаётся по кругу. Пустые места закроют боты.
                Ничего настраивать не нужно.
              </p>
              <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
                Начать партию
                <span className="transition duration-150 group-hover:translate-x-0.5">→</span>
              </div>
            </div>
          </button>

          <button
            onClick={onCreate}
            className="panel group relative overflow-hidden rounded-2xl p-0 text-left transition duration-150 hover:-translate-y-0.5 hover:border-accent/60 active:scale-[0.995]"
          >
            <Art
              src="/cards/dd-telefon-rebenku.webp"
              emoji="📱"
              className="h-36 w-full sm:h-44"
              gradient="linear-gradient(135deg,#a78bfa,#f472b6)"
            />
            <div className="p-5">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">Играть онлайн</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                  до 10
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Комната с кодом и ссылкой. Каждый со своего телефона, ссылка на созвон —
                внутри. Пароль не нужен.
              </p>
              <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
                Создать комнату
                <span className="transition duration-150 group-hover:translate-x-0.5">→</span>
              </div>
            </div>
          </button>
        </section>

        {/* ─── Вход по коду ─── */}
        {!joinCode && (
          <section className="panel mb-12 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="shrink-0 text-sm font-semibold">Вам дали код комнаты?</div>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canJoinTyped && onJoin(typed, 'player')}
                /* Точки, а не тире: при таком межбуквенном интервале тире сливаются в линию. */
                placeholder={'•'.repeat(ROOM_CODE_LENGTH)}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={40}
                aria-label="Код комнаты"
                className="tabnum w-full rounded-xl border border-line bg-panel2 px-4 py-3 text-center text-xl font-bold uppercase tracking-[0.35em] outline-none transition duration-150 placeholder:tracking-[0.2em] placeholder:text-muted focus:border-accent sm:w-56 sm:text-left"
              />
              <button
                disabled={!canJoinTyped}
                onClick={() => onJoin(typed, 'player')}
                className="btn-primary shrink-0 px-5 py-3"
              >
                Войти
              </button>
            </div>
            {typed.length > 0 && !canJoinTyped && (
              <p className="mt-2 text-xs text-muted">
                Код — {ROOM_CODE_LENGTH} символов. Можно вставить и целую ссылку.
              </p>
            )}
          </section>
        )}

        {/* ─── Что это за игра ─── */}
        <section>
          <h2 className="mb-4 text-center text-xl font-black tracking-tight sm:text-2xl">
            Что это за игра
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="panel rounded-2xl p-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-lg">
                    {s.icon}
                  </span>
                  <span className="tabnum text-xs font-bold text-muted">
                    ШАГ {i + 1}
                  </span>
                </div>
                <div className="font-bold">{s.title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
              </div>
            ))}
          </div>

          <div className="panel mt-3 overflow-hidden rounded-2xl sm:flex">
            <Art
              src="/cards/dream-world-trip.webp"
              emoji="✨"
              className="h-32 w-full sm:h-auto sm:w-56 sm:shrink-0"
              gradient="linear-gradient(135deg,#fbbf24,#f97316)"
            />
            <div className="p-5">
              <div className="font-bold">Три колоды на выбор</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                <b className="font-semibold text-ink">Россия · халяль</b> — рубли,
                российские зарплаты и объекты, рассрочка и партнёрство вместо процентных
                кредитов. Плюс классическая и «Уругвай» — доллары и оригинальные карты.
              </p>
              {onRules && (
                <button
                  onClick={onRules}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition duration-150 hover:gap-2.5"
                >
                  Читать правила →
                </button>
              )}
            </div>
          </div>
        </section>

        <p className="mt-10 text-center text-xs text-muted">
          Партия идёт 1–2 часа. Прогресс сохраняется — можно закрыть вкладку и вернуться.
        </p>
      </div>
    </div>
  )
}
