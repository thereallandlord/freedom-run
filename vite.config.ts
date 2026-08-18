import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 🔴 Отпечаток сборки. Safari умеет держать старый index.html даже после
 * «очистить кэш», и человек играет по правилам недельной давности — а
 * партия у второго уже по новым. Номер сборки уезжает в код, страница
 * сверяет его с сервером и при расхождении перезагружается сама.
 */
const BUILD_ID = process.env.BUILD_ID ?? String(Date.now())

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  base: './',
  plugins: [react()],
  // host: true — чтобы к тому же серверу можно было зайти с 127.0.0.1 и с телефона.
  server: { port: 5187, host: true },
})
