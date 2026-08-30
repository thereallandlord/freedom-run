import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ROOM_COLOR_VALUES,
  ROOM_ERROR_TEXT,
  applyRoomAction,
  canStart,
  createRoom,
  findPlayer,
  inviteLink as buildInviteLink,
  isHost as roomIsHost,
  nextFreeColor,
  readRoomCodeFromUrl,
  sanitizeCallLink,
  setOnline as roomSetOnline,
  toTableSetup,
  type PlayerDraft,
  type RoomAction,
  type RoomSettings,
  type RoomState,
} from '../engine/room'
import type { TableSetup } from '../engine/table'

/**
 * Транспорт комнаты. Реализация — `createTransport()` из `src/net/realtime.ts`.
 *
 * Тип описан здесь СТРУКТУРНО, а не импортирован: лобби не должно ломаться от
 * правок в файле сети, а настоящий Transport шире этого набора и подходит как есть.
 *
 * 🔴 Главное правило транспорта: своё событие возвращается тебе же через onEvent.
 * Поэтому при живой сети действие НЕ применяется на месте — только send();
 * состояние меняется в onEvent. Иначе каждое действие применится дважды
 * (два бота на одно нажатие, два входа одного человека).
 */
export interface RoomNetHandlers {
  onEvent: (payload: unknown, meta?: unknown) => void
  onPresence: (peers: { id: string }[]) => void
  onSnapshotRequest: (from: string) => void
  onSnapshot: (data: { snapshot: unknown; events?: unknown[] }) => void
  /** Журнал переигран (порядок поправился) — состояние надо пересобрать. */
  onRewind?: (events: unknown[]) => void
  /** Действие не попало в журнал: проиграло гонку за слот или устарело. */
  onRejected?: (payload: unknown, reason: string) => void
}

export interface RoomTransport {
  join(
    code: string,
    self: { id: string; name: string },
    handlers: RoomNetHandlers,
  ): Promise<void>
  send(payload: unknown): void
  /** Текущий журнал канала — общая правда комнаты. */
  journal?(): { payload: unknown }[]
  sendSnapshot(to: string, snapshot: unknown): void
  leave(): void
}

export type RoomRole = 'host' | 'player' | 'spectator'

const ME_KEY = 'freedom-run:me:v1'
const ROOM_KEY = 'freedom-run:room:v1'

/** Личность игрока между заходами: имя и вкусы не должны спрашиваться дважды. */
export interface Identity {
  id: string
  name: string
  professionId: string
  dreamSpace: number
  color: string
}

function newId(): string {
  // randomUUID есть не везде (старый Safari, http-локалка) — свой запасной путь.
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* приватный режим — играем без запоминания */
  }
}

function defaultIdentity(): Identity {
  return { id: newId(), name: '', professionId: '', dreamSpace: 0, color: ROOM_COLOR_VALUES[0] }
}

export interface UseRoomOptions {
  /** Готовый транспорт. Нет — комната живёт только в этой вкладке. */
  transport?: RoomTransport | null
  /** Откуда брать ?room= — по умолчанию адресная строка. */
  search?: string
  /** База для ссылки-приглашения. По умолчанию текущий адрес без параметров. */
  origin?: string
  /** Ход за столом, пришедший от любого игрока (включая эхо своего). */
  onGameEvent?: (ev: unknown) => void
  /** Весь журнал ходов из снимка — для возвращения в идущую партию. */
  onGameJournal?: (events: unknown[]) => void
}

export interface UseRoomApi {
  me: Identity
  room: RoomState | null
  role: RoomRole | null
  isHost: boolean
  /** Ждём снимок комнаты от хоста: код ввели, состава ещё нет. */
  connecting: boolean
  /** Код из ссылки ?room= — по нему сразу открываем экран входа. */
  urlCode: string | null
  inviteLink: string
  error: string | null
  copied: boolean
  setIdentity: (patch: Partial<Identity>) => void
  clearError: () => void
  create: (draft: Partial<PlayerDraft>, settings?: Partial<RoomSettings>) => RoomState | null
  /** Отправить ход за столом всем в комнате. */
  sendGame: (ev: unknown) => void
  /** Все ходы за столом из общего журнала — единственная правда партии. */
  gameJournal: () => unknown[]
  /** true — вход начат; состав придёт снимком от хоста чуть позже. */
  join: (code: string, draft: Partial<PlayerDraft>, as?: 'player' | 'spectator') => boolean
  updateMe: (patch: Partial<PlayerDraft>) => void
  addBot: (opts: { professionId: string; dreamSpace: number }) => void
  kick: (id: string) => void
  transferHost: (id: string) => void
  setCallLink: (link: string) => void
  setSettings: (patch: Partial<RoomSettings>) => void
  resolveDisconnect: (id: string, mode: 'bot' | 'drop') => void
  leave: (mode: 'quit' | 'bot') => void
  /**
   * Забыть комнату у себя, никому ничего не сообщая.
   *
   * 🔴 Не то же, что `leave`: тот шлёт в комнату «меня больше нет» и выводит
   * человека из партии по-настоящему. Здесь нужно другое — просто перестать
   * считать себя участником комнаты, когда человек садится играть за одним
   * экраном. Иначе прошлая комната продолжает жить в браузере и ломает
   * местную партию (см. подпись действий в useGame).
   */
  forget: () => void
  copyInvite: () => Promise<boolean>
  start: () => TableSetup | null
  /** Прямая отправка действия — для отладки и нестандартных сценариев. */
  dispatch: (action: RoomAction) => void
}

export function useRoom(options: UseRoomOptions = {}): UseRoomApi {
  const { transport = null, onGameEvent, onGameJournal } = options

  const [me, setMe] = useState<Identity>(() => {
    const saved = readJson<Identity>(ME_KEY)
    if (saved?.id) return saved
    /*
     * 🔴 Записываем личность ТУТ ЖЕ, а не в эффекте. Иначе при закрытии
     * вкладки до первой отрисовки (или при чистке хранилища в Safari) человек
     * возвращался с новым идентификатором — и переставал быть хозяином
     * собственной комнаты.
     */
    const fresh = defaultIdentity()
    writeJson(ME_KEY, fresh)
    return fresh
  })
  const [room, setRoom] = useState<RoomState | null>(() => readJson<RoomState>(ROOM_KEY))
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  // Свежая комната для обработчиков сети: они живут дольше одного рендера.
  const roomRef = useRef(room)
  useEffect(() => {
    roomRef.current = room
  }, [room])

  const urlCode = useMemo(() => {
    const search = options.search ?? (typeof location !== 'undefined' ? location.search : '')
    return readRoomCodeFromUrl(search)
  }, [options.search])

  const origin = useMemo(() => {
    if (options.origin) return options.origin
    if (typeof location === 'undefined') return ''
    return location.origin + location.pathname
  }, [options.origin])

  useEffect(() => writeJson(ME_KEY, me), [me])

  useEffect(() => {
    if (room) writeJson(ROOM_KEY, room)
    else localStorage.removeItem(ROOM_KEY)
  }, [room])

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  const apply = useCallback((action: RoomAction) => {
    setRoom((prev) => (prev ? applyRoomAction(prev, action) : prev))
  }, [])

  /*
   * 🔴 По одному каналу идут ДВА потока: действия комнаты (кто вошёл, что в
   * настройках) и ходы за столом. Раньше ходы не отправлялись вовсе — комната
   * синхронизировалась, а партия у каждого шла своя: соперник не видел ни
   * карточек, ни бросков. Различаем по обёртке `{ __g: … }`.
   */
  /**
   * Все ходы за столом из общего журнала канала.
   *
   * 🔴 Это и есть «одна правда комнаты». Приложение больше не собирает стол
   * по одному приходящему событию: оно берёт ВЕСЬ журнал и проигрывает его
   * заново. Тогда порядок у всех одинаковый по построению, а не по удаче.
   */
  const gameJournal = useCallback((): unknown[] => {
    const all = transport?.journal?.() ?? []
    const out: unknown[] = []
    for (const e of all) {
      const w = (e as { payload?: { __g?: unknown } }).payload
      if (w && typeof w === 'object' && '__g' in w) out.push(w.__g)
    }
    return out
  }, [transport])

  const gameJournalRef = useRef<() => unknown[]>(() => [])
  gameJournalRef.current = gameJournal

  const sendGame = useCallback(
    (ev: unknown) => {
      if (transport) transport.send({ __g: ev } as unknown as RoomAction)
    },
    [transport],
  )

  /**
   * Единственная точка изменения комнаты.
   * С сетью — только отправляем: событие вернётся эхом и применится в onEvent,
   * и порядок будет одинаковым у всех. Без сети — применяем сразу.
   */
  const dispatch = useCallback(
    (action: RoomAction) => {
      if (transport) transport.send(action)
      else apply(action)
    },
    [apply, transport],
  )

  /** Обработчики сети. Собираются один раз на подключение. */
  const handlers = useCallback(
    (): RoomNetHandlers => ({
      onEvent: (payload) => {
        const wrapped = payload as { __g?: unknown }
        if (wrapped && typeof wrapped === 'object' && '__g' in wrapped) {
          onGameEvent?.(wrapped.__g)
          return
        }
        apply(payload as RoomAction)
      },

      // Присутствие — готовый ответ на «игрок отвалился»: политику применит движок.
      onPresence: (peers) => {
        const live = new Set(peers.map((p) => p.id))
        setRoom((prev) => {
          if (!prev) return prev
          let next = prev
          for (const p of prev.players) {
            if (p.isBot) continue
            next = roomSetOnline(next, p.id, live.has(p.id))
          }
          return next
        })
      },

      // У нас просят состав — отдаём как есть, новичок соберётся с нуля.
      /*
       * 🔴 ПРОИГРАВШЕЕ В ГОНКЕ ДЕЙСТВИЕ ОТПРАВЛЯЕМ ЗАНОВО. Когда двое жмут в
       * один и тот же миг, слот журнала достаётся одному, а второе действие
       * транспорт молча выбрасывает — человек видит, как его ход появился и
       * исчез. На четверых это редкость, на десятерых — обычное дело: проверка
       * залпом показала, что из десяти одновременных доезжает одно.
       * Повторяем один раз с небольшой задержкой: слот к этому моменту уже
       * занят, и событие встанет следующим.
       */
      onRejected: (payload, reason) => {
        if (reason !== 'lost-race') return
        const again = payload as { __g?: unknown; __try?: number }
        if (!again || typeof again !== 'object') return
        const n = (again.__try ?? 0) + 1
        if (n > 6) return // столько раз подряд не проигрывают даже вдесятером
        /*
         * Пауза со СЛУЧАЙНЫМ разбросом. Если повторять одновременно и через
         * одинаковое время, те же участники снова столкнутся на следующем
         * слоте — и так по кругу: замер на десятерых показал, что из десяти
         * одновременных доезжает одно. Разброс разводит их по времени.
         */
        const wait = 90 * n + Math.floor(Math.random() * 140)
        window.setTimeout(() => transport?.send({ ...again, __try: n }), wait)
      },

      onSnapshotRequest: (from) => {
        const current = roomRef.current
        if (current) transport?.sendSnapshot(from, current)
      },

      onRewind: () => {
        // Порядок в журнале поправился — пересобираем партию по нему.
        onGameJournal?.(gameJournalRef.current())
      },

      onSnapshot: ({ snapshot, events }) => {
        if (!snapshot) return
        /*
         * 🔴 В журнале канала лежат ДВА потока: действия комнаты и ходы за
         * столом (последние помечены обёрткой `__g`). Раньше снимок прогонял
         * их все через комнату — ходы для неё мусор, а сама партия при
         * возвращении не восстанавливалась вовсе и начиналась с нуля.
         */
        let base = snapshot as RoomState
        const moves: unknown[] = []
        for (const ev of events ?? []) {
          const wrapped = ev as { __g?: unknown }
          if (wrapped && typeof wrapped === 'object' && '__g' in wrapped) {
            moves.push(wrapped.__g)
            continue
          }
          base = applyRoomAction(base, ev as RoomAction)
        }
        setRoom(base)
        setConnecting(false)
        if (moves.length) onGameJournal?.(moves)
      },
    }),
    [apply, onGameEvent, onGameJournal, transport],
  )

  const setIdentity = useCallback((patch: Partial<Identity>) => {
    setMe((prev) => ({ ...prev, ...patch }))
  }, [])

  const draftFrom = useCallback(
    (patch: Partial<PlayerDraft>): PlayerDraft => ({
      id: me.id,
      name: (patch.name ?? me.name).trim(),
      professionId: patch.professionId ?? me.professionId,
      dreamSpace: patch.dreamSpace ?? me.dreamSpace,
      color: patch.color ?? me.color,
    }),
    [me],
  )

  const rememberDraft = useCallback(
    (d: PlayerDraft) =>
      setIdentity({
        name: d.name,
        professionId: d.professionId,
        dreamSpace: d.dreamSpace,
        color: d.color,
      }),
    [setIdentity],
  )

  /*
   * 🔴 ВОЗВРАЩЕНИЕ В СВОЮ КОМНАТУ ПОСЛЕ ПЕРЕЗАГРУЗКИ.
   *
   * Подключение к каналу происходило ровно в двух местах — при создании
   * комнаты и при входе по ссылке. После обновления страницы не звалось
   * ничто: комната в хранилище есть, экран нарисован, а провода нет — и
   * человек оказывался «в комнате», о которой никто не знает. Здесь мы
   * подключаемся заново, если хранилище говорит, что мы её участник.
   *
   * 🔴 КОД ИЗ АДРЕСА БОЛЬШЕ НЕ ОБЯЗАТЕЛЕН. Раньше без `?room=` мы не
   * переподключались вовсе — а адрес чистится сам, стоит выйти на главную
   * (и обратно). Человек нажимал «Продолжить», садился за стол, и провода не
   * было: ходы применялись у него одного, остальные их не видели, голос и
   * подхват хода пропадали. Достаточно того, что комната лежит в хранилище и
   * мы в её составе; адрес — лишь подсказка, а не условие.
   */
  const rejoined = useRef(false)
  useEffect(() => {
    if (rejoined.current || !transport) return
    const saved = roomRef.current
    if (!saved) return
    if (urlCode && saved.code !== urlCode) return
    const mine =
      saved.players.some((p) => p.id === me.id) || saved.spectators.some((p) => p.id === me.id)
    if (!mine) return
    rejoined.current = true
    void transport.join(saved.code, { id: me.id, name: me.name }, handlers())
  }, [handlers, me.id, me.name, transport, urlCode])

  const create = useCallback(
    (patch: Partial<PlayerDraft>, settings?: Partial<RoomSettings>) => {
      const draft = draftFrom(patch)
      if (!draft.name) {
        setError(ROOM_ERROR_TEXT.BAD_NAME)
        return null
      }

      const fresh = createRoom({ host: draft, settings })
      setRoom(fresh)
      roomRef.current = fresh
      setError(null)
      rememberDraft(draft)

      // Сеть подключаем после: хост уже видит свою комнату и не ждёт коннекта.
      void transport?.join(fresh.code, { id: draft.id, name: draft.name }, handlers())
      return fresh
    },
    [draftFrom, handlers, rememberDraft, transport],
  )

  /**
   * Войти в чужую комнату.
   *
   * 🔴 Возвращает `true`, если вход НАЧАТ. Раньше функция не возвращала
   * ничего, а экран переключался по её результату — то есть не переключался
   * НИКОГДА: человек жал «Занять место», у хоста он появлялся, а сам он
   * продолжал смотреть на ту же форму и думал, что кнопка не работает.
   * Состав комнаты приходит снимком от хоста чуть позже; пока его нет,
   * показываем ожидание, а не форму.
   */
  const join = useCallback(
    (code: string, patch: Partial<PlayerDraft>, as: 'player' | 'spectator' = 'player'): boolean => {
      const draft = draftFrom(patch)
      if (!draft.name) {
        setError(ROOM_ERROR_TEXT.BAD_NAME)
        return false
      }
      rememberDraft(draft)
      setError(null)

      const action: RoomAction =
        as === 'spectator'
          ? { type: 'JOIN_SPECTATOR', id: draft.id, name: draft.name }
          : { type: 'JOIN_PLAYER', draft }

      if (transport) {
        // Состав придёт снимком от хоста — своей комнаты не выдумываем.
        setConnecting(true)
        setRoom(null)
        void transport
          .join(code, { id: draft.id, name: draft.name }, handlers())
          .then(() => transport.send(action))
          .catch(() => {
            setConnecting(false)
            setError('Не получилось подключиться к комнате')
          })
        return true
      }

      /*
       * Без транспорта чужую комнату взять неоткуда, поэтому собираем свою с тем
       * же кодом: лобби целиком работает и проверяется, а появление сети ничего
       * в нём не меняет — те же действия пойдут в send().
       */
      const local = createRoom({ host: draft, code })
      setRoom(as === 'spectator' ? applyRoomAction(local, action) : local)
      return true
    },
    [draftFrom, handlers, rememberDraft, transport],
  )

  const updateMe = useCallback(
    (patch: Partial<PlayerDraft>) => {
      rememberDraft(draftFrom(patch))
      dispatch({ type: 'UPDATE_PLAYER', id: me.id, patch })
    },
    [dispatch, draftFrom, me.id, rememberDraft],
  )

  const addBot = useCallback(
    (opts: { professionId: string; dreamSpace: number }) =>
      dispatch({ type: 'ADD_BOT', id: newId(), ...opts }),
    [dispatch],
  )

  const kick = useCallback((id: string) => dispatch({ type: 'REMOVE_MEMBER', id }), [dispatch])

  const transferHost = useCallback(
    (id: string) => dispatch({ type: 'TRANSFER_HOST', id }),
    [dispatch],
  )

  const setCallLink = useCallback(
    (link: string) => {
      // Проверяем до отправки: иначе редьюсер отклонит молча и человек не поймёт.
      if (sanitizeCallLink(link) === null) {
        setError(ROOM_ERROR_TEXT.BAD_LINK)
        return
      }
      setError(null)
      dispatch({ type: 'SET_CALL_LINK', link })
    },
    [dispatch],
  )

  const setSettings = useCallback(
    (patch: Partial<RoomSettings>) => dispatch({ type: 'SET_SETTINGS', patch }),
    [dispatch],
  )

  const resolveDisconnect = useCallback(
    (id: string, mode: 'bot' | 'drop') => dispatch({ type: 'RESOLVE_DISCONNECT', id, mode }),
    [dispatch],
  )

  const leave = useCallback(
    (mode: 'quit' | 'bot') => {
      if (room) {
        dispatch(
          mode === 'bot'
            ? { type: 'LEAVE_AS_BOT', id: me.id }
            : { type: 'REMOVE_MEMBER', id: me.id },
        )
      }
      transport?.leave()
      setRoom(null)
      setConnecting(false)
      setError(null)
    },
    [dispatch, me.id, room, transport],
  )

  /*
   * Забыть комнату молча. Транспорт отключаем — держать канал открытым для
   * комнаты, в которой мы больше не играем, незачем.
   */
  const forget = useCallback(() => {
    transport?.leave()
    setRoom(null)
    setConnecting(false)
    setError(null)
  }, [transport])

  const inviteLink = room ? buildInviteLink(room.code, origin) : ''

  const copyInvite = useCallback(async () => {
    if (!inviteLink) return false
    const flash = () => {
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    try {
      await navigator.clipboard.writeText(inviteLink)
      flash()
      return true
    } catch {
      // Без https и в старых webview clipboard недоступен — старый добрый способ.
      try {
        const ta = document.createElement('textarea')
        ta.value = inviteLink
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        flash()
        return true
      } catch {
        setError('Не получилось скопировать — выделите ссылку вручную')
        return false
      }
    }
  }, [inviteLink])

  const start = useCallback(() => {
    if (!room) return null
    const check = canStart(room)
    if (!check.ok) {
      setError(check.message)
      return null
    }
    dispatch({ type: 'SET_STATUS', status: 'playing' })
    return toTableSetup(room)
  }, [dispatch, room])

  const isHost = !!room && roomIsHost(room, me.id)
  const role: RoomRole | null = !room
    ? null
    : isHost
      ? 'host'
      : findPlayer(room, me.id)
        ? 'player'
        : 'spectator'

  // Цвет по умолчанию — первый свободный, иначе двое войдут одинаковыми.
  useEffect(() => {
    if (!room || findPlayer(room, me.id)) return
    const free = nextFreeColor(room)
    if (free && me.color !== free) setIdentity({ color: free })
  }, [room, me.id, me.color, setIdentity])

  return {
    me,
    room,
    role,
    isHost,
    connecting,
    urlCode,
    inviteLink,
    error,
    copied,
    setIdentity,
    clearError: () => setError(null),
    create,
    join,
    updateMe,
    addBot,
    kick,
    transferHost,
    setCallLink,
    sendGame,
    gameJournal,
    setSettings,
    resolveDisconnect,
    leave,
    forget,
    copyInvite,
    start,
    dispatch,
  }
}
