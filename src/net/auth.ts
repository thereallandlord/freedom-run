/**
 * Вход в аккаунт.
 *
 * 🔴 Ходим в Supabase Auth НАПРЯМУЮ, без библиотеки — так же, как это делает
 * панель GreenLeaf. Причина не в экономии килобайт: клиент Supabase у нас уже
 * создан для онлайн-комнат, он ходит анонимно и сессию сознательно НЕ хранит.
 * Если научить тот же клиент ещё и аккаунтам, он начнёт передёргивать сокет
 * комнаты при каждом обновлении токена — то есть посреди партии. Поэтому две
 * непересекающиеся вещи: комнаты живут своей жизнью, вход — своей.
 *
 * 🔴 Вход НЕОБЯЗАТЕЛЕН и никогда не встаёт на пути к игре. Не настроен, не
 * отвечает, человек не захотел — партия идёт как шла. Аккаунт добавляет две
 * вещи: место за столом узнаётся с любого устройства и партии сохраняются.
 *
 * Аккаунт общий с Craft: одна почта работает в обоих сервисах.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'

export interface AuthUser {
  id: string
  email: string
  name: string
}

interface Session {
  access: string
  refresh: string
  /** Когда протухает access, миллисекунды эпохи. */
  expires: number
  user: AuthUser
}

const KEY = 'freedom-run:auth:v1'
/** За сколько до конца срока идём за новым токеном. */
const RENEW_BEFORE_MS = 60_000

let session: Session | null = read()
const listeners = new Set<(u: AuthUser | null) => void>()

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    return s?.access && s?.user?.id ? s : null
  } catch {
    // Приватный режим или битая запись — просто считаем, что не вошли.
    return null
  }
}

function write(s: Session | null) {
  session = s
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* инкогнито: сессия проживёт до перезагрузки, и это лучше, чем падение */
  }
  for (const cb of listeners) cb(s?.user ?? null)
}

/** Что нам нужно от ответа Supabase: токены и кто это. */
function toSession(d: Record<string, unknown>): Session | null {
  const access = String(d.access_token ?? '')
  if (!access) return null
  const u = (d.user ?? {}) as Record<string, unknown>
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>
  const email = String(u.email ?? '')
  const secs = Number(d.expires_in ?? 3600)
  return {
    access,
    refresh: String(d.refresh_token ?? ''),
    expires: Date.now() + secs * 1000,
    user: {
      id: String(u.id ?? ''),
      email,
      // Имя берём из профиля, иначе — часть почты до собаки: «Игрок» скучнее.
      name: String(meta.first_name || meta.full_name || meta.name || email.split('@')[0] || 'Игрок'),
    },
  }
}

/** Человеческая формулировка вместо английской технической. */
function humanError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('invalid login')) return 'Неверная почта или пароль.'
  if (m.includes('already registered')) return 'Такая почта уже есть — войдите.'
  if (m.includes('email not confirmed')) return 'Почта не подтверждена — проверьте письмо.'
  if (m.includes('password should be')) return 'Пароль — от шести символов.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком часто. Подождите минуту.'
  return raw || 'Не получилось. Попробуйте ещё раз.'
}

async function callAuth(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  })
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(
      humanError(String(d.error_description ?? d.msg ?? d.message ?? `ошибка ${res.status}`)),
    )
  }
  return d
}

// ─────────────────────────── что наружу ───────────────────────────

export function authAvailable(): boolean {
  return isSupabaseConfigured()
}

export function currentUser(): AuthUser | null {
  return session?.user ?? null
}

/** Подписка на вход и выход. Возвращает отписку. */
export function onAuth(cb: (u: AuthUser | null) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export async function signInPassword(email: string, password: string): Promise<void> {
  const d = await callAuth('token?grant_type=password', { email, password })
  const s = toSession(d)
  if (!s) throw new Error('Supabase не вернул токен.')
  write(s)
}

/**
 * Регистрация. Если у проекта включено подтверждение почты, токена сразу не
 * будет — возвращаем false, и экран показывает «проверьте письмо».
 */
export async function signUpPassword(
  email: string,
  password: string,
  name: string,
): Promise<boolean> {
  const d = await callAuth('signup', { email, password, data: { first_name: name } })
  const s = toSession(d)
  if (!s) return false
  write(s)
  return true
}

/**
 * Вход через Google.
 *
 * 🔴 Возвращаемся РОВНО на тот адрес, откуда ушли, вместе с кодом комнаты:
 * человек мог нажать «войти», уже сидя за столом. Домен обязан быть в списке
 * Redirect URLs у Supabase — незнакомый он молча подменяет на свой Site URL,
 * и человек оказывается в другом сервисе.
 */
export function signInGoogle(): void {
  const back = location.origin + location.pathname + location.search
  location.href =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=` + encodeURIComponent(back)
}

export function signOut(): void {
  const s = session
  write(null)
  // Сервер уведомляем вдогонку: наш выход не должен ждать сети.
  if (s?.access) {
    void fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access}` },
    }).catch(() => {})
  }
}

/**
 * Забрать токен из адреса после возврата от Google.
 *
 * Вызывается один раз при запуске. Токен приходит в хэше — его видит только
 * браузер, на сервер он не попадает; мы его забираем и сразу подчищаем адрес,
 * чтобы он не остался в истории и в пересланной ссылке.
 */
export function consumeAuthHash(): boolean {
  if (!location.hash || location.hash.length < 2) return false
  const h = new URLSearchParams(location.hash.slice(1))
  const access = h.get('access_token')
  if (!access) return false
  const expires = Date.now() + Number(h.get('expires_in') ?? 3600) * 1000
  // В хэше приходят только токены — кто это, спросим у Supabase следующим шагом.
  write({
    access,
    refresh: h.get('refresh_token') ?? '',
    expires,
    user: { id: '', email: '', name: '…' },
  })
  history.replaceState(null, '', location.pathname + location.search)
  void refreshUser()
  return true
}

/** Дочитать, кто мы, по уже полученному токену. */
async function refreshUser(): Promise<void> {
  const s = session
  if (!s?.access) return
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access}` },
    })
    if (!res.ok) return void write(null)
    const u = (await res.json()) as Record<string, unknown>
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>
    const email = String(u.email ?? '')
    write({
      ...s,
      user: {
        id: String(u.id ?? ''),
        email,
        name: String(
          meta.first_name || meta.full_name || meta.name || email.split('@')[0] || 'Игрок',
        ),
      },
    })
  } catch {
    /* сеть моргнула — имя дочитаем в следующий раз, вход при этом жив */
  }
}

/**
 * Действующий токен: при необходимости продлевает молча.
 *
 * 🔴 Токен Supabase живёт час. Без продления человек «выходил» сам собой
 * посреди вечера — ровно та жалоба, которую уже ловили в панели.
 */
export async function accessToken(): Promise<string | null> {
  const s = session
  if (!s) return null
  if (Date.now() < s.expires - RENEW_BEFORE_MS) return s.access
  if (!s.refresh) {
    write(null)
    return null
  }
  try {
    const d = await callAuth('token?grant_type=refresh_token', { refresh_token: s.refresh })
    const next = toSession(d)
    if (!next) {
      write(null)
      return null
    }
    // Имя из ответа обновления бывает пустым — оставляем то, что знали.
    write({ ...next, user: next.user.id ? next.user : s.user })
    return next.access
  } catch {
    // Отказ обмена = сессия кончилась. Тихо выходим, ничего не ломая.
    write(null)
    return null
  }
}

/** Запрос к нашему серверу от имени вошедшего. Не вошёл — вернёт null. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await accessToken()
  if (!token) return null
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(path, { ...init, headers })
}

// Имя после возврата от Google подтягиваем сразу, чтобы в шапке не висело «…».
if (session && !session.user.id) void refreshUser()
