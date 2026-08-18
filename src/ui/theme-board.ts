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

type Raw = Omit<BoardTheme, 'id' | 'name'> & { name?: string }
const RAW = themes as unknown as Record<string, Raw>

/*
 * Порядок = порядок в переключателе. Фирменные зелёные идут первыми.
 * Клетки рисует код по сетке 7×7, поэтому калибровка темам больше не нужна:
 * миры нарисованы БЕЗ клеток.
 */
/*
 * 🔴 Оформление стола ОДНО (решение Камиля 18.08): семь вариантов никто не
 * перебирал, а каждый требовал своей проверки на контраст — и половина
 * подписей на них не читалась. Оставлен бывший «Мятный минимал» под именем
 * «Классический». Переключатель сам исчезает, пока вариант один: выпадающий
 * список из одного пункта — это не выбор, а мусор в строке кнопок.
 * Остальные картинки лежат в public и ждут: чтобы вернуть, достаточно
 * дописать строку сюда.
 */
const NAMES: { id: string; name: string }[] = [{ id: 'mint', name: 'Классический' }]

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
const DEFAULT_ID = BOARD_THEMES[0]?.id ?? 'leaf'

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
export function themeVars(t: BoardTheme, appDark = false): React.CSSProperties {
  /*
   * 🔴 Тёмная тема ИНТЕРФЕЙСА перекрашивает и стол. Раньше палитра зависела
   * только от картинки поля: карта светлая — значит светлые панели, хоть весь
   * остальной сайт в тёмной теме. На тёмном экране это и давало «элементы,
   * которые нельзя прочитать»: тёмный текст на тёмном стекле.
   *
   * Тёмный набор мягкий, а не чёрный: тёплый уголь вместо смолы, подписи
   * приглушённые, но выше порога читаемости, рамки видны.
   */
  const dark = appDark || t.dark
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    ...({
      '--t-edge': dark ? '#20242A' : t.edge,
      '--t-panel': dark ? '#252A31' : t.panel,
      '--t-ink': dark ? '#ECEFEA' : t.ink,
      '--t-muted': dark ? '#A6ADB4' : t.muted,
      '--t-accent': dark ? '#3FCF97' : t.accent,
      '--t-line': dark ? 'rgba(255,255,255,0.16)' : 'rgba(20,28,24,0.12)',
      '--t-glass': dark ? 'rgba(32,36,42,0.82)' : 'rgba(255,255,255,0.78)',
      '--t-panel-2': dark ? 'rgba(255,255,255,0.07)' : 'rgba(20,28,24,0.04)',
      '--t-cell': dark ? 'rgba(24,28,33,0.62)' : 'rgba(255,255,255,0.42)',
      '--t-cell-line': dark ? 'rgba(255,255,255,0.22)' : 'rgba(20,28,24,0.18)',
      '--t-on-accent': dark ? '#0B1310' : '#FFFFFF',
      /* Светлую карту под тёмной темой приглушаем — иначе она бьёт по глазам. */
      '--t-scene-dim': dark ? '0.55' : '0',
    } as React.CSSProperties),
  }
}
