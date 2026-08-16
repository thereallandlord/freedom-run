import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Единственная точка создания клиента Supabase.
 *
 * Онлайн у нас необязательный: игра обязана полностью работать без сети и без
 * настроенных ключей. Поэтому здесь никогда ничего не бросается — при отсутствии
 * или кривых переменных окружения экспортируется null, а транспорт молча уходит
 * в локальный режим (см. realtime.ts).
 */

/**
 * Читаем переменные через каст, а не через `declare global { interface ImportMeta }`:
 * если в проект позже добавят `vite/client`, наша декларация конфликтовала бы с
 * его обязательным полем `env`. Каст такой проблемы не создаёт.
 * Заодно подхватываем process.env — чтобы файл можно было импортировать в node-тестах.
 */
function readEnv(name: string): string {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return (viteEnv?.[name] ?? nodeEnv?.[name] ?? '').trim()
}

export const SUPABASE_URL = readEnv('VITE_SUPABASE_URL')
export const SUPABASE_ANON_KEY = readEnv('VITE_SUPABASE_ANON_KEY')

/**
 * Проверяем не «переменная задана», а «в неё положили что-то похожее на правду»:
 * пустая строка, `undefined` строкой и placeholder из .env.example — частые случаи,
 * и с ними лучше честно уйти в офлайн, чем ловить непонятную ошибку сокета.
 */
export function isSupabaseConfigured(): boolean {
  const urlOk = /^https?:\/\/.+/i.test(SUPABASE_URL) && !SUPABASE_URL.includes('your-project')
  const keyOk = SUPABASE_ANON_KEY.length >= 20 && !/^(your|paste|changeme)/i.test(SUPABASE_ANON_KEY)
  return urlOk && keyOk
}

function makeClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null
  try {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Аккаунтов в игре нет — ходим анонимно. Без этого клиент писал бы сессию
      // в localStorage и держал таймер обновления токена, что на телефоне лишнее.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // Пилюля от штатного лимита: партия — это редкие клики, но раздача журнала
      // новичку идёт пачкой, и дефолтные 10 сообщений/сек её притормаживают.
      realtime: { params: { eventsPerSecond: 25 } },
    })
  } catch (err) {
    console.warn('[net] Supabase недоступен, играем офлайн:', err)
    return null
  }
}

/** null = ключей нет или клиент не создался. Игра в этом случае просто локальная. */
export const supabase: SupabaseClient | null = makeClient()

export function getSupabase(): SupabaseClient | null {
  return supabase
}

export type { SupabaseClient }
