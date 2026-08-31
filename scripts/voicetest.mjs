/**
 * Проверка голосового согласования БЕЗ браузера.
 *
 * 🔴 ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД. Все поломки голоса, которые нас кусали, — не про
 * звук, а про порядок сообщений: кто кому первый сказал «привет», чей оффер
 * потерялся, чей ответ опоздал. В браузере такие вещи ловятся только живой
 * игрой на десятерых, а здесь — за секунду и повторяемо.
 *
 * Настоящий модуль голоса берётся как есть; подменяются только браузерные
 * подпорки (соединение, канал Supabase, микрофон, страница). Проверяем
 * наблюдаемое поведение: ушёл ли оффер, собралась ли связь, замолчала ли пара.
 */
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─────────────────────────── подпорки браузера ───────────────────────────

/** Общая шина: один канал на имя, эхо себе не приходит (как у Supabase). */
function создатьШину() {
  const каналы = new Map()
  return {
    каналы,
    канал(имя) {
      let к = каналы.get(имя)
      if (!к) {
        к = {
          topic: имя,
          подписчики: new Set(),
          наПодписку: null,
          живой: true,
          on(_тип, _фильтр, cb) {
            this.подписчики.add(cb)
            return this
          },
          subscribe(cb) {
            this.наПодписку = cb
            queueMicrotask(() => cb('SUBSCRIBED'))
            return this
          },
          send({ payload }) {
            if (!this.живой) return
            for (const др of каналы.values()) {
              if (др === this || !др.живой) continue
              for (const cb of др.подписчики) queueMicrotask(() => cb({ payload }))
            }
          },
        }
        каналы.set(имя, к)
      }
      return к
    },
  }
}

/**
 * У каждого участника СВОЙ клиент: иначе `getChannels`/`removeChannel` одного
 * снесли бы канал другого — в жизни это разные браузеры.
 */
function создатьКлиент(шина, кто) {
  const свои = new Map()
  return {
    channel(имя) {
      const к = шина.канал(`${имя}#${кто}`)
      к.живой = true
      свои.set(к.topic, к)
      return к
    },
    getChannels() {
      return [...свои.values()]
    },
    removeChannel(к) {
      к.живой = false
      к.подписчики.clear()
      свои.delete(к.topic)
    },
  }
}

class ФейкPC {
  constructor() {
    this.signalingState = 'stable'
    this.connectionState = 'new'
    this.remoteDescription = null
    this.localDescription = null
    this.onicecandidate = null
    this.ontrack = null
    this.onconnectionstatechange = null
    this.дорожки = []
    this.закрыт = false
  }
  addTrack(t) {
    this.дорожки.push(t)
  }
  async createOffer() {
    return { type: 'offer', sdp: 'sdp-offer' }
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'sdp-answer' }
  }
  async setLocalDescription(d) {
    this.localDescription = d
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(d) {
    if (this.закрыт) throw new Error('закрыт')
    this.remoteDescription = d
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'
  }
  async addIceCandidate() {
    if (!this.remoteDescription) throw new Error('нет удалённой стороны')
  }
  close() {
    this.закрыт = true
    this.signalingState = 'closed'
    this.connectionState = 'closed'
  }
  /** Ручной перевод в «соединено»/«отказ» — состояние в жизни ставит браузер. */
  состояние(s) {
    this.connectionState = s
    this.onconnectionstatechange?.()
  }
}

function поставитьПодпорки() {
  globalThis.RTCPeerConnection = ФейкPC
  const дорожка = { kind: 'audio', enabled: true, stop() {}, readyState: 'live' }
  const поток = { getTracks: () => [дорожка], getAudioTracks: () => [дорожка] }
  // В node 24 `navigator` уже есть и только читается — подменяем через свойство.
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: async () => поток } },
    configurable: true,
    writable: true,
  })
  globalThis.document = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      play: async () => {},
      remove() {},
      srcObject: null,
    }),
    body: { appendChild() {} },
  }
  globalThis.AudioContext = class {
    constructor() {
      this.state = 'running'
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} }
    }
    createAnalyser() {
      return { fftSize: 1024, getByteTimeDomainData() {}, connect() {} }
    }
    async resume() {}
    async close() {}
  }
  globalThis.window = { AudioContext: globalThis.AudioContext }
}

/** Даём очереди обещаний и микрозадачам полностью разойтись. */
const осесть = async (кругов = 60) => {
  for (let i = 0; i < кругов; i++) await new Promise((r) => setTimeout(r, 0))
}

// ─────────────────────────────── сборка ───────────────────────────────

const врем = mkdtempSync(join(tmpdir(), 'voicetest-'))
const выход = join(врем, 'voice.mjs')

/** Подменяем ТОЛЬКО модуль Supabase: остальной голос идёт настоящий. */
const подменаSupabase = {
  name: 'подмена-supabase',
  setup(b) {
    b.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'фейк-supabase', namespace: 'фейк' }))
    b.onLoad({ filter: /.*/, namespace: 'фейк' }, () => ({
      contents: 'export const getSupabase = () => globalThis.__КЛИЕНТ__ ?? null',
      loader: 'js',
    }))
  },
}

await build({
  entryPoints: ['src/net/voice.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: выход,
  plugins: [подменаSupabase],
  logLevel: 'error',
})

поставитьПодпорки()
const { создатьГолос } = await import(выход)

// ─────────────────────────────── проверки ───────────────────────────────

let провалов = 0
const проверить = (условие, что) => {
  if (условие) {
    console.log(`  ✅ ${что}`)
  } else {
    console.log(`  ❌ ${что}`)
    провалов++
  }
}

/**
 * Заводим двоих в одной комнате. Возвращаем ручки для управления «сетью».
 * `меньший` звонит: порядок задаёт сравнение ключей внутри модуля.
 */
async function пара(комната) {
  const шина = создатьШину()
  const счёт = { оффер: 0, привет: 0 }
  const включить = async (id, имя) => {
    globalThis.__КЛИЕНТ__ = создатьКлиент(шина, id)
    const г = создатьГолос(комната, { id, имя })
    await г.включить()
    return г
  }
  const A = await включить('aaa', 'Анна') // меньший ключ ⇒ звонит он
  const B = await включить('zzz', 'Борис')
  // Считаем сигналы, подслушивая шину.
  for (const к of шина.каналы.values()) {
    const было = к.send.bind(к)
    к.send = (m) => {
      const t = m?.payload?.t
      if (t === 'оффер') счёт.оффер++
      if (t === 'привет') счёт.привет++
      return было(m)
    }
  }
  await осесть()
  return { шина, A, B, счёт }
}

const каналКого = (шина, id) => [...шина.каналы.values()].find((к) => к.topic.endsWith(`#${id}`))

console.log('\n1. Двое здороваются — обмен затухает, оффер ровно один')
{
  const { шина, счёт, A, B } = await пара('к1')
  await осесть()
  проверить(счёт.привет <= 3, `приветствий ${счёт.привет} (лавины нет)`)
  проверить(счёт.оффер === 1, `офферов ${счёт.оффер}`)
  проверить(A.состояние().участники.length === 1, 'у Анны один собеседник')
  проверить(B.состояние().участники.length === 1, 'у Бориса один собеседник')
}

console.log('\n2. 🔴 Моргнула сеть у ЗВОНЯЩЕГО — связь обязана пересобраться')
{
  const { шина, счёт } = await пара('к2')
  const было = счёт.оффер
  // Supabase переподключил канал: тот же обработчик, то же первое «привет».
  каналКого(шина, 'aaa').наПодписку('SUBSCRIBED')
  await осесть()
  проверить(счёт.оффер > было, `после моргания ушёл новый оффер (${было} → ${счёт.оффер})`)
}

console.log('\n3. Моргнула сеть у ОТВЕЧАЮЩЕГО — тоже пересобирается')
{
  const { шина, счёт } = await пара('к3')
  const было = счёт.оффер
  каналКого(шина, 'zzz').наПодписку('SUBSCRIBED')
  await осесть()
  проверить(счёт.оффер > было, `после моргания ушёл новый оффер (${было} → ${счёт.оффер})`)
}

console.log('\n4. Человек перезагрузил страницу — его слышат снова')
{
  const шина = создатьШину()
  const счёт = { оффер: 0 }
  const поднять = async (id, имя) => {
    globalThis.__КЛИЕНТ__ = создатьКлиент(шина, id)
    const г = создатьГолос('к4', { id, имя })
    await г.включить()
    for (const к of шина.каналы.values()) {
      if (к.__считает) continue
      к.__считает = true
      const было = к.send.bind(к)
      к.send = (m) => {
        if (m?.payload?.t === 'оффер') счёт.оффер++
        return было(m)
      }
    }
    return г
  }
  const A = await поднять('aaa', 'Анна')
  await поднять('zzz', 'Борис')
  await осесть()
  const доПерезагрузки = счёт.оффер
  // Перезагрузка = совсем новый экземпляр с тем же ключом; старый исчезает молча.
  шина.каналы.delete(`voice:к4#zzz`)
  await поднять('zzz', 'Борис')
  await осесть()
  проверить(счёт.оффер > доПерезагрузки, `вернувшемуся позвонили заново (${доПерезагрузки} → ${счёт.оффер})`)
  проверить(A.состояние().участники.length === 1, 'у Анны по-прежнему один собеседник, не два')
}

console.log('\n5. Сигналы после «выключить» не поднимают немую связь')
{
  const шина = создатьШину()
  globalThis.__КЛИЕНТ__ = создатьКлиент(шина, 'aaa')
  const A = создатьГолос('к5', { id: 'aaa', имя: 'Анна' })
  await A.включить()
  await осесть()
  /*
   * Обработчик берём ДО выключения — это и есть настоящее окно: сигнал уже
   * доставлен браузером (или стоит в очереди за await), а «выключить» успело
   * отработать. Снимать его вместе с каналом бесполезно: если брать
   * обработчик после, проверка становится пустой и проходит на любом коде —
   * на этом я уже один раз попался.
   */
  const к = каналКого(шина, 'aaa')
  const обработчики = [...к.подписчики]
  A.выключить()
  for (const cb of обработчики) cb({ payload: { t: 'привет', from: 'zzz', имя: 'Борис' } })
  await осесть()
  проверить(A.состояние().участники.length === 0, 'связь-призрак не появилась')
  проверить(A.состояние().включён === false, 'голос остался выключенным')
}

console.log('\n6. «Выключить» во время запроса микрофона отпускает микрофон')
{
  const шина = создатьШину()
  globalThis.__КЛИЕНТ__ = создатьКлиент(шина, 'aaa')
  let отпущен = false
  const дорожка = { kind: 'audio', enabled: true, readyState: 'live', stop: () => (отпущен = true) }
  let разрешить
  globalThis.navigator.mediaDevices.getUserMedia = () =>
    new Promise((r) => {
      разрешить = () => r({ getTracks: () => [дорожка], getAudioTracks: () => [дорожка] })
    })
  const A = создатьГолос('к6', { id: 'aaa', имя: 'Анна' })
  const запуск = A.включить()
  await осесть(5)
  A.выключить() // человек ушёл из комнаты, пока висело окно разрешения
  разрешить() // и только теперь нажал «Разрешить»
  await запуск
  await осесть()
  проверить(отпущен, 'микрофон отпущен, индикатор записи не горит')
  проверить(A.состояние().включён === false, 'брошенный голос не поднялся')
}

console.log(
  провалов === 0 ? '\n✅ ГОЛОС: ВСЕ ПРОВЕРКИ ПРОШЛИ\n' : `\n❌ ГОЛОС: ПРОВАЛОВ ${провалов}\n`,
)
process.exit(провалов === 0 ? 0 : 1)
