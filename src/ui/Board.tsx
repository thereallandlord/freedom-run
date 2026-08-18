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

/**
 * Цвет клетки по её роли. Одинаково серые плашки не читались: чтобы понять,
 * куда ты попал, приходилось наводить мышь. Теперь видно с одного взгляда.
 * Цвета мягкие — доска под ними нарисована, забивать её нельзя.
 */
const RAT_TINT: Record<string, string> = {
  opportunity: '#2f7d5b', // сделки — фирменный зелёный
  market: '#2563a8', // рынок — синий
  doodad: '#b4713a', // траты — охра
  charity: '#7d5bb0', // благотворительность — лиловый
  paycheck: '#1f8a4c', // зарплата — насыщенный зелёный
  baby: '#c2833c', // питомец — тёплый песочный
  downsized: '#b03a4a', // увольнение — красный
}

const FAST_TINT: Record<string, string> = {
  cashflowDay: '#1f8a4c',
  business: '#2f7d5b',
  dream: '#c98a2b',
  venture: '#2563a8',
  taxAudit: '#b03a4a',
  lawsuit: '#b03a4a',
  divorce: '#b03a4a',
  downsized: '#b03a4a',
  charity: '#7d5bb0',
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

/**
 * Фишки игроков.
 *
 * 🔴 Крупные и с именем: раньше это были точки по десять пикселей, и на доске
 * их приходилось искать. Доска нужна, чтобы видеть, кто где стоит, —
 * иначе она просто картинка.
 *
 * Переход между клетками анимируется в CSS: фишка едет, а не телепортируется.
 */
function Tokens({ seats, active }: { seats: Seat[]; active?: string }) {
  if (!seats.length) return null
  return (
    <span className="pointer-events-none absolute -top-2.5 left-1/2 z-20 flex -translate-x-1/2 gap-[3px]">
      {seats.map((s) => (
        <span
          key={s.id}
          className={`block rounded-full ring-[2.5px] ring-white transition-transform duration-200 ${
            s.id === active ? 'size-[19px] scale-110' : 'size-[15px]'
          }`}
          style={{
            background: s.color,
            boxShadow: s.id === active ? `0 0 0 3px ${s.color}55, 0 3px 8px rgb(0 0 0 / 0.4)` : '0 2px 6px rgb(0 0 0 / 0.35)',
          }}
          title={s.name}
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
  active,
  tint,
}: {
  row: number
  col: number
  label: string
  icon: ReactNode
  seats: Seat[]
  dim?: boolean
  ring?: string
  active?: string
  /** Цвет по роли клетки — чтобы поле читалось без наведения. */
  tint?: string
}) {
  return (
    <div
      className="group relative grid place-items-center self-center justify-self-center rounded-[18%] border transition duration-150 hover:z-10 hover:scale-[1.22]"
      style={{
        gridRow: row + 1,
        gridColumn: col + 1,
        width: '72%',
        height: '72%',
        background: tint
          ? `color-mix(in srgb, ${tint} 34%, var(--t-cell))`
          : 'var(--t-cell)',
        borderColor: ring ?? (tint ? `color-mix(in srgb, ${tint} 60%, transparent)` : 'var(--t-cell-line)'),
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
        color: 'var(--t-ink)',
        opacity: dim ? 0.4 : 1,
        backdropFilter: 'blur(2px)',
      }}
    >
      <span className="block size-[54%] opacity-90 [&>svg]:size-full">{icon}</span>
      <Tokens seats={seats} active={active} />

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
                  tint={FAST_TINT[space.type]}
                  seats={table.seats.filter(
                    (s) => s.track === 'fast' && s.position === i && !s.outOfGame,
                  )}
                  active={table.seats[table.turnIndex]?.id}
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
                  tint={RAT_TINT[space]}
                  seats={table.seats.filter(
                    (s) => s.track === 'rat' && s.position === i && !s.outOfGame,
                  )}
                  active={table.seats[table.turnIndex]?.id}
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
