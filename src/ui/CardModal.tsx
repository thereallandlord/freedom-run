import { createContext, useContext, useState } from 'react'
import type { Seat, StockCard, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import {
  charityCost,
  dreamPriceAt,
  ftCharityCost,
  marketMatches,
  pendingUndecided,
  sellOfferPrice,
  sellOfferQuote,
  ценаТерпения,
  stockHolders,
  canRecover,
  hasConsumerDebt,
  hasSellableAssets,
} from '../engine/table'
import {
  RULES,
  monthlyCashFlow,
  totalExpenses,
  installmentPrice,
  installmentMonthly,
  marketStockPrice,
  dealTerms,
  marketDealFlow,
  MANAGER_PCT,
} from '../engine/ledger'
import { fastBoard, cardText, fastSpaceText, smallDeals, bigDeals } from '../engine/data'
import { loanOutstanding, loanOwed, fairCardPrice, PRICE_CEIL, PRICE_FLOOR } from '../engine/trades'
import { money, signed, tone } from './PlayerPanel'
import { надбавкаИностранца } from '../engine/ledger'
import { Pips } from './Pips'
import { вКругах } from './срок'
import {
  GL_PACKAGES,
  GL_PROMOS,
  glPromoReady,
  glInitialState,
  glStructureIncome,
  glTotalIncome,
  glUpgradeCost,
  glUpgradeOptions,
} from '../engine/greenleaf'
import { RIBA, ribaLimit } from '../engine/ledger'
import { HalalNote } from './HalalNote'
import { DealTradeActions } from './DealTradeActions'
import { AccessPicker } from './AccessPicker'
import { artByDream, artById, artBySpace, artByTicker } from './cardArt'
import { debtsOf, seatOf } from './tradeHelpers'

/** Картинка карточки: иконка по типу актива поверх фирменного градиента. */
const CARD_ART: Record<string, string> = {
  roomUFA: '🏚️', aptKZN: '🏢', aptMSK: '🌆', aptSPB: '🌉', aptDXB: '🕌', aptTUR: '🏖️',
  parking: '🅿️', land: '🌾', houseRF: '🏡',
  bizFood: '🍽️', bizService: '🔧', bizDigital: '💻', partnership: '🤝',
  condo2br: '🏢', fourplex: '🏘️', eightplex: '🏘️', duplex: '🏘️', aptSmall: '🏢', aptLarge: '🏢',
  franchise: '🍔', localBiz: '🏪', dairyUY: '🐄', villaPDE: '🏝️', landUY: '🌾', aptMVD: '🏢', aptPDE: '🌊',
}

function CardArt({ icon, accent, photo }: { icon: string; accent: string; photo?: string | null }) {
  /*
   * Картинка есть почти у каждой карточки, но не у всех — служебные клетки и
   * новые карты могут быть ещё не нарисованы. Поэтому эмодзи не выкидываем:
   * это честный запасной вариант, а не заглушка «загружается».
   */
  const [загрузилась, setЗагрузилась] = useState(false)
  /*
   * 🔴 ПОКА КАРТИНКА ЛЕТИТ, НА ЕЁ МЕСТЕ БЫЛО БЕЛОЕ ПЯТНО.
   *
   * Карточка открывается мгновенно, а рисунок приезжает отдельным запросом —
   * и первые доли секунды (на телефоне заметно дольше) верхняя треть карточки
   * стояла пустой. Со стороны это читается как «у карточки нет картинки»:
   * именно так это и выглядело на приёмке. Теперь под картинкой лежит та же
   * подложка с эмодзи, что и у ненарисованных карт, а сам рисунок проявляется
   * поверх. Пустого белого не бывает ни секунды.
   *
   * `loading="lazy"` убран сознательно: рисунок и так в поле зрения, ленивость
   * тут ничего не экономит, а старт запроса откладывает.
   */
  const подложка = {
    borderColor: `${accent}${photo ? '33' : '44'}`,
    background: `radial-gradient(120% 140% at 50% 0%, ${accent}33 0%, ${accent}0d 55%, transparent 100%)`,
  }
  if (photo) {
    return (
      <div
        className="relative mb-3 grid h-32 place-items-center overflow-hidden rounded-xl border text-5xl sm:h-36"
        style={подложка}
      >
        {!загрузилась && (
          <span className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]" aria-hidden>
            {icon}
          </span>
        )}
        <img
          src={photo}
          alt=""
          decoding="async"
          onLoad={() => setЗагрузилась(true)}
          onError={() => setЗагрузилась(false)}
          className={`absolute inset-0 block h-full w-full object-cover transition-opacity duration-300 ${
            загрузилась ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    )
  }
  return (
    <div
      className="mb-3 grid h-24 place-items-center overflow-hidden rounded-xl border text-5xl"
      style={подложка}
    >
      <span className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">{icon}</span>
    </div>
  )
}

function Shell({
  badge,
  title,
  flavor,
  children,
  accent = '#10b981',
  watching,
  note,
  art,
  photo,
  своё,
}: {
  badge: string
  title: string
  flavor?: string
  children: React.ReactNode
  accent?: string
  art?: string
  photo?: string | null
  /**
   * Свои действия — их не гасит НИЧТО. В движке это класс «своё»: к чужой
   * находке они отношения не имеют, поэтому и живут вне гасящего слоя.
   */
  своё?: React.ReactNode
  /** Имя того, чей сейчас ход, если смотрим со стороны. Гасит кнопки. */
  watching?: string | null
  /**
   * Подпись без гашения кнопок: «вы решили, ждём остальных».
   * 🔴 Раньше это состояние гасило карточку целиком — человек нажимал
   * «Купить» и терял возможность докупить или передумать, пока сосед думает.
   */
  note?: string | null
}) {
  return (
    /*
      🔴 На большом экране окно накрывает ТОЛЬКО середину — колонки по бокам
      остаются живыми. Раньше подложка ложилась на весь экран, и пока карта
      открыта, нельзя было даже прокрутить свою панель, чтобы посмотреть, что
      у тебя есть. Решение принимают, глядя на свои активы, а не по памяти.
    */
    /*
      🔴 ЗАТЕМНЕНИЕ НА ВЕСЬ ЭКРАН, НО КЛИКОВ ОНО НЕ ЛОВИТ (решение Камиля 19.08).
      Раньше выбор был между «затемнить всё и всё заблокировать» и «затемнить
      только середину» — вторая половина выглядела заплаткой: тёмная полоса
      посреди светлого стола. На самом деле третий вариант существует: слой
      затемнения делается сквозным (pointer-events: none), и нажатия проходят
      сквозь него к панелям и кнопкам, а перехватывает их только сама карточка.
      Стол при этом целиком уходит в тень — как и должно быть, когда на нём
      лежит карта, — но своими деньгами и портфелем пользоваться можно.
    */
    <div className="modal-layer pointer-events-none fixed inset-0 z-40">
      <div className="modal-scrim absolute inset-0 bg-black/55" />
      <div
        /*
          Карточка стоит по центру ПОЛЯ, а не всего экрана: на большом экране
          боковые колонки — это то, на что человек смотрит, принимая решение.
          Сверху отступ на высоту шапки (замер приезжает из стола): иначе
          карточка накрывала бы ряд кнопок.
        */
        className="absolute inset-0 flex items-center justify-center gap-2 px-4 pb-4 lg:left-[calc(var(--rail)_+_12px)] lg:right-[calc(var(--rail)_+_12px)]"
        style={{ paddingTop: 'calc(var(--topbar-h, 56px) + 8px)' }}
      >
      <div
        className="card-fly-in panel pointer-events-auto w-full max-w-md overflow-auto rounded-2xl p-5 shadow-[var(--shadow-pop)]"
        style={{ maxHeight: 'calc(100dvh - var(--topbar-h, 56px) - 24px)' }}
      >
        {art && <CardArt icon={art} accent={accent} photo={photo} />}
        <div
          className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: `${accent}22`, color: accent }}
        >
          {badge}
        </div>
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        {flavor && <p className="mt-1.5 text-sm italic text-[var(--muted)]">{flavor}</p>}
        {/*
          На чужом ходу кнопки не просто выключены, а не нажимаются вовсе:
          показываем карту как зрителю. Так за столом видно, что тянет сосед.
        */}
        <div
          className={`mt-4 space-y-3 ${watching ? 'pointer-events-none select-none opacity-70' : ''}`}
        >
          {children}
        </div>
        {/*
          🔴 СВОИ БУМАГИ ПРОДАЮТСЯ ВСЕГДА, чья бы карта ни лежала на столе.
          Раньше этот блок стоял среди `children` и умирал вместе с чужой
          находкой: он был ВИДЕН, но не нажимался — человек решал, что
          сломалось, и просил «почини, я же просил». Одним `pointer-events-auto`
          не обойтись: `opacity` родителя потомок не отменяет, блок остался бы
          бледным пятном. Поэтому — отдельный слот вне обёртки.
        */}
        {своё && <div className="mt-3 space-y-3">{своё}</div>}
        {(watching || note) && (
          <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-center text-[12px] text-[var(--muted)]">
            {watching || note}
          </div>
        )}
      </div>

      {/*
        🔴 БЫСТРЫЕ КНОПКИ РЯДОМ С КАРТОЧКОЙ (просьба Камиля).
        Пока карточка на столе, до шапки надо ехать глазами через весь экран —
        а решение по сделке чаще всего требует как раз заглянуть в деньги: чем
        гасить, у кого занять, что продать. Ставим их вплотную к карточке.

        Только на большом экране: на телефоне столбец кнопок отъел бы у
        карточки ширину, а шапка там и так под большим пальцем.

        Окна открываются ПОВЕРХ карточки и не закрывают её: карточка живёт,
        пока не принято решение, — закрыл окно, вернулся к ней.
      */}
      <БыстрыеКнопки />
      </div>
    </div>
  )
}

function БыстрыеКнопки() {
  const д = useContext(ДействияCtx)
  if (!д.банк && !д.сделки && !д.портфель) return null
  return (
    <div className="pointer-events-auto hidden shrink-0 flex-col gap-1.5 lg:flex">
      {д.банк && <БыстраяКнопка знак="💼" подпись="Финансы" onClick={д.банк} />}
      {д.сделки && <БыстраяКнопка знак="🤝" подпись="Сделки" onClick={д.сделки} />}
      {д.портфель && <БыстраяКнопка знак="🎒" подпись="Портфель" onClick={д.портфель} />}
    </div>
  )
}

/** Кнопка в столбце у карточки: знак сверху, подпись снизу — читается боковым зрением. */
function БыстраяКнопка({
  знак,
  подпись,
  onClick,
}: {
  знак: string
  подпись: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      /*
       * 🔴 ФОН БЕРЁМ ТОКЕНОМ `panel`, А НЕ `bg-[var(--panel)]/95`.
       *
       * Второй вариант Tailwind v3 МОЛЧА не собирает: правила для такого класса
       * в готовом CSS нет вовсе. Проверено замером на живой странице — фон у
       * кнопок был `rgba(0,0,0,0)`, то есть его не было совсем, и почти чёрная
       * подпись читалась поверх затемнённой доски как чёрное по чёрному.
       * Прозрачность к произвольному значению `var(…)` применить нельзя:
       * переменная хранит готовый `rgb(…)`, а не каналы. Токен `panel` в
       * tailwind.config.js объявлен через `<alpha-value>` — с ним модификатор
       * работает. Тот же капкан был в ленте плашек.
       */
      className="flex w-[4.6rem] flex-col items-center gap-0.5 rounded-xl border border-line bg-panel/95 px-2 py-2.5 text-[10.5px] font-semibold text-ink shadow-md backdrop-blur transition hover:border-accent/60 hover:bg-accent/10"
    >
      <span className="text-[17px] leading-none" aria-hidden>
        {знак}
      </span>
      <span>{подпись}</span>
    </button>
  )
}

/**
 * Строка продажи бумаги: сколько продать и подтверждение.
 *
 * 🔴 Раньше нажатие сразу продавало ВЕСЬ лот, без вопроса и без выбора
 * количества. Продать часть было нельзя вовсе, а промах по кнопке стоил
 * позиции целиком. Камиль: «продать сколько? Может, ты только часть хочешь».
 */
function SellLotRow({
  holder,
  lot,
  price,
  onSell,
}: {
  holder: Seat
  lot: {
    id: string
    shares: number
    costPerShare: number
    /** Доля владельцу находки за вход — движок удержит её при продаже. */
    profitShareTo?: string
    profitSharePct?: number
  }
  price: number
  onSell: (shares: number) => void
}) {
  const [n, setN] = useState(lot.shares)
  const [armed, setArmed] = useState(false)
  const take = Math.min(n, lot.shares)
  const profit = (price - lot.costPerShare) * take
  /*
   * 🔴 ТА ЖЕ АРИФМЕТИКА, ЧТО В ДВИЖКЕ (`SELL_STOCK_LOT` → доля с прибыли).
   * Кнопка печатала ВАЛОВУЮ выручку, а на счёт приходило за вычетом доли:
   * замер 03.09 — обещано 2 600 000, пришло 2 280 000, и ни слова об этом.
   */
  const пктДоли = Math.min(100, Math.max(0, Math.round(lot.profitSharePct ?? 0)))
  const доля =
    lot.profitShareTo && пктДоли > 0 && profit > 0
      ? Math.round((Math.round(profit) * пктДоли) / 100)
      : 0
  const наСчёт = take * price - доля
  return (
    <div className="panel-2 rounded-lg px-3 py-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span style={{ color: holder.color }}>●</span> {holder.name} · {lot.shares} шт по{' '}
          {money(lot.costPerShare)}
        </span>
        <span className={`tabnum font-semibold ${tone(profit)}`}>{signed(profit)}</span>
      </div>
      {lot.shares > 1 && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={lot.shares}
            value={take}
            onChange={(e) => {
              setN(Number(e.target.value))
              setArmed(false)
            }}
            className="flex-1 accent-emerald-500"
          />
          <span className="tabnum w-20 text-right text-[12px]">{take} шт</span>
        </div>
      )}
      <button
        onClick={() => (armed ? onSell(take) : setArmed(true))}
        className={`mt-1.5 w-full rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${
          armed
            ? 'bg-emerald-500 text-[#08150e]'
            : 'border border-[var(--line)] hover:border-emerald-500/60'
        }`}
      >
        {armed
          ? `Точно продать ${take} шт за ${money(наСчёт)}?`
          : `Продать ${take} шт · ${money(наСчёт)}`}
        {доля > 0 ? (
          <span className="mt-0.5 block text-[10.5px] font-normal text-[var(--muted)]">
            выручка {money(take * price)} − доля за вход {money(доля)}
          </span>
        ) : null}
      </button>
    </div>
  )
}

/**
 * Строка «продать свой объект» с подтверждением.
 *
 * 🔴 Раньше это была обычная кнопка: одно случайное нажатие — и студия
 * продана навсегда. Отменить продажу нечем, поэтому спрашиваем.
 */
/**
 * Характер бумаги словами вместо чисел вилки.
 *
 * 🔴 Считается ОТ САМОЙ ВИЛКИ, а не проставляется руками на карточках: иначе
 * подпись разъедется с данными на первой же правке колоды, и игрок будет
 * принимать решение по устаревшему описанию.
 */
function характерБумаги(s: { price: number; range: [number, number]; meme?: boolean }): string {
  const [lo, hi] = s.range
  if (!(hi > lo)) return 'цена почти не двигается'
  if (s.meme) return 'может обнулиться, может выстрелить в разы'
  const размах = hi / Math.max(lo, 1)
  if (размах <= 1.2) return 'держится ровно, живёт дивидендами'
  if (размах <= 2.2) return 'ходит спокойно, без резких скачков'
  if (размах <= 4) return 'заметно качает в обе стороны'
  return 'кидает в разы — и вверх, и вниз'
}

function SellAssetRow({
  name,
  color,
  net,
  price,
  debt,
  partner,
  share,
  onSell,
}: {
  name: string
  color: string
  /** Столько ляжет на счёт — ровно это число платит движок. */
  net: number
  /** Что даёт покупатель за объект целиком. */
  price: number
  /** Сколько уйдёт на досрочное закрытие рассрочки — уже со списанием наценки. */
  debt: number
  /** Доля соинвестора. */
  partner: number
  /** Доля владельцу находки за вход. */
  share: number
  onSell: () => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      onClick={() => (armed ? onSell() : setArmed(true))}
      className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition ${
        armed
          ? 'border border-emerald-500 bg-emerald-500/15'
          : 'panel-2 hover:border-emerald-500/60'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate">
          <span style={{ color }}>●</span> {name}
        </span>
        <span className="tabnum shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">
          {armed ? `Точно продать за ${money(net)}?` : `${money(net)} чистыми`}
        </span>
      </span>
      {/*
        🔴 РАСШИФРОВКА ПРЯМО В СТРОКЕ. Игра 31.08: «мне предлагают продать её
        за 2457, а стоимость самой двушки 11 250 — в чём прикол». Прикол в том,
        что в панели стоит цена С НАЦЕНКОЙ за рассрочку, покупатель даёт
        процент от РЫНОЧНОЙ, а из выручки ещё уходит остаток рассрочки. Пока
        это не написано словами, каждая продажа выглядит обманом.
      */}
      <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">
        покупатель даёт {money(price)}
        {debt > 0 ? ` − рассрочка ${money(debt)}` : ''}
        {partner > 0 ? ` − партнёру ${money(partner)}` : ''}
        {share > 0 ? ` − доля за вход ${money(share)}` : ''}
      </span>
    </button>
  )
}

/**
 * Кнопка «взять кредит» — в ДВА нажатия и с честным итогом.
 *
 * 🔴 Живая игра 31.08, две жалобы одним куском. «Ой, блин, я кредит взял.
 * Случайно» — одно касание выдавало деньги без единого вопроса и без отката.
 * И «куда мне кредитные деньги ушли? Я что-то взял, что ли?» — потому что
 * после нажатия на экране не менялось НИЧЕГО: на 98% крупных сделок даже
 * полный лимит не покрывает взнос (замер по колоде: 44 карты из 45), надпись
 * «не хватает» оставалась прежней, а сама кнопка исчезала — лимит-то выбран.
 *
 * Первое нажатие показывает сумму, будущий остаток и нехватку; второе берёт.
 * Тот же приём, что у продажи объекта выше: отменить кредит нечем, поэтому
 * спрашиваем.
 */
function КнопкаКредита({
  сумма,
  наРуках,
  нехватка,
  onTake,
}: {
  сумма: number
  наРуках: number
  /** Сколько не хватит на взнос ДАЖЕ с этим кредитом. 0 — хватит. */
  нехватка: number
  onTake: () => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      onClick={() => (armed ? onTake() : setArmed(true))}
      className={`w-full rounded-xl px-3 py-2 text-center text-[13px] transition ${
        armed
          ? 'border border-rose-500 bg-rose-500/15'
          : 'btn-ghost border-rose-500/40 hover:border-rose-500/70'
      }`}
    >
      {armed ? (
        <>
          <span className="block font-bold">Точно взять {money(сумма)}?</span>
          <span className="mt-0.5 block text-[11px] font-normal leading-snug opacity-90">
            на руках станет {money(наРуках + сумма)} · первые {RIBA.gracePaydays} зарплат без
            платежей, потом {RIBA.ratePctMonthly}% в месяц
            {нехватка > 0 && <> · на взнос всё равно не хватит {money(нехватка)}</>}
          </span>
        </>
      ) : (
        <>🏦 Кредит {money(сумма)}</>
      )}
    </button>
  )
}

/** Диапазон взносов колоды — коротко, из настоящих карт. */
function deckHint(cards: { downPayment?: number; price?: number }[]): string {
  const downs = cards
    .map((c) => c.downPayment ?? c.price ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (!downs.length) return ''
  /*
   * Показываем ПОРОГ входа, а не весь размах. Размах у малых сделок идёт от
   * трёхсот рублей за акцию до девяти миллионов за дом — такая «подсказка»
   * не подсказывает ничего.
   */
  return `взнос от ${money(downs[0])}`
}

/**
 * Строка показателя. `big` — для главного числа карточки (обычно доход):
 * оно набирается заметно крупнее остальных, чтобы считываться первым.
 */
function Stat({
  label,
  value,
  strong,
  big,
  good,
}: {
  label: string
  value: string
  strong?: boolean
  big?: boolean
  /** Зелёным — приход, красным — расход. */
  good?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between ${big ? 'text-sm' : 'text-sm'}`}>
      <span className="text-[var(--muted)]">{label}</span>
      <span
        className={`tabnum ${strong || big ? 'font-bold' : ''} ${
          big ? 'text-[19px] leading-tight' : ''
        } ${good === true ? 'text-emerald-600 dark:text-emerald-400' : ''} ${
          good === false ? 'text-rose-600 dark:text-rose-400' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Имя ходящего, когда мы смотрим со стороны. Через контекст, а НЕ через
 * обёртку внутри рендера.
 *
 * 🔴 Здесь была одна из самых злых поломок: `const S = (props) => <Shell/>`
 * объявлялся ВНУТРИ компонента, и React на каждом рендере видел новый тип —
 * то есть сносил всю карточку и собирал заново. Стоило тронуть ползунок, как
 * карточка «открывалась заново» с анимацией, состояние обнулялось и выбрать
 * число было почти невозможно. Компонент, объявленный в рендере, обязан жить
 * снаружи — иначе любое локальное состояние под ним обречено.
 */
/**
 * Быстрые кнопки у карточки.
 *
 * 🔴 Через контекст, а не пропсами: `<S>` рисуют ДВА ДЕСЯТКА веток карточек, и
 * протаскивать три обработчика через каждую — верный способ забыть одну и
 * получить карточку без кнопок, не заметив этого.
 */
const ДействияCtx = createContext<{
  банк?: () => void
  сделки?: () => void
  портфель?: () => void
}>({})

const WatchingCtx = createContext<{ watching: string | null; note: string | null }>({
  watching: null,
  note: null,
})

function S(props: React.ComponentProps<typeof Shell>) {
  const ctx = useContext(WatchingCtx)
  return <Shell {...props} watching={ctx.watching} note={ctx.note} />
}

/**
 * Сколько не хватает до покупки.
 *
 * 🔴 Кнопка просто гасла, и человек не понимал: он не может себе это позволить
 * или интерфейс сломался. Разница в одной строке — но именно её и не было.
 * У сделок такая подсказка была всегда, у пакетов и клеток Полосы — нет.
 */
function Нехватка({ есть, надо }: { есть: number; надо: number }) {
  if (есть >= надо) return null
  return (
    <p className="mt-1 text-center text-[11.5px] text-amber-600 dark:text-amber-400">
      Не хватает {money(надо - есть)} — на руках {money(есть)}
    </p>
  )
}

/** Подпись внизу карточки: почему кнопки не нажимаются. */
function watchNote(
  table: Table,
  seat: Seat,
  spectate: boolean,
): { watching: string | null; note: string | null } {
  const p = table.pending
  const actor = table.seats[table.turnIndex]
  const decided = p && (p.kind === 'deal' || p.kind === 'market') ? (p.decided ?? []) : []
  const waiting = pendingUndecided(table).filter((x: Seat) => x.id !== seat.id)
  /*
   * 🔴 Человек, который уже решил, должен видеть ЧТО ПРОИСХОДИТ. Раньше он
   * жал «Пропустить», карточка оставалась на месте и никак не отзывалась —
   * выглядело как сломанная кнопка, хотя решение записано и мы просто ждём
   * остальных.
   */
  if (spectate) return { watching: `Ходит ${actor?.name ?? ''} — вы смотрите`, note: null }
  if (decided.includes(seat.id)) {
    return {
      watching: null,
      note: waiting.length
        ? `Вы решили. Ждём: ${waiting.map((x: Seat) => x.name).join(', ')} · передумать ещё можно`
        : 'Вы решили',
    }
  }
  return { watching: null, note: null }
}

export function CardModal(props: {
  table: Table
  seat: Seat
  /** Моё место в онлайн-партии. Пусто — играем за одним экраном. */
  meId?: string
  dispatch: (e: TableEvent) => void
  /** Чужой ход: карту показываем, но решать нечего — кнопок нет. */
  spectate?: boolean
  /** Открыть экран сделок поверх карточки: занять, позвать в долю. */
  onOpenTrades?: () => void
  /** Открыть «Финансы»: погасить долг, посмотреть остатки. */
  onOpenBank?: () => void
  /** Открыть портфель: продать бумаги, посмотреть активы. */
  onOpenPortfolio?: () => void
  /** Условия входа назначает ТОЛЬКО владелец находки. */
  canSetAccess?: boolean
}) {
  return (
    <WatchingCtx.Provider value={watchNote(props.table, props.seat, props.spectate ?? false)}>
      <ДействияCtx.Provider
        value={{
          банк: props.onOpenBank,
          сделки: props.onOpenTrades,
          портфель: props.onOpenPortfolio,
        }}
      >
        <CardBody {...props} />
      </ДействияCtx.Provider>
    </WatchingCtx.Provider>
  )
}

function CardBody({
  table,
  seat,
  meId,
  dispatch,
  spectate = false,
  onOpenTrades,
  canSetAccess = false,
}: {
  table: Table
  seat: Seat
  meId?: string
  dispatch: (e: TableEvent) => void
  spectate?: boolean
  onOpenTrades?: () => void
  canSetAccess?: boolean
}) {
  /** Соседи по столу — у кого вообще можно занять. */
  /*
   * 🔴 ТОЛЬКО ИГРОКИ КРУГА. Долю в сделке Круга предлагали и тому, кто уже на
   * Полосе свободы: он платил деньги, получал зеркальную запись в портфель —
   * и не получал с неё НИ РУБЛЯ, потому что доход Полосы считает fastTrackIncome,
   * а realEstate/businesses в него не входят вовсе. Тот же фильтр стоит в
   * DealTradeActions и в списке покупателей TradesModal.
   */
  const others = table.seats.filter(
    (x) => x.id !== seat.id && !x.outOfGame && !x.won && x.track === 'rat',
  )
  /** Кто ещё не решил по этой карте — их и ждём, прежде чем закрыть окно. */
  const waitingFor = pendingUndecided(table).filter((x: Seat) => x.id !== seat.id)

  /** Сколько банк ещё готов дать сверх уже взятого. */
  const ribaFree = Math.max(0, ribaLimit(seat.ledger) - seat.ledger.liabilities.ribaLoan)
  const p = table.pending
  const [shares, setShares] = useState(1)
  /** Кого зовём в долю и какую долю отдаём. */
  const [coTo, setCoTo] = useState<string | null>(null)
  const [coShare, setCoShare] = useState(50)
  if (!p) return null
  const l = seat.ledger
  const actor = table.seats[table.turnIndex]
  const locale = 'ru' as const

  switch (p.kind) {
    case 'chooseDeal':
      return (
        <S badge="Возможность" title="Малая или крупная сделка?">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                /*
                 * 🔴 Пороги считаются ИЗ КОЛОДЫ, а не зашиты. Зашитые
                 * разъехались с данными: обещали «взнос до 150 000», а малые
                 * сделки давно стоят до 9,5 млн. Так подсказка не соврёт снова.
                 */
                ['small', 'Малая', deckHint(smallDeals(table.deckTheme))],
                ['big', 'Крупная', deckHint(bigDeals(table.deckTheme))],
              ] as const
            ).map(([size, name, hint]) => (
              <button
                key={size}
                onClick={() => dispatch({ type: 'CHOOSE_DEAL', size })}
                className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3 text-left transition duration-150 hover:border-accent/60"
              >
                <span className="block text-[15px] font-bold">{name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-[var(--muted)]">{hint}</span>
              </button>
            ))}
          </div>
        </S>
      )

    case 'deal': {
      const card = p.card
      const txt = cardText(card, locale)
      const badge = p.deck === 'small' ? 'Малая сделка' : 'Крупная сделка'

      if (card.kind === 'stock') {
        const raw = card as StockCard
        /*
         * 🔴 Цена с поправкой на рынок — ровно та, по которой купит движок
         * (table.ts зовёт marketStockPrice). Раньше карточка показывала цену
         * с карты, а списывалось другое: игрок жал «купить» и не понимал,
         * почему ушла не та сумма, а при сильном движении рынка кнопка
         * вообще молчала — денег «не хватало» на цену, которой он не видел.
         */
        const s = { ...raw, price: marketStockPrice(raw.price, table.market.stock[raw.symbol]) }
        /*
         * 🔴 Ноль бумаг тому, кто уже на Полосе свободы: движок покупку от
         * него не примет (сделки Круга — только для тех, кто в Круге), а
         * кнопка «Купить» оставалась живой и молча ничего не делала — 3619
         * отказов из 3619 в замере.
         */
        const max = seat.track === 'rat' && !seat.outOfGame ? Math.floor(l.cash / s.price) : 0
        const holders = stockHolders(table, s.symbol)
        /*
         * 🔴 Свои бумаги — ОТДЕЛЬНЫМ слотом, вне гасящей обёртки. Пока этот
         * блок жил среди обычного содержимого, он гас вместе с чужой карточкой:
         * человек видел свои строки продажи и не мог по ним нажать.
         */
        const моиБумаги = holders.some((h) => h.id === seat.id) ? (
          <div className="panel-2 space-y-1 rounded-lg p-2">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              {/* Продажа идёт по РЫНОЧНОЙ цене — той же, что списывает движок. */}
              Продать по цене сегодня — {money(s.price)}
            </div>
            {/* Только СВОИ лоты: чужими распоряжается их владелец. */}
            {holders
              .filter((h) => h.id === seat.id)
              .map((h) =>
                h.ledger.stocks
                  .filter((lot) => lot.symbol === s.symbol)
                  .map((lot) => (
                    <SellLotRow
                      key={lot.id}
                      holder={h}
                      lot={lot}
                      price={s.price}
                      onSell={(n) =>
                        dispatch({
                          type: 'SELL_STOCK_LOT',
                          seatId: h.id,
                          lotId: lot.id,
                          shares: n,
                          pricePerShare: s.price,
                        })
                      }
                    />
                  )),
              )}
          </div>
        ) : null
        return (
          <S
            своё={моиБумаги}
            badge={badge}
            title={txt.title}
            flavor={txt.flavor}
            accent="#38bdf8"
            art="📈"
            photo={artByTicker((card as any).symbol) ?? artById(card.id)}
          >
            <div className="panel-2 space-y-1 rounded-lg p-3">
              <Stat label="Тикер" value={s.symbol} />
              <Stat label="Цена сегодня" value={money(s.price)} strong />
              {/*
                🔴 ЧИСЕЛ ВИЛКИ БОЛЬШЕ НЕТ. Раньше здесь стояло «Диапазон
                14 000 – 26 000», и решение считалось арифметикой: игроки
                знали, что бумага ещё попадётся и её можно поднять в два-три
                раза. Камиль на игре: «убрать вилку, она делает решение
                слишком лёгким». Характер бумаги остаётся — риск понятен,
                но посчитать его наверняка нельзя.
              */}
              <Stat label="Как ходит" value={характерБумаги(s)} />
              {!!s.dividendPerShare && (
                <Stat label="Дивиденд" value={`${signed(s.dividendPerShare)}/шт/мес`} />
              )}
              <Stat label="Денег на руках" value={money(l.cash)} />
            </div>

            {/*
              🔴 ПРЯМАЯ ПОМЕТКА НА МЕМКОИНЕ. Решение Камиля: монету из игры не
              убираем — но человек обязан видеть, что в жизни такой заработок
              считается недозволенным, и решать уже осознанно. Ровно ради этой
              развилки мемкоин в колоде и оставлен.
            */}
            {(s as { meme?: boolean }).meme && <HalalNote topic="memecoin" />}

            {max > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={max}
                  value={Math.min(shares, max)}
                  onChange={(e) => setShares(Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="tabnum w-24 text-right text-sm">
                  {Math.min(shares, max)} шт · {money(Math.min(shares, max) * s.price)}
                </span>
              </div>
            )}

            {/*
              🔴 Доход считается ПОД ВЫБРАННОЕ КОЛИЧЕСТВО и меняется вместе с
              ползунком. Выше стоит дивиденд за одну бумагу — по нему нельзя
              решать: человек двигает ползунок и должен видеть, сколько будет
              приходить ему, а не умножать в уме.
            */}
            {max > 0 && !!s.dividendPerShare && (
              <div className="flex items-baseline justify-between rounded-lg bg-emerald-500/10 px-3 py-2">
                <span className="text-[13px] text-[var(--muted)]">Будет приходить</span>
                <span className="tabnum text-[19px] font-bold leading-tight text-emerald-600 dark:text-emerald-400">
                  {signed(Math.min(shares, max) * s.dividendPerShare)}
                  <span className="text-[12px] font-semibold"> /мес</span>
                </span>
              </div>
            )}

            {/*
              Доли от того, что по карману. Ползунком целиться в «половину
              денег» неудобно, а решение чаще всего именно в долях: взять
              четверть или зайти на всё.
            */}
            {max > 1 &&
              (() => {
                /*
                 * 🔴 Доли считались от того, что по карману, и при малых
                 * количествах СХЛОПЫВАЛИСЬ: если денег хватает на 4 бумаги,
                 * то и «10%», и «25%» — это одна и та же одна бумага. Обе
                 * кнопки загорались разом, и выглядело так, будто выбор
                 * срабатывает со сдвигом. Работала только «100%» — она
                 * единственная ни с чем не совпадала.
                 *
                 * Когда бумаг мало, показываем прямо количество: это честнее
                 * процентов, за которыми всё равно стоит «одна штука».
                 * Когда много — оставляем доли, но одинаковые убираем.
                 */
                const сырые =
                  max <= 6
                    ? Array.from({ length: max }, (_, i) => ({
                        ключ: i + 1,
                        // «шт» обязательно: голые числа читаются как проценты,
                        // а подсказки по наведению на планшете и телефоне нет.
                        подпись: `${i + 1} шт`,
                        n: i + 1,
                      }))
                    : [10, 25, 50, 75, 100].map((pct) => ({
                        ключ: pct,
                        подпись: `${pct}%`,
                        n: Math.max(1, Math.floor((max * pct) / 100)),
                      }))
                /*
                 * 🔴 Из одинаковых оставляем ПОСЛЕДНИЙ, а не первый: подписи
                 * идут по возрастанию, и первый — самый маленький процент.
                 * При семи бумагах «10%» и «25%» дают одну штуку, и раньше
                 * оставалась кнопка «10%», которая покупала 1 из 7 — то есть
                 * четырнадцать процентов. Ярлык врал на пять пунктов и больше.
                 */
                const поЧислу = new Map<number, (typeof сырые)[number]>()
                for (const x of сырые) поЧислу.set(x.n, x)
                const пресеты = [...поЧислу.values()].sort((a, b) => a.n - b.n)
                return (
                  <div
                    className="grid gap-1.5"
                    style={{ gridTemplateColumns: `repeat(${пресеты.length}, minmax(0, 1fr))` }}
                  >
                    {пресеты.map((x) => {
                      const on = Math.min(shares, max) === x.n
                      return (
                        <button
                          key={x.ключ}
                          onClick={() => setShares(x.n)}
                          className={`rounded-lg border px-1 py-1.5 text-[11.5px] font-semibold transition ${
                            on
                              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'border-[var(--line)] text-[var(--muted)] hover:border-emerald-500/50'
                          }`}
                          title={`${x.n} шт · ${money(x.n * s.price)}`}
                        >
                          {x.подпись}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}

            <div className="flex gap-2">
              <button
                disabled={max < 1}
                onClick={() => dispatch({ type: 'BUY_STOCK_SHARES', shares: Math.min(shares, max) })}
                className="btn-primary flex-1"
              >
                Купить
              </button>
              <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
                Пропустить
              </button>
            </div>

            {/* Кто нашёл — тот и решает, кого пускать и на каких условиях. */}
            {canSetAccess && (
              <div className="hairline mt-3 pt-3">
                <AccessPicker table={table} seat={seat} access={p.access} dispatch={dispatch} />
              </div>
            )}

            {/*
              🔴 Владелец находки НЕ ПОКУПАЕТ ЗА ДРУГИХ. Здесь стоял список
              допущенных с кнопкой «взять N шт» — нажатие тратило ЧУЖИЕ деньги
              на всю сумму, и человек видел, как у него молча списался
              кошелёк, хотя он только открыл вход. Открытый вход — это
              возможность, решение принимает сам вошедший на своём экране.
            */}
            {p.access && p.access.mode !== 'closed' && (
              <div className="panel-2 rounded-lg px-3 py-2 text-[12px]">
                <div className="caps text-[10px] font-bold text-[var(--muted)]">Вход открыт</div>
                <div className="mt-0.5">
                  {p.access.terms.kind === 'free'
                    ? 'Войти можно по этой же цене'
                    : p.access.terms.kind === 'fee'
                      ? `Плата за вход ${money(p.access.terms.amount)}`
                      : `${p.access.terms.pct}% с прибыли при продаже`}
                </div>
                {waitingFor.length > 0 && (
                  <div className="mt-1 text-[var(--muted)]">
                    Ждём решения: {waitingFor.map((x: Seat) => x.name).join(', ')}
                  </div>
                )}
              </div>
            )}


          </S>
        )
      }

      const halal = !RULES.loansEnabled
      const growth = (card as any).growthPerPayday as number | undefined
      const kind = card.kind === 'realEstate' ? 'realEstate' : 'business'

      // Две цены: налом дороже на входе, но доход весь твой и долгов нет.
      /*
       * 🔴 Условия берём из ОБЩЕЙ функции движка. Раньше здесь была своя
       * формула, и окно обещало одно, а начислялось другое — Камиль поймал это
       * на машиноместе: карточка показывала 800 ₽, приходило 100.
       */
      const terms = dealTerms(card, kind)
      // Что сейчас творится на рынке для этого класса активов.
      const mktMul = table.market.flow[card.category] ?? 1
      const isGl = !!(card as { greenleaf?: boolean }).greenleaf
      const instTotal = terms.instTotal
      const instDebt = terms.instDebt
      const monthly = terms.instMonthly
      const flowCash = terms.cashFlow

      /*
       * 🔴 Тот, кто уже вырвался из Круга, в его сделки НЕ ВХОДИТ. Движок это
       * режет всегда, а кнопки оставались живыми: гость с Полосы свободы жал
       * «Налом» и получал молчание — 5797 отказов из 5797 в замере.
       */
      const вКруге = seat.track === 'rat' && !seat.outOfGame
      const canCash = вКруге && l.cash >= card.cost
      // Рассрочки нет там, где взнос равен цене — не показываем пустой выбор.
      const canInstallment = вКруге && terms.financeable && l.cash >= card.downPayment
      /* Сколько не хватает до взноса — столько и просим у банка, с округлением. */
      const ribaWant = Math.min(
        ribaFree,
        Math.max(10_000, Math.ceil(Math.max(0, card.downPayment - l.cash) / 10_000) * 10_000),
      )
      // 🔴 И на ПОЛОВИНУ взноса деньги тоже нужны: кнопка была активна при пустом кошельке.
      const investorHalf = Math.round(card.downPayment / 2)
      const investorAvailable =
        halal &&
        !canInstallment &&
        p.deck === 'big' &&
        card.kind === 'realEstate' &&
        card.cashFlow > 0 &&
        l.cash >= investorHalf
      return (
        <S
          badge={card.category === 'partnership' ? 'Партнёрский бизнес' : badge}
          title={txt.title}
          flavor={txt.flavor}
          accent={card.category === 'partnership' ? '#22c55e' : '#10b981'}
          art={CARD_ART[card.category] ?? (card.kind === 'business' ? '🏭' : '🏠')}
          photo={artById(card.id) ?? artByTicker((card as any).symbol)}
        >
          {/*
            🔴 Все числа сделки на виду и подписаны словами, а не терминами.
            Требование Камиля: «сразу должно быть видно, сколько съедает платёж,
            сколько объект приносит и сколько сам стоит — чтобы посчитать за
            секунду». Раньше половина этих чисел пряталась внутри кнопок.
          */}
          <div className="panel-2 space-y-1 rounded-lg p-3">
            {/* У GreenLeaf цена и доход зависят от пакета — они на кнопках ниже. */}
            {!isGl && <Stat label="Стоит целиком" value={money(terms.cashPrice)} strong />}
            {terms.financeable && !isGl && (
              <>
                <Stat label="Первый взнос" value={money(terms.instDown)} />
                <Stat label="Платёж по рассрочке" value={`−${money(terms.instMonthly)}/мес`} />
                <Stat label="Всего с наценкой" value={money(terms.instTotal)} />
                {/*
                  🔴 Срок рассрочки был нигде не написан, хотя это половина
                  решения: платёж считается от него. Анвар на созвоне как раз
                  спорил про длину — теперь она видна, а не подразумевается.
                */}
                <Stat
                  label="Срок"
                  value={`${Math.round(RULES.installmentTerm[kind] / 12)} лет · ${
                    RULES.installmentTerm[kind]
                  } платежей`}
                />
              </>
            )}
            {!isGl && <div className="my-1 border-t border-[var(--line)]" />}
            {/* Показываем то, что реально придёт при нынешнем рынке. */}
            {!isGl && <Stat
              label={kind === 'realEstate' ? 'Приносит аренды' : 'Приносит дохода'}
              value={`${signed(marketDealFlow(terms.cashFlow, mktMul))}/мес`}
              big
              good
            />}
            {mktMul !== 1 && (
              <p className="text-[11px] leading-snug text-[var(--muted)]">
                С учётом того, что сейчас на рынке. По карте было{' '}
                {signed(terms.cashFlow)}/мес.
              </p>
            )}
            {terms.financeable && (
              <Stat
                label="Останется в рассрочку"
                value={`${signed(marketDealFlow(terms.cashFlow, mktMul) - terms.instMonthly)}/мес`}
                strong
              />
            )}
            {growth ? (
              <Stat
                label="Рост структуры"
                value={`+${money(growth)}/мес за каждую зарплату, до ${money((card as any).growthCap ?? 0)}`}
              />
            ) : null}
            <Stat label="Денег на руках" value={money(l.cash)} />
          </div>

          {/*
            🔴 ЧТО ЭТО ВООБЩЕ ТАКОЕ. Живая игра: «игроки не понимают, что такое
            Гринлиф», «воспринимается как пирамида». Возражение снимается не на
            созвоне, а внутри игры, в тот момент, когда человек решает,
            покупать или нет: чем партнёрская программа отличается от пирамиды
            и почему её доход считается пассивным.
          */}
          {(card as { greenleaf?: boolean }).greenleaf && (
            <div className="mb-2">
              <HalalNote topic="partnerstvo" />
            </div>
          )}

          {/*
            GreenLeaf: одна карта, три цены. Выбор игрока, а не то, что выпало —
            иначе главный урок (когда стоит подниматься) до человека не доходит.
          */}
          {(card as { greenleaf?: boolean }).greenleaf ? (
            <div className="space-y-2">
              {/*
                🔴 Доход на КАЖДОЙ кнопке. Раньше в общей панели стояли цена и
                поток только младшего пакета, и на флагманской карте два числа
                из трёх врали: человек выбирал вслепую и не понимал, за что
                доплачивает. Считаем движковой функцией, а не своей формулой —
                вторая копия расчёта неизбежно разойдётся с первой.
              */}
              {GL_PACKAGES.map((pk) => {
                const start = glStructureIncome(glInitialState(pk.id, 1))
                const base = glStructureIncome(glInitialState('platinum', 1))
                return (
                  <button
                    key={pk.id}
                    disabled={l.cash < pk.price}
                    onClick={() => dispatch({ type: 'BUY_DEAL', glPackage: pk.id })}
                    className="w-full rounded-xl border border-[var(--line)] p-3 text-left transition hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-black">{pk.name}</span>
                      <span className="tabnum text-lg font-black">{money(pk.price)}</span>
                    </div>
                    {/* Приход крупнее цены пакета: решение принимают по нему. */}
                    <div className="tabnum mt-1 text-[17px] font-bold leading-tight text-emerald-600 dark:text-emerald-400">
                      {signed(start)}
                      <span className="text-[12px] font-semibold"> /мес на старте</span>
                      {start > base && (
                        <span className="ml-1 text-[12px] font-normal text-[var(--muted)]">
                          (+{money(start - base)} к Платине)
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{pk.hint}</div>
                  </button>
                )
              })}
              <p className="text-[11px] leading-snug text-[var(--muted)]">
                Поднять пакет можно в любой момент — доплатите разницу. Считать выгодно тогда,
                когда структура уже приносит заметные деньги.
              </p>
              {/*
                🔴 ГЛАВНОЕ ОТЛИЧИЕ — РОСТ, И ЕГО НАДО ПОКАЗАТЬ ЧИСЛАМИ. Живая
                просьба: «показать в игре, что Гринлиф превосходит другие
                бизнесы при тех же вложениях». На старте он выглядит смешно —
                тысяча семьсот рублей против кафе на семьдесят тысяч, — и без
                этой строки человек просто не понимает, зачем его берут.
                Обычное дело даёт 2,3% в месяц и стоит на месте; структура
                стартует ниже и растёт каждую зарплату сама.
              */}
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-[11.5px] leading-snug">
                <span className="font-semibold">Чем он отличается от обычного дела:</span> дело
                приносит одну и ту же сумму всегда, а структура растёт каждую зарплату сама.
                Платина за 28 900 ₽ начинает с 1 700 ₽/мес — меньше, чем принесло бы обычное дело
                за те же деньги (665 ₽), — но через год это 73 000 ₽/мес, а через два 570 000 ₽.
                Дело за 28 900 ₽ так и осталось бы на 665 ₽.
              </div>
            </div>
          ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              disabled={!canCash}
              onClick={() => dispatch({ type: 'BUY_DEAL', payCash: true })}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                canCash ? 'border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/15' : 'border-[var(--line)]'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Налом</div>
              <div className="tabnum mt-0.5 text-lg font-black">{money(card.cost)}</div>
              <div className={`tabnum mt-1 text-[13px] ${tone(flowCash)}`}>{signed(flowCash)}/мес</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">долгов нет, доход весь ваш</div>
            </button>

            {/* 🔴 Кнопки рассрочки нет там, где рассрочки нет: раньше она
                висела с нулями и предлагала «купить за 0». */}
            {terms.financeable && (
            <button
              disabled={!canInstallment}
              onClick={() => dispatch({ type: 'BUY_DEAL' })}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                canInstallment ? 'border-[var(--line)] bg-[var(--panel-2)] hover:border-emerald-500/50' : 'border-[var(--line)]'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                В рассрочку · {money(instTotal)}
              </div>
              <div className="tabnum mt-0.5 text-lg font-black">{money(card.downPayment)}</div>
              <div className={`tabnum mt-1 text-[13px] ${tone(terms.instFlow)}`}>{signed(terms.instFlow)}/мес</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                остаток {money(instDebt)} · платёж {money(monthly)}/мес
              </div>
            </button>
            )}
          </div>
          )}

          {/*
            🔴 В ДОЛЮ ЗОВЁМ ЖИВЫХ ЛЮДЕЙ, а не безымянного «партнёра». Раньше
            здесь была одна кнопка «войти в долю с партнёром»: Камиль нажимал
            её, думая, что заходит вместе с Анваром, а деньги делились с
            выдуманным инвестором. За столом сидят люди — им и предлагаем,
            каждому поимённо (игроков может быть и пятеро).
          */}
          {investorAvailable && others.length > 0 && (
            <div className="panel-2 rounded-lg p-2.5">
              <div className="caps mb-1.5 text-[10px] font-bold text-[var(--muted)]">
                Позвать в долю
              </div>
              <div className="flex flex-wrap gap-1.5">
                {others.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setCoTo(o.id === coTo ? null : o.id)}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                      coTo === o.id
                        ? 'border-emerald-500 bg-emerald-500/15'
                        : 'border-[var(--line)] hover:border-emerald-500/50'
                    }`}
                  >
                    <span style={{ color: o.color }}>●</span> {o.name}
                  </button>
                ))}
              </div>

              {/*
                🔴 ДОЛЮ ВЫБИРАЕТ ЧЕЛОВЕК. Здесь стояло жёсткое «пополам»: сколько
                бы ни договаривались за столом, в сделку уходили 50%, и у
                инициатора доход считался так, будто он отдал половину.
              */}
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={coShare}
                  onChange={(e) => setCoShare(Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="tabnum w-16 text-right text-[15px] font-bold">{coShare}%</span>
              </div>

              <div className="mt-1.5 space-y-0.5 text-[11.5px]">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Партнёр вносит</span>
                  <span className="tabnum">
                    {money(Math.round((card.downPayment * coShare) / 100))} · {coShare}% дохода
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Вы вносите</span>
                  <span className="tabnum">
                    {money(card.downPayment - Math.round((card.downPayment * coShare) / 100))} ·{' '}
                    {100 - coShare}% дохода
                  </span>
                </div>
              </div>

              <button
                disabled={!coTo}
                onClick={() =>
                  dispatch({
                    type: 'OFFER_COINVEST',
                    amount: Math.round((card.downPayment * coShare) / 100),
                    share: coShare / 100,
                    toId: coTo ?? undefined,
                  })
                }
                className="btn-ghost mt-2 w-full border-emerald-500/50 disabled:opacity-40"
              >
                {coTo
                  ? `Предложить ${others.find((o) => o.id === coTo)?.name} долю ${coShare}%`
                  : 'Выберите, кого зовёте'}
              </button>
              <p className="mt-1 text-[10.5px] leading-snug text-[var(--muted)]">
                Он ответит сам. Доход и убыток делятся ровно по долям.
              </p>
            </div>
          )}

          {/*
            🔴 СТОРОННЕГО ИНВЕСТОРА БОЛЬШЕ НЕТ. Кнопка «войти в долю с
            партнёром за 50%» звала безымянного дельца: игрок думал, что
            заходит с соседом по столу, а половину дохода забирал никто.
            Камиль: «кнопка эфемерного инвестора странная, взаимодействие
            должно быть только с игроками». Не хватает денег — есть рассрочка,
            заём у соседей и кредит; доля — только с живым человеком.
          */}

          {/*
            Кто нашёл — тот и решает, кого пускать и на каких условиях.
            🔴 КРОМЕ ПАРТНЁРСКОГО БИЗНЕСА: пакет берёт только тот, кому карта
            выпала. Партнёр заключает СВОЙ договор, а не входит в чужой.
          */}
          {canSetAccess && !isGl && (
              <div className="hairline mt-3 pt-3">
                <AccessPicker table={table} seat={seat} access={p.access} dispatch={dispatch} />
              </div>
            )}

          {/*
            🔴 «Предложить свою цену» — обратная сторона «продать находку».
            Раньше цену называл только владелец; теперь и остальные могут
            перебить друг друга, а он выбирает. Механика ставок в движке лежала
            готовая (BID_OFFER), ей просто никто не пользовался.
          */}
          {/*
            🔴 Про возврат резиденту говорим ДО покупки. Иначе человек узнаёт о
            пользе паспорта задним числом: деньги вернулись, а почему — непонятно.
          */}
          {(() => {
            const скидка = надбавкаИностранца(l, card.category)
            if (!скидка) return null
            const база = canCash ? terms.cashPrice : card.downPayment
            return (
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] leading-snug">
                У вас второй паспорт: надбавку для иностранцев не возьмут — вернётся{' '}
                <b className="tabnum">{money(Math.round((база * скидка) / 100))}</b>.
              </p>
            )
          })()}

          {/*
            Сделку можно не только купить: право на неё продаётся, а вход
            делится с партнёром.

            🔴 Но ТОЛЬКО хозяину находки. Блок рисовался всем, кого впустили в
            чужую сделку, а движок такие события отклоняет: продать чужую
            карту, подарить её или позвать в долю по чужой находке нельзя.
            Три кнопки у гостя были мёртвыми на все сто — 6591 отказ из 6591
            в замере.
          */}
          {seat.id === table.seats[table.turnIndex].id && (
            <DealTradeActions table={table} seat={seat} card={card} dispatch={dispatch} />
          )}

          <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
            Пропустить
          </button>

          {halal && <HalalNote topic={investorAvailable ? 'musharaka' : 'murabaha'} />}

          {!canInstallment && !investorAvailable && (
            /*
             * 🔴 Тупик убран. Раньше здесь просто сообщали «не хватает» — и
             * человек оставался без единого хода, хотя занять у соседей можно
             * было всегда: кнопка «Сделки» скрыта под карточкой, и до неё
             * было не дотянуться. Теперь заём предлагается прямо тут.
             */
            <div className="space-y-2">
              <p className="text-center text-xs text-amber-500 dark:text-amber-400">
                {halal
                  ? 'Не хватает даже на взнос — займите у соседей по столу или дождитесь сделки по карману'
                  : 'Не хватает наличных — займите у соседей или возьмите кредит в банке'}
              </p>
              {/*
                🔴 Оба пути к деньгам стоят ПРЯМО ЗДЕСЬ. Кредит в игре был
                всегда, но жил внутри окна «Сделки» — то есть ровно там, куда
                из карточки не попасть. Камиль его не нашёл и решил, что
                механики нет вовсе. Долг у соседей — без надбавки; кредит —
                сразу и без спроса, но пока он открыт, неприятности приходят
                чаще; это написано на самой кнопке, а не мелким шрифтом.
              */}
              <div className="grid gap-2 sm:grid-cols-2">
                {onOpenTrades && others.length > 0 && (
                  <button onClick={onOpenTrades} className="btn-ghost w-full">
                    🤝 Занять у игроков
                  </button>
                )}
                {ribaFree > 0 && (
                  <КнопкаКредита
                    сумма={ribaWant}
                    наРуках={l.cash}
                    нехватка={Math.max(0, card.downPayment - l.cash - ribaWant)}
                    onTake={() => dispatch({ type: 'TAKE_RIBA', amount: ribaWant })}
                  />
                )}
              </div>
              {ribaFree > 0 ? (
                <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
                  Кредит дают сразу: первые {RIBA.gracePaydays} зарплат без платежей, потом{' '}
                  {RIBA.ratePctMonthly}% в месяц от суммы.
                </p>
              ) : (
                /*
                  🔴 ПОЧЕМУ КРЕДИТ НЕ ДАЮТ — НАДО СКАЗАТЬ. Кнопка просто
                  исчезала, и человек достраивал правило сам: «второй кредит
                  нельзя, пока не закрыт первый». Такого правила нет — есть
                  лимит от дохода, и он выбран. Молчащая кнопка рождает
                  выдуманные правила надёжнее, чем любая инструкция.
                */
                <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
                  Банк больше не даёт: в долг берут не больше {money(ribaLimit(l))} — это{' '}
                  {RIBA.limitIncomeMul} ваших месячных дохода, — а на вас уже{' '}
                  {money(l.liabilities.ribaLoan)}. Освободится, когда погасите часть.
                </p>
              )}
            </div>
          )}
        </S>
      )
    }

    case 'freedom': {
      const hero = table.seats.find((x) => x.id === p.seatId)
      const mine = hero?.id === seat.id
      return (
        <S
          badge="Свобода"
          title={mine ? 'Вы вырвались из Круга!' : `${hero?.name ?? 'Игрок'} вырвался из Круга`}
          accent="#f59e0b"
          art="🎉"
        >
          {/* Конфетти рисует CSS: полсотни лоскутов, у каждого свой путь. */}
          <div className="confetti" aria-hidden>
            {Array.from({ length: 40 }, (_, i) => (
              <span key={i} style={{ '--i': i } as React.CSSProperties} />
            ))}
          </div>
          {/*
            🔴 КАРТОЧКА БОЛЬШЕ НЕ ПРО ВЫКУП. Раньше здесь стояла сумма, за
            которую человека «покупали» — всё нажитое продавалось, из выкупа
            гасились долги, отщипывались доли, и каждое из этих слагаемых
            приходилось объяснять отдельной строкой, чтобы окно не соврало.
            Увольнение ничего не продаёт: активы остаются, долги едут дальше.
            Поэтому и числа честные другие — что приносит, что тратит.

            Старые сохранённые партии переигрываются и попадают сюда же: у них
            `доход` не заполнен, и мы показываем прежнюю картину про выкуп.
          */}
          {p.доход == null ? (
            <div className="rounded-lg bg-amber-500/10 px-3 py-3 text-center">
              <div className="text-[13px] text-[var(--muted)]">
                Доход, который работает без него, перерос расходы
              </div>
              <div className="tabnum mt-1 text-[24px] font-black leading-none text-amber-600 dark:text-amber-400">
                {money(p.buyout + (p.бумаги ?? 0))}
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">выкуп на Полосу свободы</div>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-500/10 px-3 py-3 text-center">
              <div className="text-[13px] text-[var(--muted)]">
                {mine ? 'Вы уволились' : 'Уволился'} — зарплата {money(p.зарплата ?? 0)} уходит
              </div>
              <div className="tabnum mt-1 text-[24px] font-black leading-none text-amber-600 dark:text-amber-400">
                {money(p.доход)}/мес
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                приносят активы — они остаются {mine ? 'вашими' : 'при нём'}
                {!!p.прибавка && p.прибавка > 0 && (
                  <>, из них {money(p.прибавка)} добавило то, что теперь дела ведутся вплотную</>
                )}
              </div>
              <div className="mt-2 border-t border-amber-500/30 pt-2 text-[12px] leading-snug text-[var(--muted)]">
                Расходы {money(p.расходы ?? 0)}/мес
                {!!p.долги && p.долги > 0 && <> · долги Круга {money(p.долги)} едут дальше</>}
              </div>
            </div>
          )}
          <p className="text-center text-[13px] leading-snug text-[var(--muted)]">
            {mine
              ? 'Дальше второй круг: цель — довести доход до двойного запаса над расходами. Или купить свою мечту.'
              : 'Партия продолжается: остальные доигрывают, как за настоящим столом.'}
          </p>
          <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
            {mine ? 'Вперёд' : 'Понятно'}
          </button>
        </S>
      )
    }

    /*
     * 🔴 Событие Полосы свободы: проверка, иск, развод, просадка дохода.
     * Раньше этих карточек не было вовсе — деньги списывались молча, и
     * человек видел только, что их стало меньше. Показываем «было — стало»:
     * ровно то, чего не хватало игрокам во всех остальных карточках тоже.
     */
    case 'ftEvent': {
      const дельта = p.after - p.before
      return (
        <S badge="Полоса свободы" title={p.title} flavor={p.text} accent="#f43f5e" art="⚖️">
          <div className="panel-2 space-y-1.5 rounded-lg px-3 py-2.5 text-[13px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--muted)]">Было на счету</span>
              <span className="tabnum">{money(p.before)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--muted)]">
                {дельта < 0 ? 'Списано' : 'Начислено'}
              </span>
              <span
                className={`tabnum font-bold ${дельта < 0 ? 'text-rose-500' : 'text-emerald-500'}`}
              >
                {signed(дельта)}
              </span>
            </div>
            <div className="hairline flex items-baseline justify-between pt-1.5">
              <span className="font-semibold">Стало</span>
              <span className="tabnum text-[17px] font-black">{money(p.after)}</span>
            </div>
          </div>
          {p.skip ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] leading-snug text-amber-600 dark:text-amber-400">
              Следующие {p.skip} хода пропускаете — на восстановление нужно время.
            </p>
          ) : null}
          <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
            Понятно
          </button>
        </S>
      )
    }

    case 'payday':
      return (
        <S badge="Зарплата" title="Пришли деньги" accent="#10b981" art="💰">
          <div className="rounded-lg bg-emerald-500/10 px-3 py-3 text-center">
            <div className="tabnum text-[26px] font-black leading-none text-emerald-600 dark:text-emerald-400">
              {signed(p.amount)}
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              Зарплата минус расходы — то, что реально осталось
            </div>
          </div>
          {/*
            🔴 Что произошло с партнёрским бизнесом — ЗДЕСЬ, а не строкой в
            журнале. Повышение ранга проходило молча: человек видел только,
            что доход почему-то стал другим, и не связывал одно с другим.
          */}
          {p.notes?.length ? (
            <div className="space-y-1.5">
              {p.notes.map((n, i) => (
                <p
                  key={i}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] leading-snug"
                >
                  {n}
                </p>
              ))}
            </div>
          ) : null}
          <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
            Понятно
          </button>
        </S>
      )

    case 'market': {
      const card = p.card
      const txt = cardText(card, locale)

      if (card.kind === 'sellOffer') {
        const matches = marketMatches(table, card.category)
        /*
         * 🔴 ЗА ОДНИМ ЭКРАНОМ ПРОДАЁТ КАЖДЫЙ ВЛАДЕЛЕЦ, А НЕ ТОЛЬКО ХОДЯЩИЙ.
         * В хот-сите `seat` — всегда тот, чей ход, поэтому чужие объекты не
         * рисовались вовсе: выпадала карта на машиноместа, сосед говорил «у
         * меня же есть» — и продать было негде, ходящий вторым «Дальше»
         * снимал карту со стола. Онлайн не меняется: там подпись не даёт
         * нажать за другого. Ботов не показываем — за них решает бот.
         */
        const хотсит = !meId
        const мои = хотсит
          ? matches.filter((m) => !m.seat.isBot)
          : matches.filter((m) => m.seat.id === seat.id)
        const чужие = matches.filter((m) => m.seat.id !== seat.id)
        return (
          <S
            badge="Рынок"
            title={txt.title}
            flavor={txt.flavor}
            accent="#38bdf8"
            art="🤝"
            photo={artById(card.id) ?? artBySpace('market')}
          >
            <div className="panel-2 rounded-lg p-3">
              <Stat
                label="Покупатель даёт"
                /* 🔴 С учётом живого мирового события: строка с деньгами ниже
                   уже считает по нему, а шапка показывала голые 130% при
                   реальных 162,5% — третье число на той же карточке. */
                /*
                  🔴 «ДАЁТ 115» — ЭТО +15 ИЛИ 115 ВСЕГО? Живой вопрос за столом.
                  Процент от стоимости человек в уме не разворачивает, особенно
                  когда рядом ещё три числа. Пишем и процент, и что он значит.
                */
                value={(() => {
                  const п = Math.round(card.multiplierPct * (table.market.price[card.category] ?? 1))
                  return п === 100
                    ? '100% — ровно столько, сколько стоит'
                    : `${п}% цены — ${п > 100 ? `на ${п - 100}% дороже` : `на ${100 - п}% дешевле`} рынка`
                })()}
                strong
              />
            </div>
            {/*
              🔴 «Ни у кого нет» — утверждение ПРО ВЕСЬ СТОЛ, а считалось по
              одному смотрящему. Карточка вообще не выпадает, пока владельца
              нет, — значит эта фраза была ложной каждый раз, когда её видели.
              Живая жалоба: «а у меня написано, что подходящих нет, при том что
              у него есть двушка». Теперь честно: не твоё — сказано, чьё.
            */}
            {мои.length === 0 ? (
              <p className="text-center text-sm text-[var(--muted)]">
                {чужие.length
                  ? `Это не про ваши активы. Подходящие есть у: ${чужие.map((m) => m.seat.name).join(', ')}.`
                  : 'Ни у кого нет подходящих активов.'}
              </p>
            ) : (
              <div className="space-y-1">
                {мои.map((m) =>
                  m.assets.map((a) => {
                    /*
                     * 🔴 ОДНА ФОРМУЛА С ДВИЖКОМ. Окно считало от цены С НАЦЕНКОЙ
                     * за рассрочку и не знало про списание незаработанной
                     * наценки — обещало одно, приходило другое (на «двушке»
                     * расхождение 330 000 ₽ за одну продажу).
                     */
                    const q = sellOfferQuote(
                      a,
                      a.debt,
                      card.multiplierPct,
                      table.market.price[card.category] ?? 1,
                    )
                    return (
                      <SellAssetRow
                        key={a.id}
                        name={m.seat.id === seat.id ? a.name : `${m.seat.name}: ${a.name}`}
                        color={m.seat.color}
                        net={q.toMe}
                        price={q.price}
                        debt={Math.max(0, a.debt - q.rebate)}
                        partner={q.partner}
                        share={q.share}
                        onSell={() =>
                          dispatch({ type: 'ACCEPT_OFFER', seatId: m.seat.id, assetId: a.id })
                        }
                      />
                    )
                  }),
                )}
              </div>
            )}
            {/*
              🔴 Здесь был «конец хода». Но рыночную карту видят все, а
              завершить ход может только тот, чей ход, — у остальных кнопка
              молча не срабатывала. «Пропустить» — это решение за себя, оно
              есть у каждого; когда решили все, карта уходит сама.
            */}
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
              Дальше
            </button>
          </S>
        )
      }

      if (card.kind === 'bizEvent') {
        /*
         * Событие обычного бизнеса. Карточку видит весь стол — как и любую
         * рыночную, — но касается она только ходящего: это его кофейня горит,
         * а не соседская. Поэтому первой строкой пишем, чьё это, а эффект
         * показываем в его деньгах.
         */
        const хозяин = table.seats[table.turnIndex]
        const мои = хозяин.ledger.businesses.filter(
          (b) => !b.gl && (!card.categories?.length || card.categories.includes(b.category ?? '')),
        )
        const мойХод = хозяин.id === seat.id
        return (
          <S
            badge="Бизнес"
            title={txt.title}
            flavor={txt.flavor}
            accent={(card.flowPct ?? card.cash ?? 0) >= 0 ? '#34d399' : '#fb923c'}
            art="🏪"
            photo={artById(card.id) ?? artBySpace('market')}
          >
            <p className="text-center text-sm text-[var(--muted)]">
              {мойХод ? 'Это про ваш бизнес.' : `Это про бизнес игрока ${хозяин.name}.`}
            </p>
            {мои.length > 0 && (
              <div className="panel-2 space-y-1 rounded-lg p-3">
                {мои.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--muted)]">{b.name}</span>
                    <span className="tabular-nums font-medium">
                      {money(Math.round(b.cashFlow * ((b.dipLeft ?? 0) > 0 ? (b.dipMul ?? 1) : 1)))}/мес
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/*
              🔴 ЧТО ИМЕННО ПРОИЗОШЛО С ДЕЛОМ — СЛОВАМИ И ЧИСЛАМИ.
              На живой игре Камиль прочитал «Сменил вывеску — район пришёл
              посмотреть» и спросил: «а что случилось? Он начал больше
              приносить или меньше?» Проценты на карточке этого не отвечали:
              человеку нужно ЕГО дело и ЕГО цифры. Считает движок, здесь
              просто показываем.
            */}
            {p.notes?.length ? (
              <div className="space-y-1 rounded-lg border border-accent/40 bg-accent/10 p-3 text-[12.5px] leading-snug">
                {p.notes.map((н: string, i: number) => (
                  <div key={i}>{н}</div>
                ))}
              </div>
            ) : null}

            <div className="panel-2 space-y-2 rounded-lg p-3">
              {card.flowPct != null && (
                <Stat
                  label={card.flowPct > 0 ? 'Доход вырос навсегда' : 'Доход упал навсегда'}
                  value={`${card.flowPct > 0 ? '+' : ''}${card.flowPct}%`}
                  strong
                />
              )}
              {card.dipPct != null && (
                <Stat
                  label={`Просадка на ${card.dipPaydays ?? 3} мес.`}
                  value={`−${card.dipPct}%`}
                  strong
                />
              )}
              {card.cash != null && (
                <Stat
                  label={card.cash > 0 ? 'На счёт' : 'Со счёта'}
                  value={money(Math.abs(card.cash))}
                  strong
                />
              )}
              {card.managerPct != null && (
                <p className="text-sm text-[var(--muted)]">
                  {/*
                    🔴 «ОТ ЧЕГО ОН БЕРЁТ СВОИ ПРОЦЕНТЫ» — живой вопрос за
                    столом. От выручки или от прибыли? Отвечаем прямо, иначе
                    человек считает в уме не то и решает вслепую.
                  */}
                  Управляющий берёт свою долю от ЧИСТОЙ прибыли дела — от того, что вы видите
                  в строке «приносит в месяц», а не от выручки. Обычно это {MANAGER_PCT}%. Этот
                  согласен на {card.managerPct}%.
                </p>
              )}
              {/*
                🔴 РАЗОВОЕ ГОВОРИМ РАЗОВЫМ. Живая жалоба с игры: событие вышло,
                а чистая прибыль барбершопа осталась прежней — и это записали в
                косяки. Косяка нет: карточка сняла деньги со счёта один раз,
                ежемесячная прибыль от такого и не должна меняться. Но пока об
                этом не сказано словами, молчаливое «ничего не изменилось»
                читается как поломка движка.
              */}
              {card.cash != null && card.flowPct == null && card.dipPct == null && p.выбор !== 'беда' && (
                <p className="text-[12.5px] leading-snug text-[var(--muted)]">
                  Это разовые деньги. Ежемесячная прибыль дела не меняется.
                </p>
              )}
            </div>
            {card.managerPct != null &&
              мойХод &&
              мои
                /*
                 * 🔴 ВТОРАЯ ПОЛОВИНА ОБЩЕГО ДЕЛА — НЕ ТОЧКА НАЙМА. Цена ниже
                 * считается от `b.cashFlow`, а у зеркала это ПОЛОВИНА потока;
                 * движок берёт полный. Кнопка обещала 30 000 и либо молча
                 * не делала ничего (денег ровно по кнопке — движок отклоняет),
                 * либо списывала 60 000. Нанимает ведущий: у него в панели
                 * кнопка есть, а доля партнёру проставится сама.
                 */
                .filter((b) => !b.managerPct && !(b.partnerId && !b.investorShare))
                .map((b) => {
                  // Та же цена, что и в панели игрока: три месяца его доли.
                  const цена = Math.max(
                    30_000,
                    Math.round((b.cashFlow * card.managerPct! * 3) / 100 / 1000) * 1000,
                  )
                  const хватает = хозяин.ledger.cash >= цена
                  return (
                    <div key={b.id} className="space-y-1">
                      <button
                        disabled={!хватает}
                        onClick={() =>
                          dispatch({ type: 'HIRE_MANAGER', assetId: b.id, pct: card.managerPct! })
                        }
                        className="btn-primary w-full"
                      >
                        Нанять в «{b.name}» за {money(цена)}
                      </button>
                      {!хватает && <Нехватка есть={хозяин.ledger.cash} надо={цена} />}
                    </div>
                  )
                })}
            {/*
              🔴 БЕДА С ВЫБОРОМ. Раньше карточка списывала деньги ещё до того,
              как человек её прочитал. Теперь у разовой беды два выхода:
              починить сразу или жить с поломкой — и второе чуть дороже, иначе
              выбор был бы фальшивым.
            */}
            {p.выбор === 'беда' && мойХод ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(() => {
                  const поток = мои.reduce((n, b) => n + b.cashFlow, 0)
                  const { pct, месяцев } = ценаТерпения(card, поток)
                  const надо = Math.abs(card.cash ?? 0)
                  const хватает = хозяин.ledger.cash >= надо
                  return (
                    <>
                      <button
                        disabled={!хватает}
                        onClick={() => dispatch({ type: 'PAY_BIZ_TROUBLE' })}
                        className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 p-3 text-left transition hover:bg-emerald-500/15 disabled:opacity-40"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                          Починить сразу
                        </div>
                        <div className="tabnum mt-0.5 text-lg font-black">{money(надо)}</div>
                        <div className="mt-1 text-[11px] text-[var(--muted)]">
                          {хватает ? 'дело работает как работало' : 'столько наличными сейчас нет'}
                        </div>
                      </button>
                      <button
                        onClick={() => dispatch({ type: 'ENDURE_BIZ_TROUBLE' })}
                        className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3 text-left transition hover:border-amber-500/60"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                          Перетерпеть
                        </div>
                        <div className="tabnum mt-0.5 text-lg font-black">−{pct}%</div>
                        <div className="mt-1 text-[11px] text-[var(--muted)]">
                          доход дела на {месяцев} {месяцев === 1 ? 'месяц' : 'месяца'}, платить не надо
                        </div>
                      </button>
                    </>
                  )
                })()}
              </div>
            ) : (
              <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
                {card.managerPct != null && мойХод ? 'Пока справлюсь сам' : 'Дальше'}
              </button>
            )}
          </S>
        )
      }

      if (card.kind === 'glEvent') {
        const biz = seat.ledger.businesses.find((b) => b.gl)
        /*
         * 🔴 Промоушен берёт ТОЛЬКО ходящий и ТОЛЬКО когда он созрел.
         *
         * Рыночная карточка общая, поэтому кнопки видели все — но движок
         * принимает промоушен как действие хода и вдобавок проверяет срок,
         * перерыв и план по объёму. У соседа кнопка не срабатывала никогда
         * (97 отказов из 97), у ходящего — в половине случаев (34 из 65), и
         * оба раза молча. Теперь причина написана прямо под кнопкой.
         */
        const мойХод = seat.id === table.seats[table.turnIndex].id
        const промо = card.promo ? GL_PROMOS.find((x) => x.id === card.promo) : undefined
        const созрел = biz?.gl && промо ? glPromoReady(biz.gl, промо) : { ready: false, why: '' }
        const можноПромо = !!biz?.gl && мойХод && созрел.ready
        return (
          <S badge="Партнёрский бизнес" title={txt.title} flavor={txt.flavor} accent="#22c55e">
            {card.promo ? (
              <>
                <div className="panel-2 rounded-lg p-3">
                  <Stat
                    label="Компания выкупает место за"
                    value={money(GL_PROMOS.find((p) => p.id === card.promo)?.amount ?? 0)}
                    strong
                  />
                </div>
                <button
                  disabled={!можноПромо}
                  onClick={() => dispatch({ type: 'GL_PROMO_TAKE', promo: card.promo! })}
                  className="btn-primary w-full disabled:opacity-40"
                >
                  Взять деньгами
                </button>
                {!можноПромо && (
                  <p className="text-center text-[11.5px] leading-snug text-[var(--muted)]">
                    {!biz?.gl
                      ? 'Партнёрского бизнеса у вас нет — эта карточка не про вас'
                      : !мойХод
                        ? 'Это предложение тому, чей ход'
                        : созрел.why}
                  </p>
                )}
                {card.promo === 'travel' && можноПромо && (
                  <button
                    onClick={() => dispatch({ type: 'GL_PROMO_TAKE', promo: 'travel', go: true })}
                    className="btn-ghost w-full"
                  >
                    Поехать самому
                  </button>
                )}
                {/*
                  🔴 Выход обязателен. Без партнёрского бизнеса кнопки выше
                  ничего не делают (движок возвращает prev), а закрыть карточку
                  было нечем — партия вставала намертво.
                */}
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
                  {biz?.gl ? 'Пропустить' : 'Это не про вас — дальше'}
                </button>
              </>
            ) : card.upgrade ? (
              <>
                {/*
                  Окно на повышение пакета. Доплата в игре была всегда, но
                  предложить её было некому: карточки не существовало, и Анвар
                  за партию так и не увидел перехода на Корону.
                */}
                {biz?.gl ? (
                  <div className="space-y-2">
                    {glUpgradeOptions(biz.gl.packageId).map((pk) => {
                      const cost = glUpgradeCost(biz.gl!.packageId, pk.id)
                      const now = glStructureIncome(biz.gl!)
                      const after = glStructureIncome({ ...biz.gl!, packageId: pk.id })
                      return (
                        <button
                          key={pk.id}
                          disabled={seat.ledger.cash < cost}
                          onClick={() =>
                            dispatch({ type: 'GL_UPGRADE', assetId: biz.id, to: pk.id })
                          }
                          className="w-full rounded-xl border border-[var(--line)] p-3 text-left transition hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:opacity-40"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-black">До «{pk.name}»</span>
                            <span className="tabnum text-lg font-black">{money(cost)}</span>
                          </div>
                          <div className="tabnum mt-1 text-[15px] font-bold text-emerald-600 dark:text-emerald-400">
                            {signed(after - now)}/мес сразу
                            <span className="ml-1 text-[12px] font-normal text-[var(--muted)]">
                              и дальше растёт быстрее
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-center text-sm text-[var(--muted)]">
                    Повышать нечего — партнёрского бизнеса у вас нет.
                  </p>
                )}
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
                  {biz?.gl ? 'Не сейчас' : 'Дальше'}
                </button>
              </>
            ) : card.triangle ? (
              <>
                <div className="panel-2 rounded-lg p-3">
                  <Stat label="Стоит" value={money(card.triangleCost ?? 0)} strong />
                  <Stat label="Доход по структуре вырастет на" value="30%" />
                </div>
                <button
                  /*
                    🔴 Кабинеты бывают уже открыты. Движок ищет бизнес БЕЗ
                    них и молча отклоняет покупку, а кнопка оставалась
                    живой — человек жал и ничего не происходило.
                  */
                  disabled={
                    !biz?.gl || biz.gl.triangle || seat.ledger.cash < (card.triangleCost ?? 0)
                  }
                  onClick={() => dispatch({ type: 'GL_BUY_TRIANGLE', cost: card.triangleCost ?? 0 })}
                  className="btn-primary w-full disabled:opacity-40"
                >
                  Открыть ещё два кабинета
                </button>
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
                  Не сейчас
                </button>
              </>
            ) : (
              <>
                <div className="panel-2 space-y-1 rounded-lg p-3 text-[13px]">
                  {card.boostPct ? <Stat label="Доход структуры" value={`+${card.boostPct}% сразу`} /> : null}
                  {card.growthPct ? <Stat label="Дальше расти будет" value={`быстрее на ${card.growthPct}%`} /> : null}
                  {card.dipPct ? (
                    <Stat
                      label="Доход просядет"
                      value={`на ${card.dipPct}% · ${вКругах(card.dipPaydays ?? 4)}`}
                    />
                  ) : null}
                  {card.freezePaydays ? (
                    <Stat
                      label="Приток новых людей встал"
                      value={вКругах(card.freezePaydays)}
                    />
                  ) : null}
                  {/*
                    🔴 «Теперь приносит» зелёным на ПЛОХОЙ карте читалось как
                    прибавка: «заблокировали страницу — и это дало плюс».
                    Хорошая новость подсвечивается, плохая — нет, а рядом
                    сказано, что именно произошло с доходом.
                  */}
                  {biz?.gl
                    ? (() => {
                        const bad = !!card.dipPct || !!card.freezePaydays
                        return (
                          <Stat
                            label={bad ? 'Доход сейчас' : 'Теперь приносит'}
                            value={`${signed(glTotalIncome(biz.gl))}/мес`}
                            big
                            good={bad ? undefined : true}
                          />
                        )
                      })()
                    : null}
                  {(card.dipPct || card.freezePaydays) && (
                    <p className="pt-1 text-[11.5px] leading-snug text-amber-600 dark:text-amber-400">
                      {card.freezePaydays
                        ? 'Доход не падает, но и не растёт: пока приток новых людей стоит, структура остаётся на месте.'
                        : 'Доход временно просел — через круг-другой вернётся к своему.'}
                    </p>
                  )}
                </div>
                <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
                  Понятно
                </button>
              </>
            )}
          </S>
        )
      }

      if (card.kind === 'stockPrice') {
        const holders = stockHolders(table, card.symbol)
        // Цена с поправкой на мировые события — иначе баннер обещает одно, а платят другое.
        const px = marketStockPrice(card.price, table.market.stock[card.symbol])
        /*
         * 🔴 Свои бумаги — вне гасящей обёртки. Иначе стоит нажать «Дальше»,
         * как тебя убирают из списка ожидающих, карточка считает тебя зрителем
         * и гасит ТВОИ ЖЕ строки продажи — при подписи «передумать ещё можно».
         */
        const моиБумаги = holders.some((h) => h.id === seat.id) ? (
          <div className="space-y-1">
            {/* Только свои бумаги: чужими распоряжается их владелец. */}
            {holders
              .filter((h) => h.id === seat.id)
              .map((h) =>
                h.ledger.stocks
                  .filter((lot) => lot.symbol === card.symbol)
                  .map((lot) => (
                    <SellLotRow
                      key={lot.id}
                      holder={h}
                      lot={lot}
                      price={px}
                      onSell={(n) =>
                        dispatch({
                          type: 'SELL_STOCK_LOT',
                          seatId: h.id,
                          lotId: lot.id,
                          shares: n,
                          pricePerShare: px,
                        })
                      }
                    />
                  )),
              )}
          </div>
        ) : null
        return (
          <S badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8" своё={моиБумаги}>
            <div className="panel-2 rounded-lg p-3">
              <Stat label={card.symbol} value={money(px)} strong />
              {px !== card.price && (
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  С учётом того, что сейчас творится на рынке. По карте было {money(card.price)}.
                </p>
              )}
            </div>
            {!holders.some((h) => h.id === seat.id) && (
              <p className="text-center text-sm text-[var(--muted)]">Ни у кого нет этих бумаг.</p>
            )}
            {/*
              🔴 Здесь был «конец хода». Но рыночную карту видят все, а
              завершить ход может только тот, чей ход, — у остальных кнопка
              молча не срабатывала. «Пропустить» — это решение за себя, оно
              есть у каждого; когда решили все, карта уходит сама.
            */}
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet w-full">
              Дальше
            </button>
          </S>
        )
      }

      // Сплит и разовая выплата применились автоматически.
      return (
        <S badge="Рынок" title={txt.title} flavor={txt.flavor} accent="#38bdf8">
          {/*
            🔴 КОМУ ЭТО — САМЫЙ ЧАСТЫЙ ВОПРОС ПО ТАКИМ КАРТОЧКАМ. Живая
            путаница: «8 000 кэшбэк» приняли за свои, хотя карта была личной и
            деньги ушли ходящему. Карточку видит весь стол, поэтому адресат
            обязан быть назван прямо на ней, а не выясняться по ведомости.
          */}
          {card.kind === 'windfall' && (
            <p className="text-center text-[13px] leading-snug text-[var(--muted)]">
              {card.scope === 'self' ? (
                <>
                  Это личные деньги — их получает{' '}
                  <b style={{ color: table.seats[table.turnIndex].color }}>
                    {table.seats[table.turnIndex].name}
                  </b>
                  , остальных карточка не касается.
                </>
              ) : (
                <>Деньги получают все за столом — каждый по своей строке в журнале.</>
              )}
            </p>
          )}
          <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
            Понятно
          </button>
        </S>
      )
    }

    case 'doodad': {
      const card = p.card
      const txt = cardText(card, locale)
      const monthly = Math.ceil(0.03 * card.amount)
      return (
        <S
          badge="Трата"
          title={txt.title}
          flavor={txt.flavor}
          accent="#fb7185"
          art="🛍️"
          photo={artById(card.id) ?? artBySpace('doodad')}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label={card.want ? 'Стоит' : 'К оплате'} value={money(card.amount)} strong />
            {card.upkeep ? (
              <Stat label="И потом каждый месяц" value={`${money(card.upkeep)} на содержание`} />
            ) : null}
            <Stat label="Денег на руках" value={money(l.cash)} />
          </div>
          {/*
            Хотелка — не обязательная трата. Можно пройти мимо, и это правильно.
            Но кто отказывается всё время, тот в какой-то момент выгорает: жить
            тоже надо. Счётчик отказов показываем честно, без нравоучений.
          */}
          {card.want && (l.wantsRefused ?? 0) >= 2 && (
            <p className="text-center text-[12px] text-amber-400">
              Подряд отказов: {l.wantsRefused}. Вы давно ничего себе не позволяли.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {card.want && (
              <button onClick={() => dispatch({ type: 'SKIP_WANT' })} className="btn-ghost w-full">
                Пройти мимо — не сейчас
              </button>
            )}
            <button
              disabled={l.cash < card.amount}
              onClick={() => dispatch({ type: 'PAY_DOODAD', financed: false })}
              className="btn-primary"
            >
              Заплатить {money(card.amount)}
            </button>
            {(card.financeable || (!RULES.loansEnabled && l.cash < card.amount)) && (
              <button onClick={() => dispatch({ type: 'PAY_DOODAD', financed: true })} className="btn-ghost">
                {RULES.loansEnabled
                  ? `На кредитку (+${money(monthly)}/мес навсегда)`
                  : `В рассрочку — ${money(Math.ceil(card.amount / 10))}/мес × 10`}
              </button>
            )}
            {l.cash < card.amount && !card.financeable && RULES.loansEnabled && (
              <p className="text-center text-xs text-amber-400">
                Только наличными — возьмите кредит в банке
              </p>
            )}
          </div>
        </S>
      )
    }

    case 'charity': {
      const cost = charityCost(l)
      return (
        <S
          badge="Благотворительность"
          title="Пожертвовать 10% дохода?"
          accent="#f59e0b"
          art="❤️"
          photo={artBySpace('charity')}
        >
          <p className="text-sm text-[var(--muted)]">
            {/*
              🔴 «Два кубика на три хода» за столом прочли как «три броска
              подряд». Пишем, что именно меняется: бросок остаётся один, просто
              кубиков в нём два — и шаг выходит вдвое длиннее.
            */}
            Отдайте {money(cost)} — и следующие 3 хода в броске будет два кубика вместо одного.
            Бросок по-прежнему один, но шаг вдвое длиннее: чаще зарплата, быстрее круг.
          </p>
          <div className="flex gap-2">
            <button
              disabled={l.cash < cost}
              onClick={() => dispatch({ type: 'ACCEPT_CHARITY' })}
              className="btn-primary flex-1"
            >
              Пожертвовать {money(cost)}
            </button>
            <button onClick={() => dispatch({ type: 'DECLINE_CHARITY' })} className="btn-ghost">
              Нет
            </button>
          </div>
        </S>
      )
    }

    case 'downsized': {
      const cost = totalExpenses(l)
      return (
        <S
          badge="Увольнение"
          title="Вы временно потеряли работу"
          accent="#64748b"
          art="📉"
          photo={artBySpace('downsized')}
        >
          {/*
            🔴 Кнопка обещала списать сумму, а движок не списывал ни рубля —
            и правильно делал: расходы и так уходят каждую зарплату, отдельное
            списание было бы двойным счётом. Наказание здесь — простой без
            зарплаты при живых счетах. Текст приведён в соответствие.
          */}
          <p className="text-sm text-[var(--muted)]">
            Два месяца без зарплаты, а счета идут своим чередом. Бонус
            благотворительности сгорает.
          </p>
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Расходы за месяц" value={money(cost)} />
            <Stat label="Денег на руках" value={money(l.cash)} strong />
          </div>
          <button onClick={() => dispatch({ type: 'PAY_DOWNSIZED' })} className="btn-danger w-full">
            Пропустить 2 хода
          </button>

        </S>
      )
    }

    case 'ftBusiness': {
      const space = fastBoard()[p.space]
      if (space.type !== 'business') return null
      const txt = fastSpaceText(p.space, locale)
      return (
        <S
          badge="Инвестиция Полосы"
          title={txt?.name ?? space.name}
          flavor={txt?.flavor}
          art="🏢"
          photo={artById((space as any).id)}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Взнос" value={money(space.downPayment)} strong />
            <Stat label="Добавит дохода" value={`${signed(space.cashFlow)}/мес`} strong />
            <Stat label="Денег на руках" value={money(l.cash)} />
          </div>
          <div className="flex gap-2">
            <button
              disabled={l.cash < space.downPayment}
              onClick={() => dispatch({ type: 'BUY_FT_BUSINESS' })}
              className="btn-primary flex-1"
            >
              Инвестировать {money(space.downPayment)}
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Мимо
            </button>
          </div>
          <Нехватка есть={l.cash} надо={space.downPayment} />
        </S>
      )
    }

    case 'ftVenture': {
      const space = fastBoard()[p.space]
      if (space.type !== 'venture') return null
      const txt = fastSpaceText(p.space, locale)
      return (
        <S
          badge="Доля в проекте"
          title={txt?.name ?? space.name}
          flavor={txt?.flavor}
          accent="#f97316"
          art="🛢️"
          photo={artById((space as any).id)}
        >
          <div className="panel-2 rounded-lg p-3">
            {/*
              🔴 «СТАВКА НЕВОЗВРАТНАЯ» — СЛОВО ИЗ КАЗИНО, а механика тут другая:
              деньги идут в реальное дело и превращаются в долю, а не ложатся
              на стол в ожидании броска. В халяльной игре разница между
              вложением и пари — не мелочь формулировки, и называть вложение
              ставкой значит учить неверному.
            */}
            <Stat label="Вложение в проект" value={money(space.downPayment)} strong />
            <Stat label="Если проект пойдёт" value={`${signed(space.cashFlow)}/мес`} strong />
            <Stat label="Проект пошёл при броске" value={`${space.threshold} и выше`} />
            {/*
              🔴 Говорим шансы ЧИСЛОМ. «Нужно 5 или больше» человек в уме не
              переводит, а «один бросок из трёх» — это уже решение. Механика
              была честная, но выглядела как обман: поставил и всё пропало.
            */}
            <Stat
              label="Шанс"
              value={`${7 - space.threshold} из 6 — примерно ${Math.round(((7 - space.threshold) / 6) * 100)}%`}
            />
          </div>
          <HalalNote topic="venture" />
          {p.rolled == null ? (
            <div className="flex gap-2">
              <button
                disabled={l.cash < space.downPayment}
                onClick={() =>
                  dispatch({ type: 'TRY_VENTURE', die: 1 + Math.floor(Math.random() * 6) })
                }
                className="btn-primary flex-1"
              >
                Войти в проект — {money(space.downPayment)}
              </button>
              <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
                Мимо
              </button>
              <Нехватка есть={l.cash} надо={space.downPayment} />
            </div>
          ) : (
            /*
              🔴 Исход остаётся НА КАРТОЧКЕ. Раньше кубик бросался невидимо:
              окно исчезало, деньги уходили, а «выпало 2, ставка сгорела»
              падало строкой в журнал, куда никто не смотрит. Со стороны это
              и выглядело как «механика риска не работает».
            */
            <>
              <div
                className={`rounded-xl border px-3 py-3 text-center ${
                  p.won
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-rose-500/50 bg-rose-500/10'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Pips n={p.rolled} />
                  <span className="tabnum text-3xl font-black leading-none">{p.rolled}</span>
                </div>
                <div
                  className={`mt-1.5 text-[14px] font-bold ${
                    p.won ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {p.won
                    ? `Выстрелило! ${signed(space.cashFlow)}/мес`
                    : `Нужно было ${space.threshold} или больше — ставка сгорела`}
                </div>
                {p.before != null && p.after != null && (
                  <div className="mt-1 text-[12px] text-[var(--muted)]">
                    Было {money(p.before)} · стало {money(p.after)}
                  </div>
                )}
              </div>
              <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-primary w-full">
                Понятно
              </button>
            </>
          )}
        </S>
      )
    }

    case 'ftDream': {
      const space = fastBoard()[p.space]
      if (space.type !== 'dream') return null
      const price = dreamPriceAt(table, p.space)
      const bumps = table.dreamBumps[p.space] ?? 0
      const txt = fastSpaceText(p.space, locale)
      // 🔒 С долгом перед игроком победа не засчитывается — иначе выигрышной
      // стратегией стало бы «занять у всех и уйти». Говорим это прямо, а не гасим кнопку.
      const owed = loanOutstanding(table.loans, seat.id)
      const creditors = debtsOf(table.loans, seat.id)
        .map((ln) => seatOf(table, ln.lenderId)?.name ?? 'игрок')
        .join(', ')
      return (
        <S
          badge="Ваша мечта"
          title={txt?.name ?? space.name}
          flavor={txt?.flavor}
          accent="#f472b6"
          art="⭐"
          photo={artByDream(space.name)}
        >
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Базовая цена" value={money(space.price)} />
            {bumps > 0 && <Stat label={`Соперники поднимали ×${bumps}`} value={money(price)} strong />}
            <Stat label="Цена сейчас" value={money(price)} strong />
            <Stat label="Денег на руках" value={money(l.cash)} />
          </div>

          {owed > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] leading-snug">
              <div className="font-bold">🔒 Сначала рассчитайтесь с людьми</div>
              <p className="mt-1 text-[var(--muted)]">
                До победы закрыть {money(owed)} — {creditors}. Долг перед игроком победу не
                пропускает: рассрочка за актив здесь ни при чём, речь о деньгах, которые вас
                выручили.
              </p>
              <button
                disabled={l.cash < owed + price}
                onClick={() => {
                  for (const ln of debtsOf(table.loans, seat.id)) {
                    dispatch({ type: 'REPAY_PLAYER_LOAN', loanId: ln.id, amount: loanOwed(ln) - ln.repaid })
                  }
                  dispatch({ type: 'BUY_DREAM' })
                }}
                className="btn-primary mt-2 w-full"
              >
                Погасить {money(owed)} и купить мечту
              </button>
              {l.cash < owed + price && (
                <p className="mt-1.5 text-center text-[12px] text-amber-400">
                  На всё сразу не хватает {money(owed + price - l.cash)}.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={l.cash < price || owed > 0}
              onClick={() => dispatch({ type: 'BUY_DREAM' })}
              className="btn-primary flex-1"
            >
              🏆 Купить мечту и выиграть
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Пока нет
            </button>
          </div>
        </S>
      )
    }

    case 'ftCharity': {
      const cost = ftCharityCost(l)
      return (
        <S
          badge="Благотворительность"
          title="Пожертвовать 10% дохода свободы?"
          accent="#f59e0b"
          art="❤️"
          photo={artBySpace('charity')}
        >
          <p className="text-sm text-[var(--muted)]">
            Отдайте {money(cost)} — и до конца партии будете бросать три кубика.
          </p>
          <div className="flex gap-2">
            <button
              disabled={l.cash < cost}
              onClick={() => dispatch({ type: 'ACCEPT_FT_CHARITY' })}
              className="btn-primary flex-1"
            >
              Пожертвовать {money(cost)}
            </button>
            <button onClick={() => dispatch({ type: 'PASS_CARD' })} className="btn-quiet">
              Нет
            </button>
          </div>
        </S>
      )
    }

    case 'bankruptcy': {
      const flow = monthlyCashFlow(l)
      const recover = canRecover(l)
      return (
        <S badge="Банкротство" title={`${seat.name} не свёл концы с концами`} accent="#f43f5e" art="🆘">
          <div className="panel-2 rounded-lg p-3">
            <Stat label="Деньги на руках" value={money(l.cash)} strong />
            <Stat label="Поток в месяц" value={signed(flow)} strong />
          </div>
          <p className="text-sm text-[var(--muted)]">
            {recover
              ? 'Вы снова на плаву — можно вернуться в игру.'
              : 'Продавайте активы банку за полцены, пока поток не станет положительным.'}
          </p>

          {/*
            🔴 Самый нужный момент для помощи раньше был единственным, где её не
            предлагали. Теперь развилка та же, что и в жизни: попросить у
            человека — неловко, но чисто; взять в банке — быстро и никто не
            увидит, но потом идёт тяжелее.
          */}
          {!recover && (
            <div className="space-y-2 rounded-lg border border-[var(--line)] p-3">
              <p className="text-[12px] font-bold">Можно не распродавать нажитое</p>
              {table.seats
                .filter((x) => x.id !== seat.id && !x.outOfGame && x.ledger.cash > 0)
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() =>
                      dispatch({ type: 'ASK_LOAN', fromId: x.id, amount: Math.max(50_000, -flow * 6) })
                    }
                    className="btn-ghost w-full border-emerald-500/50"
                  >
                    Попросить {money(Math.max(50_000, -flow * 6))} у игрока{' '}
                    <span style={{ color: x.color }}>●</span> {x.name} — без надбавки
                  </button>
                ))}
              {/*
                🔴 ГЕЙТ ПО ОСТАТКУ ЛИМИТА. Кнопка висела всегда, а движок молча
                отклоняет заявку, когда лимит выбран (замер: стол возвращается
                той же ссылкой, в журнале ноль новых строк) — нажатие не делало
                РОВНО НИЧЕГО и ничего об этом не говорило.
              */}
              {ribaFree > 0 ? (
                <КнопкаКредита
                  сумма={Math.min(ribaFree, Math.max(100_000, -flow * 12))}
                  наРуках={l.cash}
                  нехватка={0}
                  onTake={() =>
                    dispatch({
                      type: 'TAKE_RIBA',
                      amount: Math.min(ribaFree, Math.max(100_000, -flow * 12)),
                    })
                  }
                />
              ) : (
                <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
                  Кредитный лимит выбран целиком — банк больше не даст.
                </p>
              )}

            </div>
          )}

          {!recover && (
            <div className="max-h-52 space-y-1 overflow-auto">
              {l.realEstate.map((a) => (
                <button
                  key={a.id}
                  onClick={() => dispatch({ type: 'BANKRUPTCY_SELL', assetKind: 'realEstate', assetId: a.id })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
                >
                  <span>{a.name}</span>
                  <span className="tabnum">{money(Math.floor(a.downPayment / 2))}</span>
                </button>
              ))}
              {l.businesses.map((a) => (
                <button
                  key={a.id}
                  onClick={() => dispatch({ type: 'BANKRUPTCY_SELL', assetKind: 'business', assetId: a.id })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
                >
                  <span>{a.name}</span>
                  <span className="tabnum">{money(Math.floor(a.downPayment / 2))}</span>
                </button>
              ))}
              {l.stocks.map((a) => (
                <button
                  key={a.id}
                  onClick={() => dispatch({ type: 'BANKRUPTCY_SELL', assetKind: 'stock', assetId: a.id })}
                  className="panel-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
                >
                  <span>
                    {a.symbol} × {a.shares}
                  </span>
                  <span className="tabnum">{money(Math.floor((a.shares * a.costPerShare) / 2))}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {recover ? (
              <button onClick={() => dispatch({ type: 'BANKRUPTCY_RECOVER' })} className="btn-primary">
                Выкарабкаться — пропустить 3 хода
              </button>
            ) : (
              <>
                {!hasSellableAssets(l) && hasConsumerDebt(l) && (
                  <button onClick={() => dispatch({ type: 'BANKRUPTCY_HALVE' })} className="btn-ghost">
                    Уполовинить потребительские долги
                  </button>
                )}
                <button onClick={() => dispatch({ type: 'BANKRUPTCY_QUIT' })} className="btn-danger">
                  Сдаться — выйти из игры
                </button>
              </>
            )}
          </div>
        </S>
      )
    }

    default:
      return null
  }
}
