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
/** Раз во сколько минут реального времени мир двигается сам. */
export const WORLD_EVENT_MIN = 12

interface Save {
  setup: TableSetup
  events: TableEvent[]
}

export function useGame() {
  const [setup, setSetup] = useState<TableSetup | null>(null)
  const [events, setEvents] = useState<TableEvent[]>([])
  const [table, setTable] = useState<Table | null>(null)
  const [rolling, setRolling] = useState(false)
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

  const dispatch = useCallback((e: TableEvent) => {
    setTable((prev) => {
      if (!prev) return prev
      const next = applyTableEvent(prev, e)
      if (next !== prev) setEvents((evs) => [...evs, e])
      return next
    })
  }, [])

  /** Откат = проигрывание журнала без последнего хода. Даром достаётся от event sourcing. */
  const undo = useCallback(() => {
    if (!setup) return
    setEvents((evs) => {
      const next = evs.slice(0, -1)
      setTable(replayTable(setup, next))
      return next
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

  /** Бросок с анимацией: сами кубики попадают в событие, поэтому партия воспроизводима. */
  const roll = useCallback(
    (count: number) => {
      setRolling(true)
      window.setTimeout(() => {
        const dice = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6))
        dispatch({ type: 'ROLL', dice })
        setRolling(false)
      }, 600)
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
  const worldClockOn = !!table && table.phase !== 'finished'
  useEffect(() => {
    if (!worldClockOn) return
    const period = WORLD_EVENT_MIN * 60_000
    scheduleWorldEvent(period)
    const id = window.setInterval(() => {
      scheduleWorldEvent(period)
      setTable((prev) => {
        if (!prev || prev.phase === 'finished') return prev
        const ev = { type: 'WORLD_EVENT' as const, index: nextWorldEventIndex(prev) }
        const next = applyTableEvent(prev, ev)
        if (next !== prev) setEvents((evs) => [...evs, ev])
        return next
      })
    }, period)
    return () => window.clearInterval(id)
  }, [worldClockOn])

  // ─── Водитель ботов ───
  useEffect(() => {
    if (!table || table.phase === 'finished') return
    const seat = currentSeat(table)
    if (!seat.isBot || seat.outOfGame) return

    const rnd = mulberry32(table.seed + events.length * 7919)
    const ev = decideBotEvent(table, rnd)
    if (!ev) return

    const delay = ev.type === 'ROLL' ? 700 : 480
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
    if (!table || table.phase === 'finished') return
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

  return { setup, table, events, start, dispatch, undo, reset, rematch, roll, rolling }
}
