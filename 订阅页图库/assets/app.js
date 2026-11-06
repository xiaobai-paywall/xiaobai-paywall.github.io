const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LS_KEY = 'paywall-gallery-v1';
const ASSET_DIR = '素材';
const DATA_FILE = 'data.js';
const PALETTE = ['250,204,21', '79,140,255', '52,211,153', '251,146,60', '236,72,153', '45,212,191', '167,139,250', '34,211,238', '163,230,53', '148,163,184'];
// 分组和标签全部由用户自己创建，不预置任何文案。
// 直接输入新标签但还没有分组时，会自动放进「未分组」。
const DEFAULT_GROUP_NAME = '未分组';
const MEDIA_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};
const EXT_OK = new Set(Object.values(MEDIA_EXT).concat('jpeg'));
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v']);
const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
const isVideo = (name) => VIDEO_EXT.has(extOf(name));
const isMedia = (f) => !!MEDIA_EXT[f.type] || EXT_OK.has(extOf(f.name));

// 嵌在「商业变现」外壳里时，只有当前在「收集素材」才响应拖拽、粘贴上传和 / 快捷键
const galleryActive = () => (document.body.dataset.tab || 'collect') === 'collect';

const uid = (p) => `${p}_${Math.random().toString(16).slice(2, 12)}`;
const nowIso = () => new Date().toISOString();

// ---------- 数据 ----------

function emptyData() {
  return { groups: [], tags: [], items: [], seq: 0, savedAt: 0 };
}

function normalize(d) {
  if (!d || !Array.isArray(d.groups)) return null;
  d.tags ||= [];
  d.items ||= [];
  d.seq ||= d.items.length;
  d.savedAt ||= 0;
  return d;
}

function readLocal() {
  try { return normalize(JSON.parse(localStorage.getItem(LS_KEY))); } catch { return null; }
}

const fileData = normalize(window.__GALLERY__);
const localData = readLocal();
let db = [fileData, localData].filter(Boolean).sort((a, b) => b.savedAt - a.savedAt)[0] || emptyData();

let dir = null;
let connState = 'none';
let dirty = !!(localData && (!fileData || localData.savedAt > fileData.savedAt));

function persist() {
  db.savedAt = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(db));
  dirty = true;
  scheduleWrite();
}

let writeTimer;
function scheduleWrite() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeDataFile, 400);
}

async function writeDataFile() {
  if (!dir || connState !== 'ok') { renderConn(); return; }
  try {
    const fh = await dir.getFileHandle(DATA_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(`window.__GALLERY__ = ${JSON.stringify(db, null, 1)};\n`);
    await w.close();
    dirty = false;
  } catch (err) {
    connState = 'err';
    toast(`保存到素材文件夹失败：${err.message}`, true);
  }
  renderConn();
}

// ---------- 素材文件夹（File System Access API） ----------

const fsSupported = 'showDirectoryPicker' in window;

let idbConn;
function openIdb() {
  idbConn ||= new Promise((resolve, reject) => {
    const open = indexedDB.open('paywall-gallery', 2);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
  return idbConn;
}
async function idb(store, mode, fn) {
  const d = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const saveHandle = (h) => idb('kv', 'readwrite', (s) => s.put(h, 'dir'));
const loadHandle = () => idb('kv', 'readonly', (s) => s.get('dir')).catch(() => null);
const putFile = (name, blob) => idb('files', 'readwrite', (s) => s.put(blob, name));
const deleteFile = (name) => idb('files', 'readwrite', (s) => s.delete(name));
const fileNames = () => idb('files', 'readonly', (s) => s.getAllKeys()).catch(() => []);
const getFile = (name) => idb('files', 'readonly', (s) => s.get(name));

async function loadLocalFiles() {
  for (const name of await fileNames()) {
    if (blobUrls[name]) continue;
    const blob = await getFile(name);
    if (blob) blobUrls[name] = URL.createObjectURL(blob);
  }
}

async function restoreConnection() {
  if (!fsSupported) { connState = 'unsupported'; renderConn(); return; }
  const h = await loadHandle();
  if (!h) { connState = 'none'; renderConn(); return; }
  dir = h;
  const perm = await h.queryPermission({ mode: 'readwrite' });
  connState = perm === 'granted' ? 'ok' : 'prompt';
  if (connState === 'ok') await afterConnected();
  renderConn();
}

async function connect() {
  if (!fsSupported) {
    toast('当前浏览器不支持写入文件夹，请用 Chrome 或 Edge 打开', true);
    return false;
  }
  try {
    if (dir && connState !== 'ok') {
      const perm = await dir.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') { connState = 'ok'; await afterConnected(); renderConn(); return true; }
    }
    let h = await window.showDirectoryPicker({ id: 'paywall-sucai', mode: 'readwrite' });
    if (h.name !== ASSET_DIR) {
      try {
        h = await h.getDirectoryHandle(ASSET_DIR);
      } catch {
        if (!confirm(`你选的是「${h.name}」，不是「${ASSET_DIR}」文件夹。\n建议选择 订阅页图库/${ASSET_DIR}。仍然把素材存到「${h.name}」吗？`)) return false;
      }
    }
    dir = h;
    connState = 'ok';
    await saveHandle(h);
    await afterConnected();
    renderConn();
    toast(`已连接素材文件夹「${h.name}」`);
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') toast(`连接失败：${err.message}`, true);
    return false;
  }
}

async function afterConnected() {
  try {
    const fh = await dir.getFileHandle(DATA_FILE);
    const text = await (await fh.getFile()).text();
    const fromDisk = normalize(JSON.parse(text.replace(/^window\.__GALLERY__\s*=\s*/, '').replace(/;\s*$/, '')));
    if (fromDisk && fromDisk.savedAt > db.savedAt) {
      db = fromDisk;
      localStorage.setItem(LS_KEY, JSON.stringify(db));
      dirty = false;
      renderAll();
    }
  } catch { /* 文件夹里还没有 data.js */ }
  await backupFilesToDisk();
  if (dirty || !db.savedAt) { db.savedAt ||= Date.now(); await writeDataFile(); }
}

async function writeToDisk(name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

async function backupFilesToDisk() {
  const onDisk = new Set();
  for await (const [n] of dir.entries()) onDisk.add(n);
  const missing = (await fileNames()).filter((n) => !onDisk.has(n));
  for (const n of missing) {
    try { await writeToDisk(n, await getFile(n)); } catch { /* 下次连接时再补 */ }
  }
  if (missing.length) toast(`已把 ${missing.length} 个文件备份到「${dir.name}」`);
}

async function decodePixels(blob, colorSpace) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext('2d', { colorSpace });
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return { canvas, data: g.getImageData(0, 0, canvas.width, canvas.height, { colorSpace }).data };
}

// 无损 WebP（quality=1），尺寸不变；带颜色配置文件的（iPhone 截图是 Display P3）用 P3 画布。
// 编码后逐像素比对，有任何差异、浏览器不支持或省不到 10% 都保留原图。GIF 保留动画不处理。
async function compressImage(file) {
  if (file.type === 'image/gif' || extOf(file.name) === 'gif') return file;
  try {
    const head = new TextDecoder('latin1').decode(new Uint8Array(await file.slice(0, 65536).arrayBuffer()));
    const colorSpace = /iCCP|ICC_PROFILE|ICCP/.test(head) ? 'display-p3' : 'srgb';
    const src = await decodePixels(file, colorSpace);
    const out = await new Promise((r) => src.canvas.toBlob(r, 'image/webp', 1));
    if (!out || out.type !== 'image/webp' || out.size > file.size * 0.9) return file;
    const { data } = await decodePixels(out, colorSpace);
    if (data.length !== src.data.length) return file;
    for (let i = 0; i < data.length; i++) if (data[i] !== src.data[i]) return file;
    return out;
  } catch {
    return file;
  }
}

async function saveMedia(original) {
  const file = await compressImage(original);
  const ext = MEDIA_EXT[file.type] || extOf(original.name) || 'png';
  const name = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${ext}`;
  await putFile(name, file);
  blobUrls[name] = URL.createObjectURL(file);
  if (dir && connState === 'ok') {
    try { await writeToDisk(name, file); } catch { /* 浏览器里已有一份，下次连接时补备份 */ }
  }
  return name;
}

async function removeImages(names) {
  const used = new Set(db.items.flatMap((it) => it.images));
  for (const n of names) {
    if (used.has(n)) continue;
    try { await deleteFile(n); } catch { /* 忽略 */ }
    if (dir && connState === 'ok') {
      try { await dir.removeEntry(n); } catch { /* 文件可能已被手动删除 */ }
    }
  }
}

const blobUrls = {};
const imgSrc = (name) => blobUrls[name] || `${ASSET_DIR}/${encodeURIComponent(name)}`;

window.imgFallback = async (el) => {
  const name = el.dataset.name;
  if (!name || el.dataset.tried || !dir || connState !== 'ok') return;
  el.dataset.tried = '1';
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    blobUrls[name] = URL.createObjectURL(file);
    el.src = isVideo(name) ? `${blobUrls[name]}#t=0.1` : blobUrls[name];
  } catch { /* 文件不存在 */ }
};
function mediaTag(name, attrs = '', { controls = false } = {}) {
  const common = `data-name="${esc(name)}" onerror="imgFallback(this)" ${attrs}`;
  if (isVideo(name)) {
    return `<video src="${imgSrc(name)}#t=0.1" ${common} muted loop playsinline preload="metadata" ${controls ? 'controls' : ''}></video>`;
  }
  return `<img src="${imgSrc(name)}" ${common} alt="" />`;
}

// ---------- 数据操作 ----------

const groupsSorted = () => [...db.groups].sort((a, b) => a.order - b.order);
const groupById = (id) => db.groups.find((g) => g.id === id);
const tagById = (id) => db.tags.find((t) => t.id === id);
const tagsOf = (groupId) => db.tags.filter((t) => t.groupId === groupId);
const itemById = (id) => db.items.find((it) => it.id === id);
const colorOf = (tag) => groupById(tag.groupId)?.color || '148,163,184';

function createItem(images, origin = '') {
  db.seq += 1;
  const item = {
    id: `P${String(db.seq).padStart(4, '0')}`,
    title: '', source: '', note: '', origin,
    images, tags: [],
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  db.items.unshift(item);
  persist();
  return item;
}

function updateItem(id, patch, { rerenderDrawer = true } = {}) {
  const it = itemById(id);
  if (!it) return;
  const before = [...it.images];
  Object.assign(it, patch, { updatedAt: nowIso() });
  persist();
  if (patch.images) removeImages(before);
  renderSidebar();
  renderGrid();
  if (rerenderDrawer && state.openId === id) renderDrawer();
}

function deleteItem(id) {
  const it = itemById(id);
  db.items = db.items.filter((x) => x.id !== id);
  persist();
  removeImages(it.images);
}

// 指定的分组不存在（比如还没建分组）时，放进「未分组」，没有就自动创建
function resolveGroup(groupId) {
  if (groupById(groupId)) return groupId;
  let g = db.groups.find((x) => x.name === DEFAULT_GROUP_NAME);
  if (!g) {
    g = { id: uid('g'), name: DEFAULT_GROUP_NAME, order: db.groups.length, color: PALETTE[db.groups.length % PALETTE.length] };
    db.groups.push(g);
  }
  return g.id;
}

function createTag(name, groupId) {
  groupId = resolveGroup(groupId);
  const dup = db.tags.find((t) => t.groupId === groupId && t.name === name);
  if (dup) return dup;
  const tag = { id: uid('t'), groupId, name };
  db.tags.push(tag);
  persist();
  return tag;
}

function deleteTag(id) {
  db.tags = db.tags.filter((t) => t.id !== id);
  db.items.forEach((it) => { it.tags = it.tags.filter((t) => t !== id); });
  state.tagFilter.delete(id);
  persist();
}

function createGroup(name) {
  const order = db.groups.length;
  db.groups.push({ id: uid('g'), name, order, color: PALETTE[order % PALETTE.length] });
  persist();
}

// 旧版本预置的分组和标签：启动时自动清掉，只留用户自己建的。
// 分组里如果混有用户后加的标签，那些标签和分组都保留。
const LEGACY_PRESETS = {
  品类: ['工具', '健康', 'AI', '游戏', '内容'],
  平台: ['iOS', 'GP'],
  页面类型: ['单页', '多步引导', '试用开关', '限时折扣', '挽留页'],
  价格方案: ['周', '月', '年', '终身', '免费试用'],
  亮点: ['锚点对比', '按周折算', '首期优惠', '弱化关闭'],
};

function migrateLegacyPresets() {
  const presetTagIds = new Set();
  for (const g of db.groups) {
    const names = LEGACY_PRESETS[g.name];
    if (!names) continue;
    for (const t of db.tags) if (t.groupId === g.id && names.includes(t.name)) presetTagIds.add(t.id);
  }
  if (!presetTagIds.size) return;
  db.tags = db.tags.filter((t) => !presetTagIds.has(t.id));
  db.items.forEach((it) => { it.tags = it.tags.filter((id) => !presetTagIds.has(id)); });
  db.groups = db.groups.filter((g) => !(LEGACY_PRESETS[g.name] && !db.tags.some((t) => t.groupId === g.id)));
  state.tagFilter = new Set([...state.tagFilter].filter((id) => !presetTagIds.has(id)));
  persist();
}

function deleteGroup(id) {
  tagsOf(id).forEach((t) => deleteTag(t.id));
  db.groups = db.groups.filter((g) => g.id !== id);
  persist();
}

// ---------- 界面 ----------

const state = {
  tagFilter: new Set(),
  q: '',
  openId: null,
  closedGroups: new Set(),
  modalOpen: false,
  lastGroupId: null,
  quickIds: null,
  selected: new Set(),
  lb: null,
};

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast${isError ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function tagCounts() {
  const counts = {};
  db.items.forEach((it) => it.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  return counts;
}

function chipHtml(tag, { on = false, count, removable = false, mini = false, attrs = '' } = {}) {
  const el = mini ? 'span' : 'button';
  return `<${el} class="chip${on ? ' on' : ''}${mini ? ' mini' : ''}" style="--c:${colorOf(tag)}" ${attrs}>${esc(tag.name)}${
    count !== undefined ? `<small>${count}</small>` : ''}${removable ? '<span class="x">×</span>' : ''}</${el}>`;
}

function renderConn() {
  const el = $('#conn');
  const map = {
    ok: ['ok', dirty ? '备份中…' : '已备份到素材文件夹'],
    prompt: ['idle', '继续备份到素材文件夹'],
    none: ['idle', '备份到素材文件夹（可选）'],
    err: ['err', '备份失败，点此重连'],
  };
  el.hidden = connState === 'unsupported';
  if (el.hidden) return;
  const [cls, text] = map[connState];
  el.className = `conn ${cls}`;
  el.textContent = text;
  el.title = connState === 'ok'
    ? `图片和数据已同步一份到「${dir?.name}」文件夹`
    : '素材已经保存在本机浏览器里。想在硬盘上也留一份（方便备份、让 AI 读取），可以连接 订阅页图库/素材 文件夹';
}

function renderAll() {
  renderConn();
  renderSidebar();
  renderGrid();
  if (state.openId) renderDrawer();
  if (state.modalOpen) renderTagManager();
}

function filteredItems() {
  const byGroup = {};
  state.tagFilter.forEach((tid) => {
    const tag = tagById(tid);
    if (tag) (byGroup[tag.groupId] ||= []).push(tid);
  });
  const terms = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return db.items.filter((it) => {
    for (const tids of Object.values(byGroup)) {
      if (!tids.some((t) => it.tags.includes(t))) return false;
    }
    if (terms.length) {
      const hay = [it.id, it.title, it.source, it.note, it.origin, ...it.tags.map((t) => tagById(t)?.name)].join(' ').toLowerCase();
      if (!terms.every((term) => hay.includes(term))) return false;
    }
    return true;
  });
}

function renderSidebar() {
  const counts = tagCounts();

  $('#tagFilters').innerHTML = groupsSorted().length ? groupsSorted().map((g) => `
    <section class="filter-group" style="--c:${g.color}">
      <div class="filter-title${state.closedGroups.has(g.id) ? '' : ' open'}" data-group="${g.id}"><span class="sq"></span>${esc(g.name)}</div>
      <div class="filter-body">
        ${tagsOf(g.id).map((t) => chipHtml(t, { on: state.tagFilter.has(t.id), count: counts[t.id] || 0, attrs: `data-filter-tag="${t.id}"` })).join('') || '<span class="muted" style="font-size:12px">暂无标签</span>'}
      </div>
    </section>`).join('') : '<p class="muted" style="font-size:12px;line-height:1.6;margin:4px 0">还没有标签。上传图片后输入新标签，就会自动创建；也可以到「管理标签」先建分组。</p>';

  const active = [
    ...[...state.tagFilter].map(tagById).filter(Boolean).map((t) => chipHtml(t, { on: true, removable: true, attrs: `data-filter-tag="${t.id}"` })),
  ];
  $('#activeFilters').innerHTML = active.join('');
  $('#btnClear').hidden = !active.length && !state.q;
}

function renderGrid() {
  const items = filteredItems();
  $('#count').textContent = `${items.length} / ${db.items.length} 张图片`;
  const empty = $('#empty');
  empty.hidden = db.items.length > 0;
  if (!db.items.length) {
    empty.innerHTML = `<div class="big">还没有素材</div>
      <div class="hint">点下面的按钮选择文件，或者把图片直接拖进页面，也可以 ⌘V 粘贴截图</div>
      <button class="pill-btn primary" data-action="upload">上传图片</button>
      ${fsSupported ? '<button class="pill-btn" data-action="inbox">从「待整理」导入</button>' : ''}`;
  }
  if (db.items.length && !items.length) {
    $('#grid').innerHTML = '<div class="empty"><div class="hint">没有符合筛选条件的图片</div></div>';
    return;
  }
  $('#grid').innerHTML = items.map((it) => {
    const cover = it.images[0];
    const tags = it.tags.map(tagById).filter(Boolean);
    const selected = state.selected.has(it.id);
    return `<div class="card${selected ? ' selected' : ''}" data-open="${it.id}">
      <div class="cover">
        ${cover ? mediaTag(cover, 'loading="lazy"') : '<div style="height:160px"></div>'}
        <button class="sel" data-sel="${it.id}" title="选中，用于对比或批量打标签">${selected ? '✓' : ''}</button>
        <button class="edit" data-edit="${it.id}" title="编辑">编辑</button>
        ${it.images.length > 1 ? `<span class="badge multi">${it.images.length} 张</span>` : ''}
      </div>
      <div class="meta">
        <div class="title">${esc(it.title || it.source || it.id)}</div>
        ${it.title && it.source ? `<div class="sub">${esc(it.source)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.slice(0, 6).map((t) => chipHtml(t, { mini: true })).join('')}${tags.length > 6 ? `<span class="sub">+${tags.length - 6}</span>` : ''}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  renderSelbar();
}

function renderDrawer() {
  const it = itemById(state.openId);
  const drawer = $('#drawer');
  if (!it) { closeDrawer(); return; }
  drawer.hidden = false;
  const groups = groupsSorted();
  const defaultGroup = state.lastGroupId && groupById(state.lastGroupId) ? state.lastGroupId : groups[0]?.id;
  const scroll = drawer.scrollTop;
  drawer.innerHTML = `
    <div class="drawer-head">
      <span class="id">${esc(it.id)}</span>
      <span class="muted" style="font-size:12px">${new Date(it.createdAt).toLocaleDateString()} 收录</span>
      <span class="spacer"></span>
      <button class="pill-btn sm danger" data-action="delete-item">删除</button>
      <button class="pill-btn sm" data-action="close">关闭</button>
    </div>

    <div class="shots">
      ${it.images.map((img, i) => `
        <div class="shot${i === 0 && it.images.length > 1 ? ' cover' : ''}">
          ${isVideo(img) ? mediaTag(img, '', { controls: true }) : mediaTag(img, `data-view="${i}"`)}
          <div class="ops">
            ${i > 0 ? `<button data-action="cover" data-img="${esc(img)}">设为封面</button>` : ''}
            ${it.images.length > 1 ? `<button data-action="remove-img" data-img="${esc(img)}">移除</button>` : ''}
          </div>
        </div>`).join('')}
      <button class="add-shot" data-action="add-shot">＋ 追加<br />图片</button>
    </div>

    <div class="box">
      <div class="row">
        <div class="field"><label>标题</label><input data-field="title" value="${esc(it.title)}" placeholder="如：Calm 年订阅试用页" /></div>
        <div class="field"><label>来源 App</label><input data-field="source" value="${esc(it.source)}" placeholder="如：Calm" /></div>
      </div>
      <div class="field"><label>备注</label><textarea data-field="note" placeholder="随便记一句，方便以后搜到">${esc(it.note)}</textarea></div>
    </div>

    <div class="box">
      <div class="box-title"><span>标签（点击打上 / 取消）</span></div>
      ${groups.map((g) => `
        <div class="tag-row" style="--c:${g.color}">
          <div class="gname">${esc(g.name)}</div>
          <div class="list">${tagsOf(g.id).map((t) => chipHtml(t, { on: it.tags.includes(t.id), attrs: `data-toggle-tag="${t.id}"` })).join('') || '<span class="muted" style="font-size:12px">暂无</span>'}</div>
        </div>`).join('')}
      <div class="new-tag">
        <input id="newTagName" placeholder="没有合适的？输入新标签，回车添加" />
        <select id="newTagGroup">${groups.length ? groups.map((g) => `<option value="${g.id}" ${g.id === defaultGroup ? 'selected' : ''}>${esc(g.name)}</option>`).join('') : `<option value="">${DEFAULT_GROUP_NAME}</option>`}</select>
      </div>
    </div>
  `;
  drawer.scrollTop = scroll;
}

function openDrawer(id) { state.openId = id; $('#drawer').scrollTop = 0; renderDrawer(); }
function closeDrawer() { state.openId = null; $('#drawer').hidden = true; }

async function uploadFiles(fileList, appendTo = null) {
  const files = [...fileList].filter(isMedia);
  if (!files.length) { toast('只支持 PNG、JPG、WebP、GIF 图片', true); return; }
  toast(`正在压缩并保存 ${files.length} 张图片…`);
  const saved = [];
  for (const f of files) {
    try { saved.push([await saveMedia(f), f.name.replace(/\.[^.]+$/, '')]); } catch (err) { toast(`保存失败：${err.message}`, true); }
  }
  if (!saved.length) return;
  if (appendTo && itemById(appendTo)) {
    const it = itemById(appendTo);
    updateItem(appendTo, { images: [...it.images, ...saved.map(([n]) => n)] });
    toast(`已追加 ${saved.length} 张图片`);
    return;
  }
  const ids = saved.map(([n, origin]) => createItem([n], origin).id);
  $('#toast').hidden = true;
  renderSidebar();
  renderGrid();
  openQuickTag(ids);
}

// 「待整理」收件箱：导入后删除原图，避免重复上传。
// 必须先连接素材备份文件夹，且确认图片已写进去才删原图，防止浏览器数据被清后两边都丢。
const INBOX_DIR = '待整理';
const saveInbox = (h) => idb('kv', 'readwrite', (s) => s.put(h, 'inbox'));
const loadInbox = () => idb('kv', 'readonly', (s) => s.get('inbox')).catch(() => null);

async function pickInbox() {
  const saved = await loadInbox();
  if (saved && (await saved.requestPermission({ mode: 'readwrite' })) === 'granted') return saved;
  let h = await window.showDirectoryPicker({ id: 'paywall-inbox', mode: 'readwrite' });
  if (h.name !== INBOX_DIR) {
    try { h = await h.getDirectoryHandle(INBOX_DIR); } catch {
      if (!confirm(`你选的是「${h.name}」，不是「${INBOX_DIR}」文件夹。\n导入后会删除里面的原图，确定用「${h.name}」吗？`)) return null;
    }
  }
  if (h.name === ASSET_DIR || (dir && await h.isSameEntry(dir))) {
    toast('不能选素材文件夹，请选择 商业变现/待整理', true);
    return null;
  }
  await saveInbox(h);
  return h;
}

async function isOnDisk(name) {
  try { return (await (await dir.getFileHandle(name)).getFile()).size > 0; } catch { return false; }
}

async function importInbox() {
  if (!fsSupported) { toast('当前浏览器不支持读取文件夹，请用 Chrome 或 Edge 打开', true); return; }
  if (!dir || connState !== 'ok') {
    toast('请先点右上角「备份到素材文件夹」，连接后才能导入并删除原图', true);
    return;
  }
  let inbox;
  try { inbox = await pickInbox(); } catch (err) {
    if (err.name !== 'AbortError') toast(`打开文件夹失败：${err.message}`, true);
    return;
  }
  if (!inbox) return;
  const files = [];
  for await (const h of inbox.values()) {
    if (h.kind !== 'file' || h.name.startsWith('.')) continue;
    const f = await h.getFile();
    if (isMedia(f)) files.push(f);
  }
  if (!files.length) { toast(`「${inbox.name}」里没有图片`); return; }
  files.sort((a, b) => a.lastModified - b.lastModified);
  toast(`正在导入 ${files.length} 张图片…`);
  const ids = [];
  let removed = 0;
  for (const f of files) {
    try {
      const name = await saveMedia(f);
      ids.push(createItem([name], f.name.replace(/\.[^.]+$/, '')).id);
      if (await isOnDisk(name)) { await inbox.removeEntry(f.name); removed += 1; }
    } catch (err) { toast(`「${f.name}」导入失败：${err.message}`, true); }
  }
  if (!ids.length) return;
  $('#toast').hidden = true;
  renderSidebar();
  renderGrid();
  const kept = ids.length - removed;
  openQuickTag(ids, {
    title: `已导入 ${ids.length} 张图片，已从「${inbox.name}」删除原图${kept ? `（${kept} 张没写进素材文件夹，原图保留）` : ''}`,
  });
}

function pickFiles(appendTo = null) {
  $('#fileInput').dataset.append = appendTo || '';
  $('#fileInput').click();
}

// ---------- 上传后快速打标签 ----------

function openQuickTag(ids, { title = '' } = {}) {
  state.quickIds = ids;
  state.quickTitle = title || `已上传 ${ids.length} 张图片，打几个标签吧`;
  renderQuickTag();
  setTimeout(() => $('#quickSource')?.focus(), 50);
}

function closeQuickTag() {
  state.quickIds = null;
  $('#quick').hidden = true;
}

function renderQuickTag() {
  const items = (state.quickIds || []).map(itemById).filter(Boolean);
  const el = $('#quick');
  if (!items.length) { closeQuickTag(); return; }
  const groups = groupsSorted();
  const allHave = (tid) => items.every((it) => it.tags.includes(tid));
  const sameSource = items.every((it) => it.source === items[0].source) ? items[0].source : '';
  const defaultGroup = state.lastGroupId && groupById(state.lastGroupId) ? state.lastGroupId : groups[0]?.id;
  el.hidden = false;
  el.innerHTML = `<div class="modal-box quick-box">
    <div class="modal-head">
      <h3>${esc(state.quickTitle)}</h3>
      <button class="pill-btn sm primary" data-quick="done">完成</button>
    </div>
    <p class="modal-tip">点标签会同时打到下面所有文件上，也可以直接点「完成」跳过，之后再打。</p>
    <div class="quick-thumbs">${items.map((it) => `<div class="qt">${mediaTag(it.images[0])}</div>`).join('')}</div>
    <div class="row">
      <div class="field"><label>来源 App</label><input id="quickSource" value="${esc(sameSource)}" data-init="${esc(sameSource)}" placeholder="${sameSource || items.length === 1 ? '如：Calm、ChatGPT' : '来源各不相同，填写后会统一修改'}" /></div>
    </div>
    ${groups.map((g) => `
      <div class="tag-row" style="--c:${g.color}">
        <div class="gname">${esc(g.name)}</div>
        <div class="list">${tagsOf(g.id).map((t) => chipHtml(t, { on: allHave(t.id), attrs: `data-quick-tag="${t.id}"` })).join('')}</div>
      </div>`).join('')}
    <div class="new-tag">
      <input id="quickNewTag" placeholder="没有合适的？输入新标签，回车添加" />
      <select id="quickNewGroup">${groups.length ? groups.map((g) => `<option value="${g.id}" ${g.id === defaultGroup ? 'selected' : ''}>${esc(g.name)}</option>`).join('') : `<option value="">${DEFAULT_GROUP_NAME}</option>`}</select>
    </div>
  </div>`;
}

function quickToggle(tid) {
  const items = state.quickIds.map(itemById).filter(Boolean);
  const on = !items.every((it) => it.tags.includes(tid));
  items.forEach((it) => {
    it.tags = on ? [...new Set([...it.tags, tid])] : it.tags.filter((x) => x !== tid);
    it.updatedAt = nowIso();
  });
  persist();
  renderSidebar();
  renderGrid();
  renderQuickTag();
}

function quickSetSource() {
  const items = state.quickIds.map(itemById).filter(Boolean);
  const src = $('#quickSource');
  if (!src || src.value.trim() === src.dataset.init) return;
  items.forEach((it) => { it.source = src.value.trim(); });
  src.dataset.init = src.value.trim();
  items.forEach((it) => { it.updatedAt = nowIso(); });
  persist();
  renderGrid();
}

function renderTagManager() {
  const counts = tagCounts();
  const modal = $('#modal');
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-box">
    <div class="modal-head">
      <h3>管理标签</h3>
      <button class="pill-btn sm primary" data-action="close-modal">完成</button>
    </div>
    <p class="modal-tip">分组和标签都由你自己定义。点名字改名，× 删除，数字是用到这个标签的图片数。分组是可选的，不建分组的标签会放进「未分组」。</p>
    ${groupsSorted().map((g) => `
      <div class="mg" style="--c:${g.color}">
        <div class="mg-head">
          <span class="sq"></span><b data-rename-group="${g.id}">${esc(g.name)}</b>
          <button class="link danger" data-delete-group="${g.id}">删除分组</button>
        </div>
        <div class="mg-tags">
          ${tagsOf(g.id).map((t) => `<span class="chip" style="--c:${g.color}" data-rename-tag="${t.id}">${esc(t.name)}<small>${counts[t.id] || 0}</small><span class="x" data-delete-tag="${t.id}">×</span></span>`).join('')}
          <span class="mg-add"><input placeholder="＋ 添加" data-add-tag="${g.id}" /></span>
        </div>
      </div>`).join('')}
    <div class="new-group"><input id="newGroupName" placeholder="＋ 新建分组，回车确认" /></div>
    ${db.groups.length || db.tags.length ? '<div class="new-group"><button class="link danger" data-clear-all>清空全部分组和标签（图片保留）</button></div>' : ''}
  </div>`;
}

// ---------- 大图浏览 ----------

function openLightbox(id, imgIdx = 0) {
  const ids = filteredItems().map((it) => it.id);
  if (!ids.includes(id)) ids.unshift(id);
  state.lb = { ids, idx: ids.indexOf(id), img: imgIdx };
  renderLightbox();
}

function closeLightbox() {
  state.lb = null;
  $('#lightbox').hidden = true;
  $('#lightbox').innerHTML = '';
}

function lbMove(step) {
  const lb = state.lb;
  lb.idx = (lb.idx + step + lb.ids.length) % lb.ids.length;
  lb.img = 0;
  renderLightbox();
}

function lbImg(step) {
  const it = itemById(state.lb.ids[state.lb.idx]);
  const n = it.images.length;
  if (n < 2) return;
  state.lb.img = (state.lb.img + step + n) % n;
  renderLightbox();
}

function infoHtml(it) {
  const tags = it.tags.map(tagById).filter(Boolean);
  return `
    <div class="lb-title">${esc(it.title || it.source || it.id)}</div>
    <div class="lb-sub">${esc([it.id, it.title ? it.source : '', new Date(it.createdAt).toLocaleDateString()].filter(Boolean).join(' · '))}</div>
    ${tags.length ? `<div class="lb-block"><label>标签</label><div class="lb-tags">${tags.map((t) => chipHtml(t, { mini: true })).join('')}</div></div>` : ''}
    ${it.note ? `<div class="lb-block"><label>备注</label><div class="lb-text">${esc(it.note)}</div></div>` : ''}`;
}

function renderLightbox() {
  const lb = state.lb;
  const it = itemById(lb.ids[lb.idx]);
  if (!it) { closeLightbox(); return; }
  const name = it.images[lb.img] || it.images[0];
  const el = $('#lightbox');
  el.hidden = false;
  el.innerHTML = `
    <div class="lb-stage">
      <button class="lb-nav prev" data-lb="prev" title="上一个（←）">‹</button>
      <div class="lb-media">
        ${isVideo(name)
          ? `<video src="${imgSrc(name)}" data-name="${esc(name)}" onerror="imgFallback(this)" controls autoplay loop playsinline></video>`
          : `<img src="${imgSrc(name)}" data-name="${esc(name)}" onerror="imgFallback(this)" alt="" />`}
      </div>
      <button class="lb-nav next" data-lb="next" title="下一个（→）">›</button>
      ${it.images.length > 1 ? `<div class="lb-thumbs">${it.images.map((n, i) => `<button class="${i === lb.img ? 'on' : ''}" data-lb-img="${i}">${mediaTag(n)}</button>`).join('')}</div>` : ''}
      <div class="lb-counter">${lb.idx + 1} / ${lb.ids.length}</div>
      <button class="lb-close" data-lb="close" title="关闭（Esc）">×<small>Esc</small></button>
    </div>
    <aside class="lb-info">
      ${infoHtml(it)}
      <div class="lb-actions">
        <button class="pill-btn primary" data-lb="edit">编辑 / 打标签</button>
        ${isVideo(name) ? '' : '<button class="pill-btn" data-lb="copy">复制图片</button>'}
        <button class="pill-btn" data-lb="download">下载原文件</button>
        <button class="pill-btn" data-lb="select">${state.selected.has(it.id) ? '✓ 已加入对比' : '加入对比'}</button>
      </div>
      <p class="lb-keys">点图片放大看细节　← → 切换图片　↑ ↓ 切换同一张里的图　E 编辑</p>
    </aside>`;
}

async function blobOf(name) {
  if (blobUrls[name]) return (await fetch(blobUrls[name])).blob();
  const local = await getFile(name).catch(() => null);
  if (local) return local;
  if (dir && connState === 'ok') return (await dir.getFileHandle(name)).getFile();
  throw new Error('找不到文件');
}

async function copyImage(name) {
  try {
    let blob = await blobOf(name);
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d').drawImage(bmp, 0, 0);
      blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('已复制，可以直接粘贴到文档或 Figma');
  } catch (err) {
    toast(`复制失败：${err.message}`, true);
  }
}

async function downloadFile(it, name) {
  try {
    const url = URL.createObjectURL(await blobOf(name));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${[it.id, it.source, it.title].filter(Boolean).join('-')}.${extOf(name)}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast(`下载失败：${err.message}`, true);
  }
}

// ---------- 多选：对比 / 批量打标签 ----------

function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  renderGrid();
}

function renderSelbar() {
  const bar = $('#selbar');
  [...state.selected].forEach((id) => { if (!itemById(id)) state.selected.delete(id); });
  const n = state.selected.size;
  bar.hidden = !n;
  document.body.classList.toggle('selecting', n > 0);
  if (!n) return;
  bar.innerHTML = `<span>已选 <b>${n}</b> 张</span>
    <button class="pill-btn primary sm" data-bar="compare" ${n < 2 ? 'disabled title="至少选 2 个"' : ''}>并排对比</button>
    <button class="pill-btn sm" data-bar="tag">批量打标签</button>
    <button class="link" data-bar="clear">取消选择</button>`;
}

function renderCompare() {
  const items = [...state.selected].map(itemById).filter(Boolean);
  const el = $('#compare');
  el.hidden = false;
  el.innerHTML = `
    <div class="cmp-head">
      <h3>并排对比 · ${items.length} 张</h3>
      <span class="muted" style="font-size:12px">点图片可放大浏览</span>
      <span class="spacer"></span>
      <button class="pill-btn sm" data-cmp="close">关闭 Esc</button>
    </div>
    <div class="cmp-cols">
      ${items.map((it) => `
        <div class="cmp-col">
          <div class="cmp-media" data-cmp-open="${it.id}">${mediaTag(it.images[0])}</div>
          <div class="cmp-info">${infoHtml(it)}</div>
          <button class="link danger" data-cmp-remove="${it.id}">移出对比</button>
        </div>`).join('')}
    </div>`;
}

function closeCompare() {
  $('#compare').hidden = true;
  $('#compare').innerHTML = '';
}

// ---------- 事件 ----------

$('#conn').addEventListener('click', () => { if (connState !== 'ok' || dirty) connect(); });
$('#search').addEventListener('input', (e) => { state.q = e.target.value; renderSidebar(); renderGrid(); });
$('#btnClear').addEventListener('click', () => {
  state.tagFilter.clear(); state.q = ''; $('#search').value = '';
  renderSidebar(); renderGrid();
});
$('#btnUpload').addEventListener('click', () => pickFiles());
$('#btnInbox').addEventListener('click', importInbox);
$('#fileInput').addEventListener('change', async (e) => {
  await uploadFiles(e.target.files, e.target.dataset.append || null);
  e.target.value = '';
});
$('#btnTags').addEventListener('click', () => { state.modalOpen = true; renderTagManager(); });
$('#empty').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="upload"]')) pickFiles();
  if (e.target.closest('[data-action="inbox"]')) importInbox();
});

const quick = $('#quick');
quick.addEventListener('click', (e) => {
  const t = e.target;
  if (t === quick || t.closest('[data-quick="done"]')) {
    quickSetSource();
    closeQuickTag();
    return;
  }
  const chip = t.closest('[data-quick-tag]');
  if (chip) {
    quickSetSource();
    quickToggle(chip.dataset.quickTag);
  }
});
quick.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target.id === 'quickSource') { quickSetSource(); e.target.blur(); }
  if (e.target.id === 'quickNewTag' && e.target.value.trim()) {
    const groupId = $('#quickNewGroup').value;
    const tag = createTag(e.target.value.trim(), groupId);
    state.lastGroupId = tag.groupId;
    quickSetSource();
    if (!state.quickIds.map(itemById).every((it) => it.tags.includes(tag.id))) quickToggle(tag.id);
    else renderQuickTag();
    $('#quickNewTag')?.focus();
  }
});

$('#grid').addEventListener('mouseover', (e) => {
  const v = e.target.closest('.card')?.querySelector('video');
  if (v && v.paused) v.play().catch(() => {});
});
$('#grid').addEventListener('mouseout', (e) => {
  const card = e.target.closest('.card');
  if (card && !card.contains(e.relatedTarget)) card.querySelector('video')?.pause();
});

document.querySelector('.sidebar').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) { toggle.classList.toggle('open'); return; }
  const groupTitle = e.target.closest('[data-group]');
  if (groupTitle) {
    const id = groupTitle.dataset.group;
    state.closedGroups.has(id) ? state.closedGroups.delete(id) : state.closedGroups.add(id);
    groupTitle.classList.toggle('open');
    return;
  }
  const tagBtn = e.target.closest('[data-filter-tag]');
  if (tagBtn) {
    const id = tagBtn.dataset.filterTag;
    state.tagFilter.has(id) ? state.tagFilter.delete(id) : state.tagFilter.add(id);
    renderSidebar();
    renderGrid();
  }
});

$('#grid').addEventListener('click', (e) => {
  const sel = e.target.closest('[data-sel]');
  if (sel) { toggleSelect(sel.dataset.sel); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit) { openDrawer(edit.dataset.edit); return; }
  const card = e.target.closest('[data-open]');
  if (!card) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || state.selected.size) toggleSelect(card.dataset.open);
  else openLightbox(card.dataset.open);
});

const lightbox = $('#lightbox');
lightbox.addEventListener('click', (e) => {
  const t = e.target;
  const it = itemById(state.lb?.ids[state.lb.idx]);
  if (!it) return;
  const thumb = t.closest('[data-lb-img]');
  if (thumb) { state.lb.img = Number(thumb.dataset.lbImg); renderLightbox(); return; }
  if (t.matches('.lb-media img')) { t.parentElement.classList.toggle('zoom'); return; }
  const name = it.images[state.lb.img] || it.images[0];
  switch (t.closest('[data-lb]')?.dataset.lb) {
    case 'prev': lbMove(-1); break;
    case 'next': lbMove(1); break;
    case 'close': closeLightbox(); break;
    case 'edit': closeLightbox(); closeCompare(); openDrawer(it.id); break;
    case 'copy': copyImage(name); break;
    case 'download': downloadFile(it, name); break;
    case 'select': toggleSelect(it.id); renderLightbox(); break;
    default:
      if (t.classList.contains('lb-stage') || t.classList.contains('lb-media')) closeLightbox();
  }
});

$('#selbar').addEventListener('click', (e) => {
  const action = e.target.closest('[data-bar]')?.dataset.bar;
  if (action === 'compare') renderCompare();
  if (action === 'tag') openQuickTag([...state.selected], { title: `给选中的 ${state.selected.size} 张图片打标签` });
  if (action === 'clear') { state.selected.clear(); renderGrid(); }
});

const compare = $('#compare');
compare.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-cmp="close"]')) { closeCompare(); return; }
  const rm = t.closest('[data-cmp-remove]');
  if (rm) {
    state.selected.delete(rm.dataset.cmpRemove);
    renderGrid();
    state.selected.size ? renderCompare() : closeCompare();
    return;
  }
  const open = t.closest('[data-cmp-open]');
  if (open) {
    const id = open.dataset.cmpOpen;
    state.lb = { ids: [...state.selected], idx: [...state.selected].indexOf(id), img: 0 };
    renderLightbox();
  }
});

const drawer = $('#drawer');
drawer.addEventListener('click', async (e) => {
  const it = itemById(state.openId);
  if (!it) return;
  const t = e.target;

  if (t.dataset.view !== undefined) {
    openLightbox(it.id, Number(t.dataset.view));
    return;
  }
  const toggleTag = t.closest('[data-toggle-tag]');
  if (toggleTag) {
    const id = toggleTag.dataset.toggleTag;
    updateItem(it.id, { tags: it.tags.includes(id) ? it.tags.filter((x) => x !== id) : [...it.tags, id] });
    return;
  }
  const actionEl = t.closest('[data-action]');
  switch (actionEl?.dataset.action) {
    case 'close': closeDrawer(); break;
    case 'delete-item':
      if (!confirm(`确定删除 ${it.id}？素材文件夹里的图片也会一起删除。`)) return;
      deleteItem(it.id);
      closeDrawer(); renderSidebar(); renderGrid(); toast('已删除');
      break;
    case 'cover':
      updateItem(it.id, { images: [actionEl.dataset.img, ...it.images.filter((x) => x !== actionEl.dataset.img)] });
      break;
    case 'remove-img':
      if (confirm('移除这张图片？')) updateItem(it.id, { images: it.images.filter((x) => x !== actionEl.dataset.img) });
      break;
    case 'add-shot':
      pickFiles(it.id);
      break;
    default:
  }
});

function addNewTagFromDrawer() {
  const it = itemById(state.openId);
  const name = $('#newTagName').value.trim();
  const groupId = $('#newTagGroup').value;
  if (!name) return;
  const tag = createTag(name, groupId);
  state.lastGroupId = tag.groupId;
  updateItem(it.id, { tags: [...new Set([...it.tags, tag.id])] });
  $('#newTagName')?.focus();
}

let fieldTimer;
drawer.addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const id = state.openId;
  const value = e.target.value;
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(() => updateItem(id, { [field]: value }, { rerenderDrawer: false }), 400);
});
drawer.addEventListener('keydown', (e) => {
  if (e.target.id === 'newTagName' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addNewTagFromDrawer(); }
});

const modal = $('#modal');
modal.addEventListener('click', (e) => {
  const t = e.target;
  if (t === modal || t.closest('[data-action="close-modal"]')) {
    state.modalOpen = false; modal.hidden = true; return;
  }
  if (t.dataset.deleteTag) {
    const tag = tagById(t.dataset.deleteTag);
    const n = tagCounts()[tag.id] || 0;
    if (n && !confirm(`「${tag.name}」正被 ${n} 张图片使用，删除后会从这些图片上去掉，确定？`)) return;
    deleteTag(tag.id);
    renderAll();
    return;
  }
  const renameTag = t.closest('[data-rename-tag]');
  if (renameTag) {
    const tag = tagById(renameTag.dataset.renameTag);
    const name = prompt('标签改名', tag.name)?.trim();
    if (name && name !== tag.name) { tag.name = name; persist(); renderAll(); }
    return;
  }
  if (t.dataset.renameGroup) {
    const g = groupById(t.dataset.renameGroup);
    const name = prompt('分组改名', g.name)?.trim();
    if (name && name !== g.name) { g.name = name; persist(); renderAll(); }
    return;
  }
  if (t.dataset.clearAll !== undefined) {
    if (!confirm(`清空全部 ${db.groups.length} 个分组、${db.tags.length} 个标签？\n图片会保留，只是去掉它们身上的标签。`)) return;
    db.groups = [];
    db.tags = [];
    db.items.forEach((it) => { it.tags = []; });
    state.tagFilter.clear();
    state.lastGroupId = null;
    persist();
    renderAll();
    renderTagManager();
    return;
  }
  if (t.dataset.deleteGroup) {
    const g = groupById(t.dataset.deleteGroup);
    if (!confirm(`删除分组「${g.name}」？组内 ${tagsOf(g.id).length} 个标签会一起删除，并从所有图片上去掉。`)) return;
    deleteGroup(g.id);
    renderAll();
  }
});
modal.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const t = e.target;
  if (t.dataset.addTag && t.value.trim()) {
    const groupId = t.dataset.addTag;
    createTag(t.value.trim(), groupId);
    renderAll();
    modal.querySelector(`[data-add-tag="${groupId}"]`)?.focus();
  } else if (t.id === 'newGroupName' && t.value.trim()) {
    createGroup(t.value.trim());
    renderAll();
    modal.querySelector('#newGroupName')?.focus();
  }
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if (state.lb && !typing) {
    const keys = { ArrowLeft: () => lbMove(-1), ArrowRight: () => lbMove(1), ArrowUp: () => lbImg(-1), ArrowDown: () => lbImg(1), Escape: closeLightbox };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); return; }
    if (e.key === 'e' || e.key === 'E') { const id = state.lb.ids[state.lb.idx]; closeLightbox(); closeCompare(); openDrawer(id); return; }
  }
  if (e.key === '/' && !typing && galleryActive()) {
    e.preventDefault();
    $('#search').focus();
    return;
  }
  if (e.key !== 'Escape') return;
  if (!quick.hidden) closeQuickTag();
  else if (!compare.hidden) closeCompare();
  else if (state.modalOpen) { state.modalOpen = false; modal.hidden = true; }
  else if (state.openId) closeDrawer();
});

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e) && galleryActive()) { dragDepth++; $('#dropMask').hidden = false; } });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && galleryActive() && --dragDepth <= 0) { dragDepth = 0; $('#dropMask').hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  if (!galleryActive()) { e.preventDefault(); return; }
  e.preventDefault();
  dragDepth = 0;
  $('#dropMask').hidden = true;
  const appendTo = e.target.closest('#drawer') ? state.openId : null;
  uploadFiles(e.dataTransfer.files, appendTo);
});
window.addEventListener('paste', (e) => {
  if (e.target.matches('input, textarea') || !galleryActive()) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) uploadFiles(files, state.openId);
});
window.addEventListener('beforeunload', (e) => {
  if (dirty && connState === 'ok') { writeDataFile(); e.preventDefault(); }
});

migrateLegacyPresets();
if (!db.savedAt) localStorage.setItem(LS_KEY, JSON.stringify(db));
$('#btnInbox').hidden = !fsSupported;
renderAll();
loadLocalFiles().then(() => { renderGrid(); if (state.openId) renderDrawer(); });
restoreConnection();
