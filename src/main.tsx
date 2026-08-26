import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App'
import { ensureFreshBuild } from './ui/freshBuild'
import { consumeAuthHash } from './net/auth'
import { загрузитьПравки } from './net/rulesApi'

/*
 * 🔴 Токен из адреса забираем ДО первой отрисовки. Google возвращает его в
 * хэше; если сначала отрисоваться, кнопка успеет показать «Войти» человеку,
 * который только что вошёл, и он нажмёт её второй раз.
 */
consumeAuthHash()

/*
 * 🔴 Правки хозяина забираем ДО первой отрисовки — и ждём их, а не рисуем
 * поверх. Иначе стол успел бы собраться на числах из колод, а правка пришла
 * бы следом: у двоих за одной партией оказались бы разные карточки.
 * Ожидание ограничено полутора секундами внутри самой загрузки, и на отказ
 * сети мы всё равно рисуем — играть можно и на числах из колод.
 *
 * 🔴 Через `.then`, а не `await` наверху файла: наши цели сборки его не
 * поддерживают, и сборка падает. Смысл тот же — отрисовка после загрузки.
 */
void загрузитьПравки().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
  // Проверяем свежесть сборки сразу после первой отрисовки (см. freshBuild.ts).
  void ensureFreshBuild()
})
