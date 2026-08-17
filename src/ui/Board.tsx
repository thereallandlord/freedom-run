import { fastBoard, RAT_BOARD } from '../engine/data'
import type { Seat, Table } from '../engine/types'
import { artBoard } from './cardArt'
import { FAST_ICON, RAT_ICON } from './boardIcons'
import cellData from '../data/board-cells.json'
import { useBoardSkin } from './boardSkin'

/**
 * Доска.
 *
 * Полотно ВМЕСТЕ С КЛЕТКАМИ рисует GPT Image — так решил Камиль. Клетки на нём
 * пиксели, а не элементы разметки, поэтому координаты берутся не «на глаз»:
 * scripts/calibrate-board.py находит нарисованные клетки на самой картинке и
 * пишет их центры в src/data/board-cells.json. Перерисовал полотно — прогнал
 * калибровку, разметка обновилась сама, руками ничего размечать не надо.
 *
 * Поверх картинки ложатся только значок, фишки и зона наведения. Поэтому у
 * нарисованной доски всё равно есть подсветка и подпись клетки: они живут в
 * наложенном слое, а не в пикселях.
 *
 * 🔴 На экране ОДНА дорожка за раз: пока все в Рутине, Полосы свободы не видно
 * вовсе — она появляется, когда кто-то из-за стола вышел.
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

interface Calib {
  image: string
  cellW: number
  cellH: number
  cells: { x: number; y: number }[]
}
const CALIB = cellData as unknown as Record<string, Calib | undefined>

/** Сайт живёт в подпапке — абсолютный путь к картинке улетел бы в корень. */
const BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? '/'

/** Ровная сетка по периметру — если калибровки для дорожки ещё нет. */
function fallbackCells(count: number): { x: number; y: number }[] {
  const side = Math.round((count + 4) / 4)
  const pts: { x: number; y: number }[] = []
  const at = (i: number) => (1 / side) * (i + 0.5)
  for (let c = 0; c < side; c++) pts.push({ x: at(c), y: at(0) })
  for (let r = 1; r < side; r++) pts.push({ x: at(side - 1), y: at(r) })
  for (let c = side - 2; c >= 0; c--) pts.push({ x: at(c), y: at(side - 1) })
  for (let r = side - 2; r >= 1; r--) pts.push({ x: at(0), y: at(r) })
  return pts.slice(0, count)
}

function Tokens({ seats }: { seats: Seat[] }) {
  if (!seats.length) return null
  return (
    <span className="pointer-events-none absolute -top-1 left-1/2 z-20 flex -translate-x-1/2 gap-[3px]">
      {seats.map((s) => (
        <span
          key={s.id}
          className="block size-[11px] rounded-full ring-[2.5px] ring-white"
          style={{ background: s.color, boxShadow: '0 2px 5px rgb(0 0 0 / 0.28)' }}
        />
      ))}
    </span>
  )
}

/** Клетка: значок, фишки и подпись при наведении — слоем поверх рисунка. */
function Cell({
  at,
  w,
  h,
  color,
  label,
  icon,
  seats,
  dim,
  ring,
}: {
  at: { x: number; y: number }
  w: number
  h: number
  color: string
  label: string
  icon: React.ReactNode
  seats: Seat[]
  dim?: boolean
  ring?: string
}) {
  return (
    <div
      className="group absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${at.x * 100}%`,
        top: `${at.y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
      }}
    >
      <div
        className="relative grid size-full place-items-center rounded-[16%] transition duration-150 group-hover:scale-[1.1]"
        style={{
          color,
          opacity: dim ? 0.32 : 1,
          boxShadow: ring ? `0 0 0 3px ${ring}` : undefined,
        }}
      >
        <span className="block size-[46%] [&>svg]:size-full">{icon}</span>
        <Tokens seats={seats} />
      </div>

      {/* Подпись только под курсором — иначе доска превратится в стену текста. */}
      <span className="pointer-events-none absolute bottom-[calc(100%+5px)] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#171A19] px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </div>
  )
}

export function Board({ table }: { table: Table }) {
  const active = table.seats[table.turnIndex]
  // Полоса свободы появляется, только когда на неё кто-то вышел.
  const showFast = table.seats.some((s) => s.track === 'fast' && !s.outOfGame)
  const board = fastBoard()

  // Поле выбирает игрок; координаты клеток у каждого поля свои.
  const skin = useBoardSkin()
  const calib = CALIB[skin.calib]
  const count = showFast ? board.length : RAT_BOARD.length
  const cells = calib && calib.cells.length === count ? calib.cells : fallbackCells(count)
  const cw = calib?.cellW ?? 0.114
  const ch = calib?.cellH ?? 0.117
  const plate = `${BASE}cards/${skin.file}`

  return (
    <div className="board-fit relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel-2)]">
      <img
        src={plate}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover"
      />

      {showFast
        ? board.map((space, i) => {
            const st = FAST_STYLE[space.type]
            const dreamOf = table.seats.find((s) => s.dreamSpace === i && !s.outOfGame)
            const name = 'name' in space ? (space as { name: string }).name : st.label
            return (
              <Cell
                key={`f${i}`}
                at={cells[i]}
                w={cw}
                h={ch}
                color={st.color}
                label={name}
                icon={FAST_ICON[space.type]}
                seats={table.seats.filter(
                  (s) => s.track === 'fast' && s.position === i && !s.outOfGame,
                )}
                dim={!!table.ftOwnership[i]}
                ring={dreamOf?.color}
              />
            )
          })
        : RAT_BOARD.map((space, i) => {
            const st = RAT_STYLE[space]
            return (
              <Cell
                key={`r${i}`}
                at={cells[i]}
                w={cw}
                h={ch}
                color={st.color}
                label={st.label}
                icon={RAT_ICON[space]}
                seats={table.seats.filter(
                  (s) => s.track === 'rat' && s.position === i && !s.outOfGame,
                )}
              />
            )
          })}

      {/* Центр — только чей сейчас ход. Больше там ничему быть не нужно. */}
      <div className="pointer-events-none absolute inset-[28%] grid place-items-center text-center">
        <div>
          {/* Название печатается интерфейсом, а не картинкой: модели нельзя
              доверять буквы — она их путает. */}
          {skin.brand && (
            <div
              className="font-display mb-2 text-2xl font-bold tracking-[-0.03em]"
              style={{ color: skin.dark ? '#EAF6EE' : '#0E5C3F' }}
            >
              GreenLeaf
            </div>
          )}
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: skin.dark ? 'rgba(234,246,238,0.72)' : 'var(--muted)' }}
          >
            {showFast ? 'Полоса свободы' : 'Ходит'}
          </div>
          <div
            className="font-display mt-1 text-lg font-bold leading-tight sm:text-xl"
            style={{ color: active.color }}
          >
            {active.name}
          </div>
        </div>
      </div>
    </div>
  )
}
