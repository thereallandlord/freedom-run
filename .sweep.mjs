// src/engine/types.ts
var DEBT_TO_PAYMENT = {
  homeMortgage: "homeMortgagePayment",
  schoolLoans: "schoolLoanPayment",
  carLoans: "carPayment",
  creditCards: "creditCardPayment",
  retailDebt: "retailPayment"
};

// src/engine/ledger.ts
var RULES = {
  currency: "USD",
  fastTrackMultiplier: 100,
  fastTrackTarget: 15e4,
  loansEnabled: true
};
function setRules(patch) {
  Object.assign(RULES, patch);
}
var MAX_PETS = 3;
function petExpenses(l) {
  return l.pets * l.profession.perChildExpense;
}
function ownShare(a) {
  return Math.round(a.cashFlow * (1 - (a.investorShare ?? 0)));
}
function passiveIncome(l) {
  const stocks = l.stocks.reduce((s, lot) => s + lot.shares * lot.dividendPerShareMonthly, 0);
  const realEstate = l.realEstate.reduce((s, a) => s + ownShare(a), 0);
  const businesses = l.businesses.reduce((s, a) => s + ownShare(a), 0);
  return stocks + realEstate + businesses;
}
function totalIncome(l) {
  return l.salary + passiveIncome(l);
}
function totalExpenses(l) {
  const e = l.expenses;
  return e.taxes + e.homeMortgagePayment + e.schoolLoanPayment + e.carPayment + e.creditCardPayment + e.retailPayment + e.otherExpenses + e.bankLoanPayment + petExpenses(l);
}
function monthlyCashFlow(l) {
  return totalIncome(l) - totalExpenses(l);
}
function professionMonthlyCashFlow(p) {
  const e = p.expenses;
  return p.salary - (e.taxes + e.homeMortgagePayment + e.schoolLoanPayment + e.carPayment + e.creditCardPayment + e.retailPayment + e.otherExpenses);
}
function startingCash(p) {
  return professionMonthlyCashFlow(p) + p.savings;
}
function isOutOfRatRace(l) {
  return passiveIncome(l) > totalExpenses(l);
}
function fastTrackProgress(l) {
  return l.fastTrack ? l.fastTrack.businesses.reduce((s, b) => s + b.cashFlow, 0) : 0;
}
function fastTrackIncome(l) {
  return l.fastTrack ? l.fastTrack.beginningIncome + fastTrackProgress(l) : 0;
}
function createLedger(p, playerName) {
  return {
    playerName,
    phase: "ratRace",
    cash: startingCash(p),
    profession: p,
    salary: p.salary,
    expenses: { ...p.expenses, bankLoanPayment: 0 },
    liabilities: { ...p.liabilities, bankLoan: 0 },
    pets: 0,
    stocks: [],
    realEstate: [],
    businesses: [],
    charityTurnsLeft: 0
  };
}

// src/engine/applyEvent.ts
function clone(l) {
  return {
    ...l,
    expenses: { ...l.expenses },
    liabilities: { ...l.liabilities },
    stocks: l.stocks.map((x) => ({ ...x })),
    realEstate: l.realEstate.map((x) => ({ ...x })),
    businesses: l.businesses.map((x) => ({ ...x })),
    fastTrack: l.fastTrack ? {
      ...l.fastTrack,
      businesses: l.fastTrack.businesses.map((x) => ({ ...x })),
      dream: l.fastTrack.dream ? { ...l.fastTrack.dream } : void 0
    } : void 0
  };
}
function applyEvent(prev, e) {
  const l = clone(prev);
  switch (e.type) {
    case "PAYCHECK": {
      for (const b of l.businesses) {
        if (b.growthPerPayday && b.cashFlow < (b.growthCap ?? Infinity)) {
          b.cashFlow = Math.min(b.growthCap ?? Infinity, b.cashFlow + b.growthPerPayday);
        }
      }
      l.cash += monthlyCashFlow(l);
      if (!RULES.loansEnabled && l.liabilities.bankLoan > 0) {
        const pay = Math.min(l.expenses.bankLoanPayment, l.liabilities.bankLoan);
        l.liabilities.bankLoan -= pay;
        if (l.liabilities.bankLoan <= 0) {
          l.liabilities.bankLoan = 0;
          l.expenses.bankLoanPayment = 0;
        }
      }
      return l;
    }
    case "SALARY_RAISE":
      l.salary += e.amount;
      return l;
    case "BUY_STOCK":
      l.cash -= e.shares * e.costPerShare;
      l.stocks.push({
        id: e.id,
        symbol: e.symbol.toUpperCase(),
        shares: e.shares,
        costPerShare: e.costPerShare,
        dividendPerShareMonthly: e.dividendPerShareMonthly
      });
      return l;
    case "SELL_STOCK": {
      const lot = l.stocks.find((x) => x.id === e.lotId);
      if (!lot) return prev;
      const n = Math.min(e.shares, lot.shares);
      l.cash += n * e.pricePerShare;
      lot.shares -= n;
      l.stocks = l.stocks.filter((x) => x.shares > 0);
      return l;
    }
    case "STOCK_SPLIT": {
      const sym = e.symbol.toUpperCase();
      for (const lot of l.stocks) {
        if (lot.symbol !== sym) continue;
        lot.shares = e.direction === "split" ? lot.shares * 2 : Math.floor(lot.shares / 2);
      }
      l.stocks = l.stocks.filter((x) => x.shares > 0);
      return l;
    }
    case "BUY_REAL_ESTATE":
      l.cash -= Math.round(e.downPayment * (1 - (e.investorShare ?? 0)));
      l.realEstate.push({
        id: e.id,
        name: e.name,
        cost: e.cost,
        downPayment: e.downPayment,
        mortgage: e.mortgage,
        cashFlow: e.cashFlow,
        category: e.category,
        investorShare: e.investorShare
      });
      return l;
    case "SELL_REAL_ESTATE": {
      const a = l.realEstate.find((x) => x.id === e.assetId);
      if (!a) return prev;
      const net = e.salePrice - a.mortgage;
      l.cash += a.investorShare ? Math.round(net * (1 - a.investorShare)) : net;
      l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId);
      return l;
    }
    case "BUY_BUSINESS":
      if (e.category === "partnership" && l.businesses.filter((b) => b.category === "partnership").length >= 3)
        return prev;
      l.cash -= Math.round(e.downPayment * (1 - (e.investorShare ?? 0)));
      l.businesses.push({
        id: e.id,
        name: e.name,
        cost: e.cost,
        downPayment: e.downPayment,
        liability: e.liability,
        cashFlow: e.cashFlow,
        category: e.category,
        investorShare: e.investorShare,
        growthPerPayday: e.growthPerPayday,
        growthCap: e.growthCap
      });
      return l;
    case "SELL_BUSINESS": {
      const a = l.businesses.find((x) => x.id === e.assetId);
      if (!a) return prev;
      const net = e.salePrice - a.liability;
      l.cash += a.investorShare ? Math.round(net * (1 - a.investorShare)) : net;
      l.businesses = l.businesses.filter((x) => x.id !== e.assetId);
      return l;
    }
    case "DOODAD":
    case "FT_STAKE_LOST":
    case "FT_DOWNSIZED":
      l.cash -= e.amount;
      return l;
    /**
     * Трата в долг. Кредитный режим: +3%/мес на кредитку навсегда.
     * Халяль-режим: беспроцентная рассрочка — 10 равных платежей,
     * долг гасится досрочно целиком через PAY_OFF_DEBT.
     */
    case "FINANCE_DOODAD":
      if (RULES.loansEnabled) {
        l.liabilities.creditCards += e.amount;
        l.expenses.creditCardPayment += Math.ceil(0.03 * e.amount);
      } else {
        l.liabilities.retailDebt += e.amount;
        l.expenses.retailPayment += Math.ceil(e.amount / 10);
      }
      return l;
    case "PET":
      if (l.pets >= MAX_PETS) return prev;
      l.pets += 1;
      return l;
    case "DOWNSIZED":
      l.cash -= totalExpenses(l);
      l.charityTurnsLeft = 0;
      return l;
    case "CHARITY":
      l.cash -= Math.ceil(0.1 * totalIncome(l));
      l.charityTurnsLeft = 3;
      return l;
    case "CHARITY_TURN_USED":
      l.charityTurnsLeft = Math.max(0, l.charityTurnsLeft - 1);
      return l;
    /**
     * Заём. Процентный режим: платёж 10% в месяц — это плата за деньги, вечная.
     * Халяль-режим (кард хасан): возвращаешь РОВНО столько же, десятью равными
     * платежами — платёж гасит тело долга и исчезает вместе с ним.
     */
    case "TAKE_LOAN":
      l.cash += e.amount;
      l.liabilities.bankLoan += e.amount;
      l.expenses.bankLoanPayment += e.amount / 10;
      return l;
    case "REPAY_LOAN": {
      const n = Math.min(e.amount, l.liabilities.bankLoan);
      l.cash -= n;
      l.liabilities.bankLoan -= n;
      l.expenses.bankLoanPayment -= n / 10;
      return l;
    }
    case "PAY_OFF_DEBT": {
      const balance = l.liabilities[e.debt];
      if (balance <= 0) return prev;
      l.cash -= balance;
      l.liabilities[e.debt] = 0;
      l.expenses[DEBT_TO_PAYMENT[e.debt]] = 0;
      return l;
    }
    case "ADJUST_CASH":
      l.cash += e.amount;
      return l;
    /** Продажа банку за полцены при банкротстве. */
    case "FORCED_SALE": {
      if (e.assetKind === "stock") {
        const lot = l.stocks.find((x) => x.id === e.assetId);
        if (!lot) return prev;
        l.cash += Math.floor(lot.shares * lot.costPerShare / 2);
        l.stocks = l.stocks.filter((x) => x.id !== e.assetId);
      } else if (e.assetKind === "realEstate") {
        const a = l.realEstate.find((x) => x.id === e.assetId);
        if (!a) return prev;
        l.cash += Math.floor(a.downPayment / 2);
        l.realEstate = l.realEstate.filter((x) => x.id !== e.assetId);
      } else {
        const a = l.businesses.find((x) => x.id === e.assetId);
        if (!a) return prev;
        l.cash += Math.floor(a.downPayment / 2);
        l.businesses = l.businesses.filter((x) => x.id !== e.assetId);
      }
      return l;
    }
    case "HALVE_CONSUMER_DEBT":
      l.liabilities.carLoans = Math.floor(l.liabilities.carLoans / 2);
      l.liabilities.creditCards = Math.floor(l.liabilities.creditCards / 2);
      l.liabilities.retailDebt = Math.floor(l.liabilities.retailDebt / 2);
      l.expenses.carPayment = Math.floor(l.expenses.carPayment / 2);
      l.expenses.creditCardPayment = Math.floor(l.expenses.creditCardPayment / 2);
      l.expenses.retailPayment = Math.floor(l.expenses.retailPayment / 2);
      return l;
    case "DECLARE_GAME_OVER":
      l.phase = "gameOver";
      return l;
    /**
     * Выкуп при выходе из Круга: активы выкупаются как готовый бизнес —
     * N месячных потоков (в RU-режиме 50: реалистичная оценка ~4 года прибыли).
     */
    case "ENTER_FAST_TRACK": {
      if (l.phase !== "ratRace") return prev;
      const buyout = RULES.fastTrackMultiplier * passiveIncome(l);
      l.cash += buyout;
      l.phase = "fastTrack";
      l.fastTrack = {
        beginningIncome: buyout,
        goalIncome: buyout + RULES.fastTrackTarget,
        businesses: []
      };
      return l;
    }
    case "CASHFLOW_DAY":
      if (!l.fastTrack) return prev;
      l.cash += l.fastTrack.beginningIncome + fastTrackProgress(l);
      return l;
    case "BUY_FT_BUSINESS":
      if (!l.fastTrack) return prev;
      l.cash -= e.downPayment;
      l.fastTrack.businesses.push({
        id: e.id,
        name: e.name,
        downPayment: e.downPayment,
        cashFlow: e.cashFlow
      });
      if (fastTrackProgress(l) >= RULES.fastTrackTarget) {
        l.phase = "won";
        l.winReason = "cashflowGoal";
      }
      return l;
    case "BUY_DREAM":
      if (!l.fastTrack) return prev;
      l.cash -= e.pricePaid;
      l.fastTrack.dream = { name: e.name, pricePaid: e.pricePaid };
      l.phase = "won";
      l.winReason = "dream";
      return l;
    case "TAX_AUDIT":
    case "LAWSUIT":
      l.cash -= Math.ceil(l.cash / 2);
      return l;
    /** Развод: половина наличных уходит, не всё («при разводе половину получать»). */
    case "DIVORCE":
      l.cash -= Math.ceil(l.cash / 2);
      return l;
    default:
      return prev;
  }
}

// src/data/decks.json
var decks_default = {
  SMALL_DEALS: [
    {
      kind: "stock",
      id: "sd-grit-1",
      symbol: "GRIT",
      title: "GRIT at rock bottom",
      flavor: "Warehouse-robot maker misses a quarter and the market panics. Only you may buy; everyone may sell.",
      price: 1,
      range: [
        1,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-grit-10",
      symbol: "GRIT",
      title: "GRIT drifting",
      flavor: "Quiet quarter for the robot maker. Analysts shrug.",
      price: 10,
      range: [
        1,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-grit-25",
      symbol: "GRIT",
      title: "GRIT on a run",
      flavor: "A big-box chain signs a pilot program. Momentum crowd piles in.",
      price: 25,
      range: [
        1,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-grit-40",
      symbol: "GRIT",
      title: "GRIT euphoria",
      flavor: 'Cover story: "The Robot Decade". Priced for perfection.',
      price: 40,
      range: [
        1,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-snail-5",
      symbol: "SNAIL",
      title: "SNAIL slides",
      flavor: "The parcel carrier loses a courier contract; the price crawls to a low.",
      price: 5,
      range: [
        5,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-snail-10",
      symbol: "SNAIL",
      title: "SNAIL steady",
      flavor: "Boring, dependable delivery volume. Boring, dependable price.",
      price: 10,
      range: [
        5,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-snail-20",
      symbol: "SNAIL",
      title: "SNAIL picks up pace",
      flavor: "Same-day rural delivery tests well in three states.",
      price: 20,
      range: [
        5,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-snail-30",
      symbol: "SNAIL",
      title: "SNAIL at full stretch",
      flavor: "Record volumes \u2014 and a price at the top of its historic range.",
      price: 30,
      range: [
        5,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-myco-5",
      symbol: "MYCO",
      title: "MYCO trial setback",
      flavor: "The health-lab firm delays its flagship study. Bargain hunters circle.",
      price: 5,
      range: [
        5,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-myco-15",
      symbol: "MYCO",
      title: "MYCO in the middle",
      flavor: "Mixed results, mixed feelings, middling price.",
      price: 15,
      range: [
        5,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-myco-30",
      symbol: "MYCO",
      title: "MYCO breakout",
      flavor: "Early data leaks and the street loves it.",
      price: 30,
      range: [
        5,
        40
      ]
    },
    {
      kind: "stock",
      id: "sd-zap-1",
      symbol: "ZAP",
      title: "ZAP wipeout",
      flavor: "Scooter-share operator recalls a battery batch. Near-bankruptcy pricing.",
      price: 1,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-zap-10",
      symbol: "ZAP",
      title: "ZAP recharging",
      flavor: "New city permits come through. The comeback story writes itself.",
      price: 10,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-zap-25",
      symbol: "ZAP",
      title: "ZAP mania",
      flavor: "Every corner has a scooter and every portfolio wants the stock.",
      price: 25,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-nest-10",
      symbol: "NEST",
      title: "NEST fund on sale",
      flavor: "Broad-market index fund dips with the economy. Long-term money smiles.",
      price: 10,
      range: [
        10,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-nest-25",
      symbol: "NEST",
      title: "NEST fund cruising",
      flavor: "The index grinds higher. Nothing exciting \u2014 that is the point.",
      price: 25,
      range: [
        10,
        30
      ]
    },
    {
      kind: "stock",
      id: "sd-vlt4-a",
      symbol: "VLT4",
      title: "Vault certificate, standard rate",
      flavor: "A $1,000 savings certificate paying $30 a month. Sleepy and safe.",
      price: 1e3,
      range: [
        1e3,
        1e3
      ],
      dividendPerShare: 30
    },
    {
      kind: "stock",
      id: "sd-vlt4-b",
      symbol: "VLT4",
      title: "Vault certificate, promo rate",
      flavor: "Limited-time $1,000 certificate paying $50 a month for early savers.",
      price: 1e3,
      range: [
        1e3,
        1e3
      ],
      dividendPerShare: 50
    },
    {
      kind: "realEstate",
      id: "sd-condo-1",
      title: "Foreclosed 2/1 condo",
      flavor: "Bank wants it gone this week. Tenant already lined up.",
      category: "condo2br",
      cost: 4e4,
      downPayment: 2e3,
      mortgage: 38e3,
      cashFlow: 140
    },
    {
      kind: "realEstate",
      id: "sd-condo-2",
      title: "Commuter-line condo",
      flavor: "Two bedrooms a block from the train. Rents itself.",
      category: "condo2br",
      cost: 46e3,
      downPayment: 3e3,
      mortgage: 43e3,
      cashFlow: 180
    },
    {
      kind: "realEstate",
      id: "sd-condo-3",
      title: "Poolside condo",
      flavor: "HOA fees bite \u2014 cash flow is thin, but the price is right.",
      category: "condo2br",
      cost: 36e3,
      downPayment: 1e3,
      mortgage: 35e3,
      cashFlow: -100
    },
    {
      kind: "realEstate",
      id: "sd-condo-4",
      title: "Estate-sale condo",
      flavor: "Heirs live out of state and want a fast, clean close.",
      category: "condo2br",
      cost: 42e3,
      downPayment: 2e3,
      mortgage: 4e4,
      cashFlow: 220
    },
    {
      kind: "realEstate",
      id: "sd-condo-5",
      title: "Campus-edge condo",
      flavor: "Students every fall, like clockwork.",
      category: "condo2br",
      cost: 5e4,
      downPayment: 4e3,
      mortgage: 46e3,
      cashFlow: 300
    },
    {
      kind: "realEstate",
      id: "sd-condo-6",
      title: "Downtown micro-condo",
      flavor: "Small square footage, big rental demand.",
      category: "condo2br",
      cost: 55e3,
      downPayment: 5e3,
      mortgage: 5e4,
      cashFlow: 250
    },
    {
      kind: "realEstate",
      id: "sd-house-1",
      title: "Relocation-sale 3/2",
      flavor: "Owner starts a new job across the country on Monday.",
      category: "house3br",
      cost: 55e3,
      downPayment: 3e3,
      mortgage: 52e3,
      cashFlow: 200
    },
    {
      kind: "realEstate",
      id: "sd-house-2",
      title: "Fixer 3/1 near school",
      flavor: "Cosmetic work only; families are queuing for the district.",
      category: "house3br",
      cost: 5e4,
      downPayment: 2e3,
      mortgage: 48e3,
      cashFlow: 160
    },
    {
      kind: "realEstate",
      id: "sd-house-3",
      title: "Cul-de-sac 3/2",
      flavor: "Quiet street, long-term tenant in place for two more years.",
      category: "house3br",
      cost: 65e3,
      downPayment: 4e3,
      mortgage: 61e3,
      cashFlow: 250
    },
    {
      kind: "realEstate",
      id: "sd-house-4",
      title: "Divorce-sale house",
      flavor: "Both sides just want it done. Priced under market.",
      category: "house3br",
      cost: 6e4,
      downPayment: 3e3,
      mortgage: 57e3,
      cashFlow: 300
    },
    {
      kind: "realEstate",
      id: "sd-house-5",
      title: "Riverside rental",
      flavor: "Flood insurance eats the rent \u2014 until you can sell to a dreamer.",
      category: "house3br",
      cost: 58e3,
      downPayment: 2e3,
      mortgage: 56e3,
      cashFlow: -150
    },
    {
      kind: "realEstate",
      id: "sd-house-6",
      title: "Garden-suburb 3/2",
      flavor: "Fresh paint, new roof, tenant pays on the first.",
      category: "house3br",
      cost: 75e3,
      downPayment: 5e3,
      mortgage: 7e4,
      cashFlow: 350
    },
    {
      kind: "realEstate",
      id: "sd-duplex-1",
      title: "Side-by-side duplex",
      flavor: "Two doors, two rents, one mortgage.",
      category: "duplex",
      cost: 62e3,
      downPayment: 3e3,
      mortgage: 59e3,
      cashFlow: 240
    },
    {
      kind: "realEstate",
      id: "sd-duplex-2",
      title: "Up-down duplex",
      flavor: "Retiring landlord sells his first-ever building.",
      category: "duplex",
      cost: 7e4,
      downPayment: 4e3,
      mortgage: 66e3,
      cashFlow: 320
    },
    {
      kind: "realEstate",
      id: "sd-duplex-3",
      title: "Corner-lot duplex",
      flavor: "Walk to the tram stop; never vacant more than a week.",
      category: "duplex",
      cost: 8e4,
      downPayment: 5e3,
      mortgage: 75e3,
      cashFlow: 400
    },
    {
      kind: "realEstate",
      id: "sd-duplex-4",
      title: "Auction duplex",
      flavor: "County auction special \u2014 light repairs, heavy upside.",
      category: "duplex",
      cost: 9e4,
      downPayment: 5e3,
      mortgage: 85e3,
      cashFlow: 360
    },
    {
      kind: "realEstate",
      id: "sd-land-1",
      title: "10 acres of scrubland",
      flavor: "Nothing out there but wind. For now.",
      category: "land",
      cost: 5e3,
      downPayment: 5e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "sd-land-2",
      title: "Half-acre infill lot",
      flavor: "A gap in a growing street grid.",
      category: "land",
      cost: 4e3,
      downPayment: 4e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "sd-land-3",
      title: "Lakeside parcel",
      flavor: "Too small to farm, too pretty to ignore.",
      category: "land",
      cost: 5e3,
      downPayment: 5e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "sd-land-4",
      title: "Highway-exit corner",
      flavor: "Rumor says a truck stop is coming.",
      category: "land",
      cost: 3e3,
      downPayment: 3e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "business",
      id: "sd-biz-1",
      title: "Vending machine route",
      flavor: "Twelve machines in office lobbies. Quarters add up.",
      category: "localBiz",
      cost: 5e3,
      downPayment: 1e3,
      liability: 4e3,
      cashFlow: 100
    },
    {
      kind: "business",
      id: "sd-biz-2",
      title: "Weekend market stall",
      flavor: "A friend runs it; you bankroll it and split the till.",
      category: "localBiz",
      cost: 3e3,
      downPayment: 3e3,
      liability: 0,
      cashFlow: 50
    },
    {
      kind: "business",
      id: "sd-part-1",
      title: "Food-truck partnership",
      flavor: "Your college roommate can cook. Buy a quarter of the truck.",
      category: "partnership",
      cost: 5e3,
      downPayment: 5e3,
      liability: 0,
      cashFlow: 0
    },
    {
      kind: "business",
      id: "sd-part-2",
      title: "App-studio seed stake",
      flavor: "Two coders, one garage, zero revenue \u2014 yet.",
      category: "partnership",
      cost: 4e3,
      downPayment: 4e3,
      liability: 0,
      cashFlow: 0
    }
  ],
  BIG_DEALS: [
    {
      kind: "realEstate",
      id: "bd-4plex-1",
      title: "Brickyard 4-plex",
      flavor: "Solid brick, boring tenants, beautiful ledger.",
      category: "fourplex",
      cost: 9e4,
      downPayment: 8e3,
      mortgage: 82e3,
      cashFlow: 320
    },
    {
      kind: "realEstate",
      id: "bd-4plex-2",
      title: "Transit-corner 4-plex",
      flavor: "Bus line out front, waiting list out back.",
      category: "fourplex",
      cost: 11e4,
      downPayment: 11e3,
      mortgage: 99e3,
      cashFlow: 450
    },
    {
      kind: "realEstate",
      id: "bd-4plex-3",
      title: "Retiree\u2019s 4-plex",
      flavor: "Owner-managed for 30 years; rents are far below market.",
      category: "fourplex",
      cost: 12e4,
      downPayment: 12e3,
      mortgage: 108e3,
      cashFlow: 500
    },
    {
      kind: "realEstate",
      id: "bd-4plex-4",
      title: "Storm-damage 4-plex",
      flavor: "Insurance fixed the roof; the discount stayed.",
      category: "fourplex",
      cost: 1e5,
      downPayment: 1e4,
      mortgage: 9e4,
      cashFlow: 400
    },
    {
      kind: "realEstate",
      id: "bd-4plex-5",
      title: "Millwork-district 4-plex",
      flavor: "The neighborhood is turning; get in before it does.",
      category: "fourplex",
      cost: 14e4,
      downPayment: 16e3,
      mortgage: 124e3,
      cashFlow: 600
    },
    {
      kind: "realEstate",
      id: "bd-4plex-6",
      title: "Twin-lot 4-plex",
      flavor: "Comes with a buildable side lot the seller forgot to price.",
      category: "fourplex",
      cost: 16e4,
      downPayment: 24e3,
      mortgage: 136e3,
      cashFlow: 700
    },
    {
      kind: "realEstate",
      id: "bd-8plex-1",
      title: "Courtyard 8-plex",
      flavor: "Eight doors around a shared garden. Tenants stay for years.",
      category: "eightplex",
      cost: 16e4,
      downPayment: 16e3,
      mortgage: 144e3,
      cashFlow: 700
    },
    {
      kind: "realEstate",
      id: "bd-8plex-2",
      title: "Estate-liquidation 8-plex",
      flavor: "The family wants probate finished by spring.",
      category: "eightplex",
      cost: 18e4,
      downPayment: 18e3,
      mortgage: 162e3,
      cashFlow: 850
    },
    {
      kind: "realEstate",
      id: "bd-8plex-3",
      title: "Nurse-quarter 8-plex",
      flavor: "Across from the hospital. Shift workers, steady rent.",
      category: "eightplex",
      cost: 22e4,
      downPayment: 24e3,
      mortgage: 196e3,
      cashFlow: 1100
    },
    {
      kind: "realEstate",
      id: "bd-8plex-4",
      title: "Refit 8-plex",
      flavor: "New plumbing, new wiring, new rents \u2014 old price.",
      category: "eightplex",
      cost: 24e4,
      downPayment: 28e3,
      mortgage: 212e3,
      cashFlow: 1300
    },
    {
      kind: "realEstate",
      id: "bd-8plex-5",
      title: "Two-building 8-plex",
      flavor: "Four and four across the street from each other.",
      category: "eightplex",
      cost: 26e4,
      downPayment: 32e3,
      mortgage: 228e3,
      cashFlow: 1500
    },
    {
      kind: "realEstate",
      id: "bd-8plex-6",
      title: "Riverfront 8-plex",
      flavor: "Views on the top floor pay for the whole building.",
      category: "eightplex",
      cost: 28e4,
      downPayment: 4e4,
      mortgage: 24e4,
      cashFlow: 1700
    },
    {
      kind: "realEstate",
      id: "bd-apts-1",
      title: "12-unit walk-up",
      flavor: "A tired manager and twelve leases ready for market rents.",
      category: "aptSmall",
      cost: 25e4,
      downPayment: 25e3,
      mortgage: 225e3,
      cashFlow: 1300
    },
    {
      kind: "realEstate",
      id: "bd-apts-2",
      title: "16-unit college block",
      flavor: "Two blocks from the lecture halls. Pre-leased every March.",
      category: "aptSmall",
      cost: 3e5,
      downPayment: 32e3,
      mortgage: 268e3,
      cashFlow: 1600
    },
    {
      kind: "realEstate",
      id: "bd-apts-3",
      title: "18-unit garden complex",
      flavor: "Out-of-state owner never raised a rent in a decade.",
      category: "aptSmall",
      cost: 34e4,
      downPayment: 4e4,
      mortgage: 3e5,
      cashFlow: 1900
    },
    {
      kind: "realEstate",
      id: "bd-apts-4",
      title: "20-unit brick mid-rise",
      flavor: "The elevator squeaks; the cash flow doesn\u2019t.",
      category: "aptSmall",
      cost: 38e4,
      downPayment: 48e3,
      mortgage: 332e3,
      cashFlow: 2200
    },
    {
      kind: "realEstate",
      id: "bd-apts-5",
      title: "24-unit bank repo",
      flavor: "The lender is not in the landlord business. You could be.",
      category: "aptSmall",
      cost: 42e4,
      downPayment: 55e3,
      mortgage: 365e3,
      cashFlow: 2600
    },
    {
      kind: "realEstate",
      id: "bd-apts-6",
      title: "14-unit conversion",
      flavor: "Old schoolhouse, new lofts, long waiting list.",
      category: "aptSmall",
      cost: 28e4,
      downPayment: 3e4,
      mortgage: 25e4,
      cashFlow: 1400
    },
    {
      kind: "realEstate",
      id: "bd-aptl-1",
      title: "30-unit portfolio piece",
      flavor: "A fund is rebalancing and needs this off the books.",
      category: "aptLarge",
      cost: 35e4,
      downPayment: 4e4,
      mortgage: 31e4,
      cashFlow: 1800
    },
    {
      kind: "realEstate",
      id: "bd-aptl-2",
      title: "36-unit twin towers",
      flavor: "Two mirrored buildings, one on-site manager.",
      category: "aptLarge",
      cost: 42e4,
      downPayment: 48e3,
      mortgage: 372e3,
      cashFlow: 2300
    },
    {
      kind: "realEstate",
      id: "bd-aptl-3",
      title: "44-unit rail-yard lofts",
      flavor: "The neighborhood got cool faster than the seller noticed.",
      category: "aptLarge",
      cost: 48e4,
      downPayment: 52e3,
      mortgage: 428e3,
      cashFlow: 2800
    },
    {
      kind: "realEstate",
      id: "bd-aptl-4",
      title: "52-unit sunbelt complex",
      flavor: "Pools, palms, and fifty-two rent checks.",
      category: "aptLarge",
      cost: 52e4,
      downPayment: 56e3,
      mortgage: 464e3,
      cashFlow: 3100
    },
    {
      kind: "realEstate",
      id: "bd-aptl-5",
      title: "60-unit distressed sale",
      flavor: "Partnership dissolved in court; the judge wants a sale.",
      category: "aptLarge",
      cost: 55e4,
      downPayment: 6e4,
      mortgage: 49e4,
      cashFlow: 3400
    },
    {
      kind: "realEstate",
      id: "bd-aptl-6",
      title: "40-unit garden estate",
      flavor: "Long leases, low turnover, lovely numbers.",
      category: "aptLarge",
      cost: 45e4,
      downPayment: 5e4,
      mortgage: 4e5,
      cashFlow: 2500
    },
    {
      kind: "business",
      id: "bd-fran-1",
      title: "Burger franchise, tier-2 corner",
      flavor: "A national brand on a growing intersection. The manual runs itself.",
      category: "franchise",
      cost: 12e4,
      downPayment: 2e4,
      liability: 1e5,
      cashFlow: 800
    },
    {
      kind: "business",
      id: "bd-fran-2",
      title: "Coffee franchise, station kiosk",
      flavor: "Commuters queue before the shutters open.",
      category: "franchise",
      cost: 9e4,
      downPayment: 15e3,
      liability: 75e3,
      cashFlow: 600
    },
    {
      kind: "business",
      id: "bd-fran-3",
      title: "Gym franchise, strip mall",
      flavor: "January pays for the year.",
      category: "franchise",
      cost: 18e4,
      downPayment: 3e4,
      liability: 15e4,
      cashFlow: 1200
    },
    {
      kind: "business",
      id: "bd-fran-4",
      title: "Tax-prep franchise pair",
      flavor: "Two storefronts, one busy season, zero drama.",
      category: "franchise",
      cost: 15e4,
      downPayment: 25e3,
      liability: 125e3,
      cashFlow: 1e3
    },
    {
      kind: "business",
      id: "bd-fran-5",
      title: "Sandwich franchise flagship",
      flavor: "Best foot traffic in the food court.",
      category: "franchise",
      cost: 24e4,
      downPayment: 45e3,
      liability: 195e3,
      cashFlow: 1900
    },
    {
      kind: "business",
      id: "bd-fran-6",
      title: "Childcare franchise campus",
      flavor: "Licensed, staffed, and full through next year.",
      category: "franchise",
      cost: 32e4,
      downPayment: 75e3,
      liability: 245e3,
      cashFlow: 2800
    },
    {
      kind: "business",
      id: "bd-biz-1",
      title: "Automated car wash",
      flavor: "Machines wash, cameras watch, card readers collect.",
      category: "localBiz",
      cost: 18e4,
      downPayment: 35e3,
      liability: 145e3,
      cashFlow: 1500
    },
    {
      kind: "business",
      id: "bd-biz-2",
      title: "Self-storage yard",
      flavor: "Rows of orange doors and almost no payroll.",
      category: "localBiz",
      cost: 22e4,
      downPayment: 4e4,
      liability: 18e4,
      cashFlow: 1800
    },
    {
      kind: "business",
      id: "bd-biz-3",
      title: "Coin laundry, double location",
      flavor: "Quarters by the bucket in two neighborhoods.",
      category: "localBiz",
      cost: 13e4,
      downPayment: 22e3,
      liability: 108e3,
      cashFlow: 900
    },
    {
      kind: "business",
      id: "bd-biz-4",
      title: "Billboard mini-network",
      flavor: "Six boards on two highways, leased through next year.",
      category: "localBiz",
      cost: 1e5,
      downPayment: 18e3,
      liability: 82e3,
      cashFlow: 750
    },
    {
      kind: "business",
      id: "bd-part-1",
      title: "Limited partnership: mini-mall",
      flavor: "You put up capital; the operator does the rest. Paper asset, real checks.",
      category: "partnership",
      cost: 6e4,
      downPayment: 12e3,
      liability: 48e3,
      cashFlow: 500
    },
    {
      kind: "business",
      id: "bd-part-2",
      title: "Limited partnership: drilling fund",
      flavor: "High risk, high distributions while the wells flow.",
      category: "partnership",
      cost: 8e4,
      downPayment: 16e3,
      liability: 64e3,
      cashFlow: 700
    }
  ],
  OFFSHORE_SMALL_DEALS: [
    {
      kind: "stock",
      id: "oc-shib-1",
      symbol: "SHIB",
      title: "SHIB rug-pull panic",
      flavor: "A copycat token rugged and the whole kennel gets sold off. Only you may buy; everyone may sell.",
      price: 1,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "oc-shib-8",
      symbol: "SHIB",
      title: "SHIB sideways",
      flavor: "The chart is a flatline; the community calls it accumulation.",
      price: 8,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "oc-shib-20",
      symbol: "SHIB",
      title: "SHIB influencer pump",
      flavor: "A celebrity posts one dog photo. Volume goes vertical.",
      price: 20,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "oc-shib-30",
      symbol: "SHIB",
      title: "SHIB to the moon",
      flavor: "Number go up. Everyone is a genius. Priced for the moon landing.",
      price: 30,
      range: [
        1,
        30
      ]
    },
    {
      kind: "stock",
      id: "oc-pepe-1",
      symbol: "PEPE",
      title: "PEPE bear market",
      flavor: "The meme is dead, they say. Memes have nine lives.",
      price: 1,
      range: [
        1,
        25
      ]
    },
    {
      kind: "stock",
      id: "oc-pepe-10",
      symbol: "PEPE",
      title: "PEPE meme season",
      flavor: "Feels good, man \u2014 the timeline is green again.",
      price: 10,
      range: [
        1,
        25
      ]
    },
    {
      kind: "stock",
      id: "oc-pepe-18",
      symbol: "PEPE",
      title: "PEPE viral again",
      flavor: "A fresh template sweeps the internet; the token tags along.",
      price: 18,
      range: [
        1,
        25
      ]
    },
    {
      kind: "stock",
      id: "oc-pepe-25",
      symbol: "PEPE",
      title: "PEPE euphoria",
      flavor: "Top of the range, top of the timeline.",
      price: 25,
      range: [
        1,
        25
      ]
    },
    {
      kind: "stock",
      id: "oc-doge-2",
      symbol: "DOGE",
      title: "DOGE forgotten",
      flavor: "The original meme coin naps between cycles. Much quiet.",
      price: 2,
      range: [
        2,
        40
      ]
    },
    {
      kind: "stock",
      id: "oc-doge-15",
      symbol: "DOGE",
      title: "DOGE tweet bump",
      flavor: "A billionaire posts a shiba in a hard hat. Up 40% by lunch.",
      price: 15,
      range: [
        2,
        40
      ]
    },
    {
      kind: "stock",
      id: "oc-doge-40",
      symbol: "DOGE",
      title: "DOGE mania",
      flavor: "Taxi drivers give price targets. Historic top territory.",
      price: 40,
      range: [
        2,
        40
      ]
    },
    {
      kind: "stock",
      id: "oc-bonk-1",
      symbol: "BONK",
      title: "BONK dust",
      flavor: "Down 95% from the top. The faithful call it a gift.",
      price: 1,
      range: [
        1,
        20
      ]
    },
    {
      kind: "stock",
      id: "oc-bonk-6",
      symbol: "BONK",
      title: "BONK drifting",
      flavor: "Airdropped, dumped, forgotten \u2014 and quietly building.",
      price: 6,
      range: [
        1,
        20
      ]
    },
    {
      kind: "stock",
      id: "oc-bonk-20",
      symbol: "BONK",
      title: "BONK exchange listing",
      flavor: "A top exchange lists it and the dog gets its day.",
      price: 20,
      range: [
        1,
        20
      ]
    },
    {
      kind: "stock",
      id: "oc-wif-5",
      symbol: "WIF",
      title: "WIF quiet accumulation",
      flavor: "Just a dog wif a hat, waiting for its moment.",
      price: 5,
      range: [
        2,
        35
      ]
    },
    {
      kind: "stock",
      id: "oc-wif-35",
      symbol: "WIF",
      title: "WIF hat season",
      flavor: "The hat stays on. All-time-high territory.",
      price: 35,
      range: [
        2,
        35
      ]
    },
    {
      kind: "stock",
      id: "oc-usdr-a",
      symbol: "USDR",
      title: "Stablecoin vault, standard APY",
      flavor: "A $1,000 stablecoin position staking $30 a month. The boring corner of crypto.",
      price: 1e3,
      range: [
        1e3,
        1e3
      ],
      dividendPerShare: 30
    },
    {
      kind: "stock",
      id: "oc-usdr-b",
      symbol: "USDR",
      title: "Stablecoin vault, promo APY",
      flavor: "A launch-promo vault paying $50 a month per $1,000 staked. Read the fine print twice.",
      price: 1e3,
      range: [
        1e3,
        1e3
      ],
      dividendPerShare: 50
    },
    {
      kind: "realEstate",
      id: "os-mvd-1",
      title: "Pocitos studio, Montevideo",
      flavor: "Two blocks from the Rambla; nurses and students split the lease.",
      category: "aptMVD",
      cost: 38e3,
      downPayment: 2e3,
      mortgage: 36e3,
      cashFlow: 220
    },
    {
      kind: "realEstate",
      id: "os-mvd-2",
      title: "Ciudad Vieja loft, Montevideo",
      flavor: "Colonial beams, port cranes in the window, weekend markets below.",
      category: "aptMVD",
      cost: 32e3,
      downPayment: 1e3,
      mortgage: 31e3,
      cashFlow: 180
    },
    {
      kind: "realEstate",
      id: "os-mvd-3",
      title: "Cord\xF3n student flat, Montevideo",
      flavor: "Three universities within walking distance; the leases never lapse.",
      category: "aptMVD",
      cost: 28e3,
      downPayment: 1e3,
      mortgage: 27e3,
      cashFlow: 160
    },
    {
      kind: "realEstate",
      id: "os-mvd-4",
      title: "Carrasco garden flat, Montevideo",
      flavor: "Tree-lined embassy streets; corporate tenants pay on the first.",
      category: "aptMVD",
      cost: 48e3,
      downPayment: 4e3,
      mortgage: 44e3,
      cashFlow: 260
    },
    {
      kind: "realEstate",
      id: "os-mvd-5",
      title: "Tres Cruces transit flat, Montevideo",
      flavor: "Every long-distance bus stops downstairs; crews need beds, not balconies.",
      category: "aptMVD",
      cost: 26e3,
      downPayment: 1e3,
      mortgage: 25e3,
      cashFlow: 150
    },
    {
      kind: "realEstate",
      id: "os-mvd-6",
      title: "Punta Carretas tower unit, Montevideo",
      flavor: "Mall and fortress views; the tower rose faster than tenants.",
      category: "aptMVD",
      cost: 45e3,
      downPayment: 3e3,
      mortgage: 42e3,
      cashFlow: -150
    },
    {
      kind: "realEstate",
      id: "os-mvd-7",
      title: "Palermo walk-up, Montevideo",
      flavor: "Caf\xE9 terraces below, Art Deco fa\xE7ades above; young professionals queue.",
      category: "aptMVD",
      cost: 4e4,
      downPayment: 3e3,
      mortgage: 37e3,
      cashFlow: 240
    },
    {
      kind: "realEstate",
      id: "os-mvd-8",
      title: "Centro shophouse flat, Montevideo",
      flavor: "Above the pedestrian Avenida 18; lunch crowds keep the street loud.",
      category: "aptMVD",
      cost: 3e4,
      downPayment: 2e3,
      mortgage: 28e3,
      cashFlow: 200
    },
    {
      kind: "realEstate",
      id: "os-mvd-9",
      title: "Malv\xEDn seafront flat, Montevideo",
      flavor: "Rambla sunsets and quiet weeknights; families renew every year.",
      category: "aptMVD",
      cost: 42e3,
      downPayment: 2e3,
      mortgage: 4e4,
      cashFlow: 180
    },
    {
      kind: "realEstate",
      id: "os-mvd-10",
      title: "Prado park-view flat, Montevideo",
      flavor: "Museums and rose gardens next door; retirees never leave.",
      category: "aptMVD",
      cost: 34e3,
      downPayment: 2e3,
      mortgage: 32e3,
      cashFlow: 190
    },
    {
      kind: "realEstate",
      id: "os-pde-1",
      title: "Peninsula studio, Punta del Este",
      flavor: "Between Playa Brava and Mansa; January books itself.",
      category: "aptPDE",
      cost: 55e3,
      downPayment: 4e3,
      mortgage: 51e3,
      cashFlow: 250
    },
    {
      kind: "realEstate",
      id: "os-pde-2",
      title: "Gorlero walk-up, Punta del Este",
      flavor: "Main strip nightlife below; summer rates beat annual leases.",
      category: "aptPDE",
      cost: 48e3,
      downPayment: 3e3,
      mortgage: 45e3,
      cashFlow: 230
    },
    {
      kind: "realEstate",
      id: "os-pde-3",
      title: "La Mansa sea-view condo",
      flavor: "Calm-water side; families from Buenos Aires fill December.",
      category: "aptPDE",
      cost: 62e3,
      downPayment: 5e3,
      mortgage: 57e3,
      cashFlow: 270
    },
    {
      kind: "realEstate",
      id: "os-pde-4",
      title: "Brava tower unit, Punta del Este",
      flavor: "Surf and wind; three new towers chased the same view \u2014 yours waits for a tenant.",
      category: "aptPDE",
      cost: 52e3,
      downPayment: 2e3,
      mortgage: 5e4,
      cashFlow: -120
    },
    {
      kind: "realEstate",
      id: "os-pde-5",
      title: "Aidy Grill flat, Punta del Este",
      flavor: "Restaurant row at the door; chefs and waitstaff share the building.",
      category: "aptPDE",
      cost: 44e3,
      downPayment: 3e3,
      mortgage: 41e3,
      cashFlow: 200
    },
    {
      kind: "realEstate",
      id: "os-pde-6",
      title: "San Rafael park flat, Punta del Este",
      flavor: "Golf greens and pines; winter is quiet, summer is sold out.",
      category: "aptPDE",
      cost: 46e3,
      downPayment: 3e3,
      mortgage: 43e3,
      cashFlow: 210
    },
    {
      kind: "realEstate",
      id: "os-pde-7",
      title: "La Barra loft, Punta del Este",
      flavor: "Bridge traffic and beach clubs; artists and influencers pay weekly.",
      category: "aptPDE",
      cost: 58e3,
      downPayment: 5e3,
      mortgage: 53e3,
      cashFlow: 260
    },
    {
      kind: "realEstate",
      id: "os-pde-8",
      title: "Punta Ballena cliff studio",
      flavor: "Casapueblo silhouette in the window; the Atlantic fills the rest.",
      category: "aptPDE",
      cost: 5e4,
      downPayment: 4e3,
      mortgage: 46e3,
      cashFlow: 240
    },
    {
      kind: "realEstate",
      id: "os-vil-1",
      title: "La Barra beach cottage",
      flavor: "Eucalyptus shade, sand in the hall, January bookings full.",
      category: "villaPDE",
      cost: 85e3,
      downPayment: 12e3,
      mortgage: 73e3,
      cashFlow: 400
    },
    {
      kind: "realEstate",
      id: "os-vil-2",
      title: "Cantegril garden house",
      flavor: "Club membership next door sells the address by itself.",
      category: "villaPDE",
      cost: 95e3,
      downPayment: 14e3,
      mortgage: 81e3,
      cashFlow: 450
    },
    {
      kind: "realEstate",
      id: "os-vil-3",
      title: "Manantiales weekender",
      flavor: "Halfway to Jos\xE9 Ignacio; the beach path is the amenity.",
      category: "villaPDE",
      cost: 78e3,
      downPayment: 1e4,
      mortgage: 68e3,
      cashFlow: 350
    },
    {
      kind: "realEstate",
      id: "os-vil-4",
      title: "Pinares pine-lot house",
      flavor: "Quiet pines, short walk to Brava; winter CF is a hope, not a plan.",
      category: "villaPDE",
      cost: 7e4,
      downPayment: 8e3,
      mortgage: 62e3,
      cashFlow: -80
    },
    {
      kind: "realEstate",
      id: "os-land-1",
      title: "5 ha of Colonia pasture",
      flavor: "Green fence posts and horizon. The dairy trucks pass twice a day.",
      category: "landUY",
      cost: 3e3,
      downPayment: 3e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-2",
      title: "10 ha off Ruta 5, Florida",
      flavor: "Dairy country asphalt reached this kilometre last year.",
      category: "landUY",
      cost: 5e3,
      downPayment: 5e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-3",
      title: "Rocha coast scrub lot",
      flavor: "Dunes and wind; beach cabins creep closer every summer.",
      category: "landUY",
      cost: 4e3,
      downPayment: 4e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-4",
      title: "20 ha, no road, Tacuaremb\xF3",
      flavor: "Priced by the map, not by the mud.",
      category: "landUY",
      cost: 2e3,
      downPayment: 2e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-5",
      title: "Citrus corner, Salto",
      flavor: "Orange groves and hot springs tourism share the valley.",
      category: "landUY",
      cost: 5e3,
      downPayment: 5e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-6",
      title: "Border lot, Rivera",
      flavor: "Free-shop traffic parks on anything flat.",
      category: "landUY",
      cost: 5e3,
      downPayment: 5e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-7",
      title: "Hillside hectare, Maldonado",
      flavor: "Punta del Este lights glow on the horizon at night.",
      category: "landUY",
      cost: 6e3,
      downPayment: 6e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-land-8",
      title: "Lagoon-edge plot, Castillos",
      flavor: "Birdwatchers already know the access track.",
      category: "landUY",
      cost: 4e3,
      downPayment: 4e3,
      mortgage: 0,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "os-dair-1",
      title: "20-cow starter herd, San Jos\xE9",
      flavor: "A neighbour milks them; you bank the co-op cheque.",
      category: "dairyUY",
      cost: 35e3,
      downPayment: 8e3,
      mortgage: 27e3,
      cashFlow: 280
    },
    {
      kind: "realEstate",
      id: "os-dair-2",
      title: "Heifer lot, Canelones",
      flavor: "Young stock growing into production; the silage is already paid.",
      category: "dairyUY",
      cost: 28e3,
      downPayment: 6e3,
      mortgage: 22e3,
      cashFlow: 200
    },
    {
      kind: "realEstate",
      id: "os-dair-3",
      title: "Milk-share barn, Florida",
      flavor: "Half the tank goes to Conaprole; half the rent comes to you.",
      category: "dairyUY",
      cost: 42e3,
      downPayment: 9e3,
      mortgage: 33e3,
      cashFlow: 320
    },
    {
      kind: "realEstate",
      id: "os-dair-4",
      title: "Pasture lease with 40 head, Colonia",
      flavor: "The lease runs through next spring; the cows stay put.",
      category: "dairyUY",
      cost: 48e3,
      downPayment: 1e4,
      mortgage: 38e3,
      cashFlow: 350
    },
    {
      kind: "realEstate",
      id: "os-dair-5",
      title: "Cheese-room cottage dairy, Colonia",
      flavor: "Tourists buy wheels at the gate; the milk never leaves the farm.",
      category: "dairyUY",
      cost: 55e3,
      downPayment: 12e3,
      mortgage: 43e3,
      cashFlow: 400
    },
    {
      kind: "realEstate",
      id: "os-dair-6",
      title: "Dry-cow holding pens, Durazno",
      flavor: "Not milking yet \u2014 but the next calving season is sold forward.",
      category: "dairyUY",
      cost: 3e4,
      downPayment: 5e3,
      mortgage: 25e3,
      cashFlow: 150
    }
  ],
  OFFSHORE_BIG_DEALS: [
    {
      kind: "realEstate",
      id: "ob-mvd-1",
      title: "Six-flat walk-up, Cord\xF3n",
      flavor: "Student caf\xE9s below push rents up every semester.",
      category: "aptMVD",
      cost: 95e3,
      downPayment: 9e3,
      mortgage: 86e3,
      cashFlow: 420
    },
    {
      kind: "realEstate",
      id: "ob-mvd-2",
      title: "Ciudad Vieja boutique block",
      flavor: "Twelve keys above the port market, one caretaker below.",
      category: "aptMVD",
      cost: 12e4,
      downPayment: 12e3,
      mortgage: 108e3,
      cashFlow: 550
    },
    {
      kind: "realEstate",
      id: "ob-mvd-3",
      title: "Pocitos serviced floor",
      flavor: "Eight furnished flats leased whole to a tech campus.",
      category: "aptMVD",
      cost: 15e4,
      downPayment: 15e3,
      mortgage: 135e3,
      cashFlow: 700
    },
    {
      kind: "realEstate",
      id: "ob-mvd-4",
      title: "Rambla boutique block, Montevideo",
      flavor: "The seafront lease pays the mortgage by itself on summer weekends.",
      category: "aptMVD",
      cost: 18e4,
      downPayment: 18e3,
      mortgage: 162e3,
      cashFlow: 850
    },
    {
      kind: "realEstate",
      id: "ob-mvd-5",
      title: "Eight-flat block, Palermo",
      flavor: "New coworking space across the street; a waiting list is forming.",
      category: "aptMVD",
      cost: 2e5,
      downPayment: 22e3,
      mortgage: 178e3,
      cashFlow: 1e3
    },
    {
      kind: "realEstate",
      id: "ob-mvd-6",
      title: "Punta Carretas tower floor",
      flavor: "The mall district overbuilt; the discount didn\u2019t.",
      category: "aptMVD",
      cost: 9e4,
      downPayment: 8e3,
      mortgage: 82e3,
      cashFlow: 300
    },
    {
      kind: "realEstate",
      id: "ob-mvd-7",
      title: "Carrasco embassy block",
      flavor: "Diplomatic leases: paid in full, on the first.",
      category: "aptMVD",
      cost: 28e4,
      downPayment: 34e3,
      mortgage: 246e3,
      cashFlow: 1500
    },
    {
      kind: "realEstate",
      id: "ob-mvd-8",
      title: "Airport-corridor block, Carrasco",
      flavor: "Crew contracts with two airlines on three-year terms.",
      category: "aptMVD",
      cost: 24e4,
      downPayment: 28e3,
      mortgage: 212e3,
      cashFlow: 1200
    },
    {
      kind: "realEstate",
      id: "ob-mvd-9",
      title: "Student block near Udelar",
      flavor: "Two campuses within bus distance; never a vacancy.",
      category: "aptMVD",
      cost: 13e4,
      downPayment: 13e3,
      mortgage: 117e3,
      cashFlow: 600
    },
    {
      kind: "realEstate",
      id: "ob-mvd-10",
      title: "Independencia square heritage floor",
      flavor: "Six flats along the colonial arcade facing the square.",
      category: "aptMVD",
      cost: 105e3,
      downPayment: 1e4,
      mortgage: 95e3,
      cashFlow: 480
    },
    {
      kind: "realEstate",
      id: "ob-mvd-11",
      title: "Malv\xEDn seafront floor",
      flavor: "Rambla joggers at dawn, skyline lights at dusk.",
      category: "aptMVD",
      cost: 16e4,
      downPayment: 16e3,
      mortgage: 144e3,
      cashFlow: 750
    },
    {
      kind: "realEstate",
      id: "ob-pde-1",
      title: "Serviced floor, Gorlero",
      flavor: "Six suites over the shopping strip; January never stops.",
      category: "aptPDE",
      cost: 26e4,
      downPayment: 3e4,
      mortgage: 23e4,
      cashFlow: 1300
    },
    {
      kind: "realEstate",
      id: "ob-pde-2",
      title: "Peninsula tower floor",
      flavor: "Brava on one side, Mansa on the other; the view sells itself.",
      category: "aptPDE",
      cost: 22e4,
      downPayment: 24e3,
      mortgage: 196e3,
      cashFlow: 1100
    },
    {
      kind: "realEstate",
      id: "ob-pde-3",
      title: "Condo block, Aidy Grill",
      flavor: "Restaurant row and beach access; corporate summer leases only.",
      category: "aptPDE",
      cost: 32e4,
      downPayment: 38e3,
      mortgage: 282e3,
      cashFlow: 1700
    },
    {
      kind: "realEstate",
      id: "ob-pde-4",
      title: "Brava oversupply floor",
      flavor: "Towers outnumbered tenants last winter; the discount is the amenity.",
      category: "aptPDE",
      cost: 18e4,
      downPayment: 18e3,
      mortgage: 162e3,
      cashFlow: 700
    },
    {
      kind: "realEstate",
      id: "ob-pde-5",
      title: "La Barra block",
      flavor: "Six flats over the bridge road; influencers renew weekly in season.",
      category: "aptPDE",
      cost: 14e4,
      downPayment: 14e3,
      mortgage: 126e3,
      cashFlow: 650
    },
    {
      kind: "realEstate",
      id: "ob-pde-6",
      title: "San Rafael beachfront block",
      flavor: "Golf and pines; the man-made calm finally has year-round bookings.",
      category: "aptPDE",
      cost: 2e5,
      downPayment: 22e3,
      mortgage: 178e3,
      cashFlow: 950
    },
    {
      kind: "realEstate",
      id: "ob-pde-7",
      title: "Porto tower serviced floor",
      flavor: "Marina berths downstairs; every yacht club member has a key upstairs.",
      category: "aptPDE",
      cost: 29e4,
      downPayment: 34e3,
      mortgage: 256e3,
      cashFlow: 1500
    },
    {
      kind: "realEstate",
      id: "ob-pde-8",
      title: "Punta Shopping corridor block",
      flavor: "Mall traffic fills short-lets; winter still needs a discount.",
      category: "aptPDE",
      cost: 17e4,
      downPayment: 17e3,
      mortgage: 153e3,
      cashFlow: 800
    },
    {
      kind: "realEstate",
      id: "ob-pde-9",
      title: "La Mansa family towers",
      flavor: "Forty beds in the calm-water catchment of two schools.",
      category: "aptPDE",
      cost: 21e4,
      downPayment: 24e3,
      mortgage: 186e3,
      cashFlow: 1e3
    },
    {
      kind: "realEstate",
      id: "ob-pde-10",
      title: "Roosevelt avenue floor",
      flavor: "Retail below, serviced flats above, casino lights down the road.",
      category: "aptPDE",
      cost: 19e4,
      downPayment: 2e4,
      mortgage: 17e4,
      cashFlow: 900
    },
    {
      kind: "realEstate",
      id: "ob-vil-1",
      title: "Jos\xE9 Ignacio beach villa",
      flavor: "Dunes, glass walls, and a waiting list of January guests.",
      category: "villaPDE",
      cost: 38e4,
      downPayment: 55e3,
      mortgage: 325e3,
      cashFlow: 1800
    },
    {
      kind: "realEstate",
      id: "ob-vil-2",
      title: "La Barra compound",
      flavor: "Three cottages on one lot; the beach path is private.",
      category: "villaPDE",
      cost: 32e4,
      downPayment: 45e3,
      mortgage: 275e3,
      cashFlow: 1500
    },
    {
      kind: "realEstate",
      id: "ob-vil-3",
      title: "Cantegril estate villa",
      flavor: "Club greens out the kitchen window; the membership sells the house.",
      category: "villaPDE",
      cost: 42e4,
      downPayment: 6e4,
      mortgage: 36e4,
      cashFlow: 2e3
    },
    {
      kind: "realEstate",
      id: "ob-vil-4",
      title: "Punta Ballena cliff house",
      flavor: "Casapueblo\u2019s neighbour; the Atlantic is the backyard.",
      category: "villaPDE",
      cost: 35e4,
      downPayment: 5e4,
      mortgage: 3e5,
      cashFlow: 1600
    },
    {
      kind: "realEstate",
      id: "ob-vil-5",
      title: "Manantiales modern villa",
      flavor: "Architect-designed box on the sand; magazine shoots pay the winter.",
      category: "villaPDE",
      cost: 3e5,
      downPayment: 42e3,
      mortgage: 258e3,
      cashFlow: 1400
    },
    {
      kind: "realEstate",
      id: "ob-vil-6",
      title: "Beverly Hills Punta villa",
      flavor: "Quiet pines, high hedges; Argentine families book years ahead.",
      category: "villaPDE",
      cost: 28e4,
      downPayment: 38e3,
      mortgage: 242e3,
      cashFlow: 1300
    },
    {
      kind: "realEstate",
      id: "ob-vil-7",
      title: "Laguna del Sauce lakefront house",
      flavor: "Airport ten minutes away; water-skis in the shed.",
      category: "villaPDE",
      cost: 24e4,
      downPayment: 32e3,
      mortgage: 208e3,
      cashFlow: 1100
    },
    {
      kind: "realEstate",
      id: "ob-vil-8",
      title: "Trophy empty villa, Jos\xE9 Ignacio",
      flavor: "Priced like art, rented like hope \u2014 CF waits for the right summer.",
      category: "villaPDE",
      cost: 45e4,
      downPayment: 7e4,
      mortgage: 38e4,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "ob-land-1",
      title: "120 ha soy lease, Soriano",
      flavor: "A neighbour farms it; you bank the rent.",
      category: "landUY",
      cost: 6e4,
      downPayment: 12e3,
      mortgage: 48e3,
      cashFlow: 400
    },
    {
      kind: "realEstate",
      id: "ob-land-2",
      title: "300 ha with cattle lease, Paysand\xFA",
      flavor: "The lease runs through next dry season.",
      category: "landUY",
      cost: 9e4,
      downPayment: 15e3,
      mortgage: 75e3,
      cashFlow: 500
    },
    {
      kind: "realEstate",
      id: "ob-land-3",
      title: "River-port acreage, Nueva Palmira",
      flavor: "Grain barges queue here when the river runs high.",
      category: "landUY",
      cost: 13e4,
      downPayment: 2e4,
      mortgage: 11e4,
      cashFlow: 600
    },
    {
      kind: "realEstate",
      id: "ob-land-4",
      title: "500 ha, Artigas frontier",
      flavor: "The road is coming \u2014 the surveyor already came.",
      category: "landUY",
      cost: 75e3,
      downPayment: 1e4,
      mortgage: 65e3,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "ob-land-5",
      title: "Citrus estate, Salto",
      flavor: "Juice contracts with the border packers.",
      category: "landUY",
      cost: 11e4,
      downPayment: 16e3,
      mortgage: 94e3,
      cashFlow: 550
    },
    {
      kind: "realEstate",
      id: "ob-land-6",
      title: "1,000 ha, no fences, Tacuaremb\xF3",
      flavor: "Priced like scrub; mapped like pasture.",
      category: "landUY",
      cost: 1e5,
      downPayment: 12e3,
      mortgage: 88e3,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "ob-land-7",
      title: "Eucalyptus plantation, Rivera",
      flavor: "The pulp crews come with the deed.",
      category: "landUY",
      cost: 14e4,
      downPayment: 22e3,
      mortgage: 118e3,
      cashFlow: 700
    },
    {
      kind: "realEstate",
      id: "ob-land-8",
      title: "Feedlot acreage, Durazno",
      flavor: "The crossroads of every cattle truck in the interior.",
      category: "landUY",
      cost: 16e4,
      downPayment: 26e3,
      mortgage: 134e3,
      cashFlow: 850
    },
    {
      kind: "realEstate",
      id: "ob-land-9",
      title: "Lagoon-front acres, Rocha",
      flavor: "Punta del Este money builds closer every year.",
      category: "landUY",
      cost: 85e3,
      downPayment: 14e3,
      mortgage: 71e3,
      cashFlow: 0
    },
    {
      kind: "realEstate",
      id: "ob-land-10",
      title: "Ruta 9 corridor acres, Maldonado",
      flavor: "Highway frontage between the beach towns; a fabricator rents the flat half.",
      category: "landUY",
      cost: 12e4,
      downPayment: 18e3,
      mortgage: 102e3,
      cashFlow: 600
    },
    {
      kind: "realEstate",
      id: "ob-dair-1",
      title: "200-cow dairy, Colonia",
      flavor: "Conaprole collects the milk; you collect the monthly.",
      category: "dairyUY",
      cost: 18e4,
      downPayment: 28e3,
      mortgage: 152e3,
      cashFlow: 900
    },
    {
      kind: "realEstate",
      id: "ob-dair-2",
      title: "Holstein herd expansion, San Jos\xE9",
      flavor: "Four hundred head, free-stall barn, and a full silage clamp.",
      category: "dairyUY",
      cost: 22e4,
      downPayment: 35e3,
      mortgage: 185e3,
      cashFlow: 1100
    },
    {
      kind: "realEstate",
      id: "ob-dair-3",
      title: "Milk-cooperative contract farm, Florida",
      flavor: "The co-op guarantee outlasts any single milk-price cycle.",
      category: "dairyUY",
      cost: 16e4,
      downPayment: 24e3,
      mortgage: 136e3,
      cashFlow: 800
    },
    {
      kind: "realEstate",
      id: "ob-dair-4",
      title: "Cheese-plant offtake estancia, Colonia",
      flavor: "Artisan wheels and export bricks share the same milk line.",
      category: "dairyUY",
      cost: 25e4,
      downPayment: 4e4,
      mortgage: 21e4,
      cashFlow: 1250
    },
    {
      kind: "realEstate",
      id: "ob-dair-5",
      title: "Feedlot and finishing yard, Paysand\xFA",
      flavor: "Cattle arrive thin and leave as export cuts.",
      category: "dairyUY",
      cost: 2e5,
      downPayment: 3e4,
      mortgage: 17e4,
      cashFlow: 1e3
    },
    {
      kind: "realEstate",
      id: "ob-dair-6",
      title: "1,000-head cattle estancia, Tacuaremb\xF3",
      flavor: "A working ranch with Herefords to the horizon.",
      category: "dairyUY",
      cost: 28e4,
      downPayment: 42e3,
      mortgage: 238e3,
      cashFlow: 1400
    },
    {
      kind: "realEstate",
      id: "ob-dair-7",
      title: "Rotary milking parlor, Canelones",
      flavor: "Sixty stalls turn with the clock; night shifts keep the tank full.",
      category: "dairyUY",
      cost: 19e4,
      downPayment: 28e3,
      mortgage: 162e3,
      cashFlow: 950
    },
    {
      kind: "realEstate",
      id: "ob-dair-8",
      title: "Organic dairy co-op share, Colonia",
      flavor: "Premium milk price, premium paperwork, honest monthly CF.",
      category: "dairyUY",
      cost: 15e4,
      downPayment: 22e3,
      mortgage: 128e3,
      cashFlow: 750
    },
    {
      kind: "realEstate",
      id: "ob-dair-9",
      title: "Breeding-stock farm, Florida",
      flavor: "Prize Holstein bulls and heifers priced like jewellery.",
      category: "dairyUY",
      cost: 24e4,
      downPayment: 36e3,
      mortgage: 204e3,
      cashFlow: 1150
    }
  ],
  MARKET_CARDS: [
    {
      kind: "sellOffer",
      id: "mk-condo-hot",
      title: "Condo bidding war",
      flavor: "Downtown employers are hiring; buyers offer 135% of what you paid for 2-bedroom condos.",
      category: "condo2br",
      multiplierPct: 135
    },
    {
      kind: "sellOffer",
      id: "mk-condo-flat",
      title: "Condo buyer, fair price",
      flavor: "A first-time buyer offers exactly what 2-bedroom condos cost.",
      category: "condo2br",
      multiplierPct: 100
    },
    {
      kind: "sellOffer",
      id: "mk-condo-cold",
      title: "Condo glut",
      flavor: "Three new towers opened at once. A vulture fund bids 65% of cost for 2-bedroom condos.",
      category: "condo2br",
      multiplierPct: 65
    },
    {
      kind: "sellOffer",
      id: "mk-house-hot",
      title: "Family-home frenzy",
      flavor: "A school ranking went viral. Families pay 140% of cost for 3-bedroom houses.",
      category: "house3br",
      multiplierPct: 140
    },
    {
      kind: "sellOffer",
      id: "mk-house-flat",
      title: "House buyer, market price",
      flavor: "A relocation service offers 105% of cost for 3-bedroom houses.",
      category: "house3br",
      multiplierPct: 105
    },
    {
      kind: "sellOffer",
      id: "mk-house-cold",
      title: "Rates spike, houses stall",
      flavor: "Mortgages got expensive overnight. An investor bids 70% of cost for 3-bedroom houses.",
      category: "house3br",
      multiplierPct: 70
    },
    {
      kind: "sellOffer",
      id: "mk-duplex-hot",
      title: "House-hackers want duplexes",
      flavor: "Live in one, rent the other \u2014 buyers pay 130% of cost for duplexes.",
      category: "duplex",
      multiplierPct: 130
    },
    {
      kind: "sellOffer",
      id: "mk-duplex-mid",
      title: "Duplex offer",
      flavor: "A landlord expanding her portfolio offers 110% of cost for duplexes.",
      category: "duplex",
      multiplierPct: 110
    },
    {
      kind: "sellOffer",
      id: "mk-4plex-hot",
      title: "Small-multifamily boom",
      flavor: "Out-of-town money discovers 4-plexes: offers at 145% of cost.",
      category: "fourplex",
      multiplierPct: 145
    },
    {
      kind: "sellOffer",
      id: "mk-4plex-mid",
      title: "4-plex exchange buyer",
      flavor: "A seller on a tax deadline needs your 4-plex at 115% of cost.",
      category: "fourplex",
      multiplierPct: 115
    },
    {
      kind: "sellOffer",
      id: "mk-4plex-cold",
      title: "Insurance shock",
      flavor: "Premiums doubled regionally; a cash buyer offers 75% of cost for 4-plexes.",
      category: "fourplex",
      multiplierPct: 75
    },
    {
      kind: "sellOffer",
      id: "mk-8plex-hot",
      title: "Syndicators chase 8-plexes",
      flavor: "A syndication needs doors before quarter-end: 150% of cost for 8-plexes.",
      category: "eightplex",
      multiplierPct: 150
    },
    {
      kind: "sellOffer",
      id: "mk-8plex-mid",
      title: "8-plex offer",
      flavor: "A family office offers 120% of cost for 8-plexes.",
      category: "eightplex",
      multiplierPct: 120
    },
    {
      kind: "sellOffer",
      id: "mk-8plex-cold",
      title: "Rent freeze proposal",
      flavor: "A ballot measure spooks landlords; 80% of cost offered for 8-plexes.",
      category: "eightplex",
      multiplierPct: 80
    },
    {
      kind: "sellOffer",
      id: "mk-apts-hot",
      title: "Institutions buy small buildings",
      flavor: "A pension fund pays 140% of cost for small apartment buildings.",
      category: "aptSmall",
      multiplierPct: 140
    },
    {
      kind: "sellOffer",
      id: "mk-apts-mid",
      title: "Apartment buyer",
      flavor: "A regional operator offers 115% of cost for small apartment buildings.",
      category: "aptSmall",
      multiplierPct: 115
    },
    {
      kind: "sellOffer",
      id: "mk-aptl-hot",
      title: "Complex feeding frenzy",
      flavor: "REITs bid against each other: 145% of cost for large apartment complexes.",
      category: "aptLarge",
      multiplierPct: 145
    },
    {
      kind: "sellOffer",
      id: "mk-aptl-mid",
      title: "Complex offer",
      flavor: "A REIT tenders 118% of cost for large apartment complexes.",
      category: "aptLarge",
      multiplierPct: 118
    },
    {
      kind: "sellOffer",
      id: "mk-land-road",
      title: "The highway is coming",
      flavor: "Surveyors confirmed the new interchange. A developer pays 300% of cost for land.",
      category: "land",
      multiplierPct: 300
    },
    {
      kind: "sellOffer",
      id: "mk-land-mall",
      title: "Big-box site hunt",
      flavor: "A retailer quietly assembles parcels at 500% of cost for land.",
      category: "land",
      multiplierPct: 500
    },
    {
      kind: "sellOffer",
      id: "mk-fran-hot",
      title: "Franchise roll-up",
      flavor: "A private-equity group buys franchises at 160% of cost.",
      category: "franchise",
      multiplierPct: 160
    },
    {
      kind: "sellOffer",
      id: "mk-fran-mid",
      title: "Franchise buyer",
      flavor: "An operator-owner offers 110% of cost for franchises.",
      category: "franchise",
      multiplierPct: 110
    },
    {
      kind: "sellOffer",
      id: "mk-localbiz",
      title: "Main-street consolidation",
      flavor: "A local chain absorbs small businesses at 140% of cost.",
      category: "localBiz",
      multiplierPct: 140
    },
    {
      kind: "sellOffer",
      id: "mk-partner",
      title: "Partnership buyout",
      flavor: "The general partner buys out limited partners at 150% of cost.",
      category: "partnership",
      multiplierPct: 150
    },
    {
      kind: "stockPrice",
      id: "mk-grit-40",
      title: "GRIT hits an all-time high",
      flavor: "The robot maker lands a defense contract. Everyone may sell GRIT at $40.",
      symbol: "GRIT",
      price: 40
    },
    {
      kind: "stockPrice",
      id: "mk-grit-5",
      title: "GRIT recall panic",
      flavor: "A gripper-arm recall goes public. GRIT trades at $5 \u2014 sell if you must.",
      symbol: "GRIT",
      price: 5
    },
    {
      kind: "stockPrice",
      id: "mk-snail-30",
      title: "SNAIL takeover rumor",
      flavor: "A logistics giant is sniffing around. SNAIL quoted at $30.",
      symbol: "SNAIL",
      price: 30
    },
    {
      kind: "stockPrice",
      id: "mk-myco-40",
      title: "MYCO approval day",
      flavor: "The flagship treatment clears its final hurdle. MYCO at $40.",
      symbol: "MYCO",
      price: 40
    },
    {
      kind: "stockPrice",
      id: "mk-zap-30",
      title: "ZAP goes national",
      flavor: "Two hundred new cities in one press release. ZAP at $30.",
      symbol: "ZAP",
      price: 30
    },
    {
      kind: "stockPrice",
      id: "mk-nest-30",
      title: "NEST at a record",
      flavor: "The whole index is up. NEST fund quoted at $30.",
      symbol: "NEST",
      price: 30
    },
    {
      kind: "stockSplit",
      id: "mk-split-grit",
      title: "GRIT splits 2-for-1",
      flavor: "The board wants a friendlier ticker price. Your GRIT share count doubles.",
      symbol: "GRIT",
      direction: "split"
    },
    {
      kind: "stockSplit",
      id: "mk-split-zap",
      title: "ZAP splits 2-for-1",
      flavor: "Retail investors cheer; your ZAP share count doubles.",
      symbol: "ZAP",
      direction: "split"
    },
    {
      kind: "stockSplit",
      id: "mk-split-snail",
      title: "SNAIL splits 2-for-1",
      flavor: "Slow and steady \u2014 and now twice as many shares.",
      symbol: "SNAIL",
      direction: "split"
    },
    {
      kind: "stockSplit",
      id: "mk-reverse-myco",
      title: "MYCO reverse split",
      flavor: "Listing rules force a 1-for-2 consolidation. Your MYCO share count halves.",
      symbol: "MYCO",
      direction: "reverse"
    },
    {
      kind: "windfall",
      id: "mk-windfall-refund",
      title: "Surprise tax refund",
      flavor: "The revenue office recalculated. Every player collects $500.",
      flatAmount: 500
    },
    {
      kind: "windfall",
      id: "mk-windfall-rents",
      title: "Rents reset upward",
      flavor: "Citywide leases renew higher: collect $250 for each rental property you own.",
      amountPerRealEstate: 250
    }
  ],
  OFFSHORE_MARKET_CARDS: [
    {
      kind: "sellOffer",
      id: "om-mvd-wave",
      title: "Montevideo investment wave",
      flavor: "Regional funds discover the Rambla: 170% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 170
    },
    {
      kind: "sellOffer",
      id: "om-mvd-tram",
      title: "New transit corridor opens",
      flavor: "Stations lift whole neighbourhoods: 185% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 185
    },
    {
      kind: "sellOffer",
      id: "om-mvd-rambla",
      title: "Rambla promenade upgrade",
      flavor: "The capital\u2019s seafront packs out; operators pay 150% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 150
    },
    {
      kind: "sellOffer",
      id: "om-mvd-tech",
      title: "Tech campus relocates",
      flavor: "A software park signs long leases; buyers pay 140% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 140
    },
    {
      kind: "sellOffer",
      id: "om-mvd-visa",
      title: "Residency program boom",
      flavor: "Remote workers bid for long stays: 125% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 125
    },
    {
      kind: "sellOffer",
      id: "om-mvd-fair",
      title: "Local developer consolidates",
      flavor: "A Montevideo builder offers a clean 105% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 105
    },
    {
      kind: "sellOffer",
      id: "om-mvd-peso",
      title: "Peso slides",
      flavor: "Local owners cash out to dollar buyers at 90% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 90
    },
    {
      kind: "sellOffer",
      id: "om-mvd-glut",
      title: "Rental glut winter",
      flavor: "Empty towers after the boom; a fund bids 65% of cost for Montevideo apartments.",
      category: "aptMVD",
      multiplierPct: 65
    },
    {
      kind: "sellOffer",
      id: "om-pde-season",
      title: "Record summer season",
      flavor: "Every short-let is booked: 175% of cost for Punta del Este apartments.",
      category: "aptPDE",
      multiplierPct: 175
    },
    {
      kind: "sellOffer",
      id: "om-pde-brazil",
      title: "Brazilian tourist wave",
      flavor: "Charters fill the peninsula; foreign buyers pay 160% of cost for Punta del Este apartments.",
      category: "aptPDE",
      multiplierPct: 160
    },
    {
      kind: "sellOffer",
      id: "om-pde-events",
      title: "Film festival and regatta week",
      flavor: "Event demand spikes: 150% of cost for Punta del Este apartments.",
      category: "aptPDE",
      multiplierPct: 150
    },
    {
      kind: "sellOffer",
      id: "om-pde-reit",
      title: "Beach REIT tender",
      flavor: "A listed trust tenders 110% of cost for Punta del Este apartments.",
      category: "aptPDE",
      multiplierPct: 110
    },
    {
      kind: "sellOffer",
      id: "om-pde-off",
      title: "Off-season collapse",
      flavor: "July silence on Gorlero; owners accept 75% of cost for Punta del Este apartments.",
      category: "aptPDE",
      multiplierPct: 75
    },
    {
      kind: "sellOffer",
      id: "om-pde-build",
      title: "Tower construction glut",
      flavor: "Cranes outnumber tenants; a vulture fund bids 60% of cost for Punta del Este apartments.",
      category: "aptPDE",
      multiplierPct: 60
    },
    {
      kind: "sellOffer",
      id: "om-vil-celeb",
      title: "Celebrity beach-house hunt",
      flavor: "Names you know want keys by Christmas: 200% of cost for Punta del Este villas.",
      category: "villaPDE",
      multiplierPct: 200
    },
    {
      kind: "sellOffer",
      id: "om-vil-luxury",
      title: "Luxury REIT scrapes the coast",
      flavor: "Institutional money pays 160% of cost for Punta del Este villas.",
      category: "villaPDE",
      multiplierPct: 160
    },
    {
      kind: "sellOffer",
      id: "om-vil-fair",
      title: "Neighbour compounds buy",
      flavor: "The villa next door rounds out the block at 120% of cost for Punta del Este villas.",
      category: "villaPDE",
      multiplierPct: 120
    },
    {
      kind: "sellOffer",
      id: "om-vil-storm",
      title: "Atlantic storm season",
      flavor: "Dune damage and cancelled summers; a fund bids 70% of cost for Punta del Este villas.",
      category: "villaPDE",
      multiplierPct: 70
    },
    {
      kind: "sellOffer",
      id: "om-land-hwy",
      title: "Highway corridor confirmed",
      flavor: "The route is drawn on the official map: 400% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 400
    },
    {
      kind: "sellOffer",
      id: "om-land-port",
      title: "Grain port expansion",
      flavor: "Exporters assemble parcels at 350% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 350
    },
    {
      kind: "sellOffer",
      id: "om-land-soy",
      title: "Soy price spike",
      flavor: "Brokers lease anything green and buy what they lease: 250% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 250
    },
    {
      kind: "sellOffer",
      id: "om-land-forest",
      title: "Pulp mill timber rush",
      flavor: "Eucalyptus contracts reprice the north: 220% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 220
    },
    {
      kind: "sellOffer",
      id: "om-land-beach",
      title: "Coastal resort site hunt",
      flavor: "Rocha money assembles dunes at 300% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 300
    },
    {
      kind: "sellOffer",
      id: "om-land-fair",
      title: "Neighbouring estancia offer",
      flavor: "The rancher next door rounds out his map at 120% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 120
    },
    {
      kind: "sellOffer",
      id: "om-land-drought",
      title: "Interior drought",
      flavor: "Dust where grass should be; a fund bids 70% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 70
    },
    {
      kind: "sellOffer",
      id: "om-land-flood",
      title: "River flood year",
      flavor: "Bottomland under water; distressed buyers pay 65% of cost for Uruguay land.",
      category: "landUY",
      multiplierPct: 65
    },
    {
      kind: "sellOffer",
      id: "om-dair-milk",
      title: "Milk-price rally",
      flavor: "Co-ops outbid each other for tankers \u2014 and for the farms under them: 220% of cost for Uruguay dairy and cattle.",
      category: "dairyUY",
      multiplierPct: 220
    },
    {
      kind: "sellOffer",
      id: "om-dair-export",
      title: "Export quota opens",
      flavor: "China and EU offtake signed: 200% of cost for Uruguay dairy and cattle.",
      category: "dairyUY",
      multiplierPct: 200
    },
    {
      kind: "sellOffer",
      id: "om-dair-herd",
      title: "Herd expansion frenzy",
      flavor: "Ranchers need productive cows before spring: 180% of cost for Uruguay dairy and cattle.",
      category: "dairyUY",
      multiplierPct: 180
    },
    {
      kind: "sellOffer",
      id: "om-dair-coop",
      title: "Co-op consolidation",
      flavor: "Conaprole-scale buyers tender 140% of cost for Uruguay dairy and cattle.",
      category: "dairyUY",
      multiplierPct: 140
    },
    {
      kind: "sellOffer",
      id: "om-dair-fair",
      title: "Neighbour dairy offer",
      flavor: "The farm next door wants your herd at 115% of cost for Uruguay dairy and cattle.",
      category: "dairyUY",
      multiplierPct: 115
    },
    {
      kind: "sellOffer",
      id: "om-dair-scare",
      title: "Herd-health scare",
      flavor: "Markets panic on a false alarm; a fund bids 60% of cost for Uruguay dairy and cattle.",
      category: "dairyUY",
      multiplierPct: 60
    },
    {
      kind: "stockPrice",
      id: "om-shib-30",
      title: "SHIB all-time high",
      flavor: "The dog leads the whole market. Everyone may sell SHIB at $30.",
      symbol: "SHIB",
      price: 30
    },
    {
      kind: "stockPrice",
      id: "om-shib-2",
      title: "SHIB flash crash",
      flavor: "A whale market-sells into thin books. SHIB trades at $2 \u2014 sell if you must.",
      symbol: "SHIB",
      price: 2
    },
    {
      kind: "stockPrice",
      id: "om-pepe-25",
      title: "PEPE tops the charts",
      flavor: "Rarest bull market. Everyone may sell PEPE at $25.",
      symbol: "PEPE",
      price: 25
    },
    {
      kind: "stockPrice",
      id: "om-doge-40",
      title: "DOGE hits a record",
      flavor: "The original meme prints a new high. DOGE quoted at $40.",
      symbol: "DOGE",
      price: 40
    },
    {
      kind: "stockPrice",
      id: "om-bonk-20",
      title: "BONK breakout",
      flavor: "Listings everywhere at once. BONK quoted at $20.",
      symbol: "BONK",
      price: 20
    },
    {
      kind: "stockPrice",
      id: "om-wif-35",
      title: "WIF all-time high",
      flavor: "The hat is priced in. WIF quoted at $35.",
      symbol: "WIF",
      price: 35
    },
    {
      kind: "stockSplit",
      id: "om-air-shib",
      title: "SHIB holder airdrop",
      flavor: "A loyalty airdrop lands: your SHIB bag doubles.",
      symbol: "SHIB",
      direction: "split"
    },
    {
      kind: "stockSplit",
      id: "om-air-bonk",
      title: "BONK community airdrop",
      flavor: "The community round pays holders: your BONK doubles.",
      symbol: "BONK",
      direction: "split"
    },
    {
      kind: "stockSplit",
      id: "om-air-doge",
      title: "DOGE tip-bot refund",
      flavor: "An ancient tip bot returns everyone\u2019s coins: your DOGE doubles.",
      symbol: "DOGE",
      direction: "split"
    },
    {
      kind: "stockSplit",
      id: "om-mig-pepe",
      title: "PEPE v2 migration",
      flavor: "The contract migrates 1-for-2 and burns the rest. Your PEPE halves.",
      symbol: "PEPE",
      direction: "reverse"
    },
    {
      kind: "windfall",
      id: "om-wind-wallet",
      title: "Forgotten wallet recovered",
      flavor: "An old seed phrase finally works. Every player collects $500.",
      flatAmount: 500
    },
    {
      kind: "windfall",
      id: "om-wind-rents",
      title: "Overseas rents audited upward",
      flavor: "The property managers report higher rents: collect $250 for each property you own.",
      amountPerRealEstate: 250
    }
  ],
  DOODADS: [
    {
      id: "dd-01",
      title: "Artisan coffee habit",
      flavor: "A month of single-origin pour-overs.",
      amount: 60,
      financeable: false
    },
    {
      id: "dd-02",
      title: "Streaming stack renewal",
      flavor: "Five services, zero time to watch them.",
      amount: 80,
      financeable: false
    },
    {
      id: "dd-03",
      title: "Parking fine",
      flavor: "The sign was very small.",
      amount: 50,
      financeable: false
    },
    {
      id: "dd-04",
      title: "Birthday dinner out",
      flavor: "You grabbed the check before anyone could argue.",
      amount: 120,
      financeable: false
    },
    {
      id: "dd-05",
      title: "Limited-edition sneakers",
      flavor: "They were limited. You were quick.",
      amount: 180,
      financeable: false
    },
    {
      id: "dd-06",
      title: "Concert weekend",
      flavor: "Two tickets, one overpriced hoodie.",
      amount: 220,
      financeable: false
    },
    {
      id: "dd-07",
      title: "New winter tires",
      flavor: "Safety first, savings second.",
      amount: 350,
      financeable: false
    },
    {
      id: "dd-08",
      title: "Dental filling",
      flavor: "The candy jar sends its regards.",
      amount: 240,
      financeable: false
    },
    {
      id: "dd-09",
      title: "Fancy gym onboarding",
      flavor: "Initiation fee plus a smoothie you didn\u2019t need.",
      amount: 150,
      financeable: false
    },
    {
      id: "dd-10",
      title: "Kid\u2019s birthday bash",
      flavor: "A bouncy castle has a surprising day rate.",
      amount: 250,
      financeable: false
    },
    {
      id: "dd-11",
      title: "Barista-grade espresso machine",
      flavor: "It has more pressure gauges than your car.",
      amount: 400,
      financeable: true
    },
    {
      id: "dd-12",
      title: "Weekend city break",
      flavor: "Flash sale flights, full-price everything else.",
      amount: 380,
      financeable: false
    },
    {
      id: "dd-13",
      title: "Phone screen replacement",
      flavor: "It only fell once.",
      amount: 190,
      financeable: false
    },
    {
      id: "dd-14",
      title: "Designer sunglasses",
      flavor: "Lost within a month, statistically.",
      amount: 160,
      financeable: false
    },
    {
      id: "dd-15",
      title: "Smart-home gadget spree",
      flavor: "The lights now require a firmware update.",
      amount: 300,
      financeable: false
    },
    {
      id: "dd-16",
      title: "Pet emergency visit",
      flavor: "The sock has been recovered.",
      amount: 320,
      financeable: false
    },
    {
      id: "dd-17",
      title: "New gaming console",
      flavor: "For the kids. Obviously.",
      amount: 500,
      financeable: true
    },
    {
      id: "dd-18",
      title: "Car detail & tune-up",
      flavor: "It purrs now. Your wallet whimpers.",
      amount: 280,
      financeable: false
    },
    {
      id: "dd-19",
      title: "Golf clubs upgrade",
      flavor: "The slice, unfortunately, transfers.",
      amount: 600,
      financeable: true
    },
    {
      id: "dd-20",
      title: "Anniversary jewelry",
      flavor: "Worth every penny. All 45,000 of them.",
      amount: 450,
      financeable: true
    },
    {
      id: "dd-21",
      title: "Boutique haircut & spa day",
      flavor: "Self-care, premium tier.",
      amount: 140,
      financeable: false
    },
    {
      id: "dd-22",
      title: "Little-league season fees",
      flavor: "Uniform, travel, and a raffle you lost.",
      amount: 210,
      financeable: false
    },
    {
      id: "dd-23",
      title: "New office chair",
      flavor: "Your back unionized.",
      amount: 330,
      financeable: false
    },
    {
      id: "dd-24",
      title: "Craft-kit subscription binge",
      flavor: "You are now the owner of a kiln.",
      amount: 260,
      financeable: false
    },
    {
      id: "dd-25",
      title: "Drone with camera",
      flavor: "Neighborhood cinematography awaits.",
      amount: 550,
      financeable: true
    },
    {
      id: "dd-26",
      title: "Holiday gift blitz",
      flavor: "Everyone was extra nice this year.",
      amount: 480,
      financeable: true
    },
    {
      id: "dd-27",
      title: "Speeding ticket + course",
      flavor: "The defensive-driving video was 4 hours long.",
      amount: 230,
      financeable: false
    },
    {
      id: "dd-28",
      title: "Mystery plumbing leak",
      flavor: "The drip was louder at 3 a.m.",
      amount: 310,
      financeable: false
    },
    {
      id: "dd-29",
      title: "Tailored suit",
      flavor: "For interviews, weddings, and feeling fancy.",
      amount: 520,
      financeable: true
    },
    {
      id: "dd-30",
      title: "E-bike impulse buy",
      flavor: "It was raining and the bus was late.",
      amount: 800,
      financeable: true
    },
    {
      id: "dd-31",
      title: "Fantasy-league buy-in",
      flavor: "This is your year. Again.",
      amount: 100,
      financeable: false
    },
    {
      id: "dd-32",
      title: "Premium headphones",
      flavor: "Noise cancelling, budget cancelling.",
      amount: 350,
      financeable: false
    },
    {
      id: "dd-33",
      title: "Weekend fishing charter",
      flavor: "The big one got away; the invoice did not.",
      amount: 420,
      financeable: true
    },
    {
      id: "dd-34",
      title: "House-plant collection",
      flavor: "The rare one needs its own humidifier.",
      amount: 130,
      financeable: false
    },
    {
      id: "dd-35",
      title: "Karaoke night, your treat",
      flavor: "You booked the private room. Twice.",
      amount: 170,
      financeable: false
    },
    {
      id: "dd-36",
      title: "New mattress",
      flavor: "Sleep is an investment, right?",
      amount: 700,
      financeable: true
    },
    {
      id: "dd-37",
      title: "Ski-day splurge",
      flavor: "Lift ticket, lesson, and lodge nachos.",
      amount: 290,
      financeable: false
    },
    {
      id: "dd-38",
      title: "Charity gala ticket",
      flavor: "Black tie, open heart, closed wallet.",
      amount: 200,
      financeable: false
    },
    {
      id: "dd-39",
      title: "Air conditioner repair",
      flavor: "It broke during the heat wave, naturally.",
      amount: 370,
      financeable: false
    },
    {
      id: "dd-40",
      title: "Collector board game haul",
      flavor: "The shelf of shame grows by three boxes.",
      amount: 150,
      financeable: false
    }
  ]
};

// src/data/decks_ru.json
var decks_ru_default = {
  SMALL_DEALS_RU: [
    {
      id: "sd-grit-100",
      kind: "stock",
      symbol: "GRIT",
      title: "GRIT \u2014 \xAB\u041A\u0440\u0435\u043C\u0435\u043D\u044C \u0420\u043E\u0431\u043E\u0442\u0438\u043A\u0441\xBB",
      flavor: "\u0420\u043E\u0431\u043E\u0442\u044B \u043E\u043F\u044F\u0442\u044C \u043D\u0438\u043A\u043E\u043C\u0443 \u043D\u0435 \u043D\u0443\u0436\u043D\u044B, \u0430\u043A\u0446\u0438\u044F \u043F\u043E \u0446\u0435\u043D\u0435 \u043F\u0438\u0440\u043E\u0436\u043A\u0430. \u042D\u0442\u043E \u0434\u043D\u043E? \u0418\u043B\u0438 \u043F\u043E\u0434 \u0434\u043D\u043E\u043C \u0435\u0441\u0442\u044C \u043F\u043E\u0434\u0432\u0430\u043B?",
      price: 100,
      range: [
        100,
        4e3
      ]
    },
    {
      id: "sd-grit-2000",
      kind: "stock",
      symbol: "GRIT",
      title: "GRIT \u2014 \xAB\u041A\u0440\u0435\u043C\u0435\u043D\u044C \u0420\u043E\u0431\u043E\u0442\u0438\u043A\u0441\xBB",
      flavor: "\u0417\u0430\u0432\u043E\u0434 \u043F\u043E\u043B\u0443\u0447\u0438\u043B \u0437\u0430\u043A\u0430\u0437 \u043D\u0430 \u0440\u043E\u0431\u043E\u0442\u043E\u0432-\u0434\u0432\u043E\u0440\u043D\u0438\u043A\u043E\u0432. \u041F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043F\u0443\u0442\u0438 \u043D\u0430\u0432\u0435\u0440\u0445 \u2014 \u0438\u043B\u0438 \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043F\u0443\u0442\u0438 \u0432\u043D\u0438\u0437?",
      price: 2e3,
      range: [
        100,
        4e3
      ]
    },
    {
      id: "sd-grit-4000",
      kind: "stock",
      symbol: "GRIT",
      title: "GRIT \u2014 \xAB\u041A\u0440\u0435\u043C\u0435\u043D\u044C \u0420\u043E\u0431\u043E\u0442\u0438\u043A\u0441\xBB",
      flavor: "\u041F\u0440\u043E \xAB\u041A\u0440\u0435\u043C\u0435\u043D\u044C\xBB \u0441\u043D\u044F\u043B \u0440\u043E\u043B\u0438\u043A \u043A\u0430\u0436\u0434\u044B\u0439 \u0431\u043B\u043E\u0433\u0435\u0440, \u043A\u0443\u043F\u0438\u043B\u0438 \u0432\u0441\u0435 \u2014 \u043E\u0442 \u0442\u0430\u043A\u0441\u0438\u0441\u0442\u0430 \u0434\u043E \u0442\u0451\u0449\u0438. \u041A\u0442\u043E \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u044C \u0434\u0430\u043B\u044C\u0448\u0435?",
      price: 4e3,
      range: [
        100,
        4e3
      ]
    },
    {
      id: "sd-zap-100",
      kind: "stock",
      symbol: "ZAP",
      title: "ZAP \u2014 \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u044B \xAB\u0416\u0443\u0445!\xBB",
      flavor: "\u0417\u0438\u043C\u0430. \u0421\u0430\u043C\u043E\u043A\u0430\u0442\u044B \u0441\u043F\u044F\u0442 \u0432 \u0433\u0430\u0440\u0430\u0436\u0435, \u0430\u043A\u0446\u0438\u0438 \u2014 \u0432 \u0441\u0443\u0433\u0440\u043E\u0431\u0435. \u0410 \u0432\u0435\u0441\u043D\u0430, \u043C\u0435\u0436\u0434\u0443 \u043F\u0440\u043E\u0447\u0438\u043C, \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0434.",
      price: 100,
      range: [
        100,
        3e3
      ]
    },
    {
      id: "sd-zap-2800",
      kind: "stock",
      symbol: "ZAP",
      title: "ZAP \u2014 \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u044B \xAB\u0416\u0443\u0445!\xBB",
      flavor: "\u0410\u043F\u0440\u0435\u043B\u044C, \u0432\u0435\u0441\u044C \u0433\u043E\u0440\u043E\u0434 \u043A\u0430\u0442\u0430\u0435\u0442\u0441\u044F, \u0430\u043A\u0446\u0438\u0438 \u043D\u0430 \u043F\u0438\u043A\u0435. \u041E\u0441\u0435\u043D\u044C, \u043C\u0435\u0436\u0434\u0443 \u043F\u0440\u043E\u0447\u0438\u043C, \u0442\u043E\u0436\u0435 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0434.",
      price: 2800,
      range: [
        100,
        3e3
      ]
    },
    {
      id: "sd-myco-500",
      kind: "stock",
      symbol: "MYCO",
      title: "MYCO \u2014 \u0431\u0438\u043E\u0442\u0435\u0445 \xAB\u041C\u0438\u043A\u043E\u041B\u0430\u0431\xBB",
      flavor: "\u041F\u0440\u043E\u0432\u0430\u043B\u0438\u043B\u0438 \u0438\u0441\u043F\u044B\u0442\u0430\u043D\u0438\u044F \u0447\u0443\u0434\u043E-\u043B\u0435\u043A\u0430\u0440\u0441\u0442\u0432\u0430. \u0423\u0447\u0451\u043D\u044B\u0435 \u043D\u0435 \u0441\u0434\u0430\u044E\u0442\u0441\u044F, \u0438\u043D\u0432\u0435\u0441\u0442\u043E\u0440\u044B \u2014 \u0443\u0436\u0435. \u0414\u0451\u0448\u0435\u0432\u043E, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0441\u0442\u0440\u0430\u0448\u043D\u043E.",
      price: 500,
      range: [
        500,
        4e3
      ]
    },
    {
      id: "sd-snail-500",
      kind: "stock",
      symbol: "SNAIL",
      title: "SNAIL \u2014 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \xAB\u0423\u043B\u0438\u0442\u043A\u0430\xBB",
      flavor: "\u041F\u043E\u0442\u0435\u0440\u044F\u043B\u0438 \u0442\u0440\u0438 \u0444\u0443\u0440\u044B \u043F\u043E\u0441\u044B\u043B\u043E\u043A, \u043D\u0430\u0448\u043B\u0438 \u0434\u0432\u0435. \u0410\u043A\u0446\u0438\u0438 \u0443\u043F\u043E\u043B\u0437\u043B\u0438 \u043D\u0430 \u0434\u043D\u043E \u2014 \u043D\u043E \u0432\u043E\u0437\u0438\u0442 \xAB\u0423\u043B\u0438\u0442\u043A\u0430\xBB \u0432\u0441\u0451 \u0440\u0430\u0432\u043D\u043E \u043F\u043E\u043B\u0441\u0442\u0440\u0430\u043D\u044B.",
      price: 500,
      range: [
        500,
        3e3
      ]
    },
    {
      id: "sd-nest-1000",
      kind: "stock",
      symbol: "NEST",
      title: "NEST \u2014 \u0444\u043E\u043D\u0434 \xAB\u0413\u043D\u0435\u0437\u0434\u043E\xBB",
      flavor: "\u0421\u043A\u0443\u0447\u043D\u044B\u0439 \u0444\u043E\u043D\u0434: \u0434\u043E\u043B\u044F \u0432 \u0441\u043E\u0442\u043D\u0435 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0439, \u043A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u0441\u044F\u0446 \u2014 \u0434\u043E\u043B\u044F \u043F\u0440\u0438\u0431\u044B\u043B\u0438. \u0421\u043A\u0443\u0447\u043D\u043E \u2014 \u044D\u0442\u043E \u043A\u043E\u0433\u0434\u0430 \u0441\u043F\u0438\u0448\u044C \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u043E.",
      price: 1e3,
      range: [
        1e3,
        3e3
      ],
      dividendPerShare: 15
    },
    {
      id: "sd-nest-2900",
      kind: "stock",
      symbol: "NEST",
      title: "NEST \u2014 \u0444\u043E\u043D\u0434 \xAB\u0413\u043D\u0435\u0437\u0434\u043E\xBB",
      flavor: "\u0424\u043E\u043D\u0434 \u043D\u0430 \u0438\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u043E\u043C \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C\u0435. \u0412\u044B\u043F\u043B\u0430\u0442\u044B \u0441 \u043F\u0440\u0438\u0431\u044B\u043B\u0438 \u0449\u0435\u0434\u0440\u044B\u0435, \u043D\u043E \u0438 \u0446\u0435\u043D\u0430 \u2014 \u043A\u0430\u043A \u043D\u0430 \u0432\u0438\u0442\u0440\u0438\u043D\u0435.",
      price: 2900,
      range: [
        1e3,
        3e3
      ],
      dividendPerShare: 30
    },
    {
      id: "sd-shib-40",
      kind: "stock",
      symbol: "SHIB",
      title: "SHIB \u2014 \u043C\u043E\u043D\u0435\u0442\u0430 \u0441 \u0441\u043E\u0431\u0430\u043A\u043E\u0439",
      flavor: "\u041A\u0443\u0434\u0430 \u0443\u043B\u0435\u0442\u0438\u0442 \u2014 \u043D\u0435 \u0437\u043D\u0430\u0435\u0442 \u043D\u0438\u043A\u0442\u043E. \u0414\u0430\u0436\u0435 \u0441\u043E\u0431\u0430\u043A\u0430. \u041E\u0441\u043E\u0431\u0435\u043D\u043D\u043E \u0441\u043E\u0431\u0430\u043A\u0430.",
      price: 40,
      range: [
        10,
        4e3
      ],
      hideRange: true
    },
    {
      id: "sd-wif-2500",
      kind: "stock",
      symbol: "WIF",
      title: "WIF \u2014 \u043F\u0451\u0441 \u0432 \u0448\u0430\u043F\u043A\u0435",
      flavor: "\u041F\u043E\u043B\u0433\u043E\u0434\u0430 \u043D\u0430\u0437\u0430\u0434 \u0441\u0442\u043E\u0438\u043B \u0441\u0442\u043E \u0440\u0443\u0431\u043B\u0435\u0439. \u041A\u0443\u0434\u0430 \u0434\u0430\u043B\u044C\u0448\u0435 \u2014 \u0437\u043D\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0448\u0430\u043F\u043A\u0430, \u0430 \u043E\u043D\u0430 \u043C\u043E\u043B\u0447\u0438\u0442.",
      price: 2500,
      range: [
        10,
        4e3
      ],
      hideRange: true
    },
    {
      id: "sd-doge-500",
      kind: "stock",
      symbol: "DOGE",
      title: "DOGE \u2014 \u0434\u0435\u0434\u0443\u0448\u043A\u0430 \u043C\u0435\u043C-\u043C\u043E\u043D\u0435\u0442",
      flavor: "\u041F\u0435\u0440\u0435\u0436\u0438\u043B \u0432\u0441\u0435\u0445, \u043A\u0442\u043E \u0435\u0433\u043E \u0445\u043E\u0440\u043E\u043D\u0438\u043B. \u0414\u043E\u0445\u043E\u0434\u0430 \u043D\u0435 \u043F\u043B\u0430\u0442\u0438\u0442, \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0439 \u043D\u0435 \u0434\u0430\u0451\u0442, \u0437\u0430\u0442\u043E \u0432\u0435\u0441\u0435\u043B\u043E.",
      price: 500,
      range: [
        10,
        4e3
      ]
    },
    {
      id: "sd-gold-6000",
      kind: "stock",
      symbol: "GOLD",
      title: "GOLD \u2014 \u0437\u043E\u043B\u043E\u0442\u043E, \u0433\u0440\u0430\u043C\u043C",
      flavor: "\u041D\u0435 \u0448\u0443\u043C\u0438\u0442, \u043D\u0435 \u0440\u0430\u0441\u0442\u0451\u0442 \u043F\u043E \u0441\u0442\u043E \u043F\u0440\u043E\u0446\u0435\u043D\u0442\u043E\u0432 \u0432 \u0433\u043E\u0434. \u0417\u0430\u0442\u043E \u043A\u043E\u0433\u0434\u0430 \u043D\u0430 \u0440\u044B\u043D\u043A\u0435 \u0448\u0442\u043E\u0440\u043C \u2014 \u0432\u0441\u0435 \u0431\u0435\u0433\u0443\u0442 \u0441\u044E\u0434\u0430.",
      price: 6e3,
      range: [
        5e3,
        9e3
      ]
    },
    {
      id: "sd-sukuk-sklad",
      kind: "stock",
      symbol: "SUKUK",
      title: "SUKUK \u2014 \u0430\u0440\u0435\u043D\u0434\u043D\u044B\u0439 \u0441\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442",
      flavor: "\u041F\u0430\u0439 \u0432 \u0441\u043A\u043B\u0430\u0434\u0435, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0441\u0434\u0430\u043D \u0432 \u0430\u0440\u0435\u043D\u0434\u0443. \u041A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u0441\u044F\u0446 \u2014 \u0432\u0430\u0448\u0430 \u0434\u043E\u043B\u044F \u0430\u0440\u0435\u043D\u0434\u043D\u043E\u0439 \u043F\u043B\u0430\u0442\u044B. \u041D\u0435 \u0440\u0430\u0437\u0433\u043E\u043D\u0438\u0448\u044C\u0441\u044F, \u043D\u043E \u0438 \u043D\u0435 \u043F\u0440\u043E\u0433\u043E\u0440\u0438\u0448\u044C.",
      price: 1e5,
      range: [
        1e5,
        1e5
      ],
      dividendPerShare: 1200
    },
    {
      id: "sd-room-ufa-chernikovka",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 13 \u043C\xB2, \u0423\u0444\u0430, \u0427\u0435\u0440\u043D\u0438\u043A\u043E\u0432\u043A\u0430",
      flavor: "\u0421\u043E\u0441\u0435\u0434\u043A\u0430 \u0442\u0451\u0442\u044F \u0424\u0430\u043D\u044F \u0441\u043B\u0435\u0434\u0438\u0442 \u0437\u0430 \u043F\u043E\u0434\u044A\u0435\u0437\u0434\u043E\u043C \u043B\u0443\u0447\u0448\u0435 \u043B\u044E\u0431\u043E\u0439 \u043A\u0430\u043C\u0435\u0440\u044B. \u0416\u0438\u043B\u0435\u0446 \u0443\u0436\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u0441\u0442\u0443\u0434\u0435\u043D\u0442 \u043D\u0435\u0444\u0442\u044F\u043D\u043E\u0433\u043E. \u0420\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u043E\u0442 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430.",
      cost: 11e5,
      downPayment: 5e4,
      mortgage: 105e4,
      cashFlow: 3500
    },
    {
      id: "sd-room-ufa-sipailovo",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 18 \u043C\xB2, \u0423\u0444\u0430, \u0421\u0438\u043F\u0430\u0439\u043B\u043E\u0432\u043E",
      flavor: "\u0425\u043E\u0437\u044F\u0439\u043A\u0430 \u0443\u0435\u0437\u0436\u0430\u0435\u0442 \u043A \u0434\u043E\u0447\u0435\u0440\u0438 \u0432 \u041F\u0438\u0442\u0435\u0440 \u0438 \u043E\u0442\u0434\u0430\u0451\u0442 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443. \u0420\u0435\u043C\u043E\u043D\u0442 \xAB\u0431\u0430\u0431\u0443\u0448\u043A\u0438\u043D \u043B\u044E\u043A\u0441\xBB, \u0437\u0430\u0442\u043E \u043E\u043A\u043D\u0430 \u0432\u043E \u0434\u0432\u043E\u0440.",
      cost: 14e5,
      downPayment: 7e4,
      mortgage: 133e4,
      cashFlow: 4e3
    },
    {
      id: "sd-studio-ufa-dema",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F 25 \u043C\xB2, \u0423\u0444\u0430, \u0414\u0451\u043C\u0430",
      flavor: "\u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A\u0443 \u043D\u0430\u0434\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043A\u0432\u0430\u0440\u0442\u0430\u043B \u0434\u043E \u041D\u043E\u0432\u043E\u0433\u043E \u0433\u043E\u0434\u0430 \u2014 \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443 \u0441 \u043A\u043E\u043F\u0435\u0435\u0447\u043D\u044B\u043C \u0432\u0437\u043D\u043E\u0441\u043E\u043C. \u0410\u0440\u0435\u043D\u0434\u0430\u0442\u043E\u0440\u044B \u0432 \u0414\u0451\u043C\u0435 \u0441\u0442\u043E\u044F\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438.",
      cost: 3e6,
      downPayment: 9e4,
      mortgage: 291e4,
      cashFlow: 12500
    },
    {
      id: "sd-studio-ufa-inors",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F 28 \u043C\xB2, \u0423\u0444\u0430, \u0418\u043D\u043E\u0440\u0441",
      flavor: "\u041D\u043E\u0432\u044B\u0439 \u0434\u043E\u043C, \u0431\u043B\u0435\u0441\u0442\u044F\u0449\u0438\u0439 \u043B\u0438\u0444\u0442. \u0422\u043E\u043B\u044C\u043A\u043E \u0430\u0440\u0435\u043D\u0434\u0430 \u043F\u043E\u043A\u0430 \u043C\u0435\u043D\u044C\u0448\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0430 \u043F\u043E \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0435. \xAB\u041F\u043E\u0442\u043E\u043C \u043F\u043E\u0434\u043E\u0440\u043E\u0436\u0430\u0435\u0442\xBB \u2014 \u043B\u044E\u0431\u0438\u043C\u0430\u044F \u0441\u043A\u0430\u0437\u043A\u0430 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430.",
      cost: 34e5,
      downPayment: 11e4,
      mortgage: 329e4,
      cashFlow: -3e3
    },
    {
      id: "sd-room-kzn-aviastroit",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 15 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u0410\u0432\u0438\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439",
      flavor: "\u0420\u044F\u0434\u043E\u043C \u0437\u0430\u0432\u043E\u0434 \u0438 \u043C\u0435\u0442\u0440\u043E. \u0416\u0438\u043B\u044C\u0446\u044B \u2014 \u0432\u0430\u0445\u0442\u043E\u0432\u0438\u043A\u0438, \u043F\u043B\u0430\u0442\u044F\u0442 \u0434\u0435\u043D\u044C \u0432 \u0434\u0435\u043D\u044C, \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432 \u043D\u0435 \u0437\u0430\u0434\u0430\u044E\u0442.",
      cost: 17e5,
      downPayment: 85e3,
      mortgage: 1615e3,
      cashFlow: 6500
    },
    {
      id: "sd-room-kzn-derbyshki",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 12 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u0414\u0435\u0440\u0431\u044B\u0448\u043A\u0438",
      flavor: "\u0422\u0438\u0445\u0438\u0439 \u0437\u0435\u043B\u0451\u043D\u044B\u0439 \u0440\u0430\u0439\u043E\u043D. \u0414\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u043C\u0435\u0442\u0440\u043E\u0432, \u0437\u0430\u0442\u043E \u0441\u0432\u043E\u0438. \u0425\u043E\u0437\u044F\u0438\u043D \u0441\u043F\u0435\u0448\u0438\u0442 \u043D\u0430 \u0434\u0430\u0447\u0443 \u2014 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u0431\u0435\u0437 \u0442\u043E\u0440\u0433\u0430.",
      cost: 15e5,
      downPayment: 6e4,
      mortgage: 144e4,
      cashFlow: 5e3
    },
    {
      id: "sd-studio-kzn-salavat-kupere",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F 24 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u0421\u0430\u043B\u0430\u0432\u0430\u0442 \u041A\u0443\u043F\u0435\u0440\u0435",
      flavor: "\u041F\u043E\u043B\u0433\u043E\u0440\u043E\u0434\u0430 \u043A\u0443\u043F\u0438\u043B\u043E \u0441\u0442\u0443\u0434\u0438\u0438 \xAB\u043F\u043E\u0434 \u0441\u0434\u0430\u0447\u0443\xBB \u0432 \u044D\u0442\u043E\u043C \u0436\u0435 \u0434\u0432\u043E\u0440\u0435. \u0423\u0433\u0430\u0434\u0430\u0439\u0442\u0435, \u043A\u0443\u0434\u0430 \u043F\u043E\u0435\u0445\u0430\u043B\u0438 \u0446\u0435\u043D\u044B \u043D\u0430 \u0430\u0440\u0435\u043D\u0434\u0443.",
      cost: 41e5,
      downPayment: 13e4,
      mortgage: 397e4,
      cashFlow: -3500
    },
    {
      id: "sd-studio-kzn-azino",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F 26 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u0410\u0437\u0438\u043D\u043E",
      flavor: "\u0421\u044A\u0451\u043C\u0449\u0438\u043A \u2014 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0438\u0441\u0442: \u0442\u0438\u0445\u0438\u0439, \u043F\u043B\u0430\u0442\u0438\u0442 \u0432\u043F\u0435\u0440\u0451\u0434, \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u043B \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u043F\u043E\u0431\u044B\u0441\u0442\u0440\u0435\u0435. \u0420\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u043E\u0442 \u0437\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A\u0430.",
      cost: 43e5,
      downPayment: 13e4,
      mortgage: 417e4,
      cashFlow: 16e3
    },
    {
      id: "sd-room-chelny-ges",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 14 \u043C\xB2, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B, \u043F\u043E\u0441\u0451\u043B\u043E\u043A \u0413\u042D\u0421",
      flavor: "\u0414\u0435\u0448\u0435\u0432\u043B\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0433\u0430\u0440\u0430\u0436. \u041D\u043E \u0432 \u0433\u0430\u0440\u0430\u0436\u0435 \u0436\u0438\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F, \u0430 \u0442\u0443\u0442 \u043C\u043E\u0436\u043D\u043E \u2014 \u0438 \u0436\u0438\u043B\u0435\u0446 \u0443\u0436\u0435 \u0441\u0442\u043E\u0438\u0442 \u043D\u0430 \u043F\u043E\u0440\u043E\u0433\u0435.",
      cost: 8e5,
      downPayment: 4e4,
      mortgage: 76e4,
      cashFlow: 2e3
    },
    {
      id: "sd-studio-chelny-zyab",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F 23 \u043C\xB2, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B, \u0417\u042F\u0411",
      flavor: "\u0412\u043E\u0437\u043B\u0435 \u041A\u0410\u041C\u0410\u0417\u0430 \u0432\u0441\u0435\u0433\u0434\u0430 \u043A\u0442\u043E-\u0442\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442, \u0438 \u0435\u043C\u0443 \u043D\u0430\u0434\u043E \u0433\u0434\u0435-\u0442\u043E \u0436\u0438\u0442\u044C. \u0412\u0437\u043D\u043E\u0441 \u043F\u043E \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0435 \u2014 \u043A\u0430\u043A \u0437\u0430 \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A.",
      cost: 24e5,
      downPayment: 8e4,
      mortgage: 232e4,
      cashFlow: 8500
    },
    {
      id: "sd-room-chelny-rodnya",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 16 \u043C\xB2, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B, \u041D\u043E\u0432\u044B\u0439 \u0433\u043E\u0440\u043E\u0434",
      flavor: "\u0421\u0434\u0430\u043B\u0438 \u0434\u0432\u043E\u044E\u0440\u043E\u0434\u043D\u043E\u043C\u0443 \u0431\u0440\u0430\u0442\u0443 \u0436\u0435\u043D\u044B. \u041F\u043B\u0430\u0442\u0438\u0442 \xAB\u043A\u0430\u043A \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0441\u044F\xBB. \u041F\u043E\u043B\u0443\u0447\u0430\u0435\u0442\u0441\u044F \u043D\u0435 \u043A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u0441\u044F\u0446.",
      cost: 9e5,
      downPayment: 45e3,
      mortgage: 855e3,
      cashFlow: -1e3
    },
    {
      id: "sd-studio-ufa-zaton",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F 22 \u043C\xB2, \u0423\u0444\u0430, \u0417\u0430\u0442\u043E\u043D",
      flavor: "\u0417\u0430\u0442\u043E\u043D \u0443\u0436\u0435 \u043D\u0435 \u043E\u043A\u0440\u0430\u0438\u043D\u0430: \u043C\u043E\u0441\u0442 \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u043B\u0438, \u0446\u0435\u043D\u044B \u043F\u0440\u043E\u0441\u043D\u0443\u043B\u0438\u0441\u044C. \u0423\u0441\u043F\u0435\u0442\u044C, \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u0440\u043E\u0441\u043D\u0443\u043B\u0441\u044F \u0437\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A.",
      cost: 28e5,
      downPayment: 11e4,
      mortgage: 269e4,
      cashFlow: 7500
    },
    {
      id: "sd-room-ufa-center",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 16 \u043C\xB2, \u0423\u0444\u0430, \u0446\u0435\u043D\u0442\u0440",
      flavor: "\u0421\u0442\u0430\u0440\u044B\u0439 \u0444\u043E\u043D\u0434, \u043F\u043E\u0442\u043E\u043B\u043A\u0438 \u0442\u0440\u0438 \u043C\u0435\u0442\u0440\u0430, \u0437\u0430 \u0441\u0442\u0435\u043D\u043E\u0439 \u2014 \u043F\u0438\u0430\u043D\u0438\u043D\u043E. \u0421\u0434\u0430\u0451\u0442\u0441\u044F \u0431\u044B\u0441\u0442\u0440\u0435\u0435, \u0447\u0435\u043C \u0443\u0441\u043F\u0435\u0432\u0430\u0435\u0448\u044C \u043F\u043E\u0432\u0435\u0441\u0438\u0442\u044C \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u0435.",
      cost: 16e5,
      downPayment: 8e4,
      mortgage: 152e4,
      cashFlow: 5500
    },
    {
      id: "sd-apt-kzn-kirovsky",
      kind: "realEstate",
      category: "aptKZN",
      title: "\u041E\u0434\u043D\u0443\u0448\u043A\u0430 33 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u041A\u0438\u0440\u043E\u0432\u0441\u043A\u0438\u0439 \u0440\u0430\u0439\u043E\u043D",
      flavor: "\xAB\u041E\u0434\u043D\u0443\u0448\u043A\u0430 \u0432 \u041A\u0430\u0437\u0430\u043D\u0438 \u2014 \u044D\u0442\u043E \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u043B\u044E\u0441\xBB, \u2014 \u0441\u043A\u0430\u0437\u0430\u043B \u043F\u0440\u043E\u0434\u0430\u0432\u0435\u0446. \u041F\u043B\u0430\u0442\u0451\u0436 \u043F\u043E \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0435 \u0441 \u043D\u0438\u043C \u043D\u0435 \u0441\u043E\u0433\u043B\u0430\u0441\u0435\u043D.",
      cost: 45e5,
      downPayment: 15e4,
      mortgage: 435e4,
      cashFlow: -7500
    },
    {
      id: "sd-apt-kzn-yudino",
      kind: "realEstate",
      category: "aptKZN",
      title: "\u041E\u0434\u043D\u0443\u0448\u043A\u0430 30 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u042E\u0434\u0438\u043D\u043E",
      flavor: "\u042D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u043A\u0430 \u0434\u043E \u0446\u0435\u043D\u0442\u0440\u0430 \u2014 \u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044C \u043C\u0438\u043D\u0443\u0442. \u0421\u044A\u0451\u043C\u0449\u0438\u043A\u0438 \u2014 \u043C\u043E\u043B\u043E\u0434\u0430\u044F \u043F\u0430\u0440\u0430, \u043C\u0435\u0447\u0442\u0430\u044E\u0442 \u043E \u0442\u0430\u043A\u043E\u0439 \u0436\u0435, \u043D\u043E \u0441\u0432\u043E\u0435\u0439.",
      cost: 42e5,
      downPayment: 14e4,
      mortgage: 406e4,
      cashFlow: 12e3
    },
    {
      id: "sd-parking-ufa",
      kind: "realEstate",
      category: "parking",
      title: "\u041C\u0430\u0448\u0438\u043D\u043E\u043C\u0435\u0441\u0442\u043E, \u0423\u0444\u0430, \u0442\u0451\u043F\u043B\u044B\u0439 \u043F\u0430\u0440\u043A\u0438\u043D\u0433",
      flavor: "\u0417\u0438\u043C\u043E\u0439 \u0437\u0430 \u0442\u0451\u043F\u043B\u044B\u0439 \u043F\u0430\u0440\u043A\u0438\u043D\u0433 \u0443\u0444\u0438\u043C\u0435\u0446 \u043E\u0442\u0434\u0430\u0441\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435. \u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E \u043C\u043E\u0440\u043E\u0437\u043E\u043C \u0432 \u043C\u0438\u043D\u0443\u0441 \u0442\u0440\u0438\u0434\u0446\u0430\u0442\u044C \u043F\u044F\u0442\u044C.",
      cost: 6e5,
      downPayment: 3e4,
      mortgage: 57e4,
      cashFlow: 2e3
    },
    {
      id: "sd-parking-kzn",
      kind: "realEstate",
      category: "parking",
      title: "\u041C\u0430\u0448\u0438\u043D\u043E\u043C\u0435\u0441\u0442\u043E, \u041A\u0430\u0437\u0430\u043D\u044C, \u043F\u043E\u0434\u0437\u0435\u043C\u043D\u044B\u0439 \u043F\u0430\u0440\u043A\u0438\u043D\u0433",
      flavor: "\u041F\u0430\u0440\u043A\u0438\u043D\u0433 \u0443 \u0434\u0435\u043B\u043E\u0432\u043E\u0433\u043E \u0446\u0435\u043D\u0442\u0440\u0430: \u043C\u0430\u0448\u0438\u043D \u0431\u043E\u043B\u044C\u0448\u0435, \u0447\u0435\u043C \u043C\u0435\u0441\u0442. \u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0438\u0437 \u0430\u0440\u0435\u043D\u0434\u0430\u0442\u043E\u0440\u043E\u0432 \u0443\u0436\u0435 \u0432\u044B\u0441\u0442\u0440\u043E\u0438\u043B\u0430\u0441\u044C.",
      cost: 9e5,
      downPayment: 45e3,
      mortgage: 855e3,
      cashFlow: 3500
    },
    {
      id: "sd-kladovka-kzn",
      kind: "realEstate",
      category: "parking",
      title: "\u041A\u043B\u0430\u0434\u043E\u0432\u043A\u0430 4 \u043C\xB2, \u041A\u0430\u0437\u0430\u043D\u044C, \u0446\u043E\u043A\u043E\u043B\u044C \u0416\u041A",
      flavor: "\u0427\u0435\u0442\u044B\u0440\u0435 \u043C\u0435\u0442\u0440\u0430, \u0430 \u0445\u0440\u0430\u043D\u044F\u0442 \u043B\u044B\u0436\u0438, \u043A\u043E\u043B\u044F\u0441\u043A\u0443 \u0438 \u0448\u0438\u043D\u044B \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u044B \u043F\u043E\u0434\u044A\u0435\u0437\u0434\u0430. \u0421\u0434\u0430\u0451\u0442\u0441\u044F \u0431\u044B\u0441\u0442\u0440\u0435\u0435 \u043A\u0432\u0430\u0440\u0442\u0438\u0440.",
      cost: 5e5,
      downPayment: 25e3,
      mortgage: 475e3,
      cashFlow: 2500
    },
    {
      id: "sd-kladovka-ufa",
      kind: "realEstate",
      category: "parking",
      title: "\u041A\u043B\u0430\u0434\u043E\u0432\u043A\u0430 5 \u043C\xB2, \u0423\u0444\u0430, \u043D\u043E\u0432\u044B\u0439 \u0416\u041A",
      flavor: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0442\u0435\u043F\u0435\u0440\u044C \u0441\u0442\u0440\u043E\u044F\u0442 \u0431\u0435\u0437 \u043A\u043B\u0430\u0434\u043E\u0432\u043E\u043A, \u0430 \u0432\u0435\u0449\u0438 \u0443 \u043B\u044E\u0434\u0435\u0439 \u043E\u0441\u0442\u0430\u043B\u0438\u0441\u044C. \u0412\u0430\u0448\u0438 \u043F\u044F\u0442\u044C \u043C\u0435\u0442\u0440\u043E\u0432 \u0440\u0435\u0448\u0430\u044E\u0442 \u0438\u0445 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0443.",
      cost: 5e5,
      downPayment: 2e4,
      mortgage: 48e4,
      cashFlow: 2e3
    },
    {
      id: "sd-parking-chelny",
      kind: "realEstate",
      category: "parking",
      title: "\u041C\u0430\u0448\u0438\u043D\u043E\u043C\u0435\u0441\u0442\u043E, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B",
      flavor: "\u0412\u043E \u0434\u0432\u043E\u0440\u0435 \u043F\u0430\u0440\u043A\u0443\u044E\u0442\u0441\u044F \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E. \u041D\u043E \u0437\u0438\u043C\u043E\u0439, \u043A\u043E\u0433\u0434\u0430 \u0442\u0440\u0430\u043A\u0442\u043E\u0440 \u0437\u0430\u0432\u0430\u043B\u0438\u0442 \u0432\u044B\u0435\u0437\u0434, \u0432\u0441\u0435 \u0432\u0441\u043F\u043E\u043C\u0438\u043D\u0430\u044E\u0442 \u043F\u0440\u043E \u043F\u0430\u0440\u043A\u0438\u043D\u0433.",
      cost: 5e5,
      downPayment: 25e3,
      mortgage: 475e3,
      cashFlow: 1500
    },
    {
      id: "sd-land-iglino",
      kind: "realEstate",
      category: "land",
      title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A 8 \u0441\u043E\u0442\u043E\u043A, \u0418\u0433\u043B\u0438\u043D\u043E (\u043F\u043E\u0434 \u0423\u0444\u043E\u0439)",
      flavor: "\u0413\u0430\u0437 \u043E\u0431\u0435\u0449\u0430\u044E\u0442 \u043A \u0432\u044B\u0431\u043E\u0440\u0430\u043C. \u041A \u043A\u0430\u043A\u0438\u043C \u2014 \u043D\u0435 \u0443\u0442\u043E\u0447\u043D\u044F\u044E\u0442. \u0417\u0430\u0442\u043E \u0430\u0441\u0444\u0430\u043B\u044C\u0442 \u0443\u0436\u0435 \u043F\u043E\u043B\u043E\u0436\u0438\u043B\u0438. \u0417\u0430 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435, \u0431\u0435\u0437 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0438.",
      cost: 4e5,
      downPayment: 4e5,
      mortgage: 0,
      cashFlow: 0
    },
    {
      id: "sd-land-laishevo",
      kind: "realEstate",
      category: "land",
      title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A 10 \u0441\u043E\u0442\u043E\u043A, \u041B\u0430\u0438\u0448\u0435\u0432\u043E (\u043F\u043E\u0434 \u041A\u0430\u0437\u0430\u043D\u044C\u044E)",
      flavor: "\u0414\u043E \u0412\u043E\u043B\u0433\u0438 \u043F\u0435\u0448\u043A\u043E\u043C. \u041A\u0430\u0437\u0430\u043D\u0446\u044B \u0441\u043A\u0443\u043F\u0430\u044E\u0442 \u0432\u0441\u0451, \u0447\u0442\u043E \u0443 \u0432\u043E\u0434\u044B, \u2014 \u043F\u0440\u043E \u044D\u0442\u043E\u0442 \u0431\u0435\u0440\u0435\u0433 \u043F\u043E\u043A\u0430 \u0437\u043D\u0430\u044E\u0442 \u043D\u0435 \u0432\u0441\u0435.",
      cost: 7e5,
      downPayment: 7e5,
      mortgage: 0,
      cashFlow: 0
    },
    {
      id: "sd-land-tukaevo",
      kind: "realEstate",
      category: "land",
      title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A 6 \u0441\u043E\u0442\u043E\u043A, \u0422\u0443\u043A\u0430\u0435\u0432\u0441\u043A\u0438\u0439 \u0440\u0430\u0439\u043E\u043D (\u0443 \u0427\u0435\u043B\u043D\u043E\u0432)",
      flavor: "\u0421\u043E\u0441\u0435\u0434 \u0443\u0436\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u0438\u043B \u0431\u0430\u043D\u044E \u2014 \u0437\u043D\u0430\u0447\u0438\u0442, \u043C\u0435\u0441\u0442\u043E \u0436\u0438\u0432\u043E\u0435. \u0414\u043E\u0445\u043E\u0434\u0430 \u043D\u0435\u0442, \u0440\u0430\u0441\u0447\u0451\u0442 \u043D\u0430 \u043F\u0435\u0440\u0435\u043F\u0440\u043E\u0434\u0430\u0436\u0443.",
      cost: 25e4,
      downPayment: 25e4,
      mortgage: 0,
      cashFlow: 0
    },
    {
      id: "sd-land-m12",
      kind: "realEstate",
      category: "land",
      title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u0443 \u0441\u044A\u0435\u0437\u0434\u0430 \u0441 \u041C-12, \u041F\u0435\u0441\u0442\u0440\u0435\u0447\u0438\u043D\u0441\u043A\u0438\u0439 \u0440\u0430\u0439\u043E\u043D",
      flavor: "\u0422\u0440\u0430\u0441\u0441\u0430 \u0433\u0443\u0434\u0438\u0442 \u2014 \u0446\u0435\u043D\u0430 \u0440\u0430\u0441\u0442\u0451\u0442. \u041A\u0443\u043F\u0438\u043B, \u043F\u043E\u0434\u043E\u0436\u0434\u0430\u043B, \u043F\u0440\u043E\u0434\u0430\u043B. \u0413\u043B\u0430\u0432\u043D\u043E\u0435 \u2014 \u043D\u0435 \u0432\u043B\u044E\u0431\u0438\u0442\u044C\u0441\u044F \u0438 \u043D\u0435 \u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u0434\u043E\u043C.",
      cost: 9e5,
      downPayment: 9e5,
      mortgage: 0,
      cashFlow: 0
    }
  ],
  BIG_DEALS_RU: [
    {
      id: "big-re-kzn-azino",
      kind: "realEstate",
      category: "aptKZN",
      title: "\u041E\u0434\u043D\u0443\u0448\u043A\u0430 \u0432 \u0410\u0437\u0438\u043D\u043E (\u041A\u0430\u0437\u0430\u043D\u044C)",
      text: "\u0425\u043E\u0437\u044F\u0439\u043A\u0430 \u0443\u0435\u0437\u0436\u0430\u0435\u0442 \u043A \u0434\u043E\u0447\u0435\u0440\u0438 \u0438 \u0442\u043E\u0440\u043E\u043F\u0438\u0442\u0441\u044F. \u0420\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u043E\u0442 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430 \u0431\u0435\u0437 \u043F\u0435\u0440\u0435\u043F\u043B\u0430\u0442, \u0436\u0438\u043B\u044C\u0446\u044B \u0443\u0436\u0435 \u0432\u043D\u0443\u0442\u0440\u0438 \u0438 \u043F\u043B\u0430\u0442\u044F\u0442 \u0432\u043E\u0432\u0440\u0435\u043C\u044F.",
      cost: 65e5,
      downPayment: 5e5,
      mortgage: 6e6,
      cashFlow: 31e3
    },
    {
      id: "big-re-kzn-pobedy",
      kind: "realEstate",
      category: "aptKZN",
      title: "\u0414\u0432\u0443\u0448\u043A\u0430 \u0443 \u043C\u0435\u0442\u0440\u043E \xAB\u041F\u0440\u043E\u0441\u043F\u0435\u043A\u0442 \u041F\u043E\u0431\u0435\u0434\u044B\xBB",
      text: "\u041F\u044F\u0442\u044C \u043C\u0438\u043D\u0443\u0442 \u0434\u043E \u043C\u0435\u0442\u0440\u043E, \u0440\u044F\u0434\u043E\u043C \u0441\u0430\u0434\u0438\u043A \u0438 \u0445\u0430\u043B\u044F\u043B\u044C-\u043A\u0430\u0444\u0435. \u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443 \u2014 \u0437\u0430\u0431\u0438\u0440\u0430\u0439, \u043F\u043E\u043A\u0430 \u0441\u043E\u0441\u0435\u0434 \u043D\u0435 \u0437\u0430\u0431\u0440\u0430\u043B.",
      cost: 9e6,
      downPayment: 7e5,
      mortgage: 83e5,
      cashFlow: 23500
    },
    {
      id: "big-re-kzn-itpark",
      kind: "realEstate",
      category: "aptKZN",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F \u0443 \u0418\u0422-\u043F\u0430\u0440\u043A\u0430 (\u041A\u0430\u0437\u0430\u043D\u044C)",
      text: "\u0410\u0439\u0442\u0438\u0448\u043D\u0438\u043A\u0438 \u0441\u0442\u043E\u044F\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u043D\u0430 \u0441\u044A\u0451\u043C. \u041C\u0430\u043B\u0435\u043D\u044C\u043A\u0430\u044F, \u0437\u0430\u0442\u043E \u0441\u0434\u0430\u0451\u0442\u0441\u044F \u0431\u044B\u0441\u0442\u0440\u0435\u0435, \u0447\u0435\u043C \u043E\u0441\u0442\u044B\u0432\u0430\u0435\u0442 \u0447\u0430\u0439.",
      cost: 5e6,
      downPayment: 4e5,
      mortgage: 46e5,
      cashFlow: 22500
    },
    {
      id: "big-re-msk-butovo",
      kind: "realEstate",
      category: "aptMSK",
      title: "\u041E\u0434\u043D\u0443\u0448\u043A\u0430 \u0432 \u0411\u0443\u0442\u043E\u0432\u043E (\u041C\u043E\u0441\u043A\u0432\u0430)",
      text: "\u041C\u043E\u0441\u043A\u0432\u0430 \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0441 \u0411\u0443\u0442\u043E\u0432\u043E. \u0422\u0438\u0445\u0438\u0439 \u0434\u0432\u043E\u0440, \u043C\u0435\u0442\u0440\u043E \u0440\u044F\u0434\u043E\u043C, \u0430\u0440\u0435\u043D\u0434\u0430\u0442\u043E\u0440 \u2014 \u0441\u0435\u0440\u044C\u0451\u0437\u043D\u044B\u0439 \u0431\u0443\u0445\u0433\u0430\u043B\u0442\u0435\u0440. \u041E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 12e6,
      downPayment: 1e6,
      mortgage: 11e6,
      cashFlow: 38e3
    },
    {
      id: "big-re-msk-ttk",
      kind: "realEstate",
      category: "aptMSK",
      title: "\u0414\u0432\u0443\u0448\u043A\u0430 \u0443 \u0422\u0422\u041A (\u041C\u043E\u0441\u043A\u0432\u0430)",
      text: "\u0412\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u0440\u0430\u0441\u0448\u0438\u0440\u044F\u0435\u0442 \u0441\u0432\u043E\u0451 \u0434\u0435\u043B\u043E \u0438 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0441 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u043E\u0439. \u0410\u0440\u0435\u043D\u0434\u0430 \u0434\u043E\u0440\u043E\u0433\u0430\u044F, \u0441\u043F\u0440\u043E\u0441 \u0432\u0435\u0447\u043D\u044B\u0439 \u2014 \u041C\u043E\u0441\u043A\u0432\u0430 \u0436\u0435.",
      cost: 22e6,
      downPayment: 18e5,
      mortgage: 202e5,
      cashFlow: 62500
    },
    {
      id: "big-re-msk-city",
      kind: "realEstate",
      category: "aptMSK",
      title: "\u0410\u043F\u0430\u0440\u0442\u0430\u043C\u0435\u043D\u0442\u044B \u0432 \u0431\u0430\u0448\u043D\u0435 \u0443 \xAB\u0421\u0438\u0442\u0438\xBB",
      text: "\u0412\u0438\u0434 \u2014 \u043C\u0438\u043B\u043B\u0438\u043E\u043D, \u0441\u0442\u0430\u0442\u0443\u0441 \u2014 \u0434\u0432\u0430. \u041D\u043E \u0432\u0437\u043D\u043E\u0441\u044B \u0431\u0430\u0448\u043D\u0438 \u0438 \u043A\u043E\u043C\u043C\u0443\u043D\u0430\u043B\u043A\u0430 \u0441\u044A\u0435\u0434\u0430\u044E\u0442 \u0432\u0441\u0451: \u043F\u043E\u0441\u043B\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0430 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0438 \u0443\u0445\u043E\u0434\u0438\u0448\u044C \u0432 \u043C\u0438\u043D\u0443\u0441. \u0417\u0430\u0442\u043E \u043A\u0440\u0430\u0441\u0438\u0432\u043E \u0432 \u0441\u0442\u043E\u0440\u0438\u0441.",
      cost: 3e7,
      downPayment: 2e6,
      mortgage: 28e6,
      cashFlow: -27500
    },
    {
      id: "big-re-spb-kupchino",
      kind: "realEstate",
      category: "aptSPB",
      title: "\u041E\u0434\u043D\u0443\u0448\u043A\u0430 \u0432 \u041A\u0443\u043F\u0447\u0438\u043D\u043E (\u041F\u0438\u0442\u0435\u0440)",
      text: "\u041A\u043B\u0430\u0441\u0441\u0438\u043A\u0430 \u041F\u0438\u0442\u0435\u0440\u0430: \u0441\u0435\u0440\u044B\u0439 \u0434\u043E\u043C, \u0442\u0451\u043F\u043B\u044B\u0435 \u0431\u0430\u0442\u0430\u0440\u0435\u0438, \u043D\u0430\u0434\u0451\u0436\u043D\u044B\u0439 \u0436\u0438\u043B\u0435\u0446. \u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446 \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443 \u2014 \u0442\u043E\u0440\u043E\u043F\u0438\u0442\u0441\u044F \u043D\u0430 \u0434\u0430\u0447\u0443.",
      cost: 8e6,
      downPayment: 6e5,
      mortgage: 74e5,
      cashFlow: 25500
    },
    {
      id: "big-re-spb-vasilevsky",
      kind: "realEstate",
      category: "aptSPB",
      title: "\u0414\u0432\u0443\u0448\u043A\u0430 \u043D\u0430 \u0412\u0430\u0441\u0438\u043B\u044C\u0435\u0432\u0441\u043A\u043E\u043C",
      text: "\u0411\u0435\u043B\u044B\u0435 \u043D\u043E\u0447\u0438, \u0442\u0443\u0440\u0438\u0441\u0442\u044B, \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u044B \u2014 \u0436\u0438\u043B\u044C\u0451 \u043F\u0443\u0441\u0442\u044B\u043C \u043D\u0435 \u0441\u0442\u043E\u0438\u0442. \u0420\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u043E\u0442 \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430, \u043F\u0435\u0440\u0432\u044B\u0439 \u0432\u0437\u043D\u043E\u0441 \u0441\u043A\u0440\u043E\u043C\u043D\u044B\u0439.",
      cost: 14e6,
      downPayment: 12e5,
      mortgage: 128e5,
      cashFlow: 61500
    },
    {
      id: "big-re-dxb-jvc",
      kind: "realEstate",
      category: "aptDXB",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F \u0432 \u0414\u0443\u0431\u0430\u0435 (\u0440\u0430\u0439\u043E\u043D JVC)",
      text: "\u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443 \u0434\u043E \u0441\u0430\u043C\u044B\u0445 \u043A\u043B\u044E\u0447\u0435\u0439. \u0410\u0440\u0435\u043D\u0434\u0430 \u0432 \u0434\u0438\u0440\u0445\u0430\u043C\u0430\u0445 \u2014 \u043F\u043E\u0442\u043E\u043A \u0432 \u0440\u0443\u0431\u043B\u044F\u0445 \u0440\u0430\u0434\u0443\u0435\u0442 \u0433\u043B\u0430\u0437.",
      cost: 18e6,
      downPayment: 15e5,
      mortgage: 165e5,
      cashFlow: 52500
    },
    {
      id: "big-re-dxb-marina",
      kind: "realEstate",
      category: "aptDXB",
      title: "\u0410\u043F\u0430\u0440\u0442\u0430\u043C\u0435\u043D\u0442\u044B \u0443 \u0414\u0443\u0431\u0430\u0439-\u041C\u0430\u0440\u0438\u043D\u044B",
      text: "\u0422\u0443\u0440\u0438\u0441\u0442\u044B \u043F\u043B\u0430\u0442\u044F\u0442 \u043A\u0440\u0443\u0433\u043B\u044B\u0439 \u0433\u043E\u0434, \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0430\u044F \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u0432\u0441\u0451 \u0434\u0435\u043B\u0430\u0435\u0442 \u0441\u0430\u043C\u0430. \u0412\u0445\u043E\u0434 \u0434\u043E\u0440\u043E\u0433\u043E\u0439, \u0437\u0430\u0442\u043E \u043F\u043E\u0442\u043E\u043A \u2014 \u043A\u0430\u043A \u043D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u0430\u044F \u0432 \u043F\u044F\u0442\u043D\u0438\u0446\u0443 \u0432\u0435\u0447\u0435\u0440\u043E\u043C.",
      cost: 28e6,
      downPayment: 2e6,
      mortgage: 26e6,
      cashFlow: 107500
    },
    {
      id: "big-re-tur-alanya",
      kind: "realEstate",
      category: "aptTUR",
      title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 1+1 \u0432 \u0410\u043B\u0430\u043D\u0438\u0438",
      text: "\u041C\u043E\u0440\u0435 \u0447\u0435\u0440\u0435\u0437 \u0434\u043E\u0440\u043E\u0433\u0443, \u0437\u0438\u043C\u043E\u0432\u0449\u0438\u043A\u0438 \u0438\u0437 \u0420\u043E\u0441\u0441\u0438\u0438 \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C. \u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443 \u2014 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0434\u0432\u0435 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B.",
      cost: 75e5,
      downPayment: 6e5,
      mortgage: 69e5,
      cashFlow: 3e4
    },
    {
      id: "big-re-tur-istanbul",
      kind: "realEstate",
      category: "aptTUR",
      title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0432 \u043D\u043E\u0432\u043E\u043C \u0440\u0430\u0439\u043E\u043D\u0435 \u0421\u0442\u0430\u043C\u0431\u0443\u043B\u0430",
      text: "\u0420\u0430\u0439\u043E\u043D \u0440\u0430\u0441\u0442\u0451\u0442, \u043D\u043E \u043F\u043E\u043A\u0430 \u043F\u043E\u043B\u0443\u043F\u0443\u0441\u0442\u043E\u0439: \u0436\u0438\u043B\u044C\u0446\u044B \u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F, \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439 \u0431\u0435\u0440\u0451\u0442 \u0441\u0432\u043E\u0451. \u041F\u043E\u0441\u043B\u0435 \u043F\u043B\u0430\u0442\u0435\u0436\u0430 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0438 \u2014 \u043D\u0435\u0431\u043E\u043B\u044C\u0448\u043E\u0439 \u043C\u0438\u043D\u0443\u0441. \u0421\u0442\u0430\u0432\u043A\u0430 \u043D\u0430 \u0440\u043E\u0441\u0442.",
      cost: 11e6,
      downPayment: 9e5,
      mortgage: 101e5,
      cashFlow: -13e3
    },
    {
      id: "big-re-house-zubovo",
      kind: "realEstate",
      category: "houseRF",
      title: "\u0414\u043E\u043C \u0432 \u0417\u0443\u0431\u043E\u0432\u043E (\u043F\u0440\u0438\u0433\u043E\u0440\u043E\u0434 \u0423\u0444\u044B)",
      text: "\u0421\u0435\u043C\u044C\u044F \u0441 \u0442\u0440\u0435\u043C\u044F \u0434\u0435\u0442\u044C\u043C\u0438 \u0433\u043E\u0442\u043E\u0432\u0430 \u0441\u043D\u0438\u043C\u0430\u0442\u044C \u0433\u043E\u0434\u0430\u043C\u0438 \u2014 \u0438\u043C \u043D\u0443\u0436\u0435\u043D \u0434\u0432\u043E\u0440 \u0438 \u043C\u0430\u043D\u0433\u0430\u043B. \u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446 \u0441\u043E\u0433\u043B\u0430\u0441\u0435\u043D \u043D\u0430 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 12e6,
      downPayment: 1e6,
      mortgage: 11e6,
      cashFlow: 45e3
    },
    {
      id: "big-re-house-kama",
      kind: "realEstate",
      category: "houseRF",
      title: "\u0414\u043E\u043C \u0443 \u041A\u0430\u043C\u044B \u043F\u043E\u0434 \u043F\u043E\u0441\u0443\u0442\u043E\u0447\u043D\u0443\u044E \u0441\u0434\u0430\u0447\u0443",
      text: "\u0411\u0430\u043D\u044F, \u043F\u0440\u0438\u0447\u0430\u043B, \u0431\u0435\u0441\u0435\u0434\u043A\u0430. \u041B\u0435\u0442\u043E\u043C \u0431\u0440\u043E\u043D\u044C \u043D\u0430 \u043C\u0435\u0441\u044F\u0446 \u0432\u043F\u0435\u0440\u0451\u0434, \u0437\u0438\u043C\u043E\u0439 \u2014 \u043A\u043E\u0440\u043F\u043E\u0440\u0430\u0442\u0438\u0432\u044B. \u0425\u043E\u0437\u044F\u0438\u043D \u0443\u0441\u0442\u0430\u043B \u043E\u0442 \u0433\u043E\u0441\u0442\u0435\u0439 \u0438 \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 15e6,
      downPayment: 13e5,
      mortgage: 137e5,
      cashFlow: 39500
    },
    {
      id: "big-re-chelny-studio",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F \u0432 \u041D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u044B\u0445 \u0427\u0435\u043B\u043D\u0430\u0445",
      text: "\u0420\u044F\u0434\u043E\u043C \u0437\u0430\u0432\u043E\u0434 \u2014 \u0432\u0430\u0445\u0442\u043E\u0432\u0438\u043A\u0438 \u0441\u043D\u0438\u043C\u0430\u044E\u0442 \u0431\u0435\u0437 \u0442\u043E\u0440\u0433\u0430. \u0412\u0437\u043D\u043E\u0441 \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0439, \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u043E\u0442 \u0437\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A\u0430 \u0447\u0435\u0441\u0442\u043D\u0430\u044F.",
      cost: 4e6,
      downPayment: 3e5,
      mortgage: 37e5,
      cashFlow: 10500
    },
    {
      id: "big-re-ufa-arena-studio",
      kind: "realEstate",
      category: "roomUFA",
      title: "\u0421\u0442\u0443\u0434\u0438\u044F \u0443 \xAB\u0423\u0444\u0430-\u0410\u0440\u0435\u043D\u044B\xBB",
      text: "\u0421\u0442\u0443\u0434\u0435\u043D\u0442\u044B \u0438 \u0431\u043E\u043B\u0435\u043B\u044C\u0449\u0438\u043A\u0438 \u2014 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0438\u0437 \u0436\u0435\u043B\u0430\u044E\u0449\u0438\u0445 \u0441\u043D\u044F\u0442\u044C. \u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446 \u043F\u0435\u0440\u0435\u0435\u0437\u0436\u0430\u0435\u0442 \u0432 \u041A\u0430\u0437\u0430\u043D\u044C \u0438 \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 45e5,
      downPayment: 4e5,
      mortgage: 41e5,
      cashFlow: 13500
    },
    {
      id: "big-biz-bakery-ufa",
      kind: "business",
      category: "bizFood",
      title: "\u041F\u0435\u043A\u0430\u0440\u043D\u044F \u0432 \u0423\u0444\u0435",
      text: "\u0417\u0430\u043F\u0430\u0445 \u0441\u0432\u0435\u0436\u0435\u0433\u043E \u0445\u043B\u0435\u0431\u0430 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0441\u0430\u043C. \u041F\u0435\u0447\u0438, \u0442\u0430\u043D\u0434\u044B\u0440 \u0438 \u043E\u0431\u0443\u0447\u0435\u043D\u043D\u0430\u044F \u0441\u043C\u0435\u043D\u0430 \u2014 \u0445\u043E\u0437\u044F\u0438\u043D \u0443\u0445\u043E\u0434\u0438\u0442 \u043D\u0430 \u043F\u043E\u043A\u043E\u0439, \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 35e5,
      downPayment: 5e5,
      liability: 3e6,
      cashFlow: 70500
    },
    {
      id: "big-biz-halal-cafe-kzn",
      kind: "business",
      category: "bizFood",
      title: "\u0425\u0430\u043B\u044F\u043B\u044C-\u043A\u0430\u0444\u0435 \u0432 \u041A\u0430\u0437\u0430\u043D\u0438",
      text: "\u041C\u0435\u0441\u0442\u043E \u0443 \u043C\u0435\u0447\u0435\u0442\u0438, \u043E\u0431\u0435\u0434\u044B \u0440\u0430\u0437\u043B\u0435\u0442\u0430\u044E\u0442\u0441\u044F \u043A \u0447\u0430\u0441\u0443 \u0434\u043D\u044F. \u041F\u043E\u0432\u0430\u0440 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F, \u0440\u0435\u0446\u0435\u043F\u0442\u044B \u0432 \u043F\u043E\u0434\u0430\u0440\u043E\u043A, \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 6e6,
      downPayment: 8e5,
      liability: 52e5,
      cashFlow: 103e3
    },
    {
      id: "big-biz-carwash-chelny",
      kind: "business",
      category: "bizService",
      title: "\u0410\u0432\u0442\u043E\u043C\u043E\u0439\u043A\u0430 \u0441\u0430\u043C\u043E\u043E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u044F (\u0427\u0435\u043B\u043D\u044B)",
      text: "\u0428\u0435\u0441\u0442\u044C \u043F\u043E\u0441\u0442\u043E\u0432, \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u043A\u0440\u0443\u0433\u043B\u044B\u0435 \u0441\u0443\u0442\u043A\u0438 \u0438 \u0437\u0430\u0440\u043F\u043B\u0430\u0442\u0443 \u043D\u0435 \u043F\u0440\u043E\u0441\u044F\u0442. \u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446 \u0443\u0435\u0437\u0436\u0430\u0435\u0442 \u0438 \u043E\u0442\u0434\u0430\u0451\u0442 \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 8e6,
      downPayment: 1e6,
      liability: 7e6,
      cashFlow: 126e3
    },
    {
      id: "big-biz-darkstore-msk",
      kind: "business",
      category: "bizFood",
      title: "\u0414\u0430\u0440\u043A-\u0441\u0442\u043E\u0440 \u0432 \u041C\u043E\u0441\u043A\u0432\u0435",
      text: "\u0421\u043A\u043B\u0430\u0434, \u043A\u0443\u0440\u044C\u0435\u0440\u044B \u0438 \u0433\u043E\u0440\u043E\u0434, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0445\u043E\u0447\u0435\u0442 \u0435\u0441\u0442\u044C \u043D\u043E\u0447\u044C\u044E. \u0417\u0430\u043A\u0430\u0437\u044B \u0440\u0430\u0441\u0442\u0443\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u0441\u044F\u0446, \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 12e6,
      downPayment: 15e5,
      liability: 105e5,
      cashFlow: 228500
    },
    {
      id: "big-biz-pvz-ufa",
      kind: "business",
      category: "bizService",
      title: "\u041F\u0443\u043D\u043A\u0442 \u0432\u044B\u0434\u0430\u0447\u0438 \u0437\u0430\u043A\u0430\u0437\u043E\u0432 (\u0423\u0444\u0430)",
      text: "\u041B\u044E\u0434\u0438 \u0437\u0430\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442 \u0432\u0441\u0451 \u043F\u043E\u0434\u0440\u044F\u0434 \u2014 \u0432\u044B\u0434\u0430\u0432\u0430\u0442\u044C \u043A\u043E\u043C\u0443-\u0442\u043E \u043D\u0430\u0434\u043E. \u0410\u0440\u0435\u043D\u0434\u0430 \u043A\u043E\u043F\u0435\u0435\u0447\u043D\u0430\u044F, \u0440\u0430\u0439\u043E\u043D \u0440\u0430\u0441\u0442\u0451\u0442. \u0420\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0430 \u043E\u0442 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430.",
      cost: 15e5,
      downPayment: 3e5,
      liability: 12e5,
      cashFlow: 26e3
    },
    {
      id: "big-biz-barbershop-kzn",
      kind: "business",
      category: "bizService",
      title: "\u0411\u0430\u0440\u0431\u0435\u0440\u0448\u043E\u043F \u0432 \u041A\u0430\u0437\u0430\u043D\u0438",
      text: "\u041A\u0440\u0435\u0441\u043B\u0430 \u0437\u0430\u043D\u044F\u0442\u044B, \u0431\u043E\u0440\u043E\u0434\u0430 \u0432 \u043C\u043E\u0434\u0435 \u0434\u0435\u0441\u044F\u0442\u044C \u043B\u0435\u0442 \u0438 \u0441\u0434\u0430\u0432\u0430\u0442\u044C\u0441\u044F \u043D\u0435 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F. \u041C\u0430\u0441\u0442\u0435\u0440\u0430 \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F, \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 25e5,
      downPayment: 4e5,
      liability: 21e5,
      cashFlow: 39e3
    },
    {
      id: "big-biz-kids-center-ufa",
      kind: "business",
      category: "bizService",
      title: "\u0414\u0435\u0442\u0441\u043A\u0438\u0439 \u0446\u0435\u043D\u0442\u0440 \u0432 \u0423\u0444\u0435",
      text: "\u0420\u043E\u0434\u0438\u0442\u0435\u043B\u0438 \u0433\u043E\u0442\u043E\u0432\u044B \u043F\u043B\u0430\u0442\u0438\u0442\u044C \u0437\u0430 \u0447\u0430\u0441 \u0442\u0438\u0448\u0438\u043D\u044B. \u0413\u0440\u0443\u043F\u043F\u044B \u043D\u0430\u0431\u0440\u0430\u043D\u044B \u0434\u043E \u043B\u0435\u0442\u0430, \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u044F \u0435\u0441\u0442\u044C, \u0432\u043B\u0430\u0434\u0435\u043B\u0438\u0446\u0430 \u0434\u0430\u0451\u0442 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 4e6,
      downPayment: 6e5,
      liability: 34e5,
      cashFlow: 86e3
    },
    {
      id: "big-biz-shaurma-spb",
      kind: "business",
      category: "bizFood",
      title: "\u0421\u0435\u0442\u044C \u0448\u0430\u0443\u0440\u043C\u044B \u0432 \u041F\u0438\u0442\u0435\u0440\u0435 (3 \u0442\u043E\u0447\u043A\u0438)",
      text: "\u0428\u0430\u0443\u0440\u043C\u0430 \u0432 \u041F\u0438\u0442\u0435\u0440\u0435 \u2014 \u0442\u0432\u0451\u0440\u0434\u0430\u044F \u0432\u0430\u043B\u044E\u0442\u0430. \u0422\u0440\u0438 \u0442\u043E\u0447\u043A\u0438 \u0443 \u043C\u0435\u0442\u0440\u043E, \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0438 \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u043B\u0443\u043D\u043E\u0447\u0438. \u0412\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u0443\u0445\u043E\u0434\u0438\u0442 \u0432 \u0441\u0442\u0440\u043E\u0439\u043A\u0443, \u043E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 9e6,
      downPayment: 12e5,
      liability: 78e5,
      cashFlow: 183500
    },
    {
      id: "big-biz-print-kzn",
      kind: "business",
      category: "bizService",
      title: "\u0422\u0438\u043F\u043E\u0433\u0440\u0430\u0444\u0438\u044F \u0432 \u041A\u0430\u0437\u0430\u043D\u0438",
      text: "\u041F\u0435\u0447\u0430\u0442\u0430\u0435\u0442 \u043C\u0435\u043D\u044E, \u043A\u043E\u0440\u043E\u0431\u043A\u0438 \u0438 \u0441\u0432\u0430\u0434\u0435\u0431\u043D\u044B\u0435 \u043F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044F \u2014 \u0430 \u0441\u0432\u0430\u0434\u044C\u0431\u044B \u0432 \u041A\u0430\u0437\u0430\u043D\u0438 \u043D\u0435 \u043A\u043E\u043D\u0447\u0430\u044E\u0442\u0441\u044F \u043D\u0438\u043A\u043E\u0433\u0434\u0430. \u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 5e6,
      downPayment: 7e5,
      liability: 43e5,
      cashFlow: 74500
    },
    {
      id: "big-biz-online-store",
      kind: "business",
      category: "bizDigital",
      title: "\u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442-\u043C\u0430\u0433\u0430\u0437\u0438\u043D \u043F\u043E\u0434\u0430\u0440\u043A\u043E\u0432",
      text: "\u0421\u0430\u0439\u0442, \u0441\u043A\u043B\u0430\u0434 \u0443 \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0430 \u0438 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u044B\u0435 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u0438. \u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0438\u0437 \u043B\u044E\u0431\u043E\u0439 \u0442\u043E\u0447\u043A\u0438, \u0433\u0434\u0435 \u043B\u043E\u0432\u0438\u0442 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442. \u041E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 3e6,
      downPayment: 5e5,
      liability: 25e5,
      cashFlow: 56500
    },
    {
      id: "big-biz-scooters-kzn",
      kind: "business",
      category: "bizService",
      title: "\u041F\u0440\u043E\u043A\u0430\u0442 \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u043E\u0432 (\u041A\u0430\u0437\u0430\u043D\u044C)",
      text: "\u0421\u0442\u043E \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u043E\u0432, \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0438 \u043D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u0430\u044F. \u041B\u0435\u0442\u043E\u043C \u2014 \u0437\u043E\u043B\u043E\u0442\u0430\u044F \u0436\u0438\u043B\u0430, \u0437\u0438\u043C\u043E\u0439 \u2014 \u0441\u043A\u043B\u0430\u0434, \u043D\u043E \u0432 \u0441\u0440\u0435\u0434\u043D\u0435\u043C \u043F\u043E \u0433\u043E\u0434\u0443 \u043F\u043E\u0442\u043E\u043A \u0443\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0439. \u041E\u0441\u0442\u0430\u0442\u043E\u043A \u2014 \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443.",
      cost: 7e6,
      downPayment: 9e5,
      liability: 61e5,
      cashFlow: 128e3
    },
    {
      id: "big-partner-start-basic",
      kind: "business",
      category: "partnership",
      title: "\u041F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u043A\u0430\u044F \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430: \u0441\u0442\u0430\u0440\u0442\u043E\u0432\u044B\u0439 \u043F\u0430\u043A\u0435\u0442",
      text: "\u041A\u0443\u043F\u0438\u043B \u043F\u0440\u043E\u0434\u0443\u043A\u0446\u0438\u044E \u043D\u0430 \u043F\u0440\u043E\u0431\u0443 \u2014 \u043F\u043E\u043B\u0443\u0447\u0438\u043B \u043C\u0435\u0441\u0442\u043E \u0432 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u043A\u043E\u0439 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0435. \u041F\u0440\u0438\u0432\u0451\u043B \u043B\u044E\u0434\u0435\u0439 \u2014 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u043F\u043B\u0430\u0442\u0438\u0442 \u043F\u0440\u043E\u0446\u0435\u043D\u0442 \u0441 \u0438\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430. \u0421\u0430\u043C\u043E \u043D\u0435 \u0440\u0430\u0441\u0442\u0451\u0442: \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 \u043D\u0430\u0434\u043E \u0437\u0430\u043D\u0438\u043C\u0430\u0442\u044C\u0441\u044F.",
      cost: 28900,
      downPayment: 28900,
      liability: 0,
      cashFlow: 1700,
      growthPerPayday: 400,
      growthCap: 9e3
    },
    {
      id: "big-partner-start-team",
      kind: "business",
      category: "partnership",
      title: "\u0421\u0442\u0430\u0440\u0442\u043E\u0432\u044B\u0439 \u043F\u0430\u043A\u0435\u0442 + \u043F\u0435\u0440\u0432\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430",
      text: "\u0422\u0440\u043E\u0435 \u0437\u043D\u0430\u043A\u043E\u043C\u044B\u0445 \u0443\u0436\u0435 \u043F\u043E\u043A\u0443\u043F\u0430\u044E\u0442 \u043F\u0440\u043E\u0434\u0443\u043A\u0446\u0438\u044E \u043A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u0441\u044F\u0446. \u0414\u0430\u043B\u044C\u0448\u0435 \u2014 \u0432\u0441\u0442\u0440\u0435\u0447\u0438, \u0447\u0430\u0439 \u0438 \u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440\u044B: \u043F\u0440\u043E\u0446\u0435\u043D\u0442 \u0441 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430 \u0440\u0430\u0441\u0442\u0451\u0442, \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0440\u0430\u0441\u0442\u0451\u0442 \u043A\u043E\u043C\u0430\u043D\u0434\u0430.",
      cost: 28900,
      downPayment: 28900,
      liability: 0,
      cashFlow: 1700,
      growthPerPayday: 400,
      growthCap: 9e3
    },
    {
      id: "big-partner-start-online",
      kind: "business",
      category: "partnership",
      title: "\u0421\u0442\u0430\u0440\u0442\u043E\u0432\u044B\u0439 \u043F\u0430\u043A\u0435\u0442: \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0447\u0435\u0440\u0435\u0437 \u0431\u043B\u043E\u0433",
      text: "\u0412\u0435\u0434\u0451\u0448\u044C \u0431\u043B\u043E\u0433 \u2014 \u043B\u044E\u0434\u0438 \u043F\u0440\u0438\u0445\u043E\u0434\u044F\u0442 \u0441\u0430\u043C\u0438. \u041A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u043F\u043B\u0430\u0442\u0438\u0442 \u043F\u0440\u043E\u0446\u0435\u043D\u0442 \u0441 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u044B. \u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442, \u043F\u043E\u043A\u0430 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0448\u044C \u0442\u044B: \u0431\u0440\u043E\u0441\u0438\u0448\u044C \u2014 \u043F\u0440\u0438\u0442\u043E\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F.",
      cost: 28900,
      downPayment: 28900,
      liability: 0,
      cashFlow: 1700,
      growthPerPayday: 400,
      growthCap: 9e3
    },
    {
      id: "big-partner-expand",
      kind: "business",
      category: "partnership",
      title: "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u044B\u0439 \u043F\u0430\u043A\u0435\u0442 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0430",
      text: "\u041F\u043E\u043B\u043D\u044B\u0439 \u043D\u0430\u0431\u043E\u0440 \u043F\u0440\u043E\u0434\u0443\u043A\u0446\u0438\u0438 \u0438 \u0441\u0442\u0430\u0440\u0448\u0438\u0439 \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A \u0432 \u043F\u0440\u0438\u0434\u0430\u0447\u0443. \u041F\u0440\u043E\u0446\u0435\u043D\u0442 \u0441 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430 \u0432\u044B\u0448\u0435, \u043D\u043E \u0438 \u0441\u043F\u0440\u043E\u0441 \u0441 \u0442\u0435\u0431\u044F \u0431\u043E\u043B\u044C\u0448\u0435: \u043A\u043E\u043C\u0430\u043D\u0434\u0443 \u043D\u0430\u0434\u043E \u0443\u0447\u0438\u0442\u044C, \u0430 \u043D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0432\u0430\u0442\u044C.",
      cost: 86700,
      downPayment: 86700,
      liability: 0,
      cashFlow: 5200,
      growthPerPayday: 900,
      growthCap: 22e3
    },
    {
      id: "big-partner-expand-leader",
      kind: "business",
      category: "partnership",
      title: "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u043D\u044B\u0439 \u043F\u0430\u043A\u0435\u0442: \u043F\u0443\u0442\u044C \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A\u0430",
      text: "\u0417\u0430\u0445\u043E\u0434\u0438\u0448\u044C \u0441\u0440\u0430\u0437\u0443 \u0432\u0441\u0435\u0440\u044C\u0451\u0437: \u043E\u0431\u0443\u0447\u0430\u0435\u0448\u044C \u043D\u043E\u0432\u0438\u0447\u043A\u043E\u0432, \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u043F\u043B\u0430\u0442\u0438\u0442 \u043F\u0440\u043E\u0446\u0435\u043D\u0442 \u0441 \u0442\u043E\u0432\u0430\u0440\u043E\u043E\u0431\u043E\u0440\u043E\u0442\u0430 \u0432\u0441\u0435\u0439 \u043A\u043E\u043C\u0430\u043D\u0434\u044B. \u0427\u0435\u043C \u0431\u043E\u043B\u044C\u0448\u0435 \u043F\u043E\u043C\u043E\u0433\u0430\u0435\u0448\u044C \u043B\u044E\u0434\u044F\u043C \u2014 \u0442\u0435\u043C \u0442\u043E\u043B\u0449\u0435 \u043A\u043E\u043D\u0432\u0435\u0440\u0442 \u0432 \u0434\u0435\u043D\u044C \u0437\u0430\u0440\u043F\u043B\u0430\u0442\u044B.",
      cost: 86700,
      downPayment: 86700,
      liability: 0,
      cashFlow: 5200,
      growthPerPayday: 900,
      growthCap: 22e3
    }
  ],
  MARKET_CARDS_RU: [
    {
      id: "mkt-sell-room-ufa",
      deck: "market",
      kind: "sellOffer",
      category: "roomUFA",
      multiplierPct: 130,
      title: "\u041A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0439 \u0430\u0436\u0438\u043E\u0442\u0430\u0436 \u0432 \u0423\u0444\u0435",
      text: "\u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A \u0440\u0430\u0441\u0441\u0435\u043B\u044F\u0435\u0442 \u0441\u0442\u0430\u0440\u044B\u0439 \u043A\u0432\u0430\u0440\u0442\u0430\u043B \u043F\u043E\u0434 \u043D\u043E\u0432\u044B\u0439 \u0416\u041A \u0438 \u0441\u043A\u0443\u043F\u0430\u0435\u0442 \u0412\u0421\u0415 \u043A\u043E\u043C\u043D\u0430\u0442\u044B \u0438 \u0441\u0442\u0443\u0434\u0438\u0438. \u0414\u0430\u0451\u0442 130% \u043E\u0442 \u0446\u0435\u043D\u044B. \u0414\u0435\u0440\u0436\u0430\u043B \u043A\u043E\u043C\u043D\u0430\u0442\u0443 \u2014 \u043F\u0440\u0438\u0448\u043B\u043E \u0442\u0432\u043E\u0451 \u0432\u0440\u0435\u043C\u044F."
    },
    {
      id: "mkt-sell-apt-kzn",
      deck: "market",
      kind: "sellOffer",
      category: "aptKZN",
      multiplierPct: 140,
      title: "\u041A\u0430\u0437\u0430\u043D\u044C \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0435\u0442 \u0432\u0441\u0435\u0445",
      text: "\u0411\u043E\u043B\u044C\u0448\u043E\u0439 \u0444\u043E\u0440\u0443\u043C, \u043E\u0442\u0435\u043B\u0438 \u0437\u0430\u0431\u0438\u0442\u044B \u0434\u043E \u043A\u0440\u044B\u0448\u0438. \u0418\u043D\u0432\u0435\u0441\u0442\u043E\u0440\u044B \u0445\u0432\u0430\u0442\u0430\u044E\u0442 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u043F\u043E\u0434 \u043F\u043E\u0441\u0443\u0442\u043E\u0447\u043D\u0443\u044E \u0441\u0434\u0430\u0447\u0443 \u0438 \u0434\u0430\u044E\u0442 140% \u043B\u044E\u0431\u043E\u043C\u0443 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0443 \u0436\u0438\u043B\u044C\u044F \u0432 \u041A\u0430\u0437\u0430\u043D\u0438."
    },
    {
      id: "mkt-sell-apt-msk",
      deck: "market",
      kind: "sellOffer",
      category: "aptMSK",
      multiplierPct: 125,
      title: "\u041C\u043E\u0441\u043A\u0432\u0430 \u043D\u0435 \u0440\u0435\u0437\u0438\u043D\u043E\u0432\u0430\u044F, \u043D\u043E \u0434\u043E\u0440\u043E\u0433\u0430\u044F",
      text: "\u041A\u0440\u0443\u043F\u043D\u0430\u044F \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F \u043F\u0435\u0440\u0435\u0432\u043E\u0437\u0438\u0442 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432 \u0432 \u0441\u0442\u043E\u043B\u0438\u0446\u0443 \u0438 \u0432\u044B\u043A\u0443\u043F\u0430\u0435\u0442 \u0436\u0438\u043B\u044C\u0451 \u043F\u0430\u0447\u043A\u0430\u043C\u0438. \u0417\u0430 \u043C\u043E\u0441\u043A\u043E\u0432\u0441\u043A\u0443\u044E \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u0443 \u0434\u0430\u044E\u0442 125% \u2014 \u0438 \u0434\u0430\u0436\u0435 \u043D\u0435 \u0442\u043E\u0440\u0433\u0443\u044E\u0442\u0441\u044F."
    },
    {
      id: "mkt-sell-apt-spb",
      deck: "market",
      kind: "sellOffer",
      category: "aptSPB",
      multiplierPct: 135,
      title: "\u041F\u0438\u0442\u0435\u0440 \u0432\u0434\u043E\u0445\u043D\u043E\u0432\u043B\u044F\u0435\u0442",
      text: "\u0421\u0435\u0440\u0438\u0430\u043B \u043F\u0440\u043E \u041F\u0438\u0442\u0435\u0440 \u043F\u043E\u0440\u0432\u0430\u043B \u0432\u0441\u0435 \u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0438 \u2014 \u0440\u043E\u043C\u0430\u043D\u0442\u0438\u043A\u0438 \u0441\u043A\u0443\u043F\u0430\u044E\u0442 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0441 \u0432\u0438\u0434\u043E\u043C \u043D\u0430 \u0434\u0432\u043E\u0440\u044B-\u043A\u043E\u043B\u043E\u0434\u0446\u044B. \u0417\u0430 \u043F\u0438\u0442\u0435\u0440\u0441\u043A\u043E\u0435 \u0436\u0438\u043B\u044C\u0451 \u0434\u0430\u044E\u0442 135%. \u0421\u044B\u0440\u043E\u0441\u0442\u044C \u0432 \u043F\u043E\u0434\u0430\u0440\u043E\u043A."
    },
    {
      id: "mkt-sell-apt-dxb",
      deck: "market",
      kind: "sellOffer",
      category: "aptDXB",
      multiplierPct: 65,
      title: "\u041F\u0430\u043D\u0438\u043A\u0430 \u0432 \u0414\u0443\u0431\u0430\u0435",
      text: "\u0412\u043E\u0439\u043D\u0430 \u043D\u0430 \u0411\u043B\u0438\u0436\u043D\u0435\u043C \u0412\u043E\u0441\u0442\u043E\u043A\u0435. \u0418\u043D\u0432\u0435\u0441\u0442\u043E\u0440\u044B \u0431\u0435\u0433\u0443\u0442, \u043F\u0435\u0440\u0435\u043A\u0443\u043F\u0449\u0438\u043A\u0438 \u0434\u0430\u044E\u0442 \u0432\u0441\u0435\u0433\u043E 65% \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u0414\u0443\u0431\u0430\u0435. \u041A\u0442\u043E-\u0442\u043E \u0442\u0435\u0440\u044F\u0435\u0442 \u0432\u0441\u0451, \u0430 \u043A\u0442\u043E-\u0442\u043E \u043F\u043E\u043A\u0443\u043F\u0430\u0435\u0442 \u0434\u043D\u043E."
    },
    {
      id: "mkt-sell-apt-tur",
      deck: "market",
      kind: "sellOffer",
      category: "aptTUR",
      multiplierPct: 180,
      title: "\u0422\u0443\u0440\u0435\u0446\u043A\u0438\u0439 \u0431\u0443\u043C",
      text: "\u041B\u0438\u0440\u0430 \u043F\u0440\u043E\u0441\u0435\u043B\u0430, \u0442\u0443\u0440\u0438\u0441\u0442\u044B \u043F\u0440\u0438\u0431\u044B\u0432\u0430\u044E\u0442 \u2014 \u0438\u043D\u043E\u0441\u0442\u0440\u0430\u043D\u0446\u044B \u0441\u043C\u0435\u0442\u0430\u044E\u0442 \u0436\u0438\u043B\u044C\u0451 \u043D\u0430 \u043F\u043E\u0431\u0435\u0440\u0435\u0436\u044C\u0435. \u0417\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u0443 \u0432 \u0421\u0442\u0430\u043C\u0431\u0443\u043B\u0435 \u0438\u043B\u0438 \u0410\u043B\u0430\u043D\u0438\u0438 \u0434\u0430\u044E\u0442 180%. \u0427\u0430\u0439 \u0437\u0430 \u0441\u0447\u0451\u0442 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044F."
    },
    {
      id: "mkt-sell-parking",
      deck: "market",
      kind: "sellOffer",
      category: "parking",
      multiplierPct: 200,
      title: "\u0412\u043E \u0434\u0432\u043E\u0440\u0435 \u043D\u0435 \u0432\u0441\u0442\u0430\u0442\u044C",
      text: "\u0413\u043E\u0440\u043E\u0434 \u0443\u0431\u0440\u0430\u043B \u043F\u0430\u0440\u043A\u043E\u0432\u043A\u0438 \u0441 \u0443\u043B\u0438\u0446. \u041C\u0430\u0448\u0438\u043D\u043E\u043C\u0435\u0441\u0442\u0430 \u0438 \u043A\u043B\u0430\u0434\u043E\u0432\u043A\u0438 \u0442\u0435\u043F\u0435\u0440\u044C \u043D\u0430 \u0432\u0435\u0441 \u0437\u043E\u043B\u043E\u0442\u0430 \u2014 \u0434\u0430\u044E\u0442 200%. \u041A\u0442\u043E \u0441\u043C\u0435\u044F\u043B\u0441\u044F \u043D\u0430\u0434 \xAB\u0431\u0435\u0442\u043E\u043D\u043D\u043E\u0439 \u043A\u043B\u0435\u0442\u043A\u043E\u0439\xBB, \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0441\u043C\u0435\u0451\u0442\u0441\u044F."
    },
    {
      id: "mkt-sell-land",
      deck: "market",
      kind: "sellOffer",
      category: "land",
      multiplierPct: 400,
      title: "\u0417\u0435\u043C\u0435\u043B\u044C\u043D\u0430\u044F \u043B\u0438\u0445\u043E\u0440\u0430\u0434\u043A\u0430",
      text: "\u0421\u043B\u0443\u0445: \u0440\u044F\u0434\u043E\u043C \u0441 \u0442\u0432\u043E\u0438\u043C \u0443\u0447\u0430\u0441\u0442\u043A\u043E\u043C \u043F\u0440\u043E\u0432\u0435\u0434\u0443\u0442 \u0441\u043A\u043E\u0440\u043E\u0441\u0442\u043D\u0443\u044E \u0442\u0440\u0430\u0441\u0441\u0443 \u0438 \u043F\u043E\u0441\u0442\u0440\u043E\u044F\u0442 \u0442\u0435\u0445\u043D\u043E\u043F\u0430\u0440\u043A. \u0421\u043F\u0435\u043A\u0443\u043B\u044F\u043D\u0442\u044B \u0434\u0430\u044E\u0442 400% \u0437\u0430 \u0437\u0435\u043C\u043B\u044E. \u0421\u043B\u0443\u0445, \u043F\u0440\u0430\u0432\u0434\u0430, \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u043B."
    },
    {
      id: "mkt-sell-house-rf",
      deck: "market",
      kind: "sellOffer",
      category: "houseRF",
      multiplierPct: 160,
      title: "\u0412\u0441\u0435 \u043D\u0430 \u0443\u0434\u0430\u043B\u0451\u043D\u043A\u0443 \u2014 \u0432\u0441\u0435 \u0437\u0430 \u0433\u043E\u0440\u043E\u0434",
      text: "\u0413\u043E\u0440\u043E\u0436\u0430\u043D\u0435 \u0443\u0441\u0442\u0430\u043B\u0438 \u043E\u0442 \u043B\u0438\u0444\u0442\u043E\u0432 \u0438 \u0441\u043E\u0441\u0435\u0434\u0430 \u0441 \u043F\u0435\u0440\u0444\u043E\u0440\u0430\u0442\u043E\u0440\u043E\u043C. \u041C\u043E\u0434\u0430 \u043D\u0430 \u0441\u0432\u043E\u0439 \u0434\u043E\u043C: \u0437\u0430 \u0434\u043E\u043C\u0430 \u0432 \u0420\u043E\u0441\u0441\u0438\u0438 \u0434\u0430\u044E\u0442 160%. \u041E\u0433\u043E\u0440\u043E\u0434 \u043C\u043E\u0436\u0435\u0448\u044C \u0437\u0430\u0431\u0440\u0430\u0442\u044C \u0441 \u0441\u043E\u0431\u043E\u0439."
    },
    {
      id: "mkt-sell-biz-food",
      deck: "market",
      kind: "sellOffer",
      category: "bizFood",
      multiplierPct: 250,
      title: "\u0424\u0435\u0434\u0435\u0440\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0435\u0442\u044C \u043F\u0440\u043E\u0433\u043E\u043B\u043E\u0434\u0430\u043B\u0430\u0441\u044C",
      text: "\u041A\u0440\u0443\u043F\u043D\u0430\u044F \u0441\u0435\u0442\u044C \u043E\u0431\u0449\u0435\u043F\u0438\u0442\u0430 \u0441\u043A\u0443\u043F\u0430\u0435\u0442 \u043C\u0435\u0441\u0442\u043D\u044B\u0435 \u0442\u043E\u0447\u043A\u0438: \u0445\u0430\u043B\u044F\u043B\u044C-\u043A\u0430\u0444\u0435, \u043F\u0435\u043A\u0430\u0440\u043D\u0438, \u0448\u0430\u0443\u0440\u043C\u0438\u0447\u043D\u044B\u0435. \u0417\u0430 \u0431\u0438\u0437\u043D\u0435\u0441 \u043D\u0430 \u0435\u0434\u0435 \u0434\u0430\u044E\u0442 250%. \u0420\u0435\u0446\u0435\u043F\u0442\u044B \u043F\u0440\u043E\u0441\u044F\u0442 \u0432 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0435."
    },
    {
      id: "mkt-sell-biz-service",
      deck: "market",
      kind: "sellOffer",
      category: "bizService",
      multiplierPct: 300,
      title: "\u0410\u0433\u0440\u0435\u0433\u0430\u0442\u043E\u0440 \u0432\u0441\u0451 \u0441\u044A\u0435\u0441\u0442",
      text: "\u041E\u043D\u043B\u0430\u0439\u043D-\u0430\u0433\u0440\u0435\u0433\u0430\u0442\u043E\u0440 \u0441\u043A\u0443\u043F\u0430\u0435\u0442 \u0441\u0435\u0440\u0432\u0438\u0441\u044B: \u0431\u0430\u0440\u0431\u0435\u0440\u0448\u043E\u043F\u044B, \u0430\u0432\u0442\u043E\u043C\u043E\u0439\u043A\u0438, \u043A\u043B\u0438\u043D\u0438\u043D\u0433. \u041F\u043B\u0430\u0442\u0438\u0442 300% \u2014 \u0434\u0435\u043D\u044C\u0433\u0438 \u0438\u043D\u0432\u0435\u0441\u0442\u043E\u0440\u043E\u0432 \u0436\u0433\u0443\u0442 \u043A\u0430\u0440\u043C\u0430\u043D. \u0412\u0442\u043E\u0440\u043E\u0439 \u0440\u0430\u0437 \u0437\u0432\u043E\u043D\u0438\u0442\u044C \u043D\u0435 \u0431\u0443\u0434\u0443\u0442."
    },
    {
      id: "mkt-sell-partnership",
      deck: "market",
      kind: "sellOffer",
      category: "partnership",
      multiplierPct: 150,
      title: "\u041B\u0438\u0434\u0435\u0440 \u0443\u043A\u0440\u0443\u043F\u043D\u044F\u0435\u0442\u0441\u044F",
      text: "\u041A\u0440\u0443\u043F\u043D\u044B\u0439 \u043B\u0438\u0434\u0435\u0440 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442 \u043A\u043E\u043C\u0430\u043D\u0434\u0443 \u043C\u0435\u0447\u0442\u044B \u0438 \u043F\u0435\u0440\u0435\u043A\u0443\u043F\u0430\u0435\u0442 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u043A\u0438\u0435 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u044B \u0446\u0435\u043B\u0438\u043A\u043E\u043C. \u0417\u0430 \u0442\u0432\u043E\u0439 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u043A\u0438\u0439 \u0431\u0438\u0437\u043D\u0435\u0441 \u0434\u0430\u044E\u0442 150%. \u0423\u0445\u043E\u0434\u0438\u0442\u044C \u0438\u043B\u0438 \u0440\u0430\u0441\u0442\u0438 \u0434\u0430\u043B\u044C\u0448\u0435?"
    },
    {
      id: "mkt-price-grit-peak",
      deck: "market",
      kind: "stockPrice",
      symbol: "GRIT",
      price: 4e3,
      title: "\u0420\u043E\u0431\u043E\u0442 \u0441\u0442\u0430\u043D\u0446\u0435\u0432\u0430\u043B \u2014 \u0440\u044B\u043D\u043E\u043A \u0443\u043F\u0430\u043B \u0432 \u043E\u0431\u043C\u043E\u0440\u043E\u043A",
      text: "\u0420\u043E\u0431\u043E\u0442 GRIT \u0441\u0442\u0430\u043D\u0446\u0435\u0432\u0430\u043B \u043B\u0435\u0437\u0433\u0438\u043D\u043A\u0443 \u043D\u0430 \u0432\u044B\u0441\u0442\u0430\u0432\u043A\u0435, \u0440\u043E\u043B\u0438\u043A \u0440\u0430\u0437\u043B\u0435\u0442\u0435\u043B\u0441\u044F \u043F\u043E \u0432\u0441\u0435\u043C\u0443 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0443. \u0410\u043A\u0446\u0438\u0438 \u043D\u0430 \u043F\u0438\u043A\u0435: 4000 \u20BD."
    },
    {
      id: "mkt-price-grit-dip",
      deck: "market",
      kind: "stockPrice",
      symbol: "GRIT",
      price: 100,
      title: "\u0420\u043E\u0431\u043E\u0442 \u0441\u043F\u043E\u0442\u043A\u043D\u0443\u043B\u0441\u044F",
      text: "\u0420\u043E\u0431\u043E\u0442 GRIT \u0443\u043F\u0430\u043B \u0441\u043E \u0441\u0446\u0435\u043D\u044B \u043F\u0440\u044F\u043C\u043E \u043D\u0430 \u043F\u0440\u0435\u0437\u0435\u043D\u0442\u0430\u0446\u0438\u0438. \u0418\u043D\u0432\u0435\u0441\u0442\u043E\u0440\u044B \u0443\u043F\u0430\u043B\u0438 \u0441\u043B\u0435\u0434\u043E\u043C. \u0426\u0435\u043D\u0430 \u2014 100 \u20BD. \u0414\u043D\u043E \u0438\u043B\u0438 \u0442\u0440\u0430\u043C\u043F\u043B\u0438\u043D?"
    },
    {
      id: "mkt-price-snail-dip",
      deck: "market",
      kind: "stockPrice",
      symbol: "SNAIL",
      price: 500,
      title: "SNAIL \u043E\u043F\u0440\u0430\u0432\u0434\u044B\u0432\u0430\u0435\u0442 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435",
      text: "\u041B\u043E\u0433\u0438\u0441\u0442\u044B SNAIL \u043F\u043E\u0442\u0435\u0440\u044F\u043B\u0438 \u0444\u0443\u0440\u0443 \u0441 \u0433\u0440\u0443\u0437\u043E\u043C. \u041D\u0430\u0448\u043B\u0438. \u0427\u0435\u0440\u0435\u0437 \u043C\u0435\u0441\u044F\u0446. \u0410\u043A\u0446\u0438\u0438 \u043F\u043E\u043B\u0437\u0443\u0442 \u043F\u043E \u0434\u043D\u0443: 500 \u20BD."
    },
    {
      id: "mkt-price-myco-peak",
      deck: "market",
      kind: "stockPrice",
      symbol: "MYCO",
      price: 4e3,
      title: "\u0413\u0440\u0438\u0431\u043D\u043E\u0439 \u043F\u0440\u043E\u0440\u044B\u0432",
      text: "\u0411\u0438\u043E\u0442\u0435\u0445 MYCO \u0437\u0430\u043F\u0430\u0442\u0435\u043D\u0442\u043E\u0432\u0430\u043B \u0433\u0440\u0438\u0431\u043D\u043E\u0439 \u0431\u0435\u043B\u043E\u043A \u2014 \u0441\u043F\u043E\u0440\u0442\u0441\u043C\u0435\u043D\u044B \u0438 \u043C\u0430\u043C\u044B \u0432 \u0432\u043E\u0441\u0442\u043E\u0440\u0433\u0435. \u0410\u043A\u0446\u0438\u0438 \u043D\u0430 \u043F\u0438\u043A\u0435: 4000 \u20BD."
    },
    {
      id: "mkt-price-zap-dip",
      deck: "market",
      kind: "stockPrice",
      symbol: "ZAP",
      price: 100,
      title: "\u0421\u0430\u043C\u043E\u043A\u0430\u0442\u044B \u0437\u0430\u0433\u043D\u0430\u043B\u0438 \u0432 \u0443\u0433\u043E\u043B",
      text: "\u0426\u0435\u043D\u0442\u0440 \u0433\u043E\u0440\u043E\u0434\u0430 \u0437\u0430\u043A\u0440\u044B\u043B\u0438 \u0434\u043B\u044F \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u043E\u0432. ZAP \u043F\u043E 100 \u20BD \u2014 \u0434\u0435\u0448\u0435\u0432\u043B\u0435 \u043E\u0434\u043D\u043E\u0439 \u043F\u043E\u0435\u0437\u0434\u043A\u0438 \u043D\u0430 \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u0435."
    },
    {
      id: "mkt-price-nest-peak",
      deck: "market",
      kind: "stockPrice",
      symbol: "NEST",
      price: 3e3,
      divPerShare: 25,
      title: "NEST \u0441\u0432\u0438\u043B \u0433\u043D\u0435\u0437\u0434\u043E \u043D\u0430 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C\u0435",
      text: "\u0418\u043D\u0434\u0435\u043A\u0441\u043D\u044B\u0439 \u0444\u043E\u043D\u0434 NEST \u043D\u0430 \u043F\u0438\u043A\u0435: 3000 \u20BD \u0437\u0430 \u043F\u0430\u0439, \u043F\u043B\u044E\u0441 25 \u20BD \u0432 \u043C\u0435\u0441\u044F\u0446 \u0434\u0438\u0432\u0438\u0434\u0435\u043D\u0434\u0430\u043C\u0438 \u2014 \u0441 \u043F\u0440\u0438\u0431\u044B\u043B\u0438 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0439, \u0432\u0441\u0451 \u0447\u0438\u0441\u0442\u043E."
    },
    {
      id: "mkt-price-pepe-moon",
      deck: "market",
      kind: "stockPrice",
      symbol: "PEPE",
      price: 4e3,
      hideRange: true,
      title: "\u041B\u044F\u0433\u0443\u0448\u043A\u0430 \u0443\u043B\u0435\u0442\u0435\u043B\u0430",
      text: "PEPE \u043F\u043E 4000 \u20BD. \u041F\u043E\u0447\u0435\u043C\u0443? \u041D\u0438\u043A\u0442\u043E \u043D\u0435 \u0437\u043D\u0430\u0435\u0442. \u041A\u0443\u0434\u0430 \u0434\u0430\u043B\u044C\u0448\u0435? \u0422\u0435\u043C \u0431\u043E\u043B\u0435\u0435 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u0437\u043D\u0430\u0435\u0442."
    },
    {
      id: "mkt-price-doge-floor",
      deck: "market",
      kind: "stockPrice",
      symbol: "DOGE",
      price: 10,
      hideRange: true,
      title: "\u0421\u043E\u0431\u0430\u043A\u0430 \u0443\u0441\u0442\u0430\u043B\u0430",
      text: "\u041F\u0440\u043E DOGE \u0432\u0441\u0435 \u0437\u0430\u0431\u044B\u043B\u0438. \u0426\u0435\u043D\u0430 \u2014 10 \u20BD. \u041A\u0443\u0434\u0430 \u0443\u043B\u0435\u0442\u0438\u0442 \u0437\u0430\u0432\u0442\u0440\u0430 \u2014 \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E \u0434\u0430\u0436\u0435 \u0441\u0430\u043C\u043E\u0439 \u0441\u043E\u0431\u0430\u043A\u0435."
    },
    {
      id: "mkt-price-gold-peak",
      deck: "market",
      kind: "stockPrice",
      symbol: "GOLD",
      price: 9e3,
      title: "\u0422\u0438\u0445\u0430\u044F \u0433\u0430\u0432\u0430\u043D\u044C \u043F\u0435\u0440\u0435\u043F\u043E\u043B\u043D\u0435\u043D\u0430",
      text: "\u041C\u0438\u0440 \u0448\u0442\u043E\u0440\u043C\u0438\u0442 \u2014 \u0432\u0441\u0435 \u0431\u0435\u0433\u0443\u0442 \u0432 \u0437\u043E\u043B\u043E\u0442\u043E. 9000 \u20BD \u0437\u0430 \u0433\u0440\u0430\u043C\u043C-\u043B\u043E\u0442. \u0411\u043B\u0435\u0441\u0442\u0438\u0442, \u043D\u043E \u043D\u0435 \u0437\u0430\u0431\u044B\u0432\u0430\u0439: \u0438 \u0437\u043E\u043B\u043E\u0442\u043E \u0431\u044B\u0432\u0430\u0435\u0442 \u0434\u043E\u0440\u043E\u0433\u0438\u043C."
    },
    {
      id: "mkt-price-sukuk-issue",
      deck: "market",
      kind: "stockPrice",
      symbol: "SUKUK",
      price: 1e5,
      incomePerUnit: 1300,
      title: "\u041D\u043E\u0432\u044B\u0439 \u0432\u044B\u043F\u0443\u0441\u043A \u0430\u0440\u0435\u043D\u0434\u043D\u044B\u0445 \u0441\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0432",
      text: "\u041F\u0430\u0439 \u2014 100 000 \u20BD, \u0430\u0440\u0435\u043D\u0434\u043D\u044B\u0439 \u0434\u043E\u0445\u043E\u0434 \u2014 1300 \u20BD \u0432 \u043C\u0435\u0441\u044F\u0446. \u0421\u043A\u0443\u0447\u043D\u043E? \u0417\u0430\u0442\u043E \u0445\u0430\u043B\u044F\u043B\u044C, \u0438 \u043F\u043B\u0430\u0442\u044F\u0442 \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E, \u043A\u0430\u043A \u0434\u0432\u043E\u0440\u043D\u0438\u043A \u043C\u0435\u0442\u0451\u0442."
    },
    {
      id: "mkt-split-shib",
      deck: "market",
      kind: "stockSplit",
      symbol: "SHIB",
      direction: "split",
      title: "SHIB \u0434\u0435\u043B\u0438\u0442\u0441\u044F",
      text: "\u0421\u043F\u043B\u0438\u0442 SHIB: \u043A\u0430\u0436\u0434\u0430\u044F \u043C\u043E\u043D\u0435\u0442\u0430 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044F \u0432 \u0434\u0432\u0435. \u041C\u043E\u043D\u0435\u0442 \u0432\u0434\u0432\u043E\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u2014 \u0431\u043E\u0433\u0430\u0442\u0441\u0442\u0432\u0430 \u043B\u0438 \u0432\u0434\u0432\u043E\u0435 \u0431\u043E\u043B\u044C\u0448\u0435, \u044D\u0442\u043E \u0443\u0436\u0435 \u043A\u0430\u043A \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C."
    },
    {
      id: "mkt-split-bonk",
      deck: "market",
      kind: "stockSplit",
      symbol: "BONK",
      direction: "split",
      title: "BONK \u0440\u0430\u0437\u043C\u043D\u043E\u0436\u0438\u043B\u0441\u044F",
      text: "\u0421\u043F\u043B\u0438\u0442 BONK: \u0434\u0435\u0440\u0436\u0430\u0442\u0435\u043B\u044F\u043C \u0443\u0434\u0432\u0430\u0438\u0432\u0430\u044E\u0442 \u043C\u043E\u043D\u0435\u0442\u044B. \u0412 \u0447\u0430\u0442\u0430\u0445 \u043F\u0440\u0430\u0437\u0434\u043D\u0438\u043A, \u0443 \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u0441\u0442\u043E\u0432 \u0432\u043E\u043F\u0440\u043E\u0441\u044B."
    },
    {
      id: "mkt-split-wif",
      deck: "market",
      kind: "stockSplit",
      symbol: "WIF",
      direction: "reverse",
      title: "WIF \u0441\u043A\u043B\u0435\u0438\u043B\u0438",
      text: "\u041E\u0431\u0440\u0430\u0442\u043D\u044B\u0439 \u0441\u043F\u043B\u0438\u0442 WIF: \u0434\u0435\u0441\u044F\u0442\u044C \u043C\u043E\u043D\u0435\u0442 \u0441\u043A\u043B\u0435\u0438\u0432\u0430\u044E\u0442 \u0432 \u043E\u0434\u043D\u0443. \u0417\u0432\u0443\u0447\u0438\u0442 \u0441\u043E\u043B\u0438\u0434\u043D\u043E, \u043F\u0430\u0445\u043D\u0435\u0442 \u043F\u0430\u043D\u0438\u043A\u043E\u0439."
    },
    {
      id: "mkt-split-doge",
      deck: "market",
      kind: "stockSplit",
      symbol: "DOGE",
      direction: "reverse",
      title: "\u0421\u043E\u0431\u0430\u043A\u0443 \u0441\u043E\u0431\u0440\u0430\u043B\u0438 \u0432 \u043A\u0443\u0447\u0443",
      text: "\u041E\u0431\u0440\u0430\u0442\u043D\u044B\u0439 \u0441\u043F\u043B\u0438\u0442 DOGE: \u0441\u0442\u043E \u0441\u0442\u0430\u0440\u044B\u0445 \u043C\u043E\u043D\u0435\u0442 \u2014 \u043E\u0434\u043D\u0430 \u043D\u043E\u0432\u0430\u044F. \u0421\u043E\u0431\u0430\u043A\u0430 \u0441\u0442\u0430\u043B\u0430 \u0440\u0435\u0436\u0435 \u0432\u0441\u0442\u0440\u0435\u0447\u0430\u0442\u044C\u0441\u044F, \u043D\u043E \u043D\u0435 \u0441\u0442\u0430\u043B\u0430 \u043F\u043E\u0440\u043E\u0434\u0438\u0441\u0442\u0435\u0435."
    },
    {
      id: "mkt-wind-tax-refund",
      deck: "market",
      kind: "windfall",
      flatAmount: 15e3,
      scope: "all",
      title: "\u041D\u0430\u043B\u043E\u0433\u043E\u0432\u044B\u0439 \u0432\u044B\u0447\u0435\u0442",
      text: "\u0413\u043E\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u043E \u0432\u0441\u043F\u043E\u043C\u043D\u0438\u043B\u043E \u043F\u0440\u043E \u043B\u044E\u0434\u0435\u0439: \u0432\u044B\u0447\u0435\u0442\u044B \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u044B \u0432\u0441\u0435\u043C. \u041A\u0430\u0436\u0434\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 15 000 \u20BD. \u0414\u0430, \u0442\u0430\u043A \u0431\u044B\u0432\u0430\u0435\u0442."
    },
    {
      id: "mkt-wind-cashback",
      deck: "market",
      kind: "windfall",
      flatAmount: 8e3,
      scope: "self",
      title: "\u041A\u044D\u0448\u0431\u0435\u043A \u0433\u043E\u0434\u0430",
      text: "\u0411\u0430\u043D\u043A \u043F\u043E\u0434\u0432\u0451\u043B \u0438\u0442\u043E\u0433\u0438 \u0433\u043E\u0434\u0430 \u2014 \u0442\u0435\u0431\u0435 \u0443\u043F\u0430\u043B\u043E 8000 \u20BD \u043A\u044D\u0448\u0431\u0435\u043A\u0430. \u041C\u0435\u043B\u043E\u0447\u044C, \u0430 \u043F\u0440\u0438\u044F\u0442\u043D\u043E. \u0422\u043E\u043B\u044C\u043A\u043E \u043D\u0435 \u0441\u043F\u0443\u0441\u0442\u0438 \u043D\u0430 \u043D\u043E\u0432\u044B\u0439 \u0447\u0435\u0445\u043E\u043B \u0434\u043B\u044F \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430."
    },
    {
      id: "mkt-wind-rent-review",
      deck: "market",
      kind: "windfall",
      amountPerRealEstate: 1e4,
      scope: "all",
      title: "\u0420\u0435\u043D\u0442\u0430 \u043F\u0435\u0440\u0435\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0430",
      text: "\u0420\u044B\u043D\u043E\u043A \u0430\u0440\u0435\u043D\u0434\u044B \u043F\u043E\u0434\u0440\u043E\u0441. \u0416\u0438\u043B\u044C\u0446\u044B \u043F\u043E\u0432\u043E\u0440\u0447\u0430\u043B\u0438 \u2014 \u0438 \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u043B\u0438\u0441\u044C. \u041A\u0430\u0436\u0434\u044B\u0439 \u0442\u0432\u043E\u0439 \u043E\u0431\u044A\u0435\u043A\u0442 \u043D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u0438 \u043F\u0440\u0438\u043D\u043E\u0441\u0438\u0442 \u0440\u0430\u0437\u043E\u0432\u043E \u043F\u043E 10 000 \u20BD."
    },
    {
      id: "mkt-wind-autopromo",
      deck: "market",
      kind: "windfall",
      amountPerPartnership: 15e4,
      scope: "all",
      title: "\u0410\u0432\u0442\u043E\u043F\u0440\u043E\u043C\u043E\u0443\u0448\u0435\u043D \u0437\u0430\u043A\u0440\u044B\u0442!",
      text: "\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u0441\u0434\u0435\u043B\u0430\u043B\u0430 \u043E\u0431\u044A\u0451\u043C \u2014 \u0430\u0432\u0442\u043E\u043F\u0440\u043E\u043C\u043E\u0443\u0448\u0435\u043D \u0437\u0430\u043A\u0440\u044B\u0442! \u0412\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u044B \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u043A\u043E\u0433\u043E \u0431\u0438\u0437\u043D\u0435\u0441\u0430 \u043F\u043E\u043B\u0443\u0447\u0430\u044E\u0442 \u043F\u043E 150 000 \u20BD \u0431\u043E\u043D\u0443\u0441\u0430. \u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0440\u0435\u0448\u0430\u0435\u0442."
    },
    {
      id: "mkt-raise-promotion",
      deck: "market",
      kind: "payRaise",
      amount: 15e3,
      title: "\u0412\u0430\u0441 \u043F\u043E\u0432\u044B\u0441\u0438\u043B\u0438",
      text: "\u041D\u0430\u0447\u0430\u043B\u044C\u043D\u0438\u043A \u0443\u0448\u0451\u043B \u043D\u0430 \u043F\u0435\u043D\u0441\u0438\u044E, \u043A\u0440\u0435\u0441\u043B\u043E \u2014 \u0442\u0432\u043E\u0451. \u0421\u043E\u0432\u0435\u0449\u0430\u043D\u0438\u0439 \u0431\u043E\u043B\u044C\u0448\u0435, \u043D\u043E \u0438 \u0437\u0430\u0440\u043F\u043B\u0430\u0442\u0430 \u0432\u044B\u0440\u043E\u0441\u043B\u0430: +15 000 \u20BD \u0432 \u043C\u0435\u0441\u044F\u0446."
    },
    {
      id: "mkt-raise-new-job",
      deck: "market",
      kind: "payRaise",
      amount: 25e3,
      title: "\u0421\u043C\u0435\u043D\u0438\u043B \u0440\u0430\u0431\u043E\u0442\u0443",
      text: "\u0422\u0435\u0431\u044F \u043F\u0435\u0440\u0435\u043C\u0430\u043D\u0438\u043B\u0438 \u0442\u0443\u0434\u0430, \u0433\u0434\u0435 \u043F\u043B\u0430\u0442\u044F\u0442. \u0421\u0442\u0430\u0440\u044B\u0439 \u043D\u0430\u0447\u0430\u043B\u044C\u043D\u0438\u043A \u043E\u0431\u0438\u0434\u0435\u043B\u0441\u044F, \u0437\u0430\u0442\u043E \u043E\u043A\u043B\u0430\u0434 \u0432\u044B\u0440\u043E\u0441 \u043D\u0430 25 000 \u20BD \u0432 \u043C\u0435\u0441\u044F\u0446."
    },
    {
      id: "mkt-raise-bonus-to-salary",
      deck: "market",
      kind: "payRaise",
      amount: 1e4,
      title: "\u041F\u0440\u0435\u043C\u0438\u044F \u0441\u0442\u0430\u043B\u0430 \u043E\u043A\u043B\u0430\u0434\u043E\u043C",
      text: "\u0422\u044B \u0442\u0430\u043A \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E \u043F\u0435\u0440\u0435\u0432\u044B\u043F\u043E\u043B\u043D\u044F\u043B \u043F\u043B\u0430\u043D, \u0447\u0442\u043E \u043F\u0440\u0435\u043C\u0438\u044E \u0432\u0448\u0438\u043B\u0438 \u0432 \u043E\u043A\u043B\u0430\u0434. +10 000 \u20BD \u0432 \u043C\u0435\u0441\u044F\u0446 \u2014 \u0442\u0435\u043F\u0435\u0440\u044C \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430."
    },
    {
      id: "mkt-raise-side-hustle",
      deck: "market",
      kind: "payRaise",
      amount: 8e3,
      title: "\u041F\u043E\u0434\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0441\u0442\u0430\u043B\u0430 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E\u0439",
      text: "\u0417\u0430\u043A\u0430\u0437\u0447\u0438\u043A\u0443 \u043D\u0430\u0434\u043E\u0435\u043B\u043E \u0437\u0432\u043E\u043D\u0438\u0442\u044C \u043F\u043E \u043C\u0435\u043B\u043E\u0447\u0438 \u2014 \u043E\u0444\u043E\u0440\u043C\u0438\u043B \u0442\u0435\u0431\u044F \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C. +8000 \u20BD \u0432 \u043C\u0435\u0441\u044F\u0446 \u043A\u0430\u0436\u0434\u044B\u0439 \u043C\u0435\u0441\u044F\u0446."
    }
  ],
  DOODADS_RU: [
    {
      id: "dd-shtraf-kamera",
      title: "\u041F\u0438\u0441\u044C\u043C\u043E \u0441\u0447\u0430\u0441\u0442\u044C\u044F",
      flavor: "\u041A\u0430\u043C\u0435\u0440\u0430 \u043F\u043E\u0439\u043C\u0430\u043B\u0430 \u043F\u043E \u0434\u043E\u0440\u043E\u0433\u0435 \u043D\u0430 \u0434\u0430\u0447\u0443. \u0417\u0430\u043F\u043B\u0430\u0442\u0438\u043B \u0431\u044B\u0441\u0442\u0440\u043E \u2014 \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u0441\u0443\u043C\u043C\u044B, \u043D\u043E \u0432\u0441\u0451 \u0440\u0430\u0432\u043D\u043E \u043E\u0431\u0438\u0434\u043D\u043E.",
      amount: 1500,
      financeable: false
    },
    {
      id: "dd-sabantuy-gostintsy",
      title: "\u0413\u043E\u0441\u0442\u0438\u043D\u0446\u044B \u043D\u0430 \u0421\u0430\u0431\u0430\u043D\u0442\u0443\u0439",
      flavor: "\u0427\u0430\u043A-\u0447\u0430\u043A, \u044D\u0447\u043F\u043E\u0447\u043C\u0430\u043A\u0438 \u0438 \u043C\u0435\u0448\u043E\u043A \u043A\u043E\u043D\u0444\u0435\u0442. \u0411\u0435\u0437 \u043D\u0438\u0445 \u043D\u0430 \u043C\u0430\u0439\u0434\u0430\u043D \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442\u044C \u043D\u0435\u043F\u0440\u0438\u043B\u0438\u0447\u043D\u043E.",
      amount: 2e3,
      financeable: false
    },
    {
      id: "dd-utrennik-v-sadike",
      title: "\u0423\u0442\u0440\u0435\u043D\u043D\u0438\u043A \u0432 \u0441\u0430\u0434\u0438\u043A\u0435",
      flavor: "\u0422\u043E\u0440\u0442, \u0448\u0430\u0440\u0438\u043A\u0438 \u0438 \u043A\u043E\u0441\u0442\u044E\u043C \u0437\u0430\u0439\u0447\u0438\u043A\u0430. \u0417\u0430\u0439\u0447\u0438\u043A, \u043A\u0441\u0442\u0430\u0442\u0438, \u2014 \u0442\u044B.",
      amount: 2e3,
      financeable: false
    },
    {
      id: "dd-prostuda-apteka",
      title: "\u0412\u0441\u044F \u0441\u0435\u043C\u044C\u044F \u043F\u0440\u043E\u0441\u0442\u044B\u043B\u0430",
      flavor: "\u0412 \u0430\u043F\u0442\u0435\u043A\u0435 \u0443\u0436\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u0430\u044E\u0442\u0441\u044F \u043F\u043E \u0438\u043C\u0435\u043D\u0438. \u041F\u043B\u043E\u0445\u043E\u0439 \u0437\u043D\u0430\u043A.",
      amount: 3e3,
      financeable: false
    },
    {
      id: "dd-detsad-doplata",
      title: "\u0414\u043E\u043F\u043B\u0430\u0442\u0430 \u0437\u0430 \u0434\u0435\u0442\u0441\u043A\u0438\u0439 \u0441\u0430\u0434",
      flavor: "\u041A\u0440\u0443\u0436\u043E\u043A \u043B\u0435\u043F\u043A\u0438, \u0431\u0430\u0441\u0441\u0435\u0439\u043D \u0438 \xAB\u0444\u043E\u043D\u0434 \u0433\u0440\u0443\u043F\u043F\u044B\xBB. \u041E\u0442\u043A\u0430\u0437\u0430\u0442\u044C\u0441\u044F \u043D\u0435\u043B\u044C\u0437\u044F \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u0442\u044C\u0441\u044F.",
      amount: 3e3,
      financeable: false
    },
    {
      id: "dd-smesitel-potek",
      title: "\u041F\u043E\u0442\u0451\u043A \u0441\u043C\u0435\u0441\u0438\u0442\u0435\u043B\u044C",
      flavor: "\u0421\u0430\u043D\u0442\u0435\u0445\u043D\u0438\u043A \u043F\u0440\u0438\u0448\u0451\u043B, \u043F\u043E\u0446\u043E\u043A\u0430\u043B \u044F\u0437\u044B\u043A\u043E\u043C. \u0426\u043E\u043A\u0430\u043D\u044C\u0435 \u043E\u043A\u0430\u0437\u0430\u043B\u043E\u0441\u044C \u043F\u043B\u0430\u0442\u043D\u044B\u043C.",
      amount: 3e3,
      financeable: false
    },
    {
      id: "dd-sbor-na-mechet",
      title: "\u0421\u0431\u043E\u0440 \u043D\u0430 \u0440\u0435\u043C\u043E\u043D\u0442 \u043C\u0435\u0447\u0435\u0442\u0438",
      flavor: "\u0421\u043E\u0441\u0435\u0434 \u0441 \u0432\u0435\u0434\u043E\u043C\u043E\u0441\u0442\u044C\u044E \u0443\u0436\u0435 \u0443 \u0434\u0432\u0435\u0440\u0438. \u0414\u043E\u0431\u0440\u043E\u0435 \u0434\u0435\u043B\u043E \u2014 \u043D\u0435 \u0432 \u0443\u0431\u044B\u0442\u043E\u043A.",
      amount: 3e3,
      financeable: false
    },
    {
      id: "dd-botinki-rebenku",
      title: "\u0411\u043E\u0442\u0438\u043D\u043A\u0438 \u0440\u0435\u0431\u0451\u043D\u043A\u0443",
      flavor: "\u041D\u043E\u0433\u0430 \u0432\u044B\u0440\u043E\u0441\u043B\u0430 \u0437\u0430 \u043B\u0435\u0442\u043E \u043D\u0430 \u0434\u0432\u0430 \u0440\u0430\u0437\u043C\u0435\u0440\u0430. \u041A\u043E\u0440\u043C\u0438\u0442\u044C \u043C\u0435\u043D\u044C\u0448\u0435 \u2014 \u043D\u0435 \u0432\u0430\u0440\u0438\u0430\u043D\u0442.",
      amount: 3e3,
      financeable: false
    },
    {
      id: "dd-shinomontazh",
      title: "\u041F\u0435\u0440\u0435\u043E\u0431\u0443\u0432\u043A\u0430 \u043C\u0430\u0448\u0438\u043D\u044B",
      flavor: "\u0421\u043D\u0435\u0433 \u0432\u044B\u043F\u0430\u043B \u0432\u043D\u0435\u0437\u0430\u043F\u043D\u043E. \u041A\u0430\u043A \u0438 \u043A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0434. \u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043D\u0430 \u0448\u0438\u043D\u043E\u043C\u043E\u043D\u0442\u0430\u0436 \u2014 \u0434\u043E \u0432\u0435\u0447\u0435\u0440\u0430.",
      amount: 4e3,
      financeable: false
    },
    {
      id: "dd-sbory-k-shkole",
      title: "\u0421\u0431\u043E\u0440\u044B \u043A \u0448\u043A\u043E\u043B\u0435",
      flavor: "\u0421\u043F\u0438\u0441\u043E\u043A \u043E\u0442 \u0443\u0447\u0438\u0442\u0435\u043B\u044F \u2014 \u043D\u0430 \u0434\u0432\u0430 \u043B\u0438\u0441\u0442\u0430. \u041C\u0435\u043B\u043A\u0438\u043C \u043F\u043E\u0447\u0435\u0440\u043A\u043E\u043C.",
      amount: 4e3,
      financeable: false
    },
    {
      id: "dd-gosti-iz-derevni",
      title: "\u0413\u043E\u0441\u0442\u0438 \u0438\u0437 \u0434\u0435\u0440\u0435\u0432\u043D\u0438",
      flavor: "\u0420\u043E\u0434\u043D\u044F \u043F\u0440\u0438\u0435\u0445\u0430\u043B\u0430 \xAB\u043D\u0430 \u0434\u0435\u043D\u0451\u043A\xBB. \u0422\u0440\u0435\u0442\u0438\u0439 \u0434\u0435\u043D\u044C \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A \u0434\u0435\u0440\u0436\u0438\u0442\u0441\u044F \u0438\u0437 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0445 \u0441\u0438\u043B.",
      amount: 4e3,
      financeable: false
    },
    {
      id: "dd-kursy-korana-detyam",
      title: "\u041A\u0443\u0440\u0441\u044B \u0447\u0442\u0435\u043D\u0438\u044F \u041A\u043E\u0440\u0430\u043D\u0430",
      flavor: "\u0423\u0447\u0438\u0442\u0435\u043B\u044C \u0445\u0432\u0430\u043B\u0438\u0442: \u0442\u0430\u0434\u0436\u0432\u0438\u0434 \u0443 \u0441\u044B\u043D\u0430 \u0443\u0436\u0435 \u043B\u0443\u0447\u0448\u0435, \u0447\u0435\u043C \u0443 \u043F\u0430\u043F\u044B.",
      amount: 4e3,
      financeable: false
    },
    {
      id: "dd-evakuator",
      title: "\u042D\u0432\u0430\u043A\u0443\u0430\u0442\u043E\u0440",
      flavor: "\u041F\u0440\u0438\u043F\u0430\u0440\u043A\u043E\u0432\u0430\u043B\u0441\u044F \xAB\u043D\u0430 \u043C\u0438\u043D\u0443\u0442\u043A\u0443\xBB. \u041C\u0438\u043D\u0443\u0442\u043A\u0430 \u043E\u0431\u043E\u0448\u043B\u0430\u0441\u044C \u0434\u043E\u0440\u043E\u0433\u043E.",
      amount: 5e3,
      financeable: false
    },
    {
      id: "dd-kot-zabolel",
      title: "\u041A\u043E\u0442 \u0437\u0430\u0431\u043E\u043B\u0435\u043B",
      flavor: "\u0412\u0435\u0442\u0435\u0440\u0438\u043D\u0430\u0440 \u0433\u043E\u0432\u043E\u0440\u0438\u0442 \u2014 \u043F\u0435\u0440\u0435\u0435\u043B. \u041A\u043E\u0442 \u043C\u043E\u043B\u0447\u0438\u0442 \u0438 \u043D\u0435 \u0440\u0430\u0441\u043A\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F.",
      amount: 5e3,
      financeable: false
    },
    {
      id: "dd-podarok-na-nikah",
      title: "\u041F\u043E\u0434\u0430\u0440\u043E\u043A \u043D\u0430 \u043D\u0438\u043A\u0430\u0445",
      flavor: "\u0414\u0440\u0443\u0433 \u0436\u0435\u043D\u0438\u0442\u0441\u044F! \u041C\u0435\u043D\u044C\u0448\u0435 \u043F\u043E\u043B\u043E\u0436\u0438\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F \u2014 \u0440\u043E\u0434\u043D\u044F \u0441\u0447\u0438\u0442\u0430\u0435\u0442.",
      amount: 5e3,
      financeable: false
    },
    {
      id: "dd-uraza-bayram-podarki",
      title: "\u041F\u043E\u0434\u0430\u0440\u043A\u0438 \u043D\u0430 \u0423\u0440\u0430\u0437\u0430-\u0431\u0430\u0439\u0440\u0430\u043C",
      flavor: "\u0414\u0435\u0442\u044F\u043C \u2014 \u043E\u0431\u043D\u043E\u0432\u043A\u0438, \u043F\u043B\u0435\u043C\u044F\u043D\u043D\u0438\u043A\u0430\u043C \u2014 \u043A\u043E\u043D\u0432\u0435\u0440\u0442\u044B. \u0412\u0441\u0435\u043C \u0440\u0430\u0434\u043E\u0441\u0442\u044C, \u0442\u0435\u0431\u0435 \u2014 \u0440\u0430\u0441\u0445\u043E\u0434\u044B.",
      amount: 5e3,
      financeable: false
    },
    {
      id: "dd-stiralka-slomalas",
      title: "\u0421\u0442\u0438\u0440\u0430\u043B\u043A\u0430 \u0441\u043B\u043E\u043C\u0430\u043B\u0430\u0441\u044C",
      flavor: "\u041C\u0430\u0441\u0442\u0435\u0440 \u0441\u043A\u0430\u0437\u0430\u043B \xAB\u043F\u043E\u0434\u0448\u0438\u043F\u043D\u0438\u043A\xBB. \u041F\u0440\u043E\u0437\u0432\u0443\u0447\u0430\u043B\u043E \u043A\u0430\u043A \u043F\u0440\u0438\u0433\u043E\u0432\u043E\u0440.",
      amount: 6e3,
      financeable: false
    },
    {
      id: "dd-den-rozhdeniya-v-kafe",
      title: "\u0414\u0435\u043D\u044C \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u0432 \u043A\u0430\u0444\u0435",
      flavor: "\u041F\u043E\u0437\u0432\u0430\u043B \xAB\u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u043E\u0438\u0445\xBB. \u0421\u0432\u043E\u0438\u0445 \u043E\u043A\u0430\u0437\u0430\u043B\u043E\u0441\u044C \u0441\u0435\u043C\u043D\u0430\u0434\u0446\u0430\u0442\u044C.",
      amount: 6e3,
      financeable: false
    },
    {
      id: "dd-razbil-ekran",
      title: "\u0420\u0430\u0437\u0431\u0438\u043B \u044D\u043A\u0440\u0430\u043D \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430",
      flavor: "\u0427\u0435\u0445\u043E\u043B \u043A\u0443\u043F\u0438\u043B \u0435\u0449\u0451 \u0433\u043E\u0434 \u043D\u0430\u0437\u0430\u0434. \u041B\u0435\u0436\u0438\u0442 \u0432 \u044F\u0449\u0438\u043A\u0435, \u0446\u0435\u043B\u0451\u0445\u043E\u043D\u044C\u043A\u0438\u0439.",
      amount: 6e3,
      financeable: false
    },
    {
      id: "dd-repetitor-matematika",
      title: "\u0420\u0435\u043F\u0435\u0442\u0438\u0442\u043E\u0440 \u043F\u043E \u043C\u0430\u0442\u0435\u043C\u0430\u0442\u0438\u043A\u0435",
      flavor: "\u041F\u043E\u0441\u043B\u0435 \u0442\u0440\u0435\u0442\u044C\u0435\u0439 \u0434\u0432\u043E\u0439\u043A\u0438 \u0440\u0435\u0448\u0438\u043B\u0438: \u043F\u043E\u0440\u0430. \u0420\u0435\u043F\u0435\u0442\u0438\u0442\u043E\u0440 \u0434\u0435\u0448\u0435\u0432\u043B\u0435, \u0447\u0435\u043C \u043F\u0435\u0440\u0435\u0441\u0434\u0430\u0447\u0430. \u041D\u0430\u0432\u0435\u0440\u043D\u043E\u0435.",
      amount: 6e3,
      financeable: false
    },
    {
      id: "dd-stomatolog-plomba",
      title: "\u0421\u0442\u043E\u043C\u0430\u0442\u043E\u043B\u043E\u0433",
      flavor: "\u0417\u0443\u0431 \u043D\u044B\u043B \u043C\u0435\u0441\u044F\u0446 \u2014 \u0442\u0435\u0440\u043F\u0435\u043B. \u0414\u043E\u0442\u0435\u0440\u043F\u0435\u043B\u0441\u044F \u0434\u043E \xAB\u0431\u0443\u0434\u0435\u043C \u0441\u043F\u0430\u0441\u0430\u0442\u044C\xBB.",
      amount: 7e3,
      financeable: false
    },
    {
      id: "dd-akvapark-s-detmi",
      title: "\u0410\u043A\u0432\u0430\u043F\u0430\u0440\u043A \u0441 \u0434\u0435\u0442\u044C\u043C\u0438",
      flavor: "\u041E\u0431\u0435\u0449\u0430\u043B \u0435\u0449\u0451 \u0437\u0438\u043C\u043E\u0439. \u0414\u0435\u0442\u0438 \u043F\u043E\u043C\u043D\u044F\u0442 \u0432\u0441\u0451.",
      amount: 7e3,
      financeable: false
    },
    {
      id: "dd-godovshchina-svadby",
      title: "\u0413\u043E\u0434\u043E\u0432\u0449\u0438\u043D\u0430 \u0441\u0432\u0430\u0434\u044C\u0431\u044B",
      flavor: "\u0411\u0443\u043A\u0435\u0442, \u0443\u0436\u0438\u043D \u0438 \xAB\u0434\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0434\u043E, \u0447\u0442\u043E \u0442\u044B\xBB. \u041D\u0430\u0434\u043E.",
      amount: 7e3,
      financeable: false
    },
    {
      id: "dd-iftar-na-rodnyu",
      title: "\u0418\u0444\u0442\u0430\u0440 \u043D\u0430 \u0432\u0441\u044E \u0440\u043E\u0434\u043D\u044E",
      flavor: "\u041F\u043E\u0437\u0432\u0430\u043B \u0433\u043E\u0441\u0442\u0435\u0439 \u043D\u0430 \u0438\u0444\u0442\u0430\u0440. \u0411\u0430\u0440\u0430\u043A\u0430\u0442 \u2014 \u0432 \u0434\u043E\u043C, \u043F\u043B\u043E\u0432 \u2014 \u043D\u0430 \u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044C \u0447\u0435\u043B\u043E\u0432\u0435\u043A.",
      amount: 8e3,
      financeable: false
    },
    {
      id: "dd-kurtka-na-zimu",
      title: "\u041A\u0443\u0440\u0442\u043A\u0430 \u043D\u0430 \u0437\u0438\u043C\u0443",
      flavor: "\u0421\u0442\u0430\u0440\u0430\u044F \u0435\u0449\u0451 \u043D\u0438\u0447\u0435\u0433\u043E, \u043D\u043E \u0436\u0435\u043D\u0430 \u0441\u043A\u0430\u0437\u0430\u043B\u0430: \xAB\u0441\u0442\u044B\u0434\u043D\u043E \u043F\u0435\u0440\u0435\u0434 \u043B\u044E\u0434\u044C\u043C\u0438\xBB.",
      amount: 8e3,
      financeable: false
    },
    {
      id: "dd-zamena-akkumulyatora",
      title: "\u0417\u0430\u043C\u0435\u043D\u0430 \u0430\u043A\u043A\u0443\u043C\u0443\u043B\u044F\u0442\u043E\u0440\u0430",
      flavor: "\u0412 \u043C\u0438\u043D\u0443\u0441 \u0442\u0440\u0438\u0434\u0446\u0430\u0442\u044C \u043C\u0430\u0448\u0438\u043D\u0430 \u043D\u0435 \u0437\u0430\u0432\u0435\u043B\u0430\u0441\u044C. \u041F\u0440\u0438\u043A\u0443\u0440\u0438\u0432\u0430\u0442\u044C \u0443 \u0441\u043E\u0441\u0435\u0434\u0430 \u043D\u0430\u0434\u043E\u0435\u043B\u043E \u043D\u0430 \u0442\u0440\u0435\u0442\u0438\u0439 \u0440\u0430\u0437.",
      amount: 8e3,
      financeable: false
    },
    {
      id: "dd-novye-ochki",
      title: "\u041D\u043E\u0432\u044B\u0435 \u043E\u0447\u043A\u0438",
      flavor: "\u041E\u043A\u0443\u043B\u0438\u0441\u0442 \u0441\u043F\u0440\u043E\u0441\u0438\u043B: \xAB\u041A\u0430\u043A \u0432\u044B \u0432\u043E\u043E\u0431\u0449\u0435 \u0435\u0437\u0434\u0438\u0442\u0435?\xBB \u041B\u0443\u0447\u0448\u0435 \u0431\u044B \u043D\u0435 \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u043B.",
      amount: 9e3,
      financeable: false
    },
    {
      id: "dd-noutbuk-zalili",
      title: "\u041D\u043E\u0443\u0442\u0431\u0443\u043A \u0437\u0430\u043B\u0438\u043B\u0438 \u0447\u0430\u0435\u043C",
      flavor: "\u0414\u043E\u0447\u043A\u0430 \u0434\u0435\u043B\u0430\u043B\u0430 \u0443\u0440\u043E\u043A\u0438 \u0441 \u0447\u0430\u0435\u043C. \u0427\u0430\u0439 \u043F\u043E\u0431\u0435\u0434\u0438\u043B.",
      amount: 1e4,
      financeable: false
    },
    {
      id: "dd-puhovik-zhene",
      title: "\u041F\u0443\u0445\u043E\u0432\u0438\u043A \u0436\u0435\u043D\u0435",
      flavor: "\xAB\u041C\u043D\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0434\u043E\xBB \u043F\u0440\u043E\u0434\u0435\u0440\u0436\u0430\u043B\u043E\u0441\u044C \u0434\u043E \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u043C\u043E\u0440\u043E\u0437\u0430.",
      amount: 12e3,
      financeable: true
    },
    {
      id: "dd-samokat-synu",
      title: "\u0421\u0430\u043C\u043E\u043A\u0430\u0442 \u0441\u044B\u043D\u0443",
      flavor: "\u0423 \u0432\u0441\u0435\u0445 \u0432\u043E \u0434\u0432\u043E\u0440\u0435 \u0435\u0441\u0442\u044C. \u0411\u044B\u0442\u044C \xAB\u043D\u0435 \u043A\u0430\u043A \u0432\u0441\u0435\xBB \u0441\u044B\u043D \u043E\u0442\u043A\u0430\u0437\u0430\u043B\u0441\u044F \u043D\u0430\u043E\u0442\u0440\u0435\u0437.",
      amount: 12e3,
      financeable: true
    },
    {
      id: "dd-kostyum-na-vypusknoy",
      title: "\u041A\u043E\u0441\u0442\u044E\u043C \u043D\u0430 \u0432\u044B\u043F\u0443\u0441\u043A\u043D\u043E\u0439",
      flavor: "\u041D\u0430\u0434\u0435\u043D\u0435\u0442 \u043E\u0434\u0438\u043D \u0440\u0430\u0437. \u0417\u0430\u0442\u043E \u043D\u0430 \u0444\u043E\u0442\u043E \u2014 \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430.",
      amount: 12e3,
      financeable: true
    },
    {
      id: "dd-velosiped-dochke",
      title: "\u0412\u0435\u043B\u043E\u0441\u0438\u043F\u0435\u0434 \u0434\u043E\u0447\u043A\u0435",
      flavor: "\u041E\u0431\u0435\u0449\u0430\u043B \u0437\u0430 \u043F\u044F\u0442\u0451\u0440\u043A\u0438 \u0432 \u0447\u0435\u0442\u0432\u0435\u0440\u0442\u0438. \u041F\u044F\u0442\u0451\u0440\u043A\u0438 \u043F\u0440\u0435\u0434\u044A\u044F\u0432\u043B\u0435\u043D\u044B. \u041A\u0440\u044B\u0442\u044C \u043D\u0435\u0447\u0435\u043C.",
      amount: 14e3,
      financeable: true
    },
    {
      id: "dd-telefon-rebenku",
      title: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D \u0440\u0435\u0431\u0451\u043D\u043A\u0443",
      flavor: "\xAB\u0423 \u0432\u0441\u0435\u0445 \u0432 \u043A\u043B\u0430\u0441\u0441\u0435 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C\xBB \u2014 \u0430\u0440\u0433\u0443\u043C\u0435\u043D\u0442 \u0436\u0435\u043B\u0435\u0437\u043D\u044B\u0439, \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D \u043F\u043E\u043A\u043E\u043B\u0435\u043D\u0438\u044F\u043C\u0438.",
      amount: 15e3,
      financeable: true
    },
    {
      id: "dd-koronka-na-zub",
      title: "\u041A\u043E\u0440\u043E\u043D\u043A\u0430 \u043D\u0430 \u0437\u0443\u0431",
      flavor: "\u0412\u0440\u0430\u0447 \u043F\u043E\u043A\u0430\u0437\u0430\u043B \u043F\u0440\u0430\u0439\u0441 \u2014 \u0437\u0443\u0431 \u0441\u0440\u0430\u0437\u0443 \u0437\u0430\u0431\u043E\u043B\u0435\u043B \u043C\u0435\u043D\u044C\u0448\u0435. \u041D\u043E \u0431\u044B\u043B\u043E \u043F\u043E\u0437\u0434\u043D\u043E.",
      amount: 15e3,
      financeable: true
    },
    {
      id: "dd-baran-na-kurban",
      title: "\u0411\u0430\u0440\u0430\u043D \u043D\u0430 \u041A\u0443\u0440\u0431\u0430\u043D-\u0431\u0430\u0439\u0440\u0430\u043C",
      flavor: "\u0412\u044B\u0431\u0440\u0430\u043B \u0441\u0430\u043C\u043E\u0433\u043E \u0441\u043F\u0440\u0430\u0432\u043D\u043E\u0433\u043E. \u041C\u044F\u0441\u043E \u2014 \u0441\u0435\u0431\u0435, \u0440\u043E\u0434\u043D\u0435 \u0438 \u043D\u0443\u0436\u0434\u0430\u044E\u0449\u0438\u043C\u0441\u044F, \u0432\u0441\u0451 \u043F\u043E \u0441\u0443\u043D\u043D\u0435.",
      amount: 18e3,
      financeable: true
    },
    {
      id: "dd-abonement-v-zal",
      title: "\u0413\u043E\u0434\u043E\u0432\u043E\u0439 \u0430\u0431\u043E\u043D\u0435\u043C\u0435\u043D\u0442 \u0432 \u0437\u0430\u043B",
      flavor: "\u0421 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A\u0430 \u2014 \u043D\u043E\u0432\u0430\u044F \u0436\u0438\u0437\u043D\u044C. \u0410\u0431\u043E\u043D\u0435\u043C\u0435\u043D\u0442 \u2014 \u0441\u0432\u0438\u0434\u0435\u0442\u0435\u043B\u044C \u0441\u0442\u0430\u0440\u043E\u0439.",
      amount: 2e4,
      financeable: true
    },
    {
      id: "dd-putevka-v-lager",
      title: "\u041F\u0443\u0442\u0451\u0432\u043A\u0430 \u0432 \u043B\u0430\u0433\u0435\u0440\u044C",
      flavor: "\u0422\u0440\u0438 \u043D\u0435\u0434\u0435\u043B\u0438 \u0442\u0438\u0448\u0438\u043D\u044B \u0434\u043E\u043C\u0430. \u0415\u0441\u043B\u0438 \u043F\u043E\u0434\u0443\u043C\u0430\u0442\u044C \u2014 \u043F\u043E\u0447\u0442\u0438 \u0434\u0430\u0440\u043E\u043C.",
      amount: 25e3,
      financeable: true
    },
    {
      id: "dd-televizor-sgorel",
      title: "\u0422\u0435\u043B\u0435\u0432\u0438\u0437\u043E\u0440 \u043F\u0440\u0438\u043A\u0430\u0437\u0430\u043B \u0434\u043E\u043B\u0433\u043E \u0436\u0438\u0442\u044C",
      flavor: "\u041D\u0435 \u043F\u0435\u0440\u0435\u0436\u0438\u043B \u0444\u0438\u043D\u0430\u043B \u043F\u043E \u0431\u043E\u0440\u044C\u0431\u0435. \u0414\u0435\u0434 \u0431\u0435\u0437 \u0442\u0435\u043B\u0435\u0432\u0438\u0437\u043E\u0440\u0430 \u0441 \u0432\u043D\u0443\u043A\u0430\u043C\u0438 \u0441\u0438\u0434\u0435\u0442\u044C \u043E\u0442\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F.",
      amount: 28e3,
      financeable: true
    }
  ],
  FAST_BOARD_RU: [
    {
      type: "cashflowDay"
    },
    {
      type: "business",
      id: "fast-biz-coffee-ufa",
      name: "\u0425\u0430\u043B\u044F\u043B\u044C-\u043A\u043E\u0444\u0435\u0439\u043D\u044F \u0443 \u0421\u043E\u0431\u043E\u0440\u043D\u043E\u0439 \u043C\u0435\u0447\u0435\u0442\u0438, \u0423\u0444\u0430",
      flavor: "\u041F\u044F\u0442\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u0442\u043E\u043A \u0433\u043E\u0441\u0442\u0435\u0439 \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u0435\u0435 \u043A\u0443\u0440\u0441\u0430 \u0440\u0443\u0431\u043B\u044F. \u0411\u0430\u0440\u0438\u0441\u0442\u0430 \u041C\u0430\u0440\u0430\u0442 \u043F\u043E \u0441\u043E\u0432\u043C\u0435\u0441\u0442\u0438\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0443 \u043E\u0445\u0440\u0430\u043D\u043D\u0438\u043A \u0438 \u043F\u0441\u0438\u0445\u043E\u043B\u043E\u0433.",
      downPayment: 25e5,
      cashFlow: 85e3
    },
    {
      type: "dream",
      id: "fast-dream-hajj-family",
      name: "\u0425\u0430\u0434\u0436 \u0432\u0441\u0435\u0439 \u0441\u0435\u043C\u044C\u0451\u0439",
      flavor: "\u041C\u0435\u043A\u043A\u0430, \u041C\u0435\u0434\u0438\u043D\u0430, \u0440\u043E\u0434\u0438\u0442\u0435\u043B\u0438 \u0438 \u0434\u0435\u0442\u0438 \u2014 \u0432\u0441\u0435 \u0432\u043C\u0435\u0441\u0442\u0435. \u041C\u0435\u0447\u0442\u0430, \u0440\u0430\u0434\u0438 \u043A\u043E\u0442\u043E\u0440\u043E\u0439 \u0432\u0441\u0451 \u0438 \u0437\u0430\u0442\u0435\u0432\u0430\u043B\u043E\u0441\u044C.",
      price: 3e6
    },
    {
      type: "taxAudit"
    },
    {
      type: "business",
      id: "fast-biz-echpochmak-kzn",
      name: "\u0421\u0435\u0442\u044C \u043F\u0435\u043A\u0430\u0440\u0435\u043D \xAB\u042D\u0447\u043F\u043E\u0447\u043C\u0430\u043A \u0438 \u0442\u043E\u0447\u043A\u0430\xBB, \u041A\u0430\u0437\u0430\u043D\u044C",
      flavor: "\u0422\u0440\u0438 \u0443\u0433\u043B\u0430, \u0442\u0440\u0438 \u043E\u0447\u0435\u0440\u0435\u0434\u0438, \u043D\u043E\u043B\u044C \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0441\u0442\u043E\u043B\u0438\u043A\u043E\u0432. \u0422\u0435\u0441\u0442\u043E \u043F\u043E \u043F\u044F\u0442\u043D\u0438\u0446\u0430\u043C \u043C\u0435\u0441\u0438\u0442 \u0441\u0430\u043C \u043E\u0441\u043D\u043E\u0432\u0430\u0442\u0435\u043B\u044C.",
      downPayment: 35e5,
      cashFlow: 11e4
    },
    {
      type: "venture",
      id: "fast-venture-drill-siberia",
      name: "\u0414\u043E\u043B\u044F \u0432 \u0431\u0443\u0440\u043E\u0432\u043E\u0439 \u043F\u043E\u0434 \u0421\u0443\u0440\u0433\u0443\u0442\u043E\u043C",
      flavor: "\u041F\u0430\u0440\u0442\u043D\u0451\u0440\u044B \u0437\u043E\u0432\u0443\u0442 \u0432 \u0441\u043A\u0432\u0430\u0436\u0438\u043D\u0443. \u041C\u043E\u0440\u043E\u0437\u044B \u043C\u0438\u043D\u0443\u0441 \u0441\u043E\u0440\u043E\u043A, \u0434\u043E\u0445\u043E\u0434\u044B \u043F\u043B\u044E\u0441 \u0448\u0435\u0441\u0442\u044C\u0441\u043E\u0442.",
      downPayment: 8e6,
      cashFlow: 6e5,
      threshold: 5
    },
    {
      type: "taxAudit"
    },
    {
      type: "dream",
      id: "fast-dream-supercar",
      name: "\u0421\u0443\u043F\u0435\u0440\u043A\u0430\u0440 \u0441 \u043F\u0430\u043D\u043E\u0440\u0430\u043C\u043D\u043E\u0439 \u043A\u0440\u044B\u0448\u0435\u0439",
      flavor: "\u0420\u0430\u0437\u0433\u043E\u043D \u0434\u043E \u0441\u043E\u0442\u043D\u0438 \u0431\u044B\u0441\u0442\u0440\u0435\u0435, \u0447\u0435\u043C \u0441\u043E\u0441\u0435\u0434 \u0443\u0441\u043F\u0435\u0435\u0442 \u0441\u043F\u0440\u043E\u0441\u0438\u0442\u044C \xAB\u043F\u043E\u0447\u0451\u043C \u0431\u0440\u0430\u043B?\xBB.",
      price: 25e6
    },
    {
      type: "business",
      id: "fast-biz-carwash-ufa",
      name: "\u0410\u0432\u0442\u043E\u043C\u043E\u0439\u043A\u0438 \u0441\u0430\u043C\u043E\u043E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u044F, \u0423\u0444\u0430",
      flavor: "\u0417\u0438\u043C\u0430 \u0434\u0435\u0432\u044F\u0442\u044C \u043C\u0435\u0441\u044F\u0446\u0435\u0432, \u0433\u0440\u044F\u0437\u044C \u043D\u0435 \u043A\u043E\u043D\u0447\u0430\u0435\u0442\u0441\u044F \u043D\u0438\u043A\u043E\u0433\u0434\u0430. \u0414\u0435\u043D\u044C\u0433\u0438 \u043A\u0430\u043F\u0430\u044E\u0442 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043F\u0435\u043D\u043E\u0439.",
      downPayment: 4e6,
      cashFlow: 13e4
    },
    {
      type: "venture",
      id: "fast-venture-yamal-crew",
      name: "\u0412\u0430\u0445\u0442\u043E\u0432\u044B\u0439 \u043F\u043E\u0434\u0440\u044F\u0434 \u043D\u0430 \u042F\u043C\u0430\u043B\u0435",
      flavor: "\u0411\u0440\u0438\u0433\u0430\u0434\u0430 \u043F\u0440\u043E\u0441\u0438\u0442\u0441\u044F \u043F\u043E\u0434 \u0432\u0430\u0448\u0435 \u043A\u0440\u044B\u043B\u043E: \u0442\u0435\u0445\u043D\u0438\u043A\u0430 \u0438 \u0445\u0430\u0440\u0447\u0438 \u0441 \u0432\u0430\u0441, \u043F\u0440\u0438\u0431\u044B\u043B\u044C \u043F\u043E\u043F\u043E\u043B\u0430\u043C. \u0421\u0435\u0432\u0435\u0440 \u0448\u0443\u0442\u0438\u0442\u044C \u043D\u0435 \u043B\u044E\u0431\u0438\u0442.",
      downPayment: 4e6,
      cashFlow: 3e5,
      threshold: 5
    },
    {
      type: "dream",
      id: "fast-dream-sochi-house",
      name: "\u0414\u043E\u043C \u0443 \u043C\u043E\u0440\u044F \u0432 \u0421\u043E\u0447\u0438",
      flavor: "\u0428\u0443\u043C \u0432\u043E\u043B\u043D \u0432\u043C\u0435\u0441\u0442\u043E \u0431\u0443\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0430. \u0420\u043E\u0434\u043D\u044F \u043F\u0440\u0438\u0435\u0434\u0435\u0442 \xAB\u043D\u0430 \u043D\u0435\u0434\u0435\u043B\u044C\u043A\u0443\xBB \u2014 \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430.",
      price: 4e7
    },
    {
      type: "cashflowDay"
    },
    {
      type: "business",
      id: "fast-biz-halal-cafe-kzn",
      name: "\u0421\u0435\u0442\u044C \u0445\u0430\u043B\u044F\u043B\u044C-\u043A\u0430\u0444\u0435 \xAB\u041A\u0430\u0437\u0430\u043D\xBB",
      flavor: "\u041F\u043B\u043E\u0432 \u043A\u0430\u043A \u0443 \u0431\u0430\u0431\u0443\u0448\u043A\u0438, \u043D\u0430\u0446\u0435\u043D\u043A\u0430 \u043A\u0430\u043A \u0432 \u041C\u043E\u0441\u043A\u0432\u0435. \u0412\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u043F\u0435\u0440\u0435\u0435\u0437\u0436\u0430\u0435\u0442 \u0438 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0434\u043E\u043B\u044E.",
      downPayment: 6e6,
      cashFlow: 19e4
    },
    {
      type: "dream",
      id: "fast-dream-build-mosque",
      name: "\u041F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043C\u0435\u0447\u0435\u0442\u044C",
      flavor: "\u0418\u043C\u044F \u043D\u0435 \u043D\u0430 \u0442\u0430\u0431\u043B\u0438\u0447\u043A\u0435, \u0430 \u0432 \u0441\u0435\u0440\u0434\u0446\u0430\u0445 \u0446\u0435\u043B\u043E\u0433\u043E \u0440\u0430\u0439\u043E\u043D\u0430. \u0414\u043E\u0431\u0440\u043E\u0435 \u0434\u0435\u043B\u043E, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432\u0435\u0447\u043D\u043E.",
      price: 3e7
    },
    {
      type: "business",
      id: "fast-biz-sewing-chelny",
      name: "\u0428\u0432\u0435\u0439\u043D\u044B\u0439 \u0446\u0435\u0445 \u0441\u043F\u0435\u0446\u043E\u0434\u0435\u0436\u0434\u044B, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B",
      flavor: "\u0417\u0430\u0432\u043E\u0434\u044B \u0440\u044F\u0434\u043E\u043C, \u0440\u043E\u0431\u0430 \u043D\u0443\u0436\u043D\u0430 \u0432\u0441\u0435\u043C \u0438 \u0432\u0441\u0435\u0433\u0434\u0430. \u0417\u0430\u043A\u0430\u0437\u044B \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u044B \u0434\u043E \u0437\u0438\u043C\u044B.",
      downPayment: 3e6,
      cashFlow: 1e5
    },
    {
      type: "lawsuit"
    },
    {
      type: "dream",
      id: "fast-dream-orphan-fund",
      name: "\u0424\u043E\u043D\u0434 \u0441\u0442\u0438\u043F\u0435\u043D\u0434\u0438\u0439 \u0434\u043B\u044F \u0441\u0438\u0440\u043E\u0442",
      flavor: "\u0421\u0442\u043E \u0440\u0435\u0431\u044F\u0442 \u0432\u044B\u0443\u0447\u0430\u0442\u0441\u044F \u0438 \u0432\u0441\u0442\u0430\u043D\u0443\u0442 \u043D\u0430 \u043D\u043E\u0433\u0438. \u0412\u043B\u043E\u0436\u0435\u043D\u0438\u0435, \u0443 \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u043D\u0435\u0442 \u0446\u0435\u043D\u044B \u0432\u044B\u0445\u043E\u0434\u0430.",
      price: 2e7
    },
    {
      type: "business",
      id: "fast-biz-it-artel-innopolis",
      name: "\u0418\u0422-\u0430\u0440\u0442\u0435\u043B\u044C \u0432 \u0418\u043D\u043D\u043E\u043F\u043E\u043B\u0438\u0441\u0435",
      flavor: "\u041F\u0438\u0448\u0443\u0442 \u0443\u0447\u0451\u0442 \u0434\u043B\u044F \u0444\u0435\u0440\u043C \u0438 \u043C\u044F\u0441\u043E\u043A\u043E\u043C\u0431\u0438\u043D\u0430\u0442\u043E\u0432. \u041A\u043B\u0438\u0435\u043D\u0442\u044B \u043F\u043B\u0430\u0442\u044F\u0442 \u0432\u043E\u0432\u0440\u0435\u043C\u044F \u2014 \u0431\u043E\u043B\u044C\u0448\u0430\u044F \u0440\u0435\u0434\u043A\u043E\u0441\u0442\u044C.",
      downPayment: 5e6,
      cashFlow: 16e4
    },
    {
      type: "divorce"
    },
    {
      type: "business",
      id: "fast-biz-water-rodnik",
      name: "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u0432\u043E\u0434\u044B \xAB\u0420\u043E\u0434\u043D\u0438\u043A\xBB, \u041A\u0430\u0437\u0430\u043D\u044C",
      flavor: "\u041E\u0444\u0438\u0441\u044B \u043F\u044C\u044E\u0442 \u043A\u0430\u043A \u043D\u0435 \u0432 \u0441\u0435\u0431\u044F. \u0414\u0432\u0430 \u0444\u0443\u0440\u0433\u043E\u043D\u0430 \u0438 \u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0418\u043B\u044C\u0434\u0430\u0440 \u0432 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0435.",
      downPayment: 25e5,
      cashFlow: 8e4
    },
    {
      type: "dream",
      id: "fast-dream-world-trip",
      name: "\u041A\u0440\u0443\u0433\u043E\u0441\u0432\u0435\u0442\u043A\u0430 \u0441 \u0441\u0435\u043C\u044C\u0451\u0439",
      flavor: "\u0413\u043E\u0434 \u0431\u0435\u0437 \u0448\u043A\u043E\u043B\u044B \u0438 \u043F\u043B\u0430\u043D\u0451\u0440\u043E\u043A. \u0413\u0435\u043E\u0433\u0440\u0430\u0444\u0438\u044F \u0432\u0436\u0438\u0432\u0443\u044E, \u0430 \u043D\u0435 \u043F\u043E \u0443\u0447\u0435\u0431\u043D\u0438\u043A\u0443.",
      price: 8e6
    },
    {
      type: "business",
      id: "fast-biz-glamping-altai",
      name: "\u0413\u043B\u044D\u043C\u043F\u0438\u043D\u0433 \u043D\u0430 \u0410\u043B\u0442\u0430\u0435",
      flavor: "\u0428\u0430\u0442\u0440\u044B \u0441 \u0432\u0438\u0434\u043E\u043C \u043D\u0430 \u0433\u043E\u0440\u044B. \u041C\u043E\u0441\u043A\u0432\u0438\u0447\u0438 \u043F\u043B\u0430\u0442\u044F\u0442 \u0437\u0430 \xAB\u043E\u0442\u0434\u044B\u0445 \u0431\u0435\u0437 \u0441\u0432\u044F\u0437\u0438\xBB \u0431\u043E\u043B\u044C\u0448\u0435, \u0447\u0435\u043C \u0437\u0430 \u0441\u0432\u044F\u0437\u044C.",
      downPayment: 7e6,
      cashFlow: 22e4
    },
    {
      type: "cashflowDay"
    },
    {
      type: "business",
      id: "fast-biz-frozen-food-chelny",
      name: "\u0417\u0430\u0432\u043E\u0434 \u0445\u0430\u043B\u044F\u043B\u044C-\u043F\u043E\u043B\u0443\u0444\u0430\u0431\u0440\u0438\u043A\u0430\u0442\u043E\u0432, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B",
      flavor: "\u041F\u0435\u043B\u044C\u043C\u0435\u043D\u0438 \u0438 \u043C\u0430\u043D\u0442\u044B \u0443\u043B\u0435\u0442\u0430\u044E\u0442 \u0441\u043E \u0441\u043A\u043B\u0430\u0434\u0430 \u0431\u044B\u0441\u0442\u0440\u0435\u0435, \u0447\u0435\u043C \u0432\u0430\u0440\u044F\u0442\u0441\u044F. \u0421\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442 \u2014 \u0432 \u0440\u0430\u043C\u043A\u0435 \u043D\u0430 \u0441\u0442\u0435\u043D\u0435.",
      downPayment: 1e7,
      cashFlow: 28e4
    },
    {
      type: "dream",
      id: "fast-dream-apple-garden",
      name: "\u0421\u0432\u043E\u0439 \u044F\u0431\u043B\u043E\u043D\u0435\u0432\u044B\u0439 \u0441\u0430\u0434",
      flavor: "\u0420\u044F\u0434\u044B \u0430\u043D\u0442\u043E\u043D\u043E\u0432\u043A\u0438 \u0434\u043E \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442\u0430. \u041E\u0441\u0435\u043D\u044C\u044E \u2014 \u044F\u0449\u0438\u043A\u0438 \u044F\u0431\u043B\u043E\u043A \u0432\u0441\u0435\u043C \u0441\u043E\u0441\u0435\u0434\u044F\u043C, \u0434\u0430\u0440\u043E\u043C.",
      price: 6e6
    },
    {
      type: "lawsuit"
    },
    {
      type: "business",
      id: "fast-biz-dental-kzn",
      name: "\u0421\u0442\u043E\u043C\u0430\u0442\u043E\u043B\u043E\u0433\u0438\u044F \xAB\u0416\u0435\u043C\u0447\u0443\u0433\xBB, \u041A\u0430\u0437\u0430\u043D\u044C",
      flavor: "\u0422\u0440\u0438 \u043A\u0440\u0435\u0441\u043B\u0430, \u0437\u0430\u043F\u0438\u0441\u044C \u043D\u0430 \u043C\u0435\u0441\u044F\u0446 \u0432\u043F\u0435\u0440\u0451\u0434. \u0417\u0430 \u0443\u043B\u044B\u0431\u043A\u0443 \u043F\u043B\u0430\u0442\u044F\u0442 \u043E\u0445\u043E\u0442\u043D\u043E \u2014 \u043E\u0441\u043E\u0431\u0435\u043D\u043D\u043E \u043F\u0435\u0440\u0435\u0434 \u043D\u0438\u043A\u0430\u0445\u043E\u043C.",
      downPayment: 12e6,
      cashFlow: 38e4
    },
    {
      type: "venture",
      id: "fast-venture-startup-airat",
      name: "\u0421\u0442\u0430\u0440\u0442\u0430\u043F \u0434\u0440\u0443\u0433\u0430 \u0410\u0439\u0440\u0430\u0442\u0430",
      flavor: "\u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u043F\u043E\u0438\u0441\u043A\u0430 \u0445\u0430\u043B\u044F\u043B\u044C-\u043A\u0430\u0444\u0435. \u0410\u0439\u0440\u0430\u0442 \u043A\u043B\u044F\u043D\u0451\u0442\u0441\u044F: \xAB\u042D\u0442\u043E \u043D\u043E\u0432\u044B\u0439 \u0435\u0434\u0438\u043D\u043E\u0440\u043E\u0433, \u0431\u0440\u0430\u0442!\xBB \u041D\u0443-\u043D\u0443.",
      downPayment: 3e6,
      cashFlow: 25e4,
      threshold: 5
    },
    {
      type: "dream",
      id: "fast-dream-animal-shelter",
      name: "\u041F\u0440\u0438\u044E\u0442 \u0434\u043B\u044F \u0436\u0438\u0432\u043E\u0442\u043D\u044B\u0445",
      flavor: "\u0422\u0440\u0438\u0441\u0442\u0430 \u0445\u0432\u043E\u0441\u0442\u043E\u0432 \u043E\u0431\u0440\u0435\u0442\u0443\u0442 \u0434\u043E\u043C. \u0414\u0438\u0432\u0438\u0434\u0435\u043D\u0434\u044B \u0432\u044B\u043F\u043B\u0430\u0447\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u043C\u0443\u0440\u043B\u044B\u043A\u0430\u043D\u044C\u0435\u043C.",
      price: 1e7
    },
    {
      type: "business",
      id: "fast-biz-autoservice-ufa",
      name: "\u0421\u0435\u0442\u044C \u0430\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441\u043E\u0432, \u0423\u0444\u0430",
      flavor: "\u0420\u0443\u0441\u0441\u043A\u0430\u044F \u0434\u043E\u0440\u043E\u0433\u0430 \u0441\u0430\u043C\u0430 \u043F\u0440\u0438\u0432\u043E\u0434\u0438\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432. \u041C\u0430\u0441\u0442\u0435\u0440\u0430 \u0447\u0435\u0441\u0442\u043D\u044B\u0435: \u043B\u0438\u0448\u043D\u0435\u0433\u043E \u043D\u0435 \u043E\u0442\u043A\u0440\u0443\u0447\u0438\u0432\u0430\u044E\u0442.",
      downPayment: 8e6,
      cashFlow: 21e4
    },
    {
      type: "downsized"
    },
    {
      type: "dream",
      id: "fast-dream-media-studio",
      name: "\u0421\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u043C\u0435\u0434\u0438\u0430\u0441\u0442\u0443\u0434\u0438\u044F",
      flavor: "\u0421\u0432\u0435\u0442, \u043A\u0430\u043C\u0435\u0440\u0430, \u0441\u0432\u043E\u0438 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0438. \u0411\u043E\u043B\u044C\u0448\u0435 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u0441\u043A\u0430\u0436\u0435\u0442 \xAB\u043D\u0430\u043C \u0442\u0430\u043A\u043E\u0435 \u043D\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442\xBB.",
      price: 12e6
    },
    {
      type: "business",
      id: "fast-biz-madrasa-school",
      name: "\u0427\u0430\u0441\u0442\u043D\u0430\u044F \u0448\u043A\u043E\u043B\u0430-\u043C\u0435\u0434\u0440\u0435\u0441\u0435 (\u0441\u043A\u043B\u0430\u0434\u0447\u0438\u043D\u0430), \u041A\u0430\u0437\u0430\u043D\u044C",
      flavor: "\u0414\u0435\u0442\u0438 \u0443\u0447\u0430\u0442 \u041A\u043E\u0440\u0430\u043D \u0438 \u0442\u0430\u0431\u043B\u0438\u0446\u0443 \u0443\u043C\u043D\u043E\u0436\u0435\u043D\u0438\u044F \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u043E \u0431\u043E\u0434\u0440\u043E. \u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043D\u0430 \u0434\u0432\u0430 \u0433\u043E\u0434\u0430 \u0432\u043F\u0435\u0440\u0451\u0434.",
      downPayment: 45e5,
      cashFlow: 14e4
    },
    {
      type: "cashflowDay"
    },
    {
      type: "dream",
      id: "fast-dream-altai-cabin",
      name: "\u0414\u043E\u043C\u0438\u043A \u0432 \u0433\u043E\u0440\u0430\u0445 \u0410\u043B\u0442\u0430\u044F",
      flavor: "\u0411\u0430\u043D\u044C\u043A\u0430, \u043A\u0435\u0434\u0440\u044B, \u0441\u0432\u044F\u0437\u0438 \u043D\u0435\u0442 \u2014 \u0438 \u0441\u043B\u0430\u0432\u0430 \u0411\u043E\u0433\u0443.",
      price: 9e6
    },
    {
      type: "business",
      id: "fast-biz-logistics-chelny",
      name: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F, \u041D\u0430\u0431. \u0427\u0435\u043B\u043D\u044B",
      flavor: "\u0414\u0435\u0441\u044F\u0442\u044C \u0444\u0443\u0440 \u0432\u043E\u0437\u044F\u0442 \u0433\u0440\u0443\u0437 \u043E\u0442 \u041A\u0430\u0437\u0430\u043D\u0438 \u0434\u043E \u0414\u0443\u0431\u0430\u044F. \u0414\u0430\u043B\u044C\u043D\u043E\u0431\u043E\u0439\u0449\u0438\u043A\u0438 \u043D\u0435 \u043A\u0443\u0440\u044F\u0442 \u2014 \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u044F \u0438 \u043D\u0430 \u044D\u0442\u043E\u043C.",
      downPayment: 13e6,
      cashFlow: 42e4
    },
    {
      type: "lawsuit"
    },
    {
      type: "business",
      id: "fast-biz-goat-farm-bashkiria",
      name: "\u041A\u043E\u0437\u044C\u044F \u0444\u0435\u0440\u043C\u0430 \u0441 \u0441\u044B\u0440\u043E\u0432\u0430\u0440\u043D\u0435\u0439, \u0411\u0430\u0448\u043A\u0438\u0440\u0438\u044F",
      flavor: "\u0421\u044B\u0440 \u0440\u0430\u0437\u0431\u0438\u0440\u0430\u044E\u0442 \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u044B \u041A\u0430\u0437\u0430\u043D\u0438 \u0438 \u0423\u0444\u044B. \u041A\u043E\u0437\u044B \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u0431\u0435\u0437 \u0432\u044B\u0445\u043E\u0434\u043D\u044B\u0445 \u0438 \u043D\u0435 \u043F\u0440\u043E\u0441\u044F\u0442 \u043E\u0442\u043F\u0443\u0441\u043A\u043D\u044B\u0445.",
      downPayment: 55e5,
      cashFlow: 17e4
    },
    {
      type: "charity"
    },
    {
      type: "dream",
      id: "fast-dream-small-plane",
      name: "\u041C\u0430\u043B\u044B\u0439 \u0441\u0430\u043C\u043E\u043B\u0451\u0442 \u0438 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u044F \u043F\u0438\u043B\u043E\u0442\u0430",
      flavor: "\u0423\u0444\u0430 \u2014 \u041A\u0430\u0437\u0430\u043D\u044C \u0437\u0430 \u0447\u0430\u0441, \u043D\u0430\u0434 \u043F\u0440\u043E\u0431\u043A\u0430\u043C\u0438. \u0428\u0442\u0443\u0440\u0432\u0430\u043B \u0441\u0432\u043E\u0439, \u043D\u0435\u0431\u043E \u043E\u0431\u0449\u0435\u0435.",
      price: 18e6
    },
    {
      type: "venture",
      id: "fast-venture-export-uae",
      name: "\u042D\u043A\u0441\u043F\u043E\u0440\u0442 \u0445\u0430\u043B\u044F\u043B\u044C-\u043C\u044F\u0441\u0430 \u0432 \u042D\u043C\u0438\u0440\u0430\u0442\u044B",
      flavor: "\u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442 \u0441 \u0441\u0435\u0442\u044C\u044E \u0432 \u0414\u0443\u0431\u0430\u0435. \u0415\u0441\u043B\u0438 \u0441\u0430\u043C\u043E\u043B\u0451\u0442 \u0434\u043E\u043B\u0435\u0442\u0438\u0442 \u0438 \u043F\u0435\u0447\u0430\u0442\u0438 \u0441\u043E\u0439\u0434\u0443\u0442\u0441\u044F \u2014 \u043E\u0437\u043E\u043B\u043E\u0442\u0438\u0442\u0435\u0441\u044C.",
      downPayment: 6e6,
      cashFlow: 45e4,
      threshold: 5
    },
    {
      type: "business",
      id: "fast-biz-meat-shops-kzn",
      name: "\u0421\u0435\u0442\u044C \u043C\u044F\u0441\u043D\u044B\u0445 \u043B\u0430\u0432\u043E\u043A \xAB\u0425\u0430\u043B\u044F\u043B\u044C\xBB, \u041A\u0430\u0437\u0430\u043D\u044C",
      flavor: "\u041F\u044F\u0442\u044C \u0442\u043E\u0447\u0435\u043A \u043D\u0430 \u0440\u044B\u043D\u043A\u0430\u0445. \u041C\u044F\u0441\u043D\u0438\u043A \u0420\u0443\u0441\u0442\u0430\u043C \u0440\u0435\u0436\u0435\u0442 \u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E \u2014 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0441\u0442\u043E\u0438\u0442 \u0441 \u0443\u0442\u0440\u0430.",
      downPayment: 9e6,
      cashFlow: 29e4
    },
    {
      type: "divorce"
    },
    {
      type: "dream",
      id: "fast-dream-village-library",
      name: "\u0411\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u0430-\u0444\u043E\u043D\u0434 \u0432 \u0440\u043E\u0434\u043D\u043E\u043C \u0441\u0435\u043B\u0435",
      flavor: "\u0422\u0430\u043C, \u0433\u0434\u0435 \u0432\u044B \u0431\u0435\u0433\u0430\u043B\u0438 \u0431\u043E\u0441\u0438\u043A\u043E\u043C, \u0434\u0435\u0442\u0438 \u0431\u0443\u0434\u0443\u0442 \u0447\u0438\u0442\u0430\u0442\u044C \u0434\u043E \u043D\u043E\u0447\u0438. \u0417\u0435\u043C\u043B\u044F\u043A\u0438 \u0437\u0430\u043F\u043E\u043C\u043D\u044F\u0442.",
      price: 5e6
    }
  ]
};

// src/data/professions.json
var professions_default = [
  {
    id: "airline-pilot",
    name: "Airline Pilot",
    salary: 9500,
    savings: 400,
    perChildExpense: 480,
    expenses: {
      taxes: 2350,
      homeMortgagePayment: 1330,
      schoolLoanPayment: 0,
      carPayment: 300,
      creditCardPayment: 660,
      retailPayment: 50,
      otherExpenses: 2210
    },
    liabilities: {
      homeMortgage: 143e3,
      schoolLoans: 0,
      carLoans: 15e3,
      creditCards: 22e3,
      retailDebt: 1e3
    }
  },
  {
    id: "business-manager",
    name: "Business Manager",
    salary: 4600,
    savings: 400,
    perChildExpense: 240,
    expenses: {
      taxes: 910,
      homeMortgagePayment: 700,
      schoolLoanPayment: 60,
      carPayment: 120,
      creditCardPayment: 90,
      retailPayment: 50,
      otherExpenses: 1e3
    },
    liabilities: {
      homeMortgage: 75e3,
      schoolLoans: 12e3,
      carLoans: 6e3,
      creditCards: 3e3,
      retailDebt: 1e3
    }
  },
  {
    id: "doctor",
    name: "Doctor (MD)",
    salary: 13200,
    savings: 400,
    perChildExpense: 640,
    expenses: {
      taxes: 3420,
      homeMortgagePayment: 1900,
      schoolLoanPayment: 750,
      carPayment: 380,
      creditCardPayment: 270,
      retailPayment: 50,
      otherExpenses: 2880
    },
    liabilities: {
      homeMortgage: 202e3,
      schoolLoans: 15e4,
      carLoans: 19e3,
      creditCards: 9e3,
      retailDebt: 1e3
    }
  },
  {
    id: "engineer",
    name: "Engineer",
    salary: 4900,
    savings: 400,
    perChildExpense: 250,
    expenses: {
      taxes: 1050,
      homeMortgagePayment: 700,
      schoolLoanPayment: 60,
      carPayment: 140,
      creditCardPayment: 120,
      retailPayment: 50,
      otherExpenses: 1090
    },
    liabilities: {
      homeMortgage: 75e3,
      schoolLoans: 12e3,
      carLoans: 7e3,
      creditCards: 4e3,
      retailDebt: 1e3
    }
  },
  {
    id: "janitor",
    name: "Janitor",
    salary: 1600,
    savings: 560,
    perChildExpense: 70,
    expenses: {
      taxes: 280,
      homeMortgagePayment: 200,
      schoolLoanPayment: 0,
      carPayment: 60,
      creditCardPayment: 60,
      retailPayment: 50,
      otherExpenses: 300
    },
    liabilities: {
      homeMortgage: 2e4,
      schoolLoans: 0,
      carLoans: 4e3,
      creditCards: 2e3,
      retailDebt: 1e3
    }
  },
  {
    id: "lawyer",
    name: "Lawyer",
    salary: 7500,
    savings: 400,
    perChildExpense: 380,
    expenses: {
      taxes: 1830,
      homeMortgagePayment: 1100,
      schoolLoanPayment: 390,
      carPayment: 220,
      creditCardPayment: 180,
      retailPayment: 50,
      otherExpenses: 1650
    },
    liabilities: {
      homeMortgage: 115e3,
      schoolLoans: 78e3,
      carLoans: 11e3,
      creditCards: 6e3,
      retailDebt: 1e3
    }
  },
  {
    id: "mechanic",
    name: "Mechanic",
    salary: 2e3,
    savings: 670,
    perChildExpense: 110,
    expenses: {
      taxes: 360,
      homeMortgagePayment: 300,
      schoolLoanPayment: 0,
      carPayment: 60,
      creditCardPayment: 60,
      retailPayment: 50,
      otherExpenses: 450
    },
    liabilities: {
      homeMortgage: 31e3,
      schoolLoans: 0,
      carLoans: 3e3,
      creditCards: 2e3,
      retailDebt: 1e3
    }
  },
  {
    id: "nurse",
    name: "Nurse",
    salary: 3100,
    savings: 480,
    perChildExpense: 170,
    expenses: {
      taxes: 600,
      homeMortgagePayment: 400,
      schoolLoanPayment: 30,
      carPayment: 100,
      creditCardPayment: 90,
      retailPayment: 50,
      otherExpenses: 710
    },
    liabilities: {
      homeMortgage: 47e3,
      schoolLoans: 6e3,
      carLoans: 5e3,
      creditCards: 3e3,
      retailDebt: 1e3
    }
  },
  {
    id: "police-officer",
    name: "Police Officer",
    salary: 3e3,
    savings: 520,
    perChildExpense: 160,
    expenses: {
      taxes: 580,
      homeMortgagePayment: 400,
      schoolLoanPayment: 0,
      carPayment: 100,
      creditCardPayment: 60,
      retailPayment: 50,
      otherExpenses: 690
    },
    liabilities: {
      homeMortgage: 46e3,
      schoolLoans: 0,
      carLoans: 5e3,
      creditCards: 2e3,
      retailDebt: 1e3
    }
  },
  {
    id: "secretary",
    name: "Secretary",
    salary: 2500,
    savings: 710,
    perChildExpense: 140,
    expenses: {
      taxes: 460,
      homeMortgagePayment: 400,
      schoolLoanPayment: 0,
      carPayment: 80,
      creditCardPayment: 60,
      retailPayment: 50,
      otherExpenses: 570
    },
    liabilities: {
      homeMortgage: 38e3,
      schoolLoans: 0,
      carLoans: 4e3,
      creditCards: 2e3,
      retailDebt: 1e3
    }
  },
  {
    id: "teacher",
    name: "Teacher (K-12)",
    salary: 3300,
    savings: 400,
    perChildExpense: 180,
    expenses: {
      taxes: 630,
      homeMortgagePayment: 500,
      schoolLoanPayment: 60,
      carPayment: 100,
      creditCardPayment: 90,
      retailPayment: 50,
      otherExpenses: 760
    },
    liabilities: {
      homeMortgage: 5e4,
      schoolLoans: 12e3,
      carLoans: 5e3,
      creditCards: 3e3,
      retailDebt: 1e3
    }
  },
  {
    id: "truck-driver",
    name: "Truck Driver",
    salary: 2500,
    savings: 750,
    perChildExpense: 140,
    expenses: {
      taxes: 460,
      homeMortgagePayment: 400,
      schoolLoanPayment: 0,
      carPayment: 80,
      creditCardPayment: 60,
      retailPayment: 50,
      otherExpenses: 570
    },
    liabilities: {
      homeMortgage: 38e3,
      schoolLoans: 0,
      carLoans: 4e3,
      creditCards: 2e3,
      retailDebt: 1e3
    }
  }
];

// src/data/professions_ru.json
var professions_ru_default = [
  {
    id: "pilot",
    name: "\u041F\u0438\u043B\u043E\u0442 \u0430\u0432\u0438\u0430\u043B\u0430\u0439\u043D\u0435\u0440\u0430",
    salary: 4e5,
    savings: 6e4,
    perChildExpense: 18e3,
    expenses: {
      taxes: 95e3,
      homeMortgagePayment: 55e3,
      schoolLoanPayment: 0,
      carPayment: 25e3,
      creditCardPayment: 18e3,
      retailPayment: 4e3,
      otherExpenses: 88e3
    },
    liabilities: {
      homeMortgage: 58e5,
      schoolLoans: 0,
      carLoans: 14e5,
      creditCards: 5e5,
      retailDebt: 6e4
    }
  },
  {
    id: "doctor",
    name: "\u0412\u0440\u0430\u0447 \u0447\u0430\u0441\u0442\u043D\u043E\u0439 \u043A\u043B\u0438\u043D\u0438\u043A\u0438",
    salary: 18e4,
    savings: 35e3,
    perChildExpense: 12e3,
    expenses: {
      taxes: 4e4,
      homeMortgagePayment: 32e3,
      schoolLoanPayment: 4e3,
      carPayment: 14e3,
      creditCardPayment: 6e3,
      retailPayment: 2500,
      otherExpenses: 39e3
    },
    liabilities: {
      homeMortgage: 34e5,
      schoolLoans: 22e4,
      carLoans: 8e5,
      creditCards: 16e4,
      retailDebt: 4e4
    }
  },
  {
    id: "lawyer",
    name: "\u042E\u0440\u0438\u0441\u0442",
    salary: 16e4,
    savings: 3e4,
    perChildExpense: 11e3,
    expenses: {
      taxes: 36e3,
      homeMortgagePayment: 3e4,
      schoolLoanPayment: 3500,
      carPayment: 12e3,
      creditCardPayment: 6e3,
      retailPayment: 2e3,
      otherExpenses: 35500
    },
    liabilities: {
      homeMortgage: 32e5,
      schoolLoans: 18e4,
      carLoans: 7e5,
      creditCards: 15e4,
      retailDebt: 3e4
    }
  },
  {
    id: "engineer",
    name: "\u0418\u043D\u0436\u0435\u043D\u0435\u0440",
    salary: 14e4,
    savings: 25e3,
    perChildExpense: 1e4,
    expenses: {
      taxes: 31e3,
      homeMortgagePayment: 26e3,
      schoolLoanPayment: 2500,
      carPayment: 1e4,
      creditCardPayment: 5e3,
      retailPayment: 2e3,
      otherExpenses: 30500
    },
    liabilities: {
      homeMortgage: 28e5,
      schoolLoans: 14e4,
      carLoans: 6e5,
      creditCards: 13e4,
      retailDebt: 3e4
    }
  },
  {
    id: "sales-manager",
    name: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u043F\u043E \u043F\u0440\u043E\u0434\u0430\u0436\u0430\u043C",
    salary: 12e4,
    savings: 2e4,
    perChildExpense: 9e3,
    expenses: {
      taxes: 26e3,
      homeMortgagePayment: 23e3,
      schoolLoanPayment: 0,
      carPayment: 9e3,
      creditCardPayment: 5e3,
      retailPayment: 2e3,
      otherExpenses: 26e3
    },
    liabilities: {
      homeMortgage: 24e5,
      schoolLoans: 0,
      carLoans: 55e4,
      creditCards: 12e4,
      retailDebt: 3e4
    }
  },
  {
    id: "trucker",
    name: "\u0414\u0430\u043B\u044C\u043D\u043E\u0431\u043E\u0439\u0449\u0438\u043A",
    salary: 9e4,
    savings: 15e3,
    perChildExpense: 7e3,
    expenses: {
      taxes: 18e3,
      homeMortgagePayment: 17e3,
      schoolLoanPayment: 0,
      carPayment: 8e3,
      creditCardPayment: 4e3,
      retailPayment: 1500,
      otherExpenses: 20500
    },
    liabilities: {
      homeMortgage: 18e5,
      schoolLoans: 0,
      carLoans: 45e4,
      creditCards: 1e5,
      retailDebt: 25e3
    }
  },
  {
    id: "mechanic",
    name: "\u0410\u0432\u0442\u043E\u043C\u0435\u0445\u0430\u043D\u0438\u043A",
    salary: 85e3,
    savings: 12e3,
    perChildExpense: 7e3,
    expenses: {
      taxes: 17e3,
      homeMortgagePayment: 16e3,
      schoolLoanPayment: 0,
      carPayment: 6e3,
      creditCardPayment: 4e3,
      retailPayment: 1500,
      otherExpenses: 19500
    },
    liabilities: {
      homeMortgage: 17e5,
      schoolLoans: 0,
      carLoans: 35e4,
      creditCards: 9e4,
      retailDebt: 25e3
    }
  },
  {
    id: "policeman",
    name: "\u041F\u043E\u043B\u0438\u0446\u0435\u0439\u0441\u043A\u0438\u0439",
    salary: 75e3,
    savings: 12e3,
    perChildExpense: 6500,
    expenses: {
      taxes: 14e3,
      homeMortgagePayment: 14e3,
      schoolLoanPayment: 1500,
      carPayment: 6e3,
      creditCardPayment: 3500,
      retailPayment: 1500,
      otherExpenses: 17e3
    },
    liabilities: {
      homeMortgage: 15e5,
      schoolLoans: 9e4,
      carLoans: 32e4,
      creditCards: 8e4,
      retailDebt: 25e3
    }
  },
  {
    id: "secretary",
    name: "\u041E\u0444\u0438\u0441-\u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440",
    salary: 7e4,
    savings: 1e4,
    perChildExpense: 6e3,
    expenses: {
      taxes: 13e3,
      homeMortgagePayment: 13e3,
      schoolLoanPayment: 1500,
      carPayment: 5e3,
      creditCardPayment: 3e3,
      retailPayment: 1500,
      otherExpenses: 16e3
    },
    liabilities: {
      homeMortgage: 14e5,
      schoolLoans: 8e4,
      carLoans: 28e4,
      creditCards: 7e4,
      retailDebt: 25e3
    }
  },
  {
    id: "nurse",
    name: "\u041C\u0435\u0434\u0441\u0435\u0441\u0442\u0440\u0430",
    salary: 65e3,
    savings: 1e4,
    perChildExpense: 6e3,
    expenses: {
      taxes: 12e3,
      homeMortgagePayment: 12e3,
      schoolLoanPayment: 1500,
      carPayment: 4500,
      creditCardPayment: 3e3,
      retailPayment: 1200,
      otherExpenses: 14800
    },
    liabilities: {
      homeMortgage: 13e5,
      schoolLoans: 8e4,
      carLoans: 25e4,
      creditCards: 65e3,
      retailDebt: 2e4
    }
  },
  {
    id: "teacher",
    name: "\u0423\u0447\u0438\u0442\u0435\u043B\u044C",
    salary: 6e4,
    savings: 9e3,
    perChildExpense: 5500,
    expenses: {
      taxes: 11e3,
      homeMortgagePayment: 11e3,
      schoolLoanPayment: 1500,
      carPayment: 4e3,
      creditCardPayment: 2500,
      retailPayment: 1200,
      otherExpenses: 13800
    },
    liabilities: {
      homeMortgage: 12e5,
      schoolLoans: 8e4,
      carLoans: 22e4,
      creditCards: 55e3,
      retailDebt: 2e4
    }
  },
  {
    id: "janitor",
    name: "\u0423\u0431\u043E\u0440\u0449\u0438\u043A",
    salary: 45e3,
    savings: 8e3,
    perChildExpense: 4500,
    expenses: {
      taxes: 7500,
      homeMortgagePayment: 8e3,
      schoolLoanPayment: 0,
      carPayment: 2500,
      creditCardPayment: 2e3,
      retailPayment: 1e3,
      otherExpenses: 11e3
    },
    liabilities: {
      homeMortgage: 85e4,
      schoolLoans: 0,
      carLoans: 13e4,
      creditCards: 45e3,
      retailDebt: 15e3
    }
  }
];

// src/data/boards.json
var boards_default = {
  RAT_BOARD: [
    "opportunity",
    "market",
    "opportunity",
    "doodad",
    "opportunity",
    "charity",
    "opportunity",
    "paycheck",
    "opportunity",
    "market",
    "opportunity",
    "doodad",
    "opportunity",
    "baby",
    "opportunity",
    "paycheck",
    "opportunity",
    "market",
    "opportunity",
    "doodad",
    "opportunity",
    "downsized",
    "opportunity",
    "paycheck"
  ],
  RAT_BOARD_SIZE: 24,
  FAST_BOARD: [
    {
      type: "cashflowDay"
    },
    {
      type: "business",
      name: "Regional pizza chain",
      flavor: "Twelve ovens, one beloved recipe.",
      downPayment: 1e5,
      cashFlow: 5e3
    },
    {
      type: "dream",
      name: "Round-the-world sailing year",
      flavor: "Twelve months, twenty ports, zero meetings.",
      price: 15e4
    },
    {
      type: "taxAudit"
    },
    {
      type: "business",
      name: "Craft-brewery stake",
      flavor: "The taproom line goes around the block.",
      downPayment: 12e4,
      cashFlow: 6e3
    },
    {
      type: "venture",
      name: "Miri wildcat well, Sarawak",
      flavor: "The field that started Malaysian oil in 1910 still hides pockets \u2014 for whoever dares to drill.",
      downPayment: 4e5,
      cashFlow: 45e3,
      threshold: 5
    },
    {
      type: "taxAudit"
    },
    {
      type: "dream",
      name: "Private mountain cabin",
      flavor: "Snow on the roof, nobody on the trail.",
      price: 12e4
    },
    {
      type: "business",
      name: "Urgent-care clinic",
      flavor: "Open when everyone else is closed.",
      downPayment: 25e4,
      cashFlow: 12500
    },
    {
      type: "venture",
      name: "Siberian oil wildcat",
      flavor: "One rig in the frozen taiga: a gusher \u2014 or a very expensive hole.",
      downPayment: 5e5,
      cashFlow: 6e4,
      threshold: 5
    },
    {
      type: "dream",
      name: "Found a wildlife sanctuary",
      flavor: "Rescued animals, rolling hills, your name on the gate.",
      price: 25e4
    },
    {
      type: "cashflowDay"
    },
    {
      type: "business",
      name: "Marina & boatyard",
      flavor: "Slips rented out three seasons ahead.",
      downPayment: 35e4,
      cashFlow: 17500
    },
    {
      type: "dream",
      name: "Vintage supercar garage",
      flavor: "Five cars, one lift, endless Saturdays.",
      price: 3e5
    },
    {
      type: "business",
      name: "Offshore supply base, Labuan",
      flavor: "Every rig in the South China Sea restocks at your quay.",
      downPayment: 3e5,
      cashFlow: 15e3
    },
    {
      type: "downsized"
    },
    {
      type: "charity"
    },
    {
      type: "business",
      name: "Private parking towers",
      flavor: "Concrete that prints money downtown.",
      downPayment: 4e5,
      cashFlow: 2e4
    },
    {
      type: "dream",
      name: "Box seats for life",
      flavor: "Your team, your seats, every season.",
      price: 1e5
    },
    {
      type: "business",
      name: "Assisted-living residence",
      flavor: "Full occupancy and a caring staff.",
      downPayment: 5e5,
      cashFlow: 25e3
    },
    {
      type: "lawsuit"
    },
    {
      type: "dream",
      name: "Learn to fly \u2014 and buy the plane",
      flavor: "License, hangar, and a four-seater with your initials.",
      price: 2e5
    },
    {
      type: "cashflowDay"
    },
    {
      type: "business",
      name: "Film-studio backlot",
      flavor: "Sound stages booked out two years.",
      downPayment: 6e5,
      cashFlow: 3e4
    },
    {
      type: "dream",
      name: "Restore a castle ruin",
      flavor: "Turrets, tapestries, and a moat that finally holds water.",
      price: 4e5
    },
    {
      type: "business",
      name: "Cold-chain logistics hub",
      flavor: "Every grocer in the region depends on your freezers.",
      downPayment: 45e4,
      cashFlow: 22e3
    },
    {
      type: "business",
      name: "Bintulu LNG train stake, Sarawak",
      flavor: "A slice of one of the world\u2019s largest gas plants; tankers queue offshore.",
      downPayment: 8e5,
      cashFlow: 4e4
    },
    {
      type: "divorce"
    },
    {
      type: "business",
      name: "Regional airline feeder",
      flavor: "Two turboprops linking mountain towns.",
      downPayment: 7e5,
      cashFlow: 32e3
    },
    {
      type: "dream",
      name: "Open a culinary school",
      flavor: "Teach a thousand cooks; eat very, very well.",
      price: 35e4
    },
    {
      type: "business",
      name: "Data-center wing",
      flavor: "Racks humming behind biometric doors.",
      downPayment: 9e5,
      cashFlow: 45e3
    },
    {
      type: "lawsuit"
    },
    {
      type: "dream",
      name: "Endow a scholarship fund",
      flavor: "A hundred students a year, forever.",
      price: 5e5
    },
    {
      type: "cashflowDay"
    },
    {
      type: "divorce"
    },
    {
      type: "dream",
      name: "Private island retreat",
      flavor: "Your own dot on the map.",
      price: 6e5
    },
    {
      type: "business",
      name: "Concert amphitheater",
      flavor: "Summer nights, sold-out lawns.",
      downPayment: 75e4,
      cashFlow: 35e3
    },
    {
      type: "venture",
      name: "Deep-water platform stake, Sabah",
      flavor: "A Kikeh-class prospect off Kota Kinabalu: vast if the reservoir holds, dry if it doesn\u2019t.",
      downPayment: 7e5,
      cashFlow: 8e4,
      threshold: 5
    },
    {
      type: "taxAudit"
    },
    {
      type: "venture",
      name: "Deep-sea salvage claim",
      flavor: "A mapped wreck, a crane barge, and no guarantees.",
      downPayment: 8e5,
      cashFlow: 9e4,
      threshold: 5
    },
    {
      type: "dream",
      name: "Sail the world solo",
      flavor: "One boat, one horizon, one logbook.",
      price: 18e4
    },
    {
      type: "business",
      name: "Fiber-to-home network",
      flavor: "The whole valley streams through your cables.",
      downPayment: 85e4,
      cashFlow: 42e3
    },
    {
      type: "lawsuit"
    },
    {
      type: "dream",
      name: "World-tour photo expedition",
      flavor: "A year of golden hours on seven continents.",
      price: 75e3
    }
  ],
  FAST_BOARD_SIZE: 44
};

// src/data/misc.json
var misc_default = {
  DOGS: [
    {
      id: "dog-corgi",
      name: "A corgi"
    },
    {
      id: "dog-husky",
      name: "A husky"
    },
    {
      id: "dog-dachshund",
      name: "A dachshund"
    },
    {
      id: "dog-golden",
      name: "A golden retriever"
    },
    {
      id: "dog-pug",
      name: "A pug"
    },
    {
      id: "dog-shiba",
      name: "A shiba inu"
    }
  ],
  THEME_IDS: [
    "system",
    "light",
    "dark",
    "ocean",
    "felt",
    "sunrise"
  ],
  BOT_DIFFICULTIES: [
    "easy",
    "medium",
    "high",
    "unreal"
  ],
  TOKEN_ART: {
    "airline-pilot": "/tokens/airline-pilot.webp",
    "business-manager": "/tokens/business-manager.webp",
    custom: "/tokens/custom.webp",
    doctor: "/tokens/doctor.webp",
    engineer: "/tokens/engineer.webp",
    janitor: "/tokens/janitor.webp",
    lawyer: "/tokens/lawyer.webp",
    mechanic: "/tokens/mechanic.webp",
    nurse: "/tokens/nurse.webp",
    "police-officer": "/tokens/police-officer.webp",
    secretary: "/tokens/secretary.webp",
    teacher: "/tokens/teacher.webp",
    "truck-driver": "/tokens/truck-driver.webp"
  },
  SPACE_ART: {
    baby: "/spaces/baby.webp",
    business: "/spaces/business.webp",
    cashflowDay: "/spaces/cashflowDay.webp",
    charity: "/spaces/charity.webp",
    divorce: "/spaces/divorce.webp",
    dog: "/spaces/dog.webp",
    doodad: "/spaces/doodad.webp",
    downsized: "/spaces/downsized.webp",
    dream: "/spaces/dream.webp",
    lawsuit: "/spaces/lawsuit.webp",
    market: "/spaces/market.webp",
    opportunity: "/spaces/opportunity.webp",
    paycheck: "/spaces/paycheck.webp",
    taxAudit: "/spaces/taxAudit.webp"
  }
};

// src/data/ru.cards.json
var ru_cards_default = {
  "sd-grit-1": {
    title: "GRIT \u043D\u0430 \u0441\u0430\u043C\u043E\u043C \u0434\u043D\u0435",
    flavor: "\u041F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C \u0441\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0445 \u0440\u043E\u0431\u043E\u0442\u043E\u0432 \u043F\u0440\u043E\u0432\u0430\u043B\u0438\u043B \u043A\u0432\u0430\u0440\u0442\u0430\u043B, \u0438 \u0440\u044B\u043D\u043E\u043A \u0432 \u043F\u0430\u043D\u0438\u043A\u0435. \u041A\u0443\u043F\u0438\u0442\u044C \u043C\u043E\u0436\u0435\u0442\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u044B; \u043F\u0440\u043E\u0434\u0430\u0442\u044C \u2014 \u0432\u0441\u0435."
  },
  "sd-grit-10": {
    title: "GRIT \u0432 \u0437\u0430\u0442\u0438\u0448\u044C\u0435",
    flavor: "\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u044B\u0439 \u043A\u0432\u0430\u0440\u0442\u0430\u043B \u0443 \u0440\u043E\u0431\u043E\u0442\u043E\u0442\u0435\u0445\u043D\u0438\u043A\u043E\u0432. \u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438 \u043F\u043E\u0436\u0438\u043C\u0430\u044E\u0442 \u043F\u043B\u0435\u0447\u0430\u043C\u0438."
  },
  "sd-grit-25": {
    title: "GRIT \u0432 \u0440\u0430\u0437\u0433\u043E\u043D\u0435",
    flavor: "\u041A\u0440\u0443\u043F\u043D\u0430\u044F \u0441\u0435\u0442\u044C \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u043F\u0438\u043B\u043E\u0442\u043D\u044B\u0439 \u043F\u0440\u043E\u0435\u043A\u0442. \u0422\u043E\u043B\u043F\u0430 \u0441\u043F\u0435\u043A\u0443\u043B\u044F\u043D\u0442\u043E\u0432 \u043D\u0430\u0431\u0435\u0433\u0430\u0435\u0442."
  },
  "sd-grit-40": {
    title: "\u042D\u0439\u0444\u043E\u0440\u0438\u044F \u0432\u043E\u043A\u0440\u0443\u0433 GRIT",
    flavor: "\u041E\u0431\u043B\u043E\u0436\u043A\u0430 \u0436\u0443\u0440\u043D\u0430\u043B\u0430: \xAB\u0414\u0435\u0441\u044F\u0442\u0438\u043B\u0435\u0442\u0438\u0435 \u0440\u043E\u0431\u043E\u0442\u043E\u0432\xBB. \u0426\u0435\u043D\u0430 \u2014 \u043D\u0430 \u043F\u0438\u043A\u0435 \u043C\u0435\u0447\u0442\u0430\u043D\u0438\u0439."
  },
  "sd-snail-5": {
    title: "SNAIL \u0441\u043F\u043E\u043B\u0437\u0430\u0435\u0442",
    flavor: "\u041A\u0443\u0440\u044C\u0435\u0440\u0441\u043A\u0430\u044F \u0441\u043B\u0443\u0436\u0431\u0430 \u0442\u0435\u0440\u044F\u0435\u0442 \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442, \u0438 \u0446\u0435\u043D\u0430 \u0435\u043B\u0435 \u043F\u043E\u043B\u0437\u0451\u0442 \u043A \u043C\u0438\u043D\u0438\u043C\u0443\u043C\u0443."
  },
  "sd-snail-10": {
    title: "SNAIL \u0434\u0435\u0440\u0436\u0438\u0442\u0441\u044F",
    flavor: "\u0421\u043A\u0443\u0447\u043D\u044B\u0439, \u043D\u0430\u0434\u0451\u0436\u043D\u044B\u0439 \u043E\u0431\u044A\u0451\u043C \u0434\u043E\u0441\u0442\u0430\u0432\u043E\u043A. \u0421\u043A\u0443\u0447\u043D\u0430\u044F, \u043D\u0430\u0434\u0451\u0436\u043D\u0430\u044F \u0446\u0435\u043D\u0430."
  },
  "sd-snail-20": {
    title: "SNAIL \u043D\u0430\u0431\u0438\u0440\u0430\u0435\u0442 \u0445\u043E\u0434",
    flavor: "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u0432 \u0442\u043E\u0442 \u0436\u0435 \u0434\u0435\u043D\u044C \u0432 \u0433\u043B\u0443\u0431\u0438\u043D\u043A\u0435 \u0445\u043E\u0440\u043E\u0448\u043E \u0441\u0435\u0431\u044F \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0432 \u0442\u0440\u0451\u0445 \u0448\u0442\u0430\u0442\u0430\u0445."
  },
  "sd-snail-30": {
    title: "SNAIL \u043D\u0430 \u043F\u0440\u0435\u0434\u0435\u043B\u0435",
    flavor: "\u0420\u0435\u043A\u043E\u0440\u0434\u043D\u044B\u0435 \u043E\u0431\u044A\u0451\u043C\u044B \u2014 \u0438 \u0446\u0435\u043D\u0430 \u0443 \u0432\u0435\u0440\u0445\u043D\u0435\u0439 \u0433\u0440\u0430\u043D\u0438\u0446\u044B \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u0430."
  },
  "sd-myco-5": {
    title: "MYCO: \u0441\u0440\u044B\u0432 \u0438\u0441\u043F\u044B\u0442\u0430\u043D\u0438\u0439",
    flavor: "\u041B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u043E\u0442\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u0435\u0442 \u043A\u043B\u044E\u0447\u0435\u0432\u043E\u0435 \u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u0435. \u041E\u0445\u043E\u0442\u043D\u0438\u043A\u0438 \u0437\u0430 \u0441\u043A\u0438\u0434\u043A\u0430\u043C\u0438 \u043A\u0440\u0443\u0436\u0430\u0442 \u0440\u044F\u0434\u043E\u043C."
  },
  "sd-myco-15": {
    title: "MYCO \u043F\u043E\u0441\u0435\u0440\u0435\u0434\u0438\u043D\u0435",
    flavor: "\u0421\u043C\u0435\u0448\u0430\u043D\u043D\u044B\u0435 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B, \u0441\u043C\u0435\u0448\u0430\u043D\u043D\u044B\u0435 \u0447\u0443\u0432\u0441\u0442\u0432\u0430, \u0441\u0440\u0435\u0434\u043D\u044F\u044F \u0446\u0435\u043D\u0430."
  },
  "sd-myco-30": {
    title: "MYCO \u043F\u0440\u043E\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F",
    flavor: "\u0420\u0430\u043D\u043D\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0443\u0442\u0435\u043A\u0430\u044E\u0442 \u0432 \u043F\u0440\u0435\u0441\u0441\u0443, \u0438 \u0431\u0438\u0440\u0436\u0430 \u0432 \u0432\u043E\u0441\u0442\u043E\u0440\u0433\u0435."
  },
  "sd-zap-1": {
    title: "ZAP \u0442\u0435\u0440\u043F\u0438\u0442 \u043A\u0440\u0430\u0445",
    flavor: "\u041E\u043F\u0435\u0440\u0430\u0442\u043E\u0440 \u043F\u0440\u043E\u043A\u0430\u0442\u0430 \u0441\u0430\u043C\u043E\u043A\u0430\u0442\u043E\u0432 \u043E\u0442\u0437\u044B\u0432\u0430\u0435\u0442 \u043F\u0430\u0440\u0442\u0438\u044E \u0431\u0430\u0442\u0430\u0440\u0435\u0439. \u0426\u0435\u043D\u0430 \u2014 \u043F\u043E\u0447\u0442\u0438 \u0431\u0430\u043D\u043A\u0440\u043E\u0442\u043D\u0430\u044F."
  },
  "sd-zap-10": {
    title: "ZAP \u0437\u0430\u0440\u044F\u0436\u0430\u0435\u0442\u0441\u044F",
    flavor: "\u041F\u0440\u0438\u0445\u043E\u0434\u044F\u0442 \u043D\u043E\u0432\u044B\u0435 \u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0438\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u044F. \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u043F\u0438\u0448\u0435\u0442\u0441\u044F \u0441\u0430\u043C\u0430."
  },
  "sd-zap-25": {
    title: "\u041C\u0430\u043D\u0438\u044F \u0432\u043E\u043A\u0440\u0443\u0433 ZAP",
    flavor: "\u0421\u0430\u043C\u043E\u043A\u0430\u0442 \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u0443\u0433\u043B\u0443, \u0430 \u0430\u043A\u0446\u0438\u044F \u2014 \u0432 \u043A\u0430\u0436\u0434\u043E\u043C \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u0435."
  },
  "sd-nest-10": {
    title: "\u0424\u043E\u043D\u0434 NEST \u0441\u043E \u0441\u043A\u0438\u0434\u043A\u043E\u0439",
    flavor: "\u0428\u0438\u0440\u043E\u043A\u0438\u0439 \u0438\u043D\u0434\u0435\u043A\u0441\u043D\u044B\u0439 \u0444\u043E\u043D\u0434 \u043F\u0440\u043E\u0441\u0435\u043B \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u043E\u0439. \u0414\u043E\u043B\u0433\u043E\u0441\u0440\u043E\u0447\u043D\u044B\u0435 \u0434\u0435\u043D\u044C\u0433\u0438 \u0443\u043B\u044B\u0431\u0430\u044E\u0442\u0441\u044F."
  },
  "sd-nest-25": {
    title: "NEST \u0438\u0434\u0451\u0442 \u0440\u043E\u0432\u043D\u043E",
    flavor: "\u0418\u043D\u0434\u0435\u043A\u0441 \u043F\u043E\u0442\u0438\u0445\u043E\u043D\u044C\u043A\u0443 \u0440\u0430\u0441\u0442\u0451\u0442. \u041D\u0438\u0447\u0435\u0433\u043E \u0437\u0430\u0445\u0432\u0430\u0442\u044B\u0432\u0430\u044E\u0449\u0435\u0433\u043E \u2014 \u0432 \u044D\u0442\u043E\u043C \u0432\u0435\u0441\u044C \u0441\u043C\u044B\u0441\u043B."
  },
  "sd-vlt4-a": {
    title: "\u0421\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442 Vault, \u043E\u0431\u044B\u0447\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430",
    flavor: "\u0421\u0431\u0435\u0440\u0435\u0433\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442 \u043D\u0430 $1000, \u043F\u0440\u0438\u043D\u043E\u0441\u0438\u0442 $30 \u0432 \u043C\u0435\u0441\u044F\u0446. \u0421\u043E\u043D\u043D\u043E \u0438 \u043D\u0430\u0434\u0451\u0436\u043D\u043E."
  },
  "sd-vlt4-b": {
    title: "\u0421\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442 Vault, \u0430\u043A\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430",
    flavor: "\u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u043D\u044B\u0439 \u0441\u0435\u0440\u0442\u0438\u0444\u0438\u043A\u0430\u0442 \u043D\u0430 $1000 \u2014 $50 \u0432 \u043C\u0435\u0441\u044F\u0446 \u0434\u043B\u044F \u0440\u0430\u043D\u043D\u0438\u0445 \u0432\u043A\u043B\u0430\u0434\u0447\u0438\u043A\u043E\u0432."
  },
  "sd-condo-1": {
    title: "\u0418\u0437\u044A\u044F\u0442\u0430\u044F \u0431\u0430\u043D\u043A\u043E\u043C \u0434\u0432\u0443\u0448\u043A\u0430",
    flavor: "\u0411\u0430\u043D\u043A \u0445\u043E\u0447\u0435\u0442 \u043F\u0440\u043E\u0434\u0430\u0442\u044C \u0435\u0451 \u043D\u0430 \u044D\u0442\u043E\u0439 \u043D\u0435\u0434\u0435\u043B\u0435. \u0416\u0438\u043B\u0435\u0446 \u0443\u0436\u0435 \u043D\u0430\u0439\u0434\u0435\u043D."
  },
  "sd-condo-2": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u044D\u043B\u0435\u043A\u0442\u0440\u0438\u0447\u043A\u0438",
    flavor: "\u0414\u0432\u0435 \u043A\u043E\u043C\u043D\u0430\u0442\u044B \u0432 \u043A\u0432\u0430\u0440\u0442\u0430\u043B\u0435 \u043E\u0442 \u0441\u0442\u0430\u043D\u0446\u0438\u0438. \u0421\u0434\u0430\u0451\u0442\u0441\u044F \u0441\u0430\u043C\u0430 \u0441\u043E\u0431\u043E\u0439."
  },
  "sd-condo-3": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u0431\u0430\u0441\u0441\u0435\u0439\u043D\u0430",
    flavor: "\u0412\u0437\u043D\u043E\u0441\u044B \u0422\u0421\u0416 \u043A\u0443\u0441\u0430\u044E\u0442\u0441\u044F \u2014 \u0434\u0435\u043D\u0435\u0436\u043D\u044B\u0439 \u043F\u043E\u0442\u043E\u043A \u0442\u043E\u043D\u043A\u0438\u0439, \u0437\u0430\u0442\u043E \u0446\u0435\u043D\u0430 \u0445\u043E\u0440\u043E\u0448\u0430\u044F."
  },
  "sd-condo-4": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0438\u0437 \u043D\u0430\u0441\u043B\u0435\u0434\u0441\u0442\u0432\u0430",
    flavor: "\u041D\u0430\u0441\u043B\u0435\u0434\u043D\u0438\u043A\u0438 \u0436\u0438\u0432\u0443\u0442 \u0432 \u0434\u0440\u0443\u0433\u043E\u043C \u0448\u0442\u0430\u0442\u0435 \u0438 \u0445\u043E\u0442\u044F\u0442 \u0431\u044B\u0441\u0442\u0440\u043E \u0438 \u0447\u0438\u0441\u0442\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u0441\u0434\u0435\u043B\u043A\u0443."
  },
  "sd-condo-5": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u043A\u0430\u043C\u043F\u0443\u0441\u0430",
    flavor: "\u0421\u0442\u0443\u0434\u0435\u043D\u0442\u044B \u043A\u0430\u0436\u0434\u0443\u044E \u043E\u0441\u0435\u043D\u044C, \u043A\u0430\u043A \u043F\u043E \u0447\u0430\u0441\u0430\u043C."
  },
  "sd-condo-6": {
    title: "\u041C\u0438\u043A\u0440\u043E\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0432 \u0446\u0435\u043D\u0442\u0440\u0435",
    flavor: "\u041C\u0430\u043B\u0435\u043D\u044C\u043A\u0430\u044F \u043F\u043B\u043E\u0449\u0430\u0434\u044C, \u0431\u043E\u043B\u044C\u0448\u043E\u0439 \u0441\u043F\u0440\u043E\u0441 \u043D\u0430 \u0430\u0440\u0435\u043D\u0434\u0443."
  },
  "sd-house-1": {
    title: "\u0414\u043E\u043C 3/2 \u043A \u043F\u0435\u0440\u0435\u0435\u0437\u0434\u0443",
    flavor: "\u0412\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u0432 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A \u0432\u044B\u0445\u043E\u0434\u0438\u0442 \u043D\u0430 \u043D\u043E\u0432\u0443\u044E \u0440\u0430\u0431\u043E\u0442\u0443 \u0447\u0435\u0440\u0435\u0437 \u0432\u0441\u044E \u0441\u0442\u0440\u0430\u043D\u0443."
  },
  "sd-house-2": {
    title: "\u0414\u043E\u043C 3/1 \u043F\u043E\u0434 \u0440\u0435\u043C\u043E\u043D\u0442 \u0443 \u0448\u043A\u043E\u043B\u044B",
    flavor: "\u0422\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0441\u043C\u0435\u0442\u0438\u043A\u0430; \u0441\u0435\u043C\u044C\u0438 \u0432\u044B\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0440\u0430\u0434\u0438 \u0440\u0430\u0439\u043E\u043D\u0430."
  },
  "sd-house-3": {
    title: "\u0414\u043E\u043C 3/2 \u0432 \u0442\u0443\u043F\u0438\u043A\u0435",
    flavor: "\u0422\u0438\u0445\u0430\u044F \u0443\u043B\u0438\u0446\u0430, \u0436\u0438\u043B\u0435\u0446 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D \u0435\u0449\u0451 \u043D\u0430 \u0434\u0432\u0430 \u0433\u043E\u0434\u0430."
  },
  "sd-house-4": {
    title: "\u0414\u043E\u043C \u043F\u0440\u0438 \u0440\u0430\u0437\u0432\u043E\u0434\u0435",
    flavor: "\u041E\u0431\u0435 \u0441\u0442\u043E\u0440\u043E\u043D\u044B \u0445\u043E\u0442\u044F\u0442 \u043E\u0434\u043D\u043E\u0433\u043E \u2014 \u043F\u043E\u043A\u043E\u043D\u0447\u0438\u0442\u044C \u0441 \u044D\u0442\u0438\u043C. \u0426\u0435\u043D\u0430 \u043D\u0438\u0436\u0435 \u0440\u044B\u043D\u043A\u0430."
  },
  "sd-house-5": {
    title: "\u0414\u043E\u043C \u0443 \u0440\u0435\u043A\u0438",
    flavor: "\u0421\u0442\u0440\u0430\u0445\u043E\u0432\u043A\u0430 \u043E\u0442 \u043F\u0430\u0432\u043E\u0434\u043A\u043E\u0432 \u0441\u044A\u0435\u0434\u0430\u0435\u0442 \u0430\u0440\u0435\u043D\u0434\u0443 \u2014 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u0440\u043E\u0434\u0430\u0448\u044C \u0435\u0433\u043E \u043C\u0435\u0447\u0442\u0430\u0442\u0435\u043B\u044E."
  },
  "sd-house-6": {
    title: "\u0414\u043E\u043C 3/2 \u0432 \u0437\u0435\u043B\u0451\u043D\u043E\u043C \u043F\u0440\u0438\u0433\u043E\u0440\u043E\u0434\u0435",
    flavor: "\u0421\u0432\u0435\u0436\u0430\u044F \u043A\u0440\u0430\u0441\u043A\u0430, \u043D\u043E\u0432\u0430\u044F \u043A\u0440\u044B\u0448\u0430, \u0436\u0438\u043B\u0435\u0446 \u043F\u043B\u0430\u0442\u0438\u0442 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0447\u0438\u0441\u043B\u0430."
  },
  "sd-duplex-1": {
    title: "\u0414\u0443\u043F\u043B\u0435\u043A\u0441 \u0431\u043E\u043A \u043E \u0431\u043E\u043A",
    flavor: "\u0414\u0432\u0435 \u0434\u0432\u0435\u0440\u0438, \u0434\u0432\u0435 \u0430\u0440\u0435\u043D\u0434\u044B, \u043E\u0434\u043D\u0430 \u0438\u043F\u043E\u0442\u0435\u043A\u0430."
  },
  "sd-duplex-2": {
    title: "\u0414\u0443\u043F\u043B\u0435\u043A\u0441 \xAB\u0432\u0435\u0440\u0445-\u043D\u0438\u0437\xBB",
    flavor: "\u0423\u0445\u043E\u0434\u044F\u0449\u0438\u0439 \u043D\u0430 \u043F\u043E\u043A\u043E\u0439 \u0430\u0440\u0435\u043D\u0434\u043E\u0434\u0430\u0442\u0435\u043B\u044C \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0441\u0432\u043E\u0439 \u043F\u0435\u0440\u0432\u044B\u0439 \u0434\u043E\u043C."
  },
  "sd-duplex-3": {
    title: "\u0414\u0443\u043F\u043B\u0435\u043A\u0441 \u043D\u0430 \u0443\u0433\u043B\u0443",
    flavor: "\u041F\u0435\u0448\u043A\u043E\u043C \u0434\u043E \u0442\u0440\u0430\u043C\u0432\u0430\u044F; \u043F\u0443\u0441\u0442\u0443\u0435\u0442 \u043D\u0435 \u0434\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0434\u0435\u043B\u0438."
  },
  "sd-duplex-4": {
    title: "\u0414\u0443\u043F\u043B\u0435\u043A\u0441 \u0441 \u0430\u0443\u043A\u0446\u0438\u043E\u043D\u0430",
    flavor: "\u0421\u043F\u0435\u0446\u043B\u043E\u0442 \u0441 \u043E\u043A\u0440\u0443\u0436\u043D\u043E\u0433\u043E \u0430\u0443\u043A\u0446\u0438\u043E\u043D\u0430 \u2014 \u043B\u0451\u0433\u043A\u0438\u0439 \u0440\u0435\u043C\u043E\u043D\u0442, \u0432\u0435\u0441\u043E\u043C\u044B\u0439 \u043F\u043E\u0442\u0435\u043D\u0446\u0438\u0430\u043B."
  },
  "sd-land-1": {
    title: "10 \u0430\u043A\u0440\u043E\u0432 \u043F\u0443\u0441\u0442\u043E\u0448\u0438",
    flavor: "\u0422\u0430\u043C \u043D\u0438\u0447\u0435\u0433\u043E, \u043A\u0440\u043E\u043C\u0435 \u0432\u0435\u0442\u0440\u0430. \u041F\u043E\u043A\u0430 \u0447\u0442\u043E."
  },
  "sd-land-2": {
    title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u043F\u043E\u043B\u0430\u043A\u0440\u0430",
    flavor: "\u041F\u0440\u043E\u0441\u0432\u0435\u0442 \u0432 \u0440\u0430\u0441\u0442\u0443\u0449\u0435\u0439 \u0441\u0435\u0442\u043A\u0435 \u0443\u043B\u0438\u0446."
  },
  "sd-land-3": {
    title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u0443 \u043E\u0437\u0435\u0440\u0430",
    flavor: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u0430\u043B \u0434\u043B\u044F \u0444\u0435\u0440\u043C\u044B, \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u043A\u0440\u0430\u0441\u0438\u0432, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0439\u0442\u0438 \u043C\u0438\u043C\u043E."
  },
  "sd-land-4": {
    title: "\u0423\u0433\u043E\u043B \u0443 \u0441\u044A\u0435\u0437\u0434\u0430 \u0441 \u0442\u0440\u0430\u0441\u0441\u044B",
    flavor: "\u0425\u043E\u0434\u044F\u0442 \u0441\u043B\u0443\u0445\u0438, \u0447\u0442\u043E \u0437\u0434\u0435\u0441\u044C \u043F\u043E\u0441\u0442\u0440\u043E\u044F\u0442 \u0441\u0442\u043E\u044F\u043D\u043A\u0443 \u0434\u043B\u044F \u0444\u0443\u0440."
  },
  "sd-biz-1": {
    title: "\u0421\u0435\u0442\u044C \u0442\u043E\u0440\u0433\u043E\u0432\u044B\u0445 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u043E\u0432",
    flavor: "\u0414\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u043E\u0432 \u0432 \u043E\u0444\u0438\u0441\u043D\u044B\u0445 \u043B\u043E\u0431\u0431\u0438. \u041C\u043E\u043D\u0435\u0442\u043A\u0438 \u0441\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u0432 \u0441\u0443\u043C\u043C\u044B."
  },
  "sd-biz-2": {
    title: "\u041B\u043E\u0442\u043E\u043A \u043D\u0430 \u0432\u044B\u0445\u043E\u0434\u043D\u044B\u0445",
    flavor: "\u0414\u0440\u0443\u0433 \u0438\u043C \u0437\u0430\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442; \u0432\u044B \u0444\u0438\u043D\u0430\u043D\u0441\u0438\u0440\u0443\u0435\u0442\u0435 \u0438 \u0434\u0435\u043B\u0438\u0442\u0435 \u0432\u044B\u0440\u0443\u0447\u043A\u0443."
  },
  "sd-part-1": {
    title: "\u0414\u043E\u043B\u044F \u0432 \u0444\u0443\u0434\u0442\u0440\u0430\u043A\u0435",
    flavor: "\u0412\u0430\u0448 \u0441\u043E\u0441\u0435\u0434 \u043F\u043E \u043E\u0431\u0449\u0430\u0433\u0435 \u0443\u043C\u0435\u0435\u0442 \u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C. \u041A\u0443\u043F\u0438\u0442\u0435 \u0447\u0435\u0442\u0432\u0435\u0440\u0442\u044C \u0444\u0443\u0440\u0433\u043E\u043D\u0430."
  },
  "sd-part-2": {
    title: "\u0414\u043E\u043B\u044F \u0432 app-\u0441\u0442\u0443\u0434\u0438\u0438",
    flavor: "\u0414\u0432\u0430 \u043A\u043E\u0434\u0435\u0440\u0430, \u043E\u0434\u0438\u043D \u0433\u0430\u0440\u0430\u0436, \u043D\u043E\u043B\u044C \u0432\u044B\u0440\u0443\u0447\u043A\u0438 \u2014 \u043F\u043E\u043A\u0430."
  },
  "bd-4plex-1": {
    title: "\u041A\u0438\u0440\u043F\u0438\u0447\u043D\u044B\u0439 \u0447\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A",
    flavor: "\u041A\u0440\u0435\u043F\u043A\u0438\u0439 \u043A\u0438\u0440\u043F\u0438\u0447, \u0441\u043A\u0443\u0447\u043D\u044B\u0435 \u0436\u0438\u043B\u044C\u0446\u044B, \u043F\u0440\u0435\u043A\u0440\u0430\u0441\u043D\u0430\u044F \u0431\u0443\u0445\u0433\u0430\u043B\u0442\u0435\u0440\u0438\u044F."
  },
  "bd-4plex-2": {
    title: "\u0427\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0443 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438",
    flavor: "\u0410\u0432\u0442\u043E\u0431\u0443\u0441 \u0443 \u043F\u043E\u0440\u043E\u0433\u0430, \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043D\u0430 \u0437\u0430\u0435\u0437\u0434 \u0437\u0430 \u0441\u043F\u0438\u043D\u043E\u0439."
  },
  "bd-4plex-3": {
    title: "\u0427\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u043E\u0442 \u043F\u0435\u043D\u0441\u0438\u043E\u043D\u0435\u0440\u0430",
    flavor: "30 \u043B\u0435\u0442 \u0432 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0445\u043E\u0437\u044F\u0438\u043D\u0430; \u0430\u0440\u0435\u043D\u0434\u0430 \u0441\u0438\u043B\u044C\u043D\u043E \u043D\u0438\u0436\u0435 \u0440\u044B\u043D\u043A\u0430."
  },
  "bd-4plex-4": {
    title: "\u0427\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u043F\u043E\u0441\u043B\u0435 \u0431\u0443\u0440\u0438",
    flavor: "\u0421\u0442\u0440\u0430\u0445\u043E\u0432\u043A\u0430 \u043F\u043E\u0447\u0438\u043D\u0438\u043B\u0430 \u043A\u0440\u044B\u0448\u0443, \u0430 \u0441\u043A\u0438\u0434\u043A\u0430 \u043E\u0441\u0442\u0430\u043B\u0430\u0441\u044C."
  },
  "bd-4plex-5": {
    title: "\u0427\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0432 \u0441\u0442\u0430\u0440\u043E\u043C \u0444\u0430\u0431\u0440\u0438\u0447\u043D\u043E\u043C \u0440\u0430\u0439\u043E\u043D\u0435",
    flavor: "\u0420\u0430\u0439\u043E\u043D \u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u043D\u0430 \u0433\u043B\u0430\u0437\u0430\u0445; \u0432\u0445\u043E\u0434\u0438, \u043F\u043E\u043A\u0430 \u044D\u0442\u043E \u043D\u0435 \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E."
  },
  "bd-4plex-6": {
    title: "\u0427\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u043D\u0430 \u0434\u0432\u043E\u0439\u043D\u043E\u043C \u0443\u0447\u0430\u0441\u0442\u043A\u0435",
    flavor: "\u0412 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0435 \u0441\u043E\u0441\u0435\u0434\u043D\u0438\u0439 \u0443\u0447\u0430\u0441\u0442\u043E\u043A \u043F\u043E\u0434 \u0437\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0443, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043F\u0440\u043E\u0434\u0430\u0432\u0435\u0446 \u0437\u0430\u0431\u044B\u043B \u043E\u0446\u0435\u043D\u0438\u0442\u044C."
  },
  "bd-8plex-1": {
    title: "\u0412\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0432\u043E\u043A\u0440\u0443\u0433 \u0434\u0432\u043E\u0440\u0430",
    flavor: "\u0412\u043E\u0441\u0435\u043C\u044C \u0434\u0432\u0435\u0440\u0435\u0439 \u0432\u043E\u043A\u0440\u0443\u0433 \u043E\u0431\u0449\u0435\u0433\u043E \u0441\u0430\u0434\u0430. \u0416\u0438\u043B\u044C\u0446\u044B \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u043D\u0430 \u0433\u043E\u0434\u044B."
  },
  "bd-8plex-2": {
    title: "\u0412\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0438\u0437 \u043D\u0430\u0441\u043B\u0435\u0434\u0441\u0442\u0432\u0430",
    flavor: "\u0421\u0435\u043C\u044C\u044F \u0445\u043E\u0447\u0435\u0442 \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043D\u0430\u0441\u043B\u0435\u0434\u0441\u0442\u0432\u043E \u043A \u0432\u0435\u0441\u043D\u0435."
  },
  "bd-8plex-3": {
    title: "\u0412\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0434\u043B\u044F \u043C\u0435\u0434\u0438\u043A\u043E\u0432",
    flavor: "\u041D\u0430\u043F\u0440\u043E\u0442\u0438\u0432 \u0431\u043E\u043B\u044C\u043D\u0438\u0446\u044B. \u0421\u043C\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u043D\u0438\u043A\u0438, \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u0430\u044F \u0430\u0440\u0435\u043D\u0434\u0430."
  },
  "bd-8plex-4": {
    title: "\u0412\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u043F\u043E\u0441\u043B\u0435 \u0440\u0435\u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u0438",
    flavor: "\u041D\u043E\u0432\u044B\u0435 \u0442\u0440\u0443\u0431\u044B, \u043D\u043E\u0432\u0430\u044F \u043F\u0440\u043E\u0432\u043E\u0434\u043A\u0430, \u043D\u043E\u0432\u0430\u044F \u0430\u0440\u0435\u043D\u0434\u0430 \u2014 \u0441\u0442\u0430\u0440\u0430\u044F \u0446\u0435\u043D\u0430."
  },
  "bd-8plex-5": {
    title: "\u0412\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0438\u0437 \u0434\u0432\u0443\u0445 \u0437\u0434\u0430\u043D\u0438\u0439",
    flavor: "\u0427\u0435\u0442\u044B\u0440\u0435 \u0438 \u0447\u0435\u0442\u044B\u0440\u0435, \u0447\u0435\u0440\u0435\u0437 \u0434\u043E\u0440\u043E\u0433\u0443 \u0434\u0440\u0443\u0433 \u043E\u0442 \u0434\u0440\u0443\u0433\u0430."
  },
  "bd-8plex-6": {
    title: "\u0412\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0443 \u0440\u0435\u043A\u0438",
    flavor: "\u0412\u0438\u0434\u044B \u0441 \u0432\u0435\u0440\u0445\u043D\u0435\u0433\u043E \u044D\u0442\u0430\u0436\u0430 \u043E\u043A\u0443\u043F\u0430\u044E\u0442 \u0432\u0441\u0451 \u0437\u0434\u0430\u043D\u0438\u0435."
  },
  "bd-apts-1": {
    title: "\u0414\u043E\u043C \u043D\u0430 12 \u043A\u0432\u0430\u0440\u0442\u0438\u0440 \u0431\u0435\u0437 \u043B\u0438\u0444\u0442\u0430",
    flavor: "\u0423\u0441\u0442\u0430\u043B\u044B\u0439 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439 \u0438 \u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u043E\u0432, \u0433\u043E\u0442\u043E\u0432\u044B\u0445 \u043A \u0440\u044B\u043D\u043E\u0447\u043D\u043E\u0439 \u0430\u0440\u0435\u043D\u0434\u0435."
  },
  "bd-apts-2": {
    title: "\u0421\u0442\u0443\u0434\u0435\u043D\u0447\u0435\u0441\u043A\u0438\u0439 \u0434\u043E\u043C \u043D\u0430 16 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0412 \u0434\u0432\u0443\u0445 \u043A\u0432\u0430\u0440\u0442\u0430\u043B\u0430\u0445 \u043E\u0442 \u0430\u0443\u0434\u0438\u0442\u043E\u0440\u0438\u0439. \u0417\u0430\u0435\u0437\u0434 \u0431\u0440\u043E\u043D\u0438\u0440\u0443\u044E\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 \u043C\u0430\u0440\u0442."
  },
  "bd-apts-3": {
    title: "\u0421\u0430\u0434\u043E\u0432\u044B\u0439 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441 \u043D\u0430 18 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0425\u043E\u0437\u044F\u0438\u043D \u0438\u0437 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0448\u0442\u0430\u0442\u0430 \u0434\u0435\u0441\u044F\u0442\u044C \u043B\u0435\u0442 \u043D\u0435 \u043F\u043E\u0432\u044B\u0448\u0430\u043B \u0430\u0440\u0435\u043D\u0434\u0443."
  },
  "bd-apts-4": {
    title: "\u041A\u0438\u0440\u043F\u0438\u0447\u043D\u0430\u044F \u043C\u043D\u043E\u0433\u043E\u044D\u0442\u0430\u0436\u043A\u0430 \u043D\u0430 20 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u041B\u0438\u0444\u0442 \u043F\u043E\u0441\u043A\u0440\u0438\u043F\u044B\u0432\u0430\u0435\u0442; \u0434\u0435\u043D\u0435\u0436\u043D\u044B\u0439 \u043F\u043E\u0442\u043E\u043A \u2014 \u043D\u0435\u0442."
  },
  "bd-apts-5": {
    title: "\u0414\u043E\u043C \u043D\u0430 24 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0438\u0437-\u043F\u043E\u0434 \u0431\u0430\u043D\u043A\u0430",
    flavor: "\u041A\u0440\u0435\u0434\u0438\u0442\u043E\u0440 \u043D\u0435 \u0437\u0430\u043D\u0438\u043C\u0430\u0435\u0442\u0441\u044F \u0430\u0440\u0435\u043D\u0434\u043E\u0439. \u0410 \u0432\u044B \u043C\u043E\u0433\u043B\u0438 \u0431\u044B."
  },
  "bd-apts-6": {
    title: "\u041F\u0435\u0440\u0435\u0434\u0435\u043B\u043A\u0430 \u043D\u0430 14 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0421\u0442\u0430\u0440\u0430\u044F \u0448\u043A\u043E\u043B\u0430, \u043D\u043E\u0432\u044B\u0435 \u043B\u043E\u0444\u0442\u044B, \u0434\u043B\u0438\u043D\u043D\u0430\u044F \u043E\u0447\u0435\u0440\u0435\u0434\u044C."
  },
  "bd-aptl-1": {
    title: "\u0427\u0430\u0441\u0442\u044C \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F \u043D\u0430 30 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0424\u043E\u043D\u0434 \u043F\u0435\u0440\u0435\u0431\u0430\u043B\u0430\u043D\u0441\u0438\u0440\u0443\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u044B, \u0438 \u044D\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u0443\u0431\u0440\u0430\u0442\u044C \u0441 \u0431\u0430\u043B\u0430\u043D\u0441\u0430."
  },
  "bd-aptl-2": {
    title: "\u0414\u0432\u0435 \u0431\u0430\u0448\u043D\u0438 \u043D\u0430 36 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0414\u0432\u0430 \u0437\u0435\u0440\u043A\u0430\u043B\u044C\u043D\u044B\u0445 \u0437\u0434\u0430\u043D\u0438\u044F, \u043E\u0434\u0438\u043D \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439 \u043D\u0430 \u043C\u0435\u0441\u0442\u0435."
  },
  "bd-aptl-3": {
    title: "\u041B\u043E\u0444\u0442\u044B \u0443 \u0434\u0435\u043F\u043E \u043D\u0430 44 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B",
    flavor: "\u0420\u0430\u0439\u043E\u043D \u0441\u0442\u0430\u043B \u043C\u043E\u0434\u043D\u044B\u043C \u0431\u044B\u0441\u0442\u0440\u0435\u0435, \u0447\u0435\u043C \u0437\u0430\u043C\u0435\u0442\u0438\u043B \u043F\u0440\u043E\u0434\u0430\u0432\u0435\u0446."
  },
  "bd-aptl-4": {
    title: "\u042E\u0436\u043D\u044B\u0439 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441 \u043D\u0430 52 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B",
    flavor: "\u0411\u0430\u0441\u0441\u0435\u0439\u043D\u044B, \u043F\u0430\u043B\u044C\u043C\u044B \u0438 \u043F\u044F\u0442\u044C\u0434\u0435\u0441\u044F\u0442 \u0434\u0432\u0430 \u0447\u0435\u043A\u0430 \u0437\u0430 \u0430\u0440\u0435\u043D\u0434\u0443."
  },
  "bd-aptl-5": {
    title: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u0430\u044F \u043F\u0440\u043E\u0434\u0430\u0436\u0430 \u043D\u0430 60 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u041F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u0442\u0432\u043E \u0440\u0430\u0441\u043F\u0430\u043B\u043E\u0441\u044C \u0432 \u0441\u0443\u0434\u0435; \u0441\u0443\u0434\u044C\u044F \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0440\u043E\u0434\u0430\u0436\u0438."
  },
  "bd-aptl-6": {
    title: "\u0421\u0430\u0434\u043E\u0432\u043E\u0435 \u043F\u043E\u043C\u0435\u0441\u0442\u044C\u0435 \u043D\u0430 40 \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0414\u043E\u043B\u0433\u0438\u0435 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u044B, \u043D\u0438\u0437\u043A\u0430\u044F \u0442\u0435\u043A\u0443\u0447\u043A\u0430, \u0447\u0443\u0434\u0435\u0441\u043D\u044B\u0435 \u0446\u0438\u0444\u0440\u044B."
  },
  "bd-fran-1": {
    title: "\u0411\u0443\u0440\u0433\u0435\u0440\u043D\u0430\u044F \u0444\u0440\u0430\u043D\u0448\u0438\u0437\u0430 \u043D\u0430 \u0443\u0433\u043B\u0443",
    flavor: "\u041D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u0431\u0440\u0435\u043D\u0434 \u043D\u0430 \u0440\u0430\u0441\u0442\u0443\u0449\u0435\u043C \u043F\u0435\u0440\u0435\u043A\u0440\u0451\u0441\u0442\u043A\u0435. \u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0441\u0430\u043C\u0430."
  },
  "bd-fran-2": {
    title: "\u041A\u043E\u0444\u0435\u0439\u043D\u0430\u044F \u0444\u0440\u0430\u043D\u0448\u0438\u0437\u0430 \u043F\u0440\u0438 \u0432\u043E\u043A\u0437\u0430\u043B\u0435",
    flavor: "\u041F\u0430\u0441\u0441\u0430\u0436\u0438\u0440\u044B \u0441\u0442\u043E\u044F\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0435\u0449\u0451 \u0434\u043E \u043F\u043E\u0434\u044A\u0451\u043C\u0430 \u0440\u043E\u043B\u043B\u0435\u0442."
  },
  "bd-fran-3": {
    title: "\u0424\u0440\u0430\u043D\u0448\u0438\u0437\u0430 \u0444\u0438\u0442\u043D\u0435\u0441\u0430 \u0432 \u0422\u0426",
    flavor: "\u042F\u043D\u0432\u0430\u0440\u044C \u043E\u043A\u0443\u043F\u0430\u0435\u0442 \u0432\u0435\u0441\u044C \u0433\u043E\u0434."
  },
  "bd-fran-4": {
    title: "\u041F\u0430\u0440\u0430 \u0444\u0440\u0430\u043D\u0448\u0438\u0437 \u043F\u043E \u043D\u0430\u043B\u043E\u0433\u0430\u043C",
    flavor: "\u0414\u0432\u0435 \u0442\u043E\u0447\u043A\u0438, \u043E\u0434\u0438\u043D \u0433\u043E\u0440\u044F\u0447\u0438\u0439 \u0441\u0435\u0437\u043E\u043D, \u043D\u043E\u043B\u044C \u0434\u0440\u0430\u043C\u044B."
  },
  "bd-fran-5": {
    title: "\u0424\u043B\u0430\u0433\u043C\u0430\u043D \u0441\u044D\u043D\u0434\u0432\u0438\u0447-\u0444\u0440\u0430\u043D\u0448\u0438\u0437\u044B",
    flavor: "\u041B\u0443\u0447\u0448\u0438\u0439 \u043F\u043E\u0442\u043E\u043A \u043B\u044E\u0434\u0435\u0439 \u0432\u043E \u0432\u0441\u0451\u043C \u0444\u0443\u0434\u043A\u043E\u0440\u0442\u0435."
  },
  "bd-fran-6": {
    title: "\u0424\u0440\u0430\u043D\u0448\u0438\u0437\u0430 \u0434\u0435\u0442\u0441\u043A\u043E\u0433\u043E \u0441\u0430\u0434\u0430",
    flavor: "\u0421 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0435\u0439, \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u043E\u043C \u0438 \u043F\u043E\u043B\u043D\u043E\u0439 \u0437\u0430\u043F\u0438\u0441\u044C\u044E \u043D\u0430 \u0433\u043E\u0434 \u0432\u043F\u0435\u0440\u0451\u0434."
  },
  "bd-biz-1": {
    title: "\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0430\u0432\u0442\u043E\u043C\u043E\u0439\u043A\u0430",
    flavor: "\u041C\u0430\u0448\u0438\u043D\u044B \u043C\u043E\u044E\u0442, \u043A\u0430\u043C\u0435\u0440\u044B \u0441\u043B\u0435\u0434\u044F\u0442, \u0442\u0435\u0440\u043C\u0438\u043D\u0430\u043B\u044B \u0441\u043E\u0431\u0438\u0440\u0430\u044E\u0442 \u0434\u0435\u043D\u044C\u0433\u0438."
  },
  "bd-biz-2": {
    title: "\u0421\u043A\u043B\u0430\u0434 \u0441\u0430\u043C\u043E\u043E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u044F",
    flavor: "\u0420\u044F\u0434\u044B \u043E\u0440\u0430\u043D\u0436\u0435\u0432\u044B\u0445 \u0434\u0432\u0435\u0440\u0435\u0439 \u0438 \u043F\u043E\u0447\u0442\u0438 \u0431\u0435\u0437 \u0437\u0430\u0440\u043F\u043B\u0430\u0442."
  },
  "bd-biz-3": {
    title: "\u041F\u0440\u0430\u0447\u0435\u0447\u043D\u0430\u044F \u043D\u0430 \u0434\u0432\u0430 \u0430\u0434\u0440\u0435\u0441\u0430",
    flavor: "\u041C\u043E\u043D\u0435\u0442\u043A\u0438 \u0432\u0451\u0434\u0440\u0430\u043C\u0438 \u0432 \u0434\u0432\u0443\u0445 \u0440\u0430\u0439\u043E\u043D\u0430\u0445."
  },
  "bd-biz-4": {
    title: "\u041C\u0438\u043D\u0438-\u0441\u0435\u0442\u044C \u0431\u0438\u043B\u0431\u043E\u0440\u0434\u043E\u0432",
    flavor: "\u0428\u0435\u0441\u0442\u044C \u0449\u0438\u0442\u043E\u0432 \u043D\u0430 \u0434\u0432\u0443\u0445 \u0442\u0440\u0430\u0441\u0441\u0430\u0445, \u0441\u0434\u0430\u043D\u044B \u0432 \u0430\u0440\u0435\u043D\u0434\u0443 \u043D\u0430 \u0433\u043E\u0434 \u0432\u043F\u0435\u0440\u0451\u0434."
  },
  "bd-part-1": {
    title: "\u041F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u0442\u0432\u043E: \u043C\u0438\u043D\u0438-\u043C\u043E\u043B\u043B",
    flavor: "\u0412\u044B \u0432\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u0435\u0442\u0435 \u043A\u0430\u043F\u0438\u0442\u0430\u043B, \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440 \u0434\u0435\u043B\u0430\u0435\u0442 \u0432\u0441\u0451 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u043E\u0435. \u0411\u0443\u043C\u0430\u0436\u043D\u044B\u0439 \u0430\u043A\u0442\u0438\u0432, \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0435 \u0447\u0435\u043A\u0438."
  },
  "bd-part-2": {
    title: "\u041F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u0442\u0432\u043E: \u0431\u0443\u0440\u043E\u0432\u043E\u0439 \u0444\u043E\u043D\u0434",
    flavor: "\u0412\u044B\u0441\u043E\u043A\u0438\u0439 \u0440\u0438\u0441\u043A, \u0432\u044B\u0441\u043E\u043A\u0438\u0435 \u0432\u044B\u043F\u043B\u0430\u0442\u044B, \u043F\u043E\u043A\u0430 \u0441\u043A\u0432\u0430\u0436\u0438\u043D\u044B \u0434\u0430\u044E\u0442 \u043D\u0435\u0444\u0442\u044C."
  },
  "mk-condo-hot": {
    title: "\u0411\u0438\u0442\u0432\u0430 \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B",
    flavor: "\u0420\u0430\u0431\u043E\u0442\u043E\u0434\u0430\u0442\u0435\u043B\u0438 \u0432 \u0446\u0435\u043D\u0442\u0440\u0435 \u043D\u0430\u043D\u0438\u043C\u0430\u044E\u0442; \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u0438 \u0434\u0430\u044E\u0442 135% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0434\u0432\u0443\u0445\u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0435 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B."
  },
  "mk-condo-flat": {
    title: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B, \u0447\u0435\u0441\u0442\u043D\u0430\u044F \u0446\u0435\u043D\u0430",
    flavor: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0436\u0438\u043B\u044C\u044F \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 \u0440\u043E\u0432\u043D\u043E \u0441\u0442\u043E\u043B\u044C\u043A\u043E, \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u043E\u044F\u0442 \u0434\u0432\u0443\u0445\u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0435 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B."
  },
  "mk-condo-cold": {
    title: "\u041F\u0435\u0440\u0435\u0438\u0437\u0431\u044B\u0442\u043E\u043A \u043A\u0432\u0430\u0440\u0442\u0438\u0440",
    flavor: "\u0422\u0440\u0438 \u043D\u043E\u0432\u044B\u0435 \u0431\u0430\u0448\u043D\u0438 \u043E\u0442\u043A\u0440\u044B\u043B\u0438\u0441\u044C \u0440\u0430\u0437\u043E\u043C. \u0424\u043E\u043D\u0434-\u0441\u0442\u0435\u0440\u0432\u044F\u0442\u043D\u0438\u043A \u0434\u0430\u0451\u0442 65% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0434\u0432\u0443\u0445\u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0435 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B."
  },
  "mk-house-hot": {
    title: "\u0410\u0436\u0438\u043E\u0442\u0430\u0436 \u043D\u0430 \u0441\u0435\u043C\u0435\u0439\u043D\u044B\u0435 \u0434\u043E\u043C\u0430",
    flavor: "\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u0448\u043A\u043E\u043B\u044B \u0441\u0442\u0430\u043B \u0432\u0438\u0440\u0443\u0441\u043D\u044B\u043C. \u0421\u0435\u043C\u044C\u0438 \u043F\u043B\u0430\u0442\u044F\u0442 140% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0442\u0440\u0451\u0445\u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0435 \u0434\u043E\u043C\u0430."
  },
  "mk-house-flat": {
    title: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u0434\u043E\u043C\u0430, \u0440\u044B\u043D\u043E\u0447\u043D\u0430\u044F \u0446\u0435\u043D\u0430",
    flavor: "\u0420\u0435\u043B\u043E\u043A\u0435\u0439\u0442-\u0430\u0433\u0435\u043D\u0442\u0441\u0442\u0432\u043E \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 105% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0442\u0440\u0451\u0445\u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0435 \u0434\u043E\u043C\u0430."
  },
  "mk-house-cold": {
    title: "\u0421\u0442\u0430\u0432\u043A\u0438 \u0432\u0437\u043B\u0435\u0442\u0435\u043B\u0438, \u0434\u043E\u043C\u0430 \u0432\u0441\u0442\u0430\u043B\u0438",
    flavor: "\u0418\u043F\u043E\u0442\u0435\u043A\u0430 \u0432\u043C\u0438\u0433 \u043F\u043E\u0434\u043E\u0440\u043E\u0436\u0430\u043B\u0430. \u0418\u043D\u0432\u0435\u0441\u0442\u043E\u0440 \u0434\u0430\u0451\u0442 70% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0442\u0440\u0451\u0445\u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0435 \u0434\u043E\u043C\u0430."
  },
  "mk-duplex-hot": {
    title: "\u0414\u0443\u043F\u043B\u0435\u043A\u0441\u044B \u043D\u0430\u0440\u0430\u0441\u0445\u0432\u0430\u0442",
    flavor: "\u0416\u0438\u0432\u0451\u0448\u044C \u0432 \u043E\u0434\u043D\u043E\u0439 \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0435, \u0441\u0434\u0430\u0451\u0448\u044C \u0434\u0440\u0443\u0433\u0443\u044E \u2014 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u0438 \u043F\u043B\u0430\u0442\u044F\u0442 130% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0434\u0443\u043F\u043B\u0435\u043A\u0441\u044B."
  },
  "mk-duplex-mid": {
    title: "\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u043F\u043E \u0434\u0443\u043F\u043B\u0435\u043A\u0441\u0443",
    flavor: "\u0420\u0430\u0441\u0448\u0438\u0440\u044F\u044E\u0449\u0430\u044F \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044C \u0430\u0440\u0435\u043D\u0434\u043E\u0434\u0430\u0442\u0435\u043B\u044C\u043D\u0438\u0446\u0430 \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 110% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0434\u0443\u043F\u043B\u0435\u043A\u0441\u044B."
  },
  "mk-4plex-hot": {
    title: "\u0411\u0443\u043C \u043C\u0430\u043B\u043E\u0439 \u043C\u043D\u043E\u0433\u043E\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043A\u0438",
    flavor: "\u0418\u043D\u043E\u0433\u043E\u0440\u043E\u0434\u043D\u0438\u0435 \u0434\u0435\u043D\u044C\u0433\u0438 \u043E\u0442\u043A\u0440\u044B\u043B\u0438 \u0434\u043B\u044F \u0441\u0435\u0431\u044F \u0447\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0438: \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u043F\u043E 145% \u043E\u0442 \u0446\u0435\u043D\u044B."
  },
  "mk-4plex-mid": {
    title: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u0447\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0430 \u043F\u043E \u043E\u0431\u043C\u0435\u043D\u0443",
    flavor: "\u041F\u0440\u043E\u0434\u0430\u0432\u0446\u0443 \u043A \u043D\u0430\u043B\u043E\u0433\u043E\u0432\u043E\u043C\u0443 \u0434\u0435\u0434\u043B\u0430\u0439\u043D\u0443 \u043D\u0443\u0436\u0435\u043D \u0432\u0430\u0448 \u0447\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A \u0437\u0430 115% \u043E\u0442 \u0446\u0435\u043D\u044B."
  },
  "mk-4plex-cold": {
    title: "\u0421\u0442\u0440\u0430\u0445\u043E\u0432\u043E\u0439 \u0448\u043E\u043A",
    flavor: "\u0412\u0437\u043D\u043E\u0441\u044B \u0432 \u0440\u0435\u0433\u0438\u043E\u043D\u0435 \u0443\u0434\u0432\u043E\u0438\u043B\u0438\u0441\u044C; \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u0437\u0430 \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 \u0434\u0430\u0451\u0442 75% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0447\u0435\u0442\u044B\u0440\u0451\u0445\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0438."
  },
  "mk-8plex-hot": {
    title: "\u0421\u0438\u043D\u0434\u0438\u043A\u0430\u0442\u043E\u0440\u044B \u043E\u0445\u043E\u0442\u044F\u0442\u0441\u044F \u0437\u0430 \u0432\u043E\u0441\u044C\u043C\u0451\u0440\u043A\u0430\u043C\u0438",
    flavor: "\u0421\u0438\u043D\u0434\u0438\u043A\u0430\u0442\u0443 \u043D\u0443\u0436\u043D\u044B \u0434\u0432\u0435\u0440\u0438 \u043A \u043A\u043E\u043D\u0446\u0443 \u043A\u0432\u0430\u0440\u0442\u0430\u043B\u0430: 150% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0438."
  },
  "mk-8plex-mid": {
    title: "\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u043F\u043E \u0432\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0443",
    flavor: "\u0421\u0435\u043C\u0435\u0439\u043D\u044B\u0439 \u043E\u0444\u0438\u0441 \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 120% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0438."
  },
  "mk-8plex-cold": {
    title: "\u041F\u0440\u043E\u0435\u043A\u0442 \u0437\u0430\u043C\u043E\u0440\u043E\u0437\u043A\u0438 \u0430\u0440\u0435\u043D\u0434\u044B",
    flavor: "\u0418\u043D\u0438\u0446\u0438\u0430\u0442\u0438\u0432\u0430 \u043D\u0430 \u0440\u0435\u0444\u0435\u0440\u0435\u043D\u0434\u0443\u043C\u0435 \u043F\u0443\u0433\u0430\u0435\u0442 \u0430\u0440\u0435\u043D\u0434\u043E\u0434\u0430\u0442\u0435\u043B\u0435\u0439; \u0434\u0430\u044E\u0442 80% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u043E\u0441\u044C\u043C\u0438\u043A\u0432\u0430\u0440\u0442\u0438\u0440\u043D\u0438\u043A\u0438."
  },
  "mk-apts-hot": {
    title: "\u0418\u043D\u0441\u0442\u0438\u0442\u0443\u0446\u0438\u043E\u043D\u0430\u043B\u044B \u0441\u043A\u0443\u043F\u0430\u044E\u0442 \u043C\u0430\u043B\u044B\u0435 \u0434\u043E\u043C\u0430",
    flavor: "\u041F\u0435\u043D\u0441\u0438\u043E\u043D\u043D\u044B\u0439 \u0444\u043E\u043D\u0434 \u043F\u043B\u0430\u0442\u0438\u0442 140% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043D\u0435\u0431\u043E\u043B\u044C\u0448\u0438\u0435 \u0436\u0438\u043B\u044B\u0435 \u0434\u043E\u043C\u0430."
  },
  "mk-apts-mid": {
    title: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u0436\u0438\u043B\u043E\u0433\u043E \u0434\u043E\u043C\u0430",
    flavor: "\u0420\u0435\u0433\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440 \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 115% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043D\u0435\u0431\u043E\u043B\u044C\u0448\u0438\u0435 \u0436\u0438\u043B\u044B\u0435 \u0434\u043E\u043C\u0430."
  },
  "mk-aptl-hot": {
    title: "\u0421\u0445\u0432\u0430\u0442\u043A\u0430 \u0437\u0430 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u044B",
    flavor: "REIT-\u0444\u043E\u043D\u0434\u044B \u043F\u0435\u0440\u0435\u0431\u0438\u0432\u0430\u044E\u0442 \u0434\u0440\u0443\u0433 \u0434\u0440\u0443\u0433\u0430: 145% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0431\u043E\u043B\u044C\u0448\u0438\u0435 \u0436\u0438\u043B\u044B\u0435 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u044B."
  },
  "mk-aptl-mid": {
    title: "\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u043F\u043E \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u0443",
    flavor: "REIT \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 118% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0431\u043E\u043B\u044C\u0448\u0438\u0435 \u0436\u0438\u043B\u044B\u0435 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u044B."
  },
  "mk-land-road": {
    title: "\u0422\u0440\u0430\u0441\u0441\u0430 \u043D\u0430 \u043F\u043E\u0434\u0445\u043E\u0434\u0435",
    flavor: "\u0413\u0435\u043E\u0434\u0435\u0437\u0438\u0441\u0442\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043B\u0438 \u043D\u043E\u0432\u0443\u044E \u0440\u0430\u0437\u0432\u044F\u0437\u043A\u0443. \u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A \u043F\u043B\u0430\u0442\u0438\u0442 300% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E."
  },
  "mk-land-mall": {
    title: "\u041F\u043E\u0438\u0441\u043A \u043F\u043B\u043E\u0449\u0430\u0434\u043A\u0438 \u043F\u043E\u0434 \u0433\u0438\u043F\u0435\u0440\u043C\u0430\u0440\u043A\u0435\u0442",
    flavor: "\u0420\u0435\u0442\u0435\u0439\u043B\u0435\u0440 \u0442\u0438\u0445\u043E \u0441\u043A\u0443\u043F\u0430\u0435\u0442 \u0443\u0447\u0430\u0441\u0442\u043A\u0438 \u043F\u043E 500% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E."
  },
  "mk-fran-hot": {
    title: "\u0421\u043A\u0443\u043F\u043A\u0430 \u0444\u0440\u0430\u043D\u0448\u0438\u0437",
    flavor: "\u0424\u043E\u043D\u0434 \u043F\u0440\u044F\u043C\u044B\u0445 \u0438\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0435\u0442 \u0444\u0440\u0430\u043D\u0448\u0438\u0437\u044B \u043F\u043E 160% \u043E\u0442 \u0446\u0435\u043D\u044B."
  },
  "mk-fran-mid": {
    title: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C \u0444\u0440\u0430\u043D\u0448\u0438\u0437\u044B",
    flavor: "\u0412\u043B\u0430\u0434\u0435\u043B\u0435\u0446-\u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440 \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 110% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0444\u0440\u0430\u043D\u0448\u0438\u0437\u044B."
  },
  "mk-localbiz": {
    title: "\u041A\u043E\u043D\u0441\u043E\u043B\u0438\u0434\u0430\u0446\u0438\u044F \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u043E\u0439 \u0443\u043B\u0438\u0446\u0435",
    flavor: "\u041C\u0435\u0441\u0442\u043D\u0430\u044F \u0441\u0435\u0442\u044C \u043F\u043E\u0433\u043B\u043E\u0449\u0430\u0435\u0442 \u043C\u0430\u043B\u044B\u0439 \u0431\u0438\u0437\u043D\u0435\u0441 \u043F\u043E 140% \u043E\u0442 \u0446\u0435\u043D\u044B."
  },
  "mk-partner": {
    title: "\u0412\u044B\u043A\u0443\u043F \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0441\u0442\u0432\u0430",
    flavor: "\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439 \u043F\u0430\u0440\u0442\u043D\u0451\u0440 \u0432\u044B\u043A\u0443\u043F\u0430\u0435\u0442 \u0434\u043E\u043B\u0438 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u043D\u044B\u0445 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u043E\u0432 \u043F\u043E 150% \u043E\u0442 \u0446\u0435\u043D\u044B."
  },
  "mk-grit-40": {
    title: "GRIT \u0441\u0442\u0430\u0432\u0438\u0442 \u0440\u0435\u043A\u043E\u0440\u0434",
    flavor: "\u0420\u043E\u0431\u043E\u0442\u043E\u0442\u0435\u0445\u043D\u0438\u043A\u0438 \u043F\u043E\u043B\u0443\u0447\u0430\u044E\u0442 \u043E\u0431\u043E\u0440\u043E\u043D\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442. \u0412\u0441\u0435 \u043C\u043E\u0433\u0443\u0442 \u043F\u0440\u043E\u0434\u0430\u0442\u044C GRIT \u043F\u043E $40."
  },
  "mk-grit-5": {
    title: "\u041F\u0430\u043D\u0438\u043A\u0430 \u0438\u0437-\u0437\u0430 \u043E\u0442\u0437\u044B\u0432\u0430 GRIT",
    flavor: "\u041E\u0442\u0437\u044B\u0432 \u0437\u0430\u0445\u0432\u0430\u0442\u043E\u0432 \u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u043C. GRIT \u0442\u043E\u0440\u0433\u0443\u0435\u0442\u0441\u044F \u043F\u043E $5 \u2014 \u043F\u0440\u043E\u0434\u0430\u0432\u0430\u0439\u0442\u0435, \u0435\u0441\u043B\u0438 \u043D\u0430\u0434\u043E."
  },
  "mk-snail-30": {
    title: "\u0421\u043B\u0443\u0445\u0438 \u043E \u043F\u043E\u0433\u043B\u043E\u0449\u0435\u043D\u0438\u0438 SNAIL",
    flavor: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0433\u0438\u0433\u0430\u043D\u0442 \u043F\u0440\u0438\u043D\u044E\u0445\u0438\u0432\u0430\u0435\u0442\u0441\u044F. SNAIL \u043A\u043E\u0442\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043F\u043E $30."
  },
  "mk-myco-40": {
    title: "\u0414\u0435\u043D\u044C \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0438\u044F MYCO",
    flavor: "\u0424\u043B\u0430\u0433\u043C\u0430\u043D\u0441\u043A\u0438\u0439 \u043F\u0440\u0435\u043F\u0430\u0440\u0430\u0442 \u0431\u0435\u0440\u0451\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0431\u0430\u0440\u044C\u0435\u0440. MYCO \u043F\u043E $40."
  },
  "mk-zap-30": {
    title: "ZAP \u0432\u044B\u0445\u043E\u0434\u0438\u0442 \u043D\u0430 \u0432\u0441\u044E \u0441\u0442\u0440\u0430\u043D\u0443",
    flavor: "\u0414\u0432\u0435\u0441\u0442\u0438 \u043D\u043E\u0432\u044B\u0445 \u0433\u043E\u0440\u043E\u0434\u043E\u0432 \u0432 \u043E\u0434\u043D\u043E\u043C \u043F\u0440\u0435\u0441\u0441-\u0440\u0435\u043B\u0438\u0437\u0435. ZAP \u043F\u043E $30."
  },
  "mk-nest-30": {
    title: "NEST \u043D\u0430 \u0440\u0435\u043A\u043E\u0440\u0434\u0435",
    flavor: "\u0412\u0435\u0441\u044C \u0438\u043D\u0434\u0435\u043A\u0441 \u0440\u0430\u0441\u0442\u0451\u0442. \u0424\u043E\u043D\u0434 NEST \u043A\u043E\u0442\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043F\u043E $30."
  },
  "mk-split-grit": {
    title: "\u0421\u043F\u043B\u0438\u0442 GRIT 2 \u043A 1",
    flavor: "\u0421\u043E\u0432\u0435\u0442 \u0445\u043E\u0447\u0435\u0442 \u0431\u043E\u043B\u0435\u0435 \u0434\u0440\u0443\u0436\u0435\u043B\u044E\u0431\u043D\u0443\u044E \u0446\u0435\u043D\u0443. \u0427\u0438\u0441\u043B\u043E \u0432\u0430\u0448\u0438\u0445 \u0430\u043A\u0446\u0438\u0439 GRIT \u0443\u0434\u0432\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F."
  },
  "mk-split-zap": {
    title: "\u0421\u043F\u043B\u0438\u0442 ZAP 2 \u043A 1",
    flavor: "\u0427\u0430\u0441\u0442\u043D\u044B\u0435 \u0438\u043D\u0432\u0435\u0441\u0442\u043E\u0440\u044B \u043B\u0438\u043A\u0443\u044E\u0442; \u0447\u0438\u0441\u043B\u043E \u0432\u0430\u0448\u0438\u0445 \u0430\u043A\u0446\u0438\u0439 ZAP \u0443\u0434\u0432\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F."
  },
  "mk-split-snail": {
    title: "\u0421\u043F\u043B\u0438\u0442 SNAIL 2 \u043A 1",
    flavor: "\u041C\u0435\u0434\u043B\u0435\u043D\u043D\u043E, \u043D\u043E \u0432\u0435\u0440\u043D\u043E \u2014 \u0438 \u0442\u0435\u043F\u0435\u0440\u044C \u0432\u0434\u0432\u043E\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u0430\u043A\u0446\u0438\u0439."
  },
  "mk-reverse-myco": {
    title: "\u041E\u0431\u0440\u0430\u0442\u043D\u044B\u0439 \u0441\u043F\u043B\u0438\u0442 MYCO",
    flavor: "\u041F\u0440\u0430\u0432\u0438\u043B\u0430 \u043B\u0438\u0441\u0442\u0438\u043D\u0433\u0430 \u0442\u0440\u0435\u0431\u0443\u044E\u0442 \u043A\u043E\u043D\u0441\u043E\u043B\u0438\u0434\u0430\u0446\u0438\u0438 1 \u043A 2. \u0427\u0438\u0441\u043B\u043E \u0432\u0430\u0448\u0438\u0445 \u0430\u043A\u0446\u0438\u0439 MYCO \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442\u0441\u044F \u0432\u0434\u0432\u043E\u0435."
  },
  "mk-windfall-refund": {
    title: "\u041D\u0435\u043E\u0436\u0438\u0434\u0430\u043D\u043D\u044B\u0439 \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u043D\u0430\u043B\u043E\u0433\u043E\u0432",
    flavor: "\u041D\u0430\u043B\u043E\u0433\u043E\u0432\u0430\u044F \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u043B\u0430. \u041A\u0430\u0436\u0434\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 $500."
  },
  "mk-windfall-rents": {
    title: "\u0410\u0440\u0435\u043D\u0434\u0430 \u043F\u043E\u0448\u043B\u0430 \u0432\u0432\u0435\u0440\u0445",
    flavor: "\u0414\u043E\u0433\u043E\u0432\u043E\u0440\u044B \u043F\u043E \u0432\u0441\u0435\u043C\u0443 \u0433\u043E\u0440\u043E\u0434\u0443 \u043F\u0440\u043E\u0434\u043B\u0435\u0432\u0430\u044E\u0442 \u0434\u043E\u0440\u043E\u0436\u0435: \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 $250 \u0437\u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u0441\u0434\u0430\u0432\u0430\u0435\u043C\u0443\u044E \u043D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C."
  },
  "dd-01": {
    title: "\u041F\u0440\u0438\u0432\u044B\u0447\u043A\u0430 \u043A \u043A\u0440\u0430\u0444\u0442\u043E\u0432\u043E\u043C\u0443 \u043A\u043E\u0444\u0435",
    flavor: "\u041C\u0435\u0441\u044F\u0446 \u043F\u0443\u0440\u043E\u0432\u0435\u0440\u043E\u0432 \u0438\u0437 \u0437\u0451\u0440\u0435\u043D \u043E\u0434\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F."
  },
  "dd-02": {
    title: "\u041F\u0440\u043E\u0434\u043B\u0435\u043D\u0438\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
    flavor: "\u041F\u044F\u0442\u044C \u0441\u0435\u0440\u0432\u0438\u0441\u043E\u0432 \u0438 \u043D\u043E\u043B\u044C \u0432\u0440\u0435\u043C\u0435\u043D\u0438, \u0447\u0442\u043E\u0431\u044B \u0438\u0445 \u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C."
  },
  "dd-03": {
    title: "\u0428\u0442\u0440\u0430\u0444 \u0437\u0430 \u043F\u0430\u0440\u043A\u043E\u0432\u043A\u0443",
    flavor: "\u0417\u043D\u0430\u043A \u0431\u044B\u043B \u043E\u0447\u0435\u043D\u044C \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0439."
  },
  "dd-04": {
    title: "\u0423\u0436\u0438\u043D \u043D\u0430 \u0434\u0435\u043D\u044C \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F",
    flavor: "\u0412\u044B \u0441\u0445\u0432\u0430\u0442\u0438\u043B\u0438 \u0441\u0447\u0451\u0442 \u0440\u0430\u043D\u044C\u0448\u0435, \u0447\u0435\u043C \u043A\u0442\u043E-\u043B\u0438\u0431\u043E \u0443\u0441\u043F\u0435\u043B \u0432\u043E\u0437\u0440\u0430\u0437\u0438\u0442\u044C."
  },
  "dd-05": {
    title: "\u041B\u0438\u043C\u0438\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043A\u0440\u043E\u0441\u0441\u043E\u0432\u043A\u0438",
    flavor: "\u041E\u043D\u0438 \u0431\u044B\u043B\u0438 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u043D\u043E\u0439 \u0441\u0435\u0440\u0438\u0435\u0439. \u0412\u044B \u0431\u044B\u043B\u0438 \u0431\u044B\u0441\u0442\u0440\u044B\u043C."
  },
  "dd-06": {
    title: "\u041A\u043E\u043D\u0446\u0435\u0440\u0442\u043D\u044B\u0435 \u0432\u044B\u0445\u043E\u0434\u043D\u044B\u0435",
    flavor: "\u0414\u0432\u0430 \u0431\u0438\u043B\u0435\u0442\u0430 \u0438 \u043E\u0434\u0438\u043D \u043F\u0435\u0440\u0435\u043E\u0446\u0435\u043D\u0451\u043D\u043D\u044B\u0439 \u0445\u0443\u0434\u0438."
  },
  "dd-07": {
    title: "\u041D\u043E\u0432\u044B\u0435 \u0437\u0438\u043C\u043D\u0438\u0435 \u0448\u0438\u043D\u044B",
    flavor: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C, \u043F\u043E\u0442\u043E\u043C \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u044F."
  },
  "dd-08": {
    title: "\u041F\u043B\u043E\u043C\u0431\u0430 \u0443 \u0441\u0442\u043E\u043C\u0430\u0442\u043E\u043B\u043E\u0433\u0430",
    flavor: "\u0411\u0430\u043D\u043A\u0430 \u0441 \u043A\u043E\u043D\u0444\u0435\u0442\u0430\u043C\u0438 \u043F\u0435\u0440\u0435\u0434\u0430\u0451\u0442 \u043F\u0440\u0438\u0432\u0435\u0442."
  },
  "dd-09": {
    title: "\u0410\u0431\u043E\u043D\u0435\u043C\u0435\u043D\u0442 \u0432 \u043C\u043E\u0434\u043D\u044B\u0439 \u0437\u0430\u043B",
    flavor: "\u0412\u0441\u0442\u0443\u043F\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0432\u0437\u043D\u043E\u0441 \u043F\u043B\u044E\u0441 \u0441\u043C\u0443\u0437\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u044B\u043B \u043D\u0435 \u043D\u0443\u0436\u0435\u043D."
  },
  "dd-10": {
    title: "\u0414\u0435\u0442\u0441\u043A\u0438\u0439 \u0434\u0435\u043D\u044C \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F",
    flavor: "\u0423 \u043D\u0430\u0434\u0443\u0432\u043D\u043E\u0433\u043E \u0437\u0430\u043C\u043A\u0430 \u043D\u0430 \u0443\u0434\u0438\u0432\u043B\u0435\u043D\u0438\u0435 \u0432\u044B\u0441\u043E\u043A\u0430\u044F \u0441\u0443\u0442\u043E\u0447\u043D\u0430\u044F \u0441\u0442\u0430\u0432\u043A\u0430."
  },
  "dd-11": {
    title: "\u041F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u043A\u043E\u0444\u0435\u043C\u0430\u0448\u0438\u043D\u0430",
    flavor: "\u0412 \u043D\u0435\u0439 \u0431\u043E\u043B\u044C\u0448\u0435 \u043C\u0430\u043D\u043E\u043C\u0435\u0442\u0440\u043E\u0432, \u0447\u0435\u043C \u0432 \u0432\u0430\u0448\u0435\u0439 \u043C\u0430\u0448\u0438\u043D\u0435."
  },
  "dd-12": {
    title: "\u041F\u043E\u0435\u0437\u0434\u043A\u0430 \u0432 \u0433\u043E\u0440\u043E\u0434 \u043D\u0430 \u0432\u044B\u0445\u043E\u0434\u043D\u044B\u0435",
    flavor: "\u0411\u0438\u043B\u0435\u0442\u044B \u043F\u043E \u0430\u043A\u0446\u0438\u0438, \u0432\u0441\u0451 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u043E\u0435 \u2014 \u043F\u043E \u043F\u043E\u043B\u043D\u043E\u0439."
  },
  "dd-13": {
    title: "\u0417\u0430\u043C\u0435\u043D\u0430 \u044D\u043A\u0440\u0430\u043D\u0430 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430",
    flavor: "\u041E\u043D \u0443\u043F\u0430\u043B \u0432\u0441\u0435\u0433\u043E \u043E\u0434\u0438\u043D \u0440\u0430\u0437."
  },
  "dd-14": {
    title: "\u0414\u0438\u0437\u0430\u0439\u043D\u0435\u0440\u0441\u043A\u0438\u0435 \u043E\u0447\u043A\u0438",
    flavor: "\u041F\u043E\u0442\u0435\u0440\u044F\u044E\u0442\u0441\u044F \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 \u043C\u0435\u0441\u044F\u0446\u0430, \u043F\u043E \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0435."
  },
  "dd-15": {
    title: "\u0417\u0430\u043A\u0443\u043F\u043A\u0430 \u0443\u043C\u043D\u044B\u0445 \u0433\u0430\u0434\u0436\u0435\u0442\u043E\u0432",
    flavor: "\u0422\u0435\u043F\u0435\u0440\u044C \u043B\u0430\u043C\u043F\u043E\u0447\u043A\u0430\u043C \u043D\u0443\u0436\u043D\u043E \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u0448\u0438\u0432\u043A\u0438."
  },
  "dd-16": {
    title: "\u0421\u0440\u043E\u0447\u043D\u044B\u0439 \u0432\u0438\u0437\u0438\u0442 \u043A \u0432\u0435\u0442\u0435\u0440\u0438\u043D\u0430\u0440\u0443",
    flavor: "\u041D\u043E\u0441\u043E\u043A \u0431\u043B\u0430\u0433\u043E\u043F\u043E\u043B\u0443\u0447\u043D\u043E \u0438\u0437\u0432\u043B\u0435\u0447\u0451\u043D."
  },
  "dd-17": {
    title: "\u041D\u043E\u0432\u0430\u044F \u0438\u0433\u0440\u043E\u0432\u0430\u044F \u043A\u043E\u043D\u0441\u043E\u043B\u044C",
    flavor: "\u0414\u043B\u044F \u0434\u0435\u0442\u0435\u0439. \u0420\u0430\u0437\u0443\u043C\u0435\u0435\u0442\u0441\u044F."
  },
  "dd-18": {
    title: "\u0414\u0435\u0442\u0435\u0439\u043B\u0438\u043D\u0433 \u0438 \u0422\u041E \u043C\u0430\u0448\u0438\u043D\u044B",
    flavor: "\u0422\u0435\u043F\u0435\u0440\u044C \u043E\u043D\u0430 \u043C\u0443\u0440\u043B\u044B\u0447\u0435\u0442. \u0410 \u043A\u043E\u0448\u0435\u043B\u0451\u043A \u0441\u043A\u0443\u043B\u0438\u0442."
  },
  "dd-19": {
    title: "\u0410\u043F\u0433\u0440\u0435\u0439\u0434 \u043A\u043B\u044E\u0448\u0435\u043A \u0434\u043B\u044F \u0433\u043E\u043B\u044C\u0444\u0430",
    flavor: "\u0421\u043B\u0430\u0439\u0441, \u043A \u0441\u043E\u0436\u0430\u043B\u0435\u043D\u0438\u044E, \u043F\u0435\u0440\u0435\u0435\u0437\u0436\u0430\u0435\u0442 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0432\u0430\u043C\u0438."
  },
  "dd-20": {
    title: "\u0423\u043A\u0440\u0430\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 \u0433\u043E\u0434\u043E\u0432\u0449\u0438\u043D\u0443",
    flavor: "\u0421\u0442\u043E\u0438\u0442 \u043A\u0430\u0436\u0434\u043E\u0439 \u043A\u043E\u043F\u0435\u0439\u043A\u0438. \u0412\u0441\u0435\u0445 45 000."
  },
  "dd-21": {
    title: "\u0421\u0430\u043B\u043E\u043D\u043D\u0430\u044F \u0441\u0442\u0440\u0438\u0436\u043A\u0430 \u0438 \u0441\u043F\u0430-\u0434\u0435\u043D\u044C",
    flavor: "\u0417\u0430\u0431\u043E\u0442\u0430 \u043E \u0441\u0435\u0431\u0435, \u043F\u0440\u0435\u043C\u0438\u0443\u043C-\u0443\u0440\u043E\u0432\u0435\u043D\u044C."
  },
  "dd-22": {
    title: "\u0412\u0437\u043D\u043E\u0441\u044B \u0437\u0430 \u0434\u0435\u0442\u0441\u043A\u0443\u044E \u043B\u0438\u0433\u0443",
    flavor: "\u0424\u043E\u0440\u043C\u0430, \u043F\u043E\u0435\u0437\u0434\u043A\u0438 \u0438 \u043B\u043E\u0442\u0435\u0440\u0435\u044F, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u0432\u044B \u043F\u0440\u043E\u0438\u0433\u0440\u0430\u043B\u0438."
  },
  "dd-23": {
    title: "\u041D\u043E\u0432\u043E\u0435 \u043E\u0444\u0438\u0441\u043D\u043E\u0435 \u043A\u0440\u0435\u0441\u043B\u043E",
    flavor: "\u0412\u0430\u0448\u0430 \u0441\u043F\u0438\u043D\u0430 \u0443\u0441\u0442\u0440\u043E\u0438\u043B\u0430 \u0437\u0430\u0431\u0430\u0441\u0442\u043E\u0432\u043A\u0443."
  },
  "dd-24": {
    title: "\u0417\u0430\u043F\u043E\u0439 \u043F\u043E \u043D\u0430\u0431\u043E\u0440\u0430\u043C \u0434\u043B\u044F \u0442\u0432\u043E\u0440\u0447\u0435\u0441\u0442\u0432\u0430",
    flavor: "\u0422\u0435\u043F\u0435\u0440\u044C \u0432\u044B \u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u043F\u0435\u0447\u0438 \u0434\u043B\u044F \u043E\u0431\u0436\u0438\u0433\u0430."
  },
  "dd-25": {
    title: "\u0414\u0440\u043E\u043D \u0441 \u043A\u0430\u043C\u0435\u0440\u043E\u0439",
    flavor: "\u0412\u043F\u0435\u0440\u0435\u0434\u0438 \u2014 \u043A\u0438\u043D\u0435\u043C\u0430\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u044F \u0440\u0430\u0439\u043E\u043D\u043D\u043E\u0433\u043E \u043C\u0430\u0441\u0448\u0442\u0430\u0431\u0430."
  },
  "dd-26": {
    title: "\u041F\u0440\u0430\u0437\u0434\u043D\u0438\u0447\u043D\u044B\u0439 \u0448\u043E\u043F\u0438\u043D\u0433",
    flavor: "\u0412 \u044D\u0442\u043E\u043C \u0433\u043E\u0434\u0443 \u0432\u0441\u0435 \u0431\u044B\u043B\u0438 \u043E\u0441\u043E\u0431\u0435\u043D\u043D\u043E \u043C\u0438\u043B\u044B."
  },
  "dd-27": {
    title: "\u0428\u0442\u0440\u0430\u0444 \u0437\u0430 \u043F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u0438\u0435 \u0438 \u043A\u0443\u0440\u0441\u044B",
    flavor: "\u0412\u0438\u0434\u0435\u043E \u043F\u043E \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u043C\u0443 \u0432\u043E\u0436\u0434\u0435\u043D\u0438\u044E \u0434\u043B\u0438\u043B\u043E\u0441\u044C 4 \u0447\u0430\u0441\u0430."
  },
  "dd-28": {
    title: "\u0417\u0430\u0433\u0430\u0434\u043E\u0447\u043D\u0430\u044F \u043F\u0440\u043E\u0442\u0435\u0447\u043A\u0430",
    flavor: "\u0412 \u0442\u0440\u0438 \u0447\u0430\u0441\u0430 \u043D\u043E\u0447\u0438 \u043A\u0430\u043F\u0430\u043B\u043E \u0433\u0440\u043E\u043C\u0447\u0435."
  },
  "dd-29": {
    title: "\u041A\u043E\u0441\u0442\u044E\u043C \u043D\u0430 \u0437\u0430\u043A\u0430\u0437",
    flavor: "\u0414\u043B\u044F \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u0439, \u0441\u0432\u0430\u0434\u0435\u0431 \u0438 \u043E\u0449\u0443\u0449\u0435\u043D\u0438\u044F \u0448\u0438\u043A\u0430."
  },
  "dd-30": {
    title: "\u0418\u043C\u043F\u0443\u043B\u044C\u0441\u0438\u0432\u043D\u0430\u044F \u043F\u043E\u043A\u0443\u043F\u043A\u0430 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u0432\u0435\u043B\u043E\u0441\u0438\u043F\u0435\u0434\u0430",
    flavor: "\u0428\u0451\u043B \u0434\u043E\u0436\u0434\u044C, \u0430 \u0430\u0432\u0442\u043E\u0431\u0443\u0441 \u043E\u043F\u0430\u0437\u0434\u044B\u0432\u0430\u043B."
  },
  "dd-31": {
    title: "\u0412\u0437\u043D\u043E\u0441 \u0432 \u0444\u044D\u043D\u0442\u0435\u0437\u0438-\u043B\u0438\u0433\u0443",
    flavor: "\u042D\u0442\u043E \u0432\u0430\u0448 \u0433\u043E\u0434. \u0421\u043D\u043E\u0432\u0430."
  },
  "dd-32": {
    title: "\u041F\u0440\u0435\u043C\u0438\u0430\u043B\u044C\u043D\u044B\u0435 \u043D\u0430\u0443\u0448\u043D\u0438\u043A\u0438",
    flavor: "\u0428\u0443\u043C\u043E\u043F\u043E\u0434\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0435\u0441\u0442\u044C, \u043F\u043E\u0434\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u044E\u0434\u0436\u0435\u0442\u0430 \u0442\u043E\u0436\u0435."
  },
  "dd-33": {
    title: "\u0420\u044B\u0431\u0430\u043B\u043A\u0430 \u043D\u0430 \u0430\u0440\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u043D\u043E\u043C \u043A\u0430\u0442\u0435\u0440\u0435",
    flavor: "\u041A\u0440\u0443\u043F\u043D\u0430\u044F \u0443\u0448\u043B\u0430; \u0441\u0447\u0451\u0442 \u043E\u0441\u0442\u0430\u043B\u0441\u044F."
  },
  "dd-34": {
    title: "\u041A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u044F \u043A\u043E\u043C\u043D\u0430\u0442\u043D\u044B\u0445 \u0440\u0430\u0441\u0442\u0435\u043D\u0438\u0439",
    flavor: "\u0420\u0435\u0434\u043A\u043E\u043C\u0443 \u0432\u0438\u0434\u0443 \u043D\u0443\u0436\u0435\u043D \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0443\u0432\u043B\u0430\u0436\u043D\u0438\u0442\u0435\u043B\u044C."
  },
  "dd-35": {
    title: "\u041A\u0430\u0440\u0430\u043E\u043A\u0435 \u0437\u0430 \u0432\u0430\u0448 \u0441\u0447\u0451\u0442",
    flavor: "\u0412\u044B \u0434\u0432\u0430\u0436\u0434\u044B \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u0443\u044E \u043A\u043E\u043C\u043D\u0430\u0442\u0443."
  },
  "dd-36": {
    title: "\u041D\u043E\u0432\u044B\u0439 \u043C\u0430\u0442\u0440\u0430\u0441",
    flavor: "\u0421\u043E\u043D \u2014 \u044D\u0442\u043E \u0432\u0435\u0434\u044C \u0438\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u044F, \u0434\u0430?"
  },
  "dd-37": {
    title: "\u0420\u043E\u0441\u043A\u043E\u0448\u043D\u044B\u0439 \u0434\u0435\u043D\u044C \u043D\u0430 \u043B\u044B\u0436\u0430\u0445",
    flavor: "\u0421\u043A\u0438-\u043F\u0430\u0441\u0441, \u0443\u0440\u043E\u043A \u0438 \u043D\u0430\u0447\u043E\u0441 \u0432 \u0448\u0430\u043B\u0435."
  },
  "dd-38": {
    title: "\u0411\u0438\u043B\u0435\u0442 \u043D\u0430 \u0431\u043B\u0430\u0433\u043E\u0442\u0432\u043E\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0433\u0430\u043B\u0430-\u0432\u0435\u0447\u0435\u0440",
    flavor: "\u0427\u0451\u0440\u043D\u044B\u0439 \u0433\u0430\u043B\u0441\u0442\u0443\u043A, \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0435 \u0441\u0435\u0440\u0434\u0446\u0435, \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0439 \u043A\u043E\u0448\u0435\u043B\u0451\u043A."
  },
  "dd-39": {
    title: "\u0420\u0435\u043C\u043E\u043D\u0442 \u043A\u043E\u043D\u0434\u0438\u0446\u0438\u043E\u043D\u0435\u0440\u0430",
    flavor: "\u041E\u043D \u0441\u043B\u043E\u043C\u0430\u043B\u0441\u044F \u0432 \u0441\u0430\u043C\u0443\u044E \u0436\u0430\u0440\u0443, \u0435\u0441\u0442\u0435\u0441\u0442\u0432\u0435\u043D\u043D\u043E."
  },
  "dd-40": {
    title: "\u0417\u0430\u043A\u0443\u043F\u043A\u0430 \u043A\u043E\u043B\u043B\u0435\u043A\u0446\u0438\u043E\u043D\u043D\u044B\u0445 \u043D\u0430\u0441\u0442\u043E\u043B\u043E\u043A",
    flavor: "\u041F\u043E\u043B\u043A\u0430 \u0441\u0442\u044B\u0434\u0430 \u043F\u043E\u043F\u043E\u043B\u043D\u0438\u043B\u0430\u0441\u044C \u0442\u0440\u0435\u043C\u044F \u043A\u043E\u0440\u043E\u0431\u043A\u0430\u043C\u0438."
  },
  "oc-shib-1": {
    title: "\u041F\u0430\u043D\u0438\u043A\u0430 \u043F\u043E\u0441\u043B\u0435 \u0440\u0430\u0433-\u043F\u0443\u043B\u043B\u0430 SHIB",
    flavor: "\u0422\u043E\u043A\u0435\u043D-\u043F\u043E\u0434\u0440\u0430\u0436\u0430\u0442\u0435\u043B\u044C \u043A\u0438\u043D\u0443\u043B \u0434\u0435\u0440\u0436\u0430\u0442\u0435\u043B\u0435\u0439, \u0438 \u0440\u0430\u0441\u043F\u0440\u043E\u0434\u0430\u044E\u0442 \u0432\u0441\u044E \u043F\u0441\u0430\u0440\u043D\u044E. \u041A\u0443\u043F\u0438\u0442\u044C \u043C\u043E\u0436\u0435\u0442\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u044B; \u043F\u0440\u043E\u0434\u0430\u0442\u044C \u2014 \u0432\u0441\u0435."
  },
  "oc-shib-8": {
    title: "SHIB \u0432 \u0431\u043E\u043A\u043E\u0432\u0438\u043A\u0435",
    flavor: "\u0413\u0440\u0430\u0444\u0438\u043A \u2014 \u043F\u0440\u044F\u043C\u0430\u044F \u043B\u0438\u043D\u0438\u044F; \u043A\u043E\u043C\u044C\u044E\u043D\u0438\u0442\u0438 \u043D\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u044D\u0442\u043E \u043D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u0435\u043C."
  },
  "oc-shib-20": {
    title: "\u0418\u043D\u0444\u043B\u044E\u0435\u043D\u0441\u0435\u0440 \u043A\u0430\u0447\u0430\u0435\u0442 SHIB",
    flavor: "\u0417\u0432\u0435\u0437\u0434\u0430 \u043F\u043E\u0441\u0442\u0438\u0442 \u043E\u0434\u043D\u043E \u0444\u043E\u0442\u043E \u0441\u043E\u0431\u0430\u043A\u0438. \u041E\u0431\u044A\u0451\u043C\u044B \u0443\u0445\u043E\u0434\u044F\u0442 \u0432 \u0432\u0435\u0440\u0442\u0438\u043A\u0430\u043B\u044C."
  },
  "oc-shib-30": {
    title: "SHIB \u043B\u0435\u0442\u0438\u0442 \u043D\u0430 \u043B\u0443\u043D\u0443",
    flavor: "\u0426\u0438\u0444\u0440\u0430 \u0440\u0430\u0441\u0442\u0451\u0442. \u0412\u0441\u0435 \u0433\u0435\u043D\u0438\u0438. \u0426\u0435\u043D\u0430 \u2014 \u043A\u0430\u043A \u0437\u0430 \u043F\u043E\u0441\u0430\u0434\u043A\u0443 \u043D\u0430 \u041B\u0443\u043D\u0443."
  },
  "oc-pepe-1": {
    title: "PEPE \u0432 \u043C\u0435\u0434\u0432\u0435\u0436\u044C\u0435\u043C \u0440\u044B\u043D\u043A\u0435",
    flavor: "\u0413\u043E\u0432\u043E\u0440\u044F\u0442, \u043C\u0435\u043C \u0443\u043C\u0435\u0440. \u0423 \u043C\u0435\u043C\u043E\u0432 \u0434\u0435\u0432\u044F\u0442\u044C \u0436\u0438\u0437\u043D\u0435\u0439."
  },
  "oc-pepe-10": {
    title: "\u0421\u0435\u0437\u043E\u043D \u043C\u0435\u043C\u043E\u0432 \u0443 PEPE",
    flavor: "Feels good, man \u2014 \u043B\u0435\u043D\u0442\u0430 \u0441\u043D\u043E\u0432\u0430 \u0437\u0435\u043B\u0451\u043D\u0430\u044F."
  },
  "oc-pepe-18": {
    title: "PEPE \u0441\u043D\u043E\u0432\u0430 \u0432\u0438\u0440\u0443\u0441\u043D\u044B\u0439",
    flavor: "\u0421\u0432\u0435\u0436\u0438\u0439 \u0448\u0430\u0431\u043B\u043E\u043D \u0440\u0430\u0437\u043B\u0435\u0442\u0430\u0435\u0442\u0441\u044F \u043F\u043E \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0443; \u0442\u043E\u043A\u0435\u043D \u0435\u0434\u0435\u0442 \u0441\u043B\u0435\u0434\u043E\u043C."
  },
  "oc-pepe-25": {
    title: "\u042D\u0439\u0444\u043E\u0440\u0438\u044F PEPE",
    flavor: "\u0412\u0435\u0440\u0448\u0438\u043D\u0430 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u0430, \u0432\u0435\u0440\u0448\u0438\u043D\u0430 \u043B\u0435\u043D\u0442\u044B."
  },
  "oc-doge-2": {
    title: "DOGE \u0437\u0430\u0431\u044B\u0442",
    flavor: "\u041F\u0435\u0440\u0432\u044B\u0439 \u043C\u0435\u043C-\u043A\u043E\u0438\u043D \u0434\u0440\u0435\u043C\u043B\u0435\u0442 \u043C\u0435\u0436\u0434\u0443 \u0446\u0438\u043A\u043B\u0430\u043C\u0438. Much \u0442\u0438\u0448\u0438\u043D\u0430."
  },
  "oc-doge-15": {
    title: "\u0422\u0432\u0438\u0442 \u043A\u0430\u0447\u043D\u0443\u043B DOGE",
    flavor: "\u041C\u0438\u043B\u043B\u0438\u0430\u0440\u0434\u0435\u0440 \u043F\u043E\u0441\u0442\u0438\u0442 \u0441\u0438\u0431\u0443 \u0432 \u043A\u0430\u0441\u043A\u0435. \u041F\u043B\u044E\u0441 40% \u043A \u043E\u0431\u0435\u0434\u0443."
  },
  "oc-doge-40": {
    title: "\u041C\u0430\u043D\u0438\u044F DOGE",
    flavor: "\u0422\u0430\u043A\u0441\u0438\u0441\u0442\u044B \u0440\u0430\u0437\u0434\u0430\u044E\u0442 \u0446\u0435\u043B\u0435\u0432\u044B\u0435 \u0446\u0435\u043D\u044B. \u0422\u0435\u0440\u0440\u0438\u0442\u043E\u0440\u0438\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C\u0430."
  },
  "oc-bonk-1": {
    title: "BONK \u2014 \u043F\u044B\u043B\u044C",
    flavor: "\u041C\u0438\u043D\u0443\u0441 95% \u043E\u0442 \u043F\u0438\u043A\u0430. \u0412\u0435\u0440\u0443\u044E\u0449\u0438\u0435 \u043D\u0430\u0437\u044B\u0432\u0430\u044E\u0442 \u044D\u0442\u043E \u043F\u043E\u0434\u0430\u0440\u043A\u043E\u043C."
  },
  "oc-bonk-6": {
    title: "BONK \u0434\u0440\u0435\u0439\u0444\u0443\u0435\u0442",
    flavor: "\u0420\u0430\u0437\u0434\u0430\u043B\u0438, \u0441\u043B\u0438\u043B\u0438, \u0437\u0430\u0431\u044B\u043B\u0438 \u2014 \u0430 \u043E\u043D \u0442\u0438\u0445\u043E \u0441\u0442\u0440\u043E\u0438\u0442\u0441\u044F."
  },
  "oc-bonk-20": {
    title: "\u041B\u0438\u0441\u0442\u0438\u043D\u0433 BONK \u043D\u0430 \u0431\u0438\u0440\u0436\u0435",
    flavor: "\u041A\u0440\u0443\u043F\u043D\u0430\u044F \u0431\u0438\u0440\u0436\u0430 \u043B\u0438\u0441\u0442\u0438\u0442 \u0442\u043E\u043A\u0435\u043D \u2014 \u0438 \u0443 \u043F\u0441\u0430 \u043D\u0430\u0441\u0442\u0443\u043F\u0430\u0435\u0442 \u0435\u0433\u043E \u0434\u0435\u043D\u044C."
  },
  "oc-wif-5": {
    title: "\u0422\u0438\u0445\u043E\u0435 \u043D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u0435 WIF",
    flavor: "\u041F\u0440\u043E\u0441\u0442\u043E \u043F\u0451\u0441 \u0432 \u0448\u0430\u043F\u043A\u0435, \u0436\u0434\u0443\u0449\u0438\u0439 \u0441\u0432\u043E\u0435\u0433\u043E \u0447\u0430\u0441\u0430."
  },
  "oc-wif-35": {
    title: "\u0421\u0435\u0437\u043E\u043D \u0448\u0430\u043F\u043A\u0438 WIF",
    flavor: "\u0428\u0430\u043F\u043A\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F. \u0422\u0435\u0440\u0440\u0438\u0442\u043E\u0440\u0438\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C\u0430."
  },
  "oc-usdr-a": {
    title: "\u0421\u0442\u0435\u0439\u0431\u043B\u043A\u043E\u0438\u043D-\u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435, \u043E\u0431\u044B\u0447\u043D\u044B\u0439 APY",
    flavor: "\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u0432 $1,000 \u0441\u0442\u0435\u0439\u043A\u0430\u0435\u0442 $30 \u0432 \u043C\u0435\u0441\u044F\u0446. \u0421\u043A\u0443\u0447\u043D\u044B\u0439 \u0443\u0433\u043E\u043B \u043A\u0440\u0438\u043F\u0442\u044B."
  },
  "oc-usdr-b": {
    title: "\u0421\u0442\u0435\u0439\u0431\u043B\u043A\u043E\u0438\u043D-\u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435, \u043F\u0440\u043E\u043C\u043E-APY",
    flavor: "\u041F\u0440\u043E\u043C\u043E-\u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043F\u043B\u0430\u0442\u0438\u0442 $50 \u0432 \u043C\u0435\u0441\u044F\u0446 \u0441 $1,000. \u041F\u0440\u043E\u0447\u0438\u0442\u0430\u0439\u0442\u0435 \u043C\u0435\u043B\u043A\u0438\u0439 \u0448\u0440\u0438\u0444\u0442 \u0434\u0432\u0430\u0436\u0434\u044B."
  },
  "om-shib-30": {
    title: "\u0418\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C SHIB",
    flavor: "\u041F\u0451\u0441 \u0432\u0435\u0434\u0451\u0442 \u0432\u0435\u0441\u044C \u0440\u044B\u043D\u043E\u043A. \u041A\u0430\u0436\u0434\u044B\u0439 \u043C\u043E\u0436\u0435\u0442 \u043F\u0440\u043E\u0434\u0430\u0442\u044C SHIB \u043F\u043E $30."
  },
  "om-shib-2": {
    title: "\u0424\u043B\u0435\u0448-\u043A\u0440\u044D\u0448 SHIB",
    flavor: "\u041A\u0438\u0442 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u043F\u043E \u0440\u044B\u043D\u043A\u0443 \u0432 \u0442\u043E\u043D\u043A\u0438\u0439 \u0441\u0442\u0430\u043A\u0430\u043D. SHIB \u043F\u043E $2 \u2014 \u043F\u0440\u043E\u0434\u0430\u0432\u0430\u0439\u0442\u0435, \u0435\u0441\u043B\u0438 \u043D\u0430\u0434\u043E."
  },
  "om-pepe-25": {
    title: "PEPE \u043D\u0430 \u0432\u0435\u0440\u0448\u0438\u043D\u0435",
    flavor: "\u0420\u0435\u0434\u0447\u0430\u0439\u0448\u0438\u0439 \u0431\u044B\u0447\u0438\u0439 \u0440\u044B\u043D\u043E\u043A. \u041A\u0430\u0436\u0434\u044B\u0439 \u043C\u043E\u0436\u0435\u0442 \u043F\u0440\u043E\u0434\u0430\u0442\u044C PEPE \u043F\u043E $25."
  },
  "om-doge-40": {
    title: "\u0420\u0435\u043A\u043E\u0440\u0434 DOGE",
    flavor: "\u041F\u0435\u0440\u0432\u044B\u0439 \u043C\u0435\u043C \u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442 \u043D\u043E\u0432\u044B\u0439 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C. DOGE \u043A\u043E\u0442\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043F\u043E $40."
  },
  "om-bonk-20": {
    title: "\u041F\u0440\u043E\u0440\u044B\u0432 BONK",
    flavor: "\u041B\u0438\u0441\u0442\u0438\u043D\u0433\u0438 \u0432\u0435\u0437\u0434\u0435 \u0438 \u0441\u0440\u0430\u0437\u0443. BONK \u043A\u043E\u0442\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043F\u043E $20."
  },
  "om-wif-35": {
    title: "\u0418\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C WIF",
    flavor: "\u0428\u0430\u043F\u043A\u0430 \u0443\u0436\u0435 \u0432 \u0446\u0435\u043D\u0435. WIF \u043A\u043E\u0442\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043F\u043E $35."
  },
  "om-air-shib": {
    title: "\u0410\u0438\u0440\u0434\u0440\u043E\u043F \u0434\u0435\u0440\u0436\u0430\u0442\u0435\u043B\u044F\u043C SHIB",
    flavor: "\u041F\u0440\u0438\u043B\u0435\u0442\u0430\u0435\u0442 \u0430\u0438\u0440\u0434\u0440\u043E\u043F \u0437\u0430 \u043B\u043E\u044F\u043B\u044C\u043D\u043E\u0441\u0442\u044C: \u0432\u0430\u0448 \u043C\u0435\u0448\u043E\u043A SHIB \u0443\u0434\u0432\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F."
  },
  "om-air-bonk": {
    title: "\u041A\u043E\u043C\u044C\u044E\u043D\u0438\u0442\u0438-\u0430\u0438\u0440\u0434\u0440\u043E\u043F BONK",
    flavor: "\u0420\u0430\u0443\u043D\u0434 \u0434\u043B\u044F \u043A\u043E\u043C\u044C\u044E\u043D\u0438\u0442\u0438 \u043F\u043B\u0430\u0442\u0438\u0442 \u0434\u0435\u0440\u0436\u0430\u0442\u0435\u043B\u044F\u043C: \u0432\u0430\u0448 BONK \u0443\u0434\u0432\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F."
  },
  "om-air-doge": {
    title: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u043E\u0442 \u0442\u0438\u043F-\u0431\u043E\u0442\u0430 DOGE",
    flavor: "\u0414\u0440\u0435\u0432\u043D\u0438\u0439 \u0442\u0438\u043F-\u0431\u043E\u0442 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0432\u0441\u0435\u043C \u043C\u043E\u043D\u0435\u0442\u044B: \u0432\u0430\u0448 DOGE \u0443\u0434\u0432\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F."
  },
  "om-mig-pepe": {
    title: "\u041C\u0438\u0433\u0440\u0430\u0446\u0438\u044F PEPE v2",
    flavor: "\u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442 \u043C\u0438\u0433\u0440\u0438\u0440\u0443\u0435\u0442 1 \u043A 2, \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u0436\u0438\u0433\u0430\u0435\u0442\u0441\u044F. \u0412\u0430\u0448 PEPE \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442\u0441\u044F \u0432\u0434\u0432\u043E\u0435."
  },
  "om-wind-wallet": {
    title: "\u041D\u0430\u0439\u0434\u0435\u043D \u0437\u0430\u0431\u044B\u0442\u044B\u0439 \u043A\u043E\u0448\u0435\u043B\u0451\u043A",
    flavor: "\u0421\u0442\u0430\u0440\u0430\u044F \u0441\u0438\u0434-\u0444\u0440\u0430\u0437\u0430 \u043D\u0430\u043A\u043E\u043D\u0435\u0446 \u043F\u043E\u0434\u043E\u0448\u043B\u0430. \u041A\u0430\u0436\u0434\u044B\u0439 \u0438\u0433\u0440\u043E\u043A \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 $500."
  },
  "om-wind-rents": {
    title: "\u0417\u0430\u0440\u0443\u0431\u0435\u0436\u043D\u0443\u044E \u0430\u0440\u0435\u043D\u0434\u0443 \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u043B\u0438 \u0432\u0432\u0435\u0440\u0445",
    flavor: "\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0435 \u043E\u0442\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043E \u0440\u043E\u0441\u0442\u0435 \u0430\u0440\u0435\u043D\u0434\u044B: \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 $250 \u0437\u0430 \u043A\u0430\u0436\u0434\u0443\u044E \u043D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C."
  },
  "os-mvd-1": {
    title: "\u0421\u0442\u0443\u0434\u0438\u044F \u0432 \u041F\u043E\u0441\u0438\u0442\u043E\u0441\u0435, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0414\u0432\u0430 \u043A\u0432\u0430\u0440\u0442\u0430\u043B\u0430 \u043E\u0442 \u0420\u0430\u043C\u0431\u043B\u044B; \u043C\u0435\u0434\u0441\u0451\u0441\u0442\u0440\u044B \u0438 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u044B \u0434\u0435\u043B\u044F\u0442 \u0430\u0440\u0435\u043D\u0434\u0443."
  },
  "os-mvd-2": {
    title: "\u041B\u043E\u0444\u0442 \u0432 \u0421\u044C\u044E\u0434\u0430\u0434-\u0412\u044C\u0435\u0445\u0430, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u041A\u043E\u043B\u043E\u043D\u0438\u0430\u043B\u044C\u043D\u044B\u0435 \u0431\u0430\u043B\u043A\u0438, \u043F\u043E\u0440\u0442\u043E\u0432\u044B\u0435 \u043A\u0440\u0430\u043D\u044B \u0432 \u043E\u043A\u043D\u0435, \u0440\u044B\u043D\u043A\u0438 \u043F\u043E \u0432\u044B\u0445\u043E\u0434\u043D\u044B\u043C \u0432\u043D\u0438\u0437\u0443."
  },
  "os-mvd-3": {
    title: "\u0421\u0442\u0443\u0434\u0435\u043D\u0447\u0435\u0441\u043A\u0430\u044F \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0432 \u041A\u043E\u0440\u0434\u043E\u043D\u0435, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0422\u0440\u0438 \u0443\u043D\u0438\u0432\u0435\u0440\u0441\u0438\u0442\u0435\u0442\u0430 \u043F\u0435\u0448\u043A\u043E\u043C; \u0430\u0440\u0435\u043D\u0434\u0430 \u043D\u0435 \u043F\u0440\u0435\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F."
  },
  "os-mvd-4": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0441 \u0441\u0430\u0434\u043E\u043C \u0432 \u041A\u0430\u0440\u0440\u0430\u0441\u043A\u043E, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u041F\u043E\u0441\u043E\u043B\u044C\u0441\u043A\u0438\u0435 \u0443\u043B\u0438\u0446\u044B \u0432 \u0442\u0435\u043D\u0438 \u0434\u0435\u0440\u0435\u0432\u044C\u0435\u0432; \u043A\u043E\u0440\u043F\u043E\u0440\u0430\u0442\u0438\u0432\u043D\u044B\u0435 \u0436\u0438\u043B\u044C\u0446\u044B \u043F\u043B\u0430\u0442\u044F\u0442 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0447\u0438\u0441\u043B\u0430."
  },
  "os-mvd-5": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u0432\u043E\u043A\u0437\u0430\u043B\u0430 \u0422\u0440\u0435\u0441-\u041A\u0440\u0443\u0441\u0435\u0441, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0412\u0441\u0435 \u043C\u0435\u0436\u0434\u0443\u0433\u043E\u0440\u043E\u0434\u043D\u0438\u0435 \u0430\u0432\u0442\u043E\u0431\u0443\u0441\u044B \u043E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u0432\u043D\u0438\u0437\u0443; \u044D\u043A\u0438\u043F\u0430\u0436\u0430\u043C \u043D\u0443\u0436\u043D\u044B \u043A\u0440\u043E\u0432\u0430\u0442\u0438, \u0430 \u043D\u0435 \u0431\u0430\u043B\u043A\u043E\u043D\u044B."
  },
  "os-mvd-6": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0432 \u0431\u0430\u0448\u043D\u0435 \u041F\u0443\u043D\u0442\u0430-\u041A\u0430\u0440\u0440\u0435\u0442\u0430\u0441, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0412\u0438\u0434 \u043D\u0430 \u043C\u043E\u043B\u043B \u0438 \u043A\u0440\u0435\u043F\u043E\u0441\u0442\u044C; \u0431\u0430\u0448\u043D\u044F \u0432\u044B\u0440\u043E\u0441\u043B\u0430 \u0431\u044B\u0441\u0442\u0440\u0435\u0435 \u0436\u0438\u043B\u044C\u0446\u043E\u0432."
  },
  "os-mvd-7": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430-\u043F\u0435\u0448\u0435\u0445\u043E\u0434\u043A\u0430 \u0432 \u041F\u0430\u043B\u0435\u0440\u043C\u043E, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0422\u0435\u0440\u0440\u0430\u0441\u044B \u043A\u0430\u0444\u0435 \u0432\u043D\u0438\u0437\u0443, \u0444\u0430\u0441\u0430\u0434\u044B \u0430\u0440-\u0434\u0435\u043A\u043E \u043D\u0430\u0432\u0435\u0440\u0445\u0443; \u043C\u043E\u043B\u043E\u0434\u044B\u0435 \u0441\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442\u044B \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438."
  },
  "os-mvd-8": {
    title: "\u0428\u043E\u043F\u0445\u0430\u0443\u0441 \u0432 \u0426\u0435\u043D\u0442\u0440\u043E, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u041D\u0430\u0434 \u043F\u0435\u0448\u0435\u0445\u043E\u0434\u043D\u043E\u0439 \u0410\u0432\u0435\u043D\u0438\u0434\u0430 18; \u043E\u0431\u0435\u0434\u0435\u043D\u043D\u044B\u0435 \u0442\u043E\u043B\u043F\u044B \u043D\u0435 \u0434\u0430\u044E\u0442 \u0443\u043B\u0438\u0446\u0435 \u0437\u0430\u043C\u043E\u043B\u0447\u0430\u0442\u044C."
  },
  "os-mvd-9": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u043C\u043E\u0440\u044F \u0432 \u041C\u0430\u043B\u044C\u0432\u0438\u043D\u0435, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0417\u0430\u043A\u0430\u0442\u044B \u043D\u0430 \u0420\u0430\u043C\u0431\u043B\u0435 \u0438 \u0442\u0438\u0445\u0438\u0435 \u0431\u0443\u0434\u043D\u0438; \u0441\u0435\u043C\u044C\u0438 \u043F\u0440\u043E\u0434\u043B\u0435\u0432\u0430\u044E\u0442 \u043A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0434."
  },
  "os-mvd-10": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0441 \u0432\u0438\u0434\u043E\u043C \u043D\u0430 \u043F\u0430\u0440\u043A \u041F\u0440\u0430\u0434\u043E, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u041C\u0443\u0437\u0435\u0438 \u0438 \u0440\u043E\u0437\u0430\u0440\u0438\u0438 \u0437\u0430 \u0434\u0432\u0435\u0440\u044C\u044E; \u043F\u0435\u043D\u0441\u0438\u043E\u043D\u0435\u0440\u044B \u043D\u0435 \u0443\u0435\u0437\u0436\u0430\u044E\u0442."
  },
  "os-pde-1": {
    title: "\u0421\u0442\u0443\u0434\u0438\u044F \u043D\u0430 \u041F\u043E\u043B\u0443\u043E\u0441\u0442\u0440\u043E\u0432\u0435, \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435",
    flavor: "\u041C\u0435\u0436\u0434\u0443 \u043F\u043B\u044F\u0436\u0430\u043C\u0438 \u0411\u0440\u0430\u0432\u0430 \u0438 \u041C\u0430\u043D\u0441\u0430; \u044F\u043D\u0432\u0430\u0440\u044C \u0431\u0440\u043E\u043D\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u0441\u0430\u043C."
  },
  "os-pde-2": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u043D\u0430 \u0413\u043E\u0440\u043B\u0435\u0440\u043E, \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435",
    flavor: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F \u043F\u043E\u043B\u043E\u0441\u0430 \u043D\u043E\u0447\u043D\u043E\u0439 \u0436\u0438\u0437\u043D\u0438 \u0432\u043D\u0438\u0437\u0443; \u043B\u0435\u0442\u043D\u0438\u0435 \u0441\u0442\u0430\u0432\u043A\u0438 \u0431\u044C\u044E\u0442 \u0433\u043E\u0434\u043E\u0432\u044B\u0435."
  },
  "os-pde-3": {
    title: "\u041A\u043E\u043D\u0434\u043E \u0441 \u0432\u0438\u0434\u043E\u043C \u043D\u0430 \u041B\u0430-\u041C\u0430\u043D\u0441\u0430",
    flavor: "\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u0430\u044F \u0441\u0442\u043E\u0440\u043E\u043D\u0430 \u0432\u043E\u0434\u044B; \u0441\u0435\u043C\u044C\u0438 \u0438\u0437 \u0411\u0443\u044D\u043D\u043E\u0441-\u0410\u0439\u0440\u0435\u0441\u0430 \u0437\u0430\u043F\u043E\u043B\u043D\u044F\u044E\u0442 \u0434\u0435\u043A\u0430\u0431\u0440\u044C."
  },
  "os-pde-4": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0432 \u0431\u0430\u0448\u043D\u0435 \u0411\u0440\u0430\u0432\u0430, \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435",
    flavor: "\u0421\u0451\u0440\u0444 \u0438 \u0432\u0435\u0442\u0435\u0440; \u0442\u0440\u0438 \u043D\u043E\u0432\u044B\u0435 \u0431\u0430\u0448\u043D\u0438 \u043F\u043E\u0433\u043D\u0430\u043B\u0438\u0441\u044C \u0437\u0430 \u043E\u0434\u043D\u0438\u043C \u0432\u0438\u0434\u043E\u043C \u2014 \u0432\u0430\u0448\u0430 \u0436\u0434\u0451\u0442 \u0436\u0438\u043B\u044C\u0446\u0430."
  },
  "os-pde-5": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u042D\u0439\u0434\u0438-\u0413\u0440\u0438\u043B\u043B, \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435",
    flavor: "\u0420\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u043D\u044B\u0439 \u0440\u044F\u0434 \u0443 \u043F\u043E\u0434\u044A\u0435\u0437\u0434\u0430; \u043F\u043E\u0432\u0430\u0440\u0430 \u0438 \u043E\u0444\u0438\u0446\u0438\u0430\u043D\u0442\u044B \u0434\u0435\u043B\u044F\u0442 \u0434\u043E\u043C."
  },
  "os-pde-6": {
    title: "\u041A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0443 \u043F\u0430\u0440\u043A\u0430 \u0421\u0430\u043D-\u0420\u0430\u0444\u0430\u044D\u043B\u044C, \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435",
    flavor: "\u0413\u043E\u043B\u044C\u0444 \u0438 \u0441\u043E\u0441\u043D\u044B; \u0437\u0438\u043C\u043E\u0439 \u0442\u0438\u0445\u043E, \u043B\u0435\u0442\u043E\u043C \u2014 \u0430\u043D\u0448\u043B\u0430\u0433."
  },
  "os-pde-7": {
    title: "\u041B\u043E\u0444\u0442 \u0432 \u041B\u0430-\u0411\u0430\u0440\u0440\u0430, \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435",
    flavor: "\u041C\u043E\u0441\u0442 \u0438 \u043F\u043B\u044F\u0436\u043D\u044B\u0435 \u043A\u043B\u0443\u0431\u044B; \u0430\u0440\u0442\u0438\u0441\u0442\u044B \u0438 \u0438\u043D\u0444\u043B\u044E\u0435\u043D\u0441\u0435\u0440\u044B \u043F\u043B\u0430\u0442\u044F\u0442 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u043E."
  },
  "os-pde-8": {
    title: "\u0421\u0442\u0443\u0434\u0438\u044F \u043D\u0430 \u0443\u0442\u0451\u0441\u0435 \u041F\u0443\u043D\u0442\u0430-\u0411\u0430\u043B\u044C\u0435\u043D\u0430",
    flavor: "\u0421\u0438\u043B\u0443\u044D\u0442 \u041A\u0430\u0441\u0430\u043F\u0443\u044D\u0431\u043B\u043E \u0432 \u043E\u043A\u043D\u0435; \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u043E\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u0442 \u0410\u0442\u043B\u0430\u043D\u0442\u0438\u043A\u0430."
  },
  "os-vil-1": {
    title: "\u041F\u043B\u044F\u0436\u043D\u044B\u0439 \u043A\u043E\u0442\u0442\u0435\u0434\u0436 \u0432 \u041B\u0430-\u0411\u0430\u0440\u0440\u0430",
    flavor: "\u0422\u0435\u043D\u044C \u044D\u0432\u043A\u0430\u043B\u0438\u043F\u0442\u043E\u0432, \u043F\u0435\u0441\u043E\u043A \u0432 \u043A\u043E\u0440\u0438\u0434\u043E\u0440\u0435, \u044F\u043D\u0432\u0430\u0440\u044C \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D."
  },
  "os-vil-2": {
    title: "\u0414\u043E\u043C \u0441 \u0441\u0430\u0434\u043E\u043C \u0432 \u041A\u0430\u043D\u0442\u0435\u0433\u0440\u0438\u043B\u0435",
    flavor: "\u0427\u043B\u0435\u043D\u0441\u0442\u0432\u043E \u0432 \u043A\u043B\u0443\u0431\u0435 \u043F\u043E \u0441\u043E\u0441\u0435\u0434\u0441\u0442\u0432\u0443 \u0441\u0430\u043C\u043E \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0430\u0434\u0440\u0435\u0441."
  },
  "os-vil-3": {
    title: "\u0414\u0430\u0447\u0430 \u0432 \u041C\u0430\u043D\u0430\u043D\u0442\u044C\u044F\u043B\u0435\u0441\u0435",
    flavor: "\u041D\u0430 \u043F\u043E\u043B\u043F\u0443\u0442\u0438 \u043A \u0425\u043E\u0441\u0435-\u0418\u0433\u043D\u0430\u0441\u0438\u043E; \u0442\u0440\u043E\u043F\u0430 \u043A \u043F\u043B\u044F\u0436\u0443 \u2014 \u0433\u043B\u0430\u0432\u043D\u043E\u0435 \u0443\u0434\u043E\u0431\u0441\u0442\u0432\u043E."
  },
  "os-vil-4": {
    title: "\u0414\u043E\u043C \u043D\u0430 \u0441\u043E\u0441\u043D\u043E\u0432\u043E\u043C \u0443\u0447\u0430\u0441\u0442\u043A\u0435, \u041F\u0438\u043D\u0430\u0440\u0435\u0441",
    flavor: "\u0422\u0438\u0445\u0438\u0435 \u0441\u043E\u0441\u043D\u044B, \u043A\u043E\u0440\u043E\u0442\u043A\u0430\u044F \u0434\u043E\u0440\u043E\u0433\u0430 \u043A \u0411\u0440\u0430\u0432\u0435; \u0437\u0438\u043C\u043D\u0438\u0439 CF \u2014 \u043D\u0430\u0434\u0435\u0436\u0434\u0430, \u0430 \u043D\u0435 \u043F\u043B\u0430\u043D."
  },
  "os-land-1": {
    title: "5 \u0433\u0430 \u043F\u0430\u0441\u0442\u0431\u0438\u0449\u0430, \u041A\u043E\u043B\u043E\u043D\u0438\u044F",
    flavor: "\u0417\u0435\u043B\u0451\u043D\u044B\u0435 \u0441\u0442\u043E\u043B\u0431\u044B \u0438 \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442. \u041C\u043E\u043B\u043E\u043A\u043E\u0432\u043E\u0437\u044B \u043F\u0440\u043E\u0435\u0437\u0436\u0430\u044E\u0442 \u0434\u0432\u0430\u0436\u0434\u044B \u0432 \u0434\u0435\u043D\u044C."
  },
  "os-land-2": {
    title: "10 \u0433\u0430 \u0443 \u0420\u0443\u0442\u044B 5, \u0424\u043B\u043E\u0440\u0438\u0434\u0430",
    flavor: "\u0410\u0441\u0444\u0430\u043B\u044C\u0442 \u043C\u043E\u043B\u043E\u0447\u043D\u043E\u0433\u043E \u043A\u0440\u0430\u044F \u0434\u043E\u0448\u0451\u043B \u0434\u043E \u044D\u0442\u043E\u0433\u043E \u043A\u0438\u043B\u043E\u043C\u0435\u0442\u0440\u0430 \u0432 \u043F\u0440\u043E\u0448\u043B\u043E\u043C \u0433\u043E\u0434\u0443."
  },
  "os-land-3": {
    title: "\u041F\u0440\u0438\u0431\u0440\u0435\u0436\u043D\u044B\u0439 \u0443\u0447\u0430\u0441\u0442\u043E\u043A, \u0420\u043E\u0447\u0430",
    flavor: "\u0414\u044E\u043D\u044B \u0438 \u0432\u0435\u0442\u0435\u0440; \u043F\u043B\u044F\u0436\u043D\u044B\u0435 \u0434\u043E\u043C\u0438\u043A\u0438 \u043F\u043E\u0434\u0431\u0438\u0440\u0430\u044E\u0442\u0441\u044F \u043A\u0430\u0436\u0434\u043E\u0435 \u043B\u0435\u0442\u043E."
  },
  "os-land-4": {
    title: "20 \u0433\u0430 \u0431\u0435\u0437 \u0434\u043E\u0440\u043E\u0433\u0438, \u0422\u0430\u043A\u0443\u0430\u0440\u0435\u043C\u0431\u043E",
    flavor: "\u0426\u0435\u043D\u0430 \u043F\u043E \u043A\u0430\u0440\u0442\u0435, \u0430 \u043D\u0435 \u043F\u043E \u0433\u0440\u044F\u0437\u0438."
  },
  "os-land-5": {
    title: "\u0423\u0433\u043E\u043B \u0446\u0438\u0442\u0440\u0443\u0441\u043E\u0432\u043E\u0433\u043E \u0441\u0430\u0434\u0430, \u0421\u0430\u043B\u044C\u0442\u043E",
    flavor: "\u0410\u043F\u0435\u043B\u044C\u0441\u0438\u043D\u043E\u0432\u044B\u0435 \u0440\u043E\u0449\u0438 \u0438 \u0442\u0443\u0440\u0438\u0437\u043C \u043A \u0433\u043E\u0440\u044F\u0447\u0438\u043C \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430\u043C \u0434\u0435\u043B\u044F\u0442 \u0434\u043E\u043B\u0438\u043D\u0443."
  },
  "os-land-6": {
    title: "\u041F\u0440\u0438\u0433\u0440\u0430\u043D\u0438\u0447\u043D\u044B\u0439 \u0443\u0447\u0430\u0441\u0442\u043E\u043A, \u0420\u0438\u0432\u0435\u0440\u0430",
    flavor: "\u0422\u0440\u0430\u0444\u0438\u043A free-shop \u0441\u0442\u0430\u0432\u0438\u0442 \u043C\u0430\u0448\u0438\u043D\u044B \u043D\u0430 \u043B\u044E\u0431\u0443\u044E \u0440\u043E\u0432\u043D\u0443\u044E \u043F\u043B\u043E\u0449\u0430\u0434\u043A\u0443."
  },
  "os-land-7": {
    title: "\u0413\u0435\u043A\u0442\u0430\u0440 \u043D\u0430 \u0441\u043A\u043B\u043E\u043D\u0435, \u041C\u0430\u043B\u044C\u0434\u043E\u043D\u0430\u0434\u043E",
    flavor: "\u041D\u043E\u0447\u044C\u044E \u043D\u0430 \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442\u0435 \u0441\u0432\u0435\u0442\u044F\u0442\u0441\u044F \u043E\u0433\u043D\u0438 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "os-land-8": {
    title: "\u0423\u0447\u0430\u0441\u0442\u043E\u043A \u0443 \u043B\u0430\u0433\u0443\u043D\u044B, \u041A\u0430\u0441\u0442\u0438\u043B\u044C\u043E\u0441",
    flavor: "\u041D\u0430\u0431\u043B\u044E\u0434\u0430\u0442\u0435\u043B\u0438 \u0437\u0430 \u043F\u0442\u0438\u0446\u0430\u043C\u0438 \u0443\u0436\u0435 \u0437\u043D\u0430\u044E\u0442 \u043F\u043E\u0434\u044A\u0435\u0437\u0434\u043D\u0443\u044E \u0442\u0440\u043E\u043F\u0443."
  },
  "os-dair-1": {
    title: "\u0421\u0442\u0430\u0440\u0442\u043E\u0432\u043E\u0435 \u0441\u0442\u0430\u0434\u043E \u043D\u0430 20 \u043A\u043E\u0440\u043E\u0432, \u0421\u0430\u043D-\u0425\u043E\u0441\u0435",
    flavor: "\u0421\u043E\u0441\u0435\u0434 \u0434\u043E\u0438\u0442; \u0432\u044B \u043A\u043B\u0430\u0434\u0451\u0442\u0435 \u0447\u0435\u043A \u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u0430 \u0432 \u0431\u0430\u043D\u043A."
  },
  "os-dair-2": {
    title: "\u041F\u043B\u043E\u0449\u0430\u0434\u043A\u0430 \u0442\u0451\u043B\u043E\u043A, \u041A\u0430\u043D\u0435\u043B\u043E\u043D\u0435\u0441",
    flavor: "\u041C\u043E\u043B\u043E\u0434\u043D\u044F\u043A \u0440\u0430\u0441\u0442\u0451\u0442 \u0432 \u0434\u043E\u0439\u043D\u043E\u0435 \u0441\u0442\u0430\u0434\u043E; \u0441\u0438\u043B\u043E\u0441 \u0443\u0436\u0435 \u043E\u043F\u043B\u0430\u0447\u0435\u043D."
  },
  "os-dair-3": {
    title: "\u041C\u043E\u043B\u043E\u0447\u043D\u044B\u0439 \u0441\u0430\u0440\u0430\u0439 \u0432 \u0434\u043E\u043B\u0435, \u0424\u043B\u043E\u0440\u0438\u0434\u0430",
    flavor: "\u041F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u0442\u0430\u043D\u043A\u0430 \u2014 Conaprole; \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u0430\u0440\u0435\u043D\u0434\u044B \u2014 \u0432\u0430\u043C."
  },
  "os-dair-4": {
    title: "\u0410\u0440\u0435\u043D\u0434\u0430 \u043F\u0430\u0441\u0442\u0431\u0438\u0449\u0430 \u043D\u0430 40 \u0433\u043E\u043B\u043E\u0432, \u041A\u043E\u043B\u043E\u043D\u0438\u044F",
    flavor: "\u0414\u043E\u0433\u043E\u0432\u043E\u0440 \u0434\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0432\u0435\u0441\u043D\u044B; \u043A\u043E\u0440\u043E\u0432\u044B \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u043D\u0430 \u043C\u0435\u0441\u0442\u0435."
  },
  "os-dair-5": {
    title: "\u0421\u044B\u0440\u043E\u0432\u0430\u0440\u043D\u044F-\u043A\u043E\u0442\u0442\u0435\u0434\u0436, \u041A\u043E\u043B\u043E\u043D\u0438\u044F",
    flavor: "\u0422\u0443\u0440\u0438\u0441\u0442\u044B \u043F\u043E\u043A\u0443\u043F\u0430\u044E\u0442 \u043A\u0440\u0443\u0433\u0438 \u0443 \u0432\u043E\u0440\u043E\u0442; \u043C\u043E\u043B\u043E\u043A\u043E \u043D\u0435 \u043F\u043E\u043A\u0438\u0434\u0430\u0435\u0442 \u0444\u0435\u0440\u043C\u0443."
  },
  "os-dair-6": {
    title: "\u0417\u0430\u0433\u043E\u043D\u044B \u0441\u0443\u0445\u043E\u0441\u0442\u043E\u0439\u043D\u044B\u0445 \u043A\u043E\u0440\u043E\u0432, \u0414\u0443\u0440\u0430\u0441\u043D\u043E",
    flavor: "\u041F\u043E\u043A\u0430 \u043D\u0435 \u0434\u043E\u044F\u0442 \u2014 \u043D\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043E\u0442\u0451\u043B \u0443\u0436\u0435 \u043F\u0440\u043E\u0434\u0430\u043D \u0432\u043F\u0435\u0440\u0451\u0434."
  },
  "ob-mvd-1": {
    title: "\u0428\u0435\u0441\u0442\u044C \u043A\u0432\u0430\u0440\u0442\u0438\u0440 \u0432 \u041A\u043E\u0440\u0434\u043E\u043D\u0435",
    flavor: "\u0421\u0442\u0443\u0434\u0435\u043D\u0447\u0435\u0441\u043A\u0438\u0435 \u043A\u0430\u0444\u0435 \u0432\u043D\u0438\u0437\u0443 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u044E\u0442 \u0430\u0440\u0435\u043D\u0434\u0443 \u043A\u0430\u0436\u0434\u044B\u0439 \u0441\u0435\u043C\u0435\u0441\u0442\u0440."
  },
  "ob-mvd-2": {
    title: "\u0411\u0443\u0442\u0438\u043A-\u0431\u043B\u043E\u043A \u0432 \u0421\u044C\u044E\u0434\u0430\u0434-\u0412\u044C\u0435\u0445\u0430",
    flavor: "\u0414\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u043A\u043B\u044E\u0447\u0435\u0439 \u043D\u0430\u0434 \u043F\u043E\u0440\u0442\u043E\u0432\u044B\u043C \u0440\u044B\u043D\u043A\u043E\u043C, \u043E\u0434\u0438\u043D \u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435\u043B\u044C \u0432\u043D\u0438\u0437\u0443."
  },
  "ob-mvd-3": {
    title: "\u0421\u0435\u0440\u0432\u0438\u0441\u043D\u044B\u0439 \u044D\u0442\u0430\u0436 \u0432 \u041F\u043E\u0441\u0438\u0442\u043E\u0441\u0435",
    flavor: "\u0412\u043E\u0441\u0435\u043C\u044C \u043C\u0435\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u043A\u0432\u0430\u0440\u0442\u0438\u0440 \u0446\u0435\u043B\u0438\u043A\u043E\u043C \u0432 \u0430\u0440\u0435\u043D\u0434\u0435 \u0443 IT-\u043A\u0430\u043C\u043F\u0443\u0441\u0430."
  },
  "ob-mvd-4": {
    title: "\u0411\u0443\u0442\u0438\u043A-\u0431\u043B\u043E\u043A \u043D\u0430 \u0420\u0430\u043C\u0431\u043B\u0435, \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0410\u0440\u0435\u043D\u0434\u0430 \u043D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u043E\u0439 \u0441\u0430\u043C\u0430 \u043F\u043E\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0438\u043F\u043E\u0442\u0435\u043A\u0443 \u0432 \u043B\u0435\u0442\u043D\u0438\u0435 \u0432\u044B\u0445\u043E\u0434\u043D\u044B\u0435."
  },
  "ob-mvd-5": {
    title: "\u0412\u043E\u0441\u0435\u043C\u044C \u043A\u0432\u0430\u0440\u0442\u0438\u0440 \u0432 \u041F\u0430\u043B\u0435\u0440\u043C\u043E",
    flavor: "\u0427\u0435\u0440\u0435\u0437 \u0434\u043E\u0440\u043E\u0433\u0443 \u043D\u043E\u0432\u044B\u0439 \u043A\u043E\u0432\u043E\u0440\u043A\u0438\u043D\u0433; \u0443\u0436\u0435 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F \u043B\u0438\u0441\u0442 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u044F."
  },
  "ob-mvd-6": {
    title: "\u042D\u0442\u0430\u0436 \u0431\u0430\u0448\u043D\u0438 \u0432 \u041F\u0443\u043D\u0442\u0430-\u041A\u0430\u0440\u0440\u0435\u0442\u0430\u0441",
    flavor: "\u0420\u0430\u0439\u043E\u043D \u043C\u043E\u043B\u043B\u0430 \u043F\u0435\u0440\u0435\u0441\u0442\u0440\u043E\u0438\u043B\u0441\u044F; \u0441\u043A\u0438\u0434\u043A\u0430 \u2014 \u043D\u0435\u0442."
  },
  "ob-mvd-7": {
    title: "\u041F\u043E\u0441\u043E\u043B\u044C\u0441\u043A\u0438\u0439 \u0431\u043B\u043E\u043A \u0432 \u041A\u0430\u0440\u0440\u0430\u0441\u043A\u043E",
    flavor: "\u0414\u0438\u043F\u043B\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0430\u0440\u0435\u043D\u0434\u0430: \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E, \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0447\u0438\u0441\u043B\u0430."
  },
  "ob-mvd-8": {
    title: "\u0411\u043B\u043E\u043A \u0443 \u0430\u044D\u0440\u043E\u043F\u043E\u0440\u0442\u0430 \u041A\u0430\u0440\u0440\u0430\u0441\u043A\u043E",
    flavor: "\u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u044B \u0441 \u044D\u043A\u0438\u043F\u0430\u0436\u0430\u043C\u0438 \u0434\u0432\u0443\u0445 \u0430\u0432\u0438\u0430\u043B\u0438\u043D\u0438\u0439 \u043D\u0430 \u0442\u0440\u0438 \u0433\u043E\u0434\u0430."
  },
  "ob-mvd-9": {
    title: "\u0421\u0442\u0443\u0434\u0435\u043D\u0447\u0435\u0441\u043A\u0438\u0439 \u0431\u043B\u043E\u043A \u0443 Udelar",
    flavor: "\u0414\u0432\u0430 \u043A\u0430\u043C\u043F\u0443\u0441\u0430 \u043D\u0430 \u0440\u0430\u0441\u0441\u0442\u043E\u044F\u043D\u0438\u0438 \u0430\u0432\u0442\u043E\u0431\u0443\u0441\u0430; \u043F\u0443\u0441\u0442\u044B\u0445 \u043A\u043E\u043C\u043D\u0430\u0442 \u043D\u0435 \u0431\u044B\u0432\u0430\u0435\u0442."
  },
  "ob-mvd-10": {
    title: "\u0418\u0441\u0442\u043E\u0440\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u044D\u0442\u0430\u0436 \u0443 \u043F\u043B\u043E\u0449\u0430\u0434\u0438 \u0418\u043D\u0434\u0435\u043F\u0435\u043D\u0434\u0435\u043D\u0441\u0438\u044F",
    flavor: "\u0428\u0435\u0441\u0442\u044C \u043A\u0432\u0430\u0440\u0442\u0438\u0440 \u0432\u0434\u043E\u043B\u044C \u043A\u043E\u043B\u043E\u043D\u0438\u0430\u043B\u044C\u043D\u043E\u0439 \u0430\u0440\u043A\u0430\u0434\u044B \u043B\u0438\u0446\u043E\u043C \u043A \u043F\u043B\u043E\u0449\u0430\u0434\u0438."
  },
  "ob-mvd-11": {
    title: "\u042D\u0442\u0430\u0436 \u0443 \u043C\u043E\u0440\u044F \u0432 \u041C\u0430\u043B\u044C\u0432\u0438\u043D\u0435",
    flavor: "\u041D\u0430 \u0440\u0430\u0441\u0441\u0432\u0435\u0442\u0435 \u2014 \u0431\u0435\u0433\u0443\u043D\u044B \u043F\u043E \u0420\u0430\u043C\u0431\u043B\u0435, \u0432 \u0441\u0443\u043C\u0435\u0440\u043A\u0430\u0445 \u2014 \u043E\u0433\u043D\u0438 \u0441\u043A\u0430\u0439\u043B\u0430\u0439\u043D\u0430."
  },
  "ob-pde-1": {
    title: "\u0421\u0435\u0440\u0432\u0438\u0441\u043D\u044B\u0439 \u044D\u0442\u0430\u0436 \u043D\u0430 \u0413\u043E\u0440\u043B\u0435\u0440\u043E",
    flavor: "\u0428\u0435\u0441\u0442\u044C \u043B\u044E\u043A\u0441\u043E\u0432 \u043D\u0430\u0434 \u0442\u043E\u0440\u0433\u043E\u0432\u043E\u0439 \u043F\u043E\u043B\u043E\u0441\u043E\u0439; \u044F\u043D\u0432\u0430\u0440\u044C \u043D\u0435 \u0443\u043C\u043E\u043B\u043A\u0430\u0435\u0442."
  },
  "ob-pde-2": {
    title: "\u042D\u0442\u0430\u0436 \u0431\u0430\u0448\u043D\u0438 \u043D\u0430 \u041F\u043E\u043B\u0443\u043E\u0441\u0442\u0440\u043E\u0432\u0435",
    flavor: "\u0411\u0440\u0430\u0432\u0430 \u0441 \u043E\u0434\u043D\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u044B, \u041C\u0430\u043D\u0441\u0430 \u0441 \u0434\u0440\u0443\u0433\u043E\u0439; \u0432\u0438\u0434 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0441\u0435\u0431\u044F \u0441\u0430\u043C."
  },
  "ob-pde-3": {
    title: "\u041A\u043E\u043D\u0434\u043E-\u0431\u043B\u043E\u043A \u0443 \u042D\u0439\u0434\u0438-\u0413\u0440\u0438\u043B\u043B",
    flavor: "\u0420\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u043D\u044B\u0439 \u0440\u044F\u0434 \u0438 \u0432\u044B\u0445\u043E\u0434 \u043A \u043F\u043B\u044F\u0436\u0443; \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0440\u043F\u043E\u0440\u0430\u0442\u0438\u0432\u043D\u0430\u044F \u043B\u0435\u0442\u043D\u044F\u044F \u0430\u0440\u0435\u043D\u0434\u0430."
  },
  "ob-pde-4": {
    title: "\u042D\u0442\u0430\u0436 \u043F\u0435\u0440\u0435\u0438\u0437\u0431\u044B\u0442\u043A\u0430 \u043D\u0430 \u0411\u0440\u0430\u0432\u0435",
    flavor: "\u0411\u0430\u0448\u0435\u043D \u0431\u044B\u043B\u043E \u0431\u043E\u043B\u044C\u0448\u0435, \u0447\u0435\u043C \u0436\u0438\u043B\u044C\u0446\u043E\u0432 \u043F\u0440\u043E\u0448\u043B\u043E\u0439 \u0437\u0438\u043C\u043E\u0439; \u0441\u043A\u0438\u0434\u043A\u0430 \u2014 \u0433\u043B\u0430\u0432\u043D\u043E\u0435 \u0443\u0434\u043E\u0431\u0441\u0442\u0432\u043E."
  },
  "ob-pde-5": {
    title: "\u0411\u043B\u043E\u043A \u0432 \u041B\u0430-\u0411\u0430\u0440\u0440\u0430",
    flavor: "\u0428\u0435\u0441\u0442\u044C \u043A\u0432\u0430\u0440\u0442\u0438\u0440 \u043D\u0430\u0434 \u0434\u043E\u0440\u043E\u0433\u043E\u0439 \u043A \u043C\u043E\u0441\u0442\u0443; \u0438\u043D\u0444\u043B\u044E\u0435\u043D\u0441\u0435\u0440\u044B \u043F\u0440\u043E\u0434\u043B\u0435\u0432\u0430\u044E\u0442 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u043E \u0432 \u0441\u0435\u0437\u043E\u043D."
  },
  "ob-pde-6": {
    title: "\u0411\u043B\u043E\u043A \u0443 \u043F\u043B\u044F\u0436\u0430 \u0421\u0430\u043D-\u0420\u0430\u0444\u0430\u044D\u043B\u044C",
    flavor: "\u0413\u043E\u043B\u044C\u0444 \u0438 \u0441\u043E\u0441\u043D\u044B; \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0448\u0442\u0438\u043B\u044C \u043D\u0430\u043A\u043E\u043D\u0435\u0446 \u0438\u043C\u0435\u0435\u0442 \u043A\u0440\u0443\u0433\u043B\u043E\u0433\u043E\u0434\u0438\u0447\u043D\u044B\u0435 \u0431\u0440\u043E\u043D\u0438."
  },
  "ob-pde-7": {
    title: "\u0421\u0435\u0440\u0432\u0438\u0441\u043D\u044B\u0439 \u044D\u0442\u0430\u0436 \u0443 \u043C\u0430\u0440\u0438\u043D\u044B \u041F\u043E\u0440\u0442\u043E",
    flavor: "\u041F\u0440\u0438\u0447\u0430\u043B\u044B \u0432\u043D\u0438\u0437\u0443; \u0443 \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u0447\u043B\u0435\u043D\u0430 \u044F\u0445\u0442-\u043A\u043B\u0443\u0431\u0430 \u043A\u043B\u044E\u0447 \u043D\u0430\u0432\u0435\u0440\u0445\u0443."
  },
  "ob-pde-8": {
    title: "\u0411\u043B\u043E\u043A \u0443 Punta Shopping",
    flavor: "\u041F\u043E\u0442\u043E\u043A \u043C\u043E\u043B\u043B\u0430 \u0437\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u0442 \u043F\u043E\u0441\u0443\u0442\u043E\u0447\u043D\u044B\u0435; \u0437\u0438\u043C\u043E\u0439 \u0432\u0441\u0451 \u0440\u0430\u0432\u043D\u043E \u043D\u0443\u0436\u043D\u0430 \u0441\u043A\u0438\u0434\u043A\u0430."
  },
  "ob-pde-9": {
    title: "\u0421\u0435\u043C\u0435\u0439\u043D\u044B\u0435 \u0431\u0430\u0448\u043D\u0438 \u0443 \u041B\u0430-\u041C\u0430\u043D\u0441\u0430",
    flavor: "\u0421\u043E\u0440\u043E\u043A \u043A\u043E\u0435\u043A \u0432 \u0437\u043E\u043D\u0435 \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u043E\u0439 \u0432\u043E\u0434\u044B \u0438 \u0434\u0432\u0443\u0445 \u0448\u043A\u043E\u043B."
  },
  "ob-pde-10": {
    title: "\u042D\u0442\u0430\u0436 \u043D\u0430 \u0430\u0432\u0435\u043D\u0438\u0434\u0435 \u0420\u0443\u0437\u0432\u0435\u043B\u044C\u0442",
    flavor: "\u0412\u043D\u0438\u0437\u0443 \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u044B, \u043D\u0430\u0432\u0435\u0440\u0445\u0443 \u0441\u0435\u0440\u0432\u0438\u0441\u043D\u044B\u0435 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B, \u043E\u0433\u043D\u0438 \u043A\u0430\u0437\u0438\u043D\u043E \u0434\u0430\u043B\u044C\u0448\u0435 \u043F\u043E \u0434\u043E\u0440\u043E\u0433\u0435."
  },
  "ob-vil-1": {
    title: "\u041F\u043B\u044F\u0436\u043D\u0430\u044F \u0432\u0438\u043B\u043B\u0430 \u0432 \u0425\u043E\u0441\u0435-\u0418\u0433\u043D\u0430\u0441\u0438\u043E",
    flavor: "\u0414\u044E\u043D\u044B, \u0441\u0442\u0435\u043A\u043B\u044F\u043D\u043D\u044B\u0435 \u0441\u0442\u0435\u043D\u044B \u0438 \u043B\u0438\u0441\u0442 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u044F \u044F\u043D\u0432\u0430\u0440\u0441\u043A\u0438\u0445 \u0433\u043E\u0441\u0442\u0435\u0439."
  },
  "ob-vil-2": {
    title: "\u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0441 \u0432 \u041B\u0430-\u0411\u0430\u0440\u0440\u0430",
    flavor: "\u0422\u0440\u0438 \u043A\u043E\u0442\u0442\u0435\u0434\u0436\u0430 \u043D\u0430 \u043E\u0434\u043D\u043E\u043C \u0443\u0447\u0430\u0441\u0442\u043A\u0435; \u0442\u0440\u043E\u043F\u0430 \u043A \u043F\u043B\u044F\u0436\u0443 \u2014 \u0447\u0430\u0441\u0442\u043D\u0430\u044F."
  },
  "ob-vil-3": {
    title: "\u0423\u0441\u0430\u0434\u0435\u0431\u043D\u0430\u044F \u0432\u0438\u043B\u043B\u0430 \u0432 \u041A\u0430\u043D\u0442\u0435\u0433\u0440\u0438\u043B\u0435",
    flavor: "\u0417\u0435\u043B\u0435\u043D\u044C \u043A\u043B\u0443\u0431\u0430 \u0438\u0437 \u043A\u0443\u0445\u043E\u043D\u043D\u043E\u0433\u043E \u043E\u043A\u043D\u0430; \u0447\u043B\u0435\u043D\u0441\u0442\u0432\u043E \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0434\u043E\u043C."
  },
  "ob-vil-4": {
    title: "\u0414\u043E\u043C \u043D\u0430 \u0443\u0442\u0451\u0441\u0435 \u041F\u0443\u043D\u0442\u0430-\u0411\u0430\u043B\u044C\u0435\u043D\u0430",
    flavor: "\u0421\u043E\u0441\u0435\u0434 \u041A\u0430\u0441\u0430\u043F\u0443\u044D\u0431\u043B\u043E; \u0410\u0442\u043B\u0430\u043D\u0442\u0438\u043A\u0430 \u2014 \u0437\u0430\u0434\u043D\u0438\u0439 \u0434\u0432\u043E\u0440."
  },
  "ob-vil-5": {
    title: "\u0421\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u0430\u044F \u0432\u0438\u043B\u043B\u0430 \u0432 \u041C\u0430\u043D\u0430\u043D\u0442\u044C\u044F\u043B\u0435\u0441\u0435",
    flavor: "\u0410\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u0443\u0440\u043D\u0430\u044F \u043A\u043E\u0440\u043E\u0431\u043A\u0430 \u043D\u0430 \u043F\u0435\u0441\u043A\u0435; \u0441\u044A\u0451\u043C\u043A\u0438 \u0434\u043B\u044F \u0436\u0443\u0440\u043D\u0430\u043B\u043E\u0432 \u043E\u043F\u043B\u0430\u0447\u0438\u0432\u0430\u044E\u0442 \u0437\u0438\u043C\u0443."
  },
  "ob-vil-6": {
    title: "\u0412\u0438\u043B\u043B\u0430 \u0432 \u0411\u0435\u0432\u0435\u0440\u043B\u0438-\u0425\u0438\u043B\u043B\u0437 \u041F\u0443\u043D\u0442\u0430",
    flavor: "\u0422\u0438\u0445\u0438\u0435 \u0441\u043E\u0441\u043D\u044B, \u0432\u044B\u0441\u043E\u043A\u0438\u0435 \u0438\u0437\u0433\u043E\u0440\u043E\u0434\u0438; \u0430\u0440\u0433\u0435\u043D\u0442\u0438\u043D\u0441\u043A\u0438\u0435 \u0441\u0435\u043C\u044C\u0438 \u0431\u0440\u043E\u043D\u0438\u0440\u0443\u044E\u0442 \u043D\u0430 \u0433\u043E\u0434\u044B \u0432\u043F\u0435\u0440\u0451\u0434."
  },
  "ob-vil-7": {
    title: "\u0414\u043E\u043C \u0443 \u043E\u0437\u0435\u0440\u0430 \u041B\u0430\u0433\u0443\u043D\u0430-\u0434\u0435\u043B\u044C-\u0421\u0430\u0443\u0441\u0435",
    flavor: "\u0410\u044D\u0440\u043E\u043F\u043E\u0440\u0442 \u0432 \u0434\u0435\u0441\u044F\u0442\u0438 \u043C\u0438\u043D\u0443\u0442\u0430\u0445; \u0432\u043E\u0434\u043D\u044B\u0435 \u043B\u044B\u0436\u0438 \u0432 \u0441\u0430\u0440\u0430\u0435."
  },
  "ob-vil-8": {
    title: "\u0422\u0440\u043E\u0444\u0435\u0439\u043D\u0430\u044F \u043F\u0443\u0441\u0442\u0430\u044F \u0432\u0438\u043B\u043B\u0430, \u0425\u043E\u0441\u0435-\u0418\u0433\u043D\u0430\u0441\u0438\u043E",
    flavor: "\u0426\u0435\u043D\u0430 \u043A\u0430\u043A \u0443 \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u0430, \u0430\u0440\u0435\u043D\u0434\u0430 \u043A\u0430\u043A \u0443 \u043D\u0430\u0434\u0435\u0436\u0434\u044B \u2014 CF \u0436\u0434\u0451\u0442 \u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E\u0433\u043E \u043B\u0435\u0442\u0430."
  },
  "ob-land-1": {
    title: "120 \u0433\u0430 \u043F\u043E\u0434 \u0441\u043E\u0435\u0439, \u0421\u043E\u0440\u0438\u0430\u043D\u043E",
    flavor: "\u0421\u043E\u0441\u0435\u0434 \u0432\u043E\u0437\u0434\u0435\u043B\u044B\u0432\u0430\u0435\u0442; \u0432\u044B \u043A\u043B\u0430\u0434\u0451\u0442\u0435 \u0430\u0440\u0435\u043D\u0434\u0443 \u0432 \u0431\u0430\u043D\u043A."
  },
  "ob-land-2": {
    title: "300 \u0433\u0430 \u0441\u043E \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u043E\u0439 \u0430\u0440\u0435\u043D\u0434\u043E\u0439, \u041F\u0430\u0439\u0441\u0430\u043D\u0434\u0443",
    flavor: "\u0414\u043E\u0433\u043E\u0432\u043E\u0440 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u0434\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E \u0441\u0443\u0445\u043E\u0433\u043E \u0441\u0435\u0437\u043E\u043D\u0430."
  },
  "ob-land-3": {
    title: "\u0410\u043A\u0440\u044B \u0443 \u0440\u0435\u0447\u043D\u043E\u0433\u043E \u043F\u043E\u0440\u0442\u0430, \u041D\u0443\u044D\u0432\u0430-\u041F\u0430\u043B\u044C\u043C\u0438\u0440\u0430",
    flavor: "\u0417\u0435\u0440\u043D\u043E\u0432\u044B\u0435 \u0431\u0430\u0440\u0436\u0438 \u0432\u044B\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u044E\u0442\u0441\u044F, \u043A\u043E\u0433\u0434\u0430 \u0440\u0435\u043A\u0430 \u0432\u044B\u0441\u043E\u043A\u0430\u044F."
  },
  "ob-land-4": {
    title: "500 \u0433\u0430 \u043D\u0430 \u0444\u0440\u043E\u043D\u0442\u0438\u0440\u0435 \u0410\u0440\u0442\u0438\u0433\u0430\u0441\u0430",
    flavor: "\u0414\u043E\u0440\u043E\u0433\u0430 \u043F\u0440\u0438\u0434\u0451\u0442 \u2014 \u0437\u0435\u043C\u043B\u0435\u043C\u0435\u0440 \u0443\u0436\u0435 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u043B."
  },
  "ob-land-5": {
    title: "\u0426\u0438\u0442\u0440\u0443\u0441\u043E\u0432\u043E\u0435 \u0438\u043C\u0435\u043D\u0438\u0435, \u0421\u0430\u043B\u044C\u0442\u043E",
    flavor: "\u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u044B \u043D\u0430 \u0441\u043E\u043A \u0441 \u043F\u0440\u0438\u0433\u0440\u0430\u043D\u0438\u0447\u043D\u044B\u043C\u0438 \u0443\u043F\u0430\u043A\u043E\u0432\u0449\u0438\u043A\u0430\u043C\u0438."
  },
  "ob-land-6": {
    title: "1 000 \u0433\u0430 \u0431\u0435\u0437 \u0437\u0430\u0431\u043E\u0440\u043E\u0432, \u0422\u0430\u043A\u0443\u0430\u0440\u0435\u043C\u0431\u043E",
    flavor: "\u0426\u0435\u043D\u0430 \u043A\u0430\u043A \u0437\u0430 \u043A\u0443\u0441\u0442\u0430\u0440\u043D\u0438\u043A; \u043D\u0430 \u043A\u0430\u0440\u0442\u0435 \u2014 \u043A\u0430\u043A \u043F\u0430\u0441\u0442\u0431\u0438\u0449\u0435."
  },
  "ob-land-7": {
    title: "\u041F\u043B\u0430\u043D\u0442\u0430\u0446\u0438\u044F \u044D\u0432\u043A\u0430\u043B\u0438\u043F\u0442\u0430, \u0420\u0438\u0432\u0435\u0440\u0430",
    flavor: "\u0411\u0440\u0438\u0433\u0430\u0434\u044B \u0446\u0435\u043B\u043B\u044E\u043B\u043E\u0437\u043D\u043E\u0433\u043E \u043A\u043E\u043C\u0431\u0438\u043D\u0430\u0442\u0430 \u043F\u0440\u0438\u043B\u0430\u0433\u0430\u044E\u0442\u0441\u044F \u043A \u043A\u0443\u043F\u0447\u0435\u0439."
  },
  "ob-land-8": {
    title: "\u0410\u043A\u0440\u044B \u043F\u043E\u0434 \u043E\u0442\u043A\u043E\u0440\u043C\u043E\u0447\u043D\u0438\u043A, \u0414\u0443\u0440\u0430\u0441\u043D\u043E",
    flavor: "\u041F\u0435\u0440\u0435\u043A\u0440\u0451\u0441\u0442\u043E\u043A \u0432\u0441\u0435\u0445 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0437\u043E\u0432 \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u044B."
  },
  "ob-land-9": {
    title: "\u0410\u043A\u0440\u044B \u0443 \u043B\u0430\u0433\u0443\u043D\u044B, \u0420\u043E\u0447\u0430",
    flavor: "\u0414\u0435\u043D\u044C\u0433\u0438 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435 \u0441\u0442\u0440\u043E\u044F\u0442\u0441\u044F \u0431\u043B\u0438\u0436\u0435 \u0441 \u043A\u0430\u0436\u0434\u044B\u043C \u0433\u043E\u0434\u043E\u043C."
  },
  "ob-land-10": {
    title: "\u0410\u043A\u0440\u044B \u0443 \u043A\u043E\u0440\u0438\u0434\u043E\u0440\u0430 \u0420\u0443\u0442\u044B 9, \u041C\u0430\u043B\u044C\u0434\u043E\u043D\u0430\u0434\u043E",
    flavor: "\u0424\u0430\u0441\u0430\u0434 \u0448\u043E\u0441\u0441\u0435 \u043C\u0435\u0436\u0434\u0443 \u043F\u043B\u044F\u0436\u043D\u044B\u043C\u0438 \u0433\u043E\u0440\u043E\u0434\u0430\u043C\u0438; \u043C\u0430\u0441\u0442\u0435\u0440\u0441\u043A\u0430\u044F \u0430\u0440\u0435\u043D\u0434\u0443\u0435\u0442 \u0440\u043E\u0432\u043D\u0443\u044E \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0443."
  },
  "ob-dair-1": {
    title: "\u041C\u043E\u043B\u043E\u0447\u043D\u0430\u044F \u0444\u0435\u0440\u043C\u0430 \u043D\u0430 200 \u043A\u043E\u0440\u043E\u0432, \u041A\u043E\u043B\u043E\u043D\u0438\u044F",
    flavor: "Conaprole \u0437\u0430\u0431\u0438\u0440\u0430\u0435\u0442 \u043C\u043E\u043B\u043E\u043A\u043E; \u0432\u044B \u0437\u0430\u0431\u0438\u0440\u0430\u0435\u0442\u0435 \u0435\u0436\u0435\u043C\u0435\u0441\u044F\u0447\u043D\u044B\u0439 \u043F\u043B\u0430\u0442\u0451\u0436."
  },
  "ob-dair-2": {
    title: "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0441\u0442\u0430\u0434\u0430 \u0433\u043E\u043B\u0448\u0442\u0438\u043D\u043E\u0432, \u0421\u0430\u043D-\u0425\u043E\u0441\u0435",
    flavor: "\u0427\u0435\u0442\u044B\u0440\u0435\u0441\u0442\u0430 \u0433\u043E\u043B\u043E\u0432, \u0431\u0435\u0441\u043F\u0440\u0438\u0432\u044F\u0437\u043D\u044B\u0439 \u043A\u043E\u0440\u043E\u0432\u043D\u0438\u043A \u0438 \u043F\u043E\u043B\u043D\u044B\u0439 \u0441\u0438\u043B\u043E\u0441\u043D\u044B\u0439 \u043A\u043B\u044D\u043C\u043F."
  },
  "ob-dair-3": {
    title: "\u0424\u0435\u0440\u043C\u0430 \u0441 \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u043E\u043C \u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u0430, \u0424\u043B\u043E\u0440\u0438\u0434\u0430",
    flavor: "\u0413\u0430\u0440\u0430\u043D\u0442\u0438\u044F \u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u0430 \u043F\u0435\u0440\u0435\u0436\u0438\u0432\u0430\u0435\u0442 \u043B\u044E\u0431\u043E\u0439 \u0446\u0438\u043A\u043B \u0446\u0435\u043D \u043D\u0430 \u043C\u043E\u043B\u043E\u043A\u043E."
  },
  "ob-dair-4": {
    title: "\u042D\u0441\u0442\u0430\u043D\u0441\u0438\u044F \u0441 \u0441\u044B\u0440\u0437\u0430\u0432\u043E\u0434\u043E\u043C, \u041A\u043E\u043B\u043E\u043D\u0438\u044F",
    flavor: "\u0420\u0435\u043C\u0435\u0441\u043B\u0435\u043D\u043D\u044B\u0435 \u043A\u0440\u0443\u0433\u0438 \u0438 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u043D\u044B\u0435 \u0431\u0440\u0438\u043A\u0435\u0442\u044B \u0434\u0435\u043B\u044F\u0442 \u043E\u0434\u043D\u0443 \u043C\u043E\u043B\u043E\u0447\u043D\u0443\u044E \u043B\u0438\u043D\u0438\u044E."
  },
  "ob-dair-5": {
    title: "\u041E\u0442\u043A\u043E\u0440\u043C\u043E\u0447\u043D\u0438\u043A \u0438 \u0444\u0438\u043D\u0438\u0448\u043D\u044B\u0439 \u0434\u0432\u043E\u0440, \u041F\u0430\u0439\u0441\u0430\u043D\u0434\u0443",
    flavor: "\u0421\u043A\u043E\u0442 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u0442\u043E\u0449\u0438\u043C \u0438 \u0443\u0445\u043E\u0434\u0438\u0442 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u043D\u044B\u043C\u0438 \u043E\u0442\u0440\u0443\u0431\u0430\u043C\u0438."
  },
  "ob-dair-6": {
    title: "\u042D\u0441\u0442\u0430\u043D\u0441\u0438\u044F \u043D\u0430 1 000 \u0433\u043E\u043B\u043E\u0432, \u0422\u0430\u043A\u0443\u0430\u0440\u0435\u043C\u0431\u043E",
    flavor: "\u0414\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0435 \u0440\u0430\u043D\u0447\u043E \u0441 \u0433\u0435\u0440\u0435\u0444\u043E\u0440\u0434\u0430\u043C\u0438 \u0434\u043E \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442\u0430."
  },
  "ob-dair-7": {
    title: "\u0420\u043E\u0442\u043E\u0440\u043D\u044B\u0439 \u0434\u043E\u0438\u043B\u044C\u043D\u044B\u0439 \u0437\u0430\u043B, \u041A\u0430\u043D\u0435\u043B\u043E\u043D\u0435\u0441",
    flavor: "\u0428\u0435\u0441\u0442\u044C\u0434\u0435\u0441\u044F\u0442 \u0441\u0442\u0430\u043D\u0446\u0438\u0439 \u043A\u0440\u0443\u0442\u044F\u0442\u0441\u044F \u0441 \u0447\u0430\u0441\u0430\u043C\u0438; \u043D\u043E\u0447\u043D\u044B\u0435 \u0441\u043C\u0435\u043D\u044B \u0434\u0435\u0440\u0436\u0430\u0442 \u0442\u0430\u043D\u043A \u043F\u043E\u043B\u043D\u044B\u043C."
  },
  "ob-dair-8": {
    title: "\u0414\u043E\u043B\u044F \u0432 \u043E\u0440\u0433\u0430\u043D\u0438\u0447\u0435\u0441\u043A\u043E\u043C \u043C\u043E\u043B\u043E\u0447\u043D\u043E\u043C \u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u0435, \u041A\u043E\u043B\u043E\u043D\u0438\u044F",
    flavor: "\u041F\u0440\u0435\u043C\u0438\u0430\u043B\u044C\u043D\u0430\u044F \u0446\u0435\u043D\u0430 \u043D\u0430 \u043C\u043E\u043B\u043E\u043A\u043E, \u043F\u0440\u0435\u043C\u0438\u0430\u043B\u044C\u043D\u0430\u044F \u0431\u044E\u0440\u043E\u043A\u0440\u0430\u0442\u0438\u044F, \u0447\u0435\u0441\u0442\u043D\u044B\u0439 \u0435\u0436\u0435\u043C\u0435\u0441\u044F\u0447\u043D\u044B\u0439 CF."
  },
  "ob-dair-9": {
    title: "\u041F\u043B\u0435\u043C\u0435\u043D\u043D\u0430\u044F \u0444\u0435\u0440\u043C\u0430, \u0424\u043B\u043E\u0440\u0438\u0434\u0430",
    flavor: "\u041F\u0440\u0438\u0437\u043E\u0432\u044B\u0435 \u0431\u044B\u043A\u0438 \u0438 \u0442\u0451\u043B\u043A\u0438 \u0433\u043E\u043B\u0448\u0442\u0438\u043D\u043E\u0432 \u2014 \u0446\u0435\u043D\u044B \u043A\u0430\u043A \u043D\u0430 \u044E\u0432\u0435\u043B\u0438\u0440\u043A\u0443."
  },
  "om-mvd-wave": {
    title: "\u0412\u043E\u043B\u043D\u0430 \u0438\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u0439 \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E",
    flavor: "\u0420\u0435\u0433\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0444\u043E\u043D\u0434\u044B \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u044E\u0442 \u0434\u043B\u044F \u0441\u0435\u0431\u044F \u0420\u0430\u043C\u0431\u043B\u0443: 170% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-tram": {
    title: "\u041E\u0442\u043A\u0440\u044B\u043B\u0441\u044F \u043D\u043E\u0432\u044B\u0439 \u0442\u0440\u0430\u043D\u0437\u0438\u0442\u043D\u044B\u0439 \u043A\u043E\u0440\u0438\u0434\u043E\u0440",
    flavor: "\u0421\u0442\u0430\u043D\u0446\u0438\u0438 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u044E\u0442 \u0446\u0435\u043B\u044B\u0435 \u0440\u0430\u0439\u043E\u043D\u044B: 185% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-rambla": {
    title: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u043C\u0435\u043D\u0430\u0434\u0430 \u0420\u0430\u043C\u0431\u043B\u044B",
    flavor: "\u041D\u0430\u0431\u0435\u0440\u0435\u0436\u043D\u0430\u044F \u0441\u0442\u043E\u043B\u0438\u0446\u044B \u0437\u0430\u0431\u0438\u0442\u0430 \u0434\u043E \u043E\u0442\u043A\u0430\u0437\u0430; \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440\u044B \u043F\u043B\u0430\u0442\u044F\u0442 150% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-tech": {
    title: "IT-\u043A\u0430\u043C\u043F\u0443\u0441 \u043F\u0435\u0440\u0435\u0435\u0437\u0436\u0430\u0435\u0442",
    flavor: "\u0421\u043E\u0444\u0442\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043A \u043F\u043E\u0434\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442 \u0434\u043E\u043B\u0433\u0438\u0435 \u0430\u0440\u0435\u043D\u0434\u044B; \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u0438 \u043F\u043B\u0430\u0442\u044F\u0442 140% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-visa": {
    title: "\u0411\u0443\u043C \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u044B \u0440\u0435\u0437\u0438\u0434\u0435\u043D\u0442\u0441\u0442\u0432\u0430",
    flavor: "\u0423\u0434\u0430\u043B\u0451\u043D\u0449\u0438\u043A\u0438 \u0431\u043E\u0440\u044E\u0442\u0441\u044F \u0437\u0430 \u0434\u043E\u043B\u0433\u0438\u0435 \u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u044B: 125% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-fair": {
    title: "\u041C\u0435\u0441\u0442\u043D\u044B\u0439 \u0434\u0435\u0432\u0435\u043B\u043E\u043F\u0435\u0440 \u043A\u043E\u043D\u0441\u043E\u043B\u0438\u0434\u0438\u0440\u0443\u0435\u0442",
    flavor: "\u0417\u0430\u0441\u0442\u0440\u043E\u0439\u0449\u0438\u043A \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 \u0440\u043E\u0432\u043D\u043E 105% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-peso": {
    title: "\u041F\u0435\u0441\u043E \u0441\u043F\u043E\u043B\u0437\u0430\u0435\u0442",
    flavor: "\u041C\u0435\u0441\u0442\u043D\u044B\u0435 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u044B \u0432\u044B\u0445\u043E\u0434\u044F\u0442 \u0432 \u0434\u043E\u043B\u043B\u0430\u0440\u044B: 90% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-mvd-glut": {
    title: "\u0417\u0438\u043C\u043D\u0438\u0439 \u043F\u0435\u0440\u0435\u0438\u0437\u0431\u044B\u0442\u043E\u043A \u0430\u0440\u0435\u043D\u0434\u044B",
    flavor: "\u041F\u0443\u0441\u0442\u044B\u0435 \u0431\u0430\u0448\u043D\u0438 \u043F\u043E\u0441\u043B\u0435 \u0431\u0443\u043C\u0430; \u0444\u043E\u043D\u0434 \u0434\u0430\u0451\u0442 65% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041C\u043E\u043D\u0442\u0435\u0432\u0438\u0434\u0435\u043E."
  },
  "om-pde-season": {
    title: "\u0420\u0435\u043A\u043E\u0440\u0434\u043D\u044B\u0439 \u043B\u0435\u0442\u043D\u0438\u0439 \u0441\u0435\u0437\u043E\u043D",
    flavor: "\u041A\u0430\u0436\u0434\u0430\u044F \u043F\u043E\u0441\u0443\u0442\u043E\u0447\u043D\u0430\u044F \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0430: 175% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-pde-brazil": {
    title: "\u0412\u043E\u043B\u043D\u0430 \u0431\u0440\u0430\u0437\u0438\u043B\u044C\u0441\u043A\u0438\u0445 \u0442\u0443\u0440\u0438\u0441\u0442\u043E\u0432",
    flavor: "\u0427\u0430\u0440\u0442\u0435\u0440\u044B \u0437\u0430\u043F\u043E\u043B\u043D\u044F\u044E\u0442 \u043F\u043E\u043B\u0443\u043E\u0441\u0442\u0440\u043E\u0432; \u0438\u043D\u043E\u0441\u0442\u0440\u0430\u043D\u0446\u044B \u043F\u043B\u0430\u0442\u044F\u0442 160% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-pde-events": {
    title: "\u041D\u0435\u0434\u0435\u043B\u044F \u043A\u0438\u043D\u043E\u0444\u0435\u0441\u0442\u0438\u0432\u0430\u043B\u044F \u0438 \u0440\u0435\u0433\u0430\u0442\u044B",
    flavor: "\u0421\u043F\u0440\u043E\u0441 \u043D\u0430 \u0441\u043E\u0431\u044B\u0442\u0438\u044F \u0432\u0437\u043B\u0435\u0442\u0430\u0435\u0442: 150% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-pde-reit": {
    title: "\u0422\u0435\u043D\u0434\u0435\u0440 \u043F\u043B\u044F\u0436\u043D\u043E\u0433\u043E REIT",
    flavor: "\u0411\u0438\u0440\u0436\u0435\u0432\u043E\u0439 \u0442\u0440\u0430\u0441\u0442 \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0435\u0442 110% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-pde-off": {
    title: "\u041E\u0431\u0432\u0430\u043B \u043C\u0435\u0436\u0441\u0435\u0437\u043E\u043D\u044C\u044F",
    flavor: "\u0418\u044E\u043B\u044C\u0441\u043A\u0430\u044F \u0442\u0438\u0448\u0438\u043D\u0430 \u043D\u0430 \u0413\u043E\u0440\u043B\u0435\u0440\u043E; \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u044B \u0441\u043E\u0433\u043B\u0430\u0448\u0430\u044E\u0442\u0441\u044F \u043D\u0430 75% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-pde-build": {
    title: "\u041F\u0435\u0440\u0435\u0438\u0437\u0431\u044B\u0442\u043E\u043A \u0431\u0430\u0448\u0435\u043D",
    flavor: "\u041A\u0440\u0430\u043D\u043E\u0432 \u0431\u043E\u043B\u044C\u0448\u0435, \u0447\u0435\u043C \u0436\u0438\u043B\u044C\u0446\u043E\u0432; \u0444\u043E\u043D\u0434-\u0441\u0442\u0435\u0440\u0432\u044F\u0442\u043D\u0438\u043A \u0434\u0430\u0451\u0442 60% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043A\u0432\u0430\u0440\u0442\u0438\u0440\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-vil-celeb": {
    title: "\u041E\u0445\u043E\u0442\u0430 \u0437\u043D\u0430\u043C\u0435\u043D\u0438\u0442\u043E\u0441\u0442\u0435\u0439 \u0437\u0430 \u043F\u043B\u044F\u0436\u043D\u044B\u043C\u0438 \u0434\u043E\u043C\u0430\u043C\u0438",
    flavor: "\u0417\u043D\u0430\u043A\u043E\u043C\u044B\u0435 \u0438\u043C\u0435\u043D\u0430 \u0445\u043E\u0442\u044F\u0442 \u043A\u043B\u044E\u0447\u0438 \u043A \u0420\u043E\u0436\u0434\u0435\u0441\u0442\u0432\u0443: 200% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u0438\u043B\u043B\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-vil-luxury": {
    title: "\u041B\u044E\u043A\u0441\u043E\u0432\u044B\u0439 REIT \u0441\u043A\u0440\u0435\u0431\u0451\u0442 \u043F\u043E\u0431\u0435\u0440\u0435\u0436\u044C\u0435",
    flavor: "\u0418\u043D\u0441\u0442\u0438\u0442\u0443\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0435\u043D\u044C\u0433\u0438 \u043F\u043B\u0430\u0442\u044F\u0442 160% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u0438\u043B\u043B\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-vil-fair": {
    title: "\u0421\u043E\u0441\u0435\u0434\u0438 \u0441\u043A\u0443\u043F\u0430\u044E\u0442 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u044B",
    flavor: "\u0412\u0438\u043B\u043B\u0430 \u043F\u043E \u0441\u043E\u0441\u0435\u0434\u0441\u0442\u0432\u0443 \u0437\u0430\u043A\u0440\u0443\u0433\u043B\u044F\u0435\u0442 \u043A\u0432\u0430\u0440\u0442\u0430\u043B \u043F\u043E 120% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u0438\u043B\u043B\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-vil-storm": {
    title: "\u0421\u0435\u0437\u043E\u043D \u0430\u0442\u043B\u0430\u043D\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0448\u0442\u043E\u0440\u043C\u043E\u0432",
    flavor: "\u0414\u044E\u043D\u044B \u0440\u0430\u0437\u043C\u044B\u0442\u044B, \u043B\u0435\u0442\u043E \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E; \u0444\u043E\u043D\u0434 \u0434\u0430\u0451\u0442 70% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0432\u0438\u043B\u043B\u044B \u0432 \u041F\u0443\u043D\u0442\u0430-\u0434\u0435\u043B\u044C-\u042D\u0441\u0442\u0435."
  },
  "om-land-hwy": {
    title: "\u041A\u043E\u0440\u0438\u0434\u043E\u0440 \u0448\u043E\u0441\u0441\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D",
    flavor: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442 \u043D\u0430\u043D\u0435\u0441\u0451\u043D \u043D\u0430 \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443: 400% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-port": {
    title: "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0437\u0435\u0440\u043D\u043E\u0432\u043E\u0433\u043E \u043F\u043E\u0440\u0442\u0430",
    flavor: "\u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0451\u0440\u044B \u0441\u043E\u0431\u0438\u0440\u0430\u044E\u0442 \u0443\u0447\u0430\u0441\u0442\u043A\u0438 \u043F\u043E 350% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-soy": {
    title: "\u0421\u043A\u0430\u0447\u043E\u043A \u0446\u0435\u043D \u043D\u0430 \u0441\u043E\u044E",
    flavor: "\u0411\u0440\u043E\u043A\u0435\u0440\u044B \u0430\u0440\u0435\u043D\u0434\u0443\u044E\u0442 \u0432\u0441\u0451 \u0437\u0435\u043B\u0451\u043D\u043E\u0435 \u0438 \u0441\u043A\u0443\u043F\u0430\u044E\u0442 \u0442\u043E, \u0447\u0442\u043E \u0430\u0440\u0435\u043D\u0434\u0443\u044E\u0442: 250% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-forest": {
    title: "\u041B\u0435\u0441\u043D\u043E\u0439 \u0431\u0443\u043C \u0446\u0435\u043B\u043B\u044E\u043B\u043E\u0437\u043D\u043E\u0433\u043E \u043A\u043E\u043C\u0431\u0438\u043D\u0430\u0442\u0430",
    flavor: "\u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u044B \u043D\u0430 \u044D\u0432\u043A\u0430\u043B\u0438\u043F\u0442 \u043F\u0435\u0440\u0435\u043E\u0446\u0435\u043D\u0438\u0432\u0430\u044E\u0442 \u0441\u0435\u0432\u0435\u0440: 220% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-beach": {
    title: "\u041E\u0445\u043E\u0442\u0430 \u0437\u0430 \u043F\u043B\u043E\u0449\u0430\u0434\u043A\u043E\u0439 \u043F\u043E\u0434 \u043A\u0443\u0440\u043E\u0440\u0442",
    flavor: "\u0414\u0435\u043D\u044C\u0433\u0438 \u0420\u043E\u0447\u0438 \u0441\u043E\u0431\u0438\u0440\u0430\u044E\u0442 \u0434\u044E\u043D\u044B \u043F\u043E 300% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-fair": {
    title: "\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0441\u043E\u0441\u0435\u0434\u043D\u0435\u0439 \u044D\u0441\u0442\u0430\u043D\u0441\u0438\u0438",
    flavor: "\u0420\u0430\u043D\u0447\u0435\u0440\u043E \u043F\u043E \u0441\u043E\u0441\u0435\u0434\u0441\u0442\u0432\u0443 \u0437\u0430\u043A\u0440\u0443\u0433\u043B\u044F\u0435\u0442 \u043A\u0430\u0440\u0442\u0443 \u043F\u043E 120% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-drought": {
    title: "\u0417\u0430\u0441\u0443\u0445\u0430 \u0432\u043E \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0435",
    flavor: "\u041F\u044B\u043B\u044C \u0442\u0430\u043C, \u0433\u0434\u0435 \u0434\u043E\u043B\u0436\u043D\u0430 \u0431\u044B\u0442\u044C \u0442\u0440\u0430\u0432\u0430; \u0444\u043E\u043D\u0434 \u0434\u0430\u0451\u0442 70% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-land-flood": {
    title: "\u0413\u043E\u0434 \u0440\u0435\u0447\u043D\u044B\u0445 \u043F\u0430\u0432\u043E\u0434\u043A\u043E\u0432",
    flavor: "\u041D\u0438\u0437\u0438\u043D\u044B \u043F\u043E\u0434 \u0432\u043E\u0434\u043E\u0439; \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0435 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u0438 \u0434\u0430\u044E\u0442 65% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u0437\u0435\u043C\u043B\u044E \u0432 \u0423\u0440\u0443\u0433\u0432\u0430\u0435."
  },
  "om-dair-milk": {
    title: "\u0420\u0430\u043B\u043B\u0438 \u0446\u0435\u043D \u043D\u0430 \u043C\u043E\u043B\u043E\u043A\u043E",
    flavor: "\u041A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u044B \u043F\u0435\u0440\u0435\u0431\u0438\u0432\u0430\u044E\u0442 \u0434\u0440\u0443\u0433 \u0443 \u0434\u0440\u0443\u0433\u0430 \u0446\u0438\u0441\u0442\u0435\u0440\u043D\u044B \u2014 \u0438 \u0444\u0435\u0440\u043C\u044B \u043F\u043E\u0434 \u043D\u0438\u043C\u0438: 220% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043C\u043E\u043B\u043E\u0447\u043D\u044B\u0435 \u0438 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u044B \u0423\u0440\u0443\u0433\u0432\u0430\u044F."
  },
  "om-dair-export": {
    title: "\u041E\u0442\u043A\u0440\u044B\u043B\u0430\u0441\u044C \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u043D\u0430\u044F \u043A\u0432\u043E\u0442\u0430",
    flavor: "\u041A\u043E\u043D\u0442\u0440\u0430\u043A\u0442\u044B \u0441 \u041A\u0438\u0442\u0430\u0435\u043C \u0438 \u0415\u0421 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u044B: 200% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043C\u043E\u043B\u043E\u0447\u043D\u044B\u0435 \u0438 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u044B \u0423\u0440\u0443\u0433\u0432\u0430\u044F."
  },
  "om-dair-herd": {
    title: "\u041B\u0438\u0445\u043E\u0440\u0430\u0434\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0434",
    flavor: "\u0420\u0430\u043D\u0447\u0435\u0440\u043E \u043D\u0443\u0436\u043D\u044B \u0434\u043E\u0439\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0432\u044B \u0434\u043E \u0432\u0435\u0441\u043D\u044B: 180% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043C\u043E\u043B\u043E\u0447\u043D\u044B\u0435 \u0438 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u044B \u0423\u0440\u0443\u0433\u0432\u0430\u044F."
  },
  "om-dair-coop": {
    title: "\u041A\u043E\u043D\u0441\u043E\u043B\u0438\u0434\u0430\u0446\u0438\u044F \u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u043E\u0432",
    flavor: "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u0438 \u043C\u0430\u0441\u0448\u0442\u0430\u0431\u0430 Conaprole \u043F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u044E\u0442 140% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043C\u043E\u043B\u043E\u0447\u043D\u044B\u0435 \u0438 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u044B \u0423\u0440\u0443\u0433\u0432\u0430\u044F."
  },
  "om-dair-fair": {
    title: "\u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0441\u043E\u0441\u0435\u0434\u043D\u0435\u0439 \u0444\u0435\u0440\u043C\u044B",
    flavor: "\u0424\u0435\u0440\u043C\u0430 \u043F\u043E \u0441\u043E\u0441\u0435\u0434\u0441\u0442\u0432\u0443 \u0445\u043E\u0447\u0435\u0442 \u0432\u0430\u0448\u0435 \u0441\u0442\u0430\u0434\u043E \u043F\u043E 115% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043C\u043E\u043B\u043E\u0447\u043D\u044B\u0435 \u0438 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u044B \u0423\u0440\u0443\u0433\u0432\u0430\u044F."
  },
  "om-dair-scare": {
    title: "\u041F\u0430\u043D\u0438\u043A\u0430 \u0438\u0437-\u0437\u0430 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0441\u0442\u0430\u0434\u0430",
    flavor: "\u0420\u044B\u043D\u043E\u043A \u043F\u0443\u0433\u0430\u0435\u0442\u0441\u044F \u043B\u043E\u0436\u043D\u043E\u0439 \u0442\u0440\u0435\u0432\u043E\u0433\u0438; \u0444\u043E\u043D\u0434 \u0434\u0430\u0451\u0442 60% \u043E\u0442 \u0446\u0435\u043D\u044B \u0437\u0430 \u043C\u043E\u043B\u043E\u0447\u043D\u044B\u0435 \u0438 \u0441\u043A\u043E\u0442\u043E\u0432\u043E\u0434\u0447\u0435\u0441\u043A\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u044B \u0423\u0440\u0443\u0433\u0432\u0430\u044F."
  }
};

// src/data/ru.misc2.json
var ru_misc2_default = {
  "1": {
    name: "\u0420\u0435\u0433\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0435\u0442\u044C \u043F\u0438\u0446\u0446\u0435\u0440\u0438\u0439",
    flavor: "\u0414\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u043F\u0435\u0447\u0435\u0439, \u043E\u0434\u0438\u043D \u043B\u044E\u0431\u0438\u043C\u044B\u0439 \u0440\u0435\u0446\u0435\u043F\u0442."
  },
  "2": {
    name: "\u0413\u043E\u0434 \u043A\u0440\u0443\u0433\u043E\u0441\u0432\u0435\u0442\u043A\u0438 \u043F\u043E\u0434 \u043F\u0430\u0440\u0443\u0441\u043E\u043C",
    flavor: "\u0414\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u043C\u0435\u0441\u044F\u0446\u0435\u0432, \u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044C \u043F\u043E\u0440\u0442\u043E\u0432, \u043D\u043E\u043B\u044C \u0441\u043E\u0432\u0435\u0449\u0430\u043D\u0438\u0439."
  },
  "4": {
    name: "\u0414\u043E\u043B\u044F \u0432 \u043A\u0440\u0430\u0444\u0442\u043E\u0432\u043E\u0439 \u043F\u0438\u0432\u043E\u0432\u0430\u0440\u043D\u0435",
    flavor: "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0432 \u0442\u0430\u043F\u0440\u0443\u043C \u043E\u0433\u0438\u0431\u0430\u0435\u0442 \u043A\u0432\u0430\u0440\u0442\u0430\u043B."
  },
  "5": {
    name: "\u0420\u0430\u0437\u0432\u0435\u0434\u043E\u0447\u043D\u0430\u044F \u0441\u043A\u0432\u0430\u0436\u0438\u043D\u0430 \u0432 \u041C\u0438\u0440\u0438, \u0421\u0430\u0440\u0430\u0432\u0430\u043A",
    flavor: "\u041C\u0435\u0441\u0442\u043E\u0440\u043E\u0436\u0434\u0435\u043D\u0438\u0435, \u0441 \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u0432 1910 \u0433\u043E\u0434\u0443 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C \u043C\u0430\u043B\u0430\u0439\u0437\u0438\u0439\u0441\u043A\u0430\u044F \u043D\u0435\u0444\u0442\u044C, \u0432\u0441\u0451 \u0435\u0449\u0451 \u043F\u0440\u044F\u0447\u0435\u0442 \u043A\u0430\u0440\u043C\u0430\u043D\u044B \u2014 \u0434\u043B\u044F \u0442\u0435\u0445, \u043A\u0442\u043E \u0440\u0435\u0448\u0438\u0442\u0441\u044F \u0431\u0443\u0440\u0438\u0442\u044C."
  },
  "7": {
    name: "\u041B\u0438\u0447\u043D\u0430\u044F \u0445\u0438\u0436\u0438\u043D\u0430 \u0432 \u0433\u043E\u0440\u0430\u0445",
    flavor: "\u0421\u043D\u0435\u0433 \u043D\u0430 \u043A\u0440\u044B\u0448\u0435, \u043D\u0438 \u0434\u0443\u0448\u0438 \u043D\u0430 \u0442\u0440\u043E\u043F\u0435."
  },
  "8": {
    name: "\u041A\u043B\u0438\u043D\u0438\u043A\u0430 \u043D\u0435\u043E\u0442\u043B\u043E\u0436\u043D\u043E\u0439 \u043F\u043E\u043C\u043E\u0449\u0438",
    flavor: "\u041E\u0442\u043A\u0440\u044B\u0442\u0430, \u043A\u043E\u0433\u0434\u0430 \u0432\u0441\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u044B."
  },
  "9": {
    name: "\u0421\u0438\u0431\u0438\u0440\u0441\u043A\u0430\u044F \u043D\u0435\u0444\u0442\u044F\u043D\u0430\u044F \u0441\u043A\u0432\u0430\u0436\u0438\u043D\u0430",
    flavor: "\u041E\u0434\u043D\u0430 \u0432\u044B\u0448\u043A\u0430 \u0432 \u043C\u0451\u0440\u0437\u043B\u043E\u0439 \u0442\u0430\u0439\u0433\u0435: \u0444\u043E\u043D\u0442\u0430\u043D \u2014 \u0438\u043B\u0438 \u043E\u0447\u0435\u043D\u044C \u0434\u043E\u0440\u043E\u0433\u0430\u044F \u0434\u044B\u0440\u0430."
  },
  "10": {
    name: "\u041E\u0441\u043D\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u043F\u043E\u0432\u0435\u0434\u043D\u0438\u043A",
    flavor: "\u0421\u043F\u0430\u0441\u0451\u043D\u043D\u044B\u0435 \u0437\u0432\u0435\u0440\u0438, \u0445\u043E\u043B\u043C\u044B \u0438 \u0432\u0430\u0448\u0435 \u0438\u043C\u044F \u043D\u0430 \u0432\u043E\u0440\u043E\u0442\u0430\u0445."
  },
  "12": {
    name: "\u041C\u0430\u0440\u0438\u043D\u0430 \u0438 \u0432\u0435\u0440\u0444\u044C",
    flavor: "\u041F\u0440\u0438\u0447\u0430\u043B\u044B \u0441\u0434\u0430\u043D\u044B \u043D\u0430 \u0442\u0440\u0438 \u0441\u0435\u0437\u043E\u043D\u0430 \u0432\u043F\u0435\u0440\u0451\u0434."
  },
  "13": {
    name: "\u0413\u0430\u0440\u0430\u0436 \u0432\u0438\u043D\u0442\u0430\u0436\u043D\u044B\u0445 \u0441\u0443\u043F\u0435\u0440\u043A\u0430\u0440\u043E\u0432",
    flavor: "\u041F\u044F\u0442\u044C \u043C\u0430\u0448\u0438\u043D, \u043E\u0434\u0438\u043D \u043F\u043E\u0434\u044A\u0451\u043C\u043D\u0438\u043A, \u0431\u0435\u0441\u043A\u043E\u043D\u0435\u0447\u043D\u044B\u0435 \u0441\u0443\u0431\u0431\u043E\u0442\u044B."
  },
  "14": {
    name: "\u0411\u0430\u0437\u0430 \u0441\u043D\u0430\u0431\u0436\u0435\u043D\u0438\u044F \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C, \u041B\u0430\u0431\u0443\u0430\u043D",
    flavor: "\u041A\u0430\u0436\u0434\u0430\u044F \u0431\u0443\u0440\u043E\u0432\u0430\u044F \u042E\u0436\u043D\u043E-\u041A\u0438\u0442\u0430\u0439\u0441\u043A\u043E\u0433\u043E \u043C\u043E\u0440\u044F \u043F\u043E\u043F\u043E\u043B\u043D\u044F\u0435\u0442 \u0437\u0430\u043F\u0430\u0441\u044B \u0443 \u0432\u0430\u0448\u0435\u0433\u043E \u043F\u0440\u0438\u0447\u0430\u043B\u0430."
  },
  "17": {
    name: "\u0427\u0430\u0441\u0442\u043D\u044B\u0435 \u043F\u0430\u0440\u043A\u043E\u0432\u043E\u0447\u043D\u044B\u0435 \u0431\u0430\u0448\u043D\u0438",
    flavor: "\u0411\u0435\u0442\u043E\u043D, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442 \u0434\u0435\u043D\u044C\u0433\u0438 \u0432 \u0446\u0435\u043D\u0442\u0440\u0435."
  },
  "18": {
    name: "\u041B\u043E\u0436\u0430 \u043D\u0430 \u0441\u0442\u0430\u0434\u0438\u043E\u043D\u0435 \u043F\u043E\u0436\u0438\u0437\u043D\u0435\u043D\u043D\u043E",
    flavor: "\u0412\u0430\u0448\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430, \u0432\u0430\u0448\u0438 \u043C\u0435\u0441\u0442\u0430, \u043A\u0430\u0436\u0434\u044B\u0439 \u0441\u0435\u0437\u043E\u043D."
  },
  "19": {
    name: "\u0414\u043E\u043C \u043F\u0440\u0435\u0441\u0442\u0430\u0440\u0435\u043B\u044B\u0445 \u0441 \u0443\u0445\u043E\u0434\u043E\u043C",
    flavor: "\u041F\u043E\u043B\u043D\u0430\u044F \u0437\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u043C\u043E\u0441\u0442\u044C \u0438 \u0437\u0430\u0431\u043E\u0442\u043B\u0438\u0432\u044B\u0439 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B."
  },
  "21": {
    name: "\u041D\u0430\u0443\u0447\u0438\u0442\u044C\u0441\u044F \u043B\u0435\u0442\u0430\u0442\u044C \u2014 \u0438 \u043A\u0443\u043F\u0438\u0442\u044C \u0441\u0430\u043C\u043E\u043B\u0451\u0442",
    flavor: "\u041B\u0438\u0446\u0435\u043D\u0437\u0438\u044F, \u0430\u043D\u0433\u0430\u0440 \u0438 \u0447\u0435\u0442\u044B\u0440\u0451\u0445\u043C\u0435\u0441\u0442\u043A\u0430 \u0441 \u0432\u0430\u0448\u0438\u043C\u0438 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0430\u043C\u0438."
  },
  "23": {
    name: "\u0421\u044A\u0451\u043C\u043E\u0447\u043D\u044B\u0439 \u043F\u0430\u0432\u0438\u043B\u044C\u043E\u043D",
    flavor: "\u041F\u043B\u043E\u0449\u0430\u0434\u043A\u0438 \u0437\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u043D\u0430 \u0434\u0432\u0430 \u0433\u043E\u0434\u0430 \u0432\u043F\u0435\u0440\u0451\u0434."
  },
  "24": {
    name: "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0440\u0443\u0438\u043D\u044B \u0437\u0430\u043C\u043A\u0430",
    flavor: "\u0411\u0430\u0448\u043D\u0438, \u0433\u043E\u0431\u0435\u043B\u0435\u043D\u044B \u0438 \u0440\u043E\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043D\u0430\u043A\u043E\u043D\u0435\u0446 \u0434\u0435\u0440\u0436\u0438\u0442 \u0432\u043E\u0434\u0443."
  },
  "25": {
    name: "\u0425\u0430\u0431 \u0445\u043E\u043B\u043E\u0434\u043E\u0432\u043E\u0439 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438",
    flavor: "\u041A\u0430\u0436\u0434\u044B\u0439 \u0431\u0430\u043A\u0430\u043B\u0435\u0439\u0449\u0438\u043A \u043E\u043A\u0440\u0443\u0433\u0430 \u0437\u0430\u0432\u0438\u0441\u0438\u0442 \u043E\u0442 \u0432\u0430\u0448\u0438\u0445 \u043C\u043E\u0440\u043E\u0437\u0438\u043B\u044C\u043D\u0438\u043A\u043E\u0432."
  },
  "26": {
    name: "\u0414\u043E\u043B\u044F \u0432 \u043B\u0438\u043D\u0438\u0438 \u0421\u041F\u0413, \u0411\u0438\u043D\u0442\u0443\u043B\u0443, \u0421\u0430\u0440\u0430\u0432\u0430\u043A",
    flavor: "\u041A\u0443\u0441\u043E\u0447\u0435\u043A \u043E\u0434\u043D\u043E\u0433\u043E \u0438\u0437 \u043A\u0440\u0443\u043F\u043D\u0435\u0439\u0448\u0438\u0445 \u0433\u0430\u0437\u043E\u0432\u044B\u0445 \u0437\u0430\u0432\u043E\u0434\u043E\u0432 \u043C\u0438\u0440\u0430; \u0442\u0430\u043D\u043A\u0435\u0440\u044B \u0441\u0442\u043E\u044F\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u043D\u0430 \u0440\u0435\u0439\u0434\u0435."
  },
  "28": {
    name: "\u0420\u0435\u0433\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0430\u0432\u0438\u0430\u043B\u0438\u043D\u0438\u044F",
    flavor: "\u0414\u0432\u0430 \u0442\u0443\u0440\u0431\u043E\u043F\u0440\u043E\u043F\u0430 \u0441\u0432\u044F\u0437\u044B\u0432\u0430\u044E\u0442 \u0433\u043E\u0440\u043D\u044B\u0435 \u0433\u043E\u0440\u043E\u0434\u043A\u0438."
  },
  "29": {
    name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0443\u043B\u0438\u043D\u0430\u0440\u043D\u0443\u044E \u0448\u043A\u043E\u043B\u0443",
    flavor: "\u041E\u0431\u0443\u0447\u0438\u0442\u0435 \u0442\u044B\u0441\u044F\u0447\u0443 \u043F\u043E\u0432\u0430\u0440\u043E\u0432; \u0435\u0448\u044C\u0442\u0435 \u043E\u0447\u0435\u043D\u044C, \u043E\u0447\u0435\u043D\u044C \u0432\u043A\u0443\u0441\u043D\u043E."
  },
  "30": {
    name: "\u041A\u0440\u044B\u043B\u043E \u0434\u0430\u0442\u0430-\u0446\u0435\u043D\u0442\u0440\u0430",
    flavor: "\u0421\u0442\u043E\u0439\u043A\u0438 \u0433\u0443\u0434\u044F\u0442 \u0437\u0430 \u0431\u0438\u043E\u043C\u0435\u0442\u0440\u0438\u0447\u0435\u0441\u043A\u0438\u043C\u0438 \u0434\u0432\u0435\u0440\u044F\u043C\u0438."
  },
  "32": {
    name: "\u0423\u0447\u0440\u0435\u0434\u0438\u0442\u044C \u0441\u0442\u0438\u043F\u0435\u043D\u0434\u0438\u0430\u043B\u044C\u043D\u044B\u0439 \u0444\u043E\u043D\u0434",
    flavor: "\u0421\u043E\u0442\u043D\u044F \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u043E\u0432 \u0432 \u0433\u043E\u0434, \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430."
  },
  "35": {
    name: "\u0427\u0430\u0441\u0442\u043D\u044B\u0439 \u043E\u0441\u0442\u0440\u043E\u0432",
    flavor: "\u0412\u0430\u0448\u0430 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u0442\u043E\u0447\u043A\u0430 \u043D\u0430 \u043A\u0430\u0440\u0442\u0435."
  },
  "36": {
    name: "\u041A\u043E\u043D\u0446\u0435\u0440\u0442\u043D\u044B\u0439 \u0430\u043C\u0444\u0438\u0442\u0435\u0430\u0442\u0440",
    flavor: "\u041B\u0435\u0442\u043D\u0438\u0435 \u0432\u0435\u0447\u0435\u0440\u0430, \u0430\u043D\u0448\u043B\u0430\u0433\u0438 \u043D\u0430 \u0433\u0430\u0437\u043E\u043D\u0435."
  },
  "37": {
    name: "\u0414\u043E\u043B\u044F \u0432 \u0433\u043B\u0443\u0431\u043E\u043A\u043E\u0432\u043E\u0434\u043D\u043E\u0439 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0435, \u0421\u0430\u0431\u0430\u0445",
    flavor: "\u041F\u0435\u0440\u0441\u043F\u0435\u043A\u0442\u0438\u0432\u0430 \u043A\u043B\u0430\u0441\u0441\u0430 \u041A\u0438\u043A\u0435 \u0443 \u0431\u0435\u0440\u0435\u0433\u043E\u0432 \u041A\u043E\u0442\u0430-\u041A\u0438\u043D\u0430\u0431\u0430\u043B\u0443: \u043C\u0435\u0441\u0442\u043E\u0440\u043E\u0436\u0434\u0435\u043D\u0438\u0435 \u043E\u0433\u0440\u043E\u043C\u043D\u043E, \u0435\u0441\u043B\u0438 \u043F\u043B\u0430\u0441\u0442 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0441\u044F, \u2014 \u0438 \u0441\u0443\u0445\u043E, \u0435\u0441\u043B\u0438 \u043D\u0435\u0442."
  },
  "39": {
    name: "\u041F\u043E\u0434\u044A\u0451\u043C \u0437\u0430\u0442\u043E\u043D\u0443\u0432\u0448\u0435\u0433\u043E \u043A\u043B\u0430\u0434\u0430",
    flavor: "\u041A\u0430\u0440\u0442\u0430 \u043A\u0440\u0443\u0448\u0435\u043D\u0438\u044F, \u043A\u0440\u0430\u043D-\u0431\u0430\u0440\u0436\u0430 \u0438 \u043D\u0438\u043A\u0430\u043A\u0438\u0445 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0439."
  },
  "40": {
    name: "\u041A\u0440\u0443\u0433\u043E\u0441\u0432\u0435\u0442\u043A\u0430 \u0432 \u043E\u0434\u0438\u043D\u043E\u0447\u043A\u0443 \u043F\u043E\u0434 \u043F\u0430\u0440\u0443\u0441\u043E\u043C",
    flavor: "\u041E\u0434\u043D\u0430 \u043B\u043E\u0434\u043A\u0430, \u043E\u0434\u0438\u043D \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442, \u043E\u0434\u0438\u043D \u0441\u0443\u0434\u043E\u0432\u043E\u0439 \u0436\u0443\u0440\u043D\u0430\u043B."
  },
  "41": {
    name: "\u041E\u043F\u0442\u043E\u0432\u043E\u043B\u043E\u043A\u043D\u043E \u0432 \u043A\u0430\u0436\u0434\u044B\u0439 \u0434\u043E\u043C",
    flavor: "\u0412\u0441\u044F \u0434\u043E\u043B\u0438\u043D\u0430 \u0441\u043C\u043E\u0442\u0440\u0438\u0442 \u0441\u0442\u0440\u0438\u043C\u044B \u0447\u0435\u0440\u0435\u0437 \u0432\u0430\u0448\u0438 \u043A\u0430\u0431\u0435\u043B\u0438."
  },
  "43": {
    name: "\u041A\u0440\u0443\u0433\u043E\u0441\u0432\u0435\u0442\u043D\u0430\u044F \u0444\u043E\u0442\u043E\u044D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u044F",
    flavor: "\u0413\u043E\u0434 \u0437\u043E\u043B\u043E\u0442\u044B\u0445 \u0447\u0430\u0441\u043E\u0432 \u043D\u0430 \u0441\u0435\u043C\u0438 \u043A\u043E\u043D\u0442\u0438\u043D\u0435\u043D\u0442\u0430\u0445."
  }
};

// src/engine/data.ts
var PROFESSIONS = professions_default;
var PROFESSIONS_RU = professions_ru_default;
function professionsFor(theme) {
  return theme === "ru" ? PROFESSIONS_RU : PROFESSIONS;
}
var RAT_BOARD = boards_default.RAT_BOARD;
var RAT_BOARD_SIZE = RAT_BOARD.length;
var FAST_BOARD_CLASSIC = boards_default.FAST_BOARD;
var FAST_BOARD_RU = decks_ru_default.FAST_BOARD_RU ?? FAST_BOARD_CLASSIC;
var ACTIVE_FAST_BOARD = FAST_BOARD_CLASSIC;
function setFastBoardTheme(theme) {
  ACTIVE_FAST_BOARD = theme === "ru" ? FAST_BOARD_RU : FAST_BOARD_CLASSIC;
}
function fastBoard() {
  return ACTIVE_FAST_BOARD;
}
function fastBoardSize() {
  return ACTIVE_FAST_BOARD.length;
}
var PETS = misc_default.DOGS;
var D = decks_default;
var DRU = decks_ru_default;
function smallDeals(theme) {
  if (theme === "ru") return DRU.SMALL_DEALS_RU;
  return theme === "offshore" ? D.OFFSHORE_SMALL_DEALS : D.SMALL_DEALS;
}
function bigDeals(theme) {
  if (theme === "ru") return DRU.BIG_DEALS_RU;
  return theme === "offshore" ? D.OFFSHORE_BIG_DEALS : D.BIG_DEALS;
}
function marketCards(theme) {
  if (theme === "ru") return DRU.MARKET_CARDS_RU;
  return theme === "offshore" ? D.OFFSHORE_MARKET_CARDS : D.MARKET_CARDS;
}
function doodads(theme) {
  return theme === "ru" ? DRU.DOODADS_RU : D.DOODADS;
}
var DOODADS = D.DOODADS;
var RU_CARDS = ru_cards_default;
var RU_FAST = ru_misc2_default;
function cardText(card, locale) {
  if (locale === "ru") {
    const t = RU_CARDS[card.id];
    if (t) return t;
  }
  return { title: card.title, flavor: card.flavor };
}
var ACTIVE_THEME = "classic";
function setActiveTheme(t) {
  ACTIVE_THEME = t;
}
var CURRENT_LOCALE = "ru";
function localizedCardTitle(card) {
  return cardText(card, CURRENT_LOCALE).title;
}
function localizedSpaceName(index) {
  const space = fastBoard()[index];
  return fastSpaceText(index, CURRENT_LOCALE)?.name ?? space?.name ?? "";
}
function fastSpaceText(index, locale) {
  const space = fastBoard()[index];
  if (!space || !("name" in space)) return null;
  if (ACTIVE_THEME !== "ru" && locale === "ru") {
    const t = RU_FAST[String(index)];
    if (t) return t;
  }
  return { name: space.name, flavor: space.flavor ?? "" };
}
function dreamSpaces(locale = "ru") {
  const out = [];
  fastBoard().forEach((s, i) => {
    if (s.type !== "dream") return;
    out.push({ index: i, name: fastSpaceText(i, locale)?.name ?? s.name, price: s.price });
  });
  return out;
}
var TOKEN_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#f97316"
];

// src/engine/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffleIndices(count, seed) {
  const arr = Array.from({ length: count }, (_, i) => i);
  const rnd = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// src/engine/table.ts
function createTable(setup) {
  const theme = setup.deckTheme;
  setActiveTheme(theme);
  setFastBoardTheme(theme);
  if (theme === "ru") {
    setRules({ currency: "RUB", fastTrackMultiplier: 50, fastTrackTarget: 1e6, loansEnabled: false });
  } else {
    setRules({ currency: "USD", fastTrackMultiplier: 100, fastTrackTarget: 15e4, loansEnabled: true });
  }
  const pool = professionsFor(theme);
  const seats = setup.seats.map((s, i) => {
    const profession = pool.find((p) => p.id === s.professionId) ?? pool[0];
    return {
      id: `seat-${i}`,
      name: s.name,
      color: TOKEN_COLORS[i % TOKEN_COLORS.length],
      track: "rat",
      position: 0,
      ledger: createLedger(profession, s.name),
      dreamSpace: s.dreamSpace,
      skipTurns: 0,
      outOfGame: false,
      won: false,
      isBot: s.isBot,
      botDifficulty: s.botDifficulty,
      ftCharity: false
    };
  });
  return {
    seed: setup.seed,
    rngCursor: 0,
    deckTheme: theme,
    seats,
    turnIndex: 0,
    phase: "awaitingRoll",
    pending: null,
    decks: {
      small: { order: shuffleIndices(smallDeals(theme).length, setup.seed + 1), next: 0 },
      big: { order: shuffleIndices(bigDeals(theme).length, setup.seed + 2), next: 0 },
      market: { order: shuffleIndices(marketCards(theme).length, setup.seed + 3), next: 0 },
      doodad: { order: shuffleIndices(doodads(theme).length, setup.seed + 4), next: 0 }
    },
    lastRoll: null,
    dreamBumps: {},
    ftOwnership: {},
    log: [],
    winnerId: null,
    turnCounter: 0
  };
}
function currentSeat(t) {
  return t.seats[t.turnIndex];
}
function cloneTable(t) {
  return {
    ...t,
    seats: t.seats.map((s) => ({ ...s })),
    decks: {
      small: { ...t.decks.small },
      big: { ...t.decks.big },
      market: { ...t.decks.market },
      doodad: { ...t.decks.doodad }
    },
    dreamBumps: { ...t.dreamBumps },
    ftOwnership: { ...t.ftOwnership },
    log: [...t.log],
    pending: t.pending ? { ...t.pending } : null,
    lastRoll: t.lastRoll ? [...t.lastRoll] : null
  };
}
function log(t, seatId, text) {
  t.log.push({ at: t.log.length, seatId, text });
  if (t.log.length > 300) t.log.shift();
}
function money(n) {
  if (RULES.currency === "RUB") {
    const s2 = Math.abs(Math.round(n)).toLocaleString("ru-RU");
    return n < 0 ? `\u2212${s2} \u20BD` : `${s2} \u20BD`;
  }
  const s = Math.abs(n).toLocaleString("en-US");
  return n < 0 ? `\u2212$${s}` : `$${s}`;
}
function draw(t, deck, size) {
  const d = t.decks[deck];
  if (d.next >= d.order.length) {
    d.order = shuffleIndices(size, t.seed + t.log.length + deck.length * 7919);
    d.next = 0;
  }
  const idx = d.order[d.next];
  d.next += 1;
  return idx;
}
function seatLedgerEvent(t, seatId, e) {
  const i = t.seats.findIndex((s) => s.id === seatId);
  if (i < 0) return;
  t.seats[i] = { ...t.seats[i], ledger: applyEvent(t.seats[i].ledger, e) };
  if (t.seats[i].ledger.phase === "won" && !t.seats[i].won) {
    t.seats[i] = { ...t.seats[i], won: true };
    t.winnerId ??= t.seats[i].id;
    log(t, seatId, `\u{1F3C6} ${t.seats[i].name} \u0434\u043E\u0441\u0442\u0438\u0433 \u0446\u0435\u043B\u0438!`);
    const active = t.seats.filter((s) => !s.outOfGame && !s.won);
    if (active.length === 0) {
      t.phase = "finished";
      t.pending = { kind: "gameOver" };
    }
  }
}
function diceCountFor(seat) {
  if (seat.track === "fast") return seat.ftCharity ? [3] : [2];
  return seat.ledger.charityTurnsLeft > 0 ? [1, 2] : [1];
}
function marketMatches(t, category) {
  const out = [];
  for (const seat of t.seats) {
    if (seat.outOfGame || seat.track === "fast") continue;
    const assets = [
      ...seat.ledger.realEstate.filter((a) => a.category === category).map((a) => ({ id: a.id, name: a.name, kind: "realEstate", cost: a.cost, debt: a.mortgage })),
      ...seat.ledger.businesses.filter((a) => a.category === category).map((a) => ({ id: a.id, name: a.name, kind: "business", cost: a.cost, debt: a.liability }))
    ];
    if (assets.length) out.push({ seat, assets });
  }
  return out;
}
function stockHolders(t, symbol) {
  return t.seats.filter(
    (s) => !s.outOfGame && s.track === "rat" && s.ledger.stocks.some((l) => l.symbol === symbol)
  );
}
function sellOfferPrice(cost, multiplierPct) {
  return Math.round(cost * multiplierPct / 100);
}
function dreamPriceAt(t, spaceIndex) {
  const s = fastBoard()[spaceIndex];
  if (s.type !== "dream") return 0;
  return s.price * (1 + (t.dreamBumps[spaceIndex] ?? 0));
}
function charityCost(l) {
  return Math.ceil(0.1 * totalIncome(l));
}
function ftCharityCost(l) {
  return Math.ceil(0.1 * fastTrackIncome(l));
}
function dealAffordable(t, card, deckSize) {
  const l = currentSeat(t).ledger;
  if (card.kind === "stock") return l.cash >= card.price;
  if (l.cash >= card.downPayment) return true;
  return !RULES.loansEnabled && deckSize === "big" && card.kind === "realEstate" && card.cashFlow > 0 && l.cash >= Math.round(card.downPayment / 2);
}
function canRecover(l) {
  return l.cash >= 0 && monthlyCashFlow(l) >= 0;
}
function hasSellableAssets(l) {
  return l.stocks.length > 0 || l.realEstate.length > 0 || l.businesses.length > 0;
}
function hasConsumerDebt(l) {
  return l.liabilities.carLoans > 0 || l.liabilities.creditCards > 0 || l.liabilities.retailDebt > 0;
}
function advance(t, seatIdx, steps) {
  const seat = t.seats[seatIdx];
  const size = seat.track === "rat" ? RAT_BOARD_SIZE : fastBoardSize();
  let payouts = 0;
  for (let i = 1; i <= steps; i++) {
    const pos = (seat.position + i) % size;
    const isPayday = seat.track === "rat" ? RAT_BOARD[pos] === "paycheck" : fastBoard()[pos].type === "cashflowDay";
    if (isPayday) payouts++;
  }
  t.seats[seatIdx] = { ...seat, position: (seat.position + steps) % size };
  for (let i = 0; i < payouts; i++) {
    if (seat.track === "rat") {
      seatLedgerEvent(t, seat.id, { type: "PAYCHECK" });
    } else {
      seatLedgerEvent(t, seat.id, { type: "CASHFLOW_DAY" });
    }
  }
  if (payouts > 0) {
    const l = t.seats[seatIdx].ledger;
    const amount = seat.track === "rat" ? monthlyCashFlow(l) : fastTrackIncome(l);
    log(t, seat.id, `\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430 \xD7${payouts}: ${money(amount)}`);
  }
}
function resolveLanding(t, seatIdx) {
  const seat = t.seats[seatIdx];
  const l = seat.ledger;
  if (l.cash < 0) {
    t.pending = { kind: "bankruptcy" };
    t.phase = "resolving";
    log(t, seat.id, "\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0445 \u043D\u0435 \u0445\u0432\u0430\u0442\u0438\u043B\u043E \u2014 \u0431\u0430\u043D\u043A\u0440\u043E\u0442\u0441\u0442\u0432\u043E");
    return;
  }
  if (seat.track === "rat") {
    const space2 = RAT_BOARD[seat.position];
    switch (space2) {
      case "opportunity":
        t.pending = { kind: "chooseDeal" };
        t.phase = "resolving";
        return;
      case "market": {
        const deck = marketCards(t.deckTheme);
        let card = null;
        for (let tries = 0; tries < 4; tries++) {
          const candidate = deck[draw(t, "market", deck.length)];
          if (marketCardIsLive(t, candidate)) {
            card = candidate;
            break;
          }
        }
        if (!card) {
          log(t, seat.id, "\u0420\u044B\u043D\u043E\u043A \u043F\u0443\u0441\u0442 \u2014 \u0432\u043C\u0435\u0441\u0442\u043E \u043D\u0435\u0433\u043E \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C");
          t.pending = { kind: "chooseDeal" };
          t.phase = "resolving";
          return;
        }
        applyMarketAuto(t, card);
        t.pending = { kind: "market", card };
        t.phase = "resolving";
        return;
      }
      case "doodad": {
        const deck = doodads(t.deckTheme);
        const idx = draw(t, "doodad", deck.length);
        t.pending = { kind: "doodad", card: deck[idx] };
        t.phase = "resolving";
        return;
      }
      case "charity":
        t.pending = { kind: "charity" };
        t.phase = "resolving";
        return;
      case "baby": {
        seatLedgerEvent(t, seat.id, { type: "PET" });
        const pets = t.seats[seatIdx].ledger.pets;
        log(t, seat.id, `\u0412 \u0434\u043E\u043C\u0435 \u043F\u043E\u044F\u0432\u0438\u043B\u0441\u044F \u043F\u0438\u0442\u043E\u043C\u0435\u0446 (\u0432\u0441\u0435\u0433\u043E ${pets})`);
        t.phase = "turnEnd";
        return;
      }
      case "downsized":
        t.pending = { kind: "downsized" };
        t.phase = "resolving";
        return;
      case "paycheck":
        t.phase = "turnEnd";
        return;
    }
  }
  const space = fastBoard()[seat.position];
  switch (space.type) {
    case "cashflowDay":
      t.phase = "turnEnd";
      return;
    case "taxAudit":
    case "lawsuit": {
      const before = l.cash;
      seatLedgerEvent(t, seat.id, { type: space.type === "taxAudit" ? "TAX_AUDIT" : "LAWSUIT" });
      const lost = before - t.seats[seatIdx].ledger.cash;
      log(t, seat.id, `${space.type === "taxAudit" ? "\u041D\u0430\u043B\u043E\u0433\u043E\u0432\u0430\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430" : "\u0418\u0441\u043A"}: \u043C\u0438\u043D\u0443\u0441 ${money(lost)}`);
      t.phase = "turnEnd";
      return;
    }
    case "divorce":
      seatLedgerEvent(t, seat.id, { type: "DIVORCE" });
      log(t, seat.id, "\u0420\u0430\u0437\u0432\u043E\u0434: \u043D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 \u043E\u0431\u043D\u0443\u043B\u0435\u043D\u044B");
      t.phase = "turnEnd";
      return;
    case "downsized": {
      const amount = fastTrackIncome(l);
      seatLedgerEvent(t, seat.id, { type: "FT_DOWNSIZED", amount });
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 2 };
      log(t, seat.id, `\u0421\u043E\u043A\u0440\u0430\u0449\u0435\u043D\u0438\u0435: \u043C\u0438\u043D\u0443\u0441 ${money(amount)}, \u043F\u0440\u043E\u043F\u0443\u0441\u043A 2 \u0445\u043E\u0434\u043E\u0432`);
      t.phase = "turnEnd";
      return;
    }
    case "charity":
      if (seat.ftCharity) {
        t.phase = "turnEnd";
        return;
      }
      t.pending = { kind: "ftCharity" };
      t.phase = "resolving";
      return;
    case "business":
      if (t.ftOwnership[seat.position]) {
        log(t, seat.id, "\u0418\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u044F \u0443\u0436\u0435 \u0432\u044B\u043A\u0443\u043F\u043B\u0435\u043D\u0430 \u0434\u0440\u0443\u0433\u0438\u043C \u0438\u0433\u0440\u043E\u043A\u043E\u043C");
        t.phase = "turnEnd";
        return;
      }
      t.pending = { kind: "ftBusiness", space: seat.position };
      t.phase = "resolving";
      return;
    case "venture":
      if (t.ftOwnership[seat.position]) {
        log(t, seat.id, "\u041F\u0440\u043E\u0435\u043A\u0442 \u0443\u0436\u0435 \u0437\u0430\u0431\u0440\u0430\u043B\u0438");
        t.phase = "turnEnd";
        return;
      }
      t.pending = { kind: "ftVenture", space: seat.position };
      t.phase = "resolving";
      return;
    case "dream": {
      if (seat.dreamSpace === seat.position) {
        t.pending = { kind: "ftDream", space: seat.position };
        t.phase = "resolving";
        return;
      }
      t.dreamBumps[seat.position] = (t.dreamBumps[seat.position] ?? 0) + 1;
      log(t, seat.id, `\u0427\u0443\u0436\u0430\u044F \u043C\u0435\u0447\u0442\u0430 \xAB${localizedSpaceName(seat.position)}\xBB \u043F\u043E\u0434\u043E\u0440\u043E\u0436\u0430\u043B\u0430`);
      t.phase = "turnEnd";
      return;
    }
  }
}
function marketCardIsLive(t, card) {
  switch (card.kind) {
    case "sellOffer":
      return marketMatches(t, card.category).length > 0;
    case "stockPrice":
      return stockHolders(t, card.symbol).length > 0;
    case "stockSplit":
      return t.seats.some(
        (s) => !s.outOfGame && s.track === "rat" && s.ledger.stocks.some((l) => l.symbol === card.symbol.toUpperCase())
      );
    case "windfall":
      if (card.amountPerPartnership)
        return t.seats.some((s) => !s.outOfGame && s.ledger.businesses.some((b) => b.category === "partnership"));
      return true;
    case "payRaise":
      return true;
  }
}
function applyMarketAuto(t, card) {
  if (card.kind === "stockSplit") {
    for (const s of t.seats) {
      if (s.outOfGame || s.track === "fast") continue;
      seatLedgerEvent(t, s.id, { type: "STOCK_SPLIT", symbol: card.symbol, direction: card.direction });
    }
    log(t, null, `${card.symbol}: ${card.direction === "split" ? "\u0441\u043F\u043B\u0438\u0442 \xD72" : "\u043E\u0431\u0440\u0430\u0442\u043D\u044B\u0439 \u0441\u043F\u043B\u0438\u0442 \xF72"}`);
  } else if (card.kind === "windfall") {
    for (const s of t.seats) {
      if (s.outOfGame || s.track === "fast") continue;
      let amount = card.flatAmount ?? 0;
      if (card.amountPerRealEstate) amount += card.amountPerRealEstate * s.ledger.realEstate.length;
      if (card.amountPerPartnership)
        amount += card.amountPerPartnership * s.ledger.businesses.filter((b) => b.category === "partnership").length;
      if (amount > 0) {
        seatLedgerEvent(t, s.id, { type: "ADJUST_CASH", amount });
        log(t, s.id, `${card.title}: +${money(amount)}`);
      }
    }
  } else if (card.kind === "payRaise") {
    const seat = currentSeat(t);
    seatLedgerEvent(t, seat.id, { type: "SALARY_RAISE", amount: card.amount });
    log(t, seat.id, `\u041F\u043E\u0432\u044B\u0448\u0435\u043D\u0438\u0435: \u0437\u0430\u0440\u043F\u043B\u0430\u0442\u0430 +${money(card.amount)}/\u043C\u0435\u0441`);
  }
}
function nextTurn(t) {
  const alive = t.seats.filter((s) => !s.outOfGame && !s.won);
  if (alive.length === 0) {
    t.phase = "finished";
    t.pending = { kind: "gameOver" };
    return;
  }
  if (alive.length === 1 && t.seats.filter((s) => !s.outOfGame).length > 1 && t.winnerId) {
    t.phase = "finished";
    t.pending = { kind: "gameOver" };
    return;
  }
  if (alive.length === 1 && t.seats.length > 1 && t.seats.every((s) => s.outOfGame || s.id === alive[0].id)) {
    t.winnerId ??= alive[0].id;
    t.phase = "finished";
    t.pending = { kind: "gameOver" };
    return;
  }
  let guard = 0;
  let i = t.turnIndex;
  while (guard++ < t.seats.length * 5) {
    i = (i + 1) % t.seats.length;
    const s = t.seats[i];
    if (s.outOfGame || s.won) continue;
    if (s.skipTurns > 0) {
      t.seats[i] = { ...s, skipTurns: s.skipTurns - 1 };
      const left = s.skipTurns - 1;
      log(t, s.id, left > 0 ? `\u041F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0445\u043E\u0434, \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0435\u0449\u0451 ${left}` : "\u041F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0445\u043E\u0434 \u2014 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439");
      continue;
    }
    break;
  }
  t.turnIndex = i;
  t.turnCounter += 1;
  t.phase = "awaitingRoll";
  t.pending = null;
  t.lastRoll = null;
}
function applyTableEvent(prev, event) {
  if (prev.phase === "finished" && event.type !== "END_TURN") return prev;
  const t = cloneTable(prev);
  const seatIdx = t.turnIndex;
  const seat = t.seats[seatIdx];
  const l = seat.ledger;
  switch (event.type) {
    case "ROLL": {
      if (t.phase !== "awaitingRoll") return prev;
      const allowed = diceCountFor(seat);
      if (!allowed.includes(event.dice.length)) return prev;
      if (event.dice.some((d) => d < 1 || d > 6 || !Number.isInteger(d))) return prev;
      t.lastRoll = event.dice;
      if (l.charityTurnsLeft > 0) seatLedgerEvent(t, seat.id, { type: "CHARITY_TURN_USED" });
      const steps = event.dice.reduce((a, b) => a + b, 0);
      log(t, seat.id, `\u0411\u0440\u043E\u0441\u043E\u043A: ${event.dice.join(" + ")} = ${steps}`);
      advance(t, seatIdx, steps);
      if (t.phase !== "finished") resolveLanding(t, seatIdx);
      return t;
    }
    case "CHOOSE_DEAL": {
      if (t.pending?.kind !== "chooseDeal") return prev;
      const list = event.size === "small" ? smallDeals(t.deckTheme) : bigDeals(t.deckTheme);
      let card = list[draw(t, event.size, list.length)];
      for (let tries = 0; tries < 4 && !dealAffordable(t, card, event.size); tries++) {
        card = list[draw(t, event.size, list.length)];
      }
      t.pending = { kind: "deal", deck: event.size, card };
      return t;
    }
    case "BUY_DEAL": {
      if (t.pending?.kind !== "deal") return prev;
      const card = t.pending.card;
      if (card.kind === "stock") return prev;
      const withInvestor = !!event.withInvestor && !RULES.loansEnabled && card.kind !== "business";
      const investorShare = withInvestor ? 0.5 : void 0;
      const owed = Math.round(card.downPayment * (1 - (investorShare ?? 0)));
      if (l.cash < owed) return prev;
      if (card.kind === "realEstate") {
        seatLedgerEvent(t, seat.id, {
          type: "BUY_REAL_ESTATE",
          id: `${card.id}-${t.log.length}`,
          name: localizedCardTitle(card),
          cost: card.cost,
          downPayment: card.downPayment,
          mortgage: card.mortgage,
          cashFlow: card.cashFlow,
          category: card.category,
          investorShare
        });
      } else {
        seatLedgerEvent(t, seat.id, {
          type: "BUY_BUSINESS",
          id: `${card.id}-${t.log.length}`,
          name: localizedCardTitle(card),
          cost: card.cost,
          downPayment: card.downPayment,
          liability: card.liability,
          cashFlow: card.cashFlow,
          category: card.category,
          growthPerPayday: card.growthPerPayday,
          growthCap: card.growthCap
        });
      }
      log(
        t,
        seat.id,
        withInvestor ? `\u0412\u043E\u0448\u0451\u043B \u0432 \u0434\u043E\u043B\u044E: ${localizedCardTitle(card)} \u2014 \u0441\u0432\u043E\u0438 ${money(Math.round(card.downPayment / 2))}, \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u0434\u043E\u0445\u043E\u0434\u0430 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0443` : `\u041A\u0443\u043F\u0438\u043B: ${localizedCardTitle(card)} \u0437\u0430 ${money(card.downPayment)} (${money(card.cashFlow)}/\u043C\u0435\u0441)`
      );
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    case "BUY_STOCK_SHARES": {
      if (t.pending?.kind !== "deal") return prev;
      const card = t.pending.card;
      if (card.kind !== "stock") return prev;
      const shares = Math.floor(event.shares);
      if (shares <= 0) return prev;
      const buyer = event.seatId ? t.seats.find((x) => x.id === event.seatId) : seat;
      if (!buyer || buyer.outOfGame || buyer.track === "fast") return prev;
      const total = shares * card.price;
      if (buyer.ledger.cash < total) return prev;
      seatLedgerEvent(t, buyer.id, {
        type: "BUY_STOCK",
        id: `${card.symbol}-${t.log.length}`,
        symbol: card.symbol,
        shares,
        costPerShare: card.price,
        dividendPerShareMonthly: card.dividendPerShare ?? 0
      });
      log(t, buyer.id, `${buyer.name} \u043A\u0443\u043F\u0438\u043B ${shares} \xD7 ${card.symbol} \u043F\u043E ${money(card.price)}`);
      if (buyer.id === seat.id) {
        t.pending = null;
        t.phase = "turnEnd";
      }
      return t;
    }
    /** Продать может любой держатель, пока карта на столе. */
    case "SELL_STOCK_LOT": {
      const holder = t.seats.find((s) => s.id === event.seatId);
      if (!holder || holder.outOfGame) return prev;
      const lot = holder.ledger.stocks.find((x) => x.id === event.lotId);
      if (!lot) return prev;
      seatLedgerEvent(t, event.seatId, {
        type: "SELL_STOCK",
        lotId: event.lotId,
        shares: event.shares,
        pricePerShare: event.pricePerShare
      });
      log(
        t,
        event.seatId,
        `${holder.name} \u043F\u0440\u043E\u0434\u0430\u043B ${event.shares} \xD7 ${lot.symbol} \u043F\u043E ${money(event.pricePerShare)}`
      );
      return t;
    }
    case "ACCEPT_OFFER": {
      if (t.pending?.kind !== "market" || t.pending.card.kind !== "sellOffer") return prev;
      const card = t.pending.card;
      const holder = t.seats.find((s) => s.id === event.seatId);
      if (!holder || holder.outOfGame || holder.track === "fast") return prev;
      const re = holder.ledger.realEstate.find((a) => a.id === event.assetId);
      const biz = holder.ledger.businesses.find((a) => a.id === event.assetId);
      const asset = re ?? biz;
      if (!asset || asset.category !== card.category) return prev;
      const price = sellOfferPrice(asset.cost, card.multiplierPct);
      if (re) {
        seatLedgerEvent(t, event.seatId, { type: "SELL_REAL_ESTATE", assetId: event.assetId, salePrice: price });
      } else {
        seatLedgerEvent(t, event.seatId, { type: "SELL_BUSINESS", assetId: event.assetId, salePrice: price });
      }
      log(t, event.seatId, `${holder.name} \u043F\u0440\u043E\u0434\u0430\u043B \xAB${asset.name}\xBB \u0437\u0430 ${money(price)} (${card.multiplierPct}%)`);
      return t;
    }
    case "PAY_DOODAD": {
      if (t.pending?.kind !== "doodad") return prev;
      const card = t.pending.card;
      if (event.financed) {
        const forced = !RULES.loansEnabled && l.cash < card.amount;
        if (!card.financeable && !forced) return prev;
        seatLedgerEvent(t, seat.id, { type: "FINANCE_DOODAD", amount: card.amount });
        log(
          t,
          seat.id,
          RULES.loansEnabled ? `\xAB${card.title}\xBB \u043D\u0430 \u043A\u0440\u0435\u0434\u0438\u0442\u043A\u0443: +${money(Math.ceil(0.03 * card.amount))}/\u043C\u0435\u0441` : `\xAB${card.title}\xBB \u0432 \u0440\u0430\u0441\u0441\u0440\u043E\u0447\u043A\u0443: ${money(Math.ceil(card.amount / 10))}/\u043C\u0435\u0441 \xD7 10`
        );
      } else {
        if (l.cash < card.amount) return prev;
        seatLedgerEvent(t, seat.id, { type: "DOODAD", amount: card.amount });
        log(t, seat.id, `\u0422\u0440\u0430\u0442\u0430: ${card.title} \u2014 ${money(card.amount)}`);
      }
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    case "ACCEPT_CHARITY": {
      if (t.pending?.kind !== "charity") return prev;
      const cost = charityCost(l);
      if (l.cash < cost) return prev;
      seatLedgerEvent(t, seat.id, { type: "CHARITY" });
      log(t, seat.id, `\u041F\u043E\u0436\u0435\u0440\u0442\u0432\u043E\u0432\u0430\u043B ${money(cost)} \u2014 3 \u0445\u043E\u0434\u0430 \u043C\u043E\u0436\u043D\u043E \u043A\u0438\u0434\u0430\u0442\u044C 2 \u043A\u0443\u0431\u0438\u043A\u0430`);
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    case "DECLINE_CHARITY": {
      if (t.pending?.kind !== "charity") return prev;
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    case "PAY_DOWNSIZED": {
      if (t.pending?.kind !== "downsized") return prev;
      const cost = totalExpenses(l);
      if (RULES.loansEnabled && l.cash < cost) return prev;
      seatLedgerEvent(t, seat.id, { type: "DOWNSIZED" });
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 2 };
      log(t, seat.id, `\u0423\u0432\u043E\u043B\u044C\u043D\u0435\u043D\u0438\u0435: \u0437\u0430\u043F\u043B\u0430\u0442\u0438\u043B ${money(cost)}, \u043F\u0440\u043E\u043F\u0443\u0441\u043A 2 \u0445\u043E\u0434\u043E\u0432`);
      if (t.seats[seatIdx].ledger.cash < 0) {
        t.pending = { kind: "bankruptcy" };
        t.phase = "resolving";
        log(t, seat.id, "\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 \u0443\u0448\u043B\u0438 \u0432 \u043C\u0438\u043D\u0443\u0441 \u2014 \u0431\u0430\u043D\u043A\u0440\u043E\u0442\u0441\u0442\u0432\u043E");
      } else {
        t.pending = null;
        t.phase = "turnEnd";
      }
      return t;
    }
    case "TAKE_LOAN": {
      if (seat.track === "fast") return prev;
      const step = RULES.currency === "RUB" ? 1e4 : 1e3;
      const amount = Math.round(event.amount / step) * step;
      if (amount < step) return prev;
      seatLedgerEvent(t, seat.id, { type: "TAKE_LOAN", amount });
      log(
        t,
        seat.id,
        RULES.loansEnabled ? `\u0412\u0437\u044F\u043B \u043A\u0440\u0435\u0434\u0438\u0442 ${money(amount)} (+${money(amount / 10)}/\u043C\u0435\u0441)` : `\u0411\u0435\u0441\u043F\u0440\u043E\u0446\u0435\u043D\u0442\u043D\u044B\u0439 \u0437\u0430\u0451\u043C ${money(amount)} \u2014 \u0432\u0435\u0440\u043D\u0451\u0442 \u0440\u043E\u0432\u043D\u043E \u0441\u0442\u043E\u043B\u044C\u043A\u043E \u0436\u0435, ${money(amount / 10)}/\u043C\u0435\u0441`
      );
      return t;
    }
    case "REPAY_LOAN": {
      const step = RULES.currency === "RUB" ? 1e4 : 1e3;
      const amount = Math.round(event.amount / step) * step;
      if (amount < step || l.cash < amount || l.liabilities.bankLoan < amount) return prev;
      seatLedgerEvent(t, seat.id, { type: "REPAY_LOAN", amount });
      log(t, seat.id, `\u041F\u043E\u0433\u0430\u0441\u0438\u043B \u043A\u0440\u0435\u0434\u0438\u0442 \u043D\u0430 ${money(amount)}`);
      return t;
    }
    case "PAY_OFF_DEBT": {
      const balance = l.liabilities[event.debt];
      if (balance <= 0 || l.cash < balance) return prev;
      seatLedgerEvent(t, seat.id, { type: "PAY_OFF_DEBT", debt: event.debt });
      log(t, seat.id, `\u0417\u0430\u043A\u0440\u044B\u043B \u0434\u043E\u043B\u0433: ${money(balance)}`);
      return t;
    }
    case "ENTER_FAST_TRACK": {
      if (seat.track !== "rat" || !isOutOfRatRace(l)) return prev;
      const buyout = 100 * passiveIncome(l);
      seatLedgerEvent(t, seat.id, { type: "ENTER_FAST_TRACK" });
      t.seats[seatIdx] = { ...t.seats[seatIdx], track: "fast", position: 0 };
      log(t, seat.id, `\u{1F389} \u0412\u044B\u0440\u0432\u0430\u043B\u0441\u044F \u0438\u0437 \u041A\u0440\u0443\u0433\u0430! \u0412\u044B\u043A\u0443\u043F ${money(buyout)}`);
      return t;
    }
    /*
     * Индекс клетки берём ДО seatLedgerEvent: покупка может привести к победе,
     * и тогда pending подменяется на gameOver, а space из него читать уже нельзя.
     */
    case "BUY_FT_BUSINESS": {
      if (t.pending?.kind !== "ftBusiness") return prev;
      const spaceIdx = t.pending.space;
      const space = fastBoard()[spaceIdx];
      if (space.type !== "business") return prev;
      if (l.cash < space.downPayment) return prev;
      const name = localizedSpaceName(spaceIdx);
      seatLedgerEvent(t, seat.id, {
        type: "BUY_FT_BUSINESS",
        id: `ft-${spaceIdx}`,
        name,
        downPayment: space.downPayment,
        cashFlow: space.cashFlow
      });
      t.ftOwnership[spaceIdx] = seat.id;
      log(t, seat.id, `\u0418\u043D\u0432\u0435\u0441\u0442\u0438\u0440\u043E\u0432\u0430\u043B \u0432 \xAB${name}\xBB: +${money(space.cashFlow)}/\u043C\u0435\u0441`);
      if (t.phase !== "finished") {
        t.pending = null;
        t.phase = "turnEnd";
      }
      return t;
    }
    case "TRY_VENTURE": {
      if (t.pending?.kind !== "ftVenture") return prev;
      const spaceIdx = t.pending.space;
      const space = fastBoard()[spaceIdx];
      if (space.type !== "venture") return prev;
      if (l.cash < space.downPayment) return prev;
      const die = event.die;
      if (!Number.isInteger(die) || die < 1 || die > 6) return prev;
      if (die >= space.threshold) {
        seatLedgerEvent(t, seat.id, {
          type: "BUY_FT_BUSINESS",
          id: `ft-${spaceIdx}`,
          name: localizedSpaceName(spaceIdx),
          downPayment: space.downPayment,
          cashFlow: space.cashFlow
        });
        t.ftOwnership[spaceIdx] = seat.id;
        log(t, seat.id, `\u{1F3B2} ${die} \u2014 \u043F\u0440\u043E\u0435\u043A\u0442 \u0432\u044B\u0441\u0442\u0440\u0435\u043B\u0438\u043B! +${money(space.cashFlow)}/\u043C\u0435\u0441`);
      } else {
        seatLedgerEvent(t, seat.id, { type: "FT_STAKE_LOST", amount: space.downPayment });
        log(t, seat.id, `\u{1F3B2} ${die} \u2014 \u0441\u0442\u0430\u0432\u043A\u0430 ${money(space.downPayment)} \u0441\u0433\u043E\u0440\u0435\u043B\u0430`);
      }
      if (t.phase !== "finished") {
        t.pending = null;
        t.phase = "turnEnd";
      }
      return t;
    }
    case "BUY_DREAM": {
      if (t.pending?.kind !== "ftDream") return prev;
      const spaceIdx = t.pending.space;
      const space = fastBoard()[spaceIdx];
      if (space.type !== "dream") return prev;
      const price = dreamPriceAt(t, spaceIdx);
      if (l.cash < price) return prev;
      const name = localizedSpaceName(spaceIdx);
      seatLedgerEvent(t, seat.id, { type: "BUY_DREAM", name, pricePaid: price });
      log(t, seat.id, `\u{1F3C6} \u041A\u0443\u043F\u0438\u043B \u043C\u0435\u0447\u0442\u0443 \xAB${name}\xBB \u0437\u0430 ${money(price)}`);
      return t;
    }
    case "ACCEPT_FT_CHARITY": {
      if (t.pending?.kind !== "ftCharity") return prev;
      const cost = ftCharityCost(l);
      if (l.cash < cost) return prev;
      seatLedgerEvent(t, seat.id, { type: "ADJUST_CASH", amount: -cost });
      t.seats[seatIdx] = { ...t.seats[seatIdx], ftCharity: true };
      log(t, seat.id, `\u041F\u043E\u0436\u0435\u0440\u0442\u0432\u043E\u0432\u0430\u043B ${money(cost)} \u2014 \u0442\u0435\u043F\u0435\u0440\u044C 3 \u043A\u0443\u0431\u0438\u043A\u0430 \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u0438\u0433\u0440\u044B`);
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    // ─── Банкротство ───
    case "BANKRUPTCY_SELL": {
      if (t.pending?.kind !== "bankruptcy") return prev;
      seatLedgerEvent(t, seat.id, {
        type: "FORCED_SALE",
        assetKind: event.assetKind,
        assetId: event.assetId
      });
      log(t, seat.id, "\u041F\u0440\u043E\u0434\u0430\u043B \u0430\u043A\u0442\u0438\u0432 \u0431\u0430\u043D\u043A\u0443 \u0437\u0430 \u043F\u043E\u043B\u0446\u0435\u043D\u044B");
      return t;
    }
    case "BANKRUPTCY_HALVE": {
      if (t.pending?.kind !== "bankruptcy") return prev;
      if (hasSellableAssets(l) || !hasConsumerDebt(l)) return prev;
      seatLedgerEvent(t, seat.id, { type: "HALVE_CONSUMER_DEBT" });
      log(t, seat.id, "\u041F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0435 \u0434\u043E\u043B\u0433\u0438 \u0443\u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0435\u043D\u044B");
      return t;
    }
    case "BANKRUPTCY_RECOVER": {
      if (t.pending?.kind !== "bankruptcy" || !canRecover(l)) return prev;
      t.seats[seatIdx] = { ...t.seats[seatIdx], skipTurns: 3 };
      log(t, seat.id, "\u0412\u044B\u043A\u0430\u0440\u0430\u0431\u043A\u0430\u043B\u0441\u044F \u2014 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 3 \u0445\u043E\u0434\u0430");
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    case "BANKRUPTCY_QUIT": {
      if (t.pending?.kind !== "bankruptcy") return prev;
      seatLedgerEvent(t, seat.id, { type: "DECLARE_GAME_OVER" });
      t.seats[seatIdx] = { ...t.seats[seatIdx], outOfGame: true };
      log(t, seat.id, `${seat.name} \u0431\u0430\u043D\u043A\u0440\u043E\u0442 \u0438 \u0432\u044B\u0431\u044B\u0432\u0430\u0435\u0442`);
      t.pending = null;
      nextTurn(t);
      return t;
    }
    case "PASS_CARD": {
      if (!t.pending) return prev;
      if (t.pending.kind === "doodad" || t.pending.kind === "bankruptcy") return prev;
      t.pending = null;
      t.phase = "turnEnd";
      return t;
    }
    /** Досрочно завершить партию — победители уже известны, остальные согласились. */
    case "FINISH_GAME": {
      t.phase = "finished";
      t.pending = { kind: "gameOver" };
      return t;
    }
    case "END_TURN": {
      if (t.phase === "finished") return prev;
      if (t.pending && t.pending.kind !== "market" && t.pending.kind !== "deal") return prev;
      t.pending = null;
      nextTurn(t);
      return t;
    }
  }
  return prev;
}

// src/data/bot-profiles.json
var bot_profiles_default = {
  easy: {
    buyDealChance: 0.25,
    requirePositiveFlow: false,
    bufferMonths: 0,
    bigDealCash: null,
    leverage: false,
    stockBuyQuantile: 0.5,
    stockSellQuantile: 0.5,
    stockCashFraction: 0.2,
    marketSellMultiple: null,
    dumpNegativeFlowAt: null,
    charity: "never",
    ventureCashFraction: 0,
    laneBuyCashMultiple: 2,
    repayIdle: false
  },
  medium: {
    buyDealChance: 1,
    requirePositiveFlow: true,
    bufferMonths: 0.5,
    bigDealCash: 2e4,
    leverage: false,
    stockBuyQuantile: 0.45,
    stockSellQuantile: 0.6,
    stockCashFraction: 0.3,
    marketSellMultiple: 1.2,
    dumpNegativeFlowAt: 1,
    charity: "sometimes",
    ventureCashFraction: 0,
    laneBuyCashMultiple: 1,
    repayIdle: false
  },
  high: {
    buyDealChance: 1,
    requirePositiveFlow: true,
    bufferMonths: 1,
    bigDealCash: 15e3,
    leverage: true,
    stockBuyQuantile: 0.25,
    stockSellQuantile: 0.75,
    stockCashFraction: 0.6,
    marketSellMultiple: 1.4,
    dumpNegativeFlowAt: 1,
    charity: "rich",
    ventureCashFraction: 0.3,
    laneBuyCashMultiple: 1,
    repayIdle: false
  },
  unreal: {
    buyDealChance: 1,
    requirePositiveFlow: false,
    bufferMonths: 0.5,
    bigDealCash: 0,
    leverage: true,
    stockBuyQuantile: 0.1,
    stockSellQuantile: 0.95,
    stockCashFraction: 0.8,
    marketSellMultiple: 1.5,
    dumpNegativeFlowAt: 0.9,
    charity: "always",
    ventureCashFraction: 0.9,
    laneBuyCashMultiple: 1,
    repayIdle: true
  }
};

// src/engine/bots.ts
var BOT_PROFILES = bot_profiles_default;
var inf = (v) => v === null ? Infinity : v;
function quantilePrice(range, q) {
  return range[0] + (range[1] - range[0]) * q;
}
function cashBuffer(seat, p) {
  return Math.round(totalExpenses(seat.ledger) * p.bufferMonths);
}
function decideBotEvent(t, rnd) {
  const seat = currentSeat(t);
  if (!seat.isBot) return null;
  const p = BOT_PROFILES[seat.botDifficulty];
  const l = seat.ledger;
  if (t.pending?.kind === "bankruptcy") {
    if (canRecover(l)) return { type: "BANKRUPTCY_RECOVER" };
    if (hasSellableAssets(l)) {
      const worst = [...l.realEstate].sort((a, b) => a.cashFlow - b.cashFlow)[0] ?? [...l.businesses].sort((a, b) => a.cashFlow - b.cashFlow)[0];
      if (worst) {
        const kind = l.realEstate.includes(worst) ? "realEstate" : "business";
        return { type: "BANKRUPTCY_SELL", assetKind: kind, assetId: worst.id };
      }
      if (l.stocks.length) {
        return { type: "BANKRUPTCY_SELL", assetKind: "stock", assetId: l.stocks[0].id };
      }
    }
    if (hasConsumerDebt(l)) return { type: "BANKRUPTCY_HALVE" };
    return { type: "BANKRUPTCY_QUIT" };
  }
  if (t.phase === "awaitingRoll" && seat.track === "rat" && isOutOfRatRace(l)) {
    return { type: "ENTER_FAST_TRACK" };
  }
  if (t.phase === "awaitingRoll") {
    const allowed = diceCountFor(seat);
    const count = allowed[allowed.length - 1];
    const dice = Array.from({ length: count }, () => 1 + Math.floor(rnd() * 6));
    return { type: "ROLL", dice };
  }
  const pending = t.pending;
  if (!pending) {
    if (t.phase === "turnEnd") {
      const step = RULES.currency === "RUB" ? 1e4 : 1e3;
      if (p.repayIdle && l.liabilities.bankLoan >= step && l.cash >= step + cashBuffer(seat, p)) {
        return { type: "REPAY_LOAN", amount: step };
      }
      return { type: "END_TURN" };
    }
    return null;
  }
  switch (pending.kind) {
    case "chooseDeal": {
      const canBig = l.cash >= inf(p.bigDealCash);
      return { type: "CHOOSE_DEAL", size: canBig ? "big" : "small" };
    }
    case "deal": {
      const card = pending.card;
      if (card.kind === "stock") {
        const s = card;
        const buyBelow = quantilePrice(s.range, p.stockBuyQuantile);
        const worthIt = s.price <= buyBelow || (s.dividendPerShare ?? 0) > 0;
        if (!worthIt) return { type: "PASS_CARD" };
        const spendable = Math.max(0, l.cash - cashBuffer(seat, p)) * p.stockCashFraction;
        const shares = Math.floor(spendable / s.price);
        if (shares < 1) return { type: "PASS_CARD" };
        return { type: "BUY_STOCK_SHARES", shares };
      }
      if (rnd() > p.buyDealChance) return { type: "PASS_CARD" };
      if (p.requirePositiveFlow && card.cashFlow <= 0) return { type: "PASS_CARD" };
      const need = card.downPayment;
      if (l.cash - need < cashBuffer(seat, p)) {
        const step = RULES.currency === "RUB" ? 1e4 : 1e3;
        if (p.leverage && seat.track === "rat" && card.cashFlow > 0) {
          const short = need + cashBuffer(seat, p) - l.cash;
          const loan = Math.ceil(short / step) * step;
          if (loan > 0 && card.cashFlow > loan / 10) return { type: "TAKE_LOAN", amount: loan };
        }
        if (!RULES.loansEnabled && card.kind === "realEstate" && card.cashFlow > 0 && l.cash - Math.round(need / 2) >= cashBuffer(seat, p)) {
          return { type: "BUY_DEAL", withInvestor: true };
        }
        return { type: "PASS_CARD" };
      }
      return { type: "BUY_DEAL" };
    }
    case "market": {
      const card = pending.card;
      if (card.kind === "sellOffer") {
        const mult = inf(p.marketSellMultiple);
        for (const m of marketMatches(t, card.category)) {
          if (m.seat.id !== seat.id) continue;
          for (const a of m.assets) {
            const price = sellOfferPrice(a.cost, card.multiplierPct);
            if (price >= a.cost * mult) {
              return { type: "ACCEPT_OFFER", seatId: seat.id, assetId: a.id };
            }
          }
        }
      }
      if (card.kind === "stockPrice") {
        const sellAbove = quantilePrice(
          [1, 40],
          p.stockSellQuantile
        );
        const lot = l.stocks.find((x) => x.symbol === card.symbol);
        if (lot && card.price >= lot.costPerShare && card.price >= sellAbove) {
          return {
            type: "SELL_STOCK_LOT",
            seatId: seat.id,
            lotId: lot.id,
            shares: lot.shares,
            pricePerShare: card.price
          };
        }
      }
      return { type: "END_TURN" };
    }
    case "doodad": {
      const card = pending.card;
      if (l.cash >= card.amount) return { type: "PAY_DOODAD", financed: false };
      if (card.financeable) return { type: "PAY_DOODAD", financed: true };
      const step = RULES.currency === "RUB" ? 1e4 : 1e3;
      const loan = Math.ceil((card.amount - l.cash) / step) * step;
      if (seat.track === "rat" && loan > 0) return { type: "TAKE_LOAN", amount: loan };
      return { type: "PAY_DOODAD", financed: !RULES.loansEnabled };
    }
    case "charity": {
      const cost = charityCost(l);
      const want = p.charity === "always" ? true : p.charity === "rich" ? l.cash > cost * 4 : p.charity === "sometimes" ? l.cash > cost * 8 && rnd() < 0.5 : false;
      if (want && l.cash >= cost) return { type: "ACCEPT_CHARITY" };
      return { type: "DECLINE_CHARITY" };
    }
    case "downsized": {
      const cost = totalExpenses(l);
      if (l.cash < cost) {
        const step = RULES.currency === "RUB" ? 1e4 : 1e3;
        const loan = Math.ceil((cost - l.cash) / step) * step;
        return { type: "TAKE_LOAN", amount: loan };
      }
      return { type: "PAY_DOWNSIZED" };
    }
    case "ftBusiness": {
      const space = fastBoard()[pending.space];
      if (space.type !== "business") return { type: "END_TURN" };
      if (l.cash >= space.downPayment * p.laneBuyCashMultiple) return { type: "BUY_FT_BUSINESS" };
      return { type: "PASS_CARD" };
    }
    case "ftVenture": {
      const space = fastBoard()[pending.space];
      if (space.type !== "venture") return { type: "END_TURN" };
      if (p.ventureCashFraction <= 0) return { type: "PASS_CARD" };
      if (l.cash * p.ventureCashFraction >= space.downPayment) {
        return { type: "TRY_VENTURE", die: 1 + Math.floor(rnd() * 6) };
      }
      return { type: "PASS_CARD" };
    }
    case "ftDream": {
      const price = dreamPriceAt(t, pending.space);
      if (l.cash >= price) return { type: "BUY_DREAM" };
      return { type: "PASS_CARD" };
    }
    case "ftCharity": {
      const cost = ftCharityCost(l);
      if (p.charity !== "never" && l.cash > cost * 3) return { type: "ACCEPT_FT_CHARITY" };
      return { type: "PASS_CARD" };
    }
    case "gameOver":
      return null;
  }
  return { type: "END_TURN" };
}

// src/engine/sweep.ts
var mixes = [["easy", "medium"], ["medium", "high"], ["high", "unreal"], ["easy", "medium", "high", "unreal"]];
function play(seed, diff, theme) {
  const dreams = dreamSpaces();
  const pool = professionsFor(theme);
  const r0 = mulberry32(seed);
  const setup = { seed, deckTheme: theme, seats: diff.map((d, i) => ({
    name: `B${i}`,
    professionId: pool[Math.floor(r0() * pool.length)].id,
    dreamSpace: dreams[Math.floor(r0() * dreams.length)].index,
    isBot: true,
    botDifficulty: d
  })) };
  let t = createTable(setup);
  const rnd = mulberry32(seed ^ 1597334677);
  let ev = 0, esc = 0, stuck = 0;
  while (t.phase !== "finished" && !t.winnerId && ev < 3e4) {
    const b = t;
    const e = decideBotEvent(t, rnd);
    if (!e) break;
    t = applyTableEvent(t, e);
    ev++;
    if (!esc && t.seats.some((s) => s.track === "fast")) esc = t.turnCounter;
    if (t === b) {
      if (++stuck > 3) {
        const f = applyTableEvent(t, { type: "END_TURN" });
        if (f === t) break;
        t = f;
        stuck = 0;
      }
    } else stuck = 0;
  }
  return { turns: t.turnCounter, esc: esc || t.turnCounter, bankrupt: t.seats.filter((s) => s.outOfGame).length };
}
function measure(theme) {
  const rs = Array.from({ length: 30 }, (_, i) => play(1e3 + i * 37, mixes[i % 4], theme));
  const avg = (f) => Math.round(rs.reduce((s, r) => s + f(r), 0) / rs.length);
  return { turns: avg((r) => r.turns), esc: avg((r) => r.esc), bank: rs.reduce((s, r) => s + r.bankrupt, 0) };
}
setActiveTheme("classic");
setFastBoardTheme("classic");
setRules({ currency: "USD", fastTrackMultiplier: 100, fastTrackTarget: 15e4, loansEnabled: true });
var ref = measure("classic");
console.log(`
\u042D\u0442\u0430\u043B\u043E\u043D \u043A\u043B\u0430\u0441\u0441\u0438\u043A\u0438: ${ref.turns} \u0445\u043E\u0434\u043E\u0432 (\u041A\u0440\u0443\u0433 ${ref.esc}) \xB7 \u0431\u0430\u043D\u043A\u0440\u043E\u0442\u043E\u0432 ${ref.bank}
`);
setActiveTheme("ru");
setFastBoardTheme("ru");
var small = smallDeals("ru");
var big = bigDeals("ru");
var base = [...small, ...big].map((c) => c.cashFlow);
for (const m of [1, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2]) {
  ;
  [...small, ...big].forEach((c, i) => {
    if (c.category === "partnership") return;
    c.cashFlow = Math.round(base[i] * m / 100) * 100;
  });
  setRules({ currency: "RUB", fastTrackMultiplier: 50, fastTrackTarget: 1e6, loansEnabled: false });
  const r = measure("ru");
  const mark = Math.abs(r.turns - ref.turns) < 25 ? "  \u2190 \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435" : "";
  console.log(`  \xD7${m.toFixed(2)}  \u0432\u0441\u0435\u0433\u043E ${String(r.turns).padStart(4)} \xB7 \u041A\u0440\u0443\u0433 ${String(r.esc).padStart(4)} \xB7 \u0431\u0430\u043D\u043A\u0440\u043E\u0442\u043E\u0432 ${String(r.bank).padStart(2)}${mark}`);
}
