/**
 * Сервер игры: раздаёт саму игру и держит то, что нельзя делать в браузере.
 *
 * 🔴 Зачем он вообще. Ключ от модели нельзя положить в страницу — его увидит
 * любой, кто откроет исходники. Значит нужен посредник: браузер шлёт ему
 * журнал партии, он ходит к модели своим ключом и возвращает текст.
 *
 * 🔴 Почему всё в одном месте (решение Камиля 19.08): игра, разбор и кабинеты
 * живут на одном домене — один деплой, одна авторизация, никаких сложностей с
 * доступом между разными хостами. Кто-то зайдёт через VPN — так и будет.
 *
 * Зависимостей нет намеренно: голый http из Node. Меньше кода — меньше
 * поводов сломаться на деплое.
 */
import { createServer } from 'node:http'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import {
  cabinetReady,
  listGames,
  saveDebrief,
  saveGame,
  whoIs,
  читатьПравки,
  писатьПравки,
  этоХозяин,
} from './cabinet.mjs'

const PORT = Number(process.env.PORT || 8080)
const ROOT = join(process.cwd(), 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}


/** Куда разрешено возвращать человека после входа через Google. */
const AUTH_BACK = new Set(
  [
    'https://cashflow.craftopen.space',
    'https://freedom-run-gamma.vercel.app',
    'https://thereallandlord.github.io/freedom-run',
    ...(process.env.AUTH_BACK_EXTRA || '').split(',').map((x) => x.trim()),
  ].filter(Boolean),
)


/*
 * 🔴 Ограничитель на разбор партии.
 *
 * Ручка `/api/debrief` ходит к модели НАШИМ ключом и до сих пор была открыта
 * настежь: ни входа, ни ограничения частоты, отвечает кому угодно с любого
 * адреса. Один скрипт в цикле — и счёт за модель растёт, пока кто-нибудь не
 * заметит. Нашлось на сверке кода 20.08.
 *
 * Вход требовать НЕЛЬЗЯ: разбор показывается всем, кто доиграл партию, в том
 * числе гостям без аккаунта — это и есть смысл экрана. Поэтому не запрет, а
 * счётчик: сколько разборов с одного адреса в час и сколько всего за сутки.
 * Живому столу на десять человек этого с запасом, скрипту — нет.
 */
const РАЗБОР_В_ЧАС = Number(process.env.DEBRIEF_PER_HOUR || 40)
const РАЗБОР_В_СУТКИ = Number(process.env.DEBRIEF_PER_DAY || 600)
const счётчик = new Map() // адрес → { до, сколько }
let заСутки = { до: 0, сколько: 0 }

function ктоЗвонит(req) {
  // За Railway и Cloudflare настоящий адрес приходит заголовком.
  const h = req.headers['x-forwarded-for']
  if (typeof h === 'string' && h) return h.split(',')[0].trim()
  return req.socket?.remoteAddress || 'неизвестно'
}

/** Пускаем? Возвращает null, если можно, или причину отказа. */
function перебор(req, сейчас) {
  if (сейчас > заСутки.до) заСутки = { до: сейчас + 86_400_000, сколько: 0 }
  if (заСутки.сколько >= РАЗБОР_В_СУТКИ) return 'на сегодня разборов больше нет'
  const кто = ктоЗвонит(req)
  const было = счётчик.get(кто)
  if (!было || сейчас > было.до) {
    счётчик.set(кто, { до: сейчас + 3_600_000, сколько: 1 })
  } else if (было.сколько >= РАЗБОР_В_ЧАС) {
    return 'слишком часто, попробуйте позже'
  } else {
    было.сколько++
  }
  заСутки.сколько++
  // Словарь не должен расти без предела: чистим просроченные записи изредка.
  if (счётчик.size > 5000) {
    for (const [k, v] of счётчик) if (сейчас > v.до) счётчик.delete(k)
  }
  return null
}

/** Разбор партии словами модели. Ключ живёт только здесь. */
async function aiDebrief(body, attempt = 0) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return { error: 'нет ключа модели' }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cashflow.craftopen.space',
      'X-Title': 'Cashflow GreenLeaf',
    },
    body: JSON.stringify({
      model: process.env.DEBRIEF_MODEL || 'anthropic/claude-sonnet-5',
      max_tokens: 1200,
      /*
       * 🔴 Без этого ответ уходит в размышления, а сам текст приходит ПУСТЫМ
       * при честном 200 — на этом уже обжигались в основном сервисе.
       */
      reasoning: { exclude: true },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(body) },
      ],
    }),
  })

  if (!res.ok) return { error: `модель ответила ${res.status}` }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message
  const text = (msg?.content || msg?.reasoning || '').trim()
  // Пустой ответ бывает: обрыв у провайдера. Повторяем один раз, дальше — молча.
  if (!text && attempt < 1) return aiDebrief(body, attempt + 1)
  return text ? { text } : { error: 'пустой ответ модели' }
}

/*
 * 🔴 Правила игры модель ЗНАТЬ ОБЯЗАНА, иначе разбор будет вежливой водой.
 * Здесь коротко то, без чего нельзя судить о ходах: чем меряется победа,
 * почему бизнес без управляющего не считается свободой, чем рассрочка
 * отличается от кредита и что такое партнёрский бизнес.
 */
const SYSTEM = `Ты разбираешь партию в настольную игру про личные финансы — российскую халяльную версию «Кэшфлоу».

ПРАВИЛА, по которым надо судить:
· Цель — выйти из Круга: доход, который приходит БЕЗ участия человека, должен перерасти его расходы.
· Зарплата в зачёт не идёт: перестал ходить — перестало платить.
· Недвижимость и бумаги считаются доходом без участия сразу.
· Бизнес — только если нанят управляющий: он забирает долю, зато остальное идёт в зачёт свободы.
· Процентных кредитов в халяльной версии нет как основного пути: крупное берут рассрочкой с фиксированной наценкой (мурабаха) или входят в долю с другим игроком. Кредит под процент существует, но он ловушка: даёт деньги сразу, а потом много лет тянет платёж, и тело долга им не гасится.
· Партнёрский бизнес (GreenLeaf) — отдельный класс актива: вход дешевле любой недвижимости, доход растёт сам по мере роста структуры и не имеет потолка. Сначала считается активным доходом, а с закрытием рангов часть переходит в зачёт свободы.
· Расходы растут вслед за доходом — это ловушка образа жизни.

ЧТО ДЕЛАТЬ:
Тебе дают факты одной партии одного игрока: его ходы, покупки, пропуски, долги, конечное состояние. Напиши ему личный разбор — как другу, который смотрел игру со стороны.

КАК ПИСАТЬ:
· По-русски, на «вы», спокойно и по делу. Без восторгов и без нравоучений.
· Опирайся ТОЛЬКО на переданные факты и цифры. Ничего не выдумывай: нет данных — не пиши.
· Начни с одной фразы о том, чем эта партия была.
· Дальше 3–5 абзацев: что человек делал хорошо, что его тормозило, какое конкретное решение стоило ему больше всего, и что было бы, поступи он иначе.
· Заверши списком «Куда усиливаться» — 2–4 пункта про жизнь, а не про игру.
· Если он не брал партнёрский бизнес — скажи об этом прямо и объясни цифрами, почему это был самый дешёвый вход в доход без потолка. Если брал, но не поднял пакет и не открыл три кабинета — скажи, что это даёт.
· Не обещай доходности и не гарантируй результат. Пиши как о модели, а не как о финансовом совете.
· Не используй внутренний жаргон («бинар», «золотой треугольник», «PV»). Говори простыми словами.
· 200–350 слов. Без заголовков-эмодзи.`


/**
 * Прочитать тело запроса. Потолок задаётся вызывающим: разбор партии — это
 * пара килобайт, а журнал целой партии на десять человек заметно толще.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > limit) {
        req.destroy()
        reject(new Error('слишком большое тело'))
      }
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  // Заголовки собираем без пустых значений: Node падает на undefined.
  res.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function serveStatic(req, res, url) {
  // Файлы сборки лежат под хэшами — их можно кэшировать надолго.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(ROOT, rel)
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    // Одностраничное приложение: любой неизвестный путь отдаём как страницу.
    file = join(ROOT, 'index.html')
  }
  try {
    const data = await readFile(file)
    const type = TYPES[extname(file)] || 'application/octet-stream'
    const long = /\/assets\//.test(file)
    res.writeHead(200, {
      'content-type': type,
      'cache-control': long ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
    })
    res.end(data)
  } catch {
    send(res, 404, { error: 'нет такого файла' })
  }
}

/**
 * Один обработчик запроса на все хостинги.
 *
 * 🔴 Вынесен наружу и экспортируется, потому что игра живёт на двух адресах:
 * свой сервер (Railway) и функции (Vercel, чтобы открывалось без VPN). Если
 * скопировать логику в оба места, они разъедутся — и человек получит разное
 * поведение в зависимости от того, какая ссылка у него открылась. Здесь код
 * ОДИН, а хостинги отличаются только тем, кто его зовёт.
 */
export async function handler(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') return send(res, 204, '')

  if (url.pathname === '/api/health') return send(res, 200, { ok: true })

  /*
   * Правки игры из панели хозяина.
   *
   * 🔴 ЧТЕНИЕ ОТКРЫТО ВСЕМ И ЭТО НАМЕРЕННО: правки — это правила стола, по
   * которым сейчас играют. Их обязан получить каждый участник ещё до того, как
   * соберётся первый стол, иначе у двоих за одной партией будут разные числа.
   * Закрыто только ПИСАНИЕ.
   */
  if (url.pathname === '/api/rules') {
    if (req.method === 'GET') {
      return send(res, 200, await читатьПравки())
    }
    if (req.method === 'PUT') {
      try {
        const user = await whoIs(req)
        const raw = await readBody(req, 600_000)
        return send(res, 200, await писатьПравки(user, JSON.parse(raw || '{}')))
      } catch (e) {
        return send(res, e?.status || 500, { error: String(e?.message || e).slice(0, 300) })
      }
    }
    return send(res, 405, { error: 'только GET и PUT' })
  }

  /* Может ли этот человек править правила — панель спрашивает, чтобы не
     показывать поля тому, кто всё равно получит отказ. */
  if (url.pathname === '/api/rules/can-edit' && req.method === 'GET') {
    return send(res, 200, { can: этоХозяин(await whoIs(req)) })
  }

  /*
   * Возврат от Google для копий игры на других адресах.
   *
   * 🔴 Supabase пускает обратно ТОЛЬКО на адреса из своего списка. Незнакомый
   * он молча подменяет на общий адрес проекта — и человек, войдя из игры,
   * оказывался в Craft. Наш домен в списке есть, поэтому вход просит вернуть
   * себя сюда, а мы перебрасываем дальше вместе с хэшем: токен живёт только в
   * браузере и такой переброс переживает.
   *
   * 🔴 Список разрешённых адресов — закрытый. Открытый переброс означал бы,
   * что чужой сайт может подставить себя и увести токен человека.
   */
  if (url.pathname === '/auth-back') {
    const to = url.searchParams.get('to') || ''
    const ok = AUTH_BACK.has(to.replace(/\/$/, ''))
    const target = ok ? to : '/'
    return send(
      res,
      200,
      '<!doctype html><meta charset=utf-8><title>Вхожу…</title>' +
        `<script>location.replace(${JSON.stringify(target)} + location.hash)</script>` +
        '<p style="font-family:ui-sans-serif,system-ui;padding:24px">Вхожу…</p>',
      'text/html; charset=utf-8',
    )
  }



  if (url.pathname === '/api/debrief' && req.method === 'POST') {
    const отказ = перебор(req, Date.now())
    if (отказ) return send(res, 429, { error: отказ })
    let raw = ''
    req.on('data', (c) => {
      raw += c
      // Журнал партии небольшой; всё, что толще, — не наш случай.
      if (raw.length > 200_000) req.destroy()
    })
    req.on('end', async () => {
      try {
        const out = await aiDebrief(JSON.parse(raw || '{}'))
        send(res, out.error ? 502 : 200, out)
      } catch (e) {
        send(res, 400, { error: 'не разобрал запрос' })
      }
    })
    return
  }


  // ─────────────────────── кабинет ───────────────────────
  // 🔴 Кабинет НЕОБЯЗАТЕЛЕН. Не настроен — честно говорим об этом кодом 501,
  // и игра просто живёт без него: ни один экран от этого не ломается.
  if (url.pathname.startsWith('/api/games') || url.pathname === '/api/me') {
    if (!cabinetReady()) return send(res, 501, { error: 'кабинет не настроен' })
    const user = await whoIs(req)
    if (!user) return send(res, 401, { error: 'нужен вход' })

    try {
      if (url.pathname === '/api/me') return send(res, 200, { user })

      if (url.pathname === '/api/games' && req.method === 'GET') {
        return send(res, 200, await listGames(user))
      }

      if (url.pathname === '/api/games' && req.method === 'POST') {
        const raw = await readBody(req, 6_000_000)
        return send(res, 200, await saveGame(user, JSON.parse(raw || '{}')))
      }

      const m = url.pathname.match(/^\/api\/games\/([0-9a-f-]{36})\/debrief$/)
      if (m && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 200_000)) || '{}')
        return send(res, 200, await saveDebrief(user, m[1], body.seatId, body.text))
      }
    } catch (e) {
      console.error('[кабинет]', e?.message || e)
      return send(res, e?.status || 500, { error: String(e?.message || e).slice(0, 300) })
    }
    return send(res, 404, { error: 'нет такой ручки' })
  }

  return serveStatic(req, res, url)
}

const server = createServer(handler)

// 🔴 Слушаем порт ТОЛЬКО когда файл запущен напрямую (Railway). На Vercel его
// просто импортируют ради `handler` — там свой приёмник запросов, и попытка
// занять порт уронила бы функцию.
const запущенНапрямую = argv[1] && import.meta.url === pathToFileURL(argv[1]).href
if (запущенНапрямую) server.listen(PORT, '::', () => {
  // 🔴 Слушаем '::' — приватная сеть Railway ходит по IPv6, и на '0.0.0.0'
  // запросы упирались бы в таймаут. Это уже стоило нам полдня на другом сервисе.
  console.log(`игра слушает :${PORT}`)
})
