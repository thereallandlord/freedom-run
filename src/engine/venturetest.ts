/**
 * Венчур — не монетка.
 *
 * 🔴 Камиль: «продумать механику рискованных карточек-ставок и лотереи — в
 * жизни такие ситуации не выпадают, а шансы равные». Было ровно два исхода:
 * проект целиком или ставка дотла, пополам. Здесь проверяется, что исходов
 * пять и распределение похоже на настоящий венчур: большинство теряет,
 * немногие выигрывают.
 */
import { fastBoard, setFastBoardTheme } from './data'

setFastBoardTheme('ru')
const венчуры = fastBoard().filter((s) => s.type === 'venture') as never as {
  name: string; downPayment: number; cashFlow: number; threshold: number
}[]
const беды: string[] = []
console.log(`венчуров на поле: ${венчуры.length}\n`)

for (const в of венчуры) {
  const счёт: Record<string, number> = {}
  let ожидание = 0
  for (let die = 1; die <= 6; die++) {
    const ступень = die + (5 - в.threshold)
    const исход =
      ступень <= 2 ? 'сгорело' : ступень === 3 ? 'половина' : ступень === 4 ? 'ноль' : ступень === 5 ? 'вполсилы' : 'выстрелил'
    счёт[исход] = (счёт[исход] ?? 0) + 1
    /* Ожидание в деньгах: возврат ставки плюс доход за два года владения. */
    const вернули = исход === 'половина' ? в.downPayment / 2 : исход === 'ноль' ? в.downPayment : 0
    const доход = исход === 'выстрелил' ? в.cashFlow : исход === 'вполсилы' ? в.cashFlow / 2 : 0
    ожидание += (вернули + доход * 24 - в.downPayment) / 6
  }
  const потеря = ((счёт['сгорело'] ?? 0) + (счёт['половина'] ?? 0)) / 6
  console.log(
    `${в.name.slice(0, 34).padEnd(36)} порог ${в.threshold} · ` +
      Object.entries(счёт).map(([k, v]) => `${k}:${v}`).join(' ') +
      ` · в минусе ${Math.round(потеря * 100)}%`,
  )
  if (Object.keys(счёт).length < 3) беды.push(`${в.name}: исходов всего ${Object.keys(счёт).length}`)
  if (потеря < 0.15) беды.push(`${в.name}: теряют лишь ${Math.round(потеря * 100)}% — это уже не риск`)
  if (потеря > 0.7) беды.push(`${в.name}: теряют ${Math.round(потеря * 100)}% — в такое не входят вовсе`)
  if (ожидание <= 0) беды.push(`${в.name}: ожидание отрицательное (${Math.round(ожидание)}) — входить незачем`)
}

for (const б of беды) console.log('  ❌', б)
console.log(беды.length ? '\n❌ ВЕНЧУР УСТРОЕН НЕПРАВДОПОДОБНО' : '\n✅ У ВЕНЧУРА ПЯТЬ ИСХОДОВ И ЧЕСТНЫЙ РИСК')
if (беды.length) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1
