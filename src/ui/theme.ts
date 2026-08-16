import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

/** Ключ обязан совпадать с инлайн-скриптом в index.html, иначе тема мигает при загрузке. */
export const THEME_STORAGE_KEY = 'freedom-run:theme'

const DEFAULT_THEME: Theme = 'light'

const listeners = new Set<() => void>()

/**
 * Источник правды — атрибут на <html>: его же ставит инлайн-скрипт до отрисовки,
 * поэтому состояние хука и реальная тема не могут разойтись.
 */
function readTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

// useSyncExternalStore сравнивает снимки по ссылке, а строки сравниваются по значению —
// кэш не нужен, лишних перерисовок не будет.
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme

  // Цвет строки состояния браузера на телефоне — иначе она остаётся от прошлой темы.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b0d12' : '#f7f6f2')
}

export function setTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  if (readTheme() === theme) return

  applyTheme(theme)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Приватный режим Safari: тему применили, просто не запомнили.
  }
  listeners.forEach((cb) => cb())
}

export function toggleTheme() {
  setTheme(readTheme() === 'dark' ? 'light' : 'dark')
}

export function getTheme(): Theme {
  return readTheme()
}

/**
 * Тема с сохранением выбора. По умолчанию — светлая.
 *
 *   const { theme, isDark, toggle } = useTheme()
 *   <button className="btn-ghost tap" onClick={toggle}>{isDark ? '☀' : '☾'}</button>
 *
 * Все вызовы хука делят одно состояние: переключатель можно ставить где угодно.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME)

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggle: toggleTheme,
  }
}
