import { useEffect, useMemo, useState } from 'react'
import { Dropdown } from './Dropdown'
import {
  TOKEN_COLORS,
  dreamSpaces,
  professionName,
  professionsFor,
  randomProfessionNear,
  setActiveTheme,
  setFastBoardTheme,
} from '../engine/data'
import { RULES, professionMonthlyCashFlow, setRules } from '../engine/ledger'
import { randomSeed } from '../engine/rng'
import type { SeatSetup, TableSetup } from '../engine/table'
import type { BotDifficulty } from '../engine/types'
import { ROOM_MAX_PLAYERS } from '../engine/room'
import { DECKS, DeckCard } from './DeckCard'
import { Wordmark } from './Wordmark'
import { Page } from './kit'
import type { DeckTheme } from '../engine/data'

const MIN_PLAYERS = 2
const MAX_PLAYERS = ROOM_MAX_PLAYERS

const BOT_LABEL: Record<BotDifficulty, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  high: 'Сильный',
  unreal: 'Нереальный',
}

function money(n: number, rub: boolean) {
  return rub ? n.toLocaleString('ru-RU') + ' ₽' : '$' + n.toLocaleString('en-US')
}

export function Setup({ onStart }: { onStart: (s: TableSetup) => void }) {
  const [theme, setTheme] = useState<DeckTheme>('ru')

  // Поле Полосы и набор профессий зависят от темы — переключаем до чтения списков.
  const { dreams, professions, isRub } = useMemo(() => {
    setActiveTheme(theme)
    setFastBoardTheme(theme)
    setRules(
      theme === 'ru'
        ? { currency: 'RUB', fastTrackMultiplier: 50, fastTrackTarget: 1_000_000, loansEnabled: false, yieldScale: 0.3 }
        : { currency: 'USD', fastTrackMultiplier: 100, fastTrackTarget: 150_000, loansEnabled: true, yieldScale: 1 },
    )
    return { dreams: dreamSpaces(), professions: professionsFor(theme), isRub: RULES.currency === 'RUB' }
  }, [theme])

  const [seats, setSeats] = useState<SeatSetup[]>([
    { name: 'Игрок 1', professionId: 'engineer', dreamSpace: 2, isBot: false, botDifficulty: 'medium' },
    { name: 'Игрок 2', professionId: 'teacher', dreamSpace: 7, isBot: true, botDifficulty: 'medium' },
  ])

  // Смена темы меняет и профессии, и мечты — подставляем валидные значения.
  useEffect(() => {
    setSeats((prev) =>
      prev.map((s, i) => ({
        ...s,
        professionId: professions.some((p) => p.id === s.professionId)
          ? s.professionId
          : professions[i % professions.length].id,
        dreamSpace: dreams.some((d) => d.index === s.dreamSpace)
          ? s.dreamSpace
          : dreams[i % dreams.length].index,
      })),
    )
  }, [professions, dreams])

  const professionOptions = useMemo(
    () =>
      professions.map((p) => ({
        value: p.id,
        label: professionName(p, 'ru'),
        hint: money(professionMonthlyCashFlow(p), isRub) + '/мес',
      })),
    [professions, isRub],
  )

  const dreamOptions = useMemo(
    () => dreams.map((d) => ({ value: d.index, label: d.name, hint: money(d.price, isRub) })),
    [dreams, isRub],
  )

  const update = (i: number, patch: Partial<SeatSetup>) =>
    setSeats((s) => s.map((seat, idx) => (idx === i ? { ...seat, ...patch } : seat)))

  const addSeat = () =>
    setSeats((s) => [
      ...s,
      {
        name: `Игрок ${s.length + 1}`,
        professionId: professions[s.length % professions.length].id,
        dreamSpace: dreams[s.length % dreams.length].index,
        isBot: true,
        botDifficulty: 'medium',
      },
    ])

  const randomize = (i: number) => {
    // Держим уровень стола: случайная профессия берётся рядом с уже занятыми.
    const taken = seats.filter((_, idx) => idx !== i).map((s) => s.professionId)
    update(i, { professionId: randomProfessionNear(theme, taken).id })
  }

  const randomizeAll = () => {
    const taken: string[] = []
    setSeats((prev) =>
      prev.map((s) => {
        const p = randomProfessionNear(theme, taken)
        taken.push(p.id)
        return { ...s, professionId: p.id }
      }),
    )
  }

  return (
    <Page width="room">
      <header className="mb-7 text-center">
        <Wordmark size="lg" className="justify-center" />
        <p className="mt-2 text-sm text-[var(--muted)]">
          Вырвись из денежной рутины: нарасти пассивный доход выше расходов, потом мчись к мечте.
        </p>
      </header>

      <div className="panel mb-4 rounded-xl p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Колода сделок
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {DECKS.map((d) => (
            <button
              key={d.id}
              onClick={() => setTheme(d.id)}
              aria-pressed={theme === d.id}
              className="group rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <DeckCard deck={d} selected={theme === d.id} />
              <p className="mt-3 max-w-[188px] text-[12px] leading-snug text-[var(--muted)]">
                {d.about}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {seats.map((seat, i) => (
          <div key={i} className="panel rounded-xl p-4">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="size-4 shrink-0 rounded-full ring-2 ring-white/15"
                style={{ background: TOKEN_COLORS[i % TOKEN_COLORS.length] }}
              />
              <input
                value={seat.name}
                maxLength={24}
                onChange={(e) => update(i, { name: e.target.value })}
                className="w-44 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
              />
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => update(i, { isBot: !seat.isBot })}
                  className={`btn text-xs ${
                    seat.isBot
                      ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40'
                      : 'border border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)]'
                  }`}
                >
                  🤖 Бот
                </button>
                {seats.length > MIN_PLAYERS && (
                  <button
                    onClick={() => setSeats((s) => s.filter((_, idx) => idx !== i))}
                    className="btn border border-[var(--line)] bg-[var(--panel-2)] text-xs text-[var(--muted)] hover:text-rose-400"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-[var(--muted)]">Профессия</span>
                  <button
                    onClick={() => randomize(i)}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    🎲 случайная
                  </button>
                </div>
                <Dropdown
                  value={seat.professionId}
                  options={professionOptions}
                  onChange={(v) => update(i, { professionId: v })}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--muted)]">Мечта — победа при покупке</div>
                <Dropdown
                  value={seat.dreamSpace}
                  options={dreamOptions}
                  onChange={(v) => update(i, { dreamSpace: v })}
                />
              </div>
            </div>

            {seat.isBot && (
              <div className="mt-3">
                <div className="mb-1 text-xs text-[var(--muted)]">Сложность бота</div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(BOT_LABEL) as BotDifficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => update(i, { botDifficulty: d })}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        seat.botDifficulty === d
                          ? 'bg-emerald-500 text-emerald-950'
                          : 'border border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {BOT_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        {seats.length < MAX_PLAYERS && (
          <button onClick={addSeat} className="btn-ghost">
            ＋ Добавить игрока
          </button>
        )}
        <button onClick={randomizeAll} className="btn-ghost" title="Случайные профессии одного уровня">
          🎲 Всем случайные
        </button>
        <button
          onClick={() =>
            onStart({ seed: randomSeed(), deckTheme: theme, seats })
          }
          className="btn-primary ml-auto px-6 py-2.5 text-base"
        >
          Начать игру
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        {MIN_PLAYERS}–{MAX_PLAYERS} игроков на одном устройстве. Ход передаётся по списку.
      </p>
    </Page>
  )
}
