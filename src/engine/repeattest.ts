/**
 * Замер повторов: за один проход колоды карта не должна приходить дважды.
 *
 * 🔴 Живая жалоба: «за проход колоды одна и та же приходит по три-четыре
 * раза». Корень был в том, что перекос к «своим» бумагам дёргал курсор общей
 * колоды с чужим размером и укорачивал порядок до нескольких позиций.
 */
import { createTable, applyTableEvent } from './table'
import { smallDeals, bigDeals } from './data'
import type { Table } from './types'

function стол(seed: number): Table {
  return createTable({
    seed,
    seats: [
      { id: 'a', name: 'А', professionId: 'engineer', color: '#f00', dreamSpace: 3 },
      { id: 'b', name: 'Б', professionId: 'doctor', color: '#0f0', dreamSpace: 7 },
    ],
    deckTheme: 'ru',
  } as never)
}

let плохо = 0
for (const размер of ['small', 'big'] as const) {
  const колода = размер === 'small' ? smallDeals('ru') : bigDeals('ru')
  for (const seed of [1, 7, 42, 1234, 99999]) {
    const t = стол(seed)
    // Тянем ровно один проход колоды и смотрим, сколько разных карт пришло.
    const виданы = new Set<string>()
    let повторов = 0
    for (let i = 0; i < колода.length; i++) {
      const d = t.decks[размер]
      const idx = d.order.length === колода.length ? d.order[d.next] : null
      if (idx == null) break
      d.next += 1
      if (виданы.has(колода[idx].id)) повторов += 1
      виданы.add(колода[idx].id)
    }
    if (повторов > 0) {
      плохо += 1
      console.log(`❌ ${размер} seed=${seed}: повторов за проход ${повторов}`)
    }
  }
}

/*
 * Главная проверка — живая: гоняем настоящую выдачу сделок и смотрим, сколько
 * РАЗНЫХ карт вообще успевает показаться. До правки из полусотни доставались
 * первые несколько.
 */
for (const размер of ['small', 'big'] as const) {
  const колода = размер === 'small' ? smallDeals('ru') : bigDeals('ru')
  const виданы = new Set<string>()
  for (const seed of [3, 11, 77, 555, 8080, 31337]) {
    let t = стол(seed)
    /*
     * 🔴 Деньги задираем НАРОЧНО. Проверка отвечает на вопрос «раскрывается ли
     * колода», а не «по карману ли карта»: со стартовыми 21–95 тысяч фильтр
     * «хватает ли денег» отбраковал бы почти всё, и замер показал бы поломку
     * там, где её нет. На это я уже один раз купился.
     */
    t.seats = t.seats.map((s2) => ({ ...s2, ledger: { ...s2.ledger, cash: 50_000_000 } }))
    for (let i = 0; i < 120; i++) {
      t = applyTableEvent(t, { type: '__FORCE_CHOOSE' } as never) ?? t
      t.pending = { kind: 'chooseDeal' }
      t.phase = 'resolving'
      const после = applyTableEvent(t, { type: 'CHOOSE_DEAL', size: размер } as never)
      if (после.pending?.kind === 'deal') виданы.add(после.pending.card.id)
      t = после
    }
  }
  const доля = Math.round((виданы.size / колода.length) * 100)
  console.log(`${размер}: показалось ${виданы.size} из ${колода.length} карт (${доля}%)`)
  if (доля < 70) {
    плохо += 1
    console.log(`❌ ${размер}: колода почти не раскрывается`)
  }
}

console.log(плохо === 0 ? '\n✅ ПОВТОРОВ НЕТ, КОЛОДА РАСКРЫВАЕТСЯ' : `\n❌ ПРОБЛЕМ: ${плохо}`)
