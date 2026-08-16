import { Setup } from './Setup'
import { Game } from './Game'
import { useGame } from './useGame'

export function App() {
  const { table, start, dispatch, undo, reset, rematch, roll, rolling } = useGame()

  if (!table) return <Setup onStart={start} />

  return (
    <Game
      table={table}
      dispatch={dispatch}
      roll={roll}
      rolling={rolling}
      undo={undo}
      reset={reset}
      rematch={rematch}
    />
  )
}
