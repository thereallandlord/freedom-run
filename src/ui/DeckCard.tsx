/**
 * Колода как СТОПКА КАРТ — один компонент на посадочную и на экран настройки.
 *
 * Решения, принятые осознанно:
 *  · портретная пропорция 3:4 — у настоящей игральной карты она портретная,
 *    пейзажный кадр читается как фотография, а не как колода;
 *  · подпись лежит НА карте поверх тёмного скрима, а не под ней: так плитка
 *    выглядит рубашкой карты, а не «картинка плюс текст». Без скрима белая
 *    подпись на светлом небе нечитаема;
 *  · подложки сзади рисует CSS — иллюстрации отдельных карт есть только у
 *    российской колоды, из настоящих карт стопку для остальных не собрать;
 *  · выбранную колоду отмечает ГАЛОЧКА, а не только цвет: цвет один не должен
 *    нести смысл (дальтонизм, засветка экрана на солнце);
 *  · картинка отдельным портретным файлом под размер показа, а не обрезка
 *    широкой в CSS: иначе на первый экран уезжают лишние сотни килобайт.
 */
import { artByDeckCard } from './cardArt'
import type { DeckTheme } from '../engine/data'

export interface DeckInfo {
  id: DeckTheme
  name: string
  currency: string
  cards: number
  about: string
}

/**
 * Число карт посчитано по файлам колод, а не на глаз.
 * 🔴 Стояло 142 — цифра осталась от старой колоды и не менялась с тех пор,
 * как в неё добавили события бизнеса и мировые новости. Сейчас 257: малых 34,
 * крупных 45, рынка 121, трат 57.
 */
export const DECKS: DeckInfo[] = [
  {
    id: 'ru',
    name: 'Россия · халяль',
    currency: '₽',
    cards: 257,
    about: 'Наши зарплаты и объекты. Рассрочка и партнёрство вместо процентных кредитов.',
  },
]

/** Русское согласование: 1 карта · 2 карты · 5 карт. */
export function cardsWord(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 14) return 'карт'
  switch (n % 10) {
    case 1:
      return 'карта'
    case 2:
    case 3:
    case 4:
      return 'карты'
    default:
      return 'карт'
  }
}

export function DeckCard({ deck, selected }: { deck: DeckInfo; selected: boolean }) {
  const src = artByDeckCard(deck.id)
  return (
    <span className="relative block aspect-[3/4] w-full max-w-[188px]">
      {/* Две карты сзади — намёк на толщину колоды, без тяжёлых теней. */}
      <span
        aria-hidden
        className={`absolute inset-x-[8%] top-[4%] block h-full rounded-xl border border-line bg-panel2 transition-transform duration-200 ${
          selected ? 'rotate-[5deg]' : 'rotate-[3deg] group-hover:rotate-[5deg]'
        }`}
      />
      <span
        aria-hidden
        className={`absolute inset-x-[4%] top-[2%] block h-full rounded-xl border border-line bg-panel transition-transform duration-200 ${
          selected ? '-rotate-[3deg]' : '-rotate-[1.5deg] group-hover:-rotate-[3deg]'
        }`}
      />

      <span
        className={`absolute inset-0 block overflow-hidden rounded-xl border bg-panel2 shadow-card transition duration-200 group-hover:scale-[1.02] ${
          selected ? 'border-accent ring-2 ring-accent/25' : 'border-line'
        }`}
      >
        {src && (
          <img
            src={src}
            alt={`Колода «${deck.name}»`}
            loading="lazy"
            decoding="async"
            width={420}
            height={560}
            className="size-full object-cover"
          />
        )}

        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 block h-2/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
        />

        <span className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold leading-tight text-white">
              {deck.name}
            </span>
            <span className="tabnum mt-0.5 block text-[10.5px] font-semibold text-white/75">
              {deck.currency} · {deck.cards} {cardsWord(deck.cards)}
            </span>
          </span>
          {selected && (
            <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[13px]"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          )}
        </span>
      </span>
    </span>
  )
}
