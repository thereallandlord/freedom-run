/**
 * «Напомнить» — позвать человека, чей ход, если он отвлёкся.
 *
 * 🔴 ОТДЕЛЬНЫЙ КАНАЛ, МИМО ЖУРНАЛА ХОДОВ. Игровой канал `fr:<код>` — это
 * журнал: всё, что туда уходит, становится событием партии и попадает в её
 * пересборку. Напоминание — не событие партии, а оклик между людьми, поэтому
 * живёт на своём канале, ровно как голос.
 *
 * 🔴 Решение Камиля 11.09: называется «Напомнить», а не «пнуть»; зовём внутри
 * игры — звуком, мигающей вкладкой и уведомлением браузера, без входа и ботов.
 */
import { getSupabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface Напоминания {
  напомнить(кому: string, от: string): void
  снять(): void
}

export function завестиНапоминания(
  комната: string,
  моёМесто: string,
  наНапоминание: (от: string) => void,
): Напоминания | null {
  const sb = getSupabase()
  if (!sb) return null
  const имя = `remind:${комната}`
  /*
   * 🔴 Второй канал с тем же именем Supabase не поднимает — подписка висит
   * молча. В разработке React монтирует всё дважды, и голос на этом уже
   * обжёгся. Прежний канал с тем же именем снимаем до создания нового.
   */
  for (const c of sb.getChannels()) {
    if (c.topic === `realtime:${имя}` || c.topic === имя) void sb.removeChannel(c)
  }
  const канал: RealtimeChannel = sb.channel(имя, { config: { broadcast: { self: false } } })
  канал.on('broadcast', { event: 'remind' }, (m) => {
    const p = m.payload as { кому?: string; от?: string } | undefined
    if (p?.кому === моёМесто) наНапоминание(p.от || 'Игрок')
  })
  канал.subscribe()
  return {
    напомнить(кому, от) {
      void канал.send({ type: 'broadcast', event: 'remind', payload: { кому, от } })
    },
    снять() {
      void sb.removeChannel(канал)
    },
  }
}
