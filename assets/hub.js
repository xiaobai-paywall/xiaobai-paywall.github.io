'use strict';
// 商业变现外壳：左侧导航切换「扫描机会 / 回收预估 / 收集素材」，地址栏记住当前功能（#/scan、#/roi、#/collect）
(() => {
  const TABS = { scan: '扫描机会', roi: '回收预估', collect: '收集素材' };
  const DEFAULT = 'scan';
  const MINI_KEY = 'hub-nav-mini';
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fromHash = () => (location.hash.match(/^#\/(\w+)/) || [])[1];

  function go(id) {
    if (!TABS[id]) id = DEFAULT;
    $$('.nav .tab').forEach((t) => {
      const on = t.dataset.tab === id;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    $$('.stage > .panel').forEach((p) => p.classList.toggle('active', p.id === id));
    document.body.dataset.tab = id;
    document.title = `${TABS[id]} · 商业变现`;
    // 页面有 <base href>，必须拼完整地址，否则会跳到 订阅页图库/ 下面
    history.replaceState(null, '', location.href.split('#')[0] + '#/' + id);
    window.dispatchEvent(new CustomEvent('hub:tab', { detail: id }));
    if (matchMedia('(max-width: 640px)').matches) scrollTo({ top: 0, behavior: 'instant' });
  }

  // 侧边栏默认收起成图标，展开 / 收起的选择记在本机
  const fold = document.getElementById('navFold');
  function setMini(on) {
    document.body.classList.toggle('nav-mini', on);
    fold.title = on ? '展开侧边栏' : '收起侧边栏';
  }
  setMini(localStorage.getItem(MINI_KEY) !== '0');
  fold.addEventListener('click', () => {
    const on = !document.body.classList.contains('nav-mini');
    setMini(on);
    try { localStorage.setItem(MINI_KEY, on ? '1' : '0'); } catch {}
  });

  document.querySelector('.nav').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) go(t.dataset.tab);
  });
  window.addEventListener('hashchange', () => go(fromHash()));
  window.hubGo = go;
  go(fromHash());
})();
