/**
 * Чтение предложений между игроками для интерфейса: что предлагают, сколько
 * это стоит на самом деле и кто должен ответить.
 *
 * Правила живут в движке (коридор цены, доли, заём без надбавки) — здесь
 * только разбор стола. Ни одна функция ничего не меняет.
 */
import type { DealCard, Seat, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import {
  botAcceptsOffer,
  fairAssetPrice,
  fairCardPrice,
  loanOutstanding,
  loanOwed,
  offerAlive,
  type Offer,
  type PlayerLoan,
} from '../engine/trades'
import { localizedCardTitle } from '../engine/data'
import { dealTerms } from '../engine/ledger'

/** Карточка, право на которую можно перепродать. Акции сюда не входят. */
export type TradeCard = Exclude<DealCard, { kind: 'stock' }>

export interface TradeAsset {
  id: string
  name: string
  kind: 'realEstate' | 'business'
  cost: number
  /** Остаток рассрочки — уходит к покупателю вместе с активом. */
  debt: number
  cashFlow: number
  /** Доля соинвестора: с продажи она уходит партнёру, а не владельцу. */
  investorShare?: number
}

export function seatOf(t: Table, id?: string): Seat | undefined {
  return id ? t.seats.find((s) => s.id === id) : undefined
}

export function assetsOf(seat: Seat): TradeAsset[] {
  /*
   * 🔴 Вторая половина общей сделки в список на продажу НЕ идёт: это запись о
   * чужом объекте, у неё нет ни долга, ни рыночной цены. Движок такую продажу
   * отвергает — значит и предлагать её нельзя, иначе «жму и ничего».
   */
  const своё = <A extends { partnerId?: string; investorShare?: number }>(a: A) =>
    !a.partnerId || !!a.investorShare
  return [
    ...seat.ledger.realEstate.filter(своё).map((a) => ({
      id: a.id,
      name: a.name,
      kind: 'realEstate' as const,
      cost: a.cost,
      debt: a.mortgage,
      cashFlow: a.cashFlow,
      investorShare: a.investorShare,
    })),
    ...seat.ledger.businesses.filter(своё).map((a) => ({
      id: a.id,
      name: a.name,
      kind: 'business' as const,
      cost: a.cost,
      debt: a.liability,
      cashFlow: a.cashFlow,
      investorShare: a.investorShare,
    })),
  ]
}

export function findAsset(t: Table, ownerId: string, assetId?: string): TradeAsset | undefined {
  const owner = seatOf(t, ownerId)
  if (!owner || !assetId) return undefined
  return assetsOf(owner).find((a) => a.id === assetId)
}

/** Открытая карточка сделки — то, право на что сейчас можно продать или взять в долю. */
export function openDealCard(t: Table): TradeCard | null {
  const p = t.pending
  if (p?.kind !== 'deal' || p.card.kind === 'stock') return null
  return p.card
}

/**
 * Живое предложение — то, по которому ещё можно нажать «принять». Кроме срока
 * важно вот что: право на находку и доля в ней привязаны к открытой карточке.
 * Ход закончился, карточка ушла — движок такое согласие уже не примет, и
 * показывать его как живое нельзя.
 */
export function offerActionable(t: Table, o: Offer): boolean {
  if (o.kind === 'resellCard' || o.kind === 'coInvest') return openDealCard(t) !== null
  return true
}

export function liveOffers(t: Table): Offer[] {
  return t.offers.filter((o) => offerAlive(o, t) && offerActionable(t, o))
}

export function offerTitle(t: Table, o: Offer): string {
  const card = openDealCard(t)
  switch (o.kind) {
    case 'resellCard':
      return card ? `Право на сделку «${localizedCardTitle(card)}»` : 'Право на сделку'
    case 'coInvest':
      return card ? `Доля в «${localizedCardTitle(card)}»` : 'Доля в сделке'
    case 'sellAsset':
      return findAsset(t, o.fromId, o.assetId)?.name ?? 'Актив'
    case 'loan':
      return 'Беспроцентный заём'
  }
}

/** Справедливая цена — та, вокруг которой движок держит коридор ±100%. */
export function offerFair(t: Table, o: Offer): number {
  const card = openDealCard(t)
  switch (o.kind) {
    case 'resellCard':
      return card ? fairCardPrice(card.downPayment) : 0
    case 'coInvest':
      // Справедливо для доли — весь вход в сделку: от него считается размер доли.
      return card ? card.downPayment : 0
    case 'sellAsset': {
      const a = findAsset(t, o.fromId, o.assetId)
      return a ? fairAssetPrice(a.cost, a.debt) : 0
    }
    case 'loan':
      return o.amount
  }
}

/** Сколько отвечающий будет получать в месяц, если согласится. */
export function offerGain(t: Table, o: Offer): number {
  const card = openDealCard(t)
  switch (o.kind) {
    case 'resellCard':
      return card?.cashFlow ?? 0
    case 'coInvest':
      /*
       * 🔴 Вдвоём объект берётся ТОЛЬКО в рассрочку — делим поток за вычетом
       * платежа (instFlow), а не доход как при покупке налом. Иначе подпись
       * «это уже чистыми» под этим числом была прямой неправдой.
       */
      return card
        ? Math.round(
            dealTerms(card, card.kind === 'realEstate' ? 'realEstate' : 'business').instFlow *
              (o.share ?? 0),
          )
        : 0
    case 'sellAsset':
      return findAsset(t, o.fromId, o.assetId)?.cashFlow ?? 0
    case 'loan':
      return 0
  }
}

/**
 * Наличные, которые должны быть у отвечающего. За находку платят дважды:
 * посреднику за право и в саму сделку первый взнос.
 */
export function offerNeed(t: Table, o: Offer, price = o.amount): number {
  const card = openDealCard(t)
  switch (o.kind) {
    case 'resellCard':
      return price + (card?.downPayment ?? 0)
    case 'coInvest':
      return o.amount
    case 'sellAsset':
      return price
    case 'loan':
      return o.amount
  }
}

/** Цена, по которой уйдёт сделка: лучшая ставка, если торговались. */
export function offerPrice(o: Offer): number {
  if (!o.bids.length) return o.amount
  return [...o.bids].sort((a, b) => b.amount - a.amount)[0].amount
}

/** Торг ставками движок считает только там, где ставка становится ценой. */
export function offerBiddable(o: Offer): boolean {
  return o.kind === 'resellCard' || o.kind === 'sellAsset'
}

/**
 * Кто отвечает на предложение. По займу — тот, у кого просят: деньги его.
 * По остальному — покупатель: адресат, а если предложение всем, то любой
 * игрок Круга, кроме автора.
 */
export function offerResponders(t: Table, o: Offer): Seat[] {
  /*
   * 🔴 Отвечает ТА СТОРОНА, КОТОРАЯ ПРЕДЛОЖЕНИЕ НЕ СОЗДАВАЛА.
   *
   * Раньше по займу всегда возвращался кредитор — и когда он сам предлагал
   * деньги, тоже. Получалось, что он же и должен был согласиться на
   * собственное предложение, а настоящему адресату кнопки не доставалось.
   * У обратного случая — «я прошу» — та же беда с другой стороны: кнопку
   * «Дать» видел заёмщик.
   */
  const автор = o.askedBy ?? o.fromId
  if (o.kind === 'loan') {
    const другой = seatOf(t, автор === o.fromId ? o.toId : o.fromId)
    return другой && !другой.outOfGame ? [другой] : []
  }
  /*
   * 🔴 Дорожку проверяем и у ИМЕННОГО адресата, а не только в рассылке «всем».
   * Активы Круга на Полосе свободы не приносят ничего, движок такие сделки
   * теперь отклоняет — кнопка «Принять» у такого адресата врала бы.
   */
  const named = seatOf(t, o.toId)
  if (named) return named.outOfGame || named.won || named.track !== 'rat' ? [] : [named]
  return t.seats.filter((s) => s.id !== автор && !s.outOfGame && !s.won && s.track === 'rat')
}

/**
 * Чьим именем ПОДПИСАН ответ. Это всегда тот, кто нажал: движок требует
 * `event.seatId === event.by` — «отвечать можно только за себя».
 *
 * 🔴 Раньше по займу сюда клали заёмщика, кто бы ни отвечал. Пока деньги
 * ПРЕДЛАГАЮТ, заёмщик и есть отвечающий — совпадало случайно. Но когда деньги
 * ПРОСЯТ, отвечает кредитор, и подпись расходилась с местом: движок молча
 * отклонял ответ, а на экране «жму — ничего не происходит». Ровно это и
 * случилось в живой игре: обе кнопки займа оказались мёртвыми.
 *
 * Кому уйдут деньги, движок решает сам — у займа получатель всегда `toId`.
 */
export function offerBuyerId(_o: Offer, responder: Seat): string {
  return responder.id
}

/** Долги игрока перед другими игроками — они же запирают победу. */
/*
 * 🔴 Долг считается закрытым, когда выплачено ВСЁ, что причитается, а не
 * только тело. При займе с надбавкой сравнение с `amount` гасило строку
 * раньше времени: в списке долг исчезал, а движок его ещё держал.
 */
const непогашен = (l: PlayerLoan) => loanOwed(l) > l.repaid

export function debtsOf(loans: PlayerLoan[], seatId: string): PlayerLoan[] {
  return loans.filter((l) => l.borrowerId === seatId && непогашен(l))
}

export function creditsOf(loans: PlayerLoan[], seatId: string): PlayerLoan[] {
  return loans.filter((l) => l.lenderId === seatId && непогашен(l))
}

export function playerDebt(t: Table, seatId: string): number {
  return loanOutstanding(t.loans, seatId)
}

/**
 * Ответ бота на живое предложение — по тем же цифрам, что и весь остальной
 * движок. Возвращает событие для водителя ботов и запасное на случай отказа
 * движка принять решение.
 */
export function botOfferReply(t: Table): { event: TableEvent; fallback: TableEvent } | null {
  for (const o of liveOffers(t)) {
    // Пошли ставки — дальше решает продавец-человек, бот в торги не лезет.
    if (o.bids.length) continue
    const responders = offerResponders(t, o)
    if (!responders.length) continue
    const bots = responders.filter((s) => s.isBot)
    if (!bots.length) continue

    const cancel: TableEvent = { type: 'CANCEL_OFFER', offerId: o.id }
    const fair = offerFair(t, o)
    const gain = offerGain(t, o)
    for (const bot of bots) {
      if (bot.ledger.cash < offerNeed(t, o)) continue
      if (botAcceptsOffer(o, bot, fair, gain)) {
        return {
          event: { type: 'ACCEPT_OFFER_TRADE', offerId: o.id, seatId: offerBuyerId(o, bot) },
          fallback: cancel,
        }
      }
    }
    // Отвечать больше некому и никто не взял — снимаем, чтобы человек не ждал.
    if (bots.length === responders.length) return { event: cancel, fallback: cancel }
  }
  return null
}
