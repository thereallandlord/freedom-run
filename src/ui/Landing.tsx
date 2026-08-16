import { useState, type ReactNode } from 'react'
import { ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode } from '../engine/room'
import { artByDeck } from './cardArt'
import { Wordmark } from './Wordmark'

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
          decoding="async"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid size-full place-items-center text-4xl">{emoji}</div>
      )}
    </div>
  )
}

/** Русское согласование: 1 карта · 2 карты · 5 карт. */
function cardsWord(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 14) return 'карт'
  switch (n % 10) {
    case 1:
      return 'карта'
    case 2:
    case 3:
    case 4:
      return 'карты'
    default:
      return 'карт'
  }
}

/** Стрелка «дальше» — одна на все кнопки. */
function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" className="size-[17px] block">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

/**
 * Колода как СТОПКА КАРТ: обложка в портретной пропорции (у настоящей карты
 * она портретная — пейзажный кадр читается как фотография, а не как колода),
 * плюс две подложки сзади. Подложки рисует CSS, лишних картинок не нужно —
 * иллюстрации карт есть только у российской колоды.
 */
function DeckStack({ src, selected }: { src: string | null; selected: boolean }) {
  return (
    <span className="relative block aspect-[3/4] w-full max-w-[172px]">
      <span
        aria-hidden
        className={`absolute inset-x-[9%] top-[5%] block h-full rounded-[11px] border border-line bg-panel2 transition duration-200 ${
          selected ? 'rotate-[5deg]' : 'rotate-[3.5deg] group-hover:rotate-[5deg]'
        }`}
      />
      <span
        aria-hidden
        className={`absolute inset-x-[4.5%] top-[2.5%] block h-full rounded-[11px] border border-line bg-panel transition duration-200 ${
          selected ? '-rotate-[3deg]' : '-rotate-[1.5deg] group-hover:-rotate-[3deg]'
        }`}
      />
      <span
        className={`absolute inset-0 block overflow-hidden rounded-[11px] border bg-panel2 transition duration-200 ${
          selected ? 'border-accent shadow-[0_10px_24px_-14px_rgb(4_124_84/0.55)]' : 'border-line'
        }`}
      >
        {src ? (
          <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <span className="block size-full bg-panel2" />
        )}
      </span>
    </span>
  )
}

const DECKS = [
  {
    id: 'ru' as const,
    name: 'Россия · халяль',
    currency: '₽',
    cards: 142,
    about: 'Наши зарплаты и объекты. Рассрочка и партнёрство вместо процентных кредитов.',
  },
  {
    id: 'offshore' as const,
    name: 'Уругвай',
    currency: '$',
    cards: 186,
    about: 'Квартиры у океана, земля и фермы. Мемкоины — для тех, кто любит риск.',
  },
  {
    id: 'classic' as const,
    name: 'Классическая',
    currency: '$',
    cards: 154,
    about: 'Оригинальные карты: кондо, франшизы, акции. Как в настольной коробке.',
  },
]

/** Иконки шагов — рисованные, а не эмодзи: эмодзи в интерфейсе выглядят заглушкой. */
const ICON_CLS = 'size-[17px] block'
const IconBriefcase = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
)
const IconHouse = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
)
const IconTrophy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={ICON_CLS}>
    <path d="M6 3h12l-1 7a5 5 0 0 1-10 0z" />
    <path d="M8 21h8M12 17v4" />
    <path d="M18 5h3v3a4 4 0 0 1-4 4M6 5H3v3a4 4 0 0 0 4 4" />
  </svg>
)

const STEPS: { Icon: () => ReactNode; title: string; text: string }[] = [
  {
    Icon: IconBriefcase,
    title: 'Профессия и расходы',
    text: 'Зарплата, ипотека, кредиты, дети. Всё как в жизни — и всё против вас.',
  },
  {
    Icon: IconHouse,
    title: 'Покупайте активы',
    text: 'Квартиры, бизнес, доли, акции. Каждый актив приносит доход каждый месяц.',
  },
  {
    Icon: IconTrophy,
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
          <Wordmark />
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

        {/* ─── Два пути. Равноправны: навязывать один режим незачем. ─── */}
        <section className="mb-3 grid gap-3 sm:grid-cols-2">
          {[
            {
              onClick: onLocal,
              title: 'На одном устройстве',
              sub: 'Все за одним экраном, пустые места закроют боты',
              tag: null as string | null,
            },
            {
              onClick: onCreate,
              title: 'Играть онлайн',
              sub: 'Комната с кодом, каждый со своего телефона',
              tag: 'до 10',
            },
          ].map((m) => (
            <button
              key={m.title}
              onClick={m.onClick}
              className="panel group flex items-center gap-3 rounded-2xl px-5 py-4 text-left transition duration-150 hover:-translate-y-0.5 hover:border-accent/60 active:scale-[0.995]"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-base font-bold sm:text-[17px]">{m.title}</span>
                  {m.tag && (
                    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent">
                      {m.tag}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{m.sub}</span>
              </span>
              <span className="ml-auto shrink-0 text-accent transition duration-150 group-hover:translate-x-0.5">
                <ArrowRight />
              </span>
            </button>
          ))}
        </section>

        {/* ─── Вход по коду: одна строка, поле под шесть символов ─── */}
        {!joinCode && (
          <section className="mb-12 flex flex-wrap items-center justify-center gap-2.5">
            <span className="text-[13px] text-muted">Есть код комнаты?</span>
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
              className="tabnum w-[8.5rem] shrink-0 rounded-xl border border-line bg-panel px-3 py-2 text-center text-[15px] font-bold uppercase tracking-[0.24em] outline-none transition duration-150 placeholder:text-muted/60 focus:border-accent"
            />
            <button
              disabled={!canJoinTyped}
              onClick={() => onJoin(typed, 'player')}
              className="btn-ghost px-4 py-2 text-[13px] disabled:opacity-45"
            >
              Войти
            </button>
            {typed.length > 0 && !canJoinTyped && (
              <span className="basis-full text-xs text-muted">
                Код — {ROOM_CODE_LENGTH} символов. Можно вставить и целую ссылку.
              </span>
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
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
                    <s.Icon />
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

          <div className="panel mt-3 rounded-2xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-accent">
              Три колоды
            </div>
            <div className="mt-1 text-lg font-bold">Один стол — три разных мира</div>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted">
              Колода решает, чем вы торгуете и в какой валюте считаете. Меняются цены,
              зарплаты и сами сделки. Выбрать можно перед началом партии.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {DECKS.map((d) => (
                <div key={d.id} className="group">
                  <DeckStack src={artByDeck(d.id)} selected={d.id === 'ru'} />
                  <div className="mt-3.5 flex items-baseline gap-2">
                    <span
                      className={`text-sm font-bold ${d.id === 'ru' ? 'text-accent' : ''}`}
                    >
                      {d.name}
                    </span>
                    <span className="tabnum text-[11px] font-semibold text-muted">
                      {d.currency} · {d.cards} {cardsWord(d.cards)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted">{d.about}</p>
                </div>
              ))}
            </div>

            {onRules && (
              <button
                onClick={onRules}
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition duration-150 hover:gap-2.5"
              >
                Читать правила <ArrowRight />
              </button>
            )}
          </div>
        </section>

        <p className="mt-10 text-center text-xs text-muted">
          Партия идёт 1–2 часа. Прогресс сохраняется — можно закрыть вкладку и вернуться.
        </p>
      </div>
    </div>
  )
}
