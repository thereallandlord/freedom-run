import { useMemo, useState } from 'react'
import { Dropdown } from './Dropdown'
import { PROFESSIONS, TOKEN_COLORS, dreamSpaces, professionName } from '../engine/data'
import { professionMonthlyCashFlow } from '../engine/ledger'
import { randomSeed } from '../engine/rng'
import type { SeatSetup, TableSetup } from '../engine/table'
import type { BotDifficulty } from '../engine/types'
import type { DeckTheme } from '../engine/data'

const MIN_PLAYERS = 2
const MAX_PLAYERS = 6

const BOT_LABEL: Record<BotDifficulty, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  high: 'Сильный',
  unreal: 'Нереальный',
}

function money(n: number) {
  return '$' + n.toLocaleString('en-US')
}

export function Setup({ onStart }: { onStart: (s: TableSetup) => void }) {
  const dreams = useMemo(() => dreamSpaces(), [])
  const [theme, setTheme] = useState<DeckTheme>('offshore')
  const [seats, setSeats] = useState<SeatSetup[]>([
    { name: 'Игрок 1', professionId: 'engineer', dreamSpace: dreams[0].index, isBot: false, botDifficulty: 'medium' },
    { name: 'Игрок 2', professionId: 'teacher', dreamSpace: dreams[1].index, isBot: true, botDifficulty: 'medium' },
  ])

  const professionOptions = useMemo(
    () =>
      PROFESSIONS.map((p) => ({
        value: p.id,
        label: professionName(p, 'ru'),
        hint: money(professionMonthlyCashFlow(p)) + '/мес',
      })),
    [],
  )

  const dreamOptions = useMemo(
    () => dreams.map((d) => ({ value: d.index, label: d.name, hint: money(d.price) })),
    [dreams],
  )

  const update = (i: number, patch: Partial<SeatSetup>) =>
    setSeats((s) => s.map((seat, idx) => (idx === i ? { ...seat, ...patch } : seat)))

  const addSeat = () =>
    setSeats((s) => [
      ...s,
      {
        name: `Игрок ${s.length + 1}`,
        professionId: PROFESSIONS[s.length % PROFESSIONS.length].id,
        dreamSpace: dreams[s.length % dreams.length].index,
        isBot: true,
        botDifficulty: 'medium',
      },
    ])

  const randomize = (i: number) => {
    const p = PROFESSIONS[Math.floor(Math.random() * PROFESSIONS.length)]
    update(i, { professionId: p.id })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-7 text-center">
        <h1 className="text-4xl font-black tracking-tight">Freedom Run</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Вырвись из денежной рутины: нарасти пассивный доход выше расходов, потом мчись к мечте.
        </p>
      </header>

      <div className="panel mb-4 rounded-xl p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Колода сделок
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['offshore', 'Активы в Уругвае', 'квартиры, земля, фермы, мемкоины'],
              ['classic', 'Классическая', 'кондо, франшизы, акции'],
            ] as const
          ).map(([id, title, hint]) => (
            <button
              key={id}
              onClick={() => setTheme(id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                theme === id
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-[var(--line)] bg-[var(--panel-2)] hover:border-emerald-500/50'
              }`}
            >
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-[var(--muted)]">{hint}</div>
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
    </div>
  )
}
