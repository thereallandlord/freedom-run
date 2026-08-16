/** Что именно покупает бот, чтобы вылететь из Круга — с цифрами. */
import { createTable, applyTableEvent, type TableSetup } from './table'
import { decideBotEvent } from './bots'
import { mulberry32 } from './rng'
import { dreamSpaces, professionsFor, setActiveTheme, setFastBoardTheme } from './data'
import { setRules, passiveIncome, totalExpenses } from './ledger'

type Theme = 'classic' | 'ru'
function trace(theme: Theme, seed: number) {
  setActiveTheme(theme); setFastBoardTheme(theme)
  setRules(theme === 'ru'
    ? { currency:'RUB', fastTrackMultiplier:50, fastTrackTarget:1_000_000, loansEnabled:false, yieldScale:0.3 }
    : { currency:'USD', fastTrackMultiplier:100, fastTrackTarget:150_000, loansEnabled:true, yieldScale:1 })
  const dreams = dreamSpaces(); const pool = professionsFor(theme); const r0 = mulberry32(seed)
  const setup: TableSetup = { seed, deckTheme: theme, seats: [0,1].map((i)=>({
    name:`B${i}`, professionId: pool[Math.floor(r0()*pool.length)].id,
    dreamSpace: dreams[Math.floor(r0()*dreams.length)].index, isBot:true, botDifficulty: i? 'high':'medium' as any })) }
  let t = createTable(setup)
  const p0 = t.seats[0].ledger
  console.log(`\n  ${p0.profession.name}: зарплата ${p0.salary.toLocaleString('ru')} · расходы ${totalExpenses(p0).toLocaleString('ru')} · поток +${(p0.salary-totalExpenses(p0)).toLocaleString('ru')} · старт ${p0.cash.toLocaleString('ru')}`)
  const rnd = mulberry32(seed ^ 0x5f356495); let ev=0, stuck=0
  const buys: string[] = []
  while (t.phase !== 'finished' && !t.seats.some(s=>s.track==='fast') && ev < 20000) {
    const before = t; const e = decideBotEvent(t, rnd); if (!e) break
    t = applyTableEvent(t, e); ev++
    if (t !== before) {
      const last = t.log[t.log.length-1]
      if (last && /Купил/.test(last.text) && last.seatId === t.seats[0].id) buys.push(`${t.turnCounter} ход: ${last.text}`)
      stuck = 0
    } else if (++stuck > 3) { const f = applyTableEvent(t,{type:'END_TURN'}); if (f===t) break; t=f; stuck=0 }
  }
  const l = t.seats.find(s=>s.track==='fast')?.ledger ?? t.seats[0].ledger
  console.log(`  вышел за ${t.turnCounter} ходов · пассив ${passiveIncome(l).toLocaleString('ru')} против расходов ${totalExpenses(l).toLocaleString('ru')}`)
  buys.slice(0,6).forEach(b=>console.log(`    · ${b}`))
}
console.log('=== КЛАССИКА ==='); [1000,1074].forEach(s=>trace('classic',s))
console.log('\n=== РОССИЯ ==='); [1000,1074].forEach(s=>trace('ru',s))

// ─── кто банкротится ───
{
  console.log('\n=== Банкроты по профессиям (RU, 60 ботов) ===')
  const { setRules: sr } = await import('./ledger')
  setActiveTheme('ru'); setFastBoardTheme('ru')
  sr({ currency:'RUB', fastTrackMultiplier:50, fastTrackTarget:1_000_000, loansEnabled:false, yieldScale:0.3 })
  const dreams = dreamSpaces(); const pool = professionsFor('ru')
  const mixes: any[][] = [['easy','medium'],['medium','high'],['high','unreal'],['easy','medium','high','unreal']]
  const dead: Record<string, number> = {}; const played: Record<string, number> = {}
  for (let i = 0; i < 30; i++) {
    const seed = 1000 + i * 37; const r0 = mulberry32(seed)
    const setup: TableSetup = { seed, deckTheme: 'ru', seats: mixes[i%4].map((d,k)=>({
      name:`B${k}`, professionId: pool[Math.floor(r0()*pool.length)].id,
      dreamSpace: dreams[Math.floor(r0()*dreams.length)].index, isBot:true, botDifficulty:d })) }
    let t = createTable(setup); const rnd = mulberry32(seed ^ 0x5f356495); let ev=0, stuck=0
    t.seats.forEach(s => { played[s.ledger.profession.name] = (played[s.ledger.profession.name]||0)+1 })
    while (t.phase!=='finished' && !t.winnerId && ev<30000) {
      const b=t; const e=decideBotEvent(t,rnd); if(!e)break
      t=applyTableEvent(t,e); ev++
      if(t===b){ if(++stuck>3){const f=applyTableEvent(t,{type:'END_TURN'}); if(f===t)break; t=f; stuck=0} } else stuck=0
    }
    t.seats.filter(s=>s.outOfGame).forEach(s => { dead[s.ledger.profession.name]=(dead[s.ledger.profession.name]||0)+1 })
  }
  Object.entries(dead).sort((a,b)=>b[1]-a[1]).forEach(([n,c])=>console.log(`  ${n.padEnd(22)} ${c} банкротств из ${played[n]||0} партий`))
}
