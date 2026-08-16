import { fastBoard, RAT_BOARD } from '../engine/data'
import type { Seat, Table } from '../engine/types'
import { artBoard } from './cardArt'
import { FAST_ICON, RAT_ICON } from './boardIcons'

/*
 * Цвета клеток. Взяты тёмными намеренно: значок наследует цвет клетки, и на
 * светлом полотне доски пастельная линия в 26 пикселей просто не видна.
 */
const RAT_STYLE: Record<string, { color: string; label: string }> = {
  opportunity: { color: '#047C54', label: 'Возможность' },
  market: { color: '#0369A1', label: 'Рынок' },
  doodad: { color: '#BE123C', label: 'Трата' },
  charity: { color: '#B45309', label: 'Благотворительность' },
  paycheck: { color: '#6D28D9', label: 'Зарплата' },
  baby: { color: '#A21CAF', label: 'Питомец' },
  downsized: { color: '#475569', label: 'Увольнение' },
}

const FAST_STYLE: Record<string, { color: string; label: string }> = {
  cashflowDay: { color: '#6D28D9', label: 'День дохода' },
  business: { color: '#047C54', label: 'Инвестиция' },
  dream: { color: '#BE185D', label: 'Мечта' },
  venture: { color: '#C2410C', label: 'Рисковый проект' },
  taxAudit: { color: '#475569', label: 'Налоговая проверка' },
  lawsuit: { color: '#475569', label: 'Иск' },
  divorce: { color: '#475569', label: 'Развод' },
  downsized: { color: '#475569', label: 'Сокращение' },
  charity: { color: '#B45309', label: 'Благотворительность' },
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

/**
 * Обе дорожки живут на одной геометрии — скруглённом прямоугольнике.
 * Раньше Рутина была окружностью, и рядом с прямоугольной Полосой это
 * читалось как ошибка вёрстки: по сторонам клетки подпирали внешний ряд,
 * а в углах проваливались внутрь.
 */
function ratPoint(index: number, total: number) {
  const inset = 24
  const size = 100 - inset * 2
  const pt = roundedRectPoint(index / total, size, size * 0.16)
  return { left: `${inset + pt.x}%`, top: `${inset + pt.y}%` }
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
  const surface = artBoard('surface')
  const center = artBoard('center')

  return (
    <div className="relative aspect-square h-full max-h-full w-auto max-w-full self-center">
      {/* Полотно доски — снимок настоящей поверхности, а не плоская заливка. */}
      <div className="absolute inset-0 overflow-hidden rounded-[13%] border border-[var(--line)] bg-[var(--panel-2)]">
        {surface && (
          <img
            src={surface}
            alt=""
            aria-hidden
            className="size-full object-cover opacity-95 dark:opacity-25"
          />
        )}
      </div>
      {board.map((space, i) => {
        const st = FAST_STYLE[space.type]
        const here = table.seats.filter((s) => s.track === 'fast' && s.position === i && !s.outOfGame)
        const owned = table.ftOwnership[i]
        const dreamOf = table.seats.find((s) => s.dreamSpace === i && !s.outOfGame)
        // Отступ = половина клетки: путь идёт по центрам, а не по краю.
        const pad = 2.6
        const raw = roundedRectPoint(i / board.length, 100 - pad * 2, (100 - pad * 2) * 0.15)
        const pt = { x: pad + raw.x, y: pad + raw.y }
        const name = 'name' in space ? (space as { name: string }).name : st.label
        return (
          <div
            key={`f${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
            title={`${st.label}${'name' in space ? ': ' + name : ''}`}
          >
            <div
              className="relative grid size-[26px] place-items-center rounded-[7px] bg-[var(--panel)] shadow-[0_1px_2px_rgb(24_30_28/0.10)]"
              style={{
                border: `1.5px solid ${st.color}${owned ? '33' : '55'}`,
                color: st.color,
                opacity: owned ? 0.35 : 1,
                boxShadow: dreamOf ? `0 0 0 2.5px ${dreamOf.color}` : undefined,
              }}
            >
              <span className="block size-[14px] [&>svg]:size-full">{FAST_ICON[space.type]}</span>
              <Tokens seats={here} />
            </div>
          </div>
        )
      })}

      {/* Рутина — внутреннее кольцо */}
      <div className="absolute inset-[22%] rounded-[16%] border border-[var(--line)] bg-[var(--panel)]" />
      {RAT_BOARD.map((space, i) => {
        const st = RAT_STYLE[space]
        const here = table.seats.filter((s) => s.track === 'rat' && s.position === i && !s.outOfGame)
        return (
          <div
            key={`r${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={ratPoint(i, RAT_BOARD.length)}
            title={st.label}
          >
            <div
              className="relative grid size-[26px] place-items-center rounded-[7px] bg-[var(--panel)] shadow-[0_1px_2px_rgb(24_30_28/0.10)]"
              style={{ border: `1.5px solid ${st.color}55`, color: st.color }}
            >
              <span className="block size-[14px] [&>svg]:size-full">{RAT_ICON[space]}</span>
              <Tokens seats={here} />
            </div>
          </div>
        )
      })}

      {/* Центр — плашка с гравировкой, поверх неё имя ходящего и кубики. */}
      <div className="absolute inset-[33%] grid place-items-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--panel)] text-center shadow-[0_1px_2px_rgb(24_30_28/0.06)]">
        {center && (
          <img
            src={center}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover opacity-90 dark:opacity-20"
          />
        )}
        <div className="relative px-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
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
