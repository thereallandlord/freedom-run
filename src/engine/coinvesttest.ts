/**
 * Дорогая половина колоды проходима только вдвоём — проверяем, что это правда.
 *
 * 🔴 ЗАЧЕМ. Замер 06.09: из 80 покупаемых карточек боты в одиночку берут 31, а
 * 49 не берут НИ РАЗУ. Причина не в цене и не в доходности — в первом взносе:
 * медиана пика наличных за партию 1,4 млн, до 2,5 млн дорастают 6%, а взнос за
 * двушку у Кремля — 2,8 млн. Единственный путь к таким объектам — сложиться
 * с соседом. Механика в движке есть (OFFER_COINVEST → ACCEPT_OFFER), но её не
 * покрывал ни один тест, то есть половина колоды держалась на непроверенном
 * коде.
 */
import { createTable, applyTableEvent, dealCardAt } from './table'
import { passiveIncome, dealTerms } from './ledger'
import type { Table } from './types'

const беды: string[] = []
const п = (что: string, ок: boolean, факт = '') => {
  if (!ок) беды.push(`${что}${факт ? ` — ${факт}` : ''}`)
}

function стол(): Table {
  return createTable({
    seed: 5,
    deckTheme: 'ru',
    seats: [
      { id: 'a', name: 'Ведущий', professionId: 'engineer', dreamSpace: 2 },
      { id: 'b', name: 'Сосед', professionId: 'doctor', dreamSpace: 13 },
    ],
  } as never)
}

let t = стол()
// Кладём на стол самую дорогую из «мёртвых» — двушку у Кремля.
const карта = [...Array(200).keys()]
  .map((i) => {
    try {
      return dealCardAt(t, 'big', i)
    } catch {
      return null
    }
  })
  .find((c) => c?.id === 'big-re-kzn-center')
п('двушка у Кремля есть в крупной колоде', !!карта)

if (карта && карта.kind !== 'stock') {
  const взнос = карта.downPayment
  t = {
    ...t,
    turnIndex: 0,
    pending: { kind: 'deal', deck: 'big', card: карта },
    seats: t.seats.map((s, i) => ({
      ...s,
      // У каждого чуть больше половины взноса — в одиночку не тянет никто.
      ledger: { ...s.ledger, cash: Math.round(взнос * 0.6) + i },
    })),
  } as Table

  const каждыйМало = t.seats.every((s) => s.ledger.cash < взнос)
  п('в одиночку взнос не тянет ни один из двоих', каждыйМало)

  const половина = Math.round(взнос * 0.5)
  const до = t.seats.map((s) => s.ledger.cash)
  let после: Table = applyTableEvent(t, {
    type: 'OFFER_COINVEST',
    toId: 'b',
    amount: половина,
    share: 0.5,
  } as never)
  п('предложение сложиться ушло соседу', после.offers.length === 1, `предложений ${после.offers.length}`)

  const оф = после.offers[0]
  if (оф) {
    после = applyTableEvent(после, { type: 'ACCEPT_OFFER_TRADE', offerId: оф.id, seatId: 'b', by: 'b' } as never)
    const ведущий = после.seats.find((s) => s.id === 'a')!
    const сосед = после.seats.find((s) => s.id === 'b')!
    const уВедущего = ведущий.ledger.realEstate.find((a) => a.id.startsWith('big-re-kzn-center'))
    const уСоседа = сосед.ledger.realEstate.find((a) => a.id.startsWith('big-re-kzn-center'))
    п('объект появился у ведущего', !!уВедущего)
    п('доля появилась и у соседа', !!уСоседа)
    п(
      'каждый заплатил свою половину',
      Math.abs(до[0] - ведущий.ledger.cash - половина) <= 2 && Math.abs(до[1] - сосед.ledger.cash - половина) <= 2,
      `ведущий отдал ${до[0] - ведущий.ledger.cash}, сосед ${до[1] - сосед.ledger.cash}`,
    )
    /*
     * 🔴 Считаем НАСТОЯЩИЙ доход, а не поле cashFlow: доля соинвестора вычитается
     * не из карточки актива, а в момент подсчёта (ownShare). Первая версия этой
     * проверки читала сырое поле, видела у ведущего полные 51 000 при 25 500
     * у соседа и делала вывод, что складчина выгоднее покупки. Это была ошибка
     * замера, а не движка.
     */
    const доходВедущего = passiveIncome(ведущий.ledger)
    const доходСоседа = passiveIncome(сосед.ledger)
    const общий = доходВедущего + доходСоседа
    const врассрочку = dealTerms(карта as never, 'realEstate').instFlow
    п(
      'складчина не выгоднее обычной покупки в рассрочку',
      общий <= врассрочку + 1,
      `вдвоём ${общий}, в одиночку в рассрочку ${врассрочку}`,
    )
    п('доход разошёлся поровну', Math.abs(доходВедущего - доходСоседа) <= 1,
      `ведущий ${доходВедущего}, сосед ${доходСоседа}`)
    п('доход положительный у обоих', доходВедущего > 0 && доходСоседа > 0)
    console.log(
      `  вдвоём куплена «${карта.title}»: взнос ${взнос.toLocaleString('ru')} ₽ пополам, ` +
        `на руки по ${доходВедущего.toLocaleString('ru')} ₽/мес каждому (в одиночку в рассрочку было бы ${врассрочку.toLocaleString('ru')} ₽)`,
    )
  }
}

console.log(беды.length ? '\n❌ СКЛАДЧИНА:\n  ' + беды.join('\n  ') : '\n✅ СКЛАДЧИНА: дорогой объект берётся вдвоём, деньги и доли сходятся')
if (беды.length) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1)
