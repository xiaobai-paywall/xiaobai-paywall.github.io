'use strict';
// 回收预估：订阅产品的单用户回本和按月投放回收。参数只存在本机浏览器。
(() => {
  const root = document.getElementById('roi');
  if (!root || !window.RoiModel) return;
  const { calc, PERIOD_LABEL } = window.RoiModel;
  const LS_LAST = 'roi-board-v1';
  const LS_PRESETS = 'roi-presets-v1';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => {
    const n = Math.abs(parseFloat(v) || 0);
    return Math.round(n * 100) / 100;
  };
  const money = (n) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n) => (n == null || Number.isNaN(n) ? '—' : `${n.toFixed(1)}%`);
  const DEFAULT = {
    cost: 65, platformFee: 0, refundRoi: 0, scene: 'base',
    tiers: [
      { period: 'week', trial: 9.9, renew: 24.99, share: 80, isRenew: true },
      { period: 'year', trial: 128, renew: 198, share: 15, isRenew: false },
      { period: 'lifetime', trial: 268, renew: 0, share: 5, isRenew: false },
    ],
    rates: [60, 50, 40],
    spends: [10000, 10000, 10000, 10000, 10000, 10000],
  };
  const SCENES = [
    ['cons', '保守', '最后一次续费率再低 8 个百分点，之后保持，最低 20%'],
    ['base', '基准', '你填完的续费率之后，维持最后一次不变'],
    ['opt', '乐观', '之后每次续费率加 5 个百分点，最高 98%'],
  ];

  let state = load();
  let presetName = '';

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_LAST));
      if (saved && Array.isArray(saved.tiers) && saved.tiers.length) return { ...DEFAULT, ...saved };
    } catch { /* 坏数据就用默认 */ }
    return structuredClone(DEFAULT);
  }
  function save() {
    try { localStorage.setItem(LS_LAST, JSON.stringify(state)); } catch { /* 隐私模式忽略 */ }
  }
  function presets() {
    try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || {}; } catch { return {}; }
  }
  function savePresets(all) {
    localStorage.setItem(LS_PRESETS, JSON.stringify(all));
  }

  function payText(month, horizon) {
    return month >= 0 ? `第 ${month + 1} 月` : `${horizon} 个月内未回本`;
  }
  function userPay(result, key) {
    const hit = result.scenes[key].user.breakIndex;
    if (hit < 0) return { text: '未回本', tip: '把续费尾巴延续到预估期末，单个付费用户的累计 ROI 仍不到 100%' };
    if (hit === 0) return { text: '当天', tip: 'Day0 收入已经覆盖综合订阅成本' };
    const months = result.period === 'week' ? hit * 7 / 30.44 : result.period === 'year' ? hit * 12 : hit;
    const tail = hit > result.entered.rows.length - 1 ? '，已经用到这条情景的尾巴' : '';
    return { text: `约 ${months.toFixed(1)} 个月`, tip: `第 ${hit} ${result.unit}累计 ROI 首次到 100%${tail}` };
  }

  const ICON = '<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/></svg>';

  function shell() {
    root.innerHTML = `
      <div class="panel-head">
        <span class="tab-icon">${ICON}</span>
        <div>
          <h2>回收预估</h2>
          <p>按价格档、续费曲线和每月投放，预估一个付费用户什么时候回本，以及连续投放后整盘什么时候回本。</p>
        </div>
      </div>
      <div class="sc-kpis" id="roiKpis"></div>
      <div class="roi-scenes" id="roiScenes"></div>
      <div class="roi-layout">
        <form class="roi-form" id="roiForm">
          <div class="roi-card">
            <div class="sec-h">方案</div>
            <div class="roi-presets">
              <input id="roiName" type="text" maxlength="40" placeholder="方案名称" aria-label="方案名称" />
              <button type="button" class="pill-btn primary" data-act="save">保存</button>
            </div>
            <div class="roi-presets">
              <div id="roiPreset"></div>
              <button type="button" class="pill-btn" data-act="del" disabled title="先选一个已存方案">删除</button>
            </div>
          </div>
          <div class="roi-card">
            <div class="sec-h">获客<small>成本和价格用同一单位</small></div>
            <div class="roi-grid2">
              <label class="roi-field"><span>综合订阅成本</span><input data-k="cost" type="number" min="0" step="0.01" inputmode="decimal" /></label>
              <label class="roi-field"><span>平台费 %</span><input data-k="platformFee" type="number" min="0" step="0.01" inputmode="decimal" /></label>
              <label class="roi-field"><span>退款 ROI %</span><input data-k="refundRoi" type="number" min="0" step="0.01" inputmode="decimal" /></label>
            </div>
            <p class="roi-hint">综合订阅成本是拿到 1 个付费用户的投放成本。退款 ROI 按成本的百分比，从累计回收里扣掉，记在获客当月。</p>
          </div>
          <div class="roi-card">
            <div class="sec-h">价格档<small id="roiShare">占比 0%</small></div>
            <div id="roiTiers"></div>
            <p class="roi-warn" id="roiShareWarn" hidden>各档占比要加起来等于 100%，现在还对不上。</p>
            <div class="roi-actions"><button type="button" class="pill-btn" data-act="add-tier">加一档</button></div>
            <p class="roi-hint">首单按各档占比加权，扣掉平台费，就是 Day0 收入。点「续」的那一档才进入续费曲线，一次性买断不续费。</p>
          </div>
          <div class="roi-card">
            <div class="sec-h">续费率<small>每一次相对上一次留下的人</small></div>
            <div class="roi-rates" id="roiRates"></div>
            <div class="roi-actions"><button type="button" class="pill-btn" data-act="add-rate">加一次续订</button></div>
            <p class="roi-hint">第 1 次是首单用户里有多少人付了第一次续费，之后每一次都乘在剩下的人身上。填完之后的尾巴用上面三种情景外推。</p>
          </div>
          <div class="roi-card">
            <div class="sec-h">每月投放</div>
            <div class="roi-spends" id="roiSpends"></div>
            <div class="roi-actions">
              <button type="button" class="pill-btn" data-act="add-spend">加一个月</button>
              <button type="button" class="pill-btn" data-act="fill-spend">后面都跟第一个月</button>
            </div>
            <p class="roi-hint">获客数 = 当月投放 ÷ 综合订阅成本。投放停了之后不再有新客，已经进来的用户继续按续费曲线进账，表里标「停投」。</p>
          </div>
        </form>
        <div class="roi-out">
          <div class="roi-card">
            <div class="sec-h">累计净 ROAS<small id="roiChartCap">基准情景 · 25 个月</small></div>
            <svg class="roi-chart" id="roiChart" viewBox="0 0 640 168" role="img" aria-label="三种情景的累计净 ROAS"></svg>
            <div class="roi-legend"><span><b class="cons"></b>保守</span><span><b class="base"></b>基准</span><span><b class="opt"></b>乐观</span><span><b class="even"></b>100% 回本</span></div>
          </div>
          <div class="roi-card">
            <div class="sec-h">单用户回收<small>只含你填的续费次数</small></div>
            <div class="roi-scroll"><table class="roi-tbl"><thead><tr><th>阶段</th><th>还在续的人</th><th>这次续费率</th><th>本期 ROI</th><th>累计 ROI</th><th>累计利润</th></tr></thead><tbody id="roiUser"></tbody></table></div>
          </div>
          <div class="roi-card">
            <div class="sec-h">按月回收<small id="roiMonthCap">基准情景</small></div>
            <div class="roi-scroll"><table class="roi-tbl"><thead><tr><th>月份</th><th>投放</th><th>新客收入</th><th>续费收入</th><th>当月净收入</th><th>累计净利</th><th>累计 ROI</th></tr></thead><tbody id="roiMonth"></tbody></table></div>
          </div>
          <details class="roi-note">
            <summary>这些数字怎么来的</summary>
            <p>Day0 收入是各档首单价按订单占比加权，再乘 (1 − 平台费)。累计 ROI = 累计收入 ÷ 成本 − 退款 ROI。续费只走勾了「续」的那一档：第 1 次留下你填的比例，之后每次再乘下一次续费率，收入 = 续费价 × (1 − 平台费) × 留下的比例 × 该档占比。</p>
            <p>按月把投放当成当月均匀获客。第 k 次续费在获客后 k 个周期到账（周按 7 天、月按 30.44 天、年按 365.25 天），再切进自然月。退款按「投放 × 退款 ROI」记在获客当月。25 个月这个终点，和分月 cohort 报告里预估到第 25 个月是同一档。</p>
          </details>
        </div>
      </div>`;
  }

  const CHEV = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';
  function dd(key, opts, val, aria) {
    const cur = opts.find((o) => o.v === val) || opts[0];
    return `<div class="sc-dd" data-dd="${esc(key)}">
      <button type="button" class="sc-dd-btn sc-sel" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(aria)}" title="${esc(aria)}"><span class="sc-dd-val">${cur ? cur.t : ''}</span>${CHEV}</button>
      <div class="sc-dd-menu" role="listbox" hidden>${opts.map((o) =>
        `<button type="button" role="option" data-v="${esc(o.v)}" aria-selected="${o.v === val}" tabindex="-1"><span>${o.t}</span></button>`).join('')}</div>
    </div>`;
  }
  const periodOpts = Object.entries(PERIOD_LABEL).map(([v, t]) => ({ v, t }));

  function field(key) {
    const el = root.querySelector(`[data-k="${key}"]`);
    if (el) el.value = state[key];
  }

  function drawForm() {
    field('cost'); field('platformFee'); field('refundRoi');
    root.querySelector('#roiTiers').innerHTML = state.tiers.map((t, i) => `
      <div class="roi-tier">
        <div class="roi-tier-h">
          ${dd(`tier-${i}`, periodOpts, t.period, `第 ${i + 1} 档周期`)}
          <button type="button" class="roi-iconbtn${t.isRenew && t.period !== 'lifetime' ? ' on' : ''}" data-act="renew" data-i="${i}" aria-pressed="${t.isRenew && t.period !== 'lifetime' ? 'true' : 'false'}"${t.period === 'lifetime' ? ' disabled title="一次性买断不进入续费曲线"' : ' title="用这一档算续费曲线"'}>续</button>
          <button type="button" class="roi-iconbtn" data-act="del-tier" data-i="${i}" aria-label="删除这一档"${state.tiers.length < 2 ? ' disabled title="至少留一档"' : ''}>×</button>
        </div>
        <div class="roi-tier-nums">
          <label class="roi-field"><span>首单价</span><input data-tier="${i}" data-f="trial" type="number" min="0" step="0.01" inputmode="decimal" value="${t.trial}" /></label>
          <label class="roi-field"><span>续费价</span><input data-tier="${i}" data-f="renew" type="number" min="0" step="0.01" inputmode="decimal" value="${t.renew}"${t.period === 'lifetime' ? ' disabled title="一次性买断没有续费价"' : ''} /></label>
          <label class="roi-field"><span>占比 %</span><input data-tier="${i}" data-f="share" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${t.share}" /></label>
        </div>
      </div>`).join('');
    root.querySelector('#roiRates').innerHTML = state.rates.map((r, i) => `
      <div class="roi-rate"><label class="roi-field"><span>第 ${i + 1} 次</span><input data-rate="${i}" type="number" min="0" step="0.01" inputmode="decimal" value="${r}" /></label>${state.rates.length > 1 ? `<button type="button" class="roi-iconbtn" data-act="del-rate" data-i="${i}" aria-label="删除第 ${i + 1} 次">×</button>` : ''}</div>`).join('');
    root.querySelector('#roiSpends').innerHTML = state.spends.map((s, i) => `
      <label class="roi-field"><span>第 ${i + 1} 月</span><input data-spend="${i}" type="number" min="0" step="0.01" inputmode="decimal" value="${s}" /></label>`).join('');
    const all = presets();
    const names = Object.keys(all);
    root.querySelector('#roiPreset').innerHTML = dd('preset', [{ v: '', t: '已存方案' }, ...names.map((n) => ({ v: n, t: esc(n) }))], all[presetName] ? presetName : '', '已存方案');
    root.querySelector('#roiName').value = presetName;
    const del = root.querySelector('[data-act="del"]');
    del.disabled = !presetName;
    del.title = presetName ? `删除方案「${presetName}」` : '先选一个已存方案';
  }

  function chart(result) {
    const svg = root.querySelector('#roiChart');
    const W = 640, H = 168, P = { l: 36, r: 8, t: 12, b: 22 };
    if (!result.scenes) { svg.innerHTML = ''; return; }
    const series = [
      ['cons', 'var(--text-3)'],
      ['base', 'rgb(var(--brand-rgb))'],
      ['opt', 'rgb(var(--c))'],
    ].map(([key, color]) => ({ key, color, ys: result.scenes[key].monthly.rows.map((r) => r.cumRoi) }));
    const ys = series.flatMap((s) => s.ys);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys, 100);
    const pad = Math.max(4, (hi - lo) * 0.35);
    const min = lo - pad;
    const max = hi + pad;
    const n = series[0].ys.length;
    const X = (i) => P.l + (n <= 1 ? 0 : i / (n - 1)) * (W - P.l - P.r);
    const Y = (v) => P.t + (1 - (v - min) / (max - min || 1)) * (H - P.t - P.b);
    const y100 = Y(100);
    const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    svg.innerHTML = `
      <line x1="${P.l}" y1="${y100.toFixed(1)}" x2="${W - P.r}" y2="${y100.toFixed(1)}" stroke="var(--text-3)" stroke-dasharray="4 4" stroke-width="1" />
      <text x="4" y="${(y100 - 4).toFixed(1)}" fill="var(--text-3)" font-size="11">100%</text>
      ${series.map((s) => `<path d="${path(s.ys)}" fill="none" stroke="${s.color}" stroke-width="${s.key === state.scene ? 2.75 : 1.5}" />`).join('')}
      <text x="${P.l}" y="${H - 4}" fill="var(--text-3)" font-size="11">第 1 月</text>
      <text x="${W - P.r}" y="${H - 4}" fill="var(--text-3)" font-size="11" text-anchor="end">第 ${n} 月</text>`;
  }

  function render() {
    const result = calc(state);
    const scene = result.scenes ? result.scenes[state.scene] || result.scenes.base : null;
    const share = root.querySelector('#roiShare');
    share.textContent = `占比 ${Math.round(result.sumShare * 100) / 100}%`;
    share.classList.toggle('ok', result.valid);
    root.querySelector('#roiShareWarn').hidden = result.valid;

    const kpi = (label, value, on, tip) => `<div class="sc-kpi${on ? ' key' : ''}"${tip ? ` title="${esc(tip)}"` : ''}><span>${label}</span><b>${value}</b></div>`;
    const one = result.valid && result.cost > 0 ? userPay(result, state.scene) : null;
    const back = (text) => text && text !== '未回本';
    root.querySelector('#roiKpis').innerHTML = one ? [
      kpi('Day0 ROI', pct(result.day0Roi), result.day0Roi >= 100, '各档首单价按占比加权，扣掉平台费，再除以综合订阅成本'),
      kpi('单用户回本', one.text, back(one.text), one.tip),
      kpi('整体回本', scene.monthly.breakMonth >= 0 ? payText(scene.monthly.breakMonth, result.horizon) : '未回本', scene.monthly.breakMonth >= 0, scene.monthly.breakMonth >= 0 ? '累计净利第一次大于等于 0 的月份' : payText(-1, result.horizon)),
      kpi('12 个月累计 ROI', pct(scene.monthly.roas12), scene.monthly.roas12 >= 100, '当前情景下，第 12 个月末的累计净收入 ÷ 累计投放'),
      kpi('25 个月累计 ROI', pct(scene.monthly.roas25), scene.monthly.roas25 >= 100, '当前情景下，第 25 个月末的累计净收入 ÷ 累计投放'),
    ].join('') : kpi('还不能算', result.valid ? '成本要大于 0' : '占比要等于 100%', false);

    root.querySelector('#roiScenes').innerHTML = SCENES.map(([key, name, tip]) => {
      const s = result.scenes && result.scenes[key];
      return `<button type="button" class="roi-scene${state.scene === key ? ' on' : ''}" data-scene="${key}" title="${esc(tip)}">
        <i>${name}</i><b>${s ? (s.monthly.breakMonth >= 0 ? payText(s.monthly.breakMonth, result.horizon) : '未回本') : '—'}</b>
        <em>${s ? `12 个月 ${pct(s.monthly.roas12)} · 25 个月 ${pct(s.monthly.roas25)}` : tip}</em></button>`;
    }).join('');

    const shown = state.scene;
    root.querySelector('#roiChartCap').textContent = `${SCENES.find(([k]) => k === shown)[1]}情景在图里加粗对照，三条线一起画`;
    root.querySelector('#roiMonthCap').textContent = `${SCENES.find(([k]) => k === shown)[1]}情景`;
    chart(result);

    root.querySelector('#roiUser').innerHTML = result.entered.rows.map((row) => `
      <tr>
        <td data-l="阶段">${row.name}</td>
        <td data-l="还在续的人">${row.retention == null ? '—' : `${row.retention.toFixed(1)}%`}</td>
        <td data-l="这次续费率">${row.rate == null ? '—' : `${row.rate.toFixed(1)}%`}</td>
        <td data-l="本期 ROI">${pct(row.inc)}</td>
        <td data-l="累计 ROI" class="${row.roi >= 100 ? 'hit' : ''}">${pct(row.roi)}</td>
        <td data-l="累计利润" class="money">${money(row.profit)}</td>
      </tr>`).join('');

    root.querySelector('#roiMonth').innerHTML = scene ? scene.monthly.rows.map((row) => `
      <tr>
        <td data-l="月份">第 ${row.month} 月${row.tail ? ' <span class="sc-loose" title="投放已经停了，这一行只有之前进来的用户在续费">停投</span>' : ''}</td>
        <td data-l="投放">${money(row.spend)}</td>
        <td data-l="新客收入">${money(row.fresh)}</td>
        <td data-l="续费收入">${money(row.renew)}</td>
        <td data-l="当月净收入">${money(row.rev)}</td>
        <td data-l="累计净利" class="money">${money(row.cumProfit)}</td>
        <td data-l="累计 ROI" class="${row.cumRoi >= 100 ? 'hit' : ''}">${pct(row.cumRoi)}</td>
      </tr>`).join('') : '';
    save();
  }

  function readNumbers() {
    state.cost = num(root.querySelector('[data-k="cost"]').value);
    state.platformFee = num(root.querySelector('[data-k="platformFee"]').value);
    state.refundRoi = num(root.querySelector('[data-k="refundRoi"]').value);
    state.tiers = state.tiers.map((t, i) => {
      const q = (f) => root.querySelector(`[data-tier="${i}"][data-f="${f}"]`);
      return {
        period: t.period,
        trial: num(q('trial').value),
        renew: t.period === 'lifetime' ? 0 : num(q('renew').value),
        share: num(q('share').value),
        isRenew: t.period !== 'lifetime' && t.isRenew,
      };
    });
    if (!state.tiers.some((t) => t.isRenew)) {
      const pick = state.tiers.find((t) => t.period !== 'lifetime');
      if (pick) pick.isRenew = true;
    }
    state.rates = [...root.querySelectorAll('[data-rate]')].map((el) => num(el.value));
    state.spends = [...root.querySelectorAll('[data-spend]')].map((el) => num(el.value));
  }

  shell();
  drawForm();
  render();

  let timer = 0;
  root.addEventListener('input', (e) => {
    if (e.target.id === 'roiName') return;
    clearTimeout(timer);
    timer = setTimeout(() => { readNumbers(); render(); }, 160);
  });

  const ddClose = (except) => root.querySelectorAll('.sc-dd.open').forEach((d) => {
    if (d === except) return;
    d.classList.remove('open');
    d.querySelector('.sc-dd-menu').hidden = true;
    d.querySelector('.sc-dd-btn').setAttribute('aria-expanded', 'false');
  });
  const ddOpen = (d) => {
    ddClose(d);
    const menu = d.querySelector('.sc-dd-menu');
    d.classList.add('open');
    menu.hidden = false;
    menu.classList.remove('right');
    if (menu.getBoundingClientRect().right > innerWidth - 8) menu.classList.add('right');
    d.querySelector('.sc-dd-btn').setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role=option]')).focus();
  };
  const ddPick = (key, v) => {
    if (key === 'preset') {
      const all = presets();
      if (!all[v]) return;
      presetName = v;
      state = { ...DEFAULT, ...all[v] };
    } else if (key.startsWith('tier-')) {
      readNumbers();
      const tier = state.tiers[+key.slice(5)];
      if (!tier) return;
      tier.period = v;
      if (v === 'lifetime') { tier.renew = 0; tier.isRenew = false; }
      if (!state.tiers.some((t) => t.isRenew)) {
        const pick = state.tiers.find((t) => t.period !== 'lifetime');
        if (pick) pick.isRenew = true;
      }
    } else return;
    drawForm();
    render();
    root.querySelector(`[data-dd="${key}"] .sc-dd-btn`)?.focus();
  };

  root.addEventListener('click', (e) => {
    const ddBtn = e.target.closest('.sc-dd-btn');
    if (ddBtn) {
      const d = ddBtn.closest('.sc-dd');
      if (d.classList.contains('open')) ddClose(); else ddOpen(d);
      return;
    }
    const opt = e.target.closest('.sc-dd [role=option]');
    if (opt) { const key = opt.closest('.sc-dd').dataset.dd; ddClose(); ddPick(key, opt.dataset.v); return; }
    const sceneBtn = e.target.closest('[data-scene]');
    if (sceneBtn) { ddClose(); state.scene = sceneBtn.dataset.scene; render(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    readNumbers();
    if (act === 'add-tier') state.tiers.push({ period: 'week', trial: 0, renew: 0, share: 0, isRenew: false });
    else if (act === 'del-tier' && state.tiers.length > 1) state.tiers.splice(+btn.dataset.i, 1);
    else if (act === 'renew') {
      const i = +btn.dataset.i;
      if (state.tiers[i].period === 'lifetime') return;
      state.tiers.forEach((t, idx) => { t.isRenew = idx === i; });
    } else if (act === 'add-rate') state.rates.push(state.rates[state.rates.length - 1] ?? 0);
    else if (act === 'del-rate' && state.rates.length > 1) state.rates.splice(+btn.dataset.i, 1);
    else if (act === 'add-spend') state.spends.push(state.spends[state.spends.length - 1] ?? 0);
    else if (act === 'fill-spend' && state.spends.length) state.spends = state.spends.map(() => state.spends[0]);
    else if (act === 'save') {
      const name = root.querySelector('#roiName').value.trim();
      if (!name) return;
      const all = presets();
      all[name] = state;
      savePresets(all);
      presetName = name;
    } else if (act === 'del') {
      if (!presetName) return;
      const all = presets();
      delete all[presetName];
      savePresets(all);
      presetName = '';
    } else return;
    if (!state.tiers.some((t) => t.isRenew)) {
      const pick = state.tiers.find((t) => t.period !== 'lifetime');
      if (pick) pick.isRenew = true;
    }
    drawForm();
    render();
  });
  root.addEventListener('keydown', (e) => {
    const d = e.target.closest('.sc-dd');
    if (!d) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (!d.classList.contains('open')) return;
      ddClose();
      if (e.key === 'Escape') d.querySelector('.sc-dd-btn').focus();
      return;
    }
    if (e.target.classList.contains('sc-dd-btn')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ddOpen(d); }
      return;
    }
    const opts = [...d.querySelectorAll('[role=option]')];
    const i = opts.indexOf(e.target);
    if (i < 0) return;
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const to = step ? i + step : e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    opts[Math.max(0, Math.min(opts.length - 1, to))].focus();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#roi .sc-dd')) ddClose(); });
})();
