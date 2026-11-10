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
const YsNative = plug('YsNative');

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 常量 ---------- */
const FILTERS = [
  { k: 'none', n: 'fNone', css: '' },
  { k: 'photo', n: 'fPhoto', css: 'contrast(1.18) brightness(1.06) saturate(1.3)' },
  { k: 'doc', n: 'fDoc', css: 'grayscale(1) contrast(1.55) brightness(1.12)' },
  { k: 'bright', n: 'fBright', css: 'brightness(1.22) contrast(1.12)' },
  { k: 'bw', n: 'fBw', css: 'grayscale(1) contrast(2.6) brightness(1.2)' },
];
const OLD_FILTER = { enhance: 'photo', gray: 'doc' };
/** 一页的 CSS 滤镜（显示和导出都用同一个） */
function pcss(p) {
  const f = FILTERS.find((x) => x.k === (OLD_FILTER[p.filter] || p.filter)) || FILTERS[0];
  let s = f.css;
  if (p.b) s += ` brightness(${(1 + p.b / 100).toFixed(2)})`;
  if (p.c) s += ` contrast(${(1 + p.c / 100).toFixed(2)})`;
  return s.trim() || 'none';
}
const QUALITY = {
  hd: { n: 'qHd', max: 2480, q: 0.88 },
  std: { n: 'qStd', max: 1800, q: 0.8 },
  small: { n: 'qSmall', max: 1240, q: 0.66 },
};
const PAPER = { a4: 'pA4', auto: 'pAuto' };
const STORE_MAX = 2480; // 保存的图片最长边
const THUMB_MAX = 420;
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
  crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  wand: '<svg viewBox="0 0 24 24"><path d="m15 4 5 5L9 20H4v-5z"/><path d="M13 6l5 5"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
  rotL: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
  ocr: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
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


/** 文件的全部文字（每页识别结果合起来） */
const docText = (d) => d.pages.map((p) => p.text || '').filter(Boolean).join('\n\n');
/** 文件大小：PDF 生成过就用 PDF 大小，否则用图片总和 */
const docSize = (d) => (d.pdf && !d.pdfDirty && d.pdfSize ? d.pdfSize : d.pages.reduce((a, p) => a + (p.size || 0), 0));

/** 旧版数据（第一版）升级成新格式 */
function migrate() {
  let changed = false;
  for (const d of DB.docs) {
    for (const p of d.pages) {
      if (!p.o) {
        Object.assign(p, { id: p.id || uid(), o: p.f, t: p.t || p.f, rot: 0, quad: null, b: 0, c: 0, size: p.size || Math.round((d.size || 0) / d.pages.length), created: d.created, ocr: NATIVE ? 'pending' : 'na', text: '' });
        changed = true;
      }
      if (OLD_FILTER[p.filter]) { p.filter = OLD_FILTER[p.filter]; changed = true; }
    }
    if (d.text !== undefined) { delete d.text; delete d.ocr; changed = true; }
    if (d.pdf && d.pdfSize === undefined) { d.pdfSize = d.size; changed = true; }
    if (!d.pdfOpts) { d.pdfOpts = { paper: d.paper || DB.settings.paper, quality: d.quality || DB.settings.quality, wm: '' }; changed = true; }
  }
  return changed;
}

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
    } catch (e2) {
      // 网页读不了的格式（例如 HEIC）：交给手机系统转成 JPEG
      if (!NATIVE || !YsNative) throw e2;
      const tmp = await store.blobToShare('conv_' + uid(), blob);
      const r = await YsNative.toJpeg({ path: tmp });
      const jb = await (await fetch(C.convertFileSrc(r.path))).blob();
      try { await FS.deleteFile({ path: r.path }); } catch (e3) {}
      return await createImageBitmap(jb);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}
const freeBmp = (b) => { if (b && b.close) b.close(); };

/** 缩放 + 顺时针旋转（90 的倍数）+ 滤镜，画到画布 */
function toCanvas(src, { max = Infinity, rotate = 0, css = 'none', wm = '' } = {}) {
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
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((r * Math.PI) / 180);
  if (css && css !== 'none') ctx.filter = css;
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (wm) drawWatermark(ctx, cw, ch, wm);
  return cv;
}
const cvBlob = (cv, q = 0.9) => new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
const freeCv = (cv) => { cv.width = cv.height = 0; };

function drawWatermark(ctx, w, h, text) {
  ctx.save();
  ctx.filter = 'none';
  const fs = Math.max(14, Math.round(Math.min(w, h) / 16));
  ctx.font = `600 ${fs}px sans-serif`;
  ctx.fillStyle = 'rgba(110,110,110,0.26)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const step = ctx.measureText(text).width + fs * 3;
  const diag = Math.hypot(w, h);
  let row = 0;
  for (let y = -diag / 2; y < diag / 2; y += fs * 4, row++) {
    for (let x = -diag / 2 - (row % 2 ? step / 2 : 0); x < diag / 2; x += step) ctx.fillText(text, x, y);
  }
  ctx.restore();
}

/* ---------- 透视校正（四角拉正） ---------- */
function solveLinear(A, B) {
  const n = B.length;
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r) => r[n]);
}
/** 求把 dst 点映射到 src 点的矩阵 */
function homography(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  return [...solveLinear(A, B), 1];
}
const FULL_QUAD = [[0, 0], [1, 0], [1, 1], [0, 1]];
const isFullQuad = (q) => !q || q.every((pt, i) => Math.abs(pt[0] - FULL_QUAD[i][0]) < 0.004 && Math.abs(pt[1] - FULL_QUAD[i][1]) < 0.004);
/** 四角坐标跟着整页旋转（顺时针 +90 / 逆时针 -90） */
function rotateQuad(q, deg) {
  if (!q) return null;
  let r = q;
  const steps = (((deg / 90) % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    const m = r.map(([x, y]) => [1 - y, x]);
    r = [m[3], m[0], m[1], m[2]];
  }
  return r;
}
function warpCanvas(src, quadPx, maxSide) {
  const [tl, tr, br, bl] = quadPx;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.max(d(tl, tr), d(bl, br)), h = Math.max(d(tl, bl), d(tr, br));
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const H = homography(quadPx, [[0, 0], [w, 0], [w, h], [0, h]]);
  const sw = src.width, sh = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const od = img.data;
  for (let y = 0; y < h; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < w; x++) {
      const X = x + 0.5;
      const z = H[6] * X + H[7] * Y + H[8];
      let u = (H[0] * X + H[1] * Y + H[2]) / z - 0.5;
      let v = (H[3] * X + H[4] * Y + H[5]) / z - 0.5;
      if (u < 0) u = 0; else if (u > sw - 1) u = sw - 1;
      if (v < 0) v = 0; else if (v > sh - 1) v = sh - 1;
      const x0 = u | 0, y0 = v | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) << 2, i10 = (y0 * sw + x1) << 2, i01 = (y1 * sw + x0) << 2, i11 = (y1 * sw + x1) << 2;
      const o = (y * w + x) << 2;
      for (let c = 0; c < 3; c++) {
        const a = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
        const b = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
        od[o + c] = a + (b - a) * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
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

