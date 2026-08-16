import { useEffect, useMemo, useState } from 'react'
import { Setup } from './Setup'
import { Game } from './Game'
import { Landing } from './Landing'
import { JoinRoom, Lobby } from './Lobby'
import { useGame } from './useGame'
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
      {isDark ? '☀️' : '🌙'}
    </button>
  )
}

export function App() {
  const game = useGame()
  // Транспорт создаётся один раз: Supabase, если заданы ключи, иначе вкладки одного браузера.
  const transport = useMemo(() => createTransport('auto'), [])
  const room = useRoom({ transport })

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
   * Сохранённая партия подхватывается сама — но только если человек не пришёл
   * по ссылке-приглашению и не сидит в лобби: иначе вместо входа в комнату
   * ему открылся бы вчерашний стол.
   */
  const roomFlow = screen === 'join' || screen === 'create' || screen === 'lobby'
  if (game.table && !roomFlow) {
    return (
      <Game
        table={game.table}
        dispatch={game.dispatch}
        roll={game.roll}
        rolling={game.rolling}
        undo={game.undo}
        reset={() => {
          game.reset()
          setScreen('landing')
        }}
        rematch={game.rematch}
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
      onLocal={() => setScreen('local')}
      onCreate={() => setScreen('create')}
      onJoin={() => setScreen('join')}
      topRight={<ThemeToggle />}
    />
  )
}
