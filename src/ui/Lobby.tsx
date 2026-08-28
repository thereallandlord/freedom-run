import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dropdown } from './Dropdown'
import { Card, CardHead, Page, Rule } from './kit'
import { Wordmark } from './Wordmark'
import {
  dreamSpaces,
  professionName,
  professionsFor,
  randomProfessionNear,
  setActiveTheme,
  setFastBoardTheme,
  type DeckTheme,
} from '../engine/data'
import {
  ROOM_COLORS,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
  callProvider,
  canStart,
  humanCount,
  isHost as roomIsHost,
  pendingDisconnects,
  type PlayerDraft,
  type RoomSettings,
  type RoomState,
} from '../engine/room'
import type { BotDifficulty } from '../engine/types'

const BOT_LABEL: Record<BotDifficulty, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  high: 'Сильный',
  unreal: 'Нереальный',
}

const THEME_LABEL: Record<DeckTheme, string> = {
  ru: 'Россия · халяль',
}

function money(n: number, rub: boolean) {
  return rub ? n.toLocaleString('ru-RU') + ' ₽' : '$' + n.toLocaleString('en-US')
}

/** Ярлык у имени игрока: .chip из дизайн-системы, ужатый под плотный ряд. */
const BADGE = 'chip px-1.5 py-0.5 text-[10px] uppercase tracking-wide'

/**
 * Списки профессий и мечт зависят от колоды, а поле Полосы свободы в движке
 * глобальное — поэтому тему переключаем прямо перед чтением списков.
 * Валюту считаем сами, не трогая RULES: правила выставит стол при старте партии.
 */
function useDeckOptions(theme: DeckTheme) {
  return useMemo(() => {
    setActiveTheme(theme)
    setFastBoardTheme(theme)
    return { professions: professionsFor(theme), dreams: dreamSpaces(), isRub: theme === 'ru' }
  }, [theme])
}

// ─── Мелкие детали интерфейса ─────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2.5 text-left transition duration-150 hover:border-accent/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-10 shrink-0 rounded-full transition duration-150 ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition duration-150 ${
            checked ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

function Chips<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-150 ${
            o.value === value
              ? 'bg-accent text-accent-ink'
              : 'border border-line bg-panel2 text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Всплывающее окно: одно на всё лобби — правка места и подтверждение выхода. */
function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="pop-in panel max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel px-5 py-3.5">
          <div className="font-bold">{title}</div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-2 ml-auto grid size-tap place-items-center rounded-lg text-muted transition duration-150 hover:bg-panel2 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="sticky bottom-0 border-t border-line bg-panel px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Одно окно настройки места ────────────────────────────────────────

export interface SeatFormProps {
  draft: PlayerDraft
  onChange: (patch: Partial<PlayerDraft>) => void
  deckTheme?: DeckTheme
  /** Цвета, уже занятые другими: их нельзя выбрать. */
  takenColors?: string[]
  /** Автофокус на имени — на экране входа он к месту, в правке места мешает. */
  autoFocusName?: boolean
}

/**
 * Имя, цвет, профессия и мечта — всё сразу, в одном окне.
 * Череда экранов на входе в комнату теряет людей, поэтому её здесь нет.
 */
export function SeatForm({
  draft,
  onChange,
  deckTheme = 'ru',
  takenColors = [],
  autoFocusName,
}: SeatFormProps) {
  const { professions, dreams, isRub } = useDeckOptions(deckTheme)

  // Пустая или чужая (из другой колоды) заготовка — подставляем валидное.
  useEffect(() => {
    const patch: Partial<PlayerDraft> = {}
    if (!professions.some((p) => p.id === draft.professionId)) {
      patch.professionId = professions[Math.floor(Math.random() * professions.length)].id
    }
    if (!dreams.some((d) => d.index === draft.dreamSpace)) {
      patch.dreamSpace = dreams[Math.floor(Math.random() * dreams.length)].index
    }
    if (Object.keys(patch).length) onChange(patch)
  }, [professions, dreams, draft.professionId, draft.dreamSpace, onChange])

  const professionOptions = useMemo(
    () =>
      professions.map((p) => ({
        value: p.id,
        label: professionName(p, 'ru'),
        // В списке — ЗАРПЛАТА (правка Камиля). Остаток — строкой ниже.
        hint: money(p.salary, isRub) + '/мес',
      })),
    [professions, isRub],
  )

  const dreamOptions = useMemo(
    () => dreams.map((d) => ({ value: d.index, label: d.name, hint: money(d.price, isRub) })),
    [dreams, isRub],
  )

  const taken = new Set(takenColors)

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
          Как вас зовут
        </label>
        <input
          value={draft.name}
          maxLength={24}
          autoFocus={autoFocusName}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Имя за столом"
          className="w-full rounded-xl border border-line bg-panel2 px-3.5 py-3 text-base outline-none transition duration-150 focus:border-accent"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
          Цвет фишки
        </label>
        <div className="flex flex-wrap gap-2">
          {ROOM_COLORS.map((c) => {
            const busy = taken.has(c.value) && draft.color !== c.value
            const active = draft.color === c.value
            return (
              <button
                key={c.value}
                type="button"
                disabled={busy}
                title={busy ? `${c.name} — занят` : c.name}
                aria-label={c.name}
                onClick={() => onChange({ color: c.value })}
                className={`grid size-9 place-items-center rounded-full transition duration-150 ${
                  active ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : ''
                } ${busy ? 'cursor-not-allowed opacity-25' : 'hover:scale-110'}`}
                style={{ background: c.value }}
              >
                {active && <span className="text-sm text-white drop-shadow">✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Профессия
            </span>
            <button
              type="button"
              onClick={() =>
                onChange({ professionId: randomProfessionNear(deckTheme, [draft.professionId]).id })
              }
              className="text-xs font-semibold text-accent hover:underline"
            >
              🎲 случайная
            </button>
          </div>
          <Dropdown
            value={draft.professionId}
            options={professionOptions}
            onChange={(v) => onChange({ professionId: v })}
          />
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Мечта
          </div>
          <Dropdown
            value={draft.dreamSpace}
            options={dreamOptions}
            onChange={(v) => onChange({ dreamSpace: v })}
          />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Мечта — клетка на Полосе свободы. Доберётесь и купите её — победа.
      </p>
    </div>
  )
}

// ─── Экран входа в комнату ────────────────────────────────────────────

export interface JoinRoomProps {
  code: string
  draft: PlayerDraft
  onChange: (patch: Partial<PlayerDraft>) => void
  onSubmit: (role: 'player' | 'spectator') => void
  /** Мой ключ — показываем его в лобби, чтобы можно было перенести сессию. */
  myKey?: string
  /** Войти под чужим ключом: продолжить свою игру с другого устройства. */
  onUseKey?: (key: string) => void
  onBack: () => void
  deckTheme?: DeckTheme
  takenColors?: string[]
  /** Создание своей комнаты вместо входа в чужую — меняются только надписи. */
  mode?: 'join' | 'create'
  error?: string | null
  busy?: boolean
  allowSpectator?: boolean
}

/**
 * Ожидание состава комнаты после «Занять место».
 *
 * 🔴 Экран появился потому, что вход выглядел сломанным: хост уже видел
 * вошедшего, а сам вошедший продолжал смотреть на форму. Состав приходит
 * снимком от хоста, и между нажатием и снимком есть заметная пауза — её и
 * показываем честно, вместе с выходом назад, если хост не отвечает.
 */
export function JoinWaiting({
  code,
  error,
  onBack,
  topRight,
}: {
  code: string
  error?: string | null
  onBack: () => void
  topRight?: React.ReactNode
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <Page width="room">
      <header className="mb-7 flex items-center gap-3">
        <Wordmark />
        <div className="ml-auto flex items-center gap-2">{topRight}</div>
      </header>

      <div className="panel mx-auto max-w-md rounded-2xl p-6 text-center">
        <div className="caps text-[10px] font-bold text-accent">Вход в комнату</div>
        <div className="tabnum mt-1 text-3xl font-black tracking-[0.2em]">{code}</div>
        <p className="mt-3 text-sm text-muted">
          Место занято — ждём состав от хозяина стола.
        </p>
        <div className="mt-4 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2 animate-pulse rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
        {(slow || error) && (
          <p className="mt-4 text-[13px] leading-snug text-amber-600 dark:text-amber-400">
            {error ??
              'Хозяин стола пока не отвечает. Проверьте код и попросите его открыть страницу комнаты.'}
          </p>
        )}
        <button onClick={onBack} className="btn-quiet mt-4 w-full">
          Назад
        </button>
      </div>
    </Page>
  )
}

export function JoinRoom({
  code,
  draft,
  onChange,
  onSubmit,
  onBack,
  deckTheme = 'ru',
  takenColors = [],
  mode = 'join',
  error,
  busy,
  allowSpectator = true,
  myKey,
  onUseKey,
}: JoinRoomProps) {
  const creating = mode === 'create'
  const ready = draft.name.trim().length > 0
  const [keyInput, setKeyInput] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)

  return (
    <Page width="form">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition duration-150 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Назад
      </button>

      <Card>
        <CardHead
          kicker={creating ? 'Новая комната' : 'Вход в комнату'}
          title={creating ? 'Займите своё место' : 'Присоединиться к столу'}
          hint={
            creating
              ? 'Код и ссылку получите сразу после создания — их можно скинуть кому угодно.'
              : 'Заполните всё в одном окне и занимайте место за столом.'
          }
          end={
            !creating && (
              <span className="tabnum rounded-xl bg-panel2 px-3 py-1.5 text-lg font-black tracking-[0.2em]">
                {code}
              </span>
            )
          }
        />

        <SeatForm
          draft={draft}
          onChange={onChange}
          deckTheme={deckTheme}
          takenColors={takenColors}
          autoFocusName
        />

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"
          >
            {error}
          </div>
        )}

        {/*
          🔴 Вход ПО КЛЮЧУ. Личность игрока живёт в браузере, поэтому с другого
          устройства человек приходил как новый и садился на новое место — а
          партия продолжалась без него. Ключ — это и есть его место: ввёл на
          телефоне и продолжаешь ту же игру там, где остановился.
        */}
        {!creating && onUseKey && (
          <div className="mt-4">
            {!keyOpen ? (
              <button
                onClick={() => setKeyOpen(true)}
                className="text-xs font-semibold text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                Уже играли с другого устройства? Войти по ключу
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value.trim())}
                  placeholder="Ключ игрока"
                  className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button
                  disabled={keyInput.length < 4}
                  onClick={() => onUseKey(keyInput)}
                  className="btn-ghost text-sm disabled:opacity-40"
                >
                  Войти
                </button>
              </div>
            )}
          </div>
        )}

        <Rule className="my-5" />

        <button
          disabled={!ready || busy}
          onClick={() => onSubmit('player')}
          className="btn-primary w-full py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? 'Секунду…' : creating ? 'Создать комнату' : 'Занять место'}
        </button>
        {/* Кнопка неактивна — объясняем почему, а не оставляем гадать. */}
        {!ready && (
          <p className="mt-2 text-center text-xs text-muted">Сначала впишите имя за столом</p>
        )}
        {!creating && allowSpectator && (
          <button
            onClick={() => onSubmit('spectator')}
            disabled={busy}
            className="btn-ghost mt-2 w-full py-3 text-sm"
          >
            Войти зрителем — без места за столом
          </button>
        )}
      </Card>
    </Page>
  )
}

// ─── Лобби ────────────────────────────────────────────────────────────

export interface LobbyProps {
  room: RoomState
  meId: string
  inviteLink: string
  copied?: boolean
  error?: string | null
  onCopyInvite: () => void
  onUpdateMe: (patch: Partial<PlayerDraft>) => void
  onAddBot: (opts: { professionId: string; dreamSpace: number }) => void
  onKick: (id: string) => void
  onTransferHost: (id: string) => void
  onCallLink: (link: string) => void
  onSettings: (patch: Partial<RoomSettings>) => void
  onResolveDisconnect: (id: string, mode: 'bot' | 'drop') => void
  onLeave: (mode: 'quit' | 'bot') => void
  /** Мой ключ игрока — для переноса сессии на другое устройство. */
  myKey?: string
  /** Закрыть комнату совсем. Только у хозяина стола. */
  onDeleteRoom?: () => void
  onStart: () => void
  topRight?: ReactNode
}

export function Lobby({
  room,
  meId,
  inviteLink,
  copied,
  error,
  onCopyInvite,
  onUpdateMe,
  onAddBot,
  onKick,
  onTransferHost,
  onCallLink,
  onSettings,
  onResolveDisconnect,
  onLeave,
  myKey,
  onDeleteRoom,
  onStart,
  topRight,
}: LobbyProps) {
  const [keyCopied, setKeyCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const host = roomIsHost(room, meId)
  const me = room.players.find((p) => p.id === meId)
  const theme = room.settings.deckTheme
  const { professions, dreams, isRub } = useDeckOptions(theme)

  const [editing, setEditing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [linkDraft, setLinkDraft] = useState(room.callLink)

  // Ссылку мог поменять хост, пока поле открыто у другого — подтягиваем.
  useEffect(() => setLinkDraft(room.callLink), [room.callLink])

  const start = canStart(room)
  const waiting = pendingDisconnects(room)
  const provider = callProvider(room.callLink)
  // Потолок жёсткий и внутренний: настройки «сколько мест» больше нет.
  const full = room.players.length >= ROOM_MAX_PLAYERS

  const addBot = () => {
    const taken = room.players.map((p) => p.professionId)
    const profession = randomProfessionNear(theme, taken)
    const dream = dreams[Math.floor(Math.random() * dreams.length)]
    onAddBot({ professionId: profession.id, dreamSpace: dream?.index ?? 0 })
  }

  const professionLabel = (id: string) => {
    const p = professions.find((x) => x.id === id)
    return p ? professionName(p, 'ru') : '—'
  }
  const dreamLabel = (index: number) => dreams.find((d) => d.index === index)?.name ?? '—'

  return (
    <Page width="room" className="pb-28 sm:pb-16">
      {/* ─── Шапка: код и ссылка ─── */}
      <header className="mb-4 flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            Комната
          </div>
          <div className="tabnum text-3xl font-black leading-tight tracking-[0.2em] sm:text-4xl">
            {room.code}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {topRight}
          <button
            onClick={() => setLeaving(true)}
            className="btn-ghost px-3 py-2 text-xs"
            title="Покинуть комнату"
          >
            Выйти
          </button>
        </div>
      </header>

      <button
        onClick={onCopyInvite}
        className="panel mb-4 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition duration-150 hover:border-accent/60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-lg">
          🔗
        </span>
        <span className="min-w-0 flex-1">
          {/* Коротко: на 375px рядом ещё иконка и кнопка, длинная подпись не влезает. */}
          <span className="block truncate text-sm font-semibold">
            {copied ? 'Скопировано' : 'Пригласить'}
          </span>
          <span className="block truncate text-xs text-muted">{inviteLink}</span>
        </span>
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition duration-150 ${
            copied ? 'bg-accent text-accent-ink' : 'bg-panel2 text-muted'
          }`}
        >
          {copied ? '✓' : 'Копировать'}
        </span>
      </button>

      {/*
        Ключ игрока: с ним можно продолжить эту же партию с телефона или
        другого браузера — сядешь на своё место, а не новым человеком.
      */}
      {myKey && (
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(myKey)
            setKeyCopied(true)
            window.setTimeout(() => setKeyCopied(false), 1600)
          }}
          className="panel mb-4 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition duration-150 hover:border-accent/60"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-lg">
            🔑
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {keyCopied ? 'Ключ скопирован' : 'Ваш ключ игрока'}
            </span>
            <span className="block truncate text-xs text-muted">
              Войти с другого устройства и продолжить эту партию
            </span>
          </span>
          <span className="shrink-0 rounded-lg bg-panel2 px-2.5 py-1.5 text-xs font-bold text-muted">
            {keyCopied ? '✓' : 'Копировать'}
          </span>
        </button>
      )}

      {/* ─── Созвон ─── */}
      <section className="panel mb-4 rounded-2xl p-4">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="shrink-0 text-sm font-bold">Созвон</span>
          <span className="truncate text-xs text-muted">Zoom, Телемост, Telegram</span>
        </div>

        {room.callLink && (
          <a
            href={room.callLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mb-2 flex w-full items-center justify-center gap-2 py-3 text-base"
          >
            <span>{provider.icon}</span> Войти на созвон · {provider.name}
          </a>
        )}

        {host ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={() => linkDraft !== room.callLink && onCallLink(linkDraft)}
              onKeyDown={(e) => e.key === 'Enter' && onCallLink(linkDraft)}
              placeholder="https://telemost.yandex.ru/..."
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="w-full min-w-0 rounded-xl border border-line bg-panel2 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-accent"
            />
            <button onClick={() => onCallLink(linkDraft)} className="btn-ghost shrink-0 px-4 py-2.5">
              {room.callLink ? 'Обновить' : 'Добавить'}
            </button>
          </div>
        ) : (
          !room.callLink && (
            <p className="text-sm text-muted">
              Хост ещё не добавил ссылку. Появится — кнопка возникнет здесь у всех.
            </p>
          )
        )}
      </section>

      {/* ─── Отвалившиеся: решение хоста ─── */}
      {host &&
        room.settings.onDisconnect === 'ask' &&
        waiting.map((p) => (
          <div
            key={p.id}
            role="status"
            /* Тревожный блок красим заметно: на белом фоне заливки 10% не видно вовсе. */
            className="pop-in mb-3 rounded-2xl border-2 border-warn/45 bg-warn/[0.14] p-4"
          >
            <div className="text-sm font-semibold">
              <span className="text-warn">⚠</span> <b>{p.name}</b> пропал со связи. Что делаем
              с местом?
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => onResolveDisconnect(p.id, 'bot')}
                className="btn-primary flex-1 py-2.5 text-sm"
              >
                🤖 Бот за него
              </button>
              <button
                onClick={() => onResolveDisconnect(p.id, 'drop')}
                className="btn-ghost flex-1 py-2.5 text-sm"
              >
                Выбывает
              </button>
            </div>
          </div>
        ))}

      {/* ─── Игроки ─── */}
      <section className="mb-4">
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="text-sm font-bold">За столом</h2>
          <span className="tabnum text-xs text-muted">
            {room.players.length}
          </span>
          {host && !full && (
            <button
              onClick={addBot}
              className="ml-auto rounded-lg bg-panel2 px-2.5 py-1.5 text-xs font-semibold text-muted transition duration-150 hover:text-accent"
            >
              ＋ Добавить бота
            </button>
          )}
        </div>

        <ul className="space-y-2">
          {room.players.map((p) => {
            const mine = p.id === meId
            return (
              <li
                key={p.id}
                className={`panel flex items-center gap-3 rounded-2xl p-3 transition duration-150 ${
                  mine ? 'border-accent/60' : ''
                }`}
              >
                <span
                  className="size-8 shrink-0 rounded-full ring-1 ring-line"
                  style={{ background: p.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-bold">{p.name}</span>
                    {/* Ярлыки — из дизайн-системы (.chip), только компактнее: в ряду их до трёх. */}
                    {roomIsHost(room, p.id) && <span className={`${BADGE} chip-accent`}>хост</span>}
                    {mine && <span className={BADGE}>вы</span>}
                    {p.isBot && (
                      <span
                        className={`${BADGE} border-violet-300/35 bg-violet-300/12 text-violet-300`}
                      >
                        бот · {BOT_LABEL[p.botDifficulty].toLowerCase()}
                      </span>
                    )}
                    {p.standIn && <span className={`${BADGE} chip-warn`}>играет бот</span>}
                    {!p.isBot && !p.standIn && !p.online && (
                      <span className={BADGE}>не в сети</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {professionLabel(p.professionId)} · мечта: {dreamLabel(p.dreamSpace)}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {mine && (
                    <button
                      onClick={() => setEditing(true)}
                      className="rounded-lg px-2.5 py-2 text-xs font-semibold text-accent transition duration-150 hover:bg-panel2"
                    >
                      Изменить
                    </button>
                  )}
                  {host && !mine && (
                    <>
                      {!p.isBot && (
                        <button
                          onClick={() => onTransferHost(p.id)}
                          title="Передать роль хоста"
                          className="grid size-tap place-items-center rounded-lg text-muted transition duration-150 hover:bg-panel2 hover:text-accent"
                        >
                          ♛
                        </button>
                      )}
                      <button
                        onClick={() => onKick(p.id)}
                        title="Выгнать из комнаты"
                        className="grid size-tap place-items-center rounded-lg text-muted transition duration-150 hover:bg-panel2 hover:text-bad"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {!me && (
          <p className="mt-2 px-1 text-xs text-muted">
            Вы смотрите со стороны. Место за столом можно занять до начала партии.
          </p>
        )}
      </section>

      {/* ─── Зрители ─── */}
      {room.spectators.length > 0 && (
        <section className="panel mb-4 rounded-2xl p-4">
          <div className="mb-2 text-sm font-bold">
            Смотрят{' '}
            <span className="tabnum font-normal text-muted">
              {room.spectators.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {room.spectators.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1.5 rounded-lg bg-panel2 px-2.5 py-1.5 text-xs"
              >
                👀 {s.name}
                {host && (
                  <button
                    onClick={() => onKick(s.id)}
                    className="text-muted transition duration-150 hover:text-bad"
                    title="Выгнать"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ─── Настройки хоста ─── */}
      {host && (
        <section className="panel mb-4 overflow-hidden rounded-2xl">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <span className="shrink-0 text-sm font-bold">Настройки</span>
            <span className="truncate text-xs text-muted">
              {THEME_LABEL[theme]}
            </span>
            <span
              className={`ml-auto text-[10px] text-muted transition duration-150 ${
                showSettings ? 'rotate-180' : ''
              }`}
            >
              ▼
            </span>
          </button>

          {showSettings && (
            <div className="space-y-4 border-t border-line p-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  Колода
                </div>
                <Chips
                  value={theme}
                  onChange={(v) => onSettings({ deckTheme: v })}
                  options={(Object.keys(THEME_LABEL) as DeckTheme[]).map((t) => ({
                    value: t,
                    label: THEME_LABEL[t],
                  }))}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  Сложность новых ботов
                </div>
                <Chips
                  value={room.settings.botDifficulty}
                  onChange={(v) => onSettings({ botDifficulty: v })}
                  options={(Object.keys(BOT_LABEL) as BotDifficulty[]).map((d) => ({
                    value: d,
                    label: BOT_LABEL[d],
                  }))}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  Если игрок пропал со связи
                </div>
                <Chips
                  value={room.settings.onDisconnect}
                  onChange={(v) => onSettings({ onDisconnect: v })}
                  options={[
                    { value: 'ask' as const, label: 'Спросить хоста' },
                    { value: 'bot' as const, label: 'Сразу бот' },
                    { value: 'drop' as const, label: 'Выбывает' },
                  ]}
                />
              </div>

              <Toggle
                checked={room.settings.allowSpectators}
                onChange={(v) => onSettings({ allowSpectators: v })}
                label="Пускать зрителей"
                hint="Смотрят партию без места за столом"
              />
              <Toggle
                checked={room.settings.hostCanUndo}
                onChange={(v) => onSettings({ hostCanUndo: v })}
                label="Хост может отменять ходы"
                hint="Откат последнего хода — на случай ошибки"
              />
              {/*
                Ссылка на созвон. Играют голосом, а созвон обычно уже идёт —
                пусть кнопка будет прямо за столом, чтобы опоздавший не искал
                ссылку в переписке.
              */}
              <label className="block">
                <span className="text-[13px] font-semibold">Ссылка на созвон</span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  Zoom, Meet, что угодно. За столом появится неприметная кнопка «Созвон»
                </span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://zoom.us/j/…"
                  value={room.settings.callUrl ?? ''}
                  onChange={(e) => onSettings({ callUrl: e.target.value.trim() })}
                  className="input mt-1.5 w-full"
                />
              </label>
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="pop-in mb-4 rounded-2xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {/* ─── Старт ─── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {host ? (
            <>
              <button
                onClick={onStart}
                disabled={!start.ok}
                className="btn-primary flex-1 py-3.5 text-base"
              >
                Начать игру
              </button>
              <span className="hidden shrink-0 text-xs text-muted sm:block">
                {start.ok
                  ? `${humanCount(room)} живых · ${room.players.length} мест`
                  : start.message}
              </span>
            </>
          ) : (
            <div className="flex-1 rounded-xl bg-panel2 px-4 py-3 text-center text-sm text-muted">
              Ждём хоста — партию начинает он
            </div>
          )}
        </div>
        {host && !start.ok && (
          <div className="mx-auto mt-1.5 max-w-3xl text-center text-xs text-muted sm:hidden">
            {start.message}
          </div>
        )}
      </div>

      {/* ─── Правка своего места ─── */}
      {editing && me && (
        <Sheet
          title="Ваше место"
          onClose={() => setEditing(false)}
          footer={
            <button onClick={() => setEditing(false)} className="btn-primary w-full py-3">
              Готово
            </button>
          }
        >
          <SeatForm
            draft={{
              id: me.id,
              name: me.name,
              professionId: me.professionId,
              dreamSpace: me.dreamSpace,
              color: me.color,
            }}
            onChange={onUpdateMe}
            deckTheme={theme}
            takenColors={room.players.filter((p) => p.id !== meId).map((p) => p.color)}
          />
          <p className="mt-3 text-xs text-muted">
            Стартовый капитал считается от профессии — {isRub ? 'в рублях' : 'в долларах'}.
          </p>
        </Sheet>
      )}

      {/* ─── Выход ─── */}
      {leaving && (
        <Sheet title="Покинуть комнату" onClose={() => setLeaving(false)}>
          <p className="text-sm leading-relaxed text-muted">
            {me
              ? 'Ваше место можно освободить совсем, а можно оставить — тогда дальше за вас будет ходить бот, и партия не встанет.'
              : 'Вы смотрите со стороны — выход ни на что не повлияет.'}
          </p>
          <div className="mt-4 space-y-2">
            {me && (
              <button
                onClick={() => onLeave('bot')}
                className="btn-primary w-full py-3 text-base"
              >
                🤖 Оставить бота за себя
              </button>
            )}
            <button onClick={() => onLeave('quit')} className="btn-ghost w-full py-3">
              Выйти совсем
            </button>
            {/* Комнату закрывает только хозяин: она перестаёт существовать для всех. */}
            {onDeleteRoom && (
              <button
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true)
                    return
                  }
                  onDeleteRoom()
                }}
                className={`w-full rounded-lg py-3 text-sm font-semibold transition ${
                  confirmDelete
                    ? 'bg-rose-500 text-white'
                    : 'border border-line text-muted hover:text-rose-500'
                }`}
              >
                {confirmDelete ? 'Точно удалить комнату?' : 'Удалить комнату'}
              </button>
            )}
            <button
              onClick={() => setLeaving(false)}
              className="w-full py-2 text-sm text-muted hover:text-ink"
            >
              Отмена
            </button>
          </div>
        </Sheet>
      )}
    </Page>
  )
}
