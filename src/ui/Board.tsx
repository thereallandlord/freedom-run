import type { ReactNode } from 'react'
import { fastBoard, RAT_BOARD } from '../engine/data'
import type { Seat, Table } from '../engine/types'
import { FAST_ICON, RAT_ICON } from './boardIcons'
import { useBoardTheme } from './theme-board'

/**
 * Доска.
 *
 * Мир нарисован GPT Image, клетки кладёт КОД по кольцу сетки. Почему не
 * рисовать клетки картинкой: замер показал, что модель не держит счёт — на
 * четырёх городских досках по пять перерисовок ни разу не вышло ровно 24
 * клетки, выходило 20–23. Лишняя клетка = фишка мимо поля. Плюс нарисованные
 * клетки не растянуть под телефон.
 *
 * Клетка меньше своей ячейки и полупрозрачная — иначе нарисованный мир
 * закрыт плашками и всё это зря.
 *
 * 🔴 Доска НЕ обрезает содержимое: подсказка рисуется над клеткой и упиралась
 * бы в край. Скругление живёт на самой картинке.
 */

const RAT_LABEL: Record<string, string> = {
  opportunity: 'Возможность',
  market: 'Рынок',
  doodad: 'Трата',
  charity: 'Благотворительность',
  paycheck: 'Зарплата',
  baby: 'Питомец',
  downsized: 'Увольнение',
}

const FAST_LABEL: Record<string, string> = {
  cashflowDay: 'День дохода',
  business: 'Инвестиция',
  dream: 'Мечта',
  venture: 'Рисковый проект',
  taxAudit: 'Налоговая проверка',
  lawsuit: 'Иск',
  divorce: 'Развод',
  downsized: 'Сокращение',
  charity: 'Благотворительность',
}

/** Клетки по периметру сетки: верх слева направо, дальше по часовой. */
function perimeter(side: number): [number, number][] {
  const p: [number, number][] = []
  for (let c = 0; c < side; c++) p.push([0, c])
  for (let r = 1; r < side; r++) p.push([r, side - 1])
  for (let c = side - 2; c >= 0; c--) p.push([side - 1, c])
  for (let r = side - 2; r >= 1; r--) p.push([r, 0])
  return p
}

/** Сторона сетки под нужное число клеток: периметр = 4·side − 4. */
const sideFor = (count: number) => Math.round((count + 4) / 4)

function Tokens({ seats }: { seats: Seat[] }) {
  if (!seats.length) return null
  return (
    <span className="pointer-events-none absolute -top-1.5 left-1/2 z-20 flex -translate-x-1/2 gap-[3px]">
      {seats.map((s) => (
        <span
          key={s.id}
          className="block size-[10px] rounded-full ring-2 ring-white"
          style={{ background: s.color, boxShadow: '0 2px 5px rgb(0 0 0 / 0.32)' }}
        />
      ))}
    </span>
  )
}

function Cell({
  row,
  col,
  label,
  icon,
  seats,
  dim,
  ring,
}: {
  row: number
  col: number
  label: string
  icon: ReactNode
  seats: Seat[]
  dim?: boolean
  ring?: string
}) {
  return (
    <div
      className="group relative grid place-items-center self-center justify-self-center rounded-[18%] border transition duration-150 hover:z-10 hover:scale-[1.22]"
      style={{
        gridRow: row + 1,
        gridColumn: col + 1,
        width: '72%',
        height: '72%',
        background: 'var(--t-cell)',
        borderColor: ring ?? 'var(--t-cell-line)',
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
        color: 'var(--t-ink)',
        opacity: dim ? 0.4 : 1,
        backdropFilter: 'blur(2px)',
      }}
    >
      <span className="block size-[54%] opacity-90 [&>svg]:size-full">{icon}</span>
      <Tokens seats={seats} />

      {/* У верхнего ряда подпись уходит вниз — сверху её перекрыли бы фишки. */}
      <span
        className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#121815] px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 ${
          row === 0 ? 'top-[calc(100%+5px)]' : 'bottom-[calc(100%+5px)]'
        }`}
      >
        {label}
      </span>
    </div>
  )
}

export function Board({ table, children }: { table: Table; children?: ReactNode }) {
  const theme = useBoardTheme()
  /*
   * Показываем дорожку ТОГО, ЧЕЙ ХОД. Пока все в Рутине — на столе одно поле.
   * Кто-то вышел на Полосу свободы — на его ходу стол показывает Полосу,
   * на ходу остальных возвращается Рутина. Двух колец разом не бывает.
   */
  const showFast = table.seats[table.turnIndex]?.track === 'fast'
  const board = fastBoard()
  const count = showFast ? board.length : RAT_BOARD.length
  const side = sideFor(count)
  const cells = perimeter(side)

  return (
    <div className="board-fit relative rounded-2xl border border-[var(--t-line)] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.6)]">
      <img
        src={theme.board}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full rounded-2xl object-cover"
      />

      <div
        className="absolute inset-0 grid p-[1.5%]"
        style={{
          gridTemplateColumns: `repeat(${side}, 1fr)`,
          gridTemplateRows: `repeat(${side}, 1fr)`,
        }}
      >
        {showFast
          ? board.map((space, i) => {
              const [r, c] = cells[i] ?? [0, 0]
              const dreamOf = table.seats.find((s) => s.dreamSpace === i && !s.outOfGame)
              const name =
                'name' in space ? (space as { name: string }).name : FAST_LABEL[space.type]
              return (
                <Cell
                  key={`f${i}`}
                  row={r}
                  col={c}
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
              const [r, c] = cells[i] ?? [0, 0]
              return (
                <Cell
                  key={`r${i}`}
                  row={r}
                  col={c}
                  label={RAT_LABEL[space]}
                  icon={RAT_ICON[space]}
                  seats={table.seats.filter(
                    (s) => s.track === 'rat' && s.position === i && !s.outOfGame,
                  )}
                />
              )
            })}
      </div>

      {/* Центр: чей ход и кнопка действия — туда ближе всего тянуться. */}
      <div className="absolute inset-[24%] grid place-content-center justify-items-center gap-2 text-center">
        {children}
      </div>
    </div>
  )
}
