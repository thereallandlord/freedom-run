import { fastBoard, RAT_BOARD } from '../engine/data'
import type { Seat, Table } from '../engine/types'

const RAT_STYLE: Record<string, { icon: string; color: string; label: string }> = {
  opportunity: { icon: '💼', color: '#10b981', label: 'Возможность' },
  market: { icon: '📈', color: '#38bdf8', label: 'Рынок' },
  doodad: { icon: '🛍️', color: '#fb7185', label: 'Трата' },
  charity: { icon: '❤️', color: '#f59e0b', label: 'Благотворительность' },
  paycheck: { icon: '💵', color: '#a78bfa', label: 'Зарплата' },
  baby: { icon: '🐕', color: '#f472b6', label: 'Питомец' },
  downsized: { icon: '📉', color: '#64748b', label: 'Увольнение' },
}

const FAST_STYLE: Record<string, { icon: string; color: string; label: string }> = {
  cashflowDay: { icon: '💰', color: '#a78bfa', label: 'День дохода' },
  business: { icon: '🏢', color: '#10b981', label: 'Инвестиция' },
  dream: { icon: '⭐', color: '#f472b6', label: 'Мечта' },
  venture: { icon: '🛢️', color: '#f97316', label: 'Рисковый проект' },
  taxAudit: { icon: '🧾', color: '#64748b', label: 'Налоговая проверка' },
  lawsuit: { icon: '⚖️', color: '#64748b', label: 'Иск' },
  divorce: { icon: '💔', color: '#64748b', label: 'Развод' },
  downsized: { icon: '📉', color: '#64748b', label: 'Сокращение' },
  charity: { icon: '❤️', color: '#f59e0b', label: 'Благотворительность' },
}

/**
 * Точка на периметре скруглённого прямоугольника. Внешняя дорожка так читается
 * как настоящая доска, а не как второе кольцо (правка Анвара с созвона).
 */
function roundedRectPoint(tRaw: number, size: number, r: number) {
  const t = ((tRaw % 1) + 1) % 1
  const straight = size - 2 * r
  const arc = (Math.PI / 2) * r
  const total = 4 * straight + 4 * arc
  let d = t * total

  // Старт — середина верхней стороны, дальше по часовой стрелке.
  const halfTop = straight / 2
  if (d < halfTop) return { x: size / 2 + d, y: 0 }
  d -= halfTop
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2)
    return { x: size - r + r * Math.sin(a), y: r - r * Math.cos(a) }
  }
  d -= arc
  if (d < straight) return { x: size, y: r + d }
  d -= straight
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2)
    return { x: size - r + r * Math.cos(a), y: size - r + r * Math.sin(a) }
  }
  d -= arc
  if (d < straight) return { x: size - r - d, y: size }
  d -= straight
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2)
    return { x: r - r * Math.sin(a), y: size - r + r * Math.cos(a) }
  }
  d -= arc
  if (d < straight) return { x: 0, y: size - r - d }
  d -= straight
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2)
    return { x: r - r * Math.cos(a), y: r - r * Math.sin(a) }
  }
  d -= arc
  return { x: size / 2 - (halfTop - d), y: 0 }
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
  const board = fastBoard()

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(470px,58vh)]">
      {/* Полоса свободы — внешняя дорожка скруглённым прямоугольником */}
      <div className="absolute inset-0 rounded-[13%] border border-[var(--line)] bg-white/[0.015]" />
      {board.map((space, i) => {
        const st = FAST_STYLE[space.type]
        const here = table.seats.filter((s) => s.track === 'fast' && s.position === i && !s.outOfGame)
        const owned = table.ftOwnership[i]
        const dreamOf = table.seats.find((s) => s.dreamSpace === i && !s.outOfGame)
        const pt = roundedRectPoint(i / board.length, 100, 15)
        const name = 'name' in space ? (space as { name: string }).name : st.label
        return (
          <div
            key={`f${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
            title={`${st.label}${'name' in space ? ': ' + name : ''}`}
          >
            <div
              className="relative grid size-[24px] place-items-center rounded-md text-[11px]"
              style={{
                background: owned ? '#1f2937' : `${st.color}22`,
                border: `1px solid ${owned ? '#374151' : st.color + '66'}`,
                opacity: owned ? 0.4 : 1,
                boxShadow: dreamOf ? `0 0 0 2px ${dreamOf.color}` : undefined,
              }}
            >
              {st.icon}
              <Tokens seats={here} />
            </div>
          </div>
        )
      })}

      {/* Рутина — внутреннее кольцо */}
      <div className="absolute inset-[27%] rounded-full border border-[var(--line)] bg-white/[0.025]" />
      {RAT_BOARD.map((space, i) => {
        const st = RAT_STYLE[space]
        const here = table.seats.filter((s) => s.track === 'rat' && s.position === i && !s.outOfGame)
        return (
          <div
            key={`r${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={polar(i, RAT_BOARD.length, 31)}
            title={st.label}
          >
            <div
              className="relative grid size-[24px] place-items-center rounded-md text-[11px]"
              style={{ background: `${st.color}22`, border: `1px solid ${st.color}66` }}
            >
              {st.icon}
              <Tokens seats={here} />
            </div>
          </div>
        )
      })}

      {/* Центр */}
      <div className="absolute inset-[38%] grid place-items-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-center">
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
                  {' '}
                  = {table.lastRoll.reduce((a, b) => a + b, 0)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
