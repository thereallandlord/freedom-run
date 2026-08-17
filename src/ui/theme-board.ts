/**
 * Тема стола: фон, доска и палитра панелей одним набором.
 *
 * Почему тремя слоями, а не одной картинкой на весь экран (решение Камиля):
 * цельный макет всегда снят под углом, тащит лишние кнопки и не гнётся — ни
 * под телефон, ни под широкий монитор. Фон + доска + панели кодом дают тот же
 * вид и полную гибкость.
 *
 * 🔴 Палитра НЕ подобрана на глаз: scripts/… считает её из самих картинок —
 * по краям фона (там лягут панели) и по доске. Только так код и рисунок
 * читаются как один интерфейс, а не как панель, положенная на обои.
 */
import { useSyncExternalStore } from 'react'
import themes from '../data/board-themes.json'

export interface BoardTheme {
  id: string
  name: string
  /** Ключ калибровки клеток в board-cells.json. */
  calib: string
  bg: string
  board: string
  /** Тёмная сцена — подписи и панели светлые. */
  dark: boolean
  edge: string
  panel: string
  ink: string
  muted: string
  accent: string
}

type Raw = Omit<BoardTheme, 'id' | 'name' | 'calib'>
const RAW = themes as unknown as Record<string, Raw>

const NAMES: { id: string; name: string; calib: string }[] = [
  { id: 'diorama', name: 'Макет городов', calib: 'tbl-city-diorama' },
  { id: 'isometric', name: 'Изометрия', calib: 'tbl-city-isometric' },
  { id: 'soft', name: 'Мягкий современный', calib: 'tbl-city-soft' },
  { id: 'night', name: 'Ночные города', calib: 'tbl-city-night' },
]

/** База сайта: на GitHub Pages приложение живёт в подпапке. */
const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? '/'
const url = (p: string) => BASE.replace(/\/$/, '') + p

export const BOARD_THEMES: BoardTheme[] = NAMES.filter((n) => RAW[n.id]).map((n) => ({
  ...n,
  ...RAW[n.id],
  bg: url(RAW[n.id].bg),
  board: url(RAW[n.id].board),
}))

const KEY = 'freedom-run:board-theme:v1'
const DEFAULT_ID = BOARD_THEMES[0]?.id ?? 'diorama'

function read(): string {
  try {
    const v = localStorage.getItem(KEY)
    if (v && BOARD_THEMES.some((t) => t.id === v)) return v
  } catch {
    /* приватный режим — берём тему по умолчанию */
  }
  return DEFAULT_ID
}

const subs = new Set<() => void>()
let current = read()

export function setBoardTheme(id: string) {
  if (!BOARD_THEMES.some((t) => t.id === id)) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* не запомнили — но в этой партии тема уже сменилась */
  }
  subs.forEach((f) => f())
}

export function useBoardTheme(): BoardTheme {
  const id = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current,
    () => DEFAULT_ID,
  )
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0]
}

/**
 * Переменные темы для CSS. Вешаются на корень экрана стола, дальше панели
 * берут цвета оттуда — ни один цвет не зашит в разметку.
 */
export function themeVars(t: BoardTheme): React.CSSProperties {
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    ...({
      '--t-edge': t.edge,
      '--t-panel': t.panel,
      '--t-ink': t.ink,
      '--t-muted': t.muted,
      '--t-accent': t.accent,
      '--t-line': t.dark ? 'rgba(255,255,255,0.14)' : 'rgba(20,28,24,0.12)',
      '--t-glass': t.dark ? 'rgba(18,24,21,0.62)' : 'rgba(255,255,255,0.72)',
    } as React.CSSProperties),
  }
}
