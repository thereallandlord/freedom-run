/**
 * Кладёт рядом со сборкой version.json с номером текущей сборки.
 * Страница читает его без кэша и, если номер не совпал с зашитым в коде,
 * один раз перезагружается — иначе Safari может держать старый index.html
 * сколько угодно, и два игрока окажутся на разных правилах.
 */
import fs from 'node:fs'
import path from 'node:path'

const dist = process.argv[2] ?? 'dist'
const id = process.argv[3] ?? String(Date.now())
fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ build: id }))
console.log('version.json:', id)
