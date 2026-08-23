import type { PayableDebt } from './types'

/**
 * События уровня кошелька. Чистые, сериализуемые, воспроизводимые —
 * из них восстанавливается любое состояние игрока.
 */
export type LedgerEvent =
  /**
   * Снимок рыночных множителей кладётся ВНУТРЬ события: applyEvent не имеет
   * доступа к столу, а повтор партии обязан давать тот же результат.
   */
  | { type: 'PAYCHECK'; flowMul?: Record<string, number> }
  | { type: 'TAKE_RIBA_L'; amount: number; payment: number; grace: number }
  | { type: 'REPAY_RIBA_L'; amount: number }
  | { type: 'ADD_UPKEEP'; amount: number }
  | { type: 'REFUSE_WANT' }
  | { type: 'INDULGE' }
  | { type: 'SET_CITIZENSHIP'; name: string; fee: number }
  | { type: 'ADJUST_RIBA_EXPOSURE'; amount: number }
  | { type: 'SET_MANAGER'; assetId: string; pct: number }
  | { type: 'SALARY_RAISE'; amount: number }
  | { type: 'ZAKAT' }
  | {
      type: 'BUY_STOCK'
      id: string
      symbol: string
      shares: number
      costPerShare: number
      dividendPerShareMonthly: number
      /** Вошёл в чужую находку: кому и сколько процентов с прибыли отдать. */
      profitShareTo?: string
      profitSharePct?: number
    }
  | { type: 'SELL_STOCK'; lotId: string; shares: number; pricePerShare: number }
  | { type: 'STOCK_SPLIT'; symbol: string; direction: 'split' | 'reverse'; ratio?: number }
  | { type: 'BUY_REAL_ESTATE'; id: string; name: string; cost: number; downPayment: number; mortgage: number; cashFlow: number; category: string; investorShare?: number; installmentMonthly?: number; partnerId?: string; paidIn?: number; value?: number }
  | {
      type: 'SELL_REAL_ESTATE'
      assetId: string
      salePrice: number
      /** Долг уходит вместе с активом к покупателю — из выручки его НЕ вычитаем. */
      debtTransfers?: boolean
      /** Списанная незаработанная наценка при досрочном закрытии рассрочки. */
      rebate?: number
    }
  | { type: 'BUY_BUSINESS'; id: string; name: string; cost: number; downPayment: number; liability: number; cashFlow: number; category: string; investorShare?: number; growthPerPayday?: number; growthCap?: number; installmentMonthly?: number; partnerId?: string; paidIn?: number; glPackage?: import('./greenleaf').GlPackageId; glLuck?: number; value?: number }
  | { type: 'SELL_BUSINESS'; assetId: string; salePrice: number; debtTransfers?: boolean; rebate?: number }
  | { type: 'DOODAD'; amount: number }
  | { type: 'FINANCE_DOODAD'; amount: number }
  | { type: 'PET' }
  | { type: 'DOWNSIZED' }
  | { type: 'CHARITY' }
  | { type: 'CHARITY_TURN_USED' }
  | { type: 'TAKE_LOAN'; amount: number }
  | { type: 'REPAY_LOAN'; amount: number }
  | { type: 'PAYOFF_ASSET'; assetId: string; discountPct: number }
  | { type: 'PAY_OFF_DEBT'; debt: PayableDebt; amount?: number }
  | { type: 'PAYOFF_ASSET'; assetId: string; discountPct: number }
  | { type: 'ADJUST_CASH'; amount: number }
  | { type: 'FORCED_SALE'; assetKind: 'stock' | 'realEstate' | 'business'; assetId: string }
  | { type: 'HALVE_CONSUMER_DEBT' }
  | { type: 'DECLARE_GAME_OVER' }
  | { type: 'ENTER_FAST_TRACK' }
  | { type: 'CASHFLOW_DAY' }
  | { type: 'BUY_FT_BUSINESS'; id: string; name: string; downPayment: number; cashFlow: number }
  | { type: 'FT_STAKE_LOST'; amount: number }
  | { type: 'FT_DOWNSIZED'; amount: number }
  | { type: 'BUY_DREAM'; name: string; pricePaid: number }
  | { type: 'TAX_AUDIT' }
  | { type: 'LAWSUIT' }
  | { type: 'DIVORCE'; amount: number }

/**
 * События уровня стола. Ровно это и гоняется по сети в онлайне,
 * и ровно это складывается в журнал для отката хода.
 */
/**
 * 🔴 У КАЖДОГО события есть автор — `by`, идентификатор места.
 *
 * Раньше движок считал действующим того, чей сейчас ход. На одном устройстве
 * это верно, а онлайн давало дикое: Анвар жмёт «Погасить» в свои финансы, а
 * гасится долг у Камиля, потому что ход был его. Автор проставляется на
 * клиенте один раз в точке отправки; пусто — значит ходящий (игра на одном
 * устройстве, где «я» и «чей ход» — одно и то же).
 */
export type TableEvent = { by?: string } & TableEventBody

export type TableEventBody =
  | { type: 'ROLL'; dice: number[] }
  | { type: 'CHOOSE_DEAL'; size: 'small' | 'big' }
  /** glPackage — выбранный пакет GreenLeaf, если карта партнёрская. */
  | {
      type: 'BUY_DEAL'
      withInvestor?: boolean
      payCash?: boolean
      /** Кто покупает. Пусто — ходящий. Заполнено — вошедший по разрешению. */
      seatId?: string
      glPackage?: import('./greenleaf').GlPackageId
    }
  /** Поднять пакет GreenLeaf, доплатив разницу. Доступно в любой момент. */
  | { type: 'GL_UPGRADE'; assetId: string; to: import('./greenleaf').GlPackageId }
  | { type: 'GL_BUY_TRIANGLE'; cost: number }
  /** Взять процентный кредит в банке. Доступно всегда, в том числе при банкротстве. */
  | { type: 'TAKE_RIBA'; amount: number }
  /** Погасить процентный кредит целиком или частью. */
  | { type: 'REPAY_RIBA'; amount: number }
  /** Пройти мимо хотелки. Копить полезно — но не всё время. */
  | { type: 'SKIP_WANT' }
  | { type: 'GET_CITIZENSHIP'; id: string }
  /** Владелец находки решает, кого и на каких условиях пускать в сделку. */
  /** access: null — снять условия и вернуться к выбору («передумать»). */
  | { type: 'SET_ACCESS'; access: import('./types').DealAccess | null }
  /** Нанять управляющего в бизнес: доход начинает работать без тебя. */
  | { type: 'HIRE_MANAGER'; assetId: string; pct: number }
  /** Промоушен: забрать деньгами или поехать. Поездка даёт скрытую прибавку. */
  | { type: 'GL_PROMO_TAKE'; promo: 'travel' | 'auto'; go?: boolean }
  | { type: 'BUY_STOCK_SHARES'; shares: number; seatId?: string }
  | { type: 'PASS_CARD' }
  | { type: 'SELL_STOCK_LOT'; seatId: string; lotId: string; shares: number; pricePerShare: number }
  | { type: 'ACCEPT_OFFER'; seatId: string; assetId: string }
  | { type: 'PAY_DOODAD'; financed: boolean }
  | { type: 'ACCEPT_CHARITY' }
  | { type: 'DECLINE_CHARITY' }
  | { type: 'PAY_DOWNSIZED' }
  | { type: 'TAKE_LOAN'; amount: number }
  | { type: 'REPAY_LOAN'; amount: number }
  | { type: 'PAYOFF_ASSET'; assetId: string; discountPct: number }
  | { type: 'PAY_OFF_DEBT'; debt: PayableDebt; amount?: number }
  | { type: 'ENTER_FAST_TRACK' }
  | { type: 'BUY_FT_BUSINESS' }
  | { type: 'TRY_VENTURE'; die: number }
  | { type: 'BUY_DREAM' }
  | { type: 'ACCEPT_FT_CHARITY' }
  | { type: 'BANKRUPTCY_SELL'; assetKind: 'stock' | 'realEstate' | 'business'; assetId: string }
  | { type: 'BANKRUPTCY_HALVE' }
  | { type: 'BANKRUPTCY_RECOVER' }
  | { type: 'BANKRUPTCY_QUIT' }
  | {
      type: 'END_TURN'
      /**
       * Номер хода, который закрывают.
       *
       * 🔴 Без него один и тот же конец хода применяется ДВАЖДЫ и съедает
       * чужой ход. Конец хода шлют двое — хозяин комнаты и сам ходящий, — и
       * это правильно: иначе стол замирает, когда хозяин свернул вкладку.
       * Дубль надо не запрещать, а обезвреживать. Номер хода растёт при
       * каждом переходе, поэтому второй экземпляр приходит с устаревшим
       * номером и отклоняется.
       *
       * Необязательный: события, записанные до этой правки, номера не несут
       * и переигрываются как раньше.
       */
      turn?: number
    }
  | { type: 'FINISH_GAME' }
  | { type: 'WORLD_EVENT'; index: number }
  // ─── Сделки между игроками ───
  | { type: 'OFFER_CARD'; amount: number; toId?: string }
  | { type: 'OFFER_COINVEST'; amount: number; share: number; toId?: string }
  | { type: 'OFFER_ASSET'; assetId: string; amount: number; toId?: string }
  | { type: 'OFFER_LOAN'; toId: string; amount: number }
  /** Заём просят чаще, чем предлагают: fromId — тот, у КОГО просят. */
  | { type: 'ASK_LOAN'; fromId: string; amount: number }
  /** Дать в долг С НАДБАВКОЙ. Беды потом приходят обоим. */
  | { type: 'OFFER_LOAN_WITH_INTEREST'; toId: string; amount: number; interestPct: number }
  | { type: 'BID_OFFER'; offerId: string; seatId: string; amount: number }
  | { type: 'ACCEPT_OFFER_TRADE'; offerId: string; seatId: string }
  | { type: 'CANCEL_OFFER'; offerId: string }
  | { type: 'REPAY_PLAYER_LOAN'; loanId: string; amount: number }
  | { type: 'FORGIVE_LOAN'; loanId: string }

export interface StampedEvent {
  seq: number
  at: number
  seatId: string
  event: TableEvent
}
