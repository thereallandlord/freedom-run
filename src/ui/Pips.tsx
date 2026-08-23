/**
 * Грань кубика точками — не эмодзи и не цифра.
 * 🔴 Кубик должен читаться как кубик: сначала крутится, потом замирает на
 * выпавшем. Раньше по нажатию мгновенно открывалась карточка, и человек не
 * понимал, сколько выпало и почему он оказался на этой клетке.
 */
export function Pips({ n, spinning }: { n: number; spinning?: boolean }) {
  const layout: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  }
  const dots = layout[n] ?? []
  return (
    <span
      className={`grid size-11 grid-cols-3 grid-rows-3 place-items-center rounded-xl border p-1.5 ${
        spinning ? 'dice-spin' : ''
      }`}
      style={{ borderColor: 'var(--t-line, var(--line))', background: 'var(--t-panel-2, var(--panel))' }}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const r = Math.floor(i / 3)
        const c = i % 3
        const on = dots.some(([dr, dc]) => dr === r && dc === c)
        return (
          <span
            key={i}
            className={`block size-[6px] rounded-full ${on ? '' : 'opacity-0'}`}
            style={{ background: 'var(--t-ink, currentColor)' }}
          />
        )
      })}
    </span>
  )
}
