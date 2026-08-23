/**
 * Кнопка аккаунта в шапке: «Войти» или имя человека.
 *
 * 🔴 Вход стоит В УГЛУ, а не на пути к игре. Партию можно начать, доиграть и
 * закрыть, ни разу не подумав про аккаунт, — так и задумано. Аккаунт нужен
 * только чтобы партии сохранялись.
 */
import { useEffect, useState } from 'react'
import { authAvailable, currentUser, onAuth, type AuthUser } from '../net/auth'
import { LoginModal } from './LoginModal'
import { Cabinet } from './Cabinet'

/** Кто сейчас вошёл. Перерисовывает того, кто подписался. */
export function useAuthUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(() => currentUser())
  useEffect(() => onAuth(setUser), [])
  return user
}

/**
 * Позвать окно входа снаружи — например, строкой на главной.
 *
 * 🔴 Через общее событие, а не через проброс состояния: кнопка живёт в шапке
 * ЧЕТЫРЁХ разных экранов, и тянуть к каждому из них ещё один флаг — верный
 * способ развести их поведение.
 */
export function openLogin(): void {
  window.dispatchEvent(new CustomEvent('freedom-run:login'))
}

/** Есть ли вообще куда входить: без ключей окна не показываем. */
export { authAvailable }

export function AccountButton({
  поднять,
}: {
  /** Поднять незаконченную партию из кабинета. */
  поднять?: (setup: unknown, journal: unknown) => void
} = {}) {
  const user = useAuthUser()
  const [open, setOpen] = useState<null | 'login' | 'cabinet'>(null)

  useEffect(() => {
    const h = () => setOpen(currentUser() ? 'cabinet' : 'login')
    window.addEventListener('freedom-run:login', h)
    return () => window.removeEventListener('freedom-run:login', h)
  }, [])

  // Ключей нет — вход просто не показываем, вместо неработающей кнопки.
  if (!authAvailable()) return null

  return (
    <>
      <button
        onClick={() => setOpen(user ? 'cabinet' : 'login')}
        className="topbtn max-w-[190px]"
        title={user ? 'Мои партии' : 'Войти в кабинет'}
      >
        {user ? (
          <>
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-ink">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="ml-1.5 truncate">{user.name}</span>
          </>
        ) : (
          <>
            <span aria-hidden>👤</span>
            <span className="ml-1.5">Войти</span>
          </>
        )}
      </button>

      {open === 'login' && <LoginModal onClose={() => setOpen(null)} />}
      {open === 'cabinet' && <Cabinet onClose={() => setOpen(null)} поднять={поднять} />}
    </>
  )
}
