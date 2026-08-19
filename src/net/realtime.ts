import { getSupabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * ТРАНСПОРТ ОНЛАЙН-ПАРТИИ
 *
 * Движок игры event-sourced: состояние = replayTable(setup, events). Значит по сети
 * достаточно гонять только события — состояние каждый клиент собирает сам, и
 * рассинхрона «у меня одно, у тебя другое» быть не может по построению.
 *
 * Отсюда главная задача транспорта: договориться о ЕДИНОМ ПОРЯДКЕ событий.
 * Сервера-арбитра нет (канал Supabase Broadcast без таблиц и RLS), поэтому порядок
 * задаётся детерминированным правилом, одинаковым на всех клиентах:
 *
 *     меньший seq выигрывает; при равном seq — лексикографически меньший from.
 *
 * Журнал (log) — собственность транспорта, индекс массива == seq. Приложение
 * хранит только setup и складывает payload'ы из onEvent.
 *
 * 🔴 ВАЖНО ДЛЯ ПРИЛОЖЕНИЯ: своё событие ты тоже получаешь обратно через onEvent.
 * Клик НЕ применяем локально — только send(); применяем в onEvent. Один путь
 * для своих и чужих событий = один порядок у всех, никакой оптимистичной ветки.
 */

// ─── Публичные типы ───────────────────────────────────────────────────

export interface NetEvent {
  /** Номер слота в журнале. Индекс в массиве событий, начиная с 0. */
  seq: number
  /** Часы отправителя. Только для диагностики — на порядок НЕ влияет. */
  at: number
  /** id отправителя. Тай-брейк при равном seq. */
  from: string
  /** Прикладная нагрузка. Для нас — TableEvent. */
  payload: unknown
}

export interface Peer {
  id: string
  name: string
  joinedAt: number
  /** Самый ранний в комнате — он отвечает на запросы снапшота. */
  isHost: boolean
  isSelf: boolean
}

export type NetStatus =
  /** Не подключены (не звали join или позвали leave). */
  | 'offline'
  /** Первое подключение. */
  | 'connecting'
  /** Канал живой, дырок в журнале нет. */
  | 'online'
  /** Связь была, оборвалась, переподключаемся. */
  | 'reconnecting'
  /** Канал живой, но в журнале дырка — ждём снапшот/хвост. */
  | 'desynced'

export interface SnapshotDelivery {
  /** Кто прислал. */
  from: string
  /** Прикладной снимок, который хост передал в sendSnapshot (у нас — { setup }). */
  snapshot: unknown
  /** Весь журнал по порядку, уже развёрнутый в payload'ы. Прямо в replayTable. */
  events: unknown[]
  /** Длина журнала = следующий свободный seq. */
  nextSeq: number
}

export type RejectReason =
  /** Слот занял другой игрок (проиграли тай-брейк по from). */
  | 'lost-race'
  /** Событие пролежало в очереди дольше queueTtlMs, пока не было связи. */
  | 'stale'

export interface NetHandlers {
  /** Событие вошло в журнал. Здесь и только здесь применяем applyTableEvent. */
  onEvent: (payload: unknown, meta: NetEvent) => void
  /** Кто сейчас в комнате. Зовётся и при входе, и при отвале. */
  onPresence: (peers: Peer[]) => void
  /**
   * У нас просят снимок. Зовётся ТОЛЬКО у того, кто должен ответить
   * (хост, либо любой — при answerSnapshots:'all'), поэтому проверять
   * isHost() внутри не нужно: просто вызови sendSnapshot(from, { setup }).
   */
  onSnapshotRequest: (from: string) => void
  /** Приехал снимок: пересобрать состояние с нуля. */
  onSnapshot: (data: SnapshotDelivery) => void
  /**
   * Порядок изменился задним числом (редко: победитель гонки приехал позже).
   * Журнал уже исправлен — приложению надо просто replayTable(setup, events).
   * Если обработчик не задан, транспорт вместо этого попросит снапшот.
   */
  onRewind?: (events: unknown[]) => void
  /**
   * Наше событие в журнал не попало. Автоповтора НЕТ намеренно: при 'lost-race'
   * победитель почти всегда сделал то же самое (двойной клик, два бота), и
   * повтор дал бы второй бросок кубика.
   */
  onRejected?: (payload: unknown, reason: RejectReason) => void
  onStatus?: (status: NetStatus) => void
}

export interface Transport {
  join(
    code: string,
    self: { id: string; name: string },
    handlers: NetHandlers,
    /** Журнал из localStorage — чтобы после F5 догнать хвостом, а не тянуть всё. */
    resume?: NetEvent[],
  ): Promise<void>
  send(payload: unknown): void
  sendSnapshot(to: string, snapshot: unknown): void
  requestSnapshot(): void
  leave(): void
  isOnline(): boolean

  // ─── сверх минимального контракта, нужно интерфейсу ───
  selfId(): string
  hostId(): string | null
  isHost(): boolean
  peers(): Peer[]
  status(): NetStatus
  /** Текущий журнал. Копия — наружу отдаём только для сохранения/отладки. */
  journal(): NetEvent[]
}

export interface TransportOptions {
  /**
   * Сколько ждём конкурента на тот же слот перед фиксацией. Платит только «живой
   * фронт» журнала: события из пачки (снапшот, хвост) фиксируются мгновенно.
   */
  settleMs?: number
  /** Сколько терпим дырку в журнале до запроса снапшота. */
  gapMs?: number
  /** Не чаще этого просим снапшот — иначе на общем обрыве получим шторм. */
  snapshotThrottleMs?: number
  /** Клик, сделанный без связи, доедет только если моложе этого. */
  queueTtlMs?: number
  /** Событий в одном сообщении при раздаче журнала (лимит Broadcast ~256 КБ). */
  chunkSize?: number
  /** Через сколько без подтверждения перепосылаем своё событие. */
  ackMs?: number
  /** Сколько ждём presence на входе, прежде чем решить «я поздний игрок». */
  joinProbeMs?: number
  /** Как часто рассылаем отпечаток журнала для поиска тихого расхождения. */
  syncEveryMs?: number
  /**
   * Не чаще этого отдаём одному игроку журнал целиком. Прямо задаёт скорость
   * лечения расхождения: слишком часто — шторм пересылок, слишком редко —
   * игрок дольше сидит с чужой версией партии.
   */
  fullLogThrottleMs?: number
  /** Кто отвечает на запрос снимка. 'host' = хост, остальные подстрахуют. */
  answerSnapshots?: 'host' | 'all'
  debug?: boolean
}

const DEFAULTS: Required<TransportOptions> = {
  settleMs: 80,
  gapMs: 1200,
  snapshotThrottleMs: 2500,
  queueTtlMs: 3000,
  chunkSize: 300,
  ackMs: 2500,
  joinProbeMs: 600,
  syncEveryMs: 5000,
  fullLogThrottleMs: 2000,
  answerSnapshots: 'host',
  debug: false,
}

/** Версия протокола. Разные версии друг друга игнорируют — чтобы после выката
 *  старая вкладка не портила журнал новой. */
const PROTOCOL = 1

// ─── Сообщения на проводе ─────────────────────────────────────────────

type Msg =
  | { v: number; k: 'ev'; e: NetEvent }
  | { v: number; k: 'req'; from: string }
  | { v: number; k: 'catchup'; from: string; have: number; dig: string }
  /** Маячок «вот моя длина и отпечаток журнала» — ловит расхождение по содержимому. */
  | { v: number; k: 'sync'; from: string; len: number; dig: string }
  | {
      v: number
      k: 'bulk'
      mode: 'snap' | 'tail'
      from: string
      to: string
      /** id посылки — чтобы собрать части вместе. */
      sid: string
      i: number
      n: number
      events: NetEvent[]
      snapshot?: unknown
      nextSeq: number
    }
  /** Presence для LocalTransport (у Supabase своя). */
  | { v: number; k: 'hello'; from: string; name: string; joinedAt: number; re?: boolean }
  | { v: number; k: 'bye'; from: string }

// ─── Мелкие утилиты ───────────────────────────────────────────────────

const now = () => Date.now()

function rid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Код комнаты — то, что человек диктует голосом. Нормализуем жёстко. */
export function normalizeCode(code: string): string {
  const clean = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return clean || 'LOBBY'
}

/** Код без похожих символов (0/O, 1/I) — его диктуют вслух. */
export function makeRoomCode(len = 5): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += abc[Math.floor(Math.random() * abc.length)]
  return out
}

/** id игрока. Живёт в localStorage, чтобы после F5 остаться тем же участником. */
export function makePeerId(): string {
  const KEY = 'freedom-run:peer-id'
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return saved
    const fresh = `p-${rid()}${rid()}`
    localStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    return `p-${rid()}${rid()}`
  }
}

function isNetEvent(e: unknown): e is NetEvent {
  if (!e || typeof e !== 'object') return false
  const c = e as NetEvent
  return Number.isInteger(c.seq) && c.seq >= 0 && typeof c.from === 'string' && c.from.length > 0
}

/** Правило гонки: при равном seq побеждает лексикографически меньший from. */
function beats(a: NetEvent, b: NetEvent): boolean {
  return a.from < b.from
}

/**
 * Отпечаток журнала (FNV-1a). Нужен, чтобы поймать расхождение ПО СОДЕРЖИМОМУ.
 *
 * 🔴 Сравнения длин мало. Если сообщение потерялось навсегда, у игрока журнал
 * остаётся плотным и полным на вид — просто в одном слоте лежит не то событие.
 * Дырки нет, догонять нечего, спросить не о чем: расхождение живёт молча до
 * конца партии. Отпечаток — единственный дешёвый способ его увидеть.
 */
function digestOf(log: NetEvent[], upTo: number): string {
  let h = 0x811c9dc5
  const n = Math.min(upTo, log.length)
  for (let i = 0; i < n; i++) {
    const s = `${log[i].from}|${log[i].at}`
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j)
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(36)
}

// ─── Общее ядро: порядок, журнал, снапшоты, переподключение ───────────

/**
 * Экспортируется, чтобы можно было подсунуть другой провод (тесты, WebRTC,
 * свой websocket), не переписывая логику порядка.
 */
export abstract class BaseTransport implements Transport {
  protected opt: Required<TransportOptions>
  protected code = ''
  protected me = { id: '', name: '' }
  protected joinedAt = 0
  protected h: NetHandlers | null = null

  /** Зафиксированный журнал. Индекс === seq. */
  protected log: NetEvent[] = []
  /** Кандидаты на ещё не занятые слоты. Больше одного в слоте = гонка. */
  private buf = new Map<number, NetEvent[]>()
  /** Когда слот впервые получил кандидата — для окна согласования. */
  private seenAt = new Map<number, number>()
  /** Свои отправленные, но ещё не зафиксированные — держат за собой seq. */
  private outbox: NetEvent[] = []
  /** Клики без связи. */
  private queued: { payload: unknown; at: number }[] = []
  /**
   * 🔴 Последняя выданная метка времени. Пара «автор + at» служит опознавательным
   * знаком события (по ней чистим буфер и ищем свои ходы в чужом журнале), а у
   * Date.now() разрешение 1 мс: два клика в одну миллисекунду — и два РАЗНЫХ
   * события неотличимы, из-за чего живой ход выбрасывался как дубль. Поэтому
   * метку выдаём строго возрастающей, а не берём часы напрямую.
   */
  private lastStamp = 0

  protected peerMap = new Map<string, Peer & { lastSeen: number }>()
  protected wireUp = false
  protected left = true
  private everConnected = false
  /** Уже брали состояние у кого-то из комнаты. Читают и наследники. */
  protected everSynced = false
  private lastStatus: NetStatus = 'offline'

  private gapSince = 0
  private lastSnapReq = 0
  private draining = false
  private drainAgain = false
  private reconnectAttempt = 0

  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Незавершённые многочастные посылки. */
  private parts = new Map<string, { got: Map<number, Msg & { k: 'bulk' }>; at: number }>()
  /** Кого мы собираемся подстраховать с ответом — гасим, если ответил хост. */
  private pendingAnswers = new Set<string>()
  /** Когда последний раз отдавали кому-то журнал целиком (защита от шторма). */
  private lastFullSend = new Map<string, number>()

  constructor(opt: TransportOptions = {}) {
    this.opt = { ...DEFAULTS, ...opt }
  }

  // ─── Подключения ────────────────────────────────────────────────────

  protected abstract openWire(): Promise<void>
  protected abstract closeWire(): void
  protected abstract postRaw(m: Msg): void
  protected abstract trackPresence(): void

  async join(
    code: string,
    self: { id: string; name: string },
    handlers: NetHandlers,
    resume?: NetEvent[],
  ): Promise<void> {
    this.leave()
    this.code = normalizeCode(code)
    this.me = { id: self.id, name: self.name }
    this.joinedAt = now()
    this.h = handlers
    this.left = false
    this.everConnected = false
    this.everSynced = false
    this.log = []
    this.buf.clear()
    this.seenAt.clear()
    this.outbox = []
    this.queued = []
    this.peerMap.clear()

    // Восстановленный журнал считаем своим: дальше нас догонят хвостом, а любое
    // расхождение вылечит правило гонки (rewind) или снапшот.
    if (resume?.length) {
      this.log = resume.filter(isNetEvent).map((e, i) => ({ ...e, seq: i }))
      this.everSynced = true
      // Продолжаем метки с того же места: иначе после F5 новый ход может
      // получить at, уже занятый нашим старым ходом, и его сочтут дублем.
      for (const e of this.log) if (e.from === this.me.id) this.lastStamp = Math.max(this.lastStamp, e.at)
    }

    this.touchPeer(this.me.id, this.me.name, this.joinedAt)
    this.emitStatus()
    this.bindEnvironment()
    await this.connect()
  }

  private async connect(): Promise<void> {
    if (this.left) return
    this.emitStatus()
    try {
      await this.openWire()
    } catch (err) {
      this.log_('openWire упал', err)
      this.onWireDown()
    }
  }

  /** Зовётся подклассом, когда канал реально подписан. */
  protected onWireUp(): void {
    if (this.left) return
    this.wireUp = true
    this.everConnected = true
    this.reconnectAttempt = 0
    this.clearTimer('reconnect')
    this.trackPresence()
    this.emitStatus()

    if (this.everSynced) {
      // Переподключение: журнал у нас есть, просим только хвост начиная с нашего seq.
      this.post({ v: PROTOCOL, k: 'catchup', from: this.me.id, have: this.log.length, dig: this.digest() })
      this.setTimer('catchup-fallback', this.opt.gapMs * 2, () => {
        if (!this.everSynced || this.hasGap()) this.requestSnapshot()
      })
    } else {
      this.armJoinSync()
    }

    this.flushQueued()
    this.armAckWatch()
    this.armSyncBeacon()
  }

  /**
   * Первый вход в комнату. Presence приезжает чуть позже подписки, поэтому
   * решение откладываем на joinProbeMs.
   *
   * 🔴 Снимок просит ТОЛЬКО не-хост. Иначе выходит катастрофа: второй игрок
   * заходит, хост видит «в комнате кто-то есть», тоже просит снимок — и пустой
   * журнал новичка затирает хосту всю партию. Кто вошёл раньше, тот источник правды.
   * Повторяем, пока снимок не приедет: единственный ответчик мог как раз выйти.
   */
  private armJoinSync(): void {
    /*
     * 🔴 «Я тут один» НЕЛЬЗЯ решать с первой попытки. Presence приезжает не
     * мгновенно, и на столе из трёх-четырёх человек четвёртый вошедший вполне
     * успевал увидеть в комнате только себя: он объявлял свой пустой журнал
     * правдой, ставил everSynced и БОЛЬШЕ НИКОГДА не просил снимок — экран
     * навсегда застывал на «ждём состав от хозяина стола». Хозяин при этом
     * его уже видел в составе, то есть выглядело как выборочная поломка.
     * Теперь одиночество должно подтвердиться несколько раз подряд.
     */
    let alone = 0
    const tick = () => {
      if (this.left || this.everSynced) return
      if (this.peerMap.size > 1 && !this.isHost()) {
        alone = 0
        this.requestSnapshot()
        const again = Math.max(this.opt.gapMs * 2, this.opt.snapshotThrottleMs + 200)
        this.setTimer('join-sync', again, tick)
        return
      }
      if (this.peerMap.size <= 1 && ++alone < 4) {
        // Ещё не факт, что один: presence мог не доехать. Проверим снова.
        this.setTimer('join-sync', this.opt.joinProbeMs, tick)
        return
      }
      // Раньше нас в комнате никого — состояние брать не у кого, журнал наш.
      this.everSynced = true
      this.flushQueued()
      this.emitStatus()
    }
    this.setTimer('join-sync', this.opt.joinProbeMs, tick)
  }

  /** Зовётся подклассом при обрыве/ошибке канала. */
  protected onWireDown(): void {
    if (this.left) return
    this.wireUp = false
    this.emitStatus()
    const wait = Math.min(500 * 2 ** this.reconnectAttempt, 8000) + Math.floor(Math.random() * 250)
    this.reconnectAttempt++
    this.setTimer('reconnect', wait, () => {
      this.closeWire()
      void this.connect()
    })
  }

  leave(): void {
    if (this.left && !this.wireUp) {
      this.left = true
      return
    }
    this.left = true
    this.wireUp = false
    for (const [, t] of this.timers) clearTimeout(t)
    this.timers.clear()
    this.parts.clear()
    this.pendingAnswers.clear()
    try {
      this.closeWire()
    } catch (err) {
      this.log_('closeWire упал', err)
    }
    this.unbindEnvironment()
    this.emitStatus()
  }

  // ─── Отправка ───────────────────────────────────────────────────────

  send(payload: unknown): void {
    if (this.left) return
    // Пока не синхронизированы, seq считать не от чего: наш «следующий свободный»
    // может уже быть занят. Копим и отправим после догона.
    if (!this.wireUp || !this.everSynced || this.hasGap()) {
      this.queued.push({ payload, at: now() })
      return
    }
    const e: NetEvent = {
      seq: this.log.length + this.outbox.length,
      at: this.stamp(),
      from: this.me.id,
      payload,
    }
    this.outbox.push(e)
    this.post({ v: PROTOCOL, k: 'ev', e })
    this.armAckWatch()
  }

  /** Строго возрастающая метка: делает пару «автор + at» уникальной. */
  private stamp(): number {
    this.lastStamp = Math.max(now(), this.lastStamp + 1)
    return this.lastStamp
  }

  private flushQueued(): void {
    if (!this.queued.length) return
    const fresh = this.queued
    this.queued = []
    const cutoff = now() - this.opt.queueTtlMs
    for (const q of fresh) {
      // Клик двухминутной давности отправлять нельзя: за это время ход ушёл,
      // и «бросок кубика» прилетел бы в чужую партию.
      if (q.at < cutoff) this.h?.onRejected?.(q.payload, 'stale')
      else this.send(q.payload)
    }
  }

  /**
   * Своё событие могло не дойти (моргнула связь). Повтор безопасен: приёмник
   * отбрасывает дубликат по паре from+seq.
   */
  private armAckWatch(): void {
    if (!this.outbox.length) {
      this.clearTimer('ack')
      return
    }
    if (this.timers.has('ack')) return
    this.setTimer('ack', this.opt.ackMs, () => {
      if (this.left) return
      const stale = now() - this.opt.ackMs
      for (const e of this.outbox) if (e.at <= stale && this.wireUp) this.post({ v: PROTOCOL, k: 'ev', e })
      this.armAckWatch()
    })
  }

  protected post(m: Msg): void {
    if (this.left) return
    try {
      this.postRaw(m)
    } catch (err) {
      this.log_('postRaw упал', err)
    }
  }

  // ─── Приём и порядок ────────────────────────────────────────────────

  protected handleMsg(m: Msg | null | undefined): void {
    if (this.left || !m || typeof m !== 'object') return
    if (m.v !== PROTOCOL) return

    switch (m.k) {
      case 'ev':
        this.ingest(m.e)
        break

      case 'req':
        if (m.from === this.me.id) break
        this.scheduleAnswer(m.from, () => this.h?.onSnapshotRequest(m.from))
        break

      case 'catchup': {
        if (m.from === this.me.id) break
        // Разошлось содержимое — хвостом не вылечить, нужен весь журнал.
        const forked = digestOf(this.log, m.have) !== m.dig
        if (!forked && m.have >= this.log.length) break
        this.scheduleAnswer(m.from, () => {
          if (forked) this.sendFullLog(m.from)
          else if (m.have < this.log.length) this.sendBulk('tail', m.from, this.log.slice(m.have), undefined)
        })
        break
      }

      case 'sync': {
        if (m.from === this.me.id) break
        this.onSyncBeacon(m.from, m.len, m.dig)
        break
      }

      case 'bulk':
        // Чужой ответ на тот же запрос — значит подстраховывать не надо.
        this.pendingAnswers.delete(m.to)
        this.clearTimer(`answer:${m.to}`)
        if (m.to !== this.me.id) break
        this.acceptBulk(m)
        break

      case 'hello':
        this.touchPeer(m.from, m.name, m.joinedAt)
        // Новичок узнаёт о нас только если мы отзовёмся. Отвечаем на первый
        // hello, но не на heartbeat (re) — иначе будет вечный пинг-понг.
        if (!m.re && m.from !== this.me.id) {
          this.post({ v: PROTOCOL, k: 'hello', from: this.me.id, name: this.me.name, joinedAt: this.joinedAt, re: true })
        }
        break

      case 'bye':
        if (this.peerMap.delete(m.from)) this.emitPresence()
        break
    }
  }

  /**
   * Разбор чужого маячка. Лечение симметричное и не требует «главного»:
   * кто заметил расхождение, тот и отдаёт свой журнал. Слияние идёт по правилу
   * (меньший from на слот), поэтому обмен в обе стороны сходится к одному
   * результату, сколько бы раз его ни повторили.
   */
  private onSyncBeacon(from: string, len: number, dig: string): void {
    /*
     * 🔴 Отпечатки сравнимы ТОЛЬКО на префиксе одинаковой длины. В маячке лежит
     * отпечаток всего чужого журнала, поэтому судить о расхождении можно лишь
     * когда их журнал не длиннее нашего. Если сравнивать «наш префикс против их
     * полного», расхождение мерещится при любой разнице длин — и ложные тревоги
     * съедают лимит на пересылку журнала, из-за чего настоящая починка не проходит.
     */
    if (len > this.log.length) {
      // Мы просто отстали. Просим догон, отпечаток вложен — ответят по существу.
      this.post({ v: PROTOCOL, k: 'catchup', from: this.me.id, have: this.log.length, dig: this.digest() })
      return
    }
    if (digestOf(this.log, len) !== dig) {
      this.sendFullLog(from)
      return
    }
    if (len < this.log.length) {
      this.scheduleAnswer(from, () => this.sendBulk('tail', from, this.log.slice(len), undefined))
    }
  }

  /** Полный журнал конкретному игроку. Дороже хвоста, зато лечит расхождение. */
  private sendFullLog(to: string): void {
    const last = this.lastFullSend.get(to) ?? 0
    if (now() - last < this.opt.fullLogThrottleMs) return // иначе расхождение вызовет шторм пересылок
    this.lastFullSend.set(to, now())
    this.sendBulk('tail', to, this.log.slice(), undefined)
  }

  private digest(): string {
    return digestOf(this.log, this.log.length)
  }

  /** Маячок раз в syncEveryMs: тихое расхождение обязано всплыть само. */
  private armSyncBeacon(): void {
    this.setTimer('sync-beacon', this.opt.syncEveryMs, () => {
      if (this.isOnline() && this.peerMap.size > 1) {
        this.post({ v: PROTOCOL, k: 'sync', from: this.me.id, len: this.log.length, dig: this.digest() })
      }
      this.armSyncBeacon()
    })
  }

  /**
   * Хост отвечает сразу, остальные — с задержкой и только если хост промолчал.
   * Часы у всех свои, поэтому в редком случае перекоса выбор хоста может
   * разойтись; подстраховка гарантирует, что новичок не останется без ответа.
   */
  private scheduleAnswer(to: string, answer: () => void): void {
    if (this.opt.answerSnapshots === 'all' || this.isHost()) {
      answer()
      return
    }
    if (this.pendingAnswers.has(to)) return
    this.pendingAnswers.add(to)
    this.setTimer(`answer:${to}`, 250 + Math.floor(Math.random() * 350), () => {
      if (!this.pendingAnswers.delete(to)) return
      answer()
    })
  }

  private ingest(e: NetEvent): void {
    if (!isNetEvent(e)) return

    // Слот уже занят.
    if (e.seq < this.log.length) {
      const cur = this.log[e.seq]
      if (cur.from === e.from) return // наш же дубликат / повтор
      if (!beats(e, cur)) return // опоздавший проигравший — в мусор
      this.rewind(e) // победитель приехал задним числом
      return
    }

    this.bufferPush(e)
    this.drain()
  }

  private bufferPush(e: NetEvent): void {
    const slot = this.buf.get(e.seq)
    if (slot) {
      if (slot.some((x) => x.from === e.from)) return
      slot.push(e)
      return
    }
    this.buf.set(e.seq, [e])
    this.seenAt.set(e.seq, now())
  }

  /**
   * Вливаем чужой журнал (снимок или хвост) в свой ПО ТОМУ ЖЕ ПРАВИЛУ, что и
   * одиночные события: слот забирает меньший from.
   *
   * 🔴 Почему не «заменить журнал целиком», как просится: у отправителя мог быть
   * свой, проигрышный вариант слота. Замена ставит его к нам в обход правила,
   * мы шлём такой же снимок дальше — и два игрока вечно переписывают друг другу
   * начало партии. В шторме это выглядело как расхождение прямо на seq 0.
   * Слияние по правилу коммутативно и идемпотентно: кто кому что прислал —
   * не важно, все приходят к одному журналу.
   *
   * Возвращает индекс первого изменившегося слота или -1, если ничего не изменилось.
   */
  private mergeJournal(incoming: NetEvent[]): number {
    const bySeq = new Map<number, NetEvent>()
    for (let i = 0; i < this.log.length; i++) bySeq.set(i, this.log[i])
    for (const e of incoming) {
      if (!isNetEvent(e)) continue
      const cur = bySeq.get(e.seq)
      if (!cur) {
        bySeq.set(e.seq, e)
        continue
      }
      if (cur.from === e.from) continue
      if (beats(e, cur)) bySeq.set(e.seq, e)
    }

    // Журнал обязан быть плотным: берём префикс до первой дыры.
    const merged: NetEvent[] = []
    for (let i = 0; bySeq.has(i); i++) merged.push(bySeq.get(i) as NetEvent)
    // Всё, что осталось за дырой, ждёт своей очереди в буфере.
    for (const [seq, e] of bySeq) if (seq >= merged.length) this.bufferPush(e)

    let firstChanged = -1
    for (let i = 0; i < Math.max(merged.length, this.log.length); i++) {
      const a = this.log[i]
      const b = merged[i]
      if (!a || !b || a.from !== b.from || a.at !== b.at) {
        firstChanged = i
        break
      }
    }
    this.log = merged
    return firstChanged
  }

  private drain(): void {
    // onEvent зовёт приложение, а оно может тут же вызвать send() и рекурсивно
    // сюда вернуться. Защищаемся флагом, повтор откладываем.
    if (this.draining) {
      this.drainAgain = true
      return
    }
    this.draining = true
    try {
      for (;;) {
        const seq = this.log.length
        const slot = this.buf.get(seq)
        if (!slot?.length) break

        const waited = now() - (this.seenAt.get(seq) ?? 0)
        if (waited < this.opt.settleMs) {
          // Ждём возможного конкурента. Пачки (снапшот/хвост) сюда не попадают:
          // у них seenAt уже старый, окно закрыто.
          this.setTimer('settle', this.opt.settleMs - waited, () => this.drain())
          break
        }

        slot.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
        const winner = slot[0]
        this.buf.delete(seq)
        this.seenAt.delete(seq)
        this.log.push(winner)
        this.dropFromOutbox(winner)

        for (let i = 1; i < slot.length; i++) {
          const loser = slot[i]
          this.dropFromOutbox(loser)
          if (loser.from === this.me.id) this.h?.onRejected?.(loser.payload, 'lost-race')
        }

        this.h?.onEvent(winner.payload, winner)
      }
    } finally {
      this.draining = false
    }

    if (this.drainAgain) {
      this.drainAgain = false
      this.drain()
      return
    }
    this.sweepOutbox()
    this.checkGap()
    this.armAckWatch()
  }

  /** Победитель гонки приехал после того, как слот уже отдали. Правим и просим переиграть. */
  private rewind(e: NetEvent): void {
    const dropped = this.log[e.seq]
    this.log[e.seq] = e
    if (dropped.from === this.me.id) this.h?.onRejected?.(dropped.payload, 'lost-race')
    this.log_('переигровка порядка на seq', e.seq)
    this.notifyRewind()
  }

  /** История изменилась задним числом — приложению надо пересобрать стол. */
  private notifyRewind(): void {
    if (this.h?.onRewind) {
      this.h.onRewind(this.log.map((x) => x.payload))
    } else {
      // Без onRewind приложение молча разъедется — лучше честно пересобраться.
      this.everSynced = false
      this.requestSnapshot()
    }
    this.emitStatus()
  }

  private dropFromOutbox(e: NetEvent): void {
    const i = this.outbox.findIndex((x) => x.from === e.from && x.seq === e.seq)
    if (i >= 0) this.outbox.splice(i, 1)
  }

  /**
   * Свой ход мог проиграть слот не только в очной гонке при разборе буфера:
   * пока наше событие летело, слот могли занять — тогда оно тихо умирало.
   * Здесь ловим все такие случаи разом: занятый слот при живом «своём» в outbox
   * = ход не прошёл. 🔴 Молча терять клик нельзя, иначе игрок жмёт в пустоту.
   */
  private sweepOutbox(): void {
    if (!this.outbox.length) return
    const lost = this.outbox.filter((e) => e.seq < this.log.length)
    if (!lost.length) return
    this.outbox = this.outbox.filter((e) => e.seq >= this.log.length)
    for (const e of lost) this.h?.onRejected?.(e.payload, 'lost-race')
  }

  private hasGap(): boolean {
    const want = this.log.length
    for (const seq of this.buf.keys()) if (seq > want) return true
    return false
  }

  private checkGap(): void {
    if (!this.hasGap()) {
      this.gapSince = 0
      this.clearTimer('gap')
      this.emitStatus()
      return
    }
    // Realtime иногда чуть переставляет сообщения местами — сразу паниковать
    // и тянуть снапшот дорого. Даём дырке шанс закрыться сама.
    if (!this.gapSince) this.gapSince = now()
    this.emitStatus()
    if (now() - this.gapSince >= this.opt.gapMs) {
      this.requestSnapshot()
      return
    }
    this.setTimer('gap', this.opt.gapMs, () => this.checkGap())
  }

  // ─── Снапшоты ───────────────────────────────────────────────────────

  requestSnapshot(): void {
    if (this.left) return
    const t = now()
    if (t - this.lastSnapReq < this.opt.snapshotThrottleMs) return
    this.lastSnapReq = t
    this.post({ v: PROTOCOL, k: 'req', from: this.me.id })
  }

  sendSnapshot(to: string, snapshot: unknown): void {
    if (this.left) return
    this.sendBulk('snap', to, this.log.slice(), snapshot)
  }

  /** Журнал длинной партии может не влезть в одно сообщение — режем на части. */
  private sendBulk(mode: 'snap' | 'tail', to: string, events: NetEvent[], snapshot: unknown): void {
    const size = Math.max(1, this.opt.chunkSize)
    const n = Math.max(1, Math.ceil(events.length / size))
    const sid = rid()
    const nextSeq = this.log.length
    for (let i = 0; i < n; i++) {
      this.post({
        v: PROTOCOL,
        k: 'bulk',
        mode,
        from: this.me.id,
        to,
        sid,
        i,
        n,
        events: events.slice(i * size, (i + 1) * size),
        snapshot: i === 0 ? snapshot : undefined,
        nextSeq,
      })
    }
  }

  private acceptBulk(m: Msg & { k: 'bulk' }): void {
    this.prunePartsCache()
    let entry = this.parts.get(m.sid)
    if (!entry) {
      entry = { got: new Map(), at: now() }
      this.parts.set(m.sid, entry)
    }
    entry.got.set(m.i, m)
    if (entry.got.size < m.n) return
    this.parts.delete(m.sid)

    const events: NetEvent[] = []
    for (let i = 0; i < m.n; i++) {
      const part = entry.got.get(i)
      if (!part) return // часть потерялась — ждём следующей раздачи
      for (const e of part.events) if (isNetEvent(e)) events.push(e)
    }
    const head = entry.got.get(0)
    const prevLen = this.log.length
    const changedAt = this.mergeJournal(events)

    /*
     * Событие могло приехать и в пачке, и отдельным сообщением — тогда его копия
     * лежит в буфере под своим номером. Слот, который пачка уже закрыла, чистим,
     * а дальше выкидываем всё, что в журнале ЕСТЬ, но лежит под другим номером:
     * иначе оно применится вторым разом и ход задвоится.
     */
    const inLog = new Set(this.log.map((e) => `${e.from}|${e.at}`))
    for (const [seq, slot] of [...this.buf]) {
      const keep = seq < this.log.length ? [] : slot.filter((e) => !inLog.has(`${e.from}|${e.at}`))
      if (keep.length === slot.length) continue
      if (keep.length) this.buf.set(seq, keep)
      else {
        this.buf.delete(seq)
        this.seenAt.delete(seq)
      }
    }

    this.gapSince = 0
    this.everSynced = true
    this.clearTimer('catchup-fallback')
    this.clearTimer('join-sync')
    this.sweepOutbox()
    /*
     * 🔴 Отложенные клики уходят ИМЕННО ЗДЕСЬ. Пока журнала нет, send() кладёт
     * действие в очередь: свой номер в общей череде взять не от чего. Очередь
     * разбиралась только при подключении провода — а вход в комнату случается
     * ПОСЛЕ него, уже во время ожидания снимка. Из-за этого «Занять место»
     * второго игрока оставалось в очереди навсегда: он видел лобби (снимок
     * пришёл), а хозяин стола о нём не знал и в составе показывал одного себя.
     */
    this.flushQueued()

    if (m.mode === 'snap') {
      // У снимка есть то, чего нет у хвоста, — прикладной setup. Без него
      // поздний игрок не сможет пересобрать стол, поэтому отдаём всегда.
      this.h?.onSnapshot({
        from: m.from,
        snapshot: head?.snapshot,
        events: this.log.map((e) => e.payload),
        nextSeq: this.log.length,
      })
    } else if (changedAt >= 0) {
      if (changedAt < prevLen) {
        // Хвост переписал уже применённое — честно пересобираемся.
        this.notifyRewind()
      } else {
        for (let i = prevLen; i < this.log.length; i++) this.h?.onEvent(this.log[i].payload, this.log[i])
      }
    }

    this.drain() // всё, что прилетело поверх пачки, пока она ехала
    this.flushQueued()
    this.emitStatus()
  }

  private prunePartsCache(): void {
    const cutoff = now() - 15_000
    for (const [sid, p] of this.parts) if (p.at < cutoff) this.parts.delete(sid)
  }

  // ─── Presence ───────────────────────────────────────────────────────

  protected touchPeer(id: string, name: string, joinedAt: number): void {
    const prev = this.peerMap.get(id)
    const next = {
      id,
      name: name || prev?.name || 'Игрок',
      // Свой joinedAt держим стабильным: перезапись сбросила бы выбор хоста.
      joinedAt: prev?.joinedAt ?? joinedAt ?? now(),
      isHost: false,
      isSelf: id === this.me.id,
      lastSeen: now(),
    }
    const changed = !prev || prev.name !== next.name
    this.peerMap.set(id, next)
    if (changed) this.emitPresence()
  }

  protected dropStalePeers(ttlMs: number): void {
    const cutoff = now() - ttlMs
    let changed = false
    for (const [id, p] of this.peerMap) {
      if (id === this.me.id) continue
      if (p.lastSeen < cutoff) {
        this.peerMap.delete(id)
        changed = true
      }
    }
    if (changed) this.emitPresence()
  }

  protected emitPresence(): void {
    this.h?.onPresence(this.peers())
  }

  /** Хост = самый ранний в комнате; при равенстве часов — меньший id. */
  private sorted(): (Peer & { lastSeen: number })[] {
    return [...this.peerMap.values()].sort(
      (a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  }

  peers(): Peer[] {
    const list = this.sorted()
    const host = list[0]?.id ?? null
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      isHost: p.id === host,
      isSelf: p.id === this.me.id,
    }))
  }

  hostId(): string | null {
    return this.sorted()[0]?.id ?? null
  }

  isHost(): boolean {
    const h = this.hostId()
    return h === null || h === this.me.id
  }

  // ─── Состояние ──────────────────────────────────────────────────────

  selfId(): string {
    return this.me.id
  }

  journal(): NetEvent[] {
    return this.log.slice()
  }

  isOnline(): boolean {
    return this.wireUp && !this.left
  }

  status(): NetStatus {
    if (this.left) return 'offline'
    if (!this.wireUp) return this.everConnected ? 'reconnecting' : 'connecting'
    return this.hasGap() || !this.everSynced ? 'desynced' : 'online'
  }

  protected emitStatus(): void {
    const s = this.status()
    if (s === this.lastStatus) return
    this.lastStatus = s
    this.h?.onStatus?.(s)
  }

  // ─── Телефон: сворачивание вкладки рвёт сокет молча ─────────────────

  private onVisible = (): void => {
    if (this.left || document.visibilityState !== 'visible') return
    if (!this.wireUp) {
      this.reconnectAttempt = 0
      this.clearTimer('reconnect')
      this.closeWire()
      void this.connect()
      return
    }
    // Сокет может числиться живым, а на деле быть мёртвым — дешевле догнать.
    this.post({ v: PROTOCOL, k: 'catchup', from: this.me.id, have: this.log.length, dig: this.digest() })
  }

  private onOnline = (): void => {
    if (this.left || this.wireUp) return
    this.reconnectAttempt = 0
    this.clearTimer('reconnect')
    this.closeWire()
    void this.connect()
  }

  private bindEnvironment(): void {
    if (typeof window === 'undefined') return
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('online', this.onOnline)
  }

  private unbindEnvironment(): void {
    if (typeof window === 'undefined') return
    document.removeEventListener('visibilitychange', this.onVisible)
    window.removeEventListener('online', this.onOnline)
  }

  // ─── Таймеры ────────────────────────────────────────────────────────

  protected setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        if (this.left) return
        try {
          fn()
        } catch (err) {
          this.log_(`таймер ${key} упал`, err)
        }
      }, ms),
    )
  }

  protected clearTimer(key: string): void {
    const t = this.timers.get(key)
    if (t) {
      clearTimeout(t)
      this.timers.delete(key)
    }
  }

  protected log_(...args: unknown[]): void {
    if (this.opt.debug) console.log('[net]', ...args)
  }
}

// ─── Транспорт на Supabase Realtime Broadcast ─────────────────────────

export class SupabaseTransport extends BaseTransport {
  private chan: RealtimeChannel | null = null

  protected async openWire(): Promise<void> {
    const client = getSupabase()
    if (!client) throw new Error('Supabase не настроен')

    const chan = client.channel(`fr:${this.code}`, {
      config: {
        // 🔴 self:true — своё событие возвращается нам же. Один путь применения
        // для своих и чужих ходов, значит один и тот же порядок у всех.
        broadcast: { self: true, ack: false },
        presence: { key: this.me.id },
      },
    })
    this.chan = chan

    chan.on('broadcast', { event: 'm' }, (raw: { payload?: unknown }) => {
      this.handleMsg(raw?.payload as Msg)
    })
    const sync = () => this.readPresence()
    chan.on('presence', { event: 'sync' }, sync)
    chan.on('presence', { event: 'join' }, sync)
    chan.on('presence', { event: 'leave' }, sync)

    chan.subscribe((status: string) => {
      if (this.chan !== chan) return // подписка от прошлого подключения
      if (status === 'SUBSCRIBED') this.onWireUp()
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') this.onWireDown()
    })
  }

  protected trackPresence(): void {
    void this.chan?.track({ id: this.me.id, name: this.me.name, joinedAt: this.joinedAt })
  }

  private readPresence(): void {
    const state = this.chan?.presenceState() as
      | Record<string, Array<{ id?: string; name?: string; joinedAt?: number }>>
      | undefined
    if (!state) return
    const seen = new Set<string>()
    for (const [key, metas] of Object.entries(state)) {
      const meta = metas?.[0]
      const id = meta?.id || key
      seen.add(id)
      this.touchPeer(id, meta?.name || 'Игрок', meta?.joinedAt ?? now())
    }
    let changed = false
    for (const id of [...this.peerMap.keys()]) {
      if (id !== this.me.id && !seen.has(id)) {
        this.peerMap.delete(id)
        changed = true
      }
    }
    if (changed || seen.size) this.emitPresence()

    /*
     * 🔴 В комнате появились люди, а мы ещё ни у кого не синхронизировались —
     * значит первый опрос застал нас в одиночестве. Просим снимок сразу, не
     * дожидаясь следующего круга: именно здесь застревал четвёртый вошедший.
     */
    if (!this.everSynced && this.peerMap.size > 1 && !this.isHost()) {
      this.requestSnapshot()
    }
  }

  protected postRaw(m: Msg): void {
    void this.chan?.send({ type: 'broadcast', event: 'm', payload: m })
  }

  protected closeWire(): void {
    const chan = this.chan
    this.chan = null
    if (!chan) return
    try {
      void chan.untrack()
    } catch {
      /* канал мог уже умереть */
    }
    void getSupabase()?.removeChannel(chan)
  }
}

// ─── Заглушка для двух вкладок: BroadcastChannel, без сети ────────────

/**
 * Тот же протокол, но внутри одного браузера. Нужна, чтобы гонять онлайн-логику
 * без Supabase: открыл две вкладки — и это полноценная партия на двоих.
 */
export class LocalTransport extends BaseTransport {
  private bc: BroadcastChannel | null = null
  private beat: ReturnType<typeof setInterval> | null = null

  protected async openWire(): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') {
      // Совсем старый браузер: играем сами с собой, но интерфейс тот же и
      // свои события всё равно возвращаются через onEvent.
      this.onWireUp()
      return
    }
    const bc = new BroadcastChannel(`freedom-run:${this.code}`)
    this.bc = bc
    bc.onmessage = (ev: MessageEvent) => this.handleMsg(ev.data as Msg)
    // Presence у BroadcastChannel нет — держим её на heartbeat'ах.
    this.beat = setInterval(() => {
      if (!this.isOnline()) return
      this.post({ v: PROTOCOL, k: 'hello', from: this.selfId(), name: this.nameOf(), joinedAt: this.joinedAtOf(), re: true })
      this.dropStalePeers(5000)
    }, 1500)
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.sayBye)
    this.onWireUp()
  }

  protected trackPresence(): void {
    this.post({ v: PROTOCOL, k: 'hello', from: this.selfId(), name: this.nameOf(), joinedAt: this.joinedAtOf() })
  }

  protected postRaw(m: Msg): void {
    this.bc?.postMessage(m)
    // BroadcastChannel не возвращает сообщение отправителю, а Supabase с self:true —
    // возвращает. Уравниваем поведение, иначе приложение пришлось бы писать дважды.
    queueMicrotask(() => this.handleMsg(m))
  }

  protected closeWire(): void {
    if (this.beat) {
      clearInterval(this.beat)
      this.beat = null
    }
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.sayBye)
    const bc = this.bc
    this.bc = null
    if (!bc) return
    try {
      bc.postMessage({ v: PROTOCOL, k: 'bye', from: this.selfId() } satisfies Msg)
    } catch {
      /* уже закрыт */
    }
    bc.close()
  }

  private sayBye = (): void => {
    try {
      this.bc?.postMessage({ v: PROTOCOL, k: 'bye', from: this.selfId() } satisfies Msg)
    } catch {
      /* вкладка уже уходит */
    }
  }

  private nameOf(): string {
    return this.peerMap.get(this.selfId())?.name ?? 'Игрок'
  }

  private joinedAtOf(): number {
    return this.peerMap.get(this.selfId())?.joinedAt ?? now()
  }
}

// ─── Выбор транспорта ─────────────────────────────────────────────────

export type TransportMode = 'auto' | 'supabase' | 'local'

/**
 * 'auto' — Supabase, если заданы ключи, иначе локальные вкладки.
 * Игра при любом раскладе получает рабочий объект и никогда не падает.
 */
export function createTransport(mode: TransportMode = 'auto', opt: TransportOptions = {}): Transport {
  const useSupabase = mode === 'supabase' || (mode === 'auto' && getSupabase() !== null)
  return useSupabase ? new SupabaseTransport(opt) : new LocalTransport(opt)
}

/** Настоящий ли онлайн (между устройствами), или только между вкладками. */
export function isRealOnlineAvailable(): boolean {
  return getSupabase() !== null
}
