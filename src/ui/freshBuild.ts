/**
 * Сторож свежести сборки.
 *
 * 🔴 Зачем: Safari умеет отдавать старый index.html даже после «очистить
 * кэш» (⌥⌘E чистит не всё), и человек продолжает играть по правилам
 * недельной давности. В одиночной игре это просто «старая версия», а в
 * сетевой — беда: партия у двоих собирается разным кодом из одного журнала,
 * и столы расходятся.
 *
 * Как: в код зашит номер сборки, рядом лежит version.json с тем же номером.
 * Читаем его МИМО кэша; не совпало — один раз перезагружаемся. Флаг в
 * sessionStorage не даёт зациклиться, если сервер отдаёт старьё намертво.
 */
const BUILD: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
const RELOADED = 'freedom-run:reloaded-for'

export function currentBuild(): string {
  return BUILD
}

export async function ensureFreshBuild(): Promise<void> {
  if (BUILD === 'dev') return
  try {
    const base = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? '/'
    const url = `${base.replace(/\/$/, '')}/version.json?t=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return
    const { build } = (await res.json()) as { build?: string }
    if (!build || build === BUILD) return
    // Перезагружаемся ровно один раз на каждый номер: иначе при странном
    // кэше на прокси страница уйдёт в вечный цикл обновления.
    if (sessionStorage.getItem(RELOADED) === build) return
    sessionStorage.setItem(RELOADED, build)
    location.reload()
  } catch {
    /* сети нет — играем тем, что есть */
  }
}
