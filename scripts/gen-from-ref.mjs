#!/usr/bin/env node
/**
 * Генерация ПО ФАЙЛУ-РЕФЕРЕНСУ.
 *
 * Отличие от gen-illustrations.mjs: там сцена описывается словами, здесь в
 * модель уходит сама картинка Камиля (scripts/refs/N.png) — эндпоинт
 * /v1/images/edits принимает изображения как образец стиля.
 *
 * 🔴 Задача — НЕ копия чужого концепта, а НАШ экран в похожем визуальном
 * языке: промпт явно перечисляет, что должно быть в кадре (кольцо из 24
 * клеток, города, наша раскладка панелей), и запрещает текст — буквы модель
 * путает, надписи всё равно печатает интерфейс.
 *
 * Запуск:
 *   node scripts/gen-from-ref.mjs --ref 6 --out ref6-a --hint "Дубай"
 *   node scripts/gen-from-ref.mjs --ref 1 --out ref1-a --size 1536x1024
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REFS = path.join(ROOT, 'scripts', 'refs')
const OUT = path.join(ROOT, 'public', 'cards')

// Понимаем и `--ref=6`, и `--ref 6`: второй вид я сам же и набрал первым делом.
const args = {}
{
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i])
    if (!m) continue
    if (m[2] !== undefined) {
      args[m[1]] = m[2]
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[m[1]] = argv[++i]
    } else {
      args[m[1]] = true
    }
  }
}

const BOARD =
  'In the middle of the composition place a square game board seen from directly above: a ring of exactly 24 identical empty ' +
  'rounded spaces runs around its outer edge — seven along the top, seven along the bottom, five on the left and five on the right ' +
  'between the corners. Do not add an extra row or column of spaces. The spaces are completely empty. Inside the ring sits a ' +
  'miniature world of famous cities: Dubai needle tower and palm island, Istanbul domes and minarets over the strait, Antalya marina ' +
  'and cliffs, Kazan white kremlin with blue domes, Baku curved towers, Cairo pyramids at the desert edge.'

const PANELS =
  'Around the board, keep the interface layout of the reference: the same kind of side panel, cards, icon rail and floating elements, ' +
  'in the same material and lighting. All panels and cards must be EMPTY containers — nothing written inside them.'

const RULES =
  'This is a board game interface, not a travel or safari app. Replace every icon from the reference with neutral game icons: ' +
  'a die, a coin, a small house, a briefcase, a chart, a person. Do not keep animal paws, savannah trees, bookmarks, hearts, ' +
  'compasses or any travel motifs from the reference. ' +
  'No text, no letters, no numbers, no words, no labels, no logos, no user avatars, no photographs of people anywhere in the image.'

function loadApiKey() {
  const env = (process.env.OPENAI_API_KEY || '').trim()
  if (env) return env
  const key = execSync(
    "railway variables --service craft-ai --environment production --kv | grep '^OPENAI_API_KEY=' | cut -d= -f2-",
    { cwd: path.join(os.homedir(), 'craft-ai'), shell: '/bin/bash', stdio: ['ignore', 'pipe', 'ignore'] },
  )
    .toString()
    .trim()
  if (!key.startsWith('sk-')) throw new Error('не удалось получить ключ из Railway')
  return key
}

async function main() {
  const ref = String(args.ref || '6')
  const out = String(args.out || `ref${ref}-a`)
  const size = String(args.size || '1536x1024')
  const hint = args.hint ? ` ${args.hint}` : ''

  const refPath = path.join(REFS, `${ref}.png`)
  if (!fs.existsSync(refPath)) throw new Error(`нет референса: ${refPath}`)

  const prompt = [
    'Redraw this interface as a full-screen board game interface, keeping its exact visual language:',
    'same palette, same materials, same panel shapes, same lighting and mood.',
    BOARD,
    PANELS,
    hint.trim(),
    RULES,
  ]
    .filter(Boolean)
    .join(' ')

  const form = new FormData()
  form.append('model', 'gpt-image-2')
  form.append('prompt', prompt.slice(0, 4000))
  form.append('size', size)
  form.append('quality', 'low')
  form.append('n', '1')
  form.append('image[]', new Blob([fs.readFileSync(refPath)], { type: 'image/png' }), `${ref}.png`)

  process.stdout.write(`референс ${ref} → ${out} (${size})… `)
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loadApiKey()}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300).replace(/\s+/g, ' ')
    throw new Error(`OpenAI ${res.status}: ${body}`)
  }
  const json = await res.json()
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('пустой ответ модели')

  const png = Buffer.from(b64, 'base64')
  const tmp = path.join(os.tmpdir(), `ref-${process.pid}.png`)
  fs.writeFileSync(tmp, png)
  const dest = path.join(OUT, `${out}.webp`)
  execSync(
    `python3 -c "from PIL import Image;im=Image.open('${tmp}').convert('RGB');im.save('${dest}','WEBP',quality=80,method=6)"`,
  )
  fs.rmSync(tmp, { force: true })
  console.log(`${Math.round(fs.statSync(dest).size / 1024)} КБ`)
}

main().catch((e) => {
  console.error('✗', e.message)
  process.exit(1)
})
