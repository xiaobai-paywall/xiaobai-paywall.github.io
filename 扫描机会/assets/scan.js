'use strict';
// 扫描机会：展示 scout.py 生成的 数据/latest.js（App Store，window.SCOUT_DATA）和 latest_gp.js（Google Play，window.SCOUT_DATA_GP）
(() => {
  const DATA = { ios: window.SCOUT_DATA, gp: window.SCOUT_DATA_GP };
  const STORE_NAMES = { ios: 'App Store', gp: 'Google Play' };
  const FILES = { ios: 'latest', gp: 'latest_gp' };
  // 每次打开都先看 iOS，不记住上次选的平台
  let store = DATA.ios || !DATA.gp ? 'ios' : 'gp';
  let D = DATA[store];
  const isGp = () => store === 'gp';
  const storeName = () => STORE_NAMES[store];
  const limit = () => D.chart_limit || 100;
  const dlName = () => (isGp() ? '日均新增安装' : '估算日下载');
  // 美国加上配置里的其他国家，不是全世界
  const countryN = () => (D && D.global ? D.global.countries.length + 1 : 0);
  const scopeDl = () => `${countryN()} 个主流国家估算日下载`;
  // 美国榜的下载用各国合计，没有多国数据（Google Play）时就是本国
  const gdl = (r) => r.global_dl ?? r.est_downloads;
  const root = document.getElementById('scan');
  const dlg = document.getElementById('scanDlg');
  const LS_KEY = 'scan-ui-v1';
  const PALETTE = ['250,204,21', '79,140,255', '52,211,153', '251,146,60', '236,72,153', '45,212,191', '167,139,250', '34,211,238', '163,230,53', '96,165,250', '248,113,113', '148,163,184', '244,114,182'];
  // 其他海外榜的行没有美国专属的字段，排序时用全球的对应值
  const SORTS = {
    score: { label: '综合得分', get: (r) => r.score },
    est_downloads: { label: '估算日下载', get: (r) => (view === 'us' ? gdl(r) : r.est_downloads ?? r.global_dl) },
    eff: { label: '变现效率', get: (r) => (r.eff_n ? -r.eff_pos / r.eff_n : -9) },
    delta_7: { label: '7 日上升', get: (r) => (r.delta_7 ?? -999) },
    max_price: { label: '最贵内购', get: (r) => r.max_price },
    grossing_rank: { label: '畅销榜名次', get: (r) => -(r.grossing_rank ?? r.best_grossing.g) },
    age: { label: '最新上线', get: (r) => -r.age },
  };
  const COUNTRY_NAMES = {
    us: '美国', gb: '英国', de: '德国', fr: '法国', it: '意大利', es: '西班牙', nl: '荷兰', pl: '波兰', ca: '加拿大', au: '澳大利亚',
    jp: '日本', kr: '韩国', tw: '台湾', id: '印尼', ph: '菲律宾', vn: '越南', th: '泰国', my: '马来西亚',
    in: '印度', tr: '土耳其', sa: '沙特', br: '巴西', mx: '墨西哥', co: '哥伦比亚',
  };
  const flag = (c) => String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));
  const cname = (c) => COUNTRY_NAMES[c] || c.toUpperCase();
  // us = 美国榜（按美国分类榜筛选），abroad = 其他海外榜，其余是国家代码（按这个国家的榜单看）；不记住上次的选择
  let view = 'us';
  const hasGlobal = () => !!(D && D.global);
  // 7 日变化和 30 日走势要攒够一周数据，之前不占列
  const enoughHistory = () => D.history_days >= 8;
  const isCountry = () => view !== 'us' && view !== 'abroad';
  // 同一个应用的信息各国共用：美国榜、其他海外榜、其余应用信息，按这个顺序找
  const lookup = (id) => D.items.find((x) => x.app_id === id) || (D.overseas || []).find((x) => x.app_id === id) || (D.app_info || {})[id];
  const countryRows = (c) => ((D.by_country || {})[c] || []).map((x) => {
    const r = lookup(x.id);
    return r && { ...r, est_downloads: x.dl, grossing_rank: x.g, c_free: x.f, score: x.score, in_us: D.items.includes(r) };
  }).filter(Boolean);
  const list = () => (!hasGlobal() || view === 'us' ? D.items : view === 'abroad' ? D.overseas || [] : countryRows(view));
  const volMin = () => (D.global ? D.global.min_country_downloads : 300);
  const AGES = [['all', '全部'], ['90', '90 天内'], ['180', '180 天内'], ['365', '一年内']];
  const DLS = [['all', '全部'], ['3000', '≥ 3000'], ['5000', '≥ 5000']];
  const PRICES = [['all', '全部'], ['49.99', '≥ $49.99'], ['99.99', '≥ $99.99']];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // macOS 中国大陆地区设置下台湾旗帜 emoji 显示为方框，下拉菜单里改用代码
  const flagPre = (c) => (c === 'tw' ? '' : `${flag(c)} `);
  const flagIcon = (c) => (c === 'tw' ? `<b class="sc-dd-code">${c.toUpperCase()}</b>` : `<b class="sc-dd-flag">${flag(c)}</b>`);
  // 自绘下拉：原生 select 在 macOS 上是系统浅色菜单，长列表展开也慢
  let sortLabel = '';
  const dropdown = (key, label, opts, val, cls, placeholder, tip) => {
    const cur = opts.find((o) => o.v === val);
    const num = (n) => (n == null ? '' : `<small>${n}</small>`);
    return `<div class="sc-dd" data-dd="${key}">
      <button type="button" class="sc-dd-btn ${cls}" aria-haspopup="listbox" aria-expanded="false"${tip ? ` title="${esc(tip)}"` : ''}>${label ? `<span class="sc-dd-lb">${label}</span>` : ''}<span class="sc-dd-val">${cur ? cur.t : placeholder}</span>${cur ? num(cur.n) : ''}<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>
      <div class="sc-dd-menu${opts.length > 10 ? ' cols' : ''}" role="listbox" hidden>${opts.map((o) =>
        `<button type="button" role="option" data-v="${esc(o.v)}" aria-selected="${o.v === val}" tabindex="-1"><span>${o.t}</span>${num(o.n)}</button>`).join('')}</div>
    </div>`;
  };
  const money = (n) => (n ? `$${n.toFixed(2)}` : '—');
  // 估算值只保留两位有效数字，避免看起来比实际更精确
  const approx = (n) => {
    const step = 10 ** Math.max(Math.floor(Math.log10(Math.max(n, 1))) - 1, 0);
    return `约 ${(Math.round(n / step) * step).toLocaleString()}`;
  };
  // 手机上内购列表先显示这么多个，其余点「展开全部」
  const IAP_PREVIEW = 5;
  // 机器翻译偶尔会留下 <g id="1"> 这类占位标签，展示前去掉
  const plain = (s) => String(s ?? '').replace(/<\/?[a-z][^>]*>/gi, '');
  // AppMagic 按 ID 定位应用，路径里的名称只是给人看的
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
  const genreColor = (gid) => PALETTE[Object.keys(D.genres).indexOf(gid) % PALETTE.length] || PALETTE[11];

  const ui = Object.assign({ genre: 'all', age: 'all', price: 'all', dl: 'all', theme: 'all', sort: 'score', asc: false, q: '' }, (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  })());
  if (!SORTS[ui.sort]) ui.sort = 'score';
  if (!PRICES.some(([v]) => v === ui.price)) ui.price = 'all';
  // 功能名每天可能变，不记住上次选的功能
  const saveUi = () => localStorage.setItem(LS_KEY, JSON.stringify({ ...ui, q: '', theme: 'all' }));
  ui.q = '';
  ui.theme = 'all';

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
  // 位置条：左端是本分类第 1 名，右端是最后一名
  const effBar = (r) => `<span class="sc-rankbar ${effLevel(r).cls}"><b style="left:${((r.eff_pos - 1) / Math.max(r.eff_n - 1, 1) * 100).toFixed(1)}%"></b></span>`;
  const effWin = () => (D.model.eff_days > 1 ? `近 ${D.model.eff_days} 日平均` : '今日榜单，攒满 7 天后改用 7 日平均');
  const effTip = (r) => `${esc(r.genre)}分类有 ${r.eff_n} 个应用同时上了免费榜和畅销榜，按「免费榜名次 ÷ 畅销榜名次」从高到低排，它排第 ${r.eff_pos}（${effWin()}）。` +
    (r.eff_us ? `已合并各国：每个国家各算一次，按各国下载加权，有下载没进畅销榜的国家会拉低；只看美国排第 ${r.eff_us[1]}。` : '') +
    '只是同分类内的粗略排序：假设下载和收入随名次下降的速度差不多，没有真实收入校准，只有排在最前、最后的比较可信，不代表真实付费能力';
  const effGeo = (r) => {
    if (!r.eff_us) return '';
    const vol = r.countries.filter((x) => x.dl >= volMin());
    const d = r.eff_us[1] - r.eff_pos;
    return `合并各国后排第 <b>${r.eff_pos}</b>，只看美国排第 ${r.eff_us[1]}${d > 0 ? `，海外变现比美国好` : d < 0 ? `，海外下载多但进畅销榜的少` : ''}；` +
      `有量的 ${vol.length} 个国家里 ${vol.filter((x) => x.g).length} 个进了畅销榜。`;
  };
  // 只分三档，中间的先后差几名没有意义
  const effLevel = (r) => {
    const p = r.eff_pos / r.eff_n;
    if (p <= 0.3) return { txt: `前 ${effPct(r)}%`, cls: 'hi' };
    if (p > 0.7) return { txt: '靠后', cls: 'lo' };
    return { txt: '中游', cls: 'mid' };
  };
  const genreSize = (g) => {
    const head = (D.model.genre_head || {})[g];
    const tip = head
      ? `本分类畅销第 1 名大约排畅销总榜第 ${head} 名（近 14 天实测）。同样的分类名次，体量大的分类收入高得多`
      : `本分类畅销第 1 名近 14 天都没进过畅销总榜前 ${limit()}，同样的分类名次收入最少`;
    if (!head) return { txt: '很小', cls: 'xs', head, tip };
    if (head <= 5) return { txt: '大', cls: 'lg', head, tip };
    if (head <= 25) return { txt: '中', cls: 'md', head, tip };
    return { txt: '小', cls: 'sm', head, tip };
  };
  const sizeTag = (g) => {
    if (!D.model.genre_head) return '';
    const s = genreSize(g);
    return `<span class="sc-size ${s.cls}" title="${esc(s.tip)}">分类体量${s.txt}</span>`;
  };
  // 全球畅销：几个国家进了分类畅销榜前 10，说明产品本身在赚钱，和分类大小无关
  const grossTag = (r) => {
    const on = (r.countries || []).filter((x) => x.g).sort((a, b) => a.g - b.g);
    const top = on.filter((x) => x.g <= 10);
    if (top.length < 2) return '';
    const tip = `进了 ${on.length} 个国家的分类畅销榜：` + on.map((x) => `${cname(x.c)} #${x.g}`).join('、');
    return `<span class="sc-gross${top.length >= 5 ? ' hi' : ''}" title="${esc(tip)}">${top.length} 国畅销前 10</span>`;
  };
  const rangeTip = (chart, maxK, rank) => maxK
    ? `本分类${chart}只能验证到前 ${maxK} 名（再往后的应用进不了总榜前 100），第 ${rank} 名超出范围，换算是外推的，可能差几倍到十倍`
    : `这个分类最近没有应用同时进入${chart}和总榜前 100，换算无法验证`;
  const guessTag = (r) => (r.fit_ok ? '' : '<span class="sc-guess" title="这个分类今天没有应用进入总榜前 100，换算系数是借另一个榜单推出来的，误差更大">推算</span>');
  // Google Play 的日均新增：累计安装数相减得到的是实测，刚开始记录时只能用上线以来的平均
  const gpDlNote = (r) => (r.dl_src === 'delta' ? `近 ${r.dl_days} 天实测` : '上线以来日均');
  const gpDlTip = (r) => (r.dl_src === 'delta'
    ? `Google Play 公布的累计安装数，近 ${r.dl_days} 天增加的数量 ÷ ${r.dl_days}，现在累计 ${(r.installs || 0).toLocaleString()}`
    : `累计安装 ${(r.installs || 0).toLocaleString()} ÷ 上线 ${r.age} 天。刚开始记录，攒够 2 天后改用每天新增的实测值；新品增长快时会低估`);
  const usPct = (r) => (r.global_dl ? Math.round(r.est_downloads / r.global_dl * 100) : 100);
  const usDl = (r) => `美国占 ${usPct(r)}%`;
  // 表格里表头已经写了「估算」，单元格只放数字，方便右对齐比较
  const approxNum = (n) => approx(n).replace('约 ', '');
  const dlCell = (r) => (r.global_dl != null
    ? `<b>${approxNum(r.global_dl)}</b><span class="sc-sm" title="${esc(r.countries.filter((x) => x.dl).map((x) => `${cname(x.c)}：${approx(x.dl)}`).join('\n'))}"><span${usPct(r) < 40 ? ' class="sc-us-lo" title="美国占比不到 40%，海外比美国强"' : ''}>${usDl(r)}</span> · ${r.vol_countries} 国有量</span>`
    : isGp()
    ? `<b>${approxNum(r.est_downloads)}</b><span class="sc-sm" title="${esc(gpDlTip(r))}">${gpDlNote(r)}</span>`
    : `<b>${approxNum(r.est_downloads)}</b>${guessTag(r)}${r.free_checked ? `<span class="sc-sm">总榜 ≈ #${r.eq_free.toLocaleString()}</span>` : `<span class="sc-sm"><span class="sc-loose" title="${rangeTip('免费榜', r.free_max_k, r.free_rank)}">外推</span></span>`}`);

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
    return list().filter((r) =>
      (ui.age === 'all' || r.age <= +ui.age) &&
      (ui.price === 'all' || r.max_price >= +ui.price) &&
      (ui.dl === 'all' || SORTS.est_downloads.get(r) >= +ui.dl) &&
      (ui.theme === 'all' || (r.theme || NONE) === ui.theme) &&
      (!q || `${r.name} ${r.developer} ${r.genre}`.toLowerCase().includes(q)));
  }

  function filtered() {
    const rows = baseFiltered().filter((r) => ui.genre === 'all' || view !== 'us' || r.genre_id === ui.genre);
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

  function headLine() {
    if (!D) return `每天扫描 ${storeName()} 分类榜单，找出高价订阅新品`;
    const months = Math.round(D.filter.max_age_days / 30);
    const genres = Object.keys(D.genres).length;
    const scope = hasGlobal()
      ? `汇总了美国等 ${countryN()} 个主流国家的数据`
      : `${D.country === 'us' ? '美国区' : D.country.toUpperCase() + ' 区'}`;
    return `${scope} · ${storeName()} · ${genres} 个分类 · 上线 ${months} 个月内的高价订阅新品`;
  }

  function renderShell() {
    const head = `
      <div class="panel-head">
        <span class="tab-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></span>
        <div>
          <h2>扫描机会</h2>
          <p>${headLine()}</p>
        </div>
        <div class="ph-right"><span class="seg sc-store">${Object.entries(STORE_NAMES).map(([k, name]) =>
          `<button class="seg-btn${k === store ? ' active' : ''}" data-store="${k}"${DATA[k] ? ` title="${esc(`${name} · ${DATA[k].items.length} 个候选`)}"` : ' disabled title="还没有扫描数据"'}>${k === 'ios' ? 'iOS' : 'GP'}${DATA[k] ? `<small>${DATA[k].items.length}</small>` : ''}</button>`).join('')}</span></div>
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
      <div class="sc-kpis" id="scKpis"></div>
      <section class="sc-top" id="scTop"></section>
      <section class="sc-themes" id="scThemes"></section>
      <div class="sc-toolbar">
        ${hasGlobal() ? `<div class="sc-views" id="scViews"></div>` : ''}
        <div class="sc-tools">
          <span class="sc-dd-slot" id="scGenreWrap"></span>
          <button type="button" class="sc-sel sc-filter-toggle" id="scFilterToggle" aria-expanded="false" aria-controls="scBar"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span>筛选</span></button>
          <span class="sc-dd-slot" id="scSortWrap"></span>
        </div>
      </div>
      <div class="sc-bar" id="scBar">
        <span class="sc-lb">${dlName()}<span class="seg" data-seg="dl">${DLS.map(([v, t]) => `<button class="seg-btn" data-v="${v}">${t}</button>`).join('')}</span></span>
        <span class="sc-lb">上线<span class="seg" data-seg="age">${AGES.map(([v, t]) => `<button class="seg-btn" data-v="${v}">${t}</button>`).join('')}</span></span>
        <span class="sc-lb">最贵内购<span class="seg" data-seg="price">${PRICES.map(([v, t]) => `<button class="seg-btn" data-v="${v}">${t}</button>`).join('')}</span></span>
      </div>
      <div class="sc-tbl-meta" id="scMeta"></div>
      <div class="sc-wrap"><table class="sc-tbl">
        <thead><tr id="scHead"></tr></thead>
        <tbody id="scBody"></tbody>
      </table></div>
      <details class="sc-note"><summary>数据怎么算：筛选规则、变现效率、下载估算</summary><p>
        <b>筛选规则</b>：上线 ≤ ${D.filter.max_age_days} 天；<b>有下载量</b>：进本分类免费榜前 ${limit()}，且${dlName()} ≥ ${D.filter.min_daily_downloads.toLocaleString()}；
        <b>有付费</b>：进本分类畅销榜前 ${limit()}，最贵内购 ≥ $${D.filter.min_max_price}。${isGp()
          ? 'Google Play 只公开内购单项的最低价和最高价，看不到逐项价格和订阅周期。'
          : '苹果没有公开内购列表的排序依据，所以不判断哪个内购“最热”，只看最高价和最低价。'}<br />
        <b>变现效率</b>：免费榜名次 ÷ 畅销榜名次，只和同一分类里同时上了两个榜的应用比，分「前 x%」（前 30%）、「中游」、「靠后」（后 30%）三档，名次和百分比越小越好；表格里的圆点是名次位置，最左是本分类第 1 名（${effWin()}）。${hasGlobal() ? `美国榜里的变现效率合并了各国：每个国家各算一次这个比值，按各国估算日下载加权平均，在某国有下载却没进畅销榜按第 ${limit() + 1} 名算，所以海外下载多、但海外不赚钱的会被拉低；比较对象还是美国这个分类同时上两个榜的应用，上线超过 ${D.filter.max_age_days} 天的老应用没有各国数据，只用美国的值。` : ''}
        这是粗略排序：假设下载和收入随名次下降的速度差不多，没有真实收入校准，只用来排序，不参与筛选；能确定的付费信号只有「进了本分类畅销榜前 ${limit()}」和内购价格。<br />
        ${hasGlobal() ? `<b>全球畅销</b>：列表里「N 国畅销前 10」是这个产品在几个国家进了分类畅销榜前 10，说明产品本身在赚钱，也参与综合得分；鼠标放上去看各国名次。<br />` : ''}<b>分类体量</b>（只在详情里显示）：本分类畅销第 1 名大约排畅销总榜第几（近 14 天实测）：前 5 为「大」，6–25 为「中」，26–${limit()} 为「小」，进不了总榜前 ${limit()} 为「很小」。同样是分类第 10 名，体量大的分类收入可能高几十倍；只说明分类大小，不换算单个应用的收入。<br />
        ${hasGlobal() ? `<b>多国</b>：另外抓 ${D.global.countries.length} 个国家各分类的免费榜和畅销榜，用同一套方法按各国榜单名次换算日下载，再乘各国的体量系数；估算日下载 ≥ ${volMin()} 的国家算「有量」。
        美国下载不够 ${D.filter.min_daily_downloads.toLocaleString()}、但 ${D.global.overseas_min_countries} 个以上国家有量且合计够了的，也进美国榜。
        <b>其他海外榜</b>：不在美国榜里，但 ${D.global.overseas_min_countries} 个以上国家有量、${D.global.overseas_min_grossing} 个以上国家进了分类畅销榜，美国商店能查到内购且最贵 ≥ $${D.filter.min_max_price}。各国数字误差比美国大，适合比较哪个国家强，不适合当精确数字。<br />` : ''}
        ${isGp()
          ? `<b>日均新增安装</b>：Google Play 公布了每个应用的累计安装数，每天记一次，和近 7 天里最早的一次相减再除以天数，是实测值。
        刚开始记录、还没有更早的数时，先用「累计安装 ÷ 上线天数」，标「上线以来日均」，新品增长快时会低估。`
          : `<b>估算日下载</b>：先用每天同时出现在分类榜和「全部应用」总榜上的应用，把分类名次换算成总榜等效名次，再用 ${D.model.anchors} 个七麦真实日下载样本换算成日下载。
        只是量级参考，样本越多越准，在 config.toml 的 [calibration] 里添加。标「推算」的分类今天没有应用进总榜，误差更大。
        总榜只公布前 100 名，每个分类只有排得很靠前的几名能验证换算，超出这个范围时不显示总榜名次，标「外推估算」。`}
        ${D.history_days < 8 ? `排名变化需要积累 7 天以上数据，目前已积累 <b>${D.history_days} 天</b>。` : ''}
      </p></details>`;
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
          r.global_dl != null ? `上线 <b>${r.age}</b> 天，${scopeDl()}${approx(r.global_dl)}（${usDl(r)}）` : `上线 <b>${r.age}</b> 天，估算日下载${approx(r.est_downloads)}${r.free_checked ? '' : '（外推）'}`,
        ].filter(Boolean);
        return `<article class="sc-top-card" data-open="${r.app_id}" tabindex="0">
          <div class="sc-top-app"><i>${i + 1}</i><img src="${esc(r.icon)}" alt="" />
            <div><b>${esc(r.name)}</b><span><span class="sc-tag" style="--g:${genreColor(r.genre_id)}">${esc(r.genre)}</span>${r.theme ? `<span class="sc-loose sc-theme-tag" data-theme="${esc(r.theme)}" title="点击查看同功能的候选">${esc(r.theme)}</span>` : ''}${strict ? '' : `<span class="sc-loose" title="${esc(miss.join('；'))}">放宽</span>`}</span></div>
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

  // ---------- 功能聚合 ----------

  const THEME_PREVIEW = 4;
  const NONE = '__none';
  let themesOpen = false;

  function themeGroups() {
    const map = {};
    D.items.forEach((r) => { (map[r.theme || NONE] ||= []).push(r); });
    return Object.entries(map).map(([name, apps]) => ({
      name, apps,
      devs: new Set(apps.map((r) => r.developer)).size,
      genres: [...new Set(apps.map((r) => r.genre))],
      best: Math.min(...apps.map((r) => r.grossing_rank)),
      lo: Math.min(...apps.map((r) => r.min_price || r.max_price)),
      hi: Math.max(...apps.map((r) => r.max_price)),
      rising: apps.filter((r) => r.trend && (r.trend.new || r.trend.delta > 0)).length,
    })).sort((a, b) => b.devs - a.devs || a.best - b.best);
  }

  function renderThemes() {
    const box = document.getElementById('scThemes');
    box.classList.toggle('open', themesOpen);
    const all = themeGroups();
    const multi = all.filter((g) => g.name !== NONE && g.apps.length >= 2);
    const single = all.filter((g) => g.name !== NONE && g.apps.length < 2);
    const none = all.find((g) => g.name === NONE);
    const shown = themesOpen ? multi : multi.slice(0, THEME_PREVIEW);
    const chip = (g, label) => `<button class="sc-chip${ui.theme === g.name ? ' active' : ''}" data-theme="${esc(g.name)}">${esc(label || g.name)}<small>${g.apps.length}</small></button>`;
    box.innerHTML = `
      <div class="sc-top-h">
        <div><b>功能聚合</b><span>同一功能有多个开发者都进了畅销榜，说明需求已被验证、可以复制</span></div>
        <em title="关键词在 扫描机会/config.toml 的 [[themes]] 里改，个别分错的在 [theme_assign] 里指定">按名称、简介和功能标签的关键词归类</em>
      </div>
      <div class="sc-theme-list">${shown.map((g) => `
        <article class="sc-theme${ui.theme === g.name ? ' active' : ''}" data-theme="${esc(g.name)}" tabindex="0" aria-pressed="${ui.theme === g.name}">
          <div class="sc-theme-h"><b>${esc(g.name)}</b>${g.devs >= 3 ? '<span class="sc-copy hi" title="3 个以上不同开发者的新品都进了畅销榜">可复制</span>' : '<span class="sc-copy" title="2 个不同开发者的新品进了畅销榜">有苗头</span>'}</div>
          <dl class="sc-theme-stats">
            <div><dt>App</dt><dd>${g.apps.length}</dd></div>
            <div><dt>开发者</dt><dd>${g.devs}</dd></div>
            <div><dt>畅销最好</dt><dd>#${g.best}</dd></div>
            <div title="内购价格区间 ${money(g.lo)}–${money(g.hi)}"><dt>最贵内购</dt><dd class="money">${money(g.hi)}</dd></div>
          </dl>
          <p><span title="${esc(g.genres.join('、'))}">${g.genres.length > 2 ? `跨 ${g.genres.length} 个分类` : esc(g.genres.join('、'))}</span>${g.rising ? ` · <span class="up">${g.rising} 个在上升</span>` : ''}</p>
          <div class="sc-theme-icons">${g.apps.slice(0, 7).map((r) => `<img src="${esc(r.icon)}" alt="" title="${esc(r.name)}" loading="lazy" />`).join('')}${g.apps.length > 7 ? `<i>+${g.apps.length - 7}</i>` : ''}</div>
        </article>`).join('')}</div>
      <div class="sc-theme-more">
        ${multi.length > THEME_PREVIEW || single.length || none ? `<button class="pill-btn sc-act" data-themes-toggle aria-expanded="${themesOpen}"><svg viewBox="0 0 24 24"><path d="${themesOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>${themesOpen ? '收起' : `展开全部 ${multi.length} 个功能${single.length ? `和 ${single.length} 个单品` : ''}`}</button>` : ''}
        ${themesOpen && single.length ? `<span class="sc-lb">只有 1 个</span>${single.map((g) => chip(g)).join('')}` : ''}
        ${themesOpen && none ? chip(none, '未归类') : ''}
        ${!themesOpen && ui.theme !== 'all' && !shown.some((g) => g.name === ui.theme) ? chip(all.find((g) => g.name === ui.theme) || { name: ui.theme, apps: [] }, ui.theme === NONE ? '未归类' : '') : ''}
      </div>`;
  }

  function renderKpis() {
    const all = D.items;
    const prices = all.map((r) => r.max_price).filter(Boolean).sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
    const fresh = all.filter((r) => r.age <= 90).length;
    const rising = all.filter((r) => r.new_7 || r.delta_7 > 0).length;
    const enough = enoughHistory();
    const copyable = themeGroups().filter((g) => g.name !== NONE && g.devs >= 3).length;
    const gross = all.filter((r) => (r.countries || []).filter((x) => x.g && x.g <= 10).length >= 2).length;
    const kpi = (label, val, unit, tip, key) =>
      `<div class="sc-kpi${key ? ' key' : ''}" title="${esc(tip)}"><span>${label}</span><b>${val}${unit ? `<small>${unit}</small>` : ''}</b></div>`;
    document.getElementById('scKpis').innerHTML = [
      kpi('今日候选', all.length, '个', `共扫描 ${D.scanned_apps.toLocaleString()} 个应用`, true),
      kpi(`${hasGlobal() ? `${countryN()} 国日下载` : '日下载'} ≥ 3000`, all.filter((r) => gdl(r) >= 3000).length, '个', hasGlobal() ? `${scopeDl()} ≥ 3000 的候选，只统计这 ${countryN()} 个国家` : `${dlName()} ≥ 3000 的候选`),
      kpi('可复制功能', copyable, '类', '3 个以上不同开发者的新品都进了畅销榜的功能'),
      hasGlobal() ? kpi('多国畅销', gross, '个', '在 2 个以上国家进了分类畅销榜前 10 的候选') : '',
      kpi('最贵内购中位数', money(median), '', '一半候选的最高价位高于这个价'),
      enough ? kpi('7 日上升', rising, '个', '畅销榜名次比一周前更靠前，或新进榜')
        : kpi('90 天内上线', fresh, '个', `7 日变化要积累 7 天数据，目前 ${D.history_days} 天`),
    ].join('');
  }

  function renderFilters() {
    root.querySelectorAll('[data-seg]').forEach((seg) => {
      seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.v === ui[seg.dataset.seg]));
    });
    const sorts = Object.entries(SORTS).filter(([k, x]) => (!x.global || hasGlobal()) && !(view !== 'us' && (k === 'eff' || k === 'delta_7')) && !(k === 'delta_7' && !enoughHistory()));
    if (!sorts.some(([k]) => k === ui.sort)) ui.sort = 'score';
    if (isCountry() && (ui.sort === 'eff' || ui.sort === 'delta_7')) ui.sort = 'score';
    const sortOpts = sorts.map(([k, x]) => ({ v: k, t: k === 'est_downloads' ? (isCountry() ? `${cname(view)}估算日下载` : hasGlobal() ? scopeDl() : dlName()) : x.label }));
    sortLabel = (sortOpts.find((o) => o.v === ui.sort) || sortOpts[0]).t;
    document.getElementById('scSortWrap').innerHTML = dropdown('sort', '排序', sortOpts.map((o) => ({ ...o, t: esc(o.t) })), ui.sort, 'sc-sel');
    const views = document.getElementById('scViews');
    if (views) {
      const bc = D.by_country || {};
      const cs = D.global.countries.filter((c) => (bc[c] || []).length).sort((a, b) => bc[b].length - bc[a].length);
      views.innerHTML = [['us', '美国榜', D.items.length, `已经进了美国分类榜（免费榜和畅销榜都上了）的新应用，下载量是美国等 ${countryN()} 个主流国家的合计`],
        ['abroad', '其他海外榜', (D.overseas || []).length, `美国还没上榜，但在 ${D.global.overseas_min_countries} 个以上其他国家有下载、${D.global.overseas_min_grossing} 个以上国家进了畅销榜的新应用`]]
        .map(([v, t, n, tip]) => `<button class="sc-view${view === v ? ' active' : ''}" data-view="${v}" title="${esc(tip)}">${t}<small>${n}</small></button>`).join('') +
        dropdown('country', '', cs.map((c) => ({ v: c, t: `${flagIcon(c)}${esc(cname(c))}`, n: bc[c].length })), isCountry() ? view : '',
          `sc-view${isCountry() ? ' active' : ''}`, '按国家看', `按这个国家的分类榜看：同时进了免费榜和畅销榜、估算日下载 ≥ ${volMin()}；应用信息和内购价格统一取美国商店`);
    }
    document.getElementById('scGenreWrap').hidden = view !== 'us';
    const base = baseFiltered();
    const counts = {}, total = {};
    base.forEach((r) => { counts[r.genre_id] = (counts[r.genre_id] || 0) + 1; });
    D.items.forEach((r) => { total[r.genre_id] = (total[r.genre_id] || 0) + 1; });
    const genres = Object.keys(D.genres).filter((g) => total[g]).sort((a, b) => (total[b] || 0) - (total[a] || 0));
    document.getElementById('scGenreWrap').innerHTML = dropdown('genre', '分类',
      [{ v: 'all', t: '全部', n: base.length }, ...genres.map((g) => ({ v: g, t: `<i style="--g:${genreColor(g)}"></i>${esc(D.genres[g])}`, n: counts[g] || 0 }))],
      genres.includes(ui.genre) ? ui.genre : 'all', `sc-sel${ui.genre !== 'all' ? ' on' : ''}`);
    const nOn = ['age', 'price', 'dl'].filter((k) => ui[k] !== 'all').length;
    const ft = document.getElementById('scFilterToggle');
    ft.querySelector('span').innerHTML = nOn ? `筛选<b>${nOn}</b>` : '筛选';
    ft.classList.toggle('on', nOn > 0);
    root.querySelectorAll('.sc-tbl th[data-sort]').forEach((th) => {
      th.classList.toggle('on', th.dataset.sort === ui.sort);
      th.classList.toggle('asc', th.dataset.sort === ui.sort && ui.asc);
    });
  }

  // [表头, 排序字段, class, 提示]
  function cols() {
    if (view === 'abroad') {
      return [['应用'], ['分类', '', 'l'], ['上线', 'age'], [scopeDl(), 'est_downloads', '', `美国等 ${countryN()} 个国家的估算日下载合计，不是全世界`],
        ['最好畅销榜', 'grossing_rank'], ['最贵内购', 'max_price'], ['得分', 'score']];
    }
    if (isCountry()) {
      return [['应用'], ['分类', '', 'l'], ['上线', 'age'], [`${cname(view)}畅销 / 免费`, 'grossing_rank'], [`${cname(view)}估算日下载`, 'est_downloads'],
        ['最贵内购', 'max_price'], ['得分', 'score']];
    }
    return [['应用'], ['分类', '', 'l'], ['上线', 'age'], ['畅销 / 免费', 'grossing_rank'], [hasGlobal() ? scopeDl() : dlName(), 'est_downloads', '', hasGlobal() ? `美国等 ${countryN()} 个国家的估算日下载合计，不是全世界；鼠标放到小字上看各国明细` : ''],
      ['变现效率', 'eff', '', '圆点是它在本分类的名次位置：最左是第 1 名，越靠左越好'], ['最贵内购', 'max_price'],
      ...(enoughHistory() ? [['7 日', 'delta_7'], ['30 日走势']] : []), ['得分', 'score']];
  }

  function abroadRow(r) {
    const pi = priceInfo(r);
    const b = r.best_grossing;
    const lvl = r.score >= 110 ? '' : r.score >= 85 ? ' mid' : ' low';
    return `<tr data-id="${r.app_id}" tabindex="0" aria-label="${esc(r.name)}，打开详情">
      <td data-l="应用"><div class="sc-app"><img src="${esc(r.icon)}" alt="" loading="lazy" /><div><div class="nm" title="${esc(r.name)}">${esc(r.name)}</div><div class="cd" title="${esc(r.developer)}">${esc(r.developer)}</div></div></div></td>
      <td class="l" data-l="分类"><span class="sc-tag"${r.genre_id ? ` style="--g:${genreColor(r.genre_id)}"` : ''}>${esc(r.genre)}</span>${r.theme ? `<span class="sc-sm sc-theme-of">${esc(r.theme)}</span>` : ''}</td>
      <td data-l="上线">${r.age} 天<span class="sc-sm">${r.release_date.slice(2).replace(/-/g, '/')}</span></td>
      <td data-l="${scopeDl()}"><b>${approxNum(r.global_dl)}</b><span class="sc-sm">${r.vol_countries} 国有量</span></td>
      <td data-l="最好畅销榜"><b>#${b.g}</b><span class="sc-sm">${flagPre(b.c)}${cname(b.c)} · ${r.gross_countries} 国上榜</span></td>
      <td data-l="最贵内购"><span class="sc-price">${money(r.max_price)}</span><span class="sc-sm">${pi.maxPer ? `<span class="sc-per">${pi.maxPer}</span>` : ''}最低 ${money(r.min_price)} · ${pi.tiers} 档</span></td>
      <td data-l="得分"><span class="sc-score${lvl}">${r.score.toFixed(0)}</span></td>
    </tr>`;
  }

  function countryRow(r) {
    const pi = priceInfo(r);
    const lvl = r.score >= 110 ? '' : r.score >= 85 ? ' mid' : ' low';
    return `<tr data-id="${r.app_id}" tabindex="0" aria-label="${esc(r.name)}，打开详情">
      <td data-l="应用"><div class="sc-app"><img src="${esc(r.icon)}" alt="" loading="lazy" /><div><div class="nm" title="${esc(r.name)}">${esc(r.name)}${r.in_us ? '<span class="sc-in-us" title="也在美国榜里">美国也在榜</span>' : ''}</div><div class="cd" title="${esc(r.developer)}">${esc(r.developer)}</div></div></div></td>
      <td class="l" data-l="分类"><span class="sc-tag"${r.genre_id ? ` style="--g:${genreColor(r.genre_id)}"` : ''}>${esc(r.genre)}</span>${r.theme ? `<span class="sc-sm sc-theme-of">${esc(r.theme)}</span>` : ''}</td>
      <td data-l="上线">${r.age} 天<span class="sc-sm">${r.release_date.slice(2).replace(/-/g, '/')}</span></td>
      <td data-l="${cname(view)}畅销 / 免费"><b>#${r.grossing_rank}</b><span class="sc-sm">免费 #${r.c_free}</span></td>
      <td data-l="${cname(view)}估算日下载"><b>${approxNum(r.est_downloads)}</b></td>
      <td data-l="最贵内购"><span class="sc-price">${money(r.max_price)}</span><span class="sc-sm">${pi.maxPer ? `<span class="sc-per">${pi.maxPer}</span>` : ''}最低 ${money(r.min_price)} · ${pi.tiers} 档</span></td>
      <td data-l="得分"><span class="sc-score${lvl}">${r.score.toFixed(0)}</span></td>
    </tr>`;
  }

  function renderRows() {
    const rows = filtered();
    const body = document.getElementById('scBody');
    const cs = cols();
    document.getElementById('scHead').innerHTML = cs.map(([t, k, c, tip]) => {
      const on = k && k === ui.sort;
      return `<th${c ? ` class="${c}"` : ''}${k ? ` data-sort="${k}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}${on ? ` aria-sort="${ui.asc ? 'ascending' : 'descending'}"` : ''}>${k
        ? `<button type="button" title="${esc(on ? (ui.asc ? '现在是差的在前，点击改成好的在前' : '现在是好的在前，点击反过来') : `按${t}排序，好的在前`)}">${t}</button>` : t}</th>`;
    }).join('');
    root.querySelectorAll('.sc-tbl th[data-sort]').forEach((th) => {
      th.classList.toggle('on', th.dataset.sort === ui.sort);
      th.classList.toggle('asc', th.dataset.sort === ui.sort && ui.asc);
    });
    const sortName = sortLabel;
    const pick = (list, k) => (list.find(([v]) => v === ui[k]) || [])[1];
    const on = [
      ui.theme !== 'all' && ['theme', `功能：${ui.theme === NONE ? '未归类' : ui.theme}`],
      view === 'us' && ui.genre !== 'all' && D.genres[ui.genre] && ['genre', `分类：${D.genres[ui.genre]}`],
      ui.dl !== 'all' && ['dl', `${dlName()} ${pick(DLS, 'dl')}`],
      ui.age !== 'all' && ['age', `上线 ${pick(AGES, 'age')}`],
      ui.price !== 'all' && ['price', `最贵内购 ${pick(PRICES, 'price')}`],
    ].filter(Boolean);
    const tip = view === 'abroad' ? '美国还没起来、在其他国家先跑起来的新品'
      : isCountry() ? `${cname(view)}分类榜上同时进了免费榜和畅销榜的新品，标「美国也在榜」的也在美国榜里`
      : !enoughHistory() ? `7 日变化和 30 日走势攒满 7 天后显示，已积累 ${D.history_days} 天` : '';
    document.getElementById('scMeta').innerHTML =
      `<span class="sc-meta-l"><span><b>${rows.length}</b> 个产品 · 按${esc(sortName)}${ui.asc ? '（反向）' : ''}</span>` +
      on.map(([k, t]) => `<button type="button" class="sc-on" data-clear="${k}" title="去掉「${esc(t)}」"><span>${esc(t)}</span><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`).join('') +
      (on.length > 1 ? `<button type="button" class="sc-on-clear" data-reset>全部清除</button>` : '') + `</span>` +
      (tip ? `<span>${esc(tip)}</span>` : '');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${cs.length}" class="sc-none"><div class="sc-none-in"><b>没有符合当前条件的产品</b>${on.length
        ? `<span>去掉一两个条件再看看，或者</span><button type="button" class="pill-btn sc-act" data-reset>清空全部条件</button>`
        : `<span>${view === 'us' ? '今天的扫描没有筛出候选' : '这个视图今天没有符合条件的产品'}</span>`}</div></td></tr>`;
      return;
    }
    if (view === 'abroad') { body.innerHTML = rows.map(abroadRow).join(''); return; }
    if (isCountry()) { body.innerHTML = rows.map(countryRow).join(''); return; }
    body.innerHTML = rows.map((r) => {
      const pi = priceInfo(r);
      const lvl = r.score >= 110 ? '' : r.score >= 85 ? ' mid' : ' low';
      const gt = grossTag(r);
      return `<tr data-id="${r.app_id}" tabindex="0" aria-label="${esc(r.name)}，打开详情">
        <td data-l="应用"><div class="sc-app"><img src="${esc(r.icon)}" alt="" loading="lazy" /><div><div class="nm" title="${esc(r.name)}">${esc(r.name)}</div><div class="cd" title="${esc(r.developer)}">${esc(r.developer)}</div>${gt ? `<div class="sc-m-only">${gt}</div>` : ''}</div></div></td>
        <td class="l" data-l="分类"><span class="sc-tag" style="--g:${genreColor(r.genre_id)}">${esc(r.genre)}</span>${gt}${r.theme ? `<span class="sc-sm sc-theme-of">${esc(r.theme)}</span>` : ''}</td>
        <td data-l="上线">${r.age} 天<span class="sc-sm">${r.release_date.slice(2).replace(/-/g, '/')}</span></td>
        <td data-l="畅销 / 免费"><b>#${r.grossing_rank}</b><span class="sc-sm">免费 #${r.free_rank}</span></td>
        <td data-l="${hasGlobal() ? scopeDl() : dlName()}">${dlCell(r)}</td>
        <td data-l="变现效率" title="${effTip(r)}"><span class="sc-ratio sc-eff ${effLevel(r).cls}">${effBar(r)}${effLevel(r).txt}</span><span class="sc-sm">本分类第 ${r.eff_pos}/${r.eff_n}</span></td>
        <td data-l="最贵内购"><span class="sc-price">${money(r.max_price)}</span><span class="sc-sm">${pi.maxPer ? `<span class="sc-per">${pi.maxPer}</span>` : ''}最低 ${money(r.min_price)}${isGp() ? '' : ` · ${pi.tiers} 档`}</span></td>
        ${enoughHistory() ? `<td data-l="7 日">${deltaBadge(r)}</td><td data-l="30 日走势">${spark(r.history)}</td>` : ''}
        <td data-l="得分"><span class="sc-score${lvl}">${r.score.toFixed(0)}</span></td>
      </tr>`;
    }).join('');
  }

  function render() {
    renderThemes();
    renderFilters();
    renderRows();
    scrollEdges();
  }

  function scrollEdges() {
    const w = root.querySelector('.sc-wrap');
    if (!w) return;
    const rest = w.scrollWidth - w.clientWidth - w.scrollLeft;
    w.classList.toggle('can-l', w.scrollLeft > 2);
    w.classList.toggle('can-r', rest > 2);
  }

  // ---------- 详情 ----------

  function chart(r) {
    const g = r.history || [], f = r.free_history || [];
    if (g.length < 2) {
      return '<div class="sc-spark-na" style="padding:22px 0;text-align:center">排名走势需要至少 2 天数据，明天再来看</div>';
    }
    const dates = [...new Set([...g, ...f].map((x) => x[0]))].sort();
    const W = 560, H = 150, P = { l: 36, r: 10, t: 12, b: 22 };
    const all = [...g, ...f].map((x) => x[1]);
    const lo = 1, hi = Math.max(...all, 10);
    const x = (d) => P.l + (dates.indexOf(d) / Math.max(dates.length - 1, 1)) * (W - P.l - P.r);
    const y = (rk) => P.t + ((rk - lo) / (hi - lo)) * (H - P.t - P.b);
    const line = (hist, cls, dash) => hist.length < 2 ? '' :
      `<polyline class="${cls}" fill="none" stroke-width="2" ${dash ? 'stroke-dasharray="4 4"' : ''} stroke-linejoin="round" points="${hist.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`;
    const ticks = [1, Math.round(hi / 2), hi].map((t) => `<text x="${P.l - 6}" y="${y(t) + 3}" text-anchor="end">#${t}</text><line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('');
    const dl = [dates[0], dates[dates.length - 1]].map((d, i) => `<text x="${x(d)}" y="${H - 4}" text-anchor="${i ? 'end' : 'start'}">${d.slice(5)}</text>`).join('');
    return `<svg class="sc-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ticks}${dl}${line(f, 'ln-f', true)}${line(g, 'ln-g')}</svg>
      <div class="sc-legend"><span><i class="ln-g"></i>畅销榜</span><span><i class="ln-f"></i>免费榜</span><span>越靠上名次越好</span></div>`;
  }

  function reasons(r) {
    const out = [];
    out.push(`<b>有下载量</b>：${esc(r.genre)}分类免费榜第 ${r.free_rank} 名，` + (isGp()
      ? `Google Play 公布的累计安装 <b>${(r.installs || 0).toLocaleString()}</b>，日均新增<b>${approx(r.est_downloads)}</b>` +
        (r.dl_src === 'delta' ? `（近 ${r.dl_days} 天实测）。` : '（上线以来的平均，攒够 2 天数据后改用实测，新品增长快时会低估）。')
      : r.free_checked ? `换算成全部应用总榜约第 ${r.eq_free.toLocaleString()} 名，估算日下载<b>${approx(r.est_downloads)}</b>${r.fit_ok ? '' : '（这个分类今天的换算系数是推算的，误差更大）'}。`
        : `估算日下载<b>${approx(r.est_downloads)}</b>，只是量级参考：${rangeTip('免费榜', r.free_max_k, r.free_rank)}。`));
    out.push(`<b>变现效率</b>：畅销榜第 ${r.grossing_rank} 名、免费榜第 ${r.free_rank} 名。${esc(r.genre)}分类有 ${r.eff_n} 个应用同时上了这两个榜，` +
      (r.eff_us ? `按「免费榜名次 ÷ 畅销榜名次」在各国分别计算、按各国下载加权，${effGeo(r)}` : `按「免费榜名次 ÷ 畅销榜名次」排它是第 <b>${r.eff_pos}</b>，`) +
      ({ hi: '属于本分类靠前的一档，收入排名比下载排名更靠前。', mid: '在本分类处于中游。', lo: '属于本分类靠后的一档，下载排得比收入靠前。' })[effLevel(r).cls] +
      `<span class="sc-sm">只是同分类内的粗略排序，没有真实收入校准，不代表真实付费能力；${effWin()}。</span>`);
    const { multi, periods } = priceInfo(r);
    if (r.items.length) {
      const subs = periods.filter((p) => p !== '永久');
      const kinds = [subs.length ? `<b>${subs.join('、')}</b>订阅` : '', periods.includes('永久') ? '<b>永久</b>买断' : ''].filter(Boolean);
      out.push(`内购从 <b>${money(r.min_price)}</b> 到 <b>${money(r.max_price)}</b>${kinds.length ? `，从名称看有${kinds.join('和')}` : ''}。`);
    } else if (isGp() && r.max_price) {
      out.push(`内购单项从 <b>${money(r.min_price)}</b> 到 <b>${money(r.max_price)}</b>（Google Play 只公开这个区间，看不出订阅周期）。`);
    }
    if (multi) out.push(`有 <b>${multi}</b> 个内购同名不同价，可能在做价格实验或首购优惠。`);
    if (r.rating_count) out.push(`评分 <b>${(r.rating || 0).toFixed(1)}</b>，共 <b>${r.rating_count.toLocaleString()}</b> 条${r.rating_count < 100 ? '，评分很少，可能偏专业或企业用户' : ''}。`);
    const peers = r.theme ? D.items.filter((x) => x.theme === r.theme && x.app_id !== r.app_id) : [];
    if (peers.length) {
      const devs = new Set([r, ...peers].map((x) => x.developer)).size;
      out.push(`同功能「${esc(r.theme)}」今天还有 <b>${peers.length}</b> 个候选（共 ${devs} 个开发者）：${peers.slice(0, 4).map((x) => esc(x.name)).join('、')}${peers.length > 4 ? ' 等' : ''}。`);
    }
    if (r.new_7) out.push('一周前还不在畅销榜前 100，<b>新冲上来的</b>。');
    else if (r.delta_7 > 0) out.push(`畅销榜比一周前上升 <b>${r.delta_7}</b> 名。`);
    return out.map((s) => `<li><span>${s}</span></li>`).join('');
  }

  function iapList(r) {
    const num = (p) => parseFloat(String(p).replace(/[^\d.]/g, '')) || 0;
    const top = Math.max(...r.items.map(([, p]) => num(p)));
    return `<ul class="sc-iap">${r.items.map(([n, p], i) => {
      const per = period(n);
      const cls = [i >= IAP_PREVIEW ? 'more' : '', num(p) === top ? 'top' : ''].filter(Boolean).join(' ');
      return `<li${cls ? ` class="${cls}"` : ''}><i>${i + 1}</i><span title="${esc(n)}">${esc(n)}${per ? `<span class="sc-per">${per}</span>` : ''}</span><b>${esc(p)}</b></li>`;
    }).join('')}</ul>${r.items.length > IAP_PREVIEW ? `<button class="sc-iap-more" data-iap-more>展开全部 ${r.items.length} 个价位</button>` : ''}`;
  }

  function geoBlock(r) {
    if (!r.countries || !r.countries.length) return '';
    const on = r.countries.filter((x) => x.dl >= volMin() || x.g);
    const rest = r.countries.filter((x) => !on.includes(x) && x.dl);
    const off = D.global.countries.length + 1 - on.length - rest.length;
    const top = Math.max(...r.countries.map((x) => x.dl), 1);
    const us = r.countries.find((x) => x.c === D.country);
    const share = us && r.global_dl ? Math.round(us.dl / r.global_dl * 100) : 0;
    const row = (x, more) => `<tr class="${x.dl >= volMin() ? 'vol' : ''}${more ? ' more' : ''}"><td>${flagIcon(x.c)} ${cname(x.c)}</td>
      <td><span class="sc-geo-bar"><i style="width:${(x.dl / top * 100).toFixed(1)}%"></i></span>${x.dl ? approx(x.dl).replace('约 ', '') : '—'}</td>
      <td>${x.f ? `#${x.f}` : '—'}</td><td class="${x.g ? (x.g <= 10 ? 'g10' : 'g') : ''}">${x.g ? `#${x.g}` : '—'}</td></tr>`;
    return `<div class="sc-blk sc-blk-geo"><div class="sec-h">各国表现<small>${r.vol_countries} 国有量 · 合计≈${approx(r.global_dl).replace('约 ', '')}${us ? ` · 美国占 ${share}%` : ''}</small></div>
      <table class="sc-geo"><thead><tr><th>国家</th><th>估算日下载</th><th>免费榜</th><th>畅销榜</th></tr></thead><tbody>
      ${on.map((x) => row(x)).join('')}${rest.map((x) => row(x, true)).join('')}
      </tbody></table>
      ${rest.length ? `<button class="sc-iap-more" data-geo-more>展开其余 ${rest.length} 个零星下载的国家</button>` : ''}
      <p class="sc-geo-off">日下载 ≥ ${volMin()} 算有量，名次都是分类榜；按各国榜单换算，只用来横向比较${off > 0 ? `；其余 ${off} 个国家今天没进榜` : ''}</p></div>`;
  }

  function openAbroad(r) {
    const b = r.best_grossing;
    dlg.innerHTML = `
      <div class="sc-dh">
        <img src="${esc(r.icon)}" alt="" />
        <div><b title="${esc(r.name)}">${esc(r.name)}</b><span title="${esc(r.developer)}">${esc(r.developer)}</span><p class="sc-dh-tags"><span class="sc-tag"${r.genre_id ? ` style="--g:${genreColor(r.genre_id)}"` : ''}>${esc(r.genre)}</span>${(D.overseas || []).includes(r) ? '<span class="sc-loose">其他海外榜</span>' : ''}${r.theme ? `<span class="sc-dh-theme" title="${esc(r.theme)}">${esc(r.theme)}</span>` : ''}</p></div>
        <button class="dlg-x" data-close aria-label="关闭">×</button>
      </div>
      <div class="sc-dbody">
      ${r.intro || r.features?.length ? `<div class="sc-intro">
        ${r.intro ? `<p>${esc(plain(r.intro))}${r.intro_auto ? '<span class="sc-auto">自动摘录</span>' : ''}</p>` : ''}
        ${r.features?.length ? `<div class="sc-feats">${r.features.map((f) => `<span title="${esc(plain(f))}">${esc(plain(f))}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="sc-tiles">
        <div class="sc-tile key" title="美国等 ${countryN()} 个国家的估算日下载合计，不是全世界"><span>有量国家</span><b>${r.vol_countries}<small> 国</small></b><em>${scopeDl()}${approx(r.global_dl)}</em></div>
        <div class="sc-tile"><span>最好畅销榜</span><b>${b ? `#${b.g}` : '—'}</b><em>${b ? `${flagPre(b.c)}${cname(b.c)} · ${r.gross_countries} 国进了畅销榜` : '没进畅销榜'}</em></div>
        <div class="sc-tile"><span>最贵内购</span><b class="money">${money(r.max_price)}</b><em>最低 ${money(r.min_price)} · 美国商店价格</em></div>
        <div class="sc-tile"><span>上线</span><b>${r.age}<small> 天</small></b><em>${r.release_date}</em></div>
      </div>
      <div class="sc-cols"><div class="sc-col">${geoBlock(r)}</div>
      <div class="sc-blk sc-blk-iap"><div class="sec-h">内购价格<small>美国商店，最多 10 个</small></div>
        ${iapList(r)}
      </div></div>
      </div>
      <div class="dlg-foot">
        <a class="run sm" href="${esc(r.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${storeName()}</a>
        <a class="run sm ghost" href="https://appmagic.rocks/iphone/${slug(r.name)}/${r.app_id}" target="_blank" rel="noopener">AppMagic</a>
        <a class="run sm ghost" href="https://www.qimai.cn/app/baseinfo/appid/${r.app_id}/country/${b ? b.c : D.country}" target="_blank" rel="noopener">七麦数据</a>
        <button class="run sm ghost" data-copy="${esc(r.name)}">复制名称</button>
      </div>`;
    dlg.querySelector('.sc-dbody').scrollTop = 0;
    document.documentElement.classList.add('dlg-lock');
    dlg.showModal();
  }

  function openDetail(id) {
    const r = D.items.find((x) => x.app_id === id);
    if (!r) { const o = lookup(id); if (o) openAbroad(o); return; }
    dlg.innerHTML = `
      <div class="sc-dh">
        <img src="${esc(r.icon)}" alt="" />
        <div><b title="${esc(r.name)}">${esc(r.name)}</b><span title="${esc(r.developer)}">${esc(r.developer)}</span><p class="sc-dh-tags"><span class="sc-tag" style="--g:${genreColor(r.genre_id)}">${esc(r.genre)}</span>${grossTag(r)}${sizeTag(r.genre_id)}${r.theme ? `<span class="sc-dh-theme" title="${esc(r.theme)}">${esc(r.theme)}</span>` : ''}</p></div>
        <button class="dlg-x" data-close aria-label="关闭">×</button>
      </div>
      <div class="sc-dbody">
      ${r.intro || r.features?.length ? `<div class="sc-intro">
        ${r.intro ? `<p>${esc(plain(r.intro))}${r.intro_auto ? `<span class="sc-auto" title="新上榜的应用，从 ${storeName()} 描述里自动摘录并机器翻译">自动摘录</span>` : ''}</p>` : ''}
        ${r.features?.length ? `<div class="sc-feats">${r.features.map((f) => `<span title="${esc(plain(f))}">${esc(plain(f))}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="sc-tiles">
        <div class="sc-tile key"${isGp() ? ` title="${esc(gpDlTip(r))}"` : r.global_dl != null ? ` title="美国等 ${countryN()} 个国家的估算日下载合计，不是全世界"` : ''}><span>${r.global_dl != null ? scopeDl() : dlName()}</span><b>${approx(gdl(r)).replace('约 ', '≈')}</b><em>${isGp() ? `累计 ${(r.installs || 0).toLocaleString()} · ${gpDlNote(r)}` : r.global_dl != null ? `${usDl(r)} · 免费榜 #${r.free_rank}` : `免费榜 #${r.free_rank}${r.free_checked ? '' : ' · 外推'}`}</em></div>
        <div class="sc-tile" title="${effTip(r)}"><span>变现效率 · 粗略</span><b class="sc-eff ${effLevel(r).cls}">${effLevel(r).txt}</b><em>本分类第 ${r.eff_pos}/${r.eff_n} · ${r.eff_us ? `只看美国第 ${r.eff_us[1]}` : `畅销榜 #${r.grossing_rank}`}</em></div>
        <div class="sc-tile" title="${isGp() ? 'Google Play 页面公布的内购单项价格区间' : 'App Store 页面「App 内购买项目」里的最高价和最低价，这个列表最多显示 10 个'}"><span>最贵内购</span><b class="money">${money(r.max_price)}</b><em>最低 ${money(r.min_price)}${isGp() ? ' · 单项区间' : ` · ${priceInfo(r).tiers} 档`}</em></div>
        <div class="sc-tile"><span>上线</span><b>${r.age}<small> 天</small></b><em>${r.release_date}</em></div>
      </div>
      <div class="sc-cols"><div class="sc-col">
      <div class="sc-blk sc-blk-why"><div class="sec-h">为什么值得看</div><ul class="sc-why">${reasons(r)}</ul></div>
      <div class="sc-blk sc-blk-chart"><div class="sec-h">30 日排名走势</div>${chart(r)}</div>
      </div><div class="sc-col">
      <div class="sc-blk sc-blk-iap"><div class="sec-h">内购价格<small>${isGp() ? 'Google Play 只公开单项价格区间' : 'App Store 页面原顺序，最多 10 个'}</small></div>
        ${isGp() ? `<div class="sc-spark-na" style="padding:14px 0">${r.iap_range ? `${esc(r.iap_range.replace(' per item', ''))}（单项）<br />没有逐项价格表，订阅周期要装上 App 看付费墙` : '没有抓到内购信息'}</div>` : r.items.length ? iapList(r) : '<div class="sc-spark-na">没有抓到内购信息</div>'}
      </div>
      ${geoBlock(r)}
      </div></div>
      </div>
      <div class="dlg-foot">
        <a class="run sm" href="${esc(r.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${storeName()}</a>
        <a class="run sm ghost" href="https://appmagic.rocks/${isGp() ? 'google-play' : 'iphone'}/${slug(r.name)}/${r.app_id}" target="_blank" rel="noopener">AppMagic</a>
        ${isGp() ? '' : `<a class="run sm ghost" href="https://www.qimai.cn/app/baseinfo/appid/${r.app_id}/country/${D.country}" target="_blank" rel="noopener">七麦数据</a>`}
        <button class="run sm ghost" data-copy="${esc(r.name)}">复制名称</button>
      </div>`;
    dlg.querySelector('.sc-dbody').scrollTop = 0;
    document.documentElement.classList.add('dlg-lock');
    dlg.showModal();
  }

  // ---------- 事件 ----------

  function mount() {
    renderShell();
    renderBadge();
    if (!D) return;
    renderTop();
    renderKpis();
    render();
  }

  mount();
  document.getElementById('hubRefresh')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const label = btn.querySelector('span');
    btn.disabled = true;
    btn.classList.add('busy');
    label.textContent = '检查中…';
    try {
      const res = await fetch(`../扫描机会/数据/${FILES[store]}.js?t=${Date.now()}`, { cache: 'no-store' });
      const at = (await res.text()).match(/"generated_at":"([^"]+)"/)?.[1];
      if (!res.ok || !D || at !== D.generated_at) { location.reload(); return; }
      label.textContent = '已是最新';
      btn.classList.add('done');
      setTimeout(() => { label.textContent = '刷新'; btn.classList.remove('done'); }, 1800);
    } catch {
      location.reload();
      return;
    }
    btn.disabled = false;
    btn.classList.remove('busy');
  });
  root.addEventListener('click', (e) => {
    const st = e.target.closest('[data-store]');
    if (st) {
      if (st.dataset.store === store || !DATA[st.dataset.store]) return;
      store = st.dataset.store;
      D = DATA[store];
      // 两个平台的分类和功能不一样，切换后从「全部」开始
      Object.assign(ui, { genre: 'all', theme: 'all' });
      themesOpen = false;
      view = 'us';
      mount();
      return;
    }
    if (!D) return;
    const ft = e.target.closest('#scFilterToggle');
    if (ft) {
      const open = root.classList.toggle('sc-filters-open');
      ft.setAttribute('aria-expanded', open);
      return;
    }
    const copyOpen = e.target.closest('[data-copy-open]');
    if (copyOpen) { navigator.clipboard?.writeText(copyOpen.dataset.copyOpen); return; }
    if (e.target.closest('.sc-top a')) return;
    if (e.target.closest('[data-themes-toggle]')) { themesOpen = !themesOpen; renderThemes(); return; }
    const theme = e.target.closest('[data-theme]');
    if (theme) {
      ui.theme = ui.theme === theme.dataset.theme ? 'all' : theme.dataset.theme;
      ui.genre = 'all';
      render();
      if (ui.theme !== 'all') document.querySelector('.sc-toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const vw = e.target.closest('[data-view]');
    if (vw) { view = vw.dataset.view; render(); return; }
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
    const clr = e.target.closest('[data-clear]');
    if (clr) { ui[clr.dataset.clear] = 'all'; saveUi(); render(); return; }
    if (e.target.closest('[data-reset]')) {
      Object.assign(ui, { genre: 'all', age: 'all', price: 'all', dl: 'all', theme: 'all' });
      saveUi(); render(); return;
    }
    const tr = e.target.closest('tbody tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  // 表格行、功能卡用键盘也能打开：回车或空格等同点击
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest('tr[data-id], article[data-theme], article[data-open]');
    if (!t || t !== e.target) return;
    e.preventDefault();
    t.click();
  });
  root.addEventListener('scroll', (e) => { if (e.target.classList?.contains('sc-wrap')) scrollEdges(); }, true);
  addEventListener('resize', scrollEdges);
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
    if (key === 'country') view = v || 'us';
    else if (key === 'genre') { ui.genre = v; saveUi(); }
    else if (key === 'sort') { ui.sort = v; ui.asc = false; saveUi(); }
    render();
    root.querySelector(`[data-dd="${key}"] .sc-dd-btn`)?.focus();
  };
  root.addEventListener('click', (e) => {
    if (e.target.classList.contains('sc-dd')) { ddClose(); return; }
    const btn = e.target.closest('.sc-dd-btn');
    if (btn) { const d = btn.closest('.sc-dd'); if (d.classList.contains('open')) ddClose(); else ddOpen(d); return; }
    const opt = e.target.closest('.sc-dd [role=option]');
    if (opt) { const key = opt.closest('.sc-dd').dataset.dd; ddClose(); ddPick(key, opt.dataset.v); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.sc-dd')) ddClose(); });
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
    const cols = d.querySelector('.sc-dd-menu').classList.contains('cols') ? 2 : 1;
    const step = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const to = step ? i + step : e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    opts[Math.max(0, Math.min(opts.length - 1, to))].focus();
  });
  dlg.addEventListener('click', (e) => {
    const b = dlg.getBoundingClientRect();
    const outside = e.target === dlg && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom);
    if (outside || e.target.closest('[data-close]')) dlg.close();
    const more = e.target.closest('[data-iap-more]');
    if (more) {
      more.previousElementSibling.classList.add('open');
      more.remove();
    }
    const geoMore = e.target.closest('[data-geo-more]');
    if (geoMore) {
      geoMore.previousElementSibling.classList.add('open');
      geoMore.remove();
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy);
      copy.textContent = '已复制';
      setTimeout(() => { copy.textContent = '复制名称'; }, 1200);
    }
  });
  dlg.addEventListener('close', () => document.documentElement.classList.remove('dlg-lock'));
})();
