import { useEffect, useMemo, useRef, useState } from 'react'
import { Setup } from './Setup'
import { Game } from './Game'
import { Landing } from './Landing'
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

  // В разработке транспорт видно из консоли — иначе связь не продиагностировать.
  ;(window as unknown as { __net?: unknown }).__net = transport

  const room = useRoom({
    transport,
    onGameEvent: (ev) => applyRef.current?.(ev as TableEvent),
  })

  /** Онлайн-партия — та, где комната реально существует. */
  const online = !!room.room && room.room.players.length > 0
  const isHost = room.room?.hostId === room.me.id
  const game = useGame(
    online
      ? {
          send: (ev) => sendGameRef.current?.(ev),
          isHost,
        }
      : undefined,
  )
  sendGameRef.current = (ev) => room.sendGame(ev)
  applyRef.current = (ev) => game.applyLocal(ev)

  /** Моё место за столом: порядок мест совпадает с порядком игроков комнаты. */
  const meSeatId = (() => {
    if (!room.room) return undefined
    const i = room.room.players.findIndex((p) => p.id === room.me.id)
    return i >= 0 ? `seat-${i}` : undefined
  })()

  // Пришли по ссылке-приглашению — сразу показываем вход в эту комнату.
  const [screen, setScreen] = useState<Screen>(() => (room.urlCode ? 'join' : 'landing'))

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
    if (!started || !room.room || game.table) return
    game.start(toTableSetup(room.room))
    setScreen('game')
  }, [started, room.room, game])

  /*
   * 🔴 Сохранённая партия САМА на экран не выходит. Раньше стол открывался
   * сразу, как только в браузере лежало сохранение, — и человек, перешедший
   * по обычной ссылке, попадал не на главную, а в чей-то вчерашний стол, без
   * пути обратно. Теперь главная показывается всегда, а прошлая партия ждёт
   * на ней отдельной карточкой «Продолжить».
   */
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
        topRight={<ThemeToggle />}
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
        topRight={<ThemeToggle />}
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
        onStart={() => {
          const setup = room.start()
          if (setup) {
            game.start(setup)
            setScreen('game')
          }
        }}
        topRight={<ThemeToggle />}
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
      topRight={<ThemeToggle />}
    />
  )
}
