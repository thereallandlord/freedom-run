import { useCallback, useEffect, useRef, useState } from 'react'
import type { Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import {
  applyTableEvent,
  createTable,
  currentSeat,
  nextWorldEventIndex,
  replayTable,
  type TableSetup,
} from '../engine/table'
import { randomSeed } from '../engine/rng'
import { decideBotEvent } from '../engine/bots'
import { mulberry32 } from '../engine/rng'
import {
  RAT_BOARD,
  WORLD_EVENTS,
  bigDeals,
  doodads,
  marketCards,
  smallDeals,
  известнаяКолода,
} from '../engine/data'
import { botOfferReply } from './tradeHelpers'
import { saveGame } from '../net/gamesApi'
import { currentUser } from '../net/auth'
import { scheduleWorldEvent } from './worldClock'

const STORAGE_KEY = 'freedom-run:save:v2'

/**
 * Отпечаток правил и колод.
 *
 * 🔴 ЗАЧЕМ. Партия хранится не столом, а ЖУРНАЛОМ ходов: при возврате она
 * пересобирается с нуля. Значит любое изменение колод или случайности делает
 * старый журнал недействительным — карты приходят другие, часть событий
 * движок отклоняет. Замер на 30 записанных партиях: после правки колод
 * 18,9% событий отвергнуто, и партия МОЛЧА становилась другой — другие
 * деньги, другое имущество, другой победитель.
 *
 * Поэтому вместе с журналом храним отпечаток того, чем он записан. Не сошлось
 * — не восстанавливаем и говорим об этом прямо, вместо того чтобы подсунуть
 * человеку подделку его же партии.
 *
 * Считается САМ, из длин колод: забыть его обновить нельзя, потому что
 * менять их, не меняя длину, — это как раз безопасный случай.
 */
let отпечатокКэш: string | null = null
function отпечатокПравил(): string {
  if (отпечатокКэш) return отпечатокКэш
  /*
   * 🔴 СЧИТАЕМ ПО СОДЕРЖИМОМУ, А НЕ ПО ДЛИНАМ. Сначала я взял длины колод —
   * и это лечит только половину случаев. Стоило проставить карточкам стадию
   * (поле есть, длина не изменилась), как старый журнал стал бы выдавать
   * ДРУГИЕ карты, а отпечаток совпал бы и разрешил восстановление. Партия
   * молча превратилась бы в другую — ровно то, от чего отпечаток и заведён.
   *
   * Свёртка простая (FNV-1a) и синхронная: криптография тут не нужна, нужна
   * лишь уверенность, что «данные другие» заметно. Считается один раз на
   * загрузку страницы.
   */
  const всё = JSON.stringify([
    smallDeals('ru'),
    bigDeals('ru'),
    marketCards('ru'),
    doodads('ru'),
    WORLD_EVENTS,
    RAT_BOARD,
  ])
  let h = 0x811c9dc5
  for (let i = 0; i < всё.length; i++) {
    h ^= всё.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  отпечатокКэш = `${всё.length.toString(36)}.${h.toString(36)}`
  return отпечатокКэш
}
/**
 * Раз во сколько минут реального времени мир двигается сам.
 * 🔴 Первое событие приходит раньше остальных: иначе начало партии проходит
 * в мёртвом рынке и игрок успевает решить, что мировых событий вообще нет.
 */
export const WORLD_EVENT_MIN = 7
export const WORLD_EVENT_FIRST_MIN = 7

interface Save {
  setup: TableSetup
  events: TableEvent[]
  /** Отпечаток правил, которыми записан журнал. Старые записи его не несут. */
  правила?: string
}

/** Что делать с несовместимой записью — решает экран, а не хук. */
export type НесовместимаяПартия = { когда: number; ходов: number }

export function useGame(net?: {
  /** Отправить ход в сеть. Задан — значит партия сетевая. */
  send: (ev: TableEvent) => void
  /** Я — хозяин стола: только он ведёт ботов, часы мира и передачу хода. */
  isHost: boolean
  /** Моё место за столом: им подписывается каждое моё действие. */
  meId?: string
}) {
  const [setup, setSetup] = useState<TableSetup | null>(null)
  const [events, setEvents] = useState<TableEvent[]>([])
  const [table, setTable] = useState<Table | null>(null)
  const [rolling, setRolling] = useState(false)
  /** Кубик уже остановился, но фишка ещё не пошла — показываем результат. */
  const [rolled, setRolled] = useState<number[] | null>(null)
  const botTimer = useRef<number | null>(null)
  /** Свежий стол для таймеров: они живут дольше одного рендера. */
  const tableRef = useRef<Table | null>(null)
  /** Отдельный таймер: на предложение бот отвечает и вне своего хода. */
  const offerTimer = useRef<number | null>(null)
  /** Найдено сохранение от прежней версии игры — восстановить его нельзя. */
  const [устарела, setУстарела] = useState<НесовместимаяПартия | null>(null)

  // ─── Сохранение: храним только сетап и журнал событий ───
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const save = JSON.parse(raw) as Save
      if (!save?.setup) return
      /*
       * 🔴 Журнал, записанный ДРУГИМИ колодами, не восстанавливаем. Он
       * пересоберётся во что-то другое, и человек этого не заметит. Лучше
       * честно сказать «партия записана прежней версией», чем подсунуть
       * подделку.
       */
      /*
       * 🔴 Колода, которой больше нет, — партию не поднимаем. Отпечаток
       * считается по РУССКОЙ колоде, поэтому запись, сделанная убранными
       * английскими, отпечаток пройдёт и переиграется русскими карточками:
       * человек увидит свою партию, в которой всё другое. Лучше честно
       * сказать «записана прежней версией».
       */
      if (!известнаяКолода(save.setup.deckTheme)) {
        setУстарела({ когда: Date.now(), ходов: (save.events ?? []).length })
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      if ((save.правила ?? '') !== отпечатокПравил()) {
        setУстарела({ когда: Date.now(), ходов: (save.events ?? []).length })
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      setSetup(save.setup)
      setEvents(save.events ?? [])
      setTable(replayTable(save.setup, save.events ?? []))
    } catch {
      /* испорченное сохранение просто игнорируем */
    }
  }, [])

  /*
   * 🔴 Идущая партия уезжает В КАБИНЕТ, а не только в браузер.
   *
   * Пока журнал жил лишь в localStorage игроков, комната, из которой вышли
   * все, пропадала навсегда: поднять стол было неоткуда. Теперь раз в
   * несколько ходов партия дописывается на сервер с пустым временем финиша —
   * это и значит «ещё играем». Тихо: не вышел, сеть легла, сервер молчит —
   * игра продолжается как ни в чём не бывало.
   */
  const сохраненоНаХоде = useRef(-1)
  useEffect(() => {
    if (!table || table.phase === 'finished') return
    if (!currentUser()) return
    const ход = table.turnCounter
    if (ход < 3 || ход - сохраненоНаХоде.current < 5) return
    сохраненоНаХоде.current = ход
    void saveGame(table, events, meId, null, false)
  }, [table?.turnCounter])

  useEffect(() => {
    if (!setup) return
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ setup, events, правила: отпечатокПравил() } satisfies Save),
      )
    } catch {
      /* приватный режим — играем без сохранения */
    }
  }, [setup, events])

  useEffect(() => {
    tableRef.current = table
  }, [table])

  /**
   * Вернуться в идущую партию: тот же состав, весь журнал ходов с начала.
   * 🔴 Без этого перезагрузка начинала игру заново — журнал приезжал от
   * соседа, но применять его было некуда.
   */
  const resume = useCallback((s: TableSetup, journal: TableEvent[], undoneCount = 0) => {
    setSetup(s)
    setEvents(journal)
    setTable(replayTable(s, journal))
    // Сколько ходов сейчас «в отмене» — по этому числу оживает кнопка «Вернуть».
    setUndoneNet(undoneCount)
  }, [])

  const start = useCallback((s: TableSetup) => {
    setSetup(s)
    setEvents([])
    setTable(createTable(s))
  }, [])

  /**
   * Применить ход локально. Единственная точка изменения стола.
   * В сетевой партии сюда попадают ходы ТОЛЬКО из сети (включая эхо своего),
   * поэтому у всех получается один и тот же порядок.
   */
  const applyLocal = useCallback((e: TableEvent) => {
    setUndone([])
    setTable((prev) => {
      if (!prev) return prev
      const next = applyTableEvent(prev, e)
      if (next !== prev) setEvents((evs) => [...evs, e])
      return next
    })
  }, [])

  /*
   * 🔴 В сетевой партии клик НЕ применяется на месте: он уходит в канал и
   * возвращается эхом. Раньше ходы вообще не отправлялись — комната
   * синхронизировалась, а партия у каждого шла своя, и соперник не видел ни
   * карточек, ни бросков.
   */
  /*
   * 🔴 СЕТЕВОЙ ОБЪЕКТ БЕРЁМ, ТОЛЬКО ЕСЛИ ПАРТИЯ И ПРАВДА ИЗ КОМНАТЫ.
   *
   * Комната поднимается из браузера при каждом запуске и живёт, пока её не
   * покинешь ЯВНО. Поэтому «комната есть» ≠ «мы играем в ней»: человек мог
   * когда-то зайти в комнату, а сейчас играть за одним экраном.
   *
   * Признак берём у СЕТАПА, а не у стола: места, пришедшие с экрана настройки,
   * безымянные, а места из комнаты несут имена участников. Сетап у партии один
   * и не меняется, поэтому признак не моргает — в отличие от попытки считать
   * его по столу: та ломала живую онлайн-партию (ход переставал уходить в
   * комнату, журнал комнаты отставал и затирал мой, счётчик ходов ехал назад).
   *
   * 🔴 И НИКАКОГО «СНИМЕМ ПОДПИСЬ НА ВСЯКИЙ СЛУЧАЙ». Действие без подписи
   * движок применяет К ХОДЯЩЕМУ и не проверяет права вовсе — это не
   * осторожность, а дыра: зритель или не пущенный в партию человек начал бы
   * ходить за того, чей ход. Либо подписываем своим местом, либо сети нет
   * совсем.
   */
  const местнаяПартия = !!setup && setup.seats.every((s) => !(s as { id?: string }).id)
  const netSend = местнаяПартия ? undefined : net?.send
  const meId = местнаяПартия ? undefined : net?.meId

  const dispatch = useCallback(
    (e: TableEvent) => {
      /*
       * Подписываем действие своим местом: движок берёт исполнителя из подписи,
       * а не «того, чей ход». Без этого чужое нажатие тратило чужие деньги.
       *
       * 🔴 НО ТОЛЬКО ЕСЛИ ТАКОЕ МЕСТО ЗА ЭТИМ СТОЛОМ ЕСТЬ.
       *
       * Движок отвергает подпись, которой нет среди мест (table.ts, страж
       * `event.by && byIdx < 0`) — и правильно делает: иначе чужое нажатие
       * тратило бы чужой кошелёк. Но подпись сюда приезжает из КОМНАТЫ, а
       * стол может быть местным: у мест местной партии имена `seat-0`,
       * `seat-1`, и с ними подпись из комнаты не сходится НИКОГДА.
       *
       * Что это давало: у кого в браузере осталась незакрытая онлайн-комната
       * (её достаточно не «покинуть», а просто уйти на главную), местная
       * партия ложилась целиком — кубик не бросался, карточки не выпадали,
       * ход не переходил. Движок молча отклонял КАЖДОЕ действие, а на экране
       * это выглядело как «нажимаю — ничего». Воспроизведено и снято живьём:
       * с комнатой в хранилище журнал после «Броска» пустой, без неё — ход
       * проходит с первого раза.
       *
       * Поэтому подпись ставим, только когда она что-то значит за ЭТИМ столом.
       */
      const signed = meId ? ({ ...e, by: meId } as TableEvent) : e
      if (netSend) {
        /*
         * 🔴 Свой клик применяем СРАЗУ, не дожидаясь эха. Ожидание круга по
         * сети давало заметную задержку — «синхронизация стала медленнее», —
         * а при потере эха клик пропадал совсем. Правду всё равно определяет
         * общий журнал: как только он приедет, стол пересоберётся по нему, и
         * если наш ход не прошёл, его просто не будет.
         */
        applyLocal(signed)
        netSend(signed)
      } else applyLocal(signed)
    },
    [applyLocal, meId, netSend],
  )

  /**
   * Откат = проигрывание журнала без последнего хода. Даром достаётся от
   * event sourcing.
   *
   * Отменённое складываем в стопку, чтобы можно было ВЕРНУТЬ: промах по
   * кнопке «Отменить» иначе стоил бы хода без всякого способа его вернуть.
   */
  const [undone, setUndone] = useState<TableEvent[]>([])
  /** Сколько ходов отменено в СЕТЕВОЙ партии (там стопка живёт в журнале). */
  const [undoneNet, setUndoneNet] = useState(0)

  /**
   * Снять последний ход у СЕБЯ. В сетевой партии зовётся не напрямую, а по
   * команде из канала — иначе журнал разъедется: у одного ход снят, у другого
   * нет. Команду шлёт хозяин стола (кнопка есть только у него).
   */
  const undoLocal = useCallback(() => {
    if (!setup) return
    setEvents((evs) => {
      if (!evs.length) return evs
      const last = evs[evs.length - 1]
      const next = evs.slice(0, -1)
      setUndone((u) => [...u, last])
      setTable(replayTable(setup, next))
      return next
    })
  }, [setup])

  const undo = useCallback(() => {
    // 🔴 В сети отмена — запись в общем журнале, а не личное дело: стол у всех
    // пересобирается по журналу, и «откат у себя» тут же затёрся бы обратно.
    if (netSend) netSend({ type: '__UNDO' } as unknown as TableEvent)
    else undoLocal()
  }, [netSend, undoLocal])

  const redo = useCallback(() => {
    if (netSend) {
      netSend({ type: '__REDO' } as unknown as TableEvent)
      return
    }
    if (!setup) return
    setUndone((u) => {
      if (!u.length) return u
      const ev = u[u.length - 1]
      setEvents((evs) => {
        const next = [...evs, ev]
        setTable(replayTable(setup, next))
        return next
      })
      return u.slice(0, -1)
    })
  }, [setup])

  /** Реванш: те же игроки и режим, свежие колоды. Новая ссылка не нужна. */
  const rematch = useCallback(() => {
    if (!setup) return
    const next = { ...setup, seed: randomSeed() }
    setSetup(next)
    setEvents([])
    setTable(createTable(next))
  }, [setup])

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setSetup(null)
    setEvents([])
    setTable(null)
  }, [])

  /**
   * Бросок с анимацией: сами кубики попадают в событие, поэтому партия
   * воспроизводима.
   *
   * 🔴 Две паузы, а не одна. Сначала кубик крутится, потом ОСТАНАВЛИВАЕТСЯ на
   * выпавшем числе и его видно — и только после этого фишка идёт. Раньше по
   * нажатию мгновенно открывалась карточка, и человек не понимал, сколько
   * выпало и почему он там оказался. Камиль: «мы же бросок кубика делаем,
   * должны видеть, сколько выпало».
   */
  const roll = useCallback(
    (count: number) => {
      const dice = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6))
      setRolling(true)
      setRolled(null)
      window.setTimeout(() => {
        setRolling(false)
        setRolled(dice) // кубик замер — число видно
        window.setTimeout(() => {
          dispatch({ type: 'ROLL', dice })
          setRolled(null)
        }, 850)
      }, 700)
    },
    [dispatch],
  )

  /*
   * Мировые события идут по ЧАСАМ, а не по ходам: раз в WORLD_EVENT_MIN минут
   * рынок двигается сам, независимо от того, чей сейчас ход.
   *
   * Отсчёт заводится один раз на всю партию. Раньше он висел на фазе хода
   * и перезапускался каждым броском — до конца интервала дело почти не
   * доходило. Срок следующего события уезжает в worldClock: его показывает
   * индикатор рынка.
   */
  const drivesTable = !net || net.isHost
  const worldClockOn = !!table && table.phase !== 'finished' && drivesTable
  useEffect(() => {
    if (!worldClockOn) return
    const period = WORLD_EVENT_MIN * 60_000
    const first = WORLD_EVENT_FIRST_MIN * 60_000

    /*
     * 🔴 Мир двигается ТОЛЬКО В ПАУЗЕ между ходами. Раньше событие приходило
     * по таймеру когда угодно — в том числе поверх открытой карточки, посреди
     * чужого решения. Оно сбивало игру. Теперь, если ход идёт, событие ждёт
     * своей минуты: как только стол вернулся к ожиданию броска, оно выходит.
     */
    let waiting = false
    const quiet = (t: Table | null) =>
      !!t && t.phase === 'awaitingRoll' && !t.pending && !t.lastRoll

    const fire = () => {
      const now = tableRef.current
      if (!now || now.phase === 'finished') return
      if (!quiet(now)) {
        waiting = true
        return
      }
      waiting = false
      const индекс = nextWorldEventIndex(now)
      /*
       * 🔴 Новости кончились — молчим, а не шлём пустое событие. Каждое
       * событие выпадает не больше одного раза за партию (решение Камиля:
       * мир не повторяется), и когда колода пройдена, слать в журнал
       * пустышки каждые десять минут незачем.
       */
      if (индекс < 0) return
      const ev = { type: 'WORLD_EVENT' as const, index: индекс }
      if (netSend) netSend(ev)
      else applyLocal(ev)
    }

    scheduleWorldEvent(first)
    let interval: number | null = null
    const kick = window.setTimeout(() => {
      fire()
      scheduleWorldEvent(period)
      interval = window.setInterval(() => {
        scheduleWorldEvent(period)
        fire()
      }, period)
    }, first)

    /* Событие, дождавшееся своей очереди, выходит на ближайшей тихой минуте. */
    const watch = window.setInterval(() => {
      if (waiting) fire()
    }, 1200)

    return () => {
      window.clearTimeout(kick)
      window.clearInterval(watch)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [worldClockOn])

  /*
   * Ход уходит САМ. Кнопки «Передать ход» нет — за настоящим столом никто не
   * жмёт кнопку, чтобы отдать кубик соседу. Пауза нужна ровно для того, чтобы
   * человек успел прочитать, что с ним только что произошло.
   */
  useEffect(() => {
    if (!table || table.phase !== 'turnEnd') return
    const seat = currentSeat(table)
    if (seat.isBot) return
    /*
     * 🔴 Ход завершает и САМ ходящий, а не только хозяин комнаты.
     *
     * Раньше здесь стояло `!drivesTable → выходим`, то есть двигал стол
     * ровно один человек. Стоило ему свернуть вкладку, потерять сеть или
     * перезайти (после чего хозяином себя не считает уже никто) — и стол
     * замирал в конце хода НАВСЕГДА: кнопки «передать ход» нет, а кнопка
     * броска не появляется, потому что ход так и не перешёл. Со стороны это
     * и выглядело как «кнопки не работают».
     *
     * Дублирования не боимся: конец хода приходит без подписи, а применить
     * его дважды движок не даст — второй раз он его отклонит.
     */
    const мойХод = !!meId && seat.id === meId
    if (!drivesTable && !мойХод) return
    /*
     * 🔴 Отправка в сеть НЕ ВНУТРИ setTable. Обновляющая функция обязана быть
     * чистой: React зовёт её когда захочет и сколько захочет, и отправка
     * оттуда уходила то дважды, то ни разу — ход «переходил через раз», а
     * иногда только после отмены. Здесь простой таймер и прямой вызов.
     */
    const ход = table.turnCounter
    const id = window.setTimeout(() => {
      if (netSend) netSend({ type: 'END_TURN', turn: ход } as TableEvent)
      else applyLocal({ type: 'END_TURN', turn: ход } as TableEvent)
    }, 1100)

    /*
     * Страховка: если через три секунды стол ВСЁ ЕЩЁ в конце хода, значит
     * событие где-то потерялось — повторяем. Повтор безопасен: применить
     * конец хода дважды нельзя, второй раз движок его отклонит.
     */
    const retry = window.setInterval(() => {
      const now = tableRef.current
      if (!now || now.phase !== 'turnEnd') return
      // Номер берём СВЕЖИЙ: если ход уже ушёл, повтор не должен закрыть чужой.
      const ev = { type: 'END_TURN', turn: now.turnCounter } as TableEvent
      if (netSend) netSend(ev)
      else applyLocal(ev)
    }, 3000)

    return () => {
      window.clearTimeout(id)
      window.clearInterval(retry)
    }
  }, [table, drivesTable, meId])

  // ─── Водитель ботов ───
  useEffect(() => {
    if (!table || table.phase === 'finished' || !drivesTable) return
    const seat = currentSeat(table)
    if (!seat.isBot || seat.outOfGame) return

    const rnd = mulberry32(table.seed + events.length * 7919)
    const ev = decideBotEvent(table, rnd)
    if (!ev) return
    const prev0 = table

    /*
     * 🔴 Бот думает ЗАМЕТНО. Раньше он решал за полсекунды: карточка
     * появлялась и исчезала быстрее, чем её можно прочесть, и половина
     * партии проходила мимо человека. За настоящим столом сосед тоже берёт
     * паузу — и именно в эту паузу ты видишь, что ему выпало.
     */
    /*
     * 🔴 Пауза РАЗНАЯ по смыслу события. Раньше все решения бота шли за
     * полсекунды, потом за две — Камиль всё равно не успевал прочитать, что
     * соседу выпало. Дольше всего держим момент, когда на экране лежит его
     * карточка: это единственный способ увидеть чужой ход.
     */
    const delay =
      ev.type === 'ROLL' ? 1000 : ev.type === 'END_TURN' ? 1600 : prev0.pending ? 3600 : 2000
    botTimer.current = window.setTimeout(() => {
      // Ход бота ведёт хозяин стола, но применяют его все — через канал.
      const accepted = applyTableEvent(table, ev) !== table
      const out = accepted ? ev : ({ type: 'END_TURN' } as TableEvent)
      if (netSend) netSend(out)
      else applyLocal(out)
    }, delay)

    return () => {
      if (botTimer.current) window.clearTimeout(botTimer.current)
    }
  }, [table, events.length])

  /*
   * Ответ бота на сделку между игроками. Отдельно от главного водителя:
   * предложение приходит боту, когда ход НЕ его, и тот эффект молчит.
   * Решение считает движок (botAcceptsOffer) — здесь только пауза, чтобы
   * стол не выглядел роботизированным, и защита от зависшего предложения.
   */
  useEffect(() => {
    if (!table || table.phase === 'finished' || !drivesTable) return
    const reply = botOfferReply(table)
    if (!reply) return

    offerTimer.current = window.setTimeout(() => {
      // Движок мог отклонить согласие (цена уже не та, денег не хватило) —
      // тогда снимаем предложение, иначе человек ждёт ответа, которого не будет.
      const accepted = applyTableEvent(table, reply.event) !== table
      const out = accepted ? reply.event : reply.fallback
      if (netSend) netSend(out)
      else applyLocal(out)
    }, 1200)

    return () => {
      if (offerTimer.current) window.clearTimeout(offerTimer.current)
    }
  }, [table, events.length])

  return {
    setup,
    table,
    events,
    start,
    dispatch,
    applyLocal,
    undoLocal,
    resume,
    undo,
    redo,
    canRedo: netSend ? undoneNet > 0 : undone.length > 0,
    reset,
    rematch,
    roll,
    rolling,
    rolled,
    /**
     * Нашли сохранение от прежней версии игры. Восстановить его нельзя:
     * колоды изменились, и журнал пересобрался бы во что-то другое.
     */
    устарела,
    забытьУстаревшую: () => setУстарела(null),
  }
}
