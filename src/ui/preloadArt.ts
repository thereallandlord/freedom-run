/**
 * Предзагрузка иллюстраций: карта должна появляться СРАЗУ, а не догружаться
 * на глазах у игрока.
 *
 * 🔴 Почему не `<link rel=preload>` на всё сразу: картинок 347 на 20 МБ. Если
 * дёрнуть их разом, браузер забьёт очередь и первый же ход будет ждать. Здесь
 * два круга: сперва то, что вот-вот понадобится (ближайшие карты каждой
 * колоды и мировые события), потом, в простое, всё остальное по четыре штуки
 * за раз. К концу первой минуты кэш полон, и ожидания больше нет.
 *
 * Загруженное помним в множестве: браузер и сам кэширует, но повторный
 * `new Image()` на каждый ход — лишняя работа в главном потоке.
 */
import artManifest from '../data/card-art.json'

type Manifest = Record<string, Record<string, string> | string>

const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? '/'
const withBase = (p: string) => BASE.replace(/\/$/, '') + p

const done = new Set<string>()
let idleQueued = false

function warm(url: string | null | undefined): void {
  if (!url || done.has(url)) return
  done.add(url)
  const img = new Image()
  // Низкий приоритет: картинки будущих ходов не должны спорить с текущим экраном.
  img.fetchPriority = 'low'
  img.decoding = 'async'
  img.src = url
}

/** Все пути из манифеста — плоским списком. */
function allArt(): string[] {
  const out: string[] = []
  for (const group of Object.values(artManifest as Manifest)) {
    if (typeof group !== 'object' || group === null) continue
    for (const p of Object.values(group)) if (typeof p === 'string') out.push(withBase(p))
  }
  return out
}

/** Ближний круг: то, что игрок увидит в ближайшие ходы. */
export function warmNow(urls: (string | null | undefined)[]): void {
  for (const u of urls) warm(u)
}

/**
 * Дальний круг: в простое дотягиваем остальное по четыре штуки за раз.
 * Запускается один раз за сессию.
 */
export function warmRestWhenIdle(): void {
  if (idleQueued) return
  idleQueued = true

  const queue = allArt().filter((u) => !done.has(u))
  let i = 0
  const CHUNK = 4

  const step = () => {
    if (i >= queue.length) return
    const batch = queue.slice(i, i + CHUNK)
    i += CHUNK
    let left = batch.length
    const next = () => {
      if (--left > 0) return
      schedule(step)
    }
    for (const url of batch) {
      if (done.has(url)) {
        next()
        continue
      }
      done.add(url)
      const img = new Image()
      img.fetchPriority = 'low'
      img.decoding = 'async'
      img.onload = next
      img.onerror = next
      img.src = url
    }
  }

  schedule(step)
}

/** requestIdleCallback есть не везде (Safari до 17) — там обычная отсрочка. */
function schedule(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback
  if (ric) ric(fn)
  else window.setTimeout(fn, 120)
}
