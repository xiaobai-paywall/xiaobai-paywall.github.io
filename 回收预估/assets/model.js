// 订阅回收模型。算法与桌面版「订阅 ROI 计算器 v2」一致，三种尾巴沿用分月 cohort 报告的情景：
// 基准维持最后一次续费率，乐观之后每次 +5 个百分点（最高 98%），保守在最后一次上再低 8 个百分点（最低 20%）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoiModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MONTH_DAYS = 30.44;
  const PERIOD_DAYS = { week: 7, month: MONTH_DAYS, year: 365.25 };
  const PERIOD_LABEL = { week: '周', month: '月', year: '年', lifetime: '一次性' };
  const HORIZON = 25;

  function spreadIntoMonths(arr, i, offsetDays, amount) {
    const start = i * MONTH_DAYS + offsetDays;
    const end = start + MONTH_DAYS;
    for (let j = Math.floor(start / MONTH_DAYS); j * MONTH_DAYS < end && j < arr.length; j++) {
      const overlap = Math.min(end, (j + 1) * MONTH_DAYS) - Math.max(start, j * MONTH_DAYS);
      if (overlap > 0) arr[j] += amount * overlap / MONTH_DAYS;
    }
  }

  // 你填的续费率用完之后，按情景把曲线补到 steps 次。rates 是 0–1。
  function extendRates(rates, steps, mode) {
    const out = rates.slice();
    const last = out.length ? out[out.length - 1] : 0;
    while (out.length < steps) {
      const k = out.length - rates.length + 1;
      let r = last;
      if (!rates.length) r = 0;
      else if (mode === 'opt') r = Math.min(0.98, last + 0.05 * k);
      else if (mode === 'cons') r = Math.max(0.2, last - 0.08);
      out.push(r);
    }
    return out;
  }

  function renewRevenues(renewTier, rates, fee) {
    if (!renewTier) return [];
    const net = renewTier.renew * (1 - fee);
    const share = renewTier.share / 100;
    let retention = 1;
    return rates.map((rate, idx) => {
      retention = idx === 0 ? rate : retention * rate;
      return { rate, retention, rev: net * retention * share };
    });
  }

  function userCurve(day0Rev, renews, cost, refundPct) {
    let cum = day0Rev;
    const rows = [];
    const push = (name, rate, retention, incRev) => {
      const profit = cum - cost - cost * refundPct;
      const roi = cost > 0 ? (cum / cost - refundPct) * 100 : 0;
      rows.push({ name, rate, retention, inc: cost > 0 ? incRev / cost * 100 : 0, cum, profit, roi });
    };
    push('Day0', null, null, day0Rev);
    renews.forEach((step, i) => {
      cum += step.rev;
      push(`续订 #${i + 1}`, step.rate * 100, step.retention * 100, step.rev);
    });
    const hit = rows.findIndex((r) => r.roi >= 100);
    return { rows, breakIndex: hit };
  }

  function monthsAfter(index, period) {
    if (index <= 0) return 0;
    if (period === 'week') return index * 7 / MONTH_DAYS;
    if (period === 'year') return index * 12;
    return index;
  }

  function monthly(spends, cost, day0Rev, renews, period, refundPct, horizon) {
    const months = Math.max(horizon, spends.length);
    const fresh = Array(months).fill(0);
    const renew = Array(months).fill(0);
    const refund = Array(months).fill(0);
    const periodDays = PERIOD_DAYS[period] || 7;
    spends.forEach((S, i) => {
      if (i >= months) return;
      const users = cost > 0 ? S / cost : 0;
      fresh[i] += users * day0Rev;
      refund[i] += S * refundPct;
      renews.forEach((step, k) => {
        spreadIntoMonths(renew, i, (k + 1) * periodDays, users * step.rev);
      });
    });
    let cumSpend = 0, cumRev = 0, cumRefund = 0, breakMonth = -1;
    const rows = [];
    for (let t = 0; t < months; t++) {
      const spend = spends[t] || 0;
      const rev = fresh[t] + renew[t];
      cumSpend += spend;
      cumRev += rev;
      cumRefund += refund[t];
      const cumProfit = cumRev - cumSpend - cumRefund;
      const cumRoi = cumSpend > 0 ? (cumRev - cumRefund) / cumSpend * 100 : 0;
      if (breakMonth < 0 && cumSpend > 0 && cumProfit >= 0) breakMonth = t;
      rows.push({
        month: t + 1, spend, fresh: fresh[t], renew: renew[t], rev, refund: refund[t],
        cumProfit, cumRoi, tail: t >= spends.length,
      });
    }
    const at = (n) => rows[Math.min(n, rows.length) - 1] || null;
    return {
      rows, breakMonth,
      roas12: at(12) ? at(12).cumRoi : null,
      roas25: at(25) ? at(25).cumRoi : null,
      profit: rows.length ? rows[rows.length - 1].cumProfit : 0,
      cumSpend, cumRev,
    };
  }

  function calc(input) {
    const tiers = input.tiers || [];
    const sumShare = tiers.reduce((a, t) => a + (Number(t.share) || 0), 0);
    const valid = Math.abs(sumShare - 100) < 0.01 && tiers.length > 0;
    const cost = Number(input.cost) || 0;
    const fee = (Number(input.platformFee) || 0) / 100;
    const refundPct = (Number(input.refundRoi) || 0) / 100;
    const day0Rev = tiers.reduce((a, t) => a + (t.share / 100) * (Number(t.trial) || 0) * (1 - fee), 0);
    const renewTier = tiers.find((t) => t.isRenew && t.period !== 'lifetime') || null;
    const period = renewTier ? renewTier.period : 'week';
    const entered = (input.rates || []).map((r) => (Number(r) || 0) / 100);
    const spends = (input.spends || []).map((n) => Math.max(0, Number(n) || 0));
    const horizon = Math.max(HORIZON, spends.length);
    const steps = renewTier ? Math.max(entered.length, Math.ceil(horizon * MONTH_DAYS / (PERIOD_DAYS[period] || 7))) : 0;

    const scene = (mode) => {
      const rates = extendRates(entered, steps, mode).slice(0, steps);
      const renews = renewRevenues(renewTier, rates, fee);
      return {
        user: userCurve(day0Rev, renews, cost, refundPct),
        monthly: monthly(spends, cost, day0Rev, renews, period, refundPct, horizon),
      };
    };

    const enteredRenews = renewRevenues(renewTier, entered, fee);
    const enteredCurve = userCurve(day0Rev, enteredRenews, cost, refundPct);
    const scenes = valid && cost > 0 ? { cons: scene('cons'), base: scene('base'), opt: scene('opt') } : null;
    const baseHit = scenes ? scenes.base.user.breakIndex : -1;

    return {
      valid, sumShare, cost, day0Rev,
      day0Roi: cost > 0 ? day0Rev / cost * 100 : 0,
      renewTier, period, unit: PERIOD_LABEL[period] || '周',
      entered: enteredCurve,
      userBreakMonths: baseHit >= 0 ? monthsAfter(baseHit, period) : null,
      scenes, horizon,
    };
  }

  return { calc, MONTH_DAYS, PERIOD_DAYS, PERIOD_LABEL, HORIZON };
});
