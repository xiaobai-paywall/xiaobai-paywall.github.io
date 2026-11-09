'use strict';
// 扫描机会：展示 scout.py 生成的 数据/latest.js（window.SCOUT_DATA）
(() => {
  const D = window.SCOUT_DATA;
  const root = document.getElementById('scan');
  const dlg = document.getElementById('scanDlg');
  const LS_KEY = 'scan-ui-v1';
  const PALETTE = ['250,204,21', '79,140,255', '52,211,153', '251,146,60', '236,72,153', '45,212,191', '167,139,250', '34,211,238', '163,230,53', '96,165,250', '248,113,113', '148,163,184', '244,114,182'];
  const SORTS = {
    score: { label: '综合得分', get: (r) => r.score },
    est_downloads: { label: '估算日下载', get: (r) => r.est_downloads },
    eff: { label: '变现效率', get: (r) => -r.eff_pos / r.eff_n },
    delta_7: { label: '7 日上升', get: (r) => (r.delta_7 ?? -999) },
    max_price: { label: '最贵内购', get: (r) => r.max_price },
    grossing_rank: { label: '畅销榜名次', get: (r) => -r.grossing_rank },
    age: { label: '最新上线', get: (r) => -r.age },
  };
  const AGES = [['all', '全部'], ['90', '90 天内'], ['180', '180 天内'], ['365', '一年内']];
  const DLS = [['all', '全部'], ['3000', '≥ 3000'], ['5000', '≥ 5000']];
  const PRICES = [['all', '全部'], ['49.99', '≥ $49.99'], ['99.99', '≥ $99.99']];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n ? `$${n.toFixed(2)}` : '—');
  // 估算值只保留两位有效数字，避免看起来比实际更精确
  const approx = (n) => {
    const step = 10 ** Math.max(Math.floor(Math.log10(Math.max(n, 1))) - 1, 0);
    return `约 ${(Math.round(n / step) * step).toLocaleString()}`;
  };
  // 手机上内购列表先显示这么多个，其余点「展开全部」
  const IAP_PREVIEW = 5;
  // AppMagic 按 ID 定位应用，路径里的名称只是给人看的
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
  const genreColor = (gid) => PALETTE[Object.keys(D.genres).indexOf(gid) % PALETTE.length] || PALETTE[11];

  const ui = Object.assign({ genre: 'all', age: 'all', price: 'all', dl: 'all', sort: 'score', asc: false, q: '' }, (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  })());
  if (!SORTS[ui.sort]) ui.sort = 'score';
  if (!PRICES.some(([v]) => v === ui.price)) ui.price = 'all';
  const saveUi = () => localStorage.setItem(LS_KEY, JSON.stringify({ ...ui, q: '' }));
  ui.q = '';

  // 从内购名称猜订阅周期
  function period(name) {
    const s = String(name).toLowerCase();
    if (/week|weekly|周/.test(s)) return '周';
    if (/month|monthly|月/.test(s)) return '月';
    if (/quarter|季/.test(s)) return '季';
    if (/year|yearly|annual|annually|年/.test(s)) return '年';
    if (/lifetime|forever|永久|终身/.test(s)) return '永久';
    return '';
  }

  // 内购里能确定的信息：最高价那一档的订阅周期、价位数、从名称看出的订阅周期
  function priceInfo(r) {
    const priceOf = (p) => parseFloat(String(p).replace(/[^\d.]/g, '')) || 0;
    const maxItem = r.items.find(([, p]) => priceOf(p) === r.max_price);
    const periods = [...new Set(r.items.map(([n]) => period(n)).filter(Boolean))];
    // 同一个内购名称出现多个价格，才说明可能在做价格实验或首购优惠
    const byName = {};
    r.items.forEach(([n, p]) => { (byName[n] ||= new Set()).add(p); });
    const multi = Object.values(byName).filter((s) => s.size > 1).length;
    return { maxPer: maxItem ? period(maxItem[0]) : '', tiers: new Set(r.items.map((x) => x[1])).size, periods, multi };
  }

  // 变现效率：同分类里同时上了免费榜和畅销榜的应用，按 免费榜名次 ÷ 畅销榜名次 排序
  const effPct = (r) => Math.max(1, Math.round(r.eff_pos / r.eff_n * 100));
  const effW = (r) => Math.max((1 - (r.eff_pos - 1) / Math.max(r.eff_n - 1, 1)) * 100, 4);
  const effWin = () => (D.model.eff_days > 1 ? `近 ${D.model.eff_days} 日平均` : '今日榜单，攒满 7 天后改用 7 日平均');
  const effTip = (r) => `${esc(r.genre)}分类有 ${r.eff_n} 个应用同时上了免费榜和畅销榜，按「免费榜名次 ÷ 畅销榜名次」从高到低排，它排第 ${r.eff_pos}（${effWin()}）。` +
    '只是同分类内的粗略排序：假设下载和收入随名次下降的速度差不多，没有真实收入校准，只有排在最前、最后的比较可信，不代表真实付费能力';
  // 只分三档，中间的先后差几名没有意义
  const effLevel = (r) => {
    const p = r.eff_pos / r.eff_n;
    if (p <= 0.3) return { txt: `前 ${effPct(r)}%`, cls: 'hi' };
    if (p > 0.7) return { txt: '靠后', cls: 'lo' };
    return { txt: '中游', cls: 'mid' };
  };
  const rangeTip = (chart, maxK, rank) => maxK
    ? `本分类${chart}只能验证到前 ${maxK} 名（再往后的应用进不了总榜前 100），第 ${rank} 名超出范围，换算是外推的，可能差几倍到十倍`
    : `这个分类最近没有应用同时进入${chart}和总榜前 100，换算无法验证`;
  const guessTag = (r) => (r.fit_ok ? '' : '<span class="sc-guess" title="这个分类今天没有应用进入总榜前 100，换算系数是借另一个榜单推出来的，误差更大">推算</span>');

  function deltaBadge(r) {
    if (r.new_7) return '<span class="sc-d new">新进</span>';
    if (r.delta_7 == null) return '<span class="sc-d na">—</span>';
    if (r.delta_7 > 0) return `<span class="sc-d up">↑${r.delta_7}</span>`;
    if (r.delta_7 < 0) return `<span class="sc-d dn">↓${-r.delta_7}</span>`;
    return '<span class="sc-d na">持平</span>';
  }

  function spark(hist, w = 96, h = 26) {
    if (!hist || hist.length < 2) return '<span class="sc-spark-na">积累中</span>';
    const ranks = hist.map((x) => x[1]);
    // 横轴固定 30 天，按真实日期放点，数据不足时只占右侧一段
    const end = Date.parse(D.date);
    const px = (d) => (w - 3) * (1 - Math.min((end - Date.parse(d)) / 864e5, 29) / 29);
    // 纵轴至少 20 个名次的幅度，避免 #4→#5 也画成大起大落
    const lo0 = Math.min(...ranks), hi0 = Math.max(...ranks), span = Math.max(hi0 - lo0, 20);
    const lo = (lo0 + hi0) / 2 - span / 2;
    // 名次越小越好，靠前时画在上方
    const pts = hist.map(([d, r]) => `${px(d).toFixed(1)},${((r - lo) / span * (h - 6) + 3).toFixed(1)}`);
    const last = pts[pts.length - 1].split(',');
    const tip = `近 ${hist.length} 天分类畅销榜：#${ranks[0]} → #${ranks[ranks.length - 1]}（最好 #${lo0}，最差 #${hi0}）`;
    return `<svg class="sc-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${tip}</title>
      <line x1="0" x2="${w}" y1="${h - 1}" y2="${h - 1}" stroke="rgba(255,255,255,.08)" stroke-dasharray="2 3"/>
      <polyline fill="none" stroke="rgb(45,212,191)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>
      ${hist.length <= 12 ? `<text x="0" y="${h / 2 + 4}" font-size="11" fill="rgba(148,163,184,.75)">仅 ${hist.length} 天</text>` : ''}
      <circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="rgb(45,212,191)"/></svg>`;
  }

  // 除分类以外的条件，分类标签上的数量也按它统计
  function baseFiltered() {
    const q = ui.q.trim().toLowerCase();
    return D.items.filter((r) =>
      (ui.age === 'all' || r.age <= +ui.age) &&
      (ui.price === 'all' || r.max_price >= +ui.price) &&
      (ui.dl === 'all' || r.est_downloads >= +ui.dl) &&
      (!q || `${r.name} ${r.developer} ${r.genre}`.toLowerCase().includes(q)));
  }

  function filtered() {
    const rows = baseFiltered().filter((r) => ui.genre === 'all' || r.genre_id === ui.genre);
    const get = SORTS[ui.sort].get;
    rows.sort((a, b) => (ui.asc ? get(a) - get(b) : get(b) - get(a)));
    return rows;
  }

  // ---------- 渲染 ----------

  function renderBadge() {
    const badge = document.getElementById('hubBadge');
    const txt = document.getElementById('hubBadgeTxt');
    const count = document.getElementById('scanCount');
    if (!D) return;
    const days = Math.round((new Date(new Date().toDateString()) - new Date(D.date + 'T00:00:00')) / 864e5);
    badge.className = 'brand-badge' + (days > 1 ? ' warn' : '');
    txt.textContent = days <= 0 ? `扫描数据 · 今天 ${D.generated_at.slice(11, 16)}` : `扫描数据 · ${days} 天前`;
    badge.title = `扫描数据生成于 ${D.date} ${D.generated_at.slice(11, 16)}（北京时间）`;
    count.textContent = D.items.length;
  }

  function renderShell() {
    const head = `
      <div class="panel-head">
        <span class="tab-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></span>
        <div>
          <h2>扫描机会</h2>
          <p>${D ? `${D.country.toUpperCase()} 区 App Store · ${Object.keys(D.genres).length} 个分类 · 上线 ${Math.round(D.filter.max_age_days / 30)} 个月内的高价订阅新品` : '每天扫描 App Store 分类榜单，找出高价订阅新品'}</p>
        </div>
        ${D ? '<div class="ph-right"><input class="sc-q" id="scQ" type="search" placeholder="搜索应用、开发者、分类" /></div>' : ''}
      </div>`;
    if (!D) {
      root.innerHTML = head + `
        <div class="sc-empty">
          <b>还没有扫描数据</b>
          <p>在终端运行一次扫描脚本，大约 4 分钟。之后每天自动更新，这里会显示筛出来的高价订阅新品。</p>
          <code>python3 ~/Documents/cursor/商业变现/扫描机会/scout.py</code>
        </div>`;
      return;
    }
    root.innerHTML = head + `
      <section class="sc-top" id="scTop"></section>
      <div class="sc-kpis" id="scKpis"></div>
      <div class="sc-bar">
        <span class="sc-lb">估算日下载<span class="seg" data-seg="dl">${DLS.map(([v, t]) => `<button class="seg-btn" data-v="${v}">${t}</button>`).join('')}</span></span>
        <span class="sc-lb">上线<span class="seg" data-seg="age">${AGES.map(([v, t]) => `<button class="seg-btn" data-v="${v}">${t}</button>`).join('')}</span></span>
        <span class="sc-lb">最贵内购<span class="seg" data-seg="price">${PRICES.map(([v, t]) => `<button class="seg-btn" data-v="${v}">${t}</button>`).join('')}</span></span>
        <label class="sc-lb">排序<select id="scSort">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select></label>
        <button class="pill-btn sc-reset" id="scReset" hidden>清空筛选</button>
      </div>
      <div class="sc-genres" id="scGenres"></div>
      <div class="sc-wrap"><table class="sc-tbl">
        <thead><tr>
          <th>应用</th><th class="l">分类</th><th data-sort="age">上线</th><th data-sort="grossing_rank">畅销榜 / 免费榜</th>
          <th data-sort="est_downloads">估算日下载</th><th data-sort="eff">变现效率</th><th data-sort="max_price">内购价格</th>
          <th data-sort="delta_7">7 日</th><th>30 日走势</th><th data-sort="score">得分</th>
        </tr></thead>
        <tbody id="scBody"></tbody>
      </table></div>
      <p class="sc-note">
        <b>筛选规则</b>：上线 ≤ ${D.filter.max_age_days} 天；<b>有下载量</b>：进本分类免费榜前 100，且估算日下载 ≥ ${D.filter.min_daily_downloads.toLocaleString()}；
        <b>有付费</b>：进本分类畅销榜前 100，最贵内购 ≥ $${D.filter.min_max_price}。苹果没有公开内购列表的排序依据，所以不判断哪个内购“最热”，只看最高价和最低价。<br />
        <b>变现效率</b>：免费榜名次 ÷ 畅销榜名次，只和同一分类里同时上了两个榜的应用比，分「前 x%」（前 30%）、「中游」、「靠后」（后 30%）三档（${effWin()}）。
        这是粗略排序：假设下载和收入随名次下降的速度差不多，没有真实收入校准，只用来排序和挑 Top 3，不参与筛选；能确定的付费信号只有「进了本分类畅销榜前 100」和内购价格。<br />
        <b>估算日下载</b>：先用每天同时出现在分类榜和「全部应用」总榜上的应用，把分类名次换算成总榜等效名次，再用 ${D.model.anchors} 个七麦真实日下载样本换算成日下载。
        只是量级参考，样本越多越准，在 config.toml 的 [calibration] 里添加。标「推算」的分类今天没有应用进总榜，误差更大。
        总榜只公布前 100 名，每个分类只有排得很靠前的几名能验证换算，超出这个范围时不显示总榜名次，标「外推估算」。
        ${D.history_days < 8 ? `排名变化需要积累 7 天以上数据，目前已积累 <b>${D.history_days} 天</b>。` : ''}
      </p>`;
  }

  // ---------- 今日跟进 Top 3 ----------

  function trendText(r) {
    const t = r.trend;
    if (!t) return '';
    const span = `近 ${t.days} 天`;
    if (t.new) return `${span}<b>新冲进</b>畅销榜前 100，现在第 ${r.grossing_rank} 名`;
    if (t.delta > 0) return `${span}畅销榜 #${t.rank} → #${r.grossing_rank}，<b>上升 ${t.delta} 名</b>`;
    if (t.delta < 0) return `${span}畅销榜 #${t.rank} → #${r.grossing_rank}，下降 ${-t.delta} 名`;
    return `${span}畅销榜稳定在第 ${r.grossing_rank} 名`;
  }

  function pricingText(r) {
    const { tiers, periods, maxPer, multi } = priceInfo(r);
    if (!r.items.length) return '';
    const subs = periods.filter((p) => p !== '永久');
    const parts = [];
    if (subs.length) parts.push(`<b>${subs.join('、')}</b>订阅`);
    if (periods.includes('永久')) parts.push('<b>永久</b>买断');
    let s = `${parts.length ? parts.join(' + ') + '，' : ''}最贵 <b>${money(r.max_price)}</b>${maxPer ? `（${maxPer}）` : ''}，最低 ${money(r.min_price)}`;
    s += `，共 ${tiers} 个价位`;
    if (multi) s += `；${multi} 个内购同名不同价，可能在做价格实验或首购优惠`;
    return s;
  }

  function unmet(r) {
    const rule = D.top_rule, out = [];
    if (r.eff_pos > Math.max(1, Math.ceil(r.eff_n * rule.eff_top))) out.push(`变现效率不在本分类前 ${Math.round(rule.eff_top * 100)}%`);
    if (r.max_price < rule.min_max_price) out.push(`最贵内购低于 $${rule.min_max_price}`);
    if (!r.trend || !(r.trend.new || r.trend.delta > 0)) out.push('畅销榜没有上升');
    return out;
  }

  function renderTop() {
    const box = document.getElementById('scTop');
    const picks = (D.top || []).map((p) => ({ ...p, r: D.items.find((x) => x.app_id === p.app_id) })).filter((p) => p.r);
    if (!picks.length) { box.hidden = true; return; }
    const rule = D.top_rule;
    box.innerHTML = `
      <div class="sc-top-h">
        <div><b>今日跟进 Top ${picks.length}</b><span>${+D.date.slice(5, 7)} 月 ${+D.date.slice(8)} 日 · 每个分类最多一个</span></div>
        <em title="同时满足三条的按综合得分排；不够 ${rule.n} 个时按得分补齐，并标「放宽」">挑选条件：本分类变现效率前 ${Math.round(rule.eff_top * 100)}% · 最贵内购 ≥ $${rule.min_max_price} · 畅销榜上升或新进榜</em>
      </div>
      <div class="sc-top-list">${picks.map(({ r, strict }, i) => {
        const miss = strict ? [] : unmet(r);
        const why = [
          `变现效率本分类第 <b>${r.eff_pos}/${r.eff_n}</b>（${effLevel(r).txt}，粗略）：畅销 #${r.grossing_rank}、免费 #${r.free_rank}`,
          trendText(r),
          pricingText(r),
          `上线 <b>${r.age}</b> 天，估算日下载${approx(r.est_downloads)}${r.free_checked ? '' : '（外推）'}`,
        ].filter(Boolean);
        return `<article class="sc-top-card" data-open="${r.app_id}">
          <div class="sc-top-app"><i>${i + 1}</i><img src="${esc(r.icon)}" alt="" />
            <div><b>${esc(r.name)}</b><span><span class="sc-tag" style="--g:${genreColor(r.genre_id)}">${esc(r.genre)}</span>${strict ? '' : `<span class="sc-loose" title="${esc(miss.join('；'))}">放宽</span>`}</span></div>
          </div>
          ${r.intro ? `<p class="sc-top-intro">${esc(r.intro)}</p>` : ''}
          <ul class="sc-why">${why.map((s) => `<li><span>${s}</span></li>`).join('')}</ul>
          <div class="sc-top-do">
            <span>怎么跟进</span>
            <a href="https://appgrowing-global.youcloud.com/app" target="_blank" rel="noopener" data-copy-open="${esc(r.name)}" title="会先复制应用名称，到 AppGrowing 粘贴搜索">AppGrowing 看素材</a>
            <a href="${esc(r.url)}" target="_blank" rel="noopener" title="装上后截付费墙，上传到「收集素材」">装上截付费墙</a>
            <a href="https://appmagic.rocks/iphone/${slug(r.name)}/${r.app_id}" target="_blank" rel="noopener">AppMagic</a>
          </div>
        </article>`;
      }).join('')}</div>`;
  }

  function renderKpis() {
    const all = D.items;
    const prices = all.map((r) => r.max_price).filter(Boolean).sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
    const fresh = all.filter((r) => r.age <= 90).length;
    const rising = all.filter((r) => r.new_7 || r.delta_7 > 0).length;
    const enough = D.history_days >= 8;
    document.getElementById('scKpis').innerHTML = `
      <div class="sc-kpi key"><span>今日候选</span><b>${all.length}<small>个</small></b><em>估算日下载 ≥ 3000 有 ${all.filter((r) => r.est_downloads >= 3000).length} 个 · 共扫描 ${D.scanned_apps.toLocaleString()} 个</em></div>
      <div class="sc-kpi"><span>7 日上升或新进榜</span><b>${enough ? rising : '—'}${enough ? '<small>个</small>' : ''}</b><em>${enough ? '畅销榜名次比一周前更靠前' : `需积累 7 天数据，已有 ${D.history_days} 天`}</em></div>
      <div class="sc-kpi"><span>最贵内购中位数</span><b class="num">${money(median)}</b><em>一半候选的最高价位高于这个价</em></div>
      <div class="sc-kpi"><span>90 天内上线</span><b>${fresh}<small>个</small></b><em>最新的一批机会</em></div>`;
  }

  function renderFilters() {
    root.querySelectorAll('[data-seg]').forEach((seg) => {
      seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === ui[seg.dataset.seg]));
    });
    document.getElementById('scSort').value = ui.sort;
    const base = baseFiltered();
    const counts = {}, total = {};
    base.forEach((r) => { counts[r.genre_id] = (counts[r.genre_id] || 0) + 1; });
    D.items.forEach((r) => { total[r.genre_id] = (total[r.genre_id] || 0) + 1; });
    const genres = Object.keys(D.genres).sort((a, b) => (total[b] || 0) - (total[a] || 0));
    document.getElementById('scGenres').innerHTML =
      `<button class="sc-chip${ui.genre === 'all' ? ' active' : ''}" data-genre="all">全部<small>${base.length}</small></button>` +
      genres.map((g) => total[g]
        ? `<button class="sc-chip${ui.genre === g ? ' active' : ''}" data-genre="${g}" style="--g:${genreColor(g)}">${esc(D.genres[g])}<small>${counts[g] || 0}</small></button>`
        : `<span class="sc-chip zero" title="已扫描，今天没有符合条件的产品">${esc(D.genres[g])}<small>0</small></span>`).join('');
    document.getElementById('scReset').hidden = ui.genre === 'all' && ui.age === 'all' && ui.price === 'all' && ui.dl === 'all' && !ui.q;
    root.querySelectorAll('.sc-tbl th[data-sort]').forEach((th) => {
      th.classList.toggle('on', th.dataset.sort === ui.sort);
      th.classList.toggle('asc', th.dataset.sort === ui.sort && ui.asc);
    });
  }

  function renderRows() {
    const rows = filtered();
    const body = document.getElementById('scBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px 0;color:var(--muted-2)">没有符合条件的产品，换个筛选试试</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r) => {
      const pi = priceInfo(r);
      const lvl = r.score >= 110 ? '' : r.score >= 85 ? ' mid' : ' low';
      return `<tr data-id="${r.app_id}">
        <td data-l="应用"><div class="sc-app"><img src="${esc(r.icon)}" alt="" loading="lazy" /><div><div class="nm">${esc(r.name)}</div><div class="cd">${esc(r.developer)}</div></div></div></td>
        <td class="l" data-l="分类"><span class="sc-tag" style="--g:${genreColor(r.genre_id)}">${esc(r.genre)}</span></td>
        <td data-l="上线">${r.age} 天<span class="sc-sm">${r.release_date.slice(2).replace(/-/g, '/')}</span></td>
        <td data-l="畅销 / 免费"><b>#${r.grossing_rank}</b><span class="sc-sm">免费 #${r.free_rank}</span></td>
        <td data-l="估算日下载"><b>${approx(r.est_downloads)}</b>${guessTag(r)}${r.free_checked ? `<span class="sc-sm">总榜 ≈ #${r.eq_free.toLocaleString()}</span>` : `<span class="sc-sm" title="${rangeTip('免费榜', r.free_max_k, r.free_rank)}">外推估算</span>`}</td>
        <td data-l="变现效率" title="${effTip(r)}"><span class="sc-ratio sc-eff ${effLevel(r).cls}"><i><s style="width:${effW(r)}%"></s></i>${effLevel(r).txt}</span><span class="sc-sm">本分类第 ${r.eff_pos}/${r.eff_n}</span></td>
        <td data-l="内购价格"><span class="sc-price">${money(r.max_price)}</span>${pi.maxPer ? `<span class="sc-per">${pi.maxPer}</span>` : ''}<span class="sc-sm">最低 ${money(r.min_price)} · ${pi.tiers} 档</span></td>
        <td data-l="7 日">${deltaBadge(r)}</td>
        <td data-l="30 日走势">${spark(r.history)}</td>
        <td data-l="得分"><span class="sc-score${lvl}">${r.score.toFixed(0)}</span></td>
      </tr>`;
    }).join('');
  }

  function render() {
    renderFilters();
    renderRows();
  }

  // ---------- 详情 ----------

  function chart(r) {
    const g = r.history || [], f = r.free_history || [];
    if (g.length < 2) {
      return '<div class="sc-spark-na" style="padding:22px 0;text-align:center">排名走势需要至少 2 天数据，明天再来看</div>';
    }
    const dates = [...new Set([...g, ...f].map((x) => x[0]))].sort();
    const W = 560, H = 150, P = { l: 30, r: 10, t: 10, b: 20 };
    const all = [...g, ...f].map((x) => x[1]);
    const lo = 1, hi = Math.max(...all, 10);
    const x = (d) => P.l + (dates.indexOf(d) / Math.max(dates.length - 1, 1)) * (W - P.l - P.r);
    const y = (rk) => P.t + ((rk - lo) / (hi - lo)) * (H - P.t - P.b);
    const line = (hist, color, dash) => hist.length < 2 ? '' :
      `<polyline fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="4 4"' : ''} stroke-linejoin="round" points="${hist.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`;
    const ticks = [1, Math.round(hi / 2), hi].map((t) => `<text x="${P.l - 6}" y="${y(t) + 3}" text-anchor="end">#${t}</text><line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.06)"/>`).join('');
    const dl = [dates[0], dates[dates.length - 1]].map((d, i) => `<text x="${x(d)}" y="${H - 4}" text-anchor="${i ? 'end' : 'start'}">${d.slice(5)}</text>`).join('');
    return `<svg class="sc-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ticks}${dl}${line(f, 'rgba(148,163,184,.7)', true)}${line(g, 'rgb(45,212,191)')}</svg>
      <div class="sc-legend"><span><i style="background:rgb(45,212,191)"></i>畅销榜</span><span><i style="background:rgba(148,163,184,.7)"></i>免费榜</span><span>越靠上名次越好</span></div>`;
  }

  function reasons(r) {
    const out = [];
    out.push(`<b>有下载量</b>：${esc(r.genre)}分类免费榜第 ${r.free_rank} 名，` +
      (r.free_checked ? `换算成全部应用总榜约第 ${r.eq_free.toLocaleString()} 名，估算日下载<b>${approx(r.est_downloads)}</b>${r.fit_ok ? '' : '（这个分类今天的换算系数是推算的，误差更大）'}。`
        : `估算日下载<b>${approx(r.est_downloads)}</b>，只是量级参考：${rangeTip('免费榜', r.free_max_k, r.free_rank)}。`));
    out.push(`<b>变现效率</b>：畅销榜第 ${r.grossing_rank} 名、免费榜第 ${r.free_rank} 名。${esc(r.genre)}分类有 ${r.eff_n} 个应用同时上了这两个榜，` +
      `按「免费榜名次 ÷ 畅销榜名次」排它是第 <b>${r.eff_pos}</b>，` +
      ({ hi: '属于本分类靠前的一档，收入排名比下载排名更靠前。', mid: '在本分类处于中游。', lo: '属于本分类靠后的一档，下载排得比收入靠前。' })[effLevel(r).cls] +
      `<span class="sc-sm">只是同分类内的粗略排序，没有真实收入校准，不代表真实付费能力；${effWin()}。</span>`);
    const { multi, periods } = priceInfo(r);
    if (r.items.length) {
      const subs = periods.filter((p) => p !== '永久');
      const kinds = [subs.length ? `<b>${subs.join('、')}</b>订阅` : '', periods.includes('永久') ? '<b>永久</b>买断' : ''].filter(Boolean);
      out.push(`内购从 <b>${money(r.min_price)}</b> 到 <b>${money(r.max_price)}</b>${kinds.length ? `，从名称看有${kinds.join('和')}` : ''}。`);
    }
    if (multi) out.push(`有 <b>${multi}</b> 个内购同名不同价，可能在做价格实验或首购优惠。`);
    if (r.rating_count) out.push(`评分 <b>${(r.rating || 0).toFixed(1)}</b>，共 <b>${r.rating_count.toLocaleString()}</b> 条${r.rating_count < 100 ? '，评分很少，可能偏专业或企业用户' : ''}。`);
    if (r.new_7) out.push('一周前还不在畅销榜前 100，<b>新冲上来的</b>。');
    else if (r.delta_7 > 0) out.push(`畅销榜比一周前上升 <b>${r.delta_7}</b> 名。`);
    return out.map((s) => `<li><span>${s}</span></li>`).join('');
  }

  function openDetail(id) {
    const r = D.items.find((x) => x.app_id === id);
    if (!r) return;
    dlg.innerHTML = `
      <div class="sc-dh">
        <img src="${esc(r.icon)}" alt="" />
        <div><b>${esc(r.name)}</b><span>${esc(r.developer)}</span><span class="sc-tag" style="--g:${genreColor(r.genre_id)}">${esc(r.genre)}</span></div>
        <button class="dlg-x" data-close aria-label="关闭">×</button>
      </div>
      <div class="sc-dbody">
      ${r.intro || r.features?.length ? `<div class="sc-intro">
        ${r.intro ? `<p>${esc(r.intro)}${r.intro_auto ? '<span class="sc-auto" title="新上榜的应用，从 App Store 描述里自动摘录并机器翻译">自动摘录</span>' : ''}</p>` : ''}
        ${r.features?.length ? `<div class="sc-feats">${r.features.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="sc-tiles">
        <div class="sc-tile key"><span>估算日下载</span><b>${approx(r.est_downloads).replace('约 ', '≈')}</b><em>免费榜 #${r.free_rank}${r.free_checked ? '' : ' · 外推'}</em></div>
        <div class="sc-tile" title="${effTip(r)}"><span>变现效率 · 粗略</span><b class="sc-eff ${effLevel(r).cls}">${effLevel(r).txt}</b><em>本分类第 ${r.eff_pos}/${r.eff_n} · 畅销榜 #${r.grossing_rank}</em></div>
        <div class="sc-tile" title="App Store 页面「App 内购买项目」里的最高价和最低价，这个列表最多显示 10 个"><span>最贵内购</span><b style="color:var(--gold)">${money(r.max_price)}</b><em>最低 ${money(r.min_price)} · ${priceInfo(r).tiers} 档</em></div>
        <div class="sc-tile"><span>上线</span><b>${r.age}<small style="font-size:12px;color:var(--muted)"> 天</small></b><em>${r.release_date}</em></div>
      </div>
      <div class="sc-cols"><div class="sc-col">
      <div class="sc-blk sc-blk-why"><div class="sec-h">为什么值得看</div><ul class="sc-why">${reasons(r)}</ul></div>
      <div class="sc-blk sc-blk-chart"><div class="sec-h">30 日排名走势</div>${chart(r)}</div>
      </div>
      <div class="sc-blk sc-blk-iap"><div class="sec-h">内购价格<small>App Store 页面原顺序，最多 10 个</small></div>
        ${r.items.length ? `<ul class="sc-iap">${r.items.map(([n, p], i) => {
          const per = period(n);
          return `<li class="${i >= IAP_PREVIEW ? 'more' : ''}"><i>${i + 1}</i><span>${esc(n)}${per ? `<span class="sc-per">${per}</span>` : ''}</span><b>${esc(p)}</b></li>`;
        }).join('')}</ul>${r.items.length > IAP_PREVIEW ? `<button class="sc-iap-more" data-iap-more>展开全部 ${r.items.length} 个价位</button>` : ''}` : '<div class="sc-spark-na">没有抓到内购信息</div>'}
      </div></div>
      </div>
      <div class="dlg-foot">
        <a class="run sm" href="${esc(r.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>App Store</a>
        <a class="run sm ghost" href="https://appmagic.rocks/iphone/${slug(r.name)}/${r.app_id}" target="_blank" rel="noopener">AppMagic</a>
        <a class="run sm ghost" href="https://www.qimai.cn/app/baseinfo/appid/${r.app_id}/country/${D.country}" target="_blank" rel="noopener">七麦数据</a>
        <button class="run sm ghost" data-copy="${esc(r.name)}">复制名称</button>
      </div>`;
    dlg.querySelector('.sc-dbody').scrollTop = 0;
    document.documentElement.classList.add('dlg-lock');
    dlg.showModal();
  }

  // ---------- 事件 ----------

  renderShell();
  renderBadge();
  document.getElementById('hubRefresh')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const label = btn.querySelector('span');
    btn.disabled = true;
    btn.classList.add('busy');
    try {
      const res = await fetch(`../扫描机会/数据/latest.js?t=${Date.now()}`, { cache: 'no-store' });
      const at = (await res.text()).match(/"generated_at":"([^"]+)"/)?.[1];
      if (!res.ok || !D || at !== D.generated_at) { location.reload(); return; }
      label.textContent = '已是最新';
      setTimeout(() => { label.textContent = '刷新'; }, 1800);
    } catch {
      location.reload();
      return;
    }
    btn.disabled = false;
    btn.classList.remove('busy');
  });
  if (!D) return;
  renderTop();
  renderKpis();
  render();

  root.addEventListener('click', (e) => {
    const copyOpen = e.target.closest('[data-copy-open]');
    if (copyOpen) { navigator.clipboard?.writeText(copyOpen.dataset.copyOpen); return; }
    if (e.target.closest('.sc-top a')) return;
    const card = e.target.closest('[data-open]');
    if (card) { openDetail(card.dataset.open); return; }
    const seg = e.target.closest('[data-seg] .seg-btn');
    if (seg) { ui[seg.closest('[data-seg]').dataset.seg] = seg.dataset.v; saveUi(); render(); return; }
    const chip = e.target.closest('[data-genre]');
    if (chip) { ui.genre = chip.dataset.genre; saveUi(); render(); return; }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      if (ui.sort === th.dataset.sort) ui.asc = !ui.asc; else { ui.sort = th.dataset.sort; ui.asc = false; }
      saveUi(); render(); return;
    }
    if (e.target.closest('#scReset')) {
      Object.assign(ui, { genre: 'all', age: 'all', price: 'all', dl: 'all', q: '' });
      document.getElementById('scQ').value = '';
      saveUi(); render(); return;
    }
    const tr = e.target.closest('tbody tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  document.getElementById('scSort').addEventListener('change', (e) => { ui.sort = e.target.value; ui.asc = false; saveUi(); render(); });
  document.getElementById('scQ').addEventListener('input', (e) => { ui.q = e.target.value; renderFilters(); renderRows(); });

  dlg.addEventListener('click', (e) => {
    const b = dlg.getBoundingClientRect();
    const outside = e.target === dlg && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom);
    if (outside || e.target.closest('[data-close]')) dlg.close();
    const more = e.target.closest('[data-iap-more]');
    if (more) {
      more.previousElementSibling.classList.add('open');
      more.remove();
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy);
      copy.textContent = '已复制';
      setTimeout(() => { copy.textContent = '复制名称'; }, 1200);
    }
  });
  dlg.addEventListener('close', () => document.documentElement.classList.remove('dlg-lock'));

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.body.dataset.tab === 'scan' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      document.getElementById('scQ').focus();
    }
  });
})();
