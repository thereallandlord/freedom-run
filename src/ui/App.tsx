import { useEffect, useMemo, useRef, useState } from 'react'
import { Setup } from './Setup'
import { Game } from './Game'
import { Landing } from './Landing'
import { AccountButton, authAvailable, openLogin, useAuthUser } from './AccountButton'
import { Admin, хочетПанель } from './Admin'
import { JoinRoom, JoinWaiting, Lobby } from './Lobby'
import { useGame } from './useGame'
import type { TableEvent } from '../engine/events'
import { useRoom } from './useRoom'
import { useTheme } from './theme'
import { createTransport } from '../net/realtime'
import { ROOM_COLOR_VALUES, toTableSetup, type PlayerDraft } from '../engine/room'
import { dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme } from '../engine/data'

type Screen = 'landing' | 'join' | 'create' | 'lobby' | 'local' | 'game'

function ThemeToggle() {
  const { isDark, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      className="btn-ghost text-xs"
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
      aria-label="Переключить тему"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" className="size-[15px]">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="size-[15px]">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  )
}

export function App() {
  /** Кто вошёл: от этого зависит, предлагать ли кабинет строкой на главной. */
  const вошёл = !!useAuthUser()
  // Транспорт создаётся один раз: Supabase, если заданы ключи, иначе вкладки одного браузера.
  const transport = useMemo(
    // ?netlog=1 в адресе включает журнал сети в консоли — для разбора проблем со связью.
    () => createTransport('auto', { debug: new URLSearchParams(location.search).has('netlog') }),
    [],
  )

  /*
   * 🔴 Ходы за столом идут ПО СЕТИ, как и действия комнаты. Раньше игровой
   * журнал никуда не отправлялся: комната синхронизировалась, а партия у
   * каждого шла своя — соперник не видел ни бросков, ни карточек.
   *
   * Ссылку на отправку кладём в ref: useRoom и useGame нужны друг другу, а
   * объявить их можно только по очереди.
   */
  const sendGameRef = useRef<((ev: TableEvent) => void) | null>(null)
  const applyRef = useRef<((ev: TableEvent) => void) | null>(null)
  const undoRef = useRef<(() => void) | null>(null)
  const resumeRef = useRef<((moves: TableEvent[]) => void) | null>(null)
  const startRef = useRef<((setup: ReturnType<typeof toTableSetup>) => void) | null>(null)
  const journalRef = useRef<(() => void) | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  // В разработке транспорт видно из консоли — иначе связь не продиагностировать.
  ;(window as unknown as { __net?: unknown }).__net = transport

  const room = useRoom({
    transport,
    /*
     * Вернулись в идущую партию: сосед прислал весь журнал ходов. Собираем
     * стол с нуля по составу комнаты и проигрываем журнал — состояние
     * получается ровно то же, что у него.
     */
    onGameJournal: (moves) => resumeRef.current?.(moves as TableEvent[]),
    onGameEvent: (ev) => {
      /*
       * 🔴 СТАРТ ПАРТИИ — ТОЖЕ СОБЫТИЕ КАНАЛА, а не местное решение каждого.
       * Раньше хозяин собирал стол у себя, а гость — у себя, по своей копии
       * состава: у одного карта появлялась, у второго нет, и начинали они
       * в разное время. Теперь состав приезжает готовым, и стол рождается у
       * всех одновременно и одинаковым.
       */
      const ctrl = ev as { type?: string; setup?: unknown }
      if (ctrl?.type === '__START' && ctrl.setup) {
        startRef.current?.(ctrl.setup as ReturnType<typeof toTableSetup>)
        return
      }
      // Хозяин закрыл комнату — расходимся, партии больше нет.
      if (ctrl?.type === '__CLOSE_ROOM') {
        closeRef.current?.()
        return
      }
      // Отмена и возврат — тоже записи журнала: разбираются при пересборке.
      /*
       * 🔴 Стол пересобирается ПО ВСЕМУ ЖУРНАЛУ, а не докладывается по
       * одному событию. Раньше каждый клиент клеил своё состояние из того,
       * что до него доехало и в каком порядке: у одного клик срабатывал, у
       * другого пропадал молча, а порядок ходов зависел от удачи сети.
       * Журнал канала — общая правда; проигрываем его целиком, это дёшево.
       */
      journalRef.current?.()
    },
  })

  /** Онлайн-партия — та, где комната реально существует. */
  const online = !!room.room && room.room.players.length > 0
  const isHost = room.room?.hostId === room.me.id
  const game = useGame(
    online
      ? {
          send: (ev) => sendGameRef.current?.(ev),
          isHost,
          meId: room.me.id,
        }
      : undefined,
  )
  sendGameRef.current = (ev) => room.sendGame(ev)
  applyRef.current = (ev) => game.applyLocal(ev)
  undoRef.current = () => game.undoLocal()
  startRef.current = (setup) => {
    game.resume(setup, [])
    setScreen('game')
  }
  closeRef.current = () => {
    room.leave('quit')
    game.reset()
    setScreen('landing')
  }

  journalRef.current = () => {
    const r = room.room
    if (!r) return
    /*
     * 🔴 ОТМЕНА — ЧАСТЬ ЖУРНАЛА, а не местное действие. Стол пересобирается
     * по общему журналу, поэтому «просто откатить у себя» бессмысленно:
     * следующий же приход событий воскресил бы отменённый ход. Читаем журнал
     * по порядку: обычный ход кладём в стопку, `__UNDO` снимает последний и
     * запоминает его, `__REDO` возвращает обратно. Так отмена и возврат
     * работают у всех одинаково и переживают перезаход.
     */
    const moves: TableEvent[] = []
    const undone: TableEvent[] = []
    for (const raw of room.gameJournal()) {
      const type = (raw as { type?: string })?.type
      if (type === '__START') continue
      if (type === '__UNDO') {
        const last = moves.pop()
        if (last) undone.push(last)
        continue
      }
      if (type === '__REDO') {
        const back = undone.pop()
        if (back) moves.push(back)
        continue
      }
      moves.push(raw as TableEvent)
      undone.length = 0
    }
    game.resume(toTableSetup(r), moves, undone.length)
    setScreen('game')
  }

  resumeRef.current = (moves) => {
    const r = room.room
    if (!r) return
    game.resume(toTableSetup(r), moves)
    setScreen('game')
  }

  /**
   * Моё место за столом — это МОЙ идентификатор из комнаты.
   * 🔴 Раньше место вычислялось как «мой номер в списке» (`seat-0`, `seat-1`).
   * Списки у двух клиентов могли разойтись — и тогда у одного «ходит Анвар», у
   * другого «ходит Камиль», при том что номер хода совпадал. Партия вставала.
   */
  /*
   * 🔴 Если мой идентификатор почему-то не совпал с местом за столом (человек
   * перезашёл и получил новый), ищем себя по имени в составе. Иначе действия
   * уходят без адреса и движок их отклоняет — «кнопки не работают только у
   * одного игрока».
   */
  const meSeatId = (() => {
    const r = room.room
    if (!r) return room.me.id
    if (r.players.some((p) => p.id === room.me.id)) return room.me.id
    const byName = r.players.find(
      (p) => p.name.trim().toLowerCase() === room.me.name.trim().toLowerCase(),
    )
    return byName?.id ?? room.me.id
  })()

  /*
   * 🔴 ОБНОВЛЕНИЕ СТРАНИЦЫ ВНУТРИ КОМНАТЫ НЕ ВЫБРАСЫВАЕТ ИЗ НЕЁ.
   *
   * Пока идёт партия, код комнаты стоит в адресе. Значит при перезагрузке мы
   * точно знаем: человек был в этой комнате, а не «когда-то в какой-то».
   * Если он в ней состоял — возвращаем на место: в лобби, а если партия уже
   * шла — сразу за стол. Ссылка от друга (мы в ней не состоим) по-прежнему
   * открывает форму входа, а голый адрес — главную.
   */
  const [screen, setScreen] = useState<Screen>(() => {
    if (!room.urlCode) return 'landing'
    const saved = room.room
    const mine = saved?.code === room.urlCode && saved.players.some((p) => p.id === room.me.id)
    if (!mine) return 'join'
    return saved?.status === 'playing' ? 'game' : 'lobby'
  })

  /*
   * 🔴 Пока идёт сетевая партия, адрес страницы — АДРЕС КОМНАТЫ. Раньше
   * ссылка-приглашение отрабатывала один раз и адрес оставался «голым»:
   * обновил страницу — и ты уже не в комнате, а на главной, хотя партия
   * идёт. Теперь код комнаты живёт в адресе, его можно переслать в любой
   * момент, а перезагрузка возвращает в ту же комнату.
   */
  useEffect(() => {
    // Код комнаты держим в адресе, только пока человек в ней: на главной он
    // читался бы как приглашение в партию, из которой мы только что вышли.
    const inRoom = screen === 'lobby' || screen === 'game'
    /*
     * Пока состав едет от хозяина, комнаты в состоянии ещё нет — но человек
     * УЖЕ в ней. Без кода из адреса перезагрузка на этом экране выкидывала на
     * главную, и войти обратно можно было только по новой ссылке.
     */
    const code = inRoom ? (room.room?.code ?? room.urlCode ?? undefined) : undefined
    const url = new URL(window.location.href)
    // ?v= ставит сторож свежести сборки; в адресе комнаты он лишний.
    url.searchParams.delete('v')
    const now = url.searchParams.get('room')
    if (code && now !== code) {
      url.searchParams.set('room', code)
      window.history.replaceState(null, '', url)
    } else if (!code && now) {
      url.searchParams.delete('room')
      window.history.replaceState(null, '', url)
    }
  }, [room.room?.code, screen])


  const [draft, setDraft] = useState<PlayerDraft>(() => {
    setActiveTheme('ru')
    setFastBoardTheme('ru')
    const pool = professionsFor('ru')
    const dreams = dreamSpaces()
    return {
      id: room.me.id,
      name: '',
      color: ROOM_COLOR_VALUES[0],
      professionId: pool[0].id,
      dreamSpace: dreams[0].index,
    }
  })

  /*
   * Хост нажал «Начать игру» — у гостей это приходит сменой статуса комнаты.
   * Стол собираем из состояния комнаты: сетап детерминирован (общий seed),
   * поэтому у всех получается одна и та же партия без пересылки стола.
   */
  const roomStatus = room.room?.status
  const started = roomStatus === 'playing'
  useEffect(() => {
    /*
     * 🔴 Стол открывается, ТОЛЬКО пока человек сидит в лобби этой самой
     * комнаты. Раньше условия не было — и на любом заходе, если в браузере
     * лежала комната со статусом «играем», приложение молча собирало стол и
     * бросало туда человека. Он открывал ссылку, а его выкидывало в старую
     * партию, и назад дороги не было.
     */
    // Стол собираем из лобби (нажали «Начать») или при возвращении в свою
    // комнату по адресу — но не из-за случайной записи в хранилище.
    const returning = screen === 'game' && room.urlCode === room.room?.code
    // В сетевой партии старт приходит событием канала — здесь только
    // одиночная игра на одном устройстве.
    if (online) return
    if (screen !== 'lobby' && !returning) return
    if (!started || !room.room || game.table) return
    /*
     * 🔴 При ВОЗВРАЩЕНИИ пустой стол не собираем: журнал ходов приедет от
     * соседа снимком и восстановит партию с того же места. Иначе игра
     * начиналась с нуля, хотя у второго она продолжалась.
     */
    if (returning && online) return
    game.start(toTableSetup(room.room))
    setScreen('game')
  }, [screen, started, room.room, game])

  /*
   * 🔴 Сохранённая партия САМА на экран не выходит. Раньше стол открывался
   * сразу, как только в браузере лежало сохранение, — и человек, перешедший
   * по обычной ссылке, попадал не на главную, а в чей-то вчерашний стол, без
   * пути обратно. Теперь главная показывается всегда, а прошлая партия ждёт
   * на ней отдельной карточкой «Продолжить».
   */
  /*
   * 🔴 Панель хозяина стоит ПЕРЕД всем остальным и открывается адресом
   * `?admin=1`. Ссылки на неё нигде нет: она не секрет, но и не для игроков.
   * Ничего не меняет — только показывает, поэтому и запускается так просто.
   */
  if (хочетПанель()) {
    return (
      <Admin
        onClose={() => {
          const u = new URL(location.href)
          u.searchParams.delete('admin')
          location.href = u.toString()
        }}
      />
    )
  }

  if (game.table && screen === 'game') {
    return (
      <Game
        table={game.table}
        dispatch={game.dispatch}
        roll={game.roll}
        rolling={game.rolling}
          rolled={game.rolled}
        undo={game.undo}
        redo={game.redo}
        canRedo={game.canRedo}
        canUndo={!online || isHost}
        reset={() => {
          game.reset()
          setScreen('landing')
        }}
        rematch={game.rematch}
        onExit={() => setScreen('landing')}
        callUrl={room.room?.settings.callUrl}
        meId={online ? meSeatId : undefined}
        events={game.events}
        topRight={<><AccountButton /><ThemeToggle /></>}
      />
    )
  }

  if (screen === 'local') {
    return (
      <Setup
        onStart={(setup) => {
          game.start(setup)
          setScreen('game')
        }}
      />
    )
  }

  /*
   * 🔴 Ждём состав комнаты ОТДЕЛЬНЫМ экраном. Раньше при `screen==='lobby'` и
   * пустой комнате не подходило ни одно условие, и человека выбрасывало на
   * главную — выглядело как «кнопка не работает».
   */
  if (screen === 'lobby' && !room.room) {
    return (
      <JoinWaiting
        code={room.urlCode ?? ''}
        error={room.error}
        onBack={() => {
          room.leave('quit')
          setScreen('landing')
        }}
        topRight={<><AccountButton /><ThemeToggle /></>}
      />
    )
  }

  if (screen === 'lobby' && room.room) {
    return (
      <Lobby
        room={room.room}
        meId={room.me.id}
        inviteLink={room.inviteLink}
        copied={room.copied}
        error={room.error}
        onCopyInvite={room.copyInvite}
        onUpdateMe={room.updateMe}
        onAddBot={room.addBot}
        onKick={room.kick}
        onTransferHost={room.transferHost}
        onCallLink={room.setCallLink}
        onSettings={room.setSettings}
        onResolveDisconnect={room.resolveDisconnect}
        onLeave={(mode) => {
          room.leave(mode)
          setScreen('landing')
        }}
        myKey={room.me.id}
        onDeleteRoom={
          isHost
            ? () => {
                // Комната закрывается для всех: остальным приходит роспуск.
                room.sendGame({ type: '__CLOSE_ROOM' })
                room.leave('quit')
                game.reset()
                setScreen('landing')
              }
            : undefined
        }
        onStart={() => {
          const setup = room.start()
          if (!setup) return
          if (online) {
            // Состав рассылаем готовым — стол рождается у всех одинаковым.
            room.sendGame({ type: '__START', setup })
          } else {
            game.start(setup)
            setScreen('game')
          }
        }}
        topRight={<><AccountButton /><ThemeToggle /></>}
      />
    )
  }

  if (screen === 'join' || screen === 'create') {
    const creating = screen === 'create'
    return (
      <JoinRoom
        code={room.urlCode ?? ''}
        draft={draft}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onBack={() => setScreen('landing')}
        mode={creating ? 'create' : 'join'}
        myKey={room.me.id}
        onUseKey={(key) => {
          // Ключ — это и есть место за столом: становимся тем же человеком.
          room.setIdentity({ id: key })
          setDraft((d) => ({ ...d, id: key }))
        }}
        error={room.error}
        busy={room.connecting}
        onSubmit={async (role) => {
          const ok = creating
            ? await room.create(draft)
            : await room.join(room.urlCode ?? '', draft, role)
          if (ok) setScreen('lobby')
        }}
      />
    )
  }

  return (
    <Landing
      joinCode={room.urlCode ?? undefined}
      устарела={
        game.устарела
          ? { ходов: game.устарела.ходов, onOk: game.забытьУстаревшую }
          : undefined
      }
      войти={authAvailable() && !вошёл ? openLogin : undefined}
      saved={
        game.table
          ? {
              players: game.table.seats.filter((x) => !x.isBot).map((x) => x.name),
              bots: game.table.seats.filter((x) => x.isBot).length,
              turn: game.table.turnCounter,
              onResume: () => setScreen('game'),
              onDiscard: () => game.reset(),
            }
          : undefined
      }
      onLocal={() => setScreen('local')}
      onCreate={() => setScreen('create')}
      onJoin={() => setScreen('join')}
      topRight={<><AccountButton /><ThemeToggle /></>}
    />
  )
}
