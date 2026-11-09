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
  { k: 'none', n: 'fNone', css: 'none' },
  { k: 'enhance', n: 'fEnhance', css: 'contrast(1.28) brightness(1.08) saturate(1.15)' },
  { k: 'gray', n: 'fGray', css: 'grayscale(1) contrast(1.2) brightness(1.05)' },
  { k: 'bw', n: 'fBw', css: 'grayscale(1) contrast(2.4) brightness(1.18)' },
];
const fcss = (k) => (FILTERS.find((f) => f.k === k) || FILTERS[0]).css;
const QUALITY = {
  hd: { n: 'qHd', max: 2480, q: 0.88 },
  std: { n: 'qStd', max: 1800, q: 0.8 },
  small: { n: 'qSmall', max: 1240, q: 0.66 },
};
const PAPER = { a4: 'pA4', auto: 'pAuto' };
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
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  backup: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/></svg>',
  restore: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  docs: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
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
      if (!r.ok) throw new Error(t('readFail') + ' ' + p);
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
    async read(p) { if (!m.has(p)) throw new Error(t('readFail') + ' ' + p); return m.get(p); },
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
let DB = { v: 1, docs: [], folders: [], settings: { quality: 'std', paper: 'a4', prefix: '', lang: 'auto' } };
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
    busy(t('importing', { i: i + 1, n: blobs.length }));
    try {
      const p = await importImage(docId, blobs[i]);
      p.filter = filter;
      pages.push(p);
    } catch (e) {
      bad++;
    }
  }
  busy(false);
  if (bad) toast(t('badImgs', { n: bad }));
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
    busy(t('makingPdf', { i: i + 1, n: pages.length }));
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
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('top', sheetOpen());
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), ms);
}
function busy(text) {
  const b = $('#busy');
  if (text === false) { b.hidden = true; return; }
  $('#busy-text').textContent = text || t('busy');
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
function actionSheet(title, items, desc, rawHtml) {
  const html = (title ? `<h3>${esc(title)}</h3>` : '') + (desc ? `<p class="desc">${esc(desc)}</p>` : '') + (rawHtml ? `<div class="help">${rawHtml}</div>` : '') +
    items.map((it, i) => `<button class="row ${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}" data-i="${i}">${it.icon || ''}<span>${esc(it.label)}</span>${it.right != null ? `<span class="r">${esc(it.right)}</span>` : ''}</button>`).join('');
  return openSheet(html, (sh) => {
    $$('.row', sh).forEach((b) => b.addEventListener('click', () => {
      const it = items[+b.dataset.i];
      closeSheet(it.value ?? +b.dataset.i);
    }));
  });
}
function promptSheet(title, value = '', placeholder = '', okLabel = t('ok')) {
  return openSheet(`<h3>${esc(title)}</h3><input type="text" id="pr-in" value="${esc(value)}" placeholder="${esc(placeholder)}" /><div class="btns"><button id="pr-no">${t('cancel')}</button><button class="primary" id="pr-ok">${esc(okLabel)}</button></div>`, (sh) => {
    const inp = $('#pr-in', sh);
    setTimeout(() => { inp.focus(); inp.select(); }, 250);
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } closeSheet(v); };
    $('#pr-ok', sh).onclick = ok;
    $('#pr-no', sh).onclick = () => closeSheet(null);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
}
function confirmSheet(title, desc, okLabel = t('ok'), danger = false) {
  return openSheet(`<h3>${esc(title)}</h3>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}<div class="btns"><button id="cf-no">${t('cancel')}</button><button class="${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(okLabel)}</button></div>`, (sh) => {
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
  if (d.toDateString() === now.toDateString()) return t('today') + ' ' + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t('yesterday') + ' ' + hm;
  return (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/') + `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function fmtSize(b) {
  if (!b) return '0 KB';
  if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
function defaultName() {
  const d = new Date();
  const p = (DB.settings.prefix || '').trim() || t('defaultPrefix');
  return `${p}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
const safeName = (s) => (s || 'YourScan').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').replace(/^\.+/, '').slice(0, 80).trim() || 'YourScan';

/* =========================================================
   首页
   ========================================================= */
let curFolder = '__all';
let query = '';

const live = () => DB.docs.filter((d) => !d.trashed);
const trashed = () => DB.docs.filter((d) => d.trashed);
const TRASH_DAYS = 30;

function folderTitle() {
  if (curFolder === '__trash') return t('trash');
  if (curFolder === '__all') return t('myDocs');
  if (curFolder === '') return t('uncat');
  return curFolder;
}

/* ---------- ☰ 侧边菜单 ---------- */
let APP_VER = '';
function drawerOpen() { return $('#drawer').classList.contains('on'); }
function closeDrawer() { $('#drawer').classList.remove('on'); $('#drawer-bg').classList.remove('on'); }
function openDrawer() {
  const cnt = (f) => live().filter((d) => (d.folder || '') === f).length;
  const row = (k, icon, label, right, on) => `<button class="dr-row ${on ? 'on' : ''}" data-k="${esc(k)}">${icon}<span>${esc(label)}</span>${right != null ? `<span class="r">${esc(right)}</span>` : ''}</button>`;
  let h = `<div class="dr-head"><div class="dr-logo">YourScan</div><div class="dr-ver">${esc(t('version'))} ${esc(APP_VER || '1.0')}</div></div>`;
  h += row('settings', I.gear, t('settings'));
  h += '<div class="dr-sep"></div>';
  h += row('__all', I.docs, t('myDocs'), live().length, curFolder === '__all');
  if (DB.folders.length) h += row('__none', I.folder, t('uncat'), cnt(''), curFolder === '');
  DB.folders.forEach((f) => { h += row('f:' + f, I.folder, f, cnt(f), curFolder === f); });
  h += row('newfolder', I.plus, t('newFolder'));
  if (DB.folders.length) h += row('managefolders', I.edit, t('manageFolders'));
  h += '<div class="dr-sep"></div>';
  h += row('backup', I.backup, t('backupRestore'));
  h += row('__trash', I.trash, `${t('trash')} (${trashed().length})`, null, curFolder === '__trash');
  h += '<div class="dr-sep"></div>';
  h += row('help', I.help, t('help'));
  h += row('about', I.info, t('about'));
  $('#drawer').innerHTML = h;
  $$('#drawer .dr-row').forEach((b) => b.addEventListener('click', () => drawerPick(b.dataset.k)));
  $('#drawer-bg').classList.add('on');
  $('#drawer').classList.add('on');
}
async function drawerPick(k) {
  closeDrawer();
  if (k === '__all' || k === '__trash') { curFolder = k; return renderHome(); }
  if (k === '__none') { curFolder = ''; return renderHome(); }
  if (k.startsWith('f:')) { curFolder = k.slice(2); return renderHome(); }
  if (k === 'settings') return settingsSheet();
  if (k === 'managefolders') return manageFolders();
  if (k === 'backup') return backupSheet();
  if (k === 'help') return actionSheet(t('help'), [{ label: t('gotIt'), value: 'ok' }], '', t('helpHtml'));
  if (k === 'about') return actionSheet('YourScan', [{ label: t('gotIt'), value: 'ok' }], `${t('version')} ${APP_VER || '1.0'} · ${t('aboutText')}`);
  if (k === 'newfolder') {
    const n = await promptSheet(t('newFolder'), '', t('folderPh'));
    if (!n) return;
    if (DB.folders.includes(n)) return toast(t('folderExists'));
    DB.folders.push(n);
    await saveDB();
    curFolder = n;
    renderHome();
  }
}
$('#drawer-bg').addEventListener('click', closeDrawer);

/* ---------- 回收站 ---------- */
async function trashDoc(d) {
  d.trashed = Date.now();
  await saveDB();
  toast(t('movedToTrash'));
}
async function restoreDoc(d) {
  delete d.trashed;
  await saveDB();
  toast(t('restored'));
}
async function purgeDoc(d) {
  DB.docs = DB.docs.filter((x) => x.id !== d.id);
  await store.rmdir('docs/' + d.id);
}
async function trashRowMenu(d) {
  const left = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - d.trashed) / 86400000));
  const v = await actionSheet(d.name, [
    { icon: I.restore, label: t('restore'), value: 'restore' },
    { icon: I.trash, label: t('delForever'), value: 'purge', danger: true },
  ], t('trashLeft', { n: left }));
  if (v === 'restore') await restoreDoc(d);
  else if (v === 'purge') {
    if (!(await confirmSheet(t('delQ', { name: d.name }), t('delD'), t('del'), true))) return;
    await purgeDoc(d);
    await saveDB();
    toast(t('deleted'));
  } else return;
  renderHome();
}
async function trashTopMenu() {
  const n = trashed().length;
  const v = await actionSheet(t('trash'), [
    { icon: I.restore, label: t('restoreAll'), value: 'restore' },
    { icon: I.trash, label: t('emptyTrash'), value: 'empty', danger: true },
  ], t('trashHint', { n: TRASH_DAYS }));
  if (!n || v == null) return;
  if (v === 'restore') { trashed().forEach((d) => delete d.trashed); await saveDB(); toast(t('restored')); }
  if (v === 'empty') {
    if (!(await confirmSheet(t('emptyTrashQ', { n }), t('delD'), t('del'), true))) return;
    for (const d of trashed()) await purgeDoc(d);
    await saveDB();
    toast(t('deleted'));
  }
  renderHome();
}
async function autoPurge() {
  const old = trashed().filter((d) => Date.now() - d.trashed > TRASH_DAYS * 86400000);
  for (const d of old) await purgeDoc(d);
  if (old.length) await saveDB();
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
  if (!['__all', '__trash', ''].includes(curFolder) && !DB.folders.includes(curFolder)) curFolder = '__all';
  const inTrash = curFolder === '__trash';
  document.body.classList.toggle('trash-mode', inTrash);
  const toks = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (inTrash ? trashed() : live())
    .filter((d) => inTrash || curFolder === '__all' || (d.folder || '') === curFolder)
    .map((d) => ({ d, m: matchDoc(d, toks) }))
    .filter((x) => x.m.ok)
    .sort((a, b) => b.d.updated - a.d.updated);
  $('#home-title').textContent = `${folderTitle()} (${list.length})`;
  $('#doc-list').innerHTML = list.map(({ d, m }) => `
    <div class="doc" data-id="${d.id}">
      <div class="th">${d.thumb ? `<img loading="lazy" src="${store.url(`docs/${d.id}/${d.thumb}`)}" alt="" />` : ''}</div>
      <div class="info">
        <div class="nm">${esc(d.name)}</div>
        <div class="sub">${fmtSize(d.size)}<span class="pc">${d.pages.length}</span>${curFolder === '__all' && d.folder ? `<span class="tag">${esc(d.folder)}</span>` : ''}</div>
        <div class="sub">${fmtDate(inTrash ? d.trashed : d.updated)}</div>
        ${m.hit ? `<div class="hit">${m.hit}</div>` : ''}
      </div>
      <button class="icon-btn dots" aria-label="more"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
    </div>`).join('');
  $$('#doc-list .doc').forEach((row) => {
    const d = docById(row.dataset.id);
    row.addEventListener('click', () => (inTrash ? trashRowMenu(d) : openDetail(d.id)));
    $('.dots', row).addEventListener('click', (e) => {
      e.stopPropagation();
      if (inTrash) trashRowMenu(d); else moreSheet(d, true);
    });
  });
  const empty = !list.length;
  $('#empty').hidden = !empty;
  if (empty) $('#empty-text').innerHTML = query ? t('emptySearch') : inTrash ? t('trashEmpty') : live().length ? t('emptyFolder') : t('emptyNone');
}

function openSearch(on) {
  $('#home-bar').hidden = on;
  $('#search-bar').hidden = !on;
  if (on) setTimeout(() => $('#q').focus(), 50);
  else { $('#q').value = ''; query = ''; renderHome(); }
}
$('#btn-search').addEventListener('click', () => openSearch(true));
$('#search-close').addEventListener('click', () => openSearch(false));
$('#btn-menu').addEventListener('click', openDrawer);
$('#q').addEventListener('input', (e) => { query = e.target.value.trim(); renderHome(); });

/* ---------- 文件夹管理 ---------- */
async function manageFolders() {
  const items = [{ icon: I.plus, label: t('newFolder'), value: '__new' }]
    .concat(DB.folders.map((f) => ({ icon: I.folder, label: f, right: t('nItems', { n: live().filter((d) => d.folder === f).length }), value: f })));
  const v = await actionSheet(t('folder'), items, DB.folders.length ? t('folderHint') : '');
  if (v == null) return;
  if (v === '__new') {
    const n = await promptSheet(t('newFolder'), '', t('folderPh'));
    if (!n) return;
    if (DB.folders.includes(n)) return toast(t('folderExists'));
    DB.folders.push(n);
    await saveDB();
    curFolder = n;
    renderHome();
    return;
  }
  const act = await actionSheet(v, [
    { icon: I.edit, label: t('rename'), value: 'rename' },
    { icon: I.trash, label: t('delFolderOpt'), value: 'del', danger: true },
  ]);
  if (act === 'rename') {
    const n = await promptSheet(t('renameFolder'), v);
    if (!n || n === v) return;
    if (DB.folders.includes(n)) return toast(t('folderExists'));
    DB.folders = DB.folders.map((f) => (f === v ? n : f));
    DB.docs.forEach((d) => { if (d.folder === v) d.folder = n; });
    if (curFolder === v) curFolder = n;
  } else if (act === 'del') {
    if (!(await confirmSheet(t('delFolderQ', { name: v }), t('delFolderD'), t('del'), true))) return;
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
  if (!r.ok) throw new Error(t('readFail'));
  return r.blob();
}

async function ensureScannerModule() {
  let avail = true;
  try { avail = (await Scanner.isGoogleDocumentScannerModuleAvailable()).available; } catch (e) { return; }
  if (avail) return;
  busy(t('dlScanner'));
  let h;
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(res, 90000); // 超时也试试直接扫描
      Scanner.addListener('googleDocumentScannerModuleInstallProgress', (e) => {
        busy(t('dlScannerPct', { p: Math.round(e.progress || 0) }));
        if (e.state === 4) { clearTimeout(to); res(); }
        if (e.state === 5 || e.state === 3) { clearTimeout(to); rej(new Error(t('dlScannerFail'))); }
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
    toast(t('noCamWeb'));
    return pickImages();
  }
  try {
    await ensureScannerModule();
    const r = await Scanner.scanDocument({ galleryImportAllowed: true, pageLimit: 50, resultFormats: 'JPEG', scannerMode: 'FULL' });
    const uris = (r && r.scannedImages) || [];
    if (!uris.length) return null;
    busy(t('readingScan'));
    const blobs = [];
    for (const u of uris) blobs.push(await fetchUri(u));
    busy(false);
    return blobs;
  } catch (e) {
    busy(false);
    const msg = (e && (e.message || e.code)) || String(e);
    if (/cancel/i.test(msg)) return null;
    toast(t('scanFail') + msg, 4000);
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
  $('#ed-title').textContent = ED.isNew ? t('newFile') : t('editPages');
  $('#ed-name').value = ED.name;
  $('#ed-folder').innerHTML = [`<option value="">${t('uncat')}</option>`]
    .concat(DB.folders.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`))
    .concat(`<option value="__new">${t('newFolderOpt')}</option>`).join('');
  $('#ed-folder').value = ED.folder;
  const allSame = ED.pages.every((p) => p.filter === ED.pages[0].filter) ? ED.pages[0].filter : '';
  segInit($('#ed-filter-all'), FILTERS.map((f) => [f.k, t(f.n)]), allSame, (k) => { ED.pages.forEach((p) => (p.filter = k)); ED.dirty = true; renderPages(); });
  segInit($('#ed-paper'), Object.entries(PAPER).map(([k, v]) => [k, t(v)]), ED.paper, (k) => { ED.paper = k; ED.dirty = true; });
  segInit($('#ed-quality'), Object.entries(QUALITY).map(([k, v]) => [k, t(v.n)]), ED.quality, (k) => { ED.quality = k; ED.dirty = true; });
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
  $('#ed-save').textContent = t('saveN', { n: ED.pages.length });
}

async function pageSheet(f) {
  const idx = ED.pages.findIndex((p) => p.f === f);
  if (idx < 0) return;
  const p = ED.pages[idx];
  const url = store.url(`docs/${ED.id}/${p.f}`);
  const n = ED.pages.length;
  const html = `
    <h3>${t('pageN', { n: idx + 1 })}</h3>
    <div class="filters">${FILTERS.map((fl) => `<button data-k="${fl.k}" class="${fl.k === p.filter ? 'on' : ''}"><img src="${url}" style="filter:${fl.css}" alt="" />${t(fl.n)}</button>`).join('')}</div>
    <div class="tools">
      <button id="pt-left" ${idx === 0 ? 'disabled' : ''}>${I.left}${t('moveFwd')}</button>
      <button id="pt-right" ${idx === n - 1 ? 'disabled' : ''}>${I.right}${t('moveBack')}</button>
      <button id="pt-rot">${I.rotate}${t('rotate')}</button>
      <button id="pt-del" class="danger">${I.trash}${t('del')}</button>
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
    busy(t('rotating'));
    try {
      const bmp = await decode(await store.read(`docs/${ED.id}/${p.f}`));
      const out = await render(bmp, { max: STORE_MAX, rotate: 90, q: 0.92 });
      if (bmp.close) bmp.close();
      const nf = 'p_' + uid() + '.jpg';
      await store.write(`docs/${ED.id}/${nf}`, out.blob);
      if (!ED.keep.has(p.f)) store.del(`docs/${ED.id}/${p.f}`);
      p.f = nf;
    } catch (e) { toast(t('rotateFail')); }
    busy(false);
  } else if (act.del) {
    if (ED.pages.length === 1) return toast(t('keepOne'));
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
  if (ED.dirty && !(await confirmSheet(ED.isNew ? t('discardNewQ') : t('discardEditQ'), ED.isNew ? t('discardNewD') : t('discardEditD'), t('discard'), true))) return;
  const ed = ED;
  ED = null;
  if (ed.isNew) await store.rmdir('docs/' + ed.id);
  else await cleanDir(ed.id, ed.keep);
  if (ed.isNew && SHARE_MODE) return finishShare();
  if (ed.isNew) { show('home'); renderHome(); } else openDetail(ed.id);
}

async function saveEditor() {
  const name = $('#ed-name').value.trim() || defaultName();
  if (!ED.pages.length) return toast(t('keepOne'));
  const id = ED.id;
  try {
    const bytes = await buildPdf(id, ED.pages, ED.paper, ED.quality, name);
    const old = docById(id);
    const pdf = safeName(name) + '.pdf';
    await store.write(`docs/${id}/${pdf}`, new Blob([bytes], { type: 'application/pdf' }));
    busy(t('saving'));
    // 缩略图
    const first = ED.pages[0];
    const bmp = await decode(await store.read(`docs/${id}/${first.f}`));
    const th = await render(bmp, { max: 420, filter: first.filter, q: 0.75 });
    if (bmp.close) bmp.close();
    const thumb = 't_' + uid() + '.jpg';
    await store.write(`docs/${id}/${thumb}`, th.blob);

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
    toast(t('saved'));
    openDetail(id);
    runOcrQueue();
  } catch (e) {
    busy(false);
    toast(t('saveFail') + (e.message || e), 4000);
  }
}

$('#ed-back').addEventListener('click', editorBack);
$('#ed-save').addEventListener('click', saveEditor);
$('#ed-name').addEventListener('input', (e) => { ED.name = e.target.value; ED.dirty = true; });
$('#ed-folder').addEventListener('change', async (e) => {
  if (e.target.value === '__new') {
    const n = await promptSheet(t('newFolder'), '', t('folderPh'));
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
  return ({ pending: t('ocrPending'), done: d.text && d.text.trim() ? t('ocrDone') : t('ocrNone'), error: t('ocrErr'), na: '' })[d.ocr] || '';
}

function openDetail(id) {
  const d = docById(id);
  if (!d) { show('home'); renderHome(); return; }
  DT = id;
  $('#dt-title').textContent = d.name;
  const meta = [t('nPages', { n: d.pages.length }), fmtSize(d.size), fmtDate(d.updated)];
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
    await ShareP.share({ title: d.name, files: [uri], dialogTitle: t('sharePdf') });
  } catch (e) {
    if (!/cancel/i.test(e.message || '')) toast(t('shareFail') + (e.message || e), 4000);
  }
}

async function shareImages(d) {
  try {
    await store.clearShare();
    const uris = [];
    const base = safeName(d.name);
    for (let i = 0; i < d.pages.length; i++) {
      busy(t('preparingImg', { i: i + 1, n: d.pages.length }));
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
    if (NATIVE) await ShareP.share({ title: d.name, files: uris, dialogTitle: t('shareImg') });
  } catch (e) {
    busy(false);
    if (!/cancel/i.test(e.message || '')) toast(t('shareFail') + (e.message || e), 4000);
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
  const desc = !NATIVE ? t('txWeb') :
    state === 'pending' ? t('txPending') :
      !(d.text || '').trim() ? t('txNone') : t('txHint');
  const v = await openSheet(`
    <h3>${t('txTitle')}</h3><p class="desc">${esc(desc)}</p>
    <textarea readonly id="tx">${esc(d.text || '')}</textarea>
    <div class="btns"><button id="tx-re">${t('reOcr')}</button><button class="primary" id="tx-copy">${t('copyAll')}</button></div>`, (sh) => {
    $('#tx-copy', sh).onclick = () => closeSheet('copy');
    $('#tx-re', sh).onclick = () => closeSheet('re');
  });
  if (v === 'copy') {
    if (!(d.text || '').trim()) return toast(t('noTextCopy'));
    toast((await copyText(d.text)) ? t('copied') : t('copyFail'));
  } else if (v === 're') {
    if (!NATIVE) return toast(t('ocrPhoneOnly'));
    d.ocr = 'pending';
    await saveDB();
    openDetail(d.id);
    runOcrQueue(true);
  }
}

async function moreSheet(d, fromHome) {
  const after = (id) => (fromHome ? renderHome() : openDetail(id));
  const v = await actionSheet(d.name, [
    ...(fromHome ? [{ icon: I.share, label: t('sharePdf'), value: 'share' }, { icon: I.copy, label: t('shareImg'), value: 'shareimg' }] : []),
    { icon: I.edit, label: t('rename'), value: 'rename' },
    { icon: I.folder, label: t('moveTo'), right: d.folder || t('uncat'), value: 'move' },
    { icon: I.dup, label: t('duplicate'), value: 'dup' },
    { icon: I.trash, label: t('del'), value: 'del', danger: true },
  ]);
  if (v === 'share') return sharePdf(d);
  if (v === 'shareimg') return shareImages(d);
  if (v === 'rename') {
    const n = await promptSheet(t('rename'), d.name);
    if (!n || n === d.name) return;
    const pdf = safeName(n) + '.pdf';
    if (pdf !== d.pdf) {
      try { await store.move(`docs/${d.id}/${d.pdf}`, `docs/${d.id}/${pdf}`); d.pdf = pdf; } catch (e) { toast(t('renameFail')); return; }
    }
    d.name = n;
    d.updated = Date.now();
    await saveDB();
    after(d.id);
  } else if (v === 'move') {
    const opts = [{ label: t('uncat'), value: '__none', on: !d.folder, right: !d.folder ? t('current') : null }]
      .concat(DB.folders.map((f) => ({ icon: I.folder, label: f, value: f, on: d.folder === f, right: d.folder === f ? t('current') : null })))
      .concat({ icon: I.plus, label: t('newFolderOpt'), value: '__new' });
    let f = await actionSheet(t('moveTitle'), opts);
    if (f == null) return;
    if (f === '__new') {
      f = await promptSheet(t('newFolder'), '', t('folderPh'));
      if (!f) return;
      if (!DB.folders.includes(f)) DB.folders.push(f);
    }
    d.folder = f === '__none' ? '' : f;
    await saveDB();
    toast(d.folder ? t('movedTo', { name: d.folder }) : t('movedUncat'));
    after(d.id);
  } else if (v === 'dup') {
    busy(t('duplicating'));
    try {
      const nid = uid();
      for (const f of [...d.pages.map((p) => p.f), d.pdf, d.thumb]) {
        await store.write(`docs/${nid}/${f}`, await store.read(`docs/${d.id}/${f}`));
      }
      const nd = JSON.parse(JSON.stringify(d));
      Object.assign(nd, { id: nid, name: d.name + ' ' + t('copySuffix'), created: Date.now(), updated: Date.now() });
      const npdf = safeName(nd.name) + '.pdf';
      await store.move(`docs/${nid}/${d.pdf}`, `docs/${nid}/${npdf}`);
      nd.pdf = npdf;
      DB.docs.push(nd);
      await saveDB();
      busy(false);
      toast(t('dupDone'));
      after(nid);
    } catch (e) { busy(false); toast(t('dupFail')); }
  } else if (v === 'del') {
    await trashDoc(d);
    if (fromHome) renderHome(); else detailBack();
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
      const d = DB.docs.find((x) => x.ocr === 'pending' && !x.trashed);
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
        if (force) toast(cur.text ? t('ocrDoneToast') : t('ocrNone'));
      }
      if (VIEW === 'home' && query) renderHome();
    }
  } finally {
    ocrRunning = false;
  }
}

/* =========================================================
   备份 / 还原（打包成 .zip）
   ========================================================= */
async function backupSheet() {
  const v = await actionSheet(t('backupRestore'), [
    { icon: I.download, label: t('backupNow'), right: String(live().length), value: 'b' },
    { icon: I.upload, label: t('restoreFrom'), value: 'r' },
  ], t('backupHint'));
  if (v === 'b') return makeBackup();
  if (v === 'r') return doRestore();
}

const docFiles = (d) => [...d.pages.map((p) => p.f), d.pdf, d.thumb].filter(Boolean);

async function makeBackup() {
  const docs = live();
  if (!docs.length) return toast(t('nothingToBackup'));
  try {
    const zip = new JSZip();
    zip.file('yourscan.json', JSON.stringify({ app: 'YourScan', v: 1, created: Date.now(), folders: DB.folders, docs }));
    for (let i = 0; i < docs.length; i++) {
      busy(t('backingUp', { i: i + 1, n: docs.length }));
      const d = docs[i];
      for (const f of docFiles(d)) {
        try { zip.file(`docs/${d.id}/${f}`, await store.read(`docs/${d.id}/${f}`)); } catch (e) {}
      }
    }
    busy(t('packing'));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const dt = new Date();
    const name = `YourScan_backup_${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}_${pad(dt.getHours())}${pad(dt.getMinutes())}.zip`;
    if (!NATIVE) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      busy(false);
      return;
    }
    await store.clearShare();
    const uri = await store.blobToShare(name, blob);
    busy(false);
    await ShareP.share({ title: name, files: [uri], dialogTitle: t('backupNow') });
  } catch (e) {
    busy(false);
    if (!/cancel/i.test(e.message || '')) toast(t('backupFail') + (e.message || e), 4000);
  }
}

function pickZip() {
  return new Promise((res) => {
    const inp = $('#zip-input');
    inp.value = '';
    inp.onchange = () => res(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}

async function doRestore() {
  const file = await pickZip();
  if (!file) return;
  busy(t('readingBackup'));
  try {
    const zip = await JSZip.loadAsync(file);
    const meta = zip.file('yourscan.json');
    if (!meta) throw new Error(t('badBackup'));
    const data = JSON.parse(await meta.async('string'));
    const docs = Array.isArray(data.docs) ? data.docs : [];
    let added = 0, skipped = 0;
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      if (!d || !d.id || !Array.isArray(d.pages)) continue;
      if (docById(d.id)) { skipped++; continue; }
      busy(t('restoring', { i: i + 1, n: docs.length }));
      for (const f of docFiles(d)) {
        const zf = zip.file(`docs/${d.id}/${f}`);
        if (zf) await store.write(`docs/${d.id}/${f}`, await zf.async('blob'));
      }
      delete d.trashed;
      if (d.folder && !DB.folders.includes(d.folder)) DB.folders.push(d.folder);
      DB.docs.push(d);
      added++;
    }
    (data.folders || []).forEach((f) => { if (typeof f === 'string' && !DB.folders.includes(f)) DB.folders.push(f); });
    await saveDB();
    busy(false);
    toast(t('restoredN', { n: added }) + (skipped ? ' · ' + t('skippedN', { n: skipped }) : ''), 3500);
    curFolder = '__all';
    renderHome();
    runOcrQueue();
  } catch (e) {
    busy(false);
    toast(t('restoreFail') + (e.message || e), 4500);
  }
}

/* =========================================================
   设置
   ========================================================= */
async function settingsSheet() {
  const s = DB.settings;
  const total = live().reduce((a, d) => a + (d.size || 0), 0);
  const langName = s.lang && s.lang !== 'auto' ? LANGS[s.lang] : t('langAuto');
  const v = await actionSheet(t('settings'), [
    { icon: I.globe, label: t('language'), right: langName, value: 'lang' },
    { label: t('defQuality'), right: t(QUALITY[s.quality].n), value: 'q' },
    { label: t('defPaper'), right: t(PAPER[s.paper]), value: 'p' },
    { label: t('prefix'), right: (s.prefix || '').trim() || t('defaultPrefix'), value: 'n' },
    { label: t('manageFolders'), right: String(DB.folders.length), value: 'f' },
    { label: t('about'), value: 'about' },
  ], t('setSummary', { n: live().length, size: fmtSize(total) }));
  if (v === 'lang') {
    const cur = s.lang || 'auto';
    const k = await actionSheet(t('language'), [['auto', t('langAuto')], ...Object.entries(LANGS)].map(([k, n]) => ({ label: n, value: k, on: k === cur, right: k === cur ? '✓' : null })));
    if (!k) return;
    s.lang = k;
    await saveDB();
    applyLang();
  } else if (v === 'q') {
    const D = { hd: 'qHdD', std: 'qStdD', small: 'qSmallD' };
    const k = await actionSheet(t('defQuality'), Object.entries(QUALITY).map(([k, q]) => ({ label: t(q.n), value: k, on: k === s.quality, right: k === s.quality ? t('current') : t(D[k]) })));
    if (k) { s.quality = k; await saveDB(); toast(t('setTo', { name: t(QUALITY[k].n) })); }
  } else if (v === 'p') {
    const k = await actionSheet(t('defPaper'), Object.entries(PAPER).map(([k, n]) => ({ label: t(n), value: k, on: k === s.paper, right: k === s.paper ? t('current') : t(n + 'D') })));
    if (k) { s.paper = k; await saveDB(); }
  } else if (v === 'n') {
    const n = await promptSheet(t('prefix'), (s.prefix || '').trim() || t('defaultPrefix'), t('prefixPh'));
    if (n) { s.prefix = n; await saveDB(); toast(t('newNameToast', { name: defaultName() })); }
  } else if (v === 'f') {
    manageFolders();
  } else if (v === 'about') {
    await actionSheet('YourScan', [{ label: t('gotIt'), value: 'ok' }], t('aboutText'));
  }
}

/** 切换语言后刷新所有文字 */
function applyLang() {
  setLang(DB.settings.lang === 'auto' ? null : DB.settings.lang);
  if (VIEW === 'home') renderHome();
  else if (VIEW === 'detail' && DT) openDetail(DT);
  else if (VIEW === 'editor' && ED) { const nm = $('#ed-name').value; openEditorView(); $('#ed-name').value = nm; }
}
$('#btn-settings').addEventListener('click', () => (curFolder === '__trash' ? trashTopMenu() : settingsSheet()));

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
  busy(t('readingImgs'));
  const blobs = [];
  for (const it of items) {
    const u = decodeURIComponent(it.url);
    try { blobs.push(await fetchUri(u)); } catch (e) {}
    try { await FS.deleteFile({ path: u }); } catch (e) {}
  }
  busy(false);
  if (!blobs.length) { toast(t('readImgsFail')); return finishShare(); }
  await newDocFrom(blobs);
}

if (AppP) {
  AppP.addListener('backButton', () => {
    if (!$('#busy').hidden) return;
    if (sheetOpen()) return closeSheet(null);
    if (drawerOpen()) return closeDrawer();
    if (VIEW === 'editor') return editorBack();
    if (VIEW === 'detail') return detailBack();
    if (SHARE_MODE) return finishShare();
    if (!$('#search-bar').hidden) return openSearch(false);
    if (curFolder !== '__all') { curFolder = '__all'; return renderHome(); }
    (AppP.minimizeApp ? AppP.minimizeApp() : AppP.exitApp()).catch(() => AppP.exitApp());
  });
  AppP.addListener('resume', () => runOcrQueue());
}

(async function boot() {
  setLang(null);
  try {
    await store.init();
    await loadDB();
  } catch (e) {
    setLang(null);
    toast(t('loadFail') + (e.message || e), 5000);
  }
  if (AppP) { try { APP_VER = (await AppP.getInfo()).version; } catch (e) {} }
  await autoPurge();
  applyLang();
  await checkShareIntent();
  runOcrQueue();
})();
