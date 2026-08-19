/**
 * Вход в аккаунт — окно поверх экрана.
 *
 * Раскладка повторяет вход панели GreenLeaf (решение Камиля 19.08): те же две
 * вкладки, та же кнопка Google сверху, та же почта с паролем и глазком.
 * Человек, который ходит в оба сервиса, видит одну и ту же дверь.
 *
 * 🔴 Отдельным окном, а не отдельной страницей: игра — одностраничное
 * приложение, и уход на другой адрес посреди партии выбросил бы человека
 * из-за стола. Отсюда всегда можно закрыться и продолжить играть без входа.
 */
import { useEffect, useState } from 'react'
import { signInGoogle, signInPassword, signUpPassword } from '../net/auth'

const ГЛАЗ_ОТКР = (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
)

const ГЛАЗ_ЗАКР = (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3l18 18" />
    <path d="M10.6 6.2A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.4 4.1" />
    <path d="M6.4 7.9A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1.4 0 2.6-.3 3.7-.8" />
    <path d="M9.6 9.7a2.8 2.8 0 0 0 3.9 3.9" />
  </svg>
)

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
      />
    </svg>
  )
}

export function LoginModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [peek, setPeek] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; kind: 'err' | 'ok' | '' } | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  async function submit() {
    if (busy) return
    if (!email.trim() || !password) {
      setMsg({ text: 'Заполните почту и пароль.', kind: 'err' })
      return
    }
    if (mode === 'up' && password.length < 6) {
      setMsg({ text: 'Пароль — от шести символов.', kind: 'err' })
      return
    }
    setBusy(true)
    setMsg({ text: mode === 'in' ? 'Проверяю…' : 'Создаю аккаунт…', kind: '' })
    try {
      if (mode === 'in') {
        await signInPassword(email.trim(), password)
        onClose()
        return
      }
      const entered = await signUpPassword(email.trim(), password, name.trim())
      if (entered) {
        onClose()
        return
      }
      // Подтверждение почты включено — токена сразу нет.
      setMsg({ text: 'Готово. Проверьте почту — там ссылка для подтверждения.', kind: 'ok' })
    } catch (e) {
      setMsg({ text: (e as Error).message, kind: 'err' })
    }
    setBusy(false)
  }

  return (
    <div
      className="modal-layer fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="pop-in panel w-full max-w-[420px] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-lg">
            🌿
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold leading-tight">Вход в кабинет</div>
            <div className="text-[12px] text-[var(--muted)]">Экосистема Craft</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto shrink-0 text-[var(--muted)] hover:text-[var(--ink)]"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Вкладки — как в панели: переключатель сверху, а не ссылка внизу. */}
        <div className="mb-5 flex gap-0.5 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-[3px]">
          {(['in', 'up'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setMsg(null)
              }}
              className={`flex-1 rounded-[9px] px-3 py-2 text-[13.5px] transition ${
                mode === m
                  ? 'bg-[var(--panel)] font-semibold shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {m === 'in' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>

        <button
          onClick={signInGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3 text-[14px] transition hover:border-accent/50 disabled:opacity-55"
        >
          <GoogleMark />
          {mode === 'in' ? 'Продолжить с Google' : 'Зарегистрироваться через Google'}
        </button>

        <div className="my-5 flex items-center gap-3 text-[12px] text-[var(--muted)]">
          <span className="h-px flex-1 bg-[var(--line)]" />
          или по почте
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>

        {mode === 'up' && (
          <Field label="Как вас зовут">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Имя"
              className="login-input"
            />
          </Field>
        )}

        <Field label="Почта">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className="login-input"
          />
        </Field>

        <Field label="Пароль">
          {/*
            Глазок обязателен: пароль вводят вслепую и ошибаются, а «неверный
            пароль» без возможности посмотреть — верный способ потерять человека
            прямо на входе.
          */}
          <div className="relative">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={peek ? 'text' : 'password'}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              className="login-input pr-12"
            />
            <button
              type="button"
              onClick={() => setPeek((v) => !v)}
              aria-label={peek ? 'Скрыть пароль' : 'Показать пароль'}
              className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]"
            >
              {peek ? ГЛАЗ_ЗАКР : ГЛАЗ_ОТКР}
            </button>
          </div>
        </Field>

        <button onClick={() => void submit()} disabled={busy} className="btn-primary mt-2 w-full">
          {mode === 'in' ? 'Войти' : 'Создать аккаунт'}
        </button>

        {msg && (
          <div
            className={`mt-3.5 rounded-xl px-3 py-2.5 text-[13px] ${
              msg.kind === 'err'
                ? 'border border-[rgb(var(--c-bad))]/30 bg-[rgb(var(--c-bad))]/10 text-[rgb(var(--c-bad))]'
                : msg.kind === 'ok'
                  ? 'border border-accent/30 bg-accent/10 text-accent'
                  : 'text-[var(--muted)]'
            }`}
          >
            {msg.text}
          </div>
        )}

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-[var(--muted)]">
          Аккаунт нужен, чтобы партии сохранялись и разбор можно было открыть потом.
          <br />
          Играть можно и без него.
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[12.5px] text-[var(--muted)]">{label}</span>
      {children}
    </label>
  )
}
