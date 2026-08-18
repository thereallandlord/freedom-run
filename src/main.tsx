import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App'
import { ensureFreshBuild } from './ui/freshBuild'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Проверяем свежесть сборки сразу после первой отрисовки (см. freshBuild.ts).
void ensureFreshBuild()
