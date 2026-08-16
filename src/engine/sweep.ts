/** Подбор множителя доходности активов, чтобы длина RU-партии совпала с классикой. */
import { createTable, applyTableEvent, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme, smallDeals, bigDeals } from './data'
import { setRules } from './ledger'
import type { BotDifficulty } from './types'

const mixes: BotDifficulty[][] = [['easy','medium'],['medium','high'],['high','unreal'],['easy','medium','high','unreal']]

function play(seed: number, diff: BotDifficulty[], theme: 'classic'|'ru') {
  const dreams = dreamSpaces(); const pool = professionsFor(theme); const r0 = mulberry32(seed)
  const setup: TableSetup = { seed, deckTheme: theme, seats: diff.map((d,i)=>({
    name:`B${i}`, professionId: pool[Math.floor(r0()*pool.length)].id,
    dreamSpace: dreams[Math.floor(r0()*dreams.length)].index, isBot:true, botDifficulty:d })) }
  let t = createTable(setup); const rnd = mulberry32(seed ^ 0x5f356495)
  let ev=0, esc=0, stuck=0
  while (t.phase!=='finished' && !t.winnerId && ev<30000) {
    const b=t; const e=decideBotEvent(t,rnd); if(!e)break
    t=applyTableEvent(t,e); ev++
    if(!esc && t.seats.some(s=>s.track==='fast')) esc=t.turnCounter
    if(t===b){ if(++stuck>3){const f=applyTableEvent(t,{type:'END_TURN'}); if(f===t)break; t=f; stuck=0} } else stuck=0
  }
  return { turns:t.turnCounter, esc: esc||t.turnCounter, bankrupt: t.seats.filter(s=>s.outOfGame).length }
}

function measure(theme:'classic'|'ru'){
  const rs = Array.from({length:30},(_,i)=>play(1000+i*37, mixes[i%4], theme))
  const avg=(f:(r:typeof rs[0])=>number)=>Math.round(rs.reduce((s,r)=>s+f(r),0)/rs.length)
  return { turns:avg(r=>r.turns), esc:avg(r=>r.esc), bank:rs.reduce((s,r)=>s+r.bankrupt,0) }
}

setActiveTheme('classic'); setFastBoardTheme('classic')
setRules({ currency:'USD', fastTrackMultiplier:100, fastTrackTarget:150_000, loansEnabled:true, yieldScale:1 })
const ref = measure('classic')
console.log(`\nЭталон классики: ${ref.turns} ходов (Круг ${ref.esc}) · банкротов ${ref.bank}\n`)

setActiveTheme('ru'); setFastBoardTheme('ru')
const small = smallDeals('ru') as any[]; const big = bigDeals('ru') as any[]
const base = [...small, ...big].map((c)=>c.cashFlow)

for (const m of [1.0, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2]) {
  ;[...small, ...big].forEach((c,i)=>{
    if (c.category === 'partnership') return
    c.cashFlow = Math.round(base[i]*m/100)*100
  })
  setRules({ currency:'RUB', fastTrackMultiplier:50, fastTrackTarget:1_000_000, loansEnabled:false, yieldScale:0.3 })
  const r = measure('ru')
  const mark = Math.abs(r.turns-ref.turns) < 25 ? '  ← попадание' : ''
  console.log(`  ×${m.toFixed(2)}  всего ${String(r.turns).padStart(4)} · Круг ${String(r.esc).padStart(4)} · банкротов ${String(r.bank).padStart(2)}${mark}`)
}
