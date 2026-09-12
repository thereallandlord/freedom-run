/**
 * Сетевая партия: хозяин и гость сидят за ОДНИМ И ТЕМ ЖЕ столом (12.09).
 *
 * 🔴 Живой прогон на сайте: у хозяина за столом трое (он, гость, «Бот Алмаз»),
 * у гостя четверо — плюс «Бот Динара». Гость, входя, получает снимок комнаты и
 * проигрывает поверх него весь журнал: бот, добавленный до снимка, приезжал
 * второй раз под следующим свободным именем. А стол после каждого хода
 * пересобирался у каждого по СВОЕЙ копии комнаты — партии разошлись с первого
 * хода: хозяин ждал гостя, гость смотрел, как ходит хозяин.
 */
import {
  ROOM_COLOR_VALUES,
  applyRoomAction,
  createRoom,
  toTableSetup,
  партияИзЖурнала,
  type RoomAction,
  type RoomState,
} from './room'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

const хозяин = { id: 'h', name: 'Хозяин', color: ROOM_COLOR_VALUES[0], professionId: 'teacher', dreamSpace: 2 }
const гость = { id: 'g', name: 'Гость', color: ROOM_COLOR_VALUES[1], professionId: 'engineer', dreamSpace: 13 }
const журнал: RoomAction[] = [
  { type: 'JOIN_PLAYER', draft: гость },
  { type: 'ADD_BOT', id: 'b1', professionId: 'doctor', dreamSpace: 24 },
]
const прогнать = (от: RoomState, действия: RoomAction[]) => действия.reduce((r, a) => applyRoomAction(r, a), от)
const имена = (r: RoomState) => r.players.map((p) => p.name).join(', ')
const уХозяина = прогнать(createRoom({ host: хозяин }), журнал)

// 1. Снимок хозяина и весь журнал поверх него — за столом те же трое.
{
  const уГостя = прогнать(уХозяина, журнал)
  п('после снимка и журнала за столом те же трое', уГостя.players.length === 3 && имена(уГостя) === имена(уХозяина), `у гостя: ${имена(уГостя)}; у хозяина: ${имена(уХозяина)}`)
  п('стол гостя совпадает с хозяйским', JSON.stringify(toTableSetup(уГостя)) === JSON.stringify(toTableSetup(уХозяина)))
}

// 2. Тот же бот вторым разом — не второй бот.
{
  const дважды = прогнать(уХозяина, [журнал[1]])
  п('повтор «добавить бота» с тем же ключом ничего не меняет', дважды.players.length === 3, имена(дважды))
}

// 3. Стол — по составу из «__START», даже если своя копия комнаты разошлась.
{
  const setup = toTableSetup(уХозяина)
  const бросок = { type: 'ROLL', seatId: 'h', by: 'h', dice: [3] }
  const разошлась = прогнать(уХозяина, [{ type: 'ADD_BOT', id: 'b2', professionId: 'teacher', dreamSpace: 2 }])
  const партия = партияИзЖурнала([{ type: '__START', setup }, бросок], разошлась)
  п('состав из «__START», а не из своей копии комнаты', партия?.setup.seats.map((s) => s.id).join() === 'h,g,b1', партия?.setup.seats.map((s) => s.name).join(', '))
  п('ходы — всё после «__START»', партия?.ходы.length === 1 && партия?.ходы[0] === бросок)
}

// 4. Человек вышел и оставил бота за себя — его место ходит само.
{
  const setup = toTableSetup(уХозяина)
  const ушёл = прогнать(уХозяина, [{ type: 'LEAVE_AS_BOT', id: 'g' }])
  const партия = партияИзЖурнала([{ type: '__START', setup }], ушёл)
  п('место вышедшего — за ботом', партия?.setup.seats.find((s) => s.id === 'g')?.isBot === true)
  п('хозяин остался человеком', !партия?.setup.seats.find((s) => s.id === 'h')?.isBot)
}

// 5. В журнале две партии — собираем последнюю.
{
  const setup = toTableSetup(уХозяина)
  const старый = { type: 'ROLL', seatId: 'g', by: 'g', dice: [5] }
  const партия = партияИзЖурнала([{ type: '__START', setup }, старый, { type: '__START', setup }], уХозяина)
  п('ходы прошлой партии не попадают в новую', партия?.ходы.length === 0, String(партия?.ходы.length))
}

// 6. Записи «__START» нет — стол по комнате, как раньше.
{
  const бросок = { type: 'ROLL', seatId: 'h', by: 'h', dice: [2] }
  const партия = партияИзЖурнала([бросок], уХозяина)
  п('без «__START» стол по комнате', партия?.setup.seats.length === 3 && партия?.ходы.length === 1)
  п('без «__START» и без комнаты собирать не из чего', партияИзЖурнала([бросок], null) === null)
}

console.log(
  беды.length
    ? '\n❌ СЕТЕВАЯ КОМНАТА:\n  ' + беды.join('\n  ')
    : '\n✅ СЕТЕВАЯ КОМНАТА: бот не задваивается, стол у всех по составу из старта партии',
)
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
