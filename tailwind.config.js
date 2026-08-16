/** @type {import('tailwindcss').Config} */

/**
 * Цвет из CSS-переменной с каналами RGB ("5 150 105").
 * Такой формат нужен, чтобы работали модификаторы прозрачности Tailwind:
 * bg-accent/15, border-line/60 и т.п.
 */
const ch = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  // Тема переключается атрибутом на <html>, а не классом: то же самое читает CSS.
  darkMode: ['selector', '[data-theme="dark"]'],

  theme: {
    extend: {
      colors: {
        // Семантические токены — предпочтительный способ красить UI.
        surface: ch('--c-bg'),
        panel: ch('--c-panel'),
        panel2: ch('--c-panel-2'),
        line: ch('--c-line'),
        ink: ch('--c-ink'),
        muted: ch('--c-muted'),
        accent: {
          DEFAULT: ch('--c-accent'),
          soft: ch('--c-accent-soft'),
          ink: ch('--c-accent-ink'),
        },
        good: ch('--c-good'),
        bad: ch('--c-bad'),
        warn: ch('--c-warn'),

        /**
         * 🔴 Переопределение готовых шкал Tailwind — сознательное.
         * Интерфейс писался под тёмный фон и в разметке зашиты светлые оттенки
         * (text-emerald-400, text-amber-400, text-rose-400, text-violet-300).
         * На белом фоне они дают контраст ~2:1 — текст не читается, а править
         * два десятка компонентов нельзя (их ведут другие агенты).
         * Поэтому "текстовые" ступени берутся из переменных: в тёмной теме
         * значения ровно те же, что у Tailwind по умолчанию (внешне ничего не
         * меняется), в светлой — тёмные варианты того же цвета.
         * Заливочные ступени (500/600) и emerald-950 не трогаем: они одинаково
         * работают на обоих фонах.
         */
        emerald: {
          200: ch('--c-emerald-200'),
          300: ch('--c-emerald-300'),
          400: ch('--c-emerald-400'),
        },
        amber: {
          300: ch('--c-amber-300'),
          400: ch('--c-amber-400'),
        },
        rose: {
          300: ch('--c-rose-300'),
          400: ch('--c-rose-400'),
        },
        violet: {
          300: ch('--c-violet-300'),
        },
      },

      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
      },

      borderRadius: {
        tile: '1rem',
      },

      boxShadow: {
        // Тени живут в переменных: в тёмной теме они глубже и холоднее.
        card: 'var(--shadow-card)',
        tile: 'var(--shadow-tile)',
        pop: 'var(--shadow-pop)',
        glow: 'var(--shadow-glow)',
      },

      // Безопасные зоны айфона — как обычные значения отступов: pb-safe-b, pl-safe-l.
      spacing: {
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
        tap: '44px',
      },

      screens: {
        xs: '380px',
      },

      transitionTimingFunction: {
        pop: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
      },
    },
  },
}
