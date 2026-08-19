import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App'
import { ensureFreshBuild } from './ui/freshBuild'
import { consumeAuthHash } from './net/auth'

/*
 * 🔴 Токен из адреса забираем ДО первой отрисовки. Google возвращает его в
 * хэше; если сначала отрисоваться, кнопка успеет показать «Войти» человеку,
 * который только что вошёл, и он нажмёт её второй раз.
 */
consumeAuthHash()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Проверяем свежесть сборки сразу после первой отрисовки (см. freshBuild.ts).
void ensureFreshBuild()
