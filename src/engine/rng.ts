/**
 * Детерминированный ГПСЧ. Один и тот же сид даёт одну и ту же партию —
 * на этом держится и онлайн-синхронизация, и откат хода, и реплей.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** ГПСЧ, позиция которого хранится снаружи: rng(seed, cursor) воспроизводим. */
export function randomAt(seed: number, cursor: number): number {
  const r = mulberry32(seed + cursor * 0x9e3779b1)
  r()
  return r()
}

export function shuffleIndices(count: number, seed: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i)
  const rnd = mulberry32(seed)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
