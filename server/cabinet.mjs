/**
 * Кабинет: кто пришёл и его сыгранные партии.
 *
 * 🔴 Личность берётся ТОЛЬКО из заголовка `Authorization: Bearer`. Ничего из
 * тела запроса и из адреса личностью не считается: параметр вроде `?user_id=`
 * — это заявка, а не удостоверение, и на этом уже обжигались в основном
 * сервисе (чужая библиотека фотографий отдавалась вообще без входа).
 *
 * 🔴 В базу ходим служебным ключом. У всех таблиц включён RLS (в проекте стоит
 * заслон, который включает его на КАЖДОЙ новой таблице), служебный ключ его
 * обходит — значит доступ ограничиваем МЫ, здесь, и нигде больше.
 */

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const ANON = process.env.SUPABASE_ANON_KEY || ''
const SERVICE = process.env.SUPABASE_SERVICE_KEY || ''

export function cabinetReady() {
  return Boolean(SB && ANON && SERVICE)
}

// ─────────────────────────── кто пришёл ───────────────────────────

/*
 * Проверять подпись токена самим — значит тащить сюда разбор JWKS и ECDSA.
 * Вместо этого спрашиваем у самого Supabase: он и подпись проверит, и срок.
 * Ответ держим в памяти пять минут, иначе на каждый чих будет поход по сети.
 */
const seen = new Map() // токен → { at, user }
const SEEN_TTL_MS = 5 * 60_000
const SEEN_MAX = 500

export async function whoIs(req) {
  const h = req.headers.authorization || ''
  if (!h.toLowerCase().startsWith('bearer ')) return null
  const token = h.slice(7).trim()
  if (!token || token.split('.').length !== 3) return null

  const hit = seen.get(token)
  if (hit && Date.now() - hit.at < SEEN_TTL_MS) return hit.user

  try {
    const res = await fetch(`${SB}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const u = await res.json()
    if (!u?.id) return null
    const meta = u.user_metadata || {}
    const email = u.email || ''
    const user = {
      id: u.id,
      email,
      name: meta.first_name || meta.full_name || meta.name || email.split('@')[0] || 'Игрок',
    }
    // Простая уборка: словарь не должен расти без предела.
    if (seen.size > SEEN_MAX) seen.clear()
    seen.set(token, { at: Date.now(), user })
    return user
  } catch {
    return null
  }
}

// ─────────────────────────── база ───────────────────────────

async function rest(path, init = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const err = new Error(`база ответила ${res.status}: ${text.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return data
}

// ─────────────────────────── сохранение партии ───────────────────────────

/**
 * Записать партию. Присылают её ВСЕ игроки сразу, поэтому:
 * 1) сама партия кладётся по уникальному ключу — сколько бы раз ни прислали,
 *    строка будет одна;
 * 2) строки игроков пишутся БЕЗ поля владельца, а своё место каждый
 *    привязывает к себе отдельным запросом.
 *
 * 🔴 Пункт (2) не про красоту. Если писать владельца вместе со всеми местами,
 * второй игрок затрёт привязку первого пустым значением — и партия пропадёт
 * из его кабинета, хотя он в ней играл.
 */
export async function saveGame(user, body) {
  const key = String(body?.gameKey || '').slice(0, 64)
  if (!key) throw Object.assign(new Error('нет ключа партии'), { status: 400 })
  const seats = Array.isArray(body?.seats) ? body.seats : []

  const [game] = await rest('cf_games?on_conflict=game_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([
      {
        game_key: key,
        room: body?.room ?? null,
        turns: Number(body?.turns) || 0,
        /*
         * 🔴 НЕЗАКОНЧЕННАЯ партия хранится с пустым временем финиша. Так
         * получается «сохранение в облаке»: если из комнаты вышли все, поднять
         * стол было неоткуда — журнал жил только в браузерах игроков. Отдельная
         * колонка-флаг тут не нужна: пустой финиш и ЗНАЧИТ «ещё играем».
         */
        finished_at: body?.finished === false ? null : new Date().toISOString(),
        seats: seats.map((s) => ({ name: s.name, track: s.track, isBot: !!s.isBot })),
        journal: body?.journal ?? null,
        setup: body?.setup ?? null,
      },
    ]),
  })
  if (!game?.id) throw new Error('партия не записалась')

  if (seats.length) {
    await rest('cf_game_players?on_conflict=game_id,seat_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(
        seats.map((s) => ({
          game_id: game.id,
          seat_id: String(s.seatId),
          name: s.name ?? null,
          profession: s.profession ?? null,
          track: s.track ?? null,
          cash: num(s.cash),
          passive: num(s.passive),
          expenses: num(s.expenses),
          net_worth: num(s.netWorth),
        })),
      ),
    })
  }

  const mine = body?.mySeatId ? String(body.mySeatId) : null
  if (mine) {
    await rest(
      `cf_game_players?game_id=eq.${game.id}&seat_id=eq.${encodeURIComponent(mine)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ auth_id: user.id }),
      },
    )
  }
  return { id: game.id }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Дописать разбор к СВОЕЙ строке. Чужую тронуть нельзя — фильтр по владельцу. */
export async function saveDebrief(user, gameId, seatId, text) {
  const t = String(text || '').slice(0, 8000)
  if (!t) return { ok: false }
  // Просим вернуть изменённое: без этого «ok» приходил бы и тогда, когда
  // фильтр по владельцу не нашёл ни одной строки, — то есть врал бы.
  const rows =
    (await rest(
      `cf_game_players?game_id=eq.${encodeURIComponent(gameId)}` +
        `&seat_id=eq.${encodeURIComponent(seatId)}&auth_id=eq.${user.id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ debrief: t, debrief_at: new Date().toISOString() }),
      },
    )) || []
  return { ok: rows.length > 0 }
}

/** Мои партии, свежие сверху. */
export async function listGames(user) {
  const rows =
    (await rest(
      `cf_game_players?auth_id=eq.${user.id}` +
        `&select=seat_id,name,profession,track,passive,net_worth,debrief,` +
        `cf_games(id,room,finished_at,turns,seats,setup,journal)&limit=100`,
    )) || []

  const games = rows
    .filter((r) => r.cf_games)
    .map((r) => ({
      id: r.cf_games.id,
      room: r.cf_games.room,
      finishedAt: r.cf_games.finished_at,
      turns: r.cf_games.turns,
      seats: Array.isArray(r.cf_games.seats) ? r.cf_games.seats : [],
      // Для незаконченных отдаём и журнал: из него стол поднимается заново.
      setup: r.cf_games.finished_at ? null : (r.cf_games.setup ?? null),
      journal: r.cf_games.finished_at ? null : (r.cf_games.journal ?? null),
      me: {
        seatId: r.seat_id,
        name: r.name,
        profession: r.profession,
        track: r.track,
        passive: Number(r.passive ?? 0),
        netWorth: Number(r.net_worth ?? 0),
        debrief: r.debrief,
      },
    }))
    // Незаконченные — наверх: за ними и приходят.
    .sort((a, b) =>
      Number(!!a.finishedAt) - Number(!!b.finishedAt) ||
      String(b.finishedAt ?? '').localeCompare(String(a.finishedAt ?? '')),
    )
  return { games }
}

// ─────────────────────────── правки хозяина ───────────────────────────

/**
 * Правки игры из панели: числа и тексты поверх колод.
 *
 * 🔴 ХРАНИМ ФАЙЛОМ В STORAGE, А НЕ ТАБЛИЦЕЙ. Таблица потребовала бы миграции,
 * а её надо применять руками — и до тех пор панель молча не работала бы.
 * Правки — это один небольшой JSON, которому не нужны ни строки, ни индексы,
 * ни выборки. Файл честнее описывает то, чем они являются.
 *
 * 🔴 ПИСАТЬ МОЖЕТ ТОЛЬКО ХОЗЯИН. Список его учёток — в переменной
 * `ADMIN_AUTH_IDS`. Пусто — писать не может НИКТО: открытая запись означала бы,
 * что любой вошедший меняет правила игры всем за столом.
 */
const ПРАВКИ_БАКЕТ = 'game-rules'
const ПРАВКИ_ФАЙЛ = 'current.json'

function хозяева() {
  return (process.env.ADMIN_AUTH_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

export function этоХозяин(user) {
  const список = хозяева()
  return !!user?.id && список.includes(user.id)
}

async function бакетЕсть() {
  // Заводим бакет при первой записи: отдельного шага настройки быть не должно.
  const res = await fetch(`${SB}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: ПРАВКИ_БАКЕТ, name: ПРАВКИ_БАКЕТ, public: false }),
  })
  // 409 — бакет уже есть, это норма и не ошибка.
  if (!res.ok && res.status !== 409) {
    const t = await res.text()
    throw new Error(`бакет правок: ${res.status} ${t.slice(0, 120)}`)
  }
}

export async function читатьПравки() {
  try {
    const res = await fetch(
      `${SB}/storage/v1/object/${ПРАВКИ_БАКЕТ}/${ПРАВКИ_ФАЙЛ}`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    )
    if (!res.ok) return {}
    return await res.json()
  } catch {
    /*
     * 🔴 Молчим и отдаём пустое. Правок может не быть вовсе, Storage может быть
     * недоступен — игра обязана работать и без них, на числах из колод.
     */
    return {}
  }
}

export async function писатьПравки(user, правки) {
  if (!этоХозяин(user)) {
    throw Object.assign(new Error('менять правила игры может только хозяин'), { status: 403 })
  }
  if (!правки || typeof правки !== 'object') {
    throw Object.assign(new Error('правки должны быть объектом'), { status: 400 })
  }
  const тело = JSON.stringify({ ...правки, когда: new Date().toISOString() })
  // Небольшой потолок: панель правит числа и подписи, а не грузит сюда файлы.
  if (тело.length > 512 * 1024) {
    throw Object.assign(new Error('правки слишком большие'), { status: 413 })
  }
  await бакетЕсть()
  const res = await fetch(
    `${SB}/storage/v1/object/${ПРАВКИ_БАКЕТ}/${ПРАВКИ_ФАЙЛ}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'content-type': 'application/json',
        // Перезаписываем поверх: правки всегда одни, история тут не нужна.
        'x-upsert': 'true',
      },
      body: тело,
    },
  )
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`не записалось: ${res.status} ${t.slice(0, 160)}`)
  }
  return { ok: true }
}
