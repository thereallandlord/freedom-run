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
import { botOfferReply } from './tradeHelpers'
import { scheduleWorldEvent } from './worldClock'

const STORAGE_KEY = 'freedom-run:save:v2'
/**
 * Раз во сколько минут реального времени мир двигается сам.
 * 🔴 Первое событие приходит раньше остальных: иначе начало партии проходит
 * в мёртвом рынке и игрок успевает решить, что мировых событий вообще нет.
 */
export const WORLD_EVENT_MIN = 10
export const WORLD_EVENT_FIRST_MIN = 10

interface Save {
  setup: TableSetup
  events: TableEvent[]
}

export function useGame(net?: {
  /** Отправить ход в сеть. Задан — значит партия сетевая. */
  send: (ev: TableEvent) => void
  /** Я — хозяин стола: только он ведёт ботов, часы мира и передачу хода. */
  isHost: boolean
}) {
  const [setup, setSetup] = useState<TableSetup | null>(null)
  const [events, setEvents] = useState<TableEvent[]>([])
  const [table, setTable] = useState<Table | null>(null)
  const [rolling, setRolling] = useState(false)
  /** Кубик уже остановился, но фишка ещё не пошла — показываем результат. */
  const [rolled, setRolled] = useState<number[] | null>(null)
  const botTimer = useRef<number | null>(null)
  /** Отдельный таймер: на предложение бот отвечает и вне своего хода. */
  const offerTimer = useRef<number | null>(null)

  // ─── Сохранение: храним только сетап и журнал событий ───
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const save = JSON.parse(raw) as Save
      if (!save?.setup) return
      setSetup(save.setup)
      setEvents(save.events ?? [])
      setTable(replayTable(save.setup, save.events ?? []))
    } catch {
      /* испорченное сохранение просто игнорируем */
    }
  }, [])

  useEffect(() => {
    if (!setup) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ setup, events } satisfies Save))
    } catch {
      /* приватный режим — играем без сохранения */
    }
  }, [setup, events])

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
  const netSend = net?.send
  const dispatch = useCallback(
    (e: TableEvent) => {
      if (netSend) netSend(e)
      else applyLocal(e)
    },
    [applyLocal, netSend],
  )

  /**
   * Откат = проигрывание журнала без последнего хода. Даром достаётся от
   * event sourcing.
   *
   * Отменённое складываем в стопку, чтобы можно было ВЕРНУТЬ: промах по
   * кнопке «Отменить» иначе стоил бы хода без всякого способа его вернуть.
   */
  const [undone, setUndone] = useState<TableEvent[]>([])

  const undo = useCallback(() => {
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

  const redo = useCallback(() => {
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
      setTable((prev) => {
        if (!prev || prev.phase === 'finished') return prev
        if (!quiet(prev)) {
          waiting = true
          return prev
        }
        waiting = false
        const ev = { type: 'WORLD_EVENT' as const, index: nextWorldEventIndex(prev) }
        if (netSend) {
          netSend(ev)
          return prev
        }
        const next = applyTableEvent(prev, ev)
        if (next !== prev) setEvents((evs) => [...evs, ev])
        return next
      })
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
    if (!table || table.phase !== 'turnEnd' || !drivesTable) return
    const seat = currentSeat(table)
    if (seat.isBot) return
    const id = window.setTimeout(() => {
      setTable((prev) => {
        if (!prev || prev.phase !== 'turnEnd') return prev
        const next = applyTableEvent(prev, { type: 'END_TURN' })
        if (next !== prev) setEvents((evs) => [...evs, { type: 'END_TURN' } as TableEvent])
        return next
      })
    }, 1100)
    return () => window.clearTimeout(id)
  }, [table])

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
      setTable((prev) => {
        if (!prev) return prev
        const next = applyTableEvent(prev, ev)
        if (next !== prev) {
          setEvents((evs) => [...evs, ev])
          return next
        }
        // Событие отклонено — не зацикливаемся, закрываем ход.
        const forced = applyTableEvent(prev, { type: 'END_TURN' })
        if (forced !== prev) setEvents((evs) => [...evs, { type: 'END_TURN' } as TableEvent])
        return forced
      })
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
      setTable((prev) => {
        if (!prev) return prev
        const next = applyTableEvent(prev, reply.event)
        if (next !== prev) {
          setEvents((evs) => [...evs, reply.event])
          return next
        }
        // Движок отклонил согласие (цена уже не та, денег не хватило) — снимаем
        // предложение, иначе человек будет ждать ответа, которого не будет.
        const off = applyTableEvent(prev, reply.fallback)
        if (off !== prev) setEvents((evs) => [...evs, reply.fallback])
        return off
      })
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
    undo,
    redo,
    canRedo: undone.length > 0,
    reset,
    rematch,
    roll,
    rolling,
    rolled,
  }
}
