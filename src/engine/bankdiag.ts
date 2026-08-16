/** Что именно загоняет игрока в банкротство — последние события перед крахом. */
import { createTable, applyTableEvent, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme } from './data'
import { setRules, monthlyCashFlow, totalExpenses, passiveIncome } from './ledger'

setActiveTheme('ru'); setFastBoardTheme('ru')
setRules({ currency:'RUB', fastTrackMultiplier:50, fastTrackTarget:1_000_000, loansEnabled:false, yieldScale:0.3 })
const dreams = dreamSpaces(); const pool = professionsFor('ru')
const mixes: any[][] = [['easy','medium'],['medium','high'],['high','unreal'],['easy','medium','high','unreal']]
let shown = 0
for (let i = 0; i < 30 && shown < 3; i++) {
  const seed = 1000 + i*37; const r0 = mulberry32(seed)
  const setup: TableSetup = { seed, deckTheme:'ru', seats: mixes[i%4].map((d,k)=>({
    name:`B${k}`, professionId: pool[Math.floor(r0()*pool.length)].id,
    dreamSpace: dreams[Math.floor(r0()*dreams.length)].index, isBot:true, botDifficulty:d })) }
  let t = createTable(setup); const rnd = mulberry32(seed ^ 0x5f356495); let ev=0, stuck=0
  let reported = new Set<string>()
  while (t.phase!=='finished' && !t.winnerId && ev<30000) {
    const b=t; const e=decideBotEvent(t,rnd); if(!e)break
    t=applyTableEvent(t,e); ev++
    if (t.pending?.kind === 'bankruptcy' && shown < 3) {
      const s = t.seats[t.turnIndex]
      if (!reported.has(s.id)) {
        reported.add(s.id); shown++
        const l = s.ledger
        console.log(`\n▸ ${l.profession.name} (${s.botDifficulty}), ход ${t.turnCounter}`)
        console.log(`  наличные ${Math.round(l.cash).toLocaleString('ru')} · поток ${Math.round(monthlyCashFlow(l)).toLocaleString('ru')} · расходы ${Math.round(totalExpenses(l)).toLocaleString('ru')} · пассив ${Math.round(passiveIncome(l)).toLocaleString('ru')}`)
        console.log(`  займ ${Math.round(l.liabilities.bankLoan).toLocaleString('ru')} (платёж ${Math.round(l.expenses.bankLoanPayment).toLocaleString('ru')}) · рассрочка ${Math.round(l.expenses.retailPayment).toLocaleString('ru')} · активов ${l.realEstate.length + l.businesses.length}`)
        l.realEstate.concat(l.businesses as any).forEach((a:any)=>console.log(`    ${a.name}: ${a.cashFlow>0?'+':''}${Math.round(a.cashFlow).toLocaleString('ru')}/мес`))
        console.log('  последние события:')
        t.log.filter(x=>x.seatId===s.id).slice(-6).forEach(x=>console.log(`    · ${x.text}`))
      }
    }
    if(t===b){ if(++stuck>3){const f=applyTableEvent(t,{type:'END_TURN'}); if(f===t)break; t=f; stuck=0} } else stuck=0
  }
}
