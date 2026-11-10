// Google Play 抓取：由 scout.py --store gp 调用，结果以 JSON 打到 stdout，日志走 stderr。
//   node gp_fetch.mjs charts us APPLICATION,PRODUCTIVITY,...   各分类免费榜、畅销榜
//   node gp_fetch.mjs details us < ids.txt                      应用详情（每行一个包名）
import gplay from 'google-play-scraper';

const [cmd, country = 'us', arg = ''] = process.argv.slice(2);
const NUM = 200;
const POOL = 8;

const retry = async (fn, tries = 3) => {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
};

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch((e) => { console.error(`失败 ${items[i]}: ${e.message}`); return null; });
    }
  }));
  return out;
}

const iso = (s) => {
  const t = Date.parse(s || '');
  return Number.isNaN(t) ? '' : new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};

if (cmd === 'charts') {
  const jobs = arg.split(',').filter(Boolean).flatMap((cat) => [['free', gplay.collection.TOP_FREE], ['grossing', gplay.collection.GROSSING]]
    .map(([chart, collection]) => ({ cat, chart, collection })));
  const lists = await pool(jobs, (j) => retry(() => gplay.list({ collection: j.collection, category: j.cat, num: NUM, country })));
  const out = {};
  jobs.forEach((j, i) => {
    (out[j.cat] ||= {})[j.chart] = (lists[i] || []).map((a) => ({
      app_id: a.appId, name: a.title, developer: a.developer, icon: a.icon, url: a.url,
    }));
  });
  process.stdout.write(JSON.stringify(out));
} else if (cmd === 'details') {
  let input = '';
  for await (const c of process.stdin) input += c;
  const ids = input.split(/\s+/).filter(Boolean);
  const res = await pool(ids, (id) => retry(() => gplay.app({ appId: id, country })));
  process.stdout.write(JSON.stringify(res.filter(Boolean).map((d) => ({
    app_id: d.appId,
    name: d.title,
    developer: d.developer,
    genre: d.genre,
    release_date: iso(d.released),
    url: d.url,
    icon: d.icon,
    rating: d.score,
    rating_count: d.ratings,
    installs: d.maxInstalls,
    iap_range: d.IAPRange || '',
    description: d.description || '',
  }))));
} else {
  console.error('用法：node gp_fetch.mjs charts|details <country> [分类列表]');
  process.exit(1);
}
