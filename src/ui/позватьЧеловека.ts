/**
 * Позвать человека, которому напомнили о ходе: звук, мигающая вкладка и
 * уведомление браузера.
 *
 * 🔴 Всё это — чтобы дошло до того, кто переключился в другую вкладку: надпись
 * «ваш ход» на доске он не видит. Каждое действие в своём `try`: браузер может
 * запретить звук до первого нажатия или вовсе не уметь уведомлений — это не
 * повод ронять остальное.
 */
const ЗАГОЛОВОК = '⏰ Ваш ход!'
let мигалка: number | null = null
let прежний = ''

function гудок() {
  try {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const тон = (частота: number, начало: number, длина: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = частота
      g.gain.setValueAtTime(0.0001, ctx.currentTime + начало)
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + начало + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + начало + длина)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + начало)
      o.stop(ctx.currentTime + начало + длина + 0.05)
    }
    тон(880, 0, 0.14)
    тон(1175, 0.18, 0.2)
    window.setTimeout(() => void ctx.close(), 800)
  } catch (e) {
    console.error('[напомнить] звук не сыгран:', e)
  }
}

function перестатьМигать() {
  if (мигалка === null) return
  window.clearInterval(мигалка)
  мигалка = null
  document.title = прежний
}

function мигатьВкладкой() {
  if (мигалка !== null) return
  прежний = document.title
  let вкл = false
  мигалка = window.setInterval(() => {
    вкл = !вкл
    document.title = вкл ? ЗАГОЛОВОК : прежний
  }, 900)
  const вернулся = () => {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    перестатьМигать()
    window.removeEventListener('focus', вернулся)
    document.removeEventListener('visibilitychange', вернулся)
  }
  window.addEventListener('focus', вернулся)
  document.addEventListener('visibilitychange', вернулся)
  // Вечно не мигаем: через минуту ход всё равно закроют часы хода.
  window.setTimeout(перестатьМигать, 60_000)
}

function уведомить(от: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return
    const n = new Notification('⏰ Ваш ход', { body: `${от} напоминает: за столом ждут вас`, tag: 'freedom-run-remind' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch (e) {
    console.error('[напомнить] уведомление не показано:', e)
  }
}

export function позватьЧеловека(от: string) {
  гудок()
  // Мигаем, только если человек не смотрит на игру: иначе хватит строки на доске.
  if (document.hidden || !document.hasFocus()) мигатьВкладкой()
  уведомить(от)
}

/**
 * Разрешение на уведомления спрашиваем один раз и только по нажатию человека —
 * без нажатия браузер вопрос просто не покажет.
 */
export function спроситьУведомленияОдинРаз() {
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
  } catch {
    /* браузер без уведомлений — звук и вкладка всё равно сработают */
  }
}
