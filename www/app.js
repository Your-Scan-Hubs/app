'use strict';
/* =========================================================
   YourScan — 办公室文件扫描
   拍照扫描（ML Kit）/ 相册合成 PDF / 离线文字识别搜索
   文件只存在手机里（app 私有空间）
   ========================================================= */

const C = window.Capacitor;
const NATIVE = !!(C && C.isNativePlatform && C.isNativePlatform());
const plug = (n) => (NATIVE ? C.registerPlugin(n) : null);
const FS = plug('Filesystem');
const ShareP = plug('Share');
const Scanner = plug('DocumentScanner');
const Ocr = plug('Ocr');
const SendIntent = plug('SendIntent');
const AppP = plug('App');

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 常量 ---------- */
const FILTERS = [
  { k: 'none', n: '原图', css: 'none' },
  { k: 'enhance', n: '增强', css: 'contrast(1.28) brightness(1.08) saturate(1.15)' },
  { k: 'gray', n: '灰度', css: 'grayscale(1) contrast(1.2) brightness(1.05)' },
  { k: 'bw', n: '黑白', css: 'grayscale(1) contrast(2.4) brightness(1.18)' },
];
const fcss = (k) => (FILTERS.find((f) => f.k === k) || FILTERS[0]).css;
const QUALITY = {
  hd: { n: '清晰', max: 2480, q: 0.88 },
  std: { n: '标准', max: 1800, q: 0.8 },
  small: { n: '小文件', max: 1240, q: 0.66 },
};
const PAPER = { a4: 'A4', auto: '按原图' };
const STORE_MAX = 2480; // 导入时保存的原图最长边
const A4 = [595.28, 841.89];

const I = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  dup: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
};

/* =========================================================
   存储：手机上用 Filesystem（app 私有目录），浏览器预览用内存
   ========================================================= */
function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

function nativeStore() {
  let base = '';
  const D = 'DATA';
  return {
    async init() {
      const r = await FS.getUri({ path: '', directory: D });
      base = r.uri.replace(/\/?$/, '/');
    },
    uri: (p) => base + p,
    url: (p) => C.convertFileSrc(base + p),
    async write(p, blob) {
      await FS.writeFile({ path: p, data: await blobToB64(blob), directory: D, recursive: true });
    },
    async read(p) {
      const r = await fetch(C.convertFileSrc(base + p));
      if (!r.ok) throw new Error('读取失败 ' + p);
      return r.blob();
    },
    async readText(p) {
      try { return (await FS.readFile({ path: p, directory: D, encoding: 'utf8' })).data; } catch (e) { return null; }
    },
    async writeText(p, t) {
      await FS.writeFile({ path: p, data: t, directory: D, encoding: 'utf8', recursive: true });
    },
    async move(a, b) { await FS.rename({ from: a, to: b, directory: D, toDirectory: D }); },
    async del(p) { try { await FS.deleteFile({ path: p, directory: D }); } catch (e) {} },
    async rmdir(p) { try { await FS.rmdir({ path: p, directory: D, recursive: true }); } catch (e) {} },
    async list(dir) {
      try { return (await FS.readdir({ path: dir, directory: D })).files.map((f) => (typeof f === 'string' ? f : f.name)); } catch (e) { return []; }
    },
    /* 分享要放到缓存目录（FileProvider 只开放缓存） */
    async copyToShare(p, name) {
      const r = await FS.copy({ from: p, directory: D, to: 'share/' + name, toDirectory: 'CACHE' }).catch(async () => {
        await FS.mkdir({ path: 'share', directory: 'CACHE', recursive: true }).catch(() => {});
        return FS.copy({ from: p, directory: D, to: 'share/' + name, toDirectory: 'CACHE' });
      });
      return r && r.uri ? r.uri : (await FS.getUri({ path: 'share/' + name, directory: 'CACHE' })).uri;
    },
    async blobToShare(name, blob) {
      const r = await FS.writeFile({ path: 'share/' + name, data: await blobToB64(blob), directory: 'CACHE', recursive: true });
      return r.uri;
    },
    async clearShare() { try { await FS.rmdir({ path: 'share', directory: 'CACHE', recursive: true }); } catch (e) {} },
  };
}

function webStore() {
  const m = new Map();
  const urls = new Map();
  return {
    async init() {},
    uri: (p) => p,
    url(p) {
      if (!urls.has(p) && m.has(p)) urls.set(p, URL.createObjectURL(m.get(p)));
      return urls.get(p) || '';
    },
    async write(p, blob) { m.set(p, blob); urls.delete(p); },
    async read(p) { if (!m.has(p)) throw new Error('读取失败 ' + p); return m.get(p); },
    async readText(p) { try { return localStorage.getItem('ys:' + p); } catch (e) { return null; } },
    async writeText(p, t) { try { localStorage.setItem('ys:' + p, t); } catch (e) {} },
    async move(a, b) { m.set(b, m.get(a)); m.delete(a); urls.delete(a); },
    async del(p) { m.delete(p); urls.delete(p); },
    async rmdir(p) { for (const k of [...m.keys()]) if (k.startsWith(p + '/')) m.delete(k); },
    async list(dir) { return [...m.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => k.slice(dir.length + 1)); },
    async copyToShare(p) { return p; },
    async blobToShare(name) { return name; },
    async clearShare() {},
  };
}

const store = NATIVE ? nativeStore() : webStore();

/* ---------- 索引（文件列表/文件夹/设置） ---------- */
let DB = { v: 1, docs: [], folders: [], settings: { quality: 'std', paper: 'a4', prefix: '扫描' } };
async function loadDB() {
  const t = await store.readText('index.json');
  if (t) {
    try {
      const d = JSON.parse(t);
      DB = { ...DB, ...d, settings: { ...DB.settings, ...(d.settings || {}) } };
      // 浏览器预览：图片不在内存里了，丢掉旧记录
      if (!NATIVE) DB.docs = [];
    } catch (e) {}
  }
}
let dbChain = Promise.resolve();
function saveDB() {
  dbChain = dbChain.then(() => store.writeText('index.json', JSON.stringify(DB))).catch(() => {});
  return dbChain;
}
const docById = (id) => DB.docs.find((d) => d.id === id);

/* =========================================================
   图片处理
   ========================================================= */
async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

/** 画到画布：缩放、旋转（顺时针 90 的倍数）、滤镜，输出 JPEG */
async function render(src, { max = STORE_MAX, filter = 'none', rotate = 0, q = 0.9 } = {}) {
  const w0 = src.width, h0 = src.height;
  const s = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const r = ((rotate % 360) + 360) % 360;
  const cw = r % 180 ? h : w, ch = r % 180 ? w : h;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((r * Math.PI) / 180);
  const css = fcss(filter);
  if (css !== 'none') ctx.filter = css;
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
  cv.width = cv.height = 0;
  return { blob, w: cw, h: ch };
}

async function importImage(docId, blob) {
  const bmp = await decode(blob);
  const out = await render(bmp, { max: STORE_MAX, q: 0.9 });
  if (bmp.close) bmp.close();
  const f = 'p_' + uid() + '.jpg';
  await store.write(`docs/${docId}/${f}`, out.blob);
  return { f, filter: 'none' };
}

async function importMany(docId, blobs, filter = 'none') {
  const pages = [];
  let bad = 0;
  for (let i = 0; i < blobs.length; i++) {
    busy(`正在导入 ${i + 1} / ${blobs.length}`);
    try {
      const p = await importImage(docId, blobs[i]);
      p.filter = filter;
      pages.push(p);
    } catch (e) {
      bad++;
    }
  }
  busy(false);
  if (bad) toast(`${bad} 张图片无法读取（格式不支持），已跳过`);
  return pages;
}

/* ---------- PDF ---------- */
async function buildPdf(docId, pages, paper, quality, title) {
  const { PDFDocument } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || 'YourScan');
  pdf.setCreator('YourScan');
  pdf.setProducer('YourScan');
  const Q = QUALITY[quality] || QUALITY.std;
  for (let i = 0; i < pages.length; i++) {
    busy(`正在生成 PDF ${i + 1} / ${pages.length}`);
    const pg = pages[i];
    const bmp = await decode(await store.read(`docs/${docId}/${pg.f}`));
    const out = await render(bmp, { max: Q.max, filter: pg.filter, q: Q.q });
    if (bmp.close) bmp.close();
    const img = await pdf.embedJpg(new Uint8Array(await out.blob.arrayBuffer()));
    let pw, ph;
    if (paper === 'a4') {
      [pw, ph] = out.w > out.h ? [A4[1], A4[0]] : A4;
    } else {
      pw = A4[0];
      ph = (A4[0] * out.h) / out.w;
    }
    const page = pdf.addPage([pw, ph]);
    const s = Math.min(pw / out.w, ph / out.h);
    const dw = out.w * s, dh = out.h * s;
    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    await sleep(0);
  }
  return pdf.save();
}

/* =========================================================
   界面小工具：提示、忙碌、弹层
   ========================================================= */
let toastT;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(text) {
  const b = $('#busy');
  if (text === false) { b.hidden = true; return; }
  $('#busy-text').textContent = text || '处理中…';
  b.hidden = false;
}

let sheetResolve = null;
function openSheet(html, mount) {
  const sh = $('#sheet');
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }
  sh.innerHTML = '<div class="grab"></div>' + html;
  sh.scrollTop = 0;
  $('#sheet-bg').classList.add('on');
  requestAnimationFrame(() => sh.classList.add('on'));
  if (mount) mount(sh);
  return new Promise((res) => { sheetResolve = res; });
}
function closeSheet(val = null) {
  $('#sheet').classList.remove('on');
  $('#sheet-bg').classList.remove('on');
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(val); }
}
const sheetOpen = () => $('#sheet').classList.contains('on');
$('#sheet-bg').addEventListener('click', () => closeSheet(null));

/** 动作列表 */
function actionSheet(title, items, desc) {
  const html = (title ? `<h3>${esc(title)}</h3>` : '') + (desc ? `<p class="desc">${esc(desc)}</p>` : '') +
    items.map((it, i) => `<button class="row ${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}" data-i="${i}">${it.icon || ''}<span>${esc(it.label)}</span>${it.right != null ? `<span class="r">${esc(it.right)}</span>` : ''}</button>`).join('');
  return openSheet(html, (sh) => {
    $$('.row', sh).forEach((b) => b.addEventListener('click', () => {
      const it = items[+b.dataset.i];
      closeSheet(it.value ?? +b.dataset.i);
    }));
  });
}
function promptSheet(title, value = '', placeholder = '', okLabel = '确定') {
  return openSheet(`<h3>${esc(title)}</h3><input type="text" id="pr-in" value="${esc(value)}" placeholder="${esc(placeholder)}" /><div class="btns"><button id="pr-no">取消</button><button class="primary" id="pr-ok">${esc(okLabel)}</button></div>`, (sh) => {
    const inp = $('#pr-in', sh);
    setTimeout(() => { inp.focus(); inp.select(); }, 250);
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } closeSheet(v); };
    $('#pr-ok', sh).onclick = ok;
    $('#pr-no', sh).onclick = () => closeSheet(null);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
}
function confirmSheet(title, desc, okLabel = '确定', danger = false) {
  return openSheet(`<h3>${esc(title)}</h3>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<div class="btns"><button id="cf-no">取消</button><button class="${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(okLabel)}</button></div>`, (sh) => {
    $('#cf-ok', sh).onclick = () => closeSheet(true);
    $('#cf-no', sh).onclick = () => closeSheet(false);
  }).then((v) => !!v);
}

/* ---------- 视图切换 ---------- */
let VIEW = 'home';
function show(v) {
  VIEW = v;
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === 'v-' + v));
}

/* ---------- 格式化 ---------- */
const pad = (n) => String(n).padStart(2, '0');
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
  return (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/') + `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function fmtSize(b) {
  if (!b) return '0 KB';
  if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
function defaultName() {
  const d = new Date();
  const p = (DB.settings.prefix || '扫描').trim() || '扫描';
  return `${p}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
const safeName = (s) => (s || 'YourScan').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').replace(/^\.+/, '').slice(0, 80).trim() || 'YourScan';

/* =========================================================
   首页
   ========================================================= */
let curFolder = '__all';
let query = '';

function renderChips() {
  const counts = {};
  DB.docs.forEach((d) => { counts[d.folder || ''] = (counts[d.folder || ''] || 0) + 1; });
  const chips = [{ k: '__all', n: `全部 ${DB.docs.length || ''}`.trim() }];
  if (DB.folders.length && counts['']) chips.push({ k: '', n: `未分类 ${counts['']}` });
  DB.folders.forEach((f) => chips.push({ k: f, n: `${f} ${counts[f] || ''}`.trim() }));
  if (curFolder !== '__all' && curFolder !== '' && !DB.folders.includes(curFolder)) curFolder = '__all';
  $('#folder-chips').innerHTML = chips.map((c) => `<button class="chip ${c.k === curFolder ? 'on' : ''}" data-k="${esc(c.k)}">${esc(c.n)}</button>`).join('') +
    `<button class="chip add" id="chip-add">${I.plus}文件夹</button>`;
  $$('#folder-chips .chip[data-k]').forEach((b) => b.addEventListener('click', () => { curFolder = b.dataset.k; renderHome(); }));
  $('#chip-add').addEventListener('click', manageFolders);
}

function matchDoc(d, toks) {
  if (!toks.length) return { ok: true };
  const hay = (d.name + '\n' + (d.text || '')).toLowerCase();
  const hayNs = hay.replace(/\s+/g, '');
  for (const t of toks) if (!hay.includes(t) && !hayNs.includes(t)) return { ok: false };
  // 找文字里的命中片段
  const text = d.text || '';
  const low = text.toLowerCase();
  for (const t of toks) {
    const i = low.indexOf(t);
    if (i >= 0 && !d.name.toLowerCase().includes(t)) {
      const a = Math.max(0, i - 18), b = Math.min(text.length, i + t.length + 30);
      const snip = (a ? '…' : '') + text.slice(a, i) + '\u0001' + text.slice(i, i + t.length) + '\u0002' + text.slice(i + t.length, b);
      return { ok: true, hit: esc(snip.replace(/\s+/g, ' ')).replace('\u0001', '<mark>').replace('\u0002', '</mark>') };
    }
  }
  return { ok: true };
}

function renderHome() {
  renderChips();
  const toks = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = DB.docs
    .filter((d) => curFolder === '__all' || (d.folder || '') === curFolder)
    .map((d) => ({ d, m: matchDoc(d, toks) }))
    .filter((x) => x.m.ok)
    .sort((a, b) => b.d.updated - a.d.updated);
  $('#doc-list').innerHTML = list.map(({ d, m }) => `
    <button class="doc" data-id="${d.id}">
      <div class="th">${d.thumb ? `<img loading="lazy" src="${store.url(`docs/${d.id}/${d.thumb}`)}" alt="" />` : ''}<span class="pg">${d.pages.length} 页</span></div>
      <div class="info">
        <div class="nm">${esc(d.name)}</div>
        <div class="sub">${fmtDate(d.updated)}${curFolder === '__all' && d.folder ? `<span class="tag">${esc(d.folder)}</span>` : ''}</div>
        ${m.hit ? `<div class="hit">${m.hit}</div>` : ''}
      </div>
    </button>`).join('');
  $$('#doc-list .doc').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
  const empty = !list.length;
  $('#empty').hidden = !empty;
  if (empty) {
    $('#empty-text').innerHTML = query ? '找不到相关文件<br/>试试别的关键词' : DB.docs.length ? '这个文件夹还是空的' : '还没有文件<br/>点下面的按钮开始扫描';
  }
}

$('#q').addEventListener('input', (e) => { query = e.target.value.trim(); renderHome(); });

/* ---------- 文件夹管理 ---------- */
async function manageFolders() {
  const items = [{ icon: I.plus, label: '新建文件夹', value: '__new' }]
    .concat(DB.folders.map((f) => ({ icon: I.folder, label: f, right: `${DB.docs.filter((d) => d.folder === f).length} 个`, value: f })));
  const v = await actionSheet('文件夹', items, DB.folders.length ? '点文件夹可以改名或删除' : '');
  if (v == null) return;
  if (v === '__new') {
    const n = await promptSheet('新建文件夹', '', '例如：发票、合同、客户A');
    if (!n) return;
    if (DB.folders.includes(n)) return toast('已经有这个文件夹了');
    DB.folders.push(n);
    await saveDB();
    curFolder = n;
    renderHome();
    return;
  }
  const act = await actionSheet(v, [
    { icon: I.edit, label: '改名', value: 'rename' },
    { icon: I.trash, label: '删除文件夹（文件移到未分类）', value: 'del', danger: true },
  ]);
  if (act === 'rename') {
    const n = await promptSheet('文件夹改名', v);
    if (!n || n === v) return;
    if (DB.folders.includes(n)) return toast('已经有这个文件夹了');
    DB.folders = DB.folders.map((f) => (f === v ? n : f));
    DB.docs.forEach((d) => { if (d.folder === v) d.folder = n; });
    if (curFolder === v) curFolder = n;
  } else if (act === 'del') {
    if (!(await confirmSheet(`删除文件夹「${v}」？`, '里面的文件不会删除，会移到“未分类”。', '删除', true))) return;
    DB.folders = DB.folders.filter((f) => f !== v);
    DB.docs.forEach((d) => { if (d.folder === v) d.folder = ''; });
    if (curFolder === v) curFolder = '__all';
  } else return;
  await saveDB();
  renderHome();
}

/* =========================================================
   获取图片：扫描 / 相册 / 分享进来
   ========================================================= */
async function fetchUri(u) {
  const r = await fetch(C.convertFileSrc(u));
  if (!r.ok) throw new Error('读取失败');
  return r.blob();
}

async function ensureScannerModule() {
  let avail = true;
  try { avail = (await Scanner.isGoogleDocumentScannerModuleAvailable()).available; } catch (e) { return; }
  if (avail) return;
  busy('第一次使用，正在下载扫描组件…');
  let h;
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(res, 90000); // 超时也试试直接扫描
      Scanner.addListener('googleDocumentScannerModuleInstallProgress', (e) => {
        busy(`正在下载扫描组件 ${Math.round(e.progress || 0)}%`);
        if (e.state === 4) { clearTimeout(to); res(); }
        if (e.state === 5 || e.state === 3) { clearTimeout(to); rej(new Error('扫描组件下载失败，请检查网络后再试')); }
      }).then((x) => { h = x; });
      Scanner.installGoogleDocumentScannerModule().catch((e) => { clearTimeout(to); rej(e); });
    });
  } finally {
    if (h) h.remove();
    busy(false);
  }
}

/** 返回 Blob[]，取消返回 null */
async function getScan() {
  if (!NATIVE) {
    toast('浏览器预览不能用相机，改用选图片');
    return pickImages();
  }
  try {
    await ensureScannerModule();
    const r = await Scanner.scanDocument({ galleryImportAllowed: true, pageLimit: 50, resultFormats: 'JPEG', scannerMode: 'FULL' });
    const uris = (r && r.scannedImages) || [];
    if (!uris.length) return null;
    busy('正在读取扫描结果…');
    const blobs = [];
    for (const u of uris) blobs.push(await fetchUri(u));
    busy(false);
    return blobs;
  } catch (e) {
    busy(false);
    const msg = (e && (e.message || e.code)) || String(e);
    if (/cancel/i.test(msg)) return null;
    toast('扫描失败：' + msg, 4000);
    return null;
  }
}

function pickImages() {
  return new Promise((res) => {
    const inp = $('#file-input');
    inp.value = '';
    inp.onchange = () => res(inp.files && inp.files.length ? [...inp.files] : null);
    inp.click();
  });
}

/* =========================================================
   编辑页
   ========================================================= */
let ED = null;
let sortable = null;
let SHARE_MODE = false;

async function newDocFrom(blobs, opts = {}) {
  if (!blobs || !blobs.length) return;
  const id = uid();
  ED = {
    isNew: true, id,
    name: defaultName(),
    folder: curFolder !== '__all' ? curFolder : '',
    pages: [],
    paper: DB.settings.paper, quality: DB.settings.quality,
    keep: new Set(),
    dirty: true,
  };
  ED.pages = await importMany(id, blobs, opts.filter || 'none');
  if (!ED.pages.length) { await store.rmdir('docs/' + id); ED = null; return; }
  openEditorView();
}

function editDoc(doc) {
  ED = {
    isNew: false, id: doc.id,
    name: doc.name, folder: doc.folder || '',
    pages: doc.pages.map((p) => ({ ...p })),
    paper: doc.paper || DB.settings.paper, quality: doc.quality || DB.settings.quality,
    keep: new Set([...doc.pages.map((p) => p.f), doc.pdf, doc.thumb].filter(Boolean)),
    dirty: false,
  };
  openEditorView();
}

function segInit(el, opts, cur, onPick) {
  el.innerHTML = opts.map(([k, n]) => `<button data-k="${k}" class="${k === cur ? 'on' : ''}">${esc(n)}</button>`).join('');
  $$('button', el).forEach((b) => b.addEventListener('click', () => {
    $$('button', el).forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.k);
  }));
}

function openEditorView() {
  $('#ed-title').textContent = ED.isNew ? '新文件' : '编辑页面';
  $('#ed-name').value = ED.name;
  $('#ed-folder').innerHTML = ['<option value="">未分类</option>']
    .concat(DB.folders.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`))
    .concat('<option value="__new">＋ 新建文件夹…</option>').join('');
  $('#ed-folder').value = ED.folder;
  const allSame = ED.pages.every((p) => p.filter === ED.pages[0].filter) ? ED.pages[0].filter : '';
  segInit($('#ed-filter-all'), FILTERS.map((f) => [f.k, f.n]), allSame, (k) => { ED.pages.forEach((p) => (p.filter = k)); ED.dirty = true; renderPages(); });
  segInit($('#ed-paper'), Object.entries(PAPER), ED.paper, (k) => { ED.paper = k; ED.dirty = true; });
  segInit($('#ed-quality'), Object.entries(QUALITY).map(([k, v]) => [k, v.n]), ED.quality, (k) => { ED.quality = k; ED.dirty = true; });
  renderPages();
  show('editor');
  $('.ed-scroll').scrollTop = 0;
}

function syncFilterAllSeg() {
  const k = ED.pages.length && ED.pages.every((p) => p.filter === ED.pages[0].filter) ? ED.pages[0].filter : '';
  $$('#ed-filter-all button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
}

function renderPages() {
  const box = $('#ed-pages');
  box.innerHTML = ED.pages.map((p, i) => `
    <div class="page" data-f="${p.f}">
      <img src="${store.url(`docs/${ED.id}/${p.f}`)}" style="filter:${fcss(p.filter)}" alt="" />
      <span class="no">${i + 1}</span>
    </div>`).join('');
  $$('.page', box).forEach((el) => el.addEventListener('click', () => pageSheet(el.dataset.f)));
  if (sortable) sortable.destroy();
  sortable = new Sortable(box, {
    animation: 160,
    delay: 220,
    delayOnTouchOnly: true,
    touchStartThreshold: 6,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: () => {
      const order = $$('.page', box).map((el) => el.dataset.f);
      ED.pages.sort((a, b) => order.indexOf(a.f) - order.indexOf(b.f));
      ED.dirty = true;
      $$('.page .no', box).forEach((n, i) => (n.textContent = i + 1));
    },
  });
  syncFilterAllSeg();
  $('#ed-save').textContent = `保存（${ED.pages.length} 页）`;
}

async function pageSheet(f) {
  const idx = ED.pages.findIndex((p) => p.f === f);
  if (idx < 0) return;
  const p = ED.pages[idx];
  const url = store.url(`docs/${ED.id}/${p.f}`);
  const n = ED.pages.length;
  const html = `
    <h3>第 ${idx + 1} 页</h3>
    <div class="filters">${FILTERS.map((fl) => `<button data-k="${fl.k}" class="${fl.k === p.filter ? 'on' : ''}"><img src="${url}" style="filter:${fl.css}" alt="" />${fl.n}</button>`).join('')}</div>
    <div class="tools">
      <button id="pt-left" ${idx === 0 ? 'disabled' : ''}>${I.left}前移</button>
      <button id="pt-right" ${idx === n - 1 ? 'disabled' : ''}>${I.right}后移</button>
      <button id="pt-rot">${I.rotate}旋转</button>
      <button id="pt-del" class="danger">${I.trash}删除</button>
    </div>`;
  const act = await openSheet(html, (sh) => {
    $$('.filters button', sh).forEach((b) => b.addEventListener('click', () => closeSheet({ filter: b.dataset.k })));
    $('#pt-left', sh).onclick = () => closeSheet({ move: -1 });
    $('#pt-right', sh).onclick = () => closeSheet({ move: 1 });
    $('#pt-rot', sh).onclick = () => closeSheet({ rot: 1 });
    $('#pt-del', sh).onclick = () => closeSheet({ del: 1 });
  });
  if (!act) return;
  ED.dirty = true;
  if (act.filter) { p.filter = act.filter; }
  else if (act.move) {
    const j = idx + act.move;
    [ED.pages[idx], ED.pages[j]] = [ED.pages[j], ED.pages[idx]];
  } else if (act.rot) {
    busy('旋转中…');
    try {
      const bmp = await decode(await store.read(`docs/${ED.id}/${p.f}`));
      const out = await render(bmp, { max: STORE_MAX, rotate: 90, q: 0.92 });
      if (bmp.close) bmp.close();
      const nf = 'p_' + uid() + '.jpg';
      await store.write(`docs/${ED.id}/${nf}`, out.blob);
      if (!ED.keep.has(p.f)) store.del(`docs/${ED.id}/${p.f}`);
      p.f = nf;
    } catch (e) { toast('旋转失败'); }
    busy(false);
  } else if (act.del) {
    if (ED.pages.length === 1) return toast('至少要保留一页');
    ED.pages.splice(idx, 1);
    if (!ED.keep.has(p.f)) store.del(`docs/${ED.id}/${p.f}`);
  }
  renderPages();
}

async function addMore(kind) {
  const blobs = kind === 'scan' ? await getScan() : await pickImages();
  if (!blobs) return;
  const pages = await importMany(ED.id, blobs, 'none');
  ED.pages.push(...pages);
  ED.dirty = true;
  renderPages();
  setTimeout(() => { const s = $('.ed-scroll'); s.scrollTop = $('#ed-pages').offsetTop + $('#ed-pages').offsetHeight - s.clientHeight + 120; }, 50);
}

/** 删掉目录里没用到的文件 */
async function cleanDir(id, keep) {
  const files = await store.list('docs/' + id);
  for (const f of files) if (!keep.has(f)) await store.del(`docs/${id}/${f}`);
}

async function editorBack() {
  if (ED.dirty && !(await confirmSheet(ED.isNew ? '放弃这个文件？' : '放弃修改？', ED.isNew ? '扫描的页面不会保存。' : '刚才的修改不会保存。', '放弃', true))) return;
  const ed = ED;
  ED = null;
  if (ed.isNew) await store.rmdir('docs/' + ed.id);
  else await cleanDir(ed.id, ed.keep);
  if (ed.isNew && SHARE_MODE) return finishShare();
  if (ed.isNew) { show('home'); renderHome(); } else openDetail(ed.id);
}

async function saveEditor() {
  const name = $('#ed-name').value.trim() || defaultName();
  if (!ED.pages.length) return toast('至少要一页');
  const id = ED.id;
  try {
    const bytes = await buildPdf(id, ED.pages, ED.paper, ED.quality, name);
    const old = docById(id);
    const pdf = safeName(name) + '.pdf';
    await store.write(`docs/${id}/${pdf}`, new Blob([bytes], { type: 'application/pdf' }));
    busy('正在保存…');
    // 缩略图
    const first = ED.pages[0];
    const bmp = await decode(await store.read(`docs/${id}/${first.f}`));
    const t = await render(bmp, { max: 420, filter: first.filter, q: 0.75 });
    if (bmp.close) bmp.close();
    const thumb = 't_' + uid() + '.jpg';
    await store.write(`docs/${id}/${thumb}`, t.blob);

    const now = Date.now();
    const pagesChanged = !old || old.pages.map((p) => p.f).join('|') !== ED.pages.map((p) => p.f).join('|');
    const doc = {
      id, name, folder: ED.folder,
      created: old ? old.created : now, updated: now,
      pages: ED.pages, pdf, thumb, size: bytes.length,
      paper: ED.paper, quality: ED.quality,
      text: old ? old.text || '' : '',
      ocr: pagesChanged || !old || old.ocr === 'na' ? (NATIVE ? 'pending' : 'na') : old.ocr,
    };
    if (old) Object.assign(old, doc); else DB.docs.push(doc);
    DB.settings.paper = ED.paper;
    DB.settings.quality = ED.quality;
    await saveDB();
    await cleanDir(id, new Set([...ED.pages.map((p) => p.f), pdf, thumb]));
    ED = null;
    busy(false);
    toast('已保存');
    openDetail(id);
    runOcrQueue();
  } catch (e) {
    busy(false);
    toast('保存失败：' + (e.message || e), 4000);
  }
}

$('#ed-back').addEventListener('click', editorBack);
$('#ed-save').addEventListener('click', saveEditor);
$('#ed-name').addEventListener('input', (e) => { ED.name = e.target.value; ED.dirty = true; });
$('#ed-folder').addEventListener('change', async (e) => {
  if (e.target.value === '__new') {
    const n = await promptSheet('新建文件夹', '', '例如：发票、合同、客户A');
    if (n && !DB.folders.includes(n)) { DB.folders.push(n); await saveDB(); }
    const keepName = $('#ed-name').value;
    ED.folder = n || ED.folder;
    ED.dirty = true;
    openEditorView();
    $('#ed-name').value = keepName;
    return;
  }
  ED.folder = e.target.value;
  ED.dirty = true;
});
$('#ed-add-scan').addEventListener('click', () => addMore('scan'));
$('#ed-add-gallery').addEventListener('click', () => addMore('gallery'));

/* =========================================================
   文件详情
   ========================================================= */
let DT = null;

function ocrLabel(d) {
  return { pending: '文字识别中…', done: d.text && d.text.trim() ? '可搜索文字' : '没有识别到文字', error: '部分页面识别失败', na: '' }[d.ocr] || '';
}

function openDetail(id) {
  const d = docById(id);
  if (!d) { show('home'); renderHome(); return; }
  DT = id;
  $('#dt-title').textContent = d.name;
  const meta = [`${d.pages.length} 页`, fmtSize(d.size), fmtDate(d.updated)];
  if (d.folder) meta.push(d.folder);
  const ol = ocrLabel(d);
  if (ol) meta.push(ol);
  $('#dt-meta').textContent = meta.join(' · ');
  $('#dt-pages').innerHTML = d.pages.map((p, i) => `<figure><img loading="lazy" src="${store.url(`docs/${d.id}/${p.f}`)}" style="filter:${fcss(p.filter)}" alt="" /><figcaption>${i + 1} / ${d.pages.length}</figcaption></figure>`).join('');
  if (VIEW !== 'detail') $('#dt-pages').scrollTop = 0;
  show('detail');
}

function detailBack() {
  DT = null;
  if (SHARE_MODE) return finishShare();
  show('home');
  renderHome();
}

async function sharePdf(d) {
  if (!NATIVE) {
    const a = document.createElement('a');
    a.href = store.url(`docs/${d.id}/${d.pdf}`);
    a.download = d.pdf;
    a.click();
    return;
  }
  try {
    await store.clearShare();
    const uri = await store.copyToShare(`docs/${d.id}/${d.pdf}`, d.pdf);
    await ShareP.share({ title: d.name, files: [uri], dialogTitle: '分享 PDF' });
  } catch (e) {
    if (!/cancel/i.test(e.message || '')) toast('分享失败：' + (e.message || e), 4000);
  }
}

async function shareImages(d) {
  try {
    await store.clearShare();
    const uris = [];
    const base = safeName(d.name);
    for (let i = 0; i < d.pages.length; i++) {
      busy(`正在准备图片 ${i + 1} / ${d.pages.length}`);
      const p = d.pages[i];
      const bmp = await decode(await store.read(`docs/${d.id}/${p.f}`));
      const out = await render(bmp, { max: QUALITY.hd.max, filter: p.filter, q: 0.88 });
      if (bmp.close) bmp.close();
      const nm = d.pages.length > 1 ? `${base}_${i + 1}.jpg` : `${base}.jpg`;
      if (!NATIVE) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(out.blob); a.download = nm; a.click();
        continue;
      }
      uris.push(await store.blobToShare(nm, out.blob));
    }
    busy(false);
    if (NATIVE) await ShareP.share({ title: d.name, files: uris, dialogTitle: '分享图片' });
  } catch (e) {
    busy(false);
    if (!/cancel/i.test(e.message || '')) toast('分享失败：' + (e.message || e), 4000);
  }
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove();
    return ok;
  }
}

async function textSheet(d) {
  const state = d.ocr;
  const desc = !NATIVE ? '浏览器预览没有文字识别，装到手机上才会识别。' :
    state === 'pending' ? '正在识别，稍等一下再打开。' :
      !(d.text || '').trim() ? '这份文件没有识别到文字。' : '可以长按选取部分文字，或者一键复制全部。';
  const v = await openSheet(`
    <h3>识别出的文字</h3><p class="desc">${esc(desc)}</p>
    <textarea readonly id="tx">${esc(d.text || '')}</textarea>
    <div class="btns"><button id="tx-re">重新识别</button><button class="primary" id="tx-copy">复制全部</button></div>`, (sh) => {
    $('#tx-copy', sh).onclick = () => closeSheet('copy');
    $('#tx-re', sh).onclick = () => closeSheet('re');
  });
  if (v === 'copy') {
    if (!(d.text || '').trim()) return toast('没有文字可以复制');
    toast((await copyText(d.text)) ? '已复制' : '复制失败，请长按选取');
  } else if (v === 're') {
    if (!NATIVE) return toast('要在手机上才能识别');
    d.ocr = 'pending';
    await saveDB();
    openDetail(d.id);
    runOcrQueue(true);
  }
}

async function moreSheet(d) {
  const v = await actionSheet(d.name, [
    { icon: I.edit, label: '重命名', value: 'rename' },
    { icon: I.folder, label: '移动到文件夹', right: d.folder || '未分类', value: 'move' },
    { icon: I.dup, label: '复制一份', value: 'dup' },
    { icon: I.trash, label: '删除', value: 'del', danger: true },
  ]);
  if (v === 'rename') {
    const n = await promptSheet('重命名', d.name);
    if (!n || n === d.name) return;
    const pdf = safeName(n) + '.pdf';
    if (pdf !== d.pdf) {
      try { await store.move(`docs/${d.id}/${d.pdf}`, `docs/${d.id}/${pdf}`); d.pdf = pdf; } catch (e) { toast('改名失败'); return; }
    }
    d.name = n;
    d.updated = Date.now();
    await saveDB();
    openDetail(d.id);
  } else if (v === 'move') {
    const opts = [{ label: '未分类', value: '__none', on: !d.folder, right: !d.folder ? '当前' : null }]
      .concat(DB.folders.map((f) => ({ icon: I.folder, label: f, value: f, on: d.folder === f, right: d.folder === f ? '当前' : null })))
      .concat({ icon: I.plus, label: '新建文件夹…', value: '__new' });
    let f = await actionSheet('移动到', opts);
    if (f == null) return;
    if (f === '__new') {
      f = await promptSheet('新建文件夹', '', '例如：发票、合同、客户A');
      if (!f) return;
      if (!DB.folders.includes(f)) DB.folders.push(f);
    }
    d.folder = f === '__none' ? '' : f;
    await saveDB();
    toast(d.folder ? `已移到「${d.folder}」` : '已移到未分类');
    openDetail(d.id);
  } else if (v === 'dup') {
    busy('复制中…');
    try {
      const nid = uid();
      for (const f of [...d.pages.map((p) => p.f), d.pdf, d.thumb]) {
        await store.write(`docs/${nid}/${f}`, await store.read(`docs/${d.id}/${f}`));
      }
      const nd = JSON.parse(JSON.stringify(d));
      Object.assign(nd, { id: nid, name: d.name + ' 副本', created: Date.now(), updated: Date.now() });
      const npdf = safeName(nd.name) + '.pdf';
      await store.move(`docs/${nid}/${d.pdf}`, `docs/${nid}/${npdf}`);
      nd.pdf = npdf;
      DB.docs.push(nd);
      await saveDB();
      busy(false);
      toast('已复制');
      openDetail(nid);
    } catch (e) { busy(false); toast('复制失败'); }
  } else if (v === 'del') {
    if (!(await confirmSheet(`删除「${d.name}」？`, '删除后无法恢复。', '删除', true))) return;
    DB.docs = DB.docs.filter((x) => x.id !== d.id);
    await saveDB();
    await store.rmdir('docs/' + d.id);
    toast('已删除');
    detailBack();
  }
}

$('#dt-back').addEventListener('click', detailBack);
$('#dt-share-pdf').addEventListener('click', () => { const d = docById(DT); if (d) sharePdf(d); });
$('#dt-share-img').addEventListener('click', () => { const d = docById(DT); if (d) shareImages(d); });
$('#dt-text').addEventListener('click', () => { const d = docById(DT); if (d) textSheet(d); });
$('#dt-edit').addEventListener('click', () => { const d = docById(DT); if (d) editDoc(d); });
$('#dt-more').addEventListener('click', () => { const d = docById(DT); if (d) moreSheet(d); });

/* =========================================================
   离线文字识别（后台逐份处理）
   ========================================================= */
let ocrRunning = false;
async function runOcrQueue(force) {
  if (!NATIVE || !Ocr || ocrRunning) return;
  ocrRunning = true;
  try {
    for (;;) {
      const d = DB.docs.find((x) => x.ocr === 'pending');
      if (!d) break;
      const sig = d.pages.map((p) => p.f).join('|');
      const texts = [];
      let failed = 0;
      for (const p of d.pages) {
        try {
          const r = await Ocr.recognize({ path: store.uri(`docs/${d.id}/${p.f}`) });
          texts.push((r && r.text) || '');
        } catch (e) {
          if (e && (e.code === 'UNIMPLEMENTED' || /not implemented/i.test(e.message || ''))) return; // 分享窗口里没有 OCR，回主程序再做
          texts.push('');
          failed++;
        }
      }
      const cur = docById(d.id);
      if (!cur || cur.pages.map((p) => p.f).join('|') !== sig) continue;
      cur.text = texts.join('\n\n').trim();
      cur.ocr = failed === d.pages.length ? 'error' : 'done';
      await saveDB();
      if (VIEW === 'detail' && DT === cur.id) {
        openDetail(cur.id);
        if (force) toast(cur.text ? '文字识别完成' : '没有识别到文字');
      }
      if (VIEW === 'home' && query) renderHome();
    }
  } finally {
    ocrRunning = false;
  }
}

/* =========================================================
   设置
   ========================================================= */
async function settingsSheet() {
  const s = DB.settings;
  const total = DB.docs.reduce((a, d) => a + (d.size || 0), 0);
  const v = await actionSheet('设置', [
    { label: '默认画质', right: QUALITY[s.quality].n, value: 'q' },
    { label: '默认纸张', right: PAPER[s.paper], value: 'p' },
    { label: '文件名开头', right: s.prefix, value: 'n' },
    { label: '管理文件夹', right: `${DB.folders.length} 个`, value: 'f' },
    { label: '关于 YourScan', value: 'about' },
  ], `共 ${DB.docs.length} 份文件 · PDF 约 ${fmtSize(total)} · 文件只保存在这部手机里`);
  if (v === 'q') {
    const k = await actionSheet('默认画质', Object.entries(QUALITY).map(([k, q]) => ({ label: q.n, value: k, on: k === s.quality, right: k === s.quality ? '当前' : { hd: '最清楚，文件大', std: '推荐', small: '适合 WhatsApp' }[k] })));
    if (k) { s.quality = k; await saveDB(); toast('已设为' + QUALITY[k].n); }
  } else if (v === 'p') {
    const k = await actionSheet('默认纸张', Object.entries(PAPER).map(([k, n]) => ({ label: n, value: k, on: k === s.paper, right: k === s.paper ? '当前' : k === 'a4' ? '每页统一 A4，适合打印' : '保持图片原本比例' })));
    if (k) { s.paper = k; await saveDB(); }
  } else if (v === 'n') {
    const n = await promptSheet('文件名开头', s.prefix, '例如：扫描、公司名');
    if (n) { s.prefix = n; await saveDB(); toast('新文件会叫 ' + defaultName()); }
  } else if (v === 'f') {
    manageFolders();
  } else if (v === 'about') {
    await actionSheet('YourScan', [{ label: '知道了', value: 'ok' }], '给办公室同事用的文件扫描工具。无广告，扫描和文字识别都在手机里离线完成，文件不会上传到任何地方。');
  }
}
$('#btn-settings').addEventListener('click', settingsSheet);

/* =========================================================
   入口按钮 / 返回键 / 分享进来
   ========================================================= */
$('#btn-scan').addEventListener('click', async () => newDocFrom(await getScan()));
$('#btn-gallery').addEventListener('click', async () => newDocFrom(await pickImages()));

function finishShare() {
  if (SendIntent) SendIntent.finish();
}

async function checkShareIntent() {
  if (!SendIntent) return;
  let r;
  try { r = await SendIntent.checkSendIntentReceived(); } catch (e) { return; }
  if (!r || !r.url) return;
  const items = [r, ...(r.additionalItems || [])].filter((x) => x && x.url && (!x.type || /image/i.test(x.type)));
  if (!items.length) return;
  SHARE_MODE = true;
  busy('正在读取图片…');
  const blobs = [];
  for (const it of items) {
    const u = decodeURIComponent(it.url);
    try { blobs.push(await fetchUri(u)); } catch (e) {}
    try { await FS.deleteFile({ path: u }); } catch (e) {}
  }
  busy(false);
  if (!blobs.length) { toast('读取图片失败'); return finishShare(); }
  await newDocFrom(blobs);
}

if (AppP) {
  AppP.addListener('backButton', () => {
    if (!$('#busy').hidden) return;
    if (sheetOpen()) return closeSheet(null);
    if (VIEW === 'editor') return editorBack();
    if (VIEW === 'detail') return detailBack();
    if (SHARE_MODE) return finishShare();
    if (query) { $('#q').value = ''; query = ''; return renderHome(); }
    if (curFolder !== '__all') { curFolder = '__all'; return renderHome(); }
    (AppP.minimizeApp ? AppP.minimizeApp() : AppP.exitApp()).catch(() => AppP.exitApp());
  });
  AppP.addListener('resume', () => runOcrQueue());
}

(async function boot() {
  try {
    await store.init();
    await loadDB();
  } catch (e) {
    toast('读取文件列表失败：' + (e.message || e), 5000);
  }
  renderHome();
  await checkShareIntent();
  runOcrQueue();
})();
