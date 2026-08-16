import { fastBoard, RAT_BOARD } from '../engine/data'
import type { Seat, Table } from '../engine/types'

const RAT_STYLE: Record<string, { icon: string; color: string }> = {
  opportunity: { icon: '💼', color: '#10b981' },
  market: { icon: '📈', color: '#38bdf8' },
  doodad: { icon: '🛍️', color: '#fb7185' },
  charity: { icon: '❤️', color: '#f59e0b' },
  paycheck: { icon: '💵', color: '#a78bfa' },
  baby: { icon: '🐕', color: '#f472b6' },
  downsized: { icon: '📉', color: '#64748b' },
}

const FAST_STYLE: Record<string, { icon: string; color: string }> = {
  cashflowDay: { icon: '💰', color: '#a78bfa' },
  business: { icon: '🏢', color: '#10b981' },
  dream: { icon: '⭐', color: '#f472b6' },
  venture: { icon: '🛢️', color: '#f97316' },
  taxAudit: { icon: '🧾', color: '#64748b' },
  lawsuit: { icon: '⚖️', color: '#64748b' },
  divorce: { icon: '💔', color: '#64748b' },
  downsized: { icon: '📉', color: '#64748b' },
  charity: { icon: '❤️', color: '#f59e0b' },
}

function polar(index: number, total: number, radius: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  return {
    left: `${50 + Math.cos(angle) * radius}%`,
    top: `${50 + Math.sin(angle) * radius}%`,
  }
}

function Tokens({ seats }: { seats: Seat[] }) {
  if (!seats.length) return null
  return (
    <div className="pointer-events-none absolute -top-1.5 left-1/2 flex -translate-x-1/2 gap-0.5">
      {seats.map((s) => (
        <span
          key={s.id}
          className="size-2.5 rounded-full ring-2 ring-[var(--bg)]"
          style={{ background: s.color }}
        />
      ))}
    </div>
  )
}

export function Board({ table }: { table: Table }) {
  const active = table.seats[table.turnIndex]

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(460px,58vh)]">
      {/* Полоса свободы — внешний круг */}
      <div className="absolute inset-0 rounded-full border border-[var(--line)] bg-white/[0.015]" />
      {fastBoard().map((space, i) => {
        const st = FAST_STYLE[space.type]
        const here = table.seats.filter((s) => s.track === 'fast' && s.position === i && !s.outOfGame)
        const isDream = space.type === 'dream'
        const owned = table.ftOwnership[i]
        const dreamOf = table.seats.find((s) => s.dreamSpace === i && s.track === 'fast')
        return (
          <div
            key={`f${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={polar(i, fastBoard().length, 46)}
            title={'name' in space ? space.name : space.type}
          >
            <div
              className="relative grid size-[26px] place-items-center rounded-md text-[11px] transition"
              style={{
                background: owned ? '#1f2937' : `${st.color}22`,
                border: `1px solid ${owned ? '#374151' : st.color + '66'}`,
                opacity: owned ? 0.45 : 1,
                boxShadow: isDream && dreamOf ? `0 0 0 2px ${dreamOf.color}` : undefined,
              }}
            >
              {st.icon}
              <Tokens seats={here} />
            </div>
          </div>
        )
      })}

      {/* Круг — внутренний */}
      <div className="absolute inset-[22%] rounded-full border border-[var(--line)] bg-white/[0.02]" />
      {RAT_BOARD.map((space, i) => {
        const st = RAT_STYLE[space]
        const here = table.seats.filter((s) => s.track === 'rat' && s.position === i && !s.outOfGame)
        return (
          <div
            key={`r${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={polar(i, RAT_BOARD.length, 28)}
          >
            <div
              className="relative grid size-[26px] place-items-center rounded-md text-[11px]"
              style={{ background: `${st.color}22`, border: `1px solid ${st.color}66` }}
            >
              {st.icon}
              <Tokens seats={here} />
            </div>
          </div>
        )
      })}

      {/* Центр */}
      <div className="absolute inset-[34%] grid place-items-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {active.track === 'rat' ? 'Рутина' : 'Полоса свободы'}
          </div>
          <div className="mt-0.5 text-sm font-bold" style={{ color: active.color }}>
            {active.name}
          </div>
          {table.lastRoll && (
            <div className="tabnum mt-1 text-xl font-black">
              {table.lastRoll.join(' + ')}
              {table.lastRoll.length > 1 && (
                <span className="text-[var(--muted)]">
                  {' '}= {table.lastRoll.reduce((a, b) => a + b, 0)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
