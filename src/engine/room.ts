/**
 * Комната для онлайн-партии: код, состав, настройки, ссылка на созвон.
 *
 * Файл нарочно чистый: ни React, ни сети, ни localStorage. Всё, что здесь есть, —
 * данные и функции над ними. Причина та же, по которой стол собран event-sourced:
 * одни и те же правила должны одинаково работать и у хоста в браузере, и на
 * стороне транспорта, и в тестах без интерфейса.
 *
 * Каждая функция-мутатор возвращает НОВОЕ состояние (или ошибку) и никогда не
 * трогает вход — так состояние комнаты можно гонять по сети как значение.
 */

import { randomSeed } from './rng'
import type { BotDifficulty } from './types'
import type { DeckTheme } from './data'
import type { SeatSetup, TableSetup } from './table'
import { нормализоватьРынки, type Рынок } from './рынки'

// ─── Константы ────────────────────────────────────────────────────────

export const ROOM_CODE_LENGTH = 6
export const ROOM_MIN_PLAYERS = 2
export const ROOM_MAX_PLAYERS = 10
export const MAX_NAME_LENGTH = 24

/**
 * Алфавит кода. Без 0/O, 1/I/L и прочих двойников: код диктуют голосом
 * в созвоне, и «ноль или буква О» — это потерянный игрок.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Цвета фишек. Первые шесть совпадают с TOKEN_COLORS из data.ts — движок
 * раздаёт места по индексу, и если списки разойдутся, фишка на поле будет
 * другого цвета, чем кружок в лобби.
 */
export const ROOM_COLORS: { value: string; name: string }[] = [
  { value: '#ef4444', name: 'Красный' },
  { value: '#3b82f6', name: 'Синий' },
  { value: '#22c55e', name: 'Зелёный' },
  { value: '#eab308', name: 'Жёлтый' },
  { value: '#a855f7', name: 'Фиолетовый' },
  { value: '#f97316', name: 'Оранжевый' },
  { value: '#06b6d4', name: 'Бирюзовый' },
  { value: '#ec4899', name: 'Розовый' },
  { value: '#84cc16', name: 'Лаймовый' },
  { value: '#b45309', name: 'Охра' },
]

export const ROOM_COLOR_VALUES = ROOM_COLORS.map((c) => c.value)

/** Имена ботов: короткие, чтобы влезали в список на телефоне. */
const BOT_NAMES = [
  'Бот Алмаз',
  'Бот Динара',
  'Бот Тимур',
  'Бот Гульнара',
  'Бот Ринат',
  'Бот Алия',
  'Бот Ильдар',
  'Бот Рамиля',
  'Бот Марат',
  'Бот Лейла',
]

// ─── Типы ─────────────────────────────────────────────────────────────

export type RoomStatus = 'lobby' | 'playing' | 'finished'
export type RoomRole = 'player' | 'spectator'

/** Что делать с местом, если человек пропал со связи. */
export type DisconnectPolicy = 'ask' | 'bot' | 'drop'

export interface RoomPlayer {
  id: string
  name: string
  professionId: string
  dreamSpace: number
  color: string
  /** Место изначально занято ботом (кнопка «добавить бота»). */
  isBot: boolean
  botDifficulty: BotDifficulty
  /**
   * За живого игрока временно ходит бот: он вышел или отвалился, но место
   * держим — партия на 10 человек не должна вставать из-за одного метро.
   */
  standIn: boolean
  online: boolean
  ready: boolean
  joinedAt: number
}

export interface RoomSpectator {
  id: string
  name: string
  joinedAt: number
}

export interface RoomSettings {
  deckTheme: DeckTheme
  /**
   * Страны, из которых собрана колода. Пусто — играем всеми.
   *
   * 🔴 Настройка КОМНАТЫ, а не игрока: колода у всех за столом обязана быть
   * одна. Хост отмечает страны до старта, дальше выбор едет в настройки стола
   * и оттуда в журнал — партия пересобирается той же колодой.
   */
  рынки?: Рынок[]
  maxPlayers: number
  allowSpectators: boolean
  /** Хосту разрешено откатывать последние ходы. */
  hostCanUndo: boolean
  onDisconnect: DisconnectPolicy
  /** Сложность по умолчанию для новых ботов. */
  botDifficulty: BotDifficulty
  /**
   * Ссылка на созвон — Zoom, Meet, что угодно. Хост вставляет её при создании
   * комнаты, остальные попадают туда одной кнопкой из-за стола.
   * Пусто — кнопки просто нет.
   */
  callUrl?: string
}

export interface RoomState {
  code: string
  hostId: string
  players: RoomPlayer[]
  spectators: RoomSpectator[]
  settings: RoomSettings
  /** Ссылка на созвон (Zoom, Телемост, Telegram). Пустая строка — нет созвона. */
  callLink: string
  status: RoomStatus
  /** Зерно партии фиксируется при создании комнаты: у всех одинаковые колоды. */
  seed: number
  createdAt: number
  /** Номер ревизии: растёт на каждое изменение, пригодится транспорту. */
  rev: number
}

/** Заявка на место: то, что человек заполняет в одном окне входа. */
export interface PlayerDraft {
  id: string
  name: string
  professionId: string
  dreamSpace: number
  color: string
  isBot?: boolean
  botDifficulty?: BotDifficulty
}

// ─── Ошибки ───────────────────────────────────────────────────────────

export type RoomErrorCode =
  | 'BAD_CODE'
  | 'BAD_NAME'
  | 'NAME_TAKEN'
  | 'COLOR_TAKEN'
  | 'ROOM_FULL'
  | 'ALREADY_STARTED'
  | 'NO_SPECTATORS'
  | 'NOT_FOUND'
  | 'NOT_ENOUGH_PLAYERS'
  | 'BAD_LINK'
  | 'LAST_HUMAN'

export const ROOM_ERROR_TEXT: Record<RoomErrorCode, string> = {
  BAD_CODE: 'Код комнаты состоит из 6 символов',
  BAD_NAME: 'Впишите имя — от 1 до 24 символов',
  NAME_TAKEN: 'Такое имя уже занято в этой комнате',
  COLOR_TAKEN: 'Этот цвет уже выбрал другой игрок',
  ROOM_FULL: 'В комнате уже максимум игроков',
  ALREADY_STARTED: 'Партия уже началась — можно войти зрителем',
  NO_SPECTATORS: 'Хост закрыл вход для зрителей',
  NOT_FOUND: 'Такого участника нет в комнате',
  NOT_ENOUGH_PLAYERS: 'Нужно минимум 2 игрока',
  BAD_LINK: 'Ссылка должна начинаться с http:// или https://',
  LAST_HUMAN: 'Нельзя оставить комнату без живых игроков',
}

export type RoomResult =
  | { ok: true; room: RoomState }
  | { ok: false; error: RoomErrorCode; message: string }

const fail = (error: RoomErrorCode): RoomResult => ({
  ok: false,
  error,
  message: ROOM_ERROR_TEXT[error],
})

/** Новая ревизия состояния. Все мутаторы идут только через неё. */
function next(room: RoomState, patch: Partial<RoomState>): RoomState {
  return { ...room, ...patch, rev: room.rev + 1 }
}

// ─── Код и ссылка ─────────────────────────────────────────────────────

export function generateRoomCode(rnd: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rnd() * ROOM_CODE_ALPHABET.length)]
  }
  return out
}

/**
 * Приводит к каноническому виду то, что человек вставил из мессенджера:
 * нижний регистр, пробелы, дефисы, а то и целая ссылка вместо кода.
 */
export function normalizeRoomCode(raw: string): string {
  const fromLink = raw.match(/[?&]room=([^&\s]+)/i)?.[1] ?? raw
  return [...fromLink.toUpperCase()]
    .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, ROOM_CODE_LENGTH)
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c))
}

/**
 * Ссылка-приглашение. База приходит снаружи — движок про location не знает.
 * Путь не трогаем: игра может лежать не в корне (GitHub Pages, /preview.html),
 * и лишний слэш перед '?' ломает такой адрес.
 */
export function inviteLink(code: string, base: string): string {
  const clean = base.replace(/[?#].*$/, '')
  const withPath = /^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(clean) ? `${clean}/` : clean
  return `${withPath}?room=${code}`
}

export function readRoomCodeFromUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get('room')
  if (!raw) return null
  const code = normalizeRoomCode(raw)
  return isValidRoomCode(code) ? code : null
}

// ─── Ссылка на созвон ─────────────────────────────────────────────────

/**
 * Пускаем только http/https: ссылку вставляет хост, а видят её все, и
 * `javascript:`-строка в общей кнопке — это дыра, а не удобство.
 * Возвращает '' для пустого ввода (снять созвон) и null для мусора.
 */
export function sanitizeCallLink(raw: string): string | null {
  const t = raw.trim()
  if (!t) return ''
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Узнаём сервис по ссылке — чтобы кнопка называлась по-человечески. */
export function callProvider(link: string): { name: string; icon: string } {
  const h = link.toLowerCase()
  if (h.includes('zoom.')) return { name: 'Zoom', icon: '🎥' }
  if (h.includes('telemost') || h.includes('yandex')) return { name: 'Телемост', icon: '🟡' }
  if (h.includes('t.me') || h.includes('telegram')) return { name: 'Telegram', icon: '✈️' }
  if (h.includes('meet.google')) return { name: 'Google Meet', icon: '🟢' }
  if (h.includes('discord')) return { name: 'Discord', icon: '🎧' }
  if (h.includes('whatsapp')) return { name: 'WhatsApp', icon: '💬' }
  if (h.includes('teams.')) return { name: 'Teams', icon: '🔷' }
  if (h.includes('vk.') || h.includes('vkontakte')) return { name: 'VK Звонки', icon: '🔵' }
  return { name: 'Созвон', icon: '📞' }
}

// ─── Чтение состава ───────────────────────────────────────────────────

export function findPlayer(room: RoomState, id: string): RoomPlayer | undefined {
  return room.players.find((p) => p.id === id)
}

export function isHost(room: RoomState, id: string): boolean {
  return room.hostId === id
}

export function isMember(room: RoomState, id: string): boolean {
  return room.players.some((p) => p.id === id) || room.spectators.some((s) => s.id === id)
}

export function takenColors(room: RoomState, exceptId?: string): string[] {
  return room.players.filter((p) => p.id !== exceptId).map((p) => p.color)
}

export function freeColors(room: RoomState, exceptId?: string): string[] {
  const used = new Set(takenColors(room, exceptId))
  return ROOM_COLOR_VALUES.filter((c) => !used.has(c))
}

export function nextFreeColor(room: RoomState, exceptId?: string): string {
  return freeColors(room, exceptId)[0] ?? ROOM_COLOR_VALUES[room.players.length % ROOM_COLOR_VALUES.length]
}

/** Живые люди за столом: бот-заменитель живым не считается. */
export function humanCount(room: RoomState): number {
  return room.players.filter((p) => !p.isBot && !p.standIn).length
}

/** Кого хост ещё не рассудил: человек отвалился, а место висит. */
export function pendingDisconnects(room: RoomState): RoomPlayer[] {
  return room.players.filter((p) => !p.isBot && !p.standIn && !p.online)
}

export function nextBotName(room: RoomState): string {
  const used = new Set(room.players.map((p) => p.name.toLowerCase()))
  return BOT_NAMES.find((n) => !used.has(n.toLowerCase())) ?? `Бот ${room.players.length + 1}`
}

// ─── Проверки ─────────────────────────────────────────────────────────

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

function nameTaken(room: RoomState, name: string, exceptId?: string): boolean {
  const key = name.toLowerCase()
  return (
    room.players.some((p) => p.id !== exceptId && p.name.toLowerCase() === key) ||
    room.spectators.some((s) => s.id !== exceptId && s.name.toLowerCase() === key)
  )
}

// ─── Создание ─────────────────────────────────────────────────────────

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  deckTheme: 'ru',
  maxPlayers: 10,
  allowSpectators: true,
  hostCanUndo: true,
  onDisconnect: 'ask',
  botDifficulty: 'medium',
}

export function createRoom(opts: {
  host: PlayerDraft
  settings?: Partial<RoomSettings>
  code?: string
  seed?: number
  now?: number
  rnd?: () => number
}): RoomState {
  const now = opts.now ?? Date.now()
  const settings = { ...DEFAULT_ROOM_SETTINGS, ...opts.settings }
  settings.maxPlayers = clampPlayers(settings.maxPlayers)

  return {
    code: opts.code ?? generateRoomCode(opts.rnd),
    hostId: opts.host.id,
    players: [makePlayer(opts.host, settings.botDifficulty, now)],
    spectators: [],
    settings,
    callLink: '',
    status: 'lobby',
    seed: opts.seed ?? randomSeed(),
    createdAt: now,
    rev: 0,
  }
}

function clampPlayers(n: number): number {
  return Math.max(ROOM_MIN_PLAYERS, Math.min(ROOM_MAX_PLAYERS, Math.round(n) || ROOM_MIN_PLAYERS))
}

function makePlayer(draft: PlayerDraft, fallbackDifficulty: BotDifficulty, now: number): RoomPlayer {
  return {
    id: draft.id,
    name: cleanName(draft.name),
    professionId: draft.professionId,
    dreamSpace: draft.dreamSpace,
    color: draft.color,
    isBot: draft.isBot ?? false,
    botDifficulty: draft.botDifficulty ?? fallbackDifficulty,
    standIn: false,
    online: true,
    ready: draft.isBot ?? false,
    joinedAt: now,
  }
}

// ─── Вход и выход ─────────────────────────────────────────────────────

export function joinAsPlayer(room: RoomState, draft: PlayerDraft, now = Date.now()): RoomResult {
  const name = cleanName(draft.name)
  if (!name) return fail('BAD_NAME')

  /*
   * 🔴 СНАЧАЛА смотрим, не наш ли это человек, и только потом — идёт ли уже
   * партия.
   *
   * Раньше отказ «партия уже началась» стоял ПЕРВЫМ, и он бил по своим:
   * вышел из партии на главную, вернулся по той же ссылке — а тебя не
   * пускают за собственный стол и предлагают завести новую комнату. Со
   * стороны это выглядело так, будто кнопка «Выйти» вычёркивает из состава,
   * хотя место всё это время стояло на месте и за него ходил бот.
   *
   * Посреди партии возвращаем место КАК ЕСТЬ: профессию, мечту и цвет
   * менять нельзя — стол собран из них, и подмена рассыпала бы партию.
   */
  const existing = findPlayer(room, draft.id)
  if (existing) {
    if (room.status !== 'lobby') return reclaimSeat(room, draft.id)
    return updatePlayer(room, draft.id, { ...draft, name })
  }

  if (room.status !== 'lobby') return fail('ALREADY_STARTED')

  if (room.players.length >= room.settings.maxPlayers) return fail('ROOM_FULL')
  // Себя не считаем: зритель, садящийся за стол, иначе спорил бы со своим же именем.
  if (nameTaken(room, name, draft.id)) return fail('NAME_TAKEN')

  /*
   * 🔴 Совпал цвет фишки — БЕРЁМ СВОБОДНЫЙ, а не отказываем во входе. Раньше
   * здесь стоял отказ COLOR_TAKEN, и вот что получалось: у обоих по умолчанию
   * первый цвет из списка, второй игрок жмёт «Занять место», хозяин молча
   * отклоняет вход, гость сидит на форме и думает, что кнопка сломана. Цвет —
   * украшение; не пускать из-за него за стол нельзя.
   */
  const wanted = ROOM_COLOR_VALUES.includes(draft.color) ? draft.color : nextFreeColor(room)
  const color = takenColors(room).includes(wanted) ? nextFreeColor(room) : wanted

  const player = makePlayer({ ...draft, name, color }, room.settings.botDifficulty, now)
  return {
    ok: true,
    room: next(room, {
      players: [...room.players, player],
      // Зритель, севший за стол, перестаёт быть зрителем.
      spectators: room.spectators.filter((s) => s.id !== draft.id),
    }),
  }
}

export function joinAsSpectator(
  room: RoomState,
  member: { id: string; name: string },
  now = Date.now(),
): RoomResult {
  if (!room.settings.allowSpectators) return fail('NO_SPECTATORS')

  const name = cleanName(member.name)
  if (!name) return fail('BAD_NAME')
  if (room.spectators.some((s) => s.id === member.id)) return { ok: true, room }
  if (nameTaken(room, name, member.id)) return fail('NAME_TAKEN')

  // Зрителем можно стать и в разгар партии — на то он и зритель.
  return {
    ok: true,
    room: next(room, {
      players: room.players.filter((p) => p.id !== member.id),
      spectators: [...room.spectators, { id: member.id, name, joinedAt: now }],
    }),
  }
}

export function updatePlayer(
  room: RoomState,
  id: string,
  patch: Partial<PlayerDraft>,
): RoomResult {
  const player = findPlayer(room, id)
  if (!player) return fail('NOT_FOUND')

  const name = patch.name === undefined ? player.name : cleanName(patch.name)
  if (!name) return fail('BAD_NAME')
  if (nameTaken(room, name, id)) return fail('NAME_TAKEN')

  const color = patch.color ?? player.color
  if (!ROOM_COLOR_VALUES.includes(color)) return fail('COLOR_TAKEN')
  if (takenColors(room, id).includes(color)) return fail('COLOR_TAKEN')

  const updated: RoomPlayer = {
    ...player,
    name,
    color,
    professionId: patch.professionId ?? player.professionId,
    dreamSpace: patch.dreamSpace ?? player.dreamSpace,
    botDifficulty: patch.botDifficulty ?? player.botDifficulty,
    isBot: patch.isBot ?? player.isBot,
  }
  return {
    ok: true,
    room: next(room, { players: room.players.map((p) => (p.id === id ? updated : p)) }),
  }
}

export function setReady(room: RoomState, id: string, ready: boolean): RoomResult {
  if (!findPlayer(room, id)) return fail('NOT_FOUND')
  return {
    ok: true,
    room: next(room, {
      players: room.players.map((p) => (p.id === id ? { ...p, ready } : p)),
    }),
  }
}

/** Кик хостом или полный выход самого игрока: место освобождается. */
export function removeMember(room: RoomState, id: string): RoomResult {
  if (!isMember(room, id)) return fail('NOT_FOUND')

  const players = room.players.filter((p) => p.id !== id)
  const spectators = room.spectators.filter((s) => s.id !== id)

  // Хост ушёл — комната не должна остаться без ведущего: передаём старшему
  // живому игроку, иначе некому будет ни начать партию, ни выгнать зависшего.
  let hostId = room.hostId
  if (hostId === id) {
    const heir = players.find((p) => !p.isBot) ?? players[0] ?? spectators[0]
    hostId = heir?.id ?? ''
  }

  return { ok: true, room: next(room, { players, spectators, hostId }) }
}

/**
 * Игрок вышел, но место остаётся: дальше за него ходит бот.
 * Это выбор из ТЗ — «выйти совсем» против «оставить бота за себя».
 */
export function leaveAsBot(room: RoomState, id: string): RoomResult {
  const player = findPlayer(room, id)
  if (!player) return fail('NOT_FOUND')

  const players = room.players.map((p) =>
    p.id === id ? { ...p, standIn: true, online: false, ready: true } : p,
  )
  let hostId = room.hostId
  if (hostId === id) {
    const heir = players.find((p) => p.id !== id && !p.isBot && !p.standIn) ?? players.find((p) => p.id !== id)
    hostId = heir?.id ?? hostId
  }
  return { ok: true, room: next(room, { players, hostId }) }
}

/** Человек вернулся в свою же комнату — забирает место обратно у бота. */
export function reclaimSeat(room: RoomState, id: string): RoomResult {
  const player = findPlayer(room, id)
  if (!player) return fail('NOT_FOUND')
  return {
    ok: true,
    room: next(room, {
      players: room.players.map((p) =>
        p.id === id ? { ...p, standIn: false, online: true } : p,
      ),
    }),
  }
}

export function setOnline(room: RoomState, id: string, online: boolean): RoomState {
  const player = findPlayer(room, id)
  if (!player || player.online === online) return room

  // Политику «сразу бот» применяем прямо здесь, чтобы очередь ходов не вставала.
  const asBot = !online && room.settings.onDisconnect === 'bot'
  const players = room.players.map((p) =>
    p.id === id ? { ...p, online, standIn: asBot ? true : online ? false : p.standIn } : p,
  )
  return next(room, { players })
}

/** Решение хоста по отвалившемуся игроку. */
export function resolveDisconnect(room: RoomState, id: string, mode: 'bot' | 'drop'): RoomResult {
  return mode === 'bot' ? leaveAsBot(room, id) : removeMember(room, id)
}

// ─── Боты ─────────────────────────────────────────────────────────────

export function addBot(
  room: RoomState,
  opts: {
    id: string
    name?: string
    professionId: string
    dreamSpace: number
    difficulty?: BotDifficulty
    now?: number
  },
): RoomResult {
  if (room.players.length >= room.settings.maxPlayers) return fail('ROOM_FULL')

  const draft: PlayerDraft = {
    id: opts.id,
    name: opts.name ?? nextBotName(room),
    professionId: opts.professionId,
    dreamSpace: opts.dreamSpace,
    color: nextFreeColor(room),
    isBot: true,
    botDifficulty: opts.difficulty ?? room.settings.botDifficulty,
  }
  const player = makePlayer(draft, room.settings.botDifficulty, opts.now ?? Date.now())
  return { ok: true, room: next(room, { players: [...room.players, player] }) }
}

// ─── Настройки и хост ─────────────────────────────────────────────────

export function setSettings(room: RoomState, patch: Partial<RoomSettings>): RoomResult {
  const settings = { ...room.settings, ...patch }
  settings.maxPlayers = clampPlayers(settings.maxPlayers)
  /*
   * 🔴 Выбор стран приводим к порядку ЗДЕСЬ, а не только на старте. Настройки
   * едут по сети от хоста ко всем, и `['TUR','RU']` от одного клиента против
   * `['RU','TUR']` от другого — это два разных состояния комнаты при одном и
   * том же столе: список сравнивают, лишняя разница будит пересборку и
   * показывает «настройки изменились» на пустом месте.
   */
  settings.рынки = нормализоватьРынки(settings.рынки)
  // Потолок нельзя опустить ниже уже сидящих — иначе кто-то «исчезнет» молча.
  settings.maxPlayers = Math.max(settings.maxPlayers, room.players.length)

  const spectators = settings.allowSpectators ? room.spectators : []
  return { ok: true, room: next(room, { settings, spectators }) }
}

export function setCallLink(room: RoomState, raw: string): RoomResult {
  const link = sanitizeCallLink(raw)
  if (link === null) return fail('BAD_LINK')
  return { ok: true, room: next(room, { callLink: link }) }
}

export function transferHost(room: RoomState, id: string): RoomResult {
  if (!isMember(room, id)) return fail('NOT_FOUND')
  return { ok: true, room: next(room, { hostId: id }) }
}

export function setStatus(room: RoomState, status: RoomStatus): RoomState {
  return room.status === status ? room : next(room, { status })
}

// ─── Старт партии ─────────────────────────────────────────────────────

export function canStart(room: RoomState): RoomResult {
  if (room.status !== 'lobby') return fail('ALREADY_STARTED')
  if (room.players.length < ROOM_MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS')
  if (humanCount(room) < 1) return fail('LAST_HUMAN')
  return { ok: true, room }
}

/**
 * Перевод комнаты в сетап стола. Бот-заменитель (standIn) для движка —
 * обычный бот: место должно ходить само, кто бы за ним ни был.
 */
export function toTableSetup(room: RoomState): TableSetup {
  const seats: SeatSetup[] = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    professionId: p.professionId,
    dreamSpace: p.dreamSpace,
    // 🔴 Цвет едет вместе с местом. Без этой строки стол раздавал свои
    // цвета по порядку, и фишка на доске была не та, что выбрали в лобби.
    color: p.color,
    isBot: p.isBot || p.standIn,
    botDifficulty: p.botDifficulty,
  }))
  return {
    seed: room.seed,
    deckTheme: room.settings.deckTheme,
    рынки: нормализоватьРынки(room.settings.рынки),
    seats,
  }
}

/** Место игрока в столе: индекс совпадает с порядком players. */
export function seatIndexOf(room: RoomState, id: string): number {
  return room.players.findIndex((p) => p.id === id)
}

// ─── Действия для транспорта ──────────────────────────────────────────

/**
 * Словарь действий комнаты. Локально хук применяет их к своему состоянию,
 * а сетевой слой гоняет ровно эти же значения — одна модель на оба пути.
 */
export type RoomAction =
  | { type: 'JOIN_PLAYER'; draft: PlayerDraft; at?: number }
  | { type: 'JOIN_SPECTATOR'; id: string; name: string; at?: number }
  | { type: 'UPDATE_PLAYER'; id: string; patch: Partial<PlayerDraft> }
  | { type: 'SET_READY'; id: string; ready: boolean }
  | { type: 'REMOVE_MEMBER'; id: string }
  | { type: 'LEAVE_AS_BOT'; id: string }
  | { type: 'RECLAIM_SEAT'; id: string }
  | { type: 'SET_ONLINE'; id: string; online: boolean }
  | { type: 'RESOLVE_DISCONNECT'; id: string; mode: 'bot' | 'drop' }
  | { type: 'ADD_BOT'; id: string; name?: string; professionId: string; dreamSpace: number; difficulty?: BotDifficulty }
  | { type: 'SET_SETTINGS'; patch: Partial<RoomSettings> }
  | { type: 'SET_CALL_LINK'; link: string }
  | { type: 'TRANSFER_HOST'; id: string }
  | { type: 'SET_STATUS'; status: RoomStatus }
  /** Полное состояние от хоста: им транспорт синхронизирует новичка. */
  | { type: 'SNAPSHOT'; room: RoomState }

/**
 * Редьюсер комнаты. Отклонённое действие не роняет комнату и не меняет её —
 * по сети приходит всякое, и рассинхрон лучше пережить, чем упасть.
 */
export function applyRoomAction(room: RoomState, action: RoomAction): RoomState {
  const done = (r: RoomResult) => (r.ok ? r.room : room)

  switch (action.type) {
    case 'SNAPSHOT':
      return action.room
    case 'JOIN_PLAYER':
      return done(joinAsPlayer(room, action.draft, action.at))
    case 'JOIN_SPECTATOR':
      return done(joinAsSpectator(room, { id: action.id, name: action.name }, action.at))
    case 'UPDATE_PLAYER':
      return done(updatePlayer(room, action.id, action.patch))
    case 'SET_READY':
      return done(setReady(room, action.id, action.ready))
    case 'REMOVE_MEMBER':
      return done(removeMember(room, action.id))
    case 'LEAVE_AS_BOT':
      return done(leaveAsBot(room, action.id))
    case 'RECLAIM_SEAT':
      return done(reclaimSeat(room, action.id))
    case 'SET_ONLINE':
      return setOnline(room, action.id, action.online)
    case 'RESOLVE_DISCONNECT':
      return done(resolveDisconnect(room, action.id, action.mode))
    case 'ADD_BOT':
      return done(
        addBot(room, {
          id: action.id,
          name: action.name,
          professionId: action.professionId,
          dreamSpace: action.dreamSpace,
          difficulty: action.difficulty,
        }),
      )
    case 'SET_SETTINGS':
      return done(setSettings(room, action.patch))
    case 'SET_CALL_LINK':
      return done(setCallLink(room, action.link))
    case 'TRANSFER_HOST':
      return done(transferHost(room, action.id))
    case 'SET_STATUS':
      return setStatus(room, action.status)
    default:
      return room
  }
}
