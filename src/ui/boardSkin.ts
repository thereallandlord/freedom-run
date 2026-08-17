/**
 * Поле доски — то, как выглядит стол. Меняется на лету, в партии.
 *
 * Полей может быть сколько угодно: каждое это картинка от GPT Image плюс
 * запись в src/data/board-cells.json, куда калибровка положила координаты
 * нарисованных клеток. Добавить новое поле = нарисовать картинку, прогнать
 * scripts/calibrate-board.py и дописать одну строку сюда.
 *
 * Выбор живёт в localStorage, а не в столе: это оформление, а не правила.
 * Иначе он попал бы в журнал событий и разошёлся бы между игроками онлайн.
 */
import { useSyncExternalStore } from 'react'

export interface BoardSkin {
  id: string
  name: string
  /** Ключ в board-cells.json с координатами клеток этого поля. */
  calib: string
  /** Файл картинки в public/cards. */
  file: string
  /** Название игры печатается поверх доски — у фирменного поля. */
  brand?: boolean
  /** Цвет подписей поверх тёмного поля. */
  dark?: boolean
}

export const BOARD_SKINS: BoardSkin[] = [
  {
    id: 'island',
    name: 'Тропический остров',
    calib: 'tbl-island',
    file: 'table-island.webp',
  },
  {
    id: 'greenleaf',
    name: 'GreenLeaf',
    calib: 'tbl-greenleaf',
    file: 'table-greenleaf.webp',
    brand: true,
    dark: true,
  },
]

const KEY = 'freedom-run:board-skin:v1'
const DEFAULT_ID = 'island'

function read(): string {
  try {
    const v = localStorage.getItem(KEY)
    if (v && BOARD_SKINS.some((s) => s.id === v)) return v
  } catch {
    /* приватный режим — просто берём поле по умолчанию */
  }
  return DEFAULT_ID
}

const subs = new Set<() => void>()
let current = read()

export function setBoardSkin(id: string) {
  if (!BOARD_SKINS.some((s) => s.id === id)) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* не смогли запомнить — но в этой партии поле уже сменилось */
  }
  subs.forEach((f) => f())
}

/** Текущее поле. Компоненты перерисовываются сразу после смены. */
export function useBoardSkin(): BoardSkin {
  const id = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current,
    () => DEFAULT_ID,
  )
  return BOARD_SKINS.find((s) => s.id === id) ?? BOARD_SKINS[0]
}
