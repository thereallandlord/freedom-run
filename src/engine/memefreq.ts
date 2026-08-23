import { createTable, applyTableEvent } from './table'
import { smallDeals } from './data'
let мем=0, всего=0
for (let seed=1; seed<=400; seed++) {
  let t = createTable({ seed, seats:[
    {id:'a',name:'А',professionId:'engineer',color:'#f00',dreamSpace:3},
    {id:'b',name:'Б',professionId:'doctor',color:'#0f0',dreamSpace:7}],
    deckTheme:'ru' } as never)
  t.seats = t.seats.map((s)=>({...s, ledger:{...s.ledger, cash: 3_000_000}}))
  for (let i=0;i<12;i++){
    t.pending = { kind:'chooseDeal' } as never; t.phase='resolving'
    const п = applyTableEvent(t,{type:'CHOOSE_DEAL',size:'small'} as never)
    if (п.pending?.kind==='deal'){ всего++; if ((п.pending.card as any).meme) мем++ }
    t = п
  }
}
console.log(`мемкоинов ${мем} из ${всего} находок = ${(мем/всего*100).toFixed(1)}% (в колоде их 3 из ${smallDeals('ru').length} = ${(3/smallDeals('ru').length*100).toFixed(1)}%)`)
