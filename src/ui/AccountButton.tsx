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

export function AccountButton() {
  const user = useAuthUser()
  const [open, setOpen] = useState<null | 'login' | 'cabinet'>(null)

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
      {open === 'cabinet' && <Cabinet onClose={() => setOpen(null)} />}
    </>
  )
}
