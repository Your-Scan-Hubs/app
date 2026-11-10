'use strict';
/* =========================================================
   文件页 / 单页 / 边界调整 / 滤镜 / 导出
   （流程参照 ClearScanner：建好文件直接打开，改动即时保存）
   ========================================================= */

let DOC = null;          // 当前文件 id
let PIDX = 0;            // 当前页
let SHARE_MODE = false;  // 从别的 app 分享进来
let docSortable = null;

const curDoc = () => docById(DOC);
const pagePath = (d, f) => `docs/${d.id}/${f}`;
const pad2 = (n) => String(n).padStart(2, '0');

/** 文件有改动：更新时间、PDF 需要重新生成 */
async function touch(d) {
  d.updated = Date.now();
  d.pdfDirty = true;
  await saveDB();
}

/* ---------- 导入图片 ---------- */
async function importImage(docId, blob, filter) {
  const bmp = await decode(blob);
  const cv = toCanvas(bmp, { max: STORE_MAX });
  freeBmp(bmp);
  const ob = await cvBlob(cv, 0.9);
  const o = 'o_' + uid() + '.jpg';
  await store.write(`docs/${docId}/${o}`, ob);
  const tc = toCanvas(cv, { max: THUMB_MAX });
  const tn = 't_' + uid() + '.jpg';
  await store.write(`docs/${docId}/${tn}`, await cvBlob(tc, 0.75));
  freeCv(tc); freeCv(cv);
  return { id: uid(), o, f: o, t: tn, rot: 0, quad: null, filter: filter || 'none', b: 0, c: 0, size: ob.size, created: Date.now(), text: '', ocr: NATIVE ? 'pending' : 'na' };
}

const mkPage = (r, filter) => ({ id: uid(), o: r.o, f: r.o, t: r.t, rot: 0, quad: null, filter: filter || 'none', b: 0, c: 0, size: r.size || 0, created: Date.now(), text: '', ocr: NATIVE ? 'pending' : 'na' });
const DOC_EXT = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|zip|rar|7z|apk|mp4|mov|mp3|m4a|wav)$/i;

/**
 * 把收到的东西（图片 / PDF / 文字文件）变成页面。
 * 手机上优先用原生转换（快很多），不行再用网页方式。
 * items: [{ blob, name?, path? }]
 */
async function buildPages(docId, items, filter) {
  const pages = [];
  let bad = 0, unsupported = 0;
  const dirUri = NATIVE ? store.uri(`docs/${docId}`) : null;
  const n = items.length;
  for (let k = 0; k < n; k++) {
    const it = items[k];
    const pre = n > 1 ? `${k + 1}/${n} · ` : '';
    try {
      if (isPdf(it.blob, it.name)) {
        let done = false;
        if (NATIVE && YsNative) {
          let h = null;
          try {
            busy(pre + t('readingPdf'));
            const path = it.path || await store.blobToShare('in_' + uid() + '.pdf', it.blob);
            h = await YsNative.addListener('progress', (e) => busy(pre + t('pdfPageN', { i: e.i, n: e.n })));
            const r = await YsNative.pdfToImages({ path, outDir: dirUri, prefix: uid(), max: 2200, thumbMax: THUMB_MAX });
            (r.pages || []).forEach((x) => pages.push(mkPage(x, filter)));
            done = true;
          } catch (e) { /* 系统打不开（例如有密码）就用网页方式再试 */ }
          finally { if (h) h.remove(); }
        }
        if (!done) {
          const bl = await pdfToBlobs(it.blob);
          for (let i = 0; i < bl.length; i++) {
            busy(pre + t('loadingN', { i: i + 1, n: bl.length }));
            pages.push(await importImage(docId, bl[i], filter));
          }
        }
      } else if (isText(it.blob, it.name)) {
        for (const b of await textToBlobs(it.blob)) pages.push(await importImage(docId, b, filter));
      } else if (isImage(it.blob, it.name) || !DOC_EXT.test(it.name || '')) {
        let p = null;
        busy(t('loadingN', { i: k + 1, n }));
        if (NATIVE && YsNative && it.path) {
          try { p = mkPage(await YsNative.importImage({ path: it.path, outDir: dirUri, id: uid(), max: STORE_MAX, thumbMax: THUMB_MAX }), filter); } catch (e) {}
        }
        if (!p) p = await importImage(docId, it.blob || await fetchUri(it.path), filter);
        pages.push(p);
      } else unsupported++;
    } catch (e) { bad++; }
  }
  busy(false);
  if (unsupported) toast(t('unsupportedFile', { n: unsupported }), 6000);
  else if (bad) toast(t('badImgs', { n: bad }), 4000);
  return pages;
}

/** 重新生成一页（旋转 + 四角裁切），原图保留可以随时重调 */
async function processPage(d, p) {
  const bmp = await decode(await store.read(pagePath(d, p.o)));
  let cv = toCanvas(bmp, { rotate: p.rot || 0 });
  freeBmp(bmp);
  if (!isFullQuad(p.quad)) {
    const W = cv.width, H = cv.height;
    const w = warpCanvas(cv, p.quad.map(([x, y]) => [x * W, y * H]), STORE_MAX);
    freeCv(cv);
    cv = w;
  } else if (Math.max(cv.width, cv.height) > STORE_MAX) {
    const s = toCanvas(cv, { max: STORE_MAX });
    freeCv(cv);
    cv = s;
  }
  const oldF = p.f, oldT = p.t;
  if (!p.rot && isFullQuad(p.quad)) {
    p.f = p.o;
    p.size = (await store.read(pagePath(d, p.o))).size;
  } else {
    const fb = await cvBlob(cv, 0.9);
    p.f = 'f_' + uid() + '.jpg';
    await store.write(pagePath(d, p.f), fb);
    p.size = fb.size;
  }
  const tc = toCanvas(cv, { max: THUMB_MAX });
  p.t = 't_' + uid() + '.jpg';
  await store.write(pagePath(d, p.t), await cvBlob(tc, 0.75));
  freeCv(tc); freeCv(cv);
  if (oldF && oldF !== p.o && oldF !== p.f) store.del(pagePath(d, oldF));
  if (oldT && oldT !== p.t && oldT !== p.o) store.del(pagePath(d, oldT));
  p.text = '';
  p.ocr = NATIVE ? 'pending' : 'na';
}

async function removePageFiles(d, p) {
  for (const f of new Set([p.o, p.f, p.t])) if (f) await store.del(pagePath(d, f));
}

/* =========================================================
   导入 PDF：每一页转成图片
   ========================================================= */
let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        res(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsReady = null; rej(new Error('pdf.js')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsReady;
}

const isPdf = (blob, name) => (blob && /pdf/i.test(blob.type || '')) || /\.pdf$/i.test(name || '');

/** PDF → 每页一张 JPEG */
async function pdfToBlobs(blob) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await lib.getDocument({ data, cMapUrl: 'vendor/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/standard_fonts/' }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    busy(t('pdfPageN', { i, n: pdf.numPages }));
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2200 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await cvBlob(cv, 0.9));
    freeCv(cv);
    page.cleanup();
  }
  await pdf.destroy();
  return out;
}

const isText = (blob, name) => /^text\/plain/i.test((blob && blob.type) || '') || /\.(txt|csv|log|md)$/i.test(name || '');
const isImage = (blob, name) => /^image\//i.test((blob && blob.type) || '') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i.test(name || '');

/** 文字文件排成 A4 页面 */
async function textToBlobs(blob) {
  const text = (await blob.text()).replace(/\r\n?/g, '\n');
  const W = 1240, H = 1754, M = 100, fs = 30, lh = 46;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.font = `${fs}px sans-serif`;
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para) { lines.push(''); continue; }
    let cur = '';
    for (const ch of para) {
      if (ctx.measureText(cur + ch).width > W - M * 2) { lines.push(cur); cur = ch; }
      else cur += ch;
    }
    lines.push(cur);
  }
  const per = Math.floor((H - M * 2) / lh);
  const out = [];
  for (let i = 0; i < Math.max(1, lines.length); i += per) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111'; ctx.font = `${fs}px sans-serif`; ctx.textBaseline = 'top';
    lines.slice(i, i + per).forEach((l, k) => ctx.fillText(l, M, M + k * lh));
    out.push(await cvBlob(cv, 0.9));
  }
  freeCv(cv);
  return out;
}

function pickPdf() {
  return new Promise((res) => {
    const inp = $('#pdf-input');
    inp.value = '';
    inp.onchange = () => res(inp.files && inp.files.length ? [...inp.files] : null);
    inp.click();
  });
}

async function importPdfFile() {
  const fs = await pickPdf();
  if (!fs) return;
  const items = fs.map((f) => ({ blob: f, name: f.name }));
  await newDocFrom(items, { ask: items.every((it) => isImage(it.blob, it.name)) });
}

/* ---------- 批量导入对话框（选好相册图片后） ---------- */
function batchDialog(n) {
  let filter = 'none';
  return openSheet(`
    <h3>${esc(t('batchTitle', { n }))}</h3>
    <p class="desc">${esc(t('batchHint'))}</p>
    <div class="opt-label">${esc(t('filter'))}</div>
    <div class="seg" id="bd-f">${FILTERS.map((f) => `<button data-k="${f.k}" class="${f.k === filter ? 'on' : ''}">${esc(t(f.n))}</button>`).join('')}</div>
    <div class="btns"><button id="bd-no">${esc(t('cancel'))}</button><button class="primary" id="bd-ok">${esc(t('ok'))}</button></div>`, (sh) => {
    $$('#bd-f button', sh).forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.k;
      $$('#bd-f button', sh).forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#bd-ok', sh).onclick = () => closeSheet({ filter });
    $('#bd-no', sh).onclick = () => closeSheet(null);
  });
}

/**
 * 相册多选：手机上用原生选择器，选好直接存成页面（最快）。
 * 返回 { pages } 或 null（取消）。浏览器 / 旧版本退回网页方式。
 */
async function pickGalleryPages(docId) {
  if (NATIVE && YsNative) {
    let h = null;
    try {
      h = await YsNative.addListener('progress', (e) => busy(t('loadingN', { i: e.i, n: e.n })));
      const r = await YsNative.pickImages({ outDir: store.uri(`docs/${docId}`), prefix: uid(), max: STORE_MAX, thumbMax: THUMB_MAX });
      busy(false);
      if (r.bad) toast(t('badImgs', { n: r.bad }));
      const pages = (r.pages || []).map((x) => mkPage(x, 'none'));
      return pages.length ? { pages } : null;
    } catch (e) {
      busy(false);
      if (!(e && (e.code === 'UNIMPLEMENTED' || /not implemented/i.test(e.message || '')))) { toast(t('readImgsFail')); return null; }
    } finally { if (h) h.remove(); }
  }
  const blobs = await pickImages();
  if (!blobs) return null;
  return { blobs };
}

/** 选好滤镜后套到已经存好的页面上；取消就删掉 */
async function askFilterFor(docId, pages, isNewDoc) {
  const r = await batchDialog(pages.length);
  if (!r) {
    if (isNewDoc) await store.rmdir('docs/' + docId);
    else for (const p of pages) await removePageFiles({ id: docId }, p);
    return false;
  }
  pages.forEach((p) => { p.filter = r.filter; });
  return true;
}

async function newDocFromGallery() {
  const id = uid();
  const got = await pickGalleryPages(id);
  if (!got) { await store.rmdir('docs/' + id); return; }
  if (got.blobs) return newDocFrom(got.blobs, { ask: true });
  if (!(await askFilterFor(id, got.pages, true))) return;
  await createDoc(id, got.pages, null);
}

/** 用已经准备好的页面建文件 */
async function createDoc(id, pages, name) {
  const now = Date.now();
  const d = {
    id, name: (name && name.trim()) || defaultName(),
    folder: !['__all', '__trash'].includes(curFolder) ? curFolder : '',
    created: now, updated: now, pages,
    pdf: null, pdfDirty: true, pdfSize: 0,
    pdfOpts: { paper: DB.settings.paper, quality: DB.settings.quality, wm: '' },
  };
  DB.docs.push(d);
  await saveDB();
  openDoc(id);
  setTimeout(runOcrQueue, 1500);
  return d;
}

/** 新建文件（扫描结果直接用；相册图片先问滤镜）。src：Blob 或 {blob, name, path} */
async function newDocFrom(src, { ask = false, name = null } = {}) {
  if (!src || !src.length) return null;
  const items = src.map((x) => (x instanceof Blob ? { blob: x, name: x.name } : x));
  let filter = 'none';
  if (ask) {
    const r = await batchDialog(items.length);
    if (!r) { if (SHARE_MODE) finishShare(); return null; }
    filter = r.filter;
  }
  if (!name) {
    const first = items.find((it) => it.name && !isImage(it.blob, it.name));
    if (first) name = String(first.name).replace(/\.[a-z0-9]{1,5}$/i, '');
  }
  const id = uid();
  const pages = await buildPages(id, items, filter);
  if (!pages.length) { await store.rmdir('docs/' + id); if (SHARE_MODE) setTimeout(finishShare, 3500); return null; }
  return createDoc(id, pages, name);
}

async function addPages(kind) {
  const d = curDoc();
  if (!d) return;
  let pages = [];
  if (kind === 'scan') {
    const items = await getScan();
    if (!items) return;
    pages = await buildPages(d.id, items.map((b) => (b instanceof Blob ? { blob: b, name: b.name } : b)), 'none');
  } else {
    const got = await pickGalleryPages(d.id);
    if (!got) return;
    if (got.blobs) {
      const r = await batchDialog(got.blobs.length);
      if (!r) return;
      pages = await buildPages(d.id, got.blobs.map((b) => ({ blob: b, name: b.name })), r.filter);
    } else {
      if (!(await askFilterFor(d.id, got.pages, false))) return;
      pages = got.pages;
    }
  }
  if (!pages.length) return;
  d.pages.push(...pages);
  await touch(d);
  renderDoc();
  setTimeout(() => { const g = $('#doc-pages'); g.scrollTop = g.scrollHeight; }, 60);
  runOcrQueue();
}

/* =========================================================
   文件页：两列页面格子
   ========================================================= */
function openDoc(id) {
  const d = docById(id);
  if (!d) { show('home'); renderHome(); return; }
  DOC = id;
  renderDoc();
  if (VIEW !== 'doc') $('#doc-pages').scrollTop = 0;
  show('doc');
}

let SEL = null; // 选择模式：选中的页面 id

function renderDoc() {
  const d = curDoc();
  if (!d) return;
  if (SEL) SEL = new Set([...SEL].filter((id) => d.pages.some((p) => p.id === id)));
  $('#doc-title').textContent = SEL ? t('nSelected', { n: SEL.size }) : d.name;
  $('#v-doc').classList.toggle('selecting', !!SEL);
  const box = $('#doc-pages');
  box.innerHTML = d.pages.map((p, i) => `
    <div class="pcard ${SEL && SEL.has(p.id) ? 'sel' : ''}" data-id="${p.id}">
      <div class="pimg"><img loading="lazy" src="${store.url(pagePath(d, p.t))}" style="filter:${pcss(p)}" alt="" /></div>
      <div class="pfoot"><span class="pno">${pad2(i + 1)}</span><span class="pmeta">${fmtDate(p.created || d.created)}, ${fmtSize(p.size)}</span>${SEL ? `<span class="chk">${SEL.has(p.id) ? I.check : ''}</span>` : ''}</div>
    </div>`).join('');
  $$('.pcard', box).forEach((el) => {
    let timer = null, sx = 0, sy = 0, long = false;
    el.addEventListener('pointerdown', (e) => {
      long = false; sx = e.clientX; sy = e.clientY;
      if (SEL) return;
      timer = setTimeout(() => { long = true; SEL = new Set([el.dataset.id]); if (navigator.vibrate) navigator.vibrate(20); renderDoc(); }, 480);
    });
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      if (long) return;
      if (SEL) {
        const id = el.dataset.id;
        if (SEL.has(id)) SEL.delete(id); else SEL.add(id);
        if (!SEL.size) SEL = null;
        return renderDoc();
      }
      openPage(d.pages.findIndex((p) => p.id === el.dataset.id));
    });
  });
  if (docSortable) { docSortable.destroy(); docSortable = null; }
  if (SEL) {
    // 选择模式下长按拖动可以排序
    docSortable = new Sortable(box, {
      animation: 160, delay: 300, delayOnTouchOnly: true, touchStartThreshold: 6,
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onEnd: async (e) => {
        if (e.oldIndex === e.newIndex) return;
        const order = $$('.pcard', box).map((el) => el.dataset.id);
        d.pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        await touch(d);
        renderDoc();
      },
    });
  }
}

const selPages = () => { const d = curDoc(); return d ? d.pages.filter((p) => SEL && SEL.has(p.id)) : []; };
function exitSel() { SEL = null; renderDoc(); }

async function selDelete() {
  const d = curDoc();
  const ps = selPages();
  if (!ps.length) return;
  if (ps.length === d.pages.length) {
    if (!(await confirmSheet(t('delLastPageQ'), t('delLastPageD'), t('del'), true))) return;
    SEL = null;
    await trashDoc(d);
    DOC = null; show('home'); renderHome();
    return;
  }
  if (!(await confirmSheet(t('delPagesQ', { n: ps.length }), '', t('del'), true))) return;
  d.pages = d.pages.filter((p) => !SEL.has(p.id));
  for (const p of ps) await removePageFiles(d, p);
  await touch(d);
  SEL = null;
  renderDoc();
  toast(t('deleted'));
}

async function selCopy() {
  const d = curDoc();
  const ps = selPages();
  busy(t('duplicating'));
  try {
    for (const p of ps) {
      const np = JSON.parse(JSON.stringify(p));
      np.id = uid();
      const map = {};
      for (const f of new Set([p.o, p.f, p.t])) {
        const nf = f.slice(0, 2) + uid() + '.jpg';
        map[f] = nf;
        await store.write(pagePath(d, nf), await store.read(pagePath(d, f)));
      }
      np.o = map[p.o]; np.f = map[p.f]; np.t = map[p.t];
      d.pages.splice(d.pages.indexOf(ps[ps.length - 1]) + 1 + ps.indexOf(p), 0, np);
    }
    await touch(d);
    toast(t('dupDone'));
  } catch (e) { toast(t('dupFail')); }
  busy(false);
  SEL = null;
  renderDoc();
}

$('#sel-all').addEventListener('click', () => {
  const d = curDoc();
  SEL = SEL && SEL.size === d.pages.length ? new Set() : new Set(d.pages.map((p) => p.id));
  if (!SEL.size) SEL = null;
  renderDoc();
});
$('#sel-del').addEventListener('click', selDelete);
$('#sel-copy').addEventListener('click', selCopy);
$('#sel-share').addEventListener('click', () => { const d = curDoc(); const ps = selPages(); if (ps.length) shareImages(d, ps); });
$('#sel-collage').addEventListener('click', () => { const ps = selPages(); if (ps.length) openCollage(ps); });

/* =========================================================
   拼图：几页合成一张 A4（IC 正反面用 ID Card 实际尺寸）
   ========================================================= */
const LAYOUTS = [
  { k: 'id', n: 'ID Card' },
  { k: '1x2', c: 1, r: 2 }, { k: '2x1', c: 2, r: 1 },
  { k: '1x3', c: 1, r: 3 }, { k: '3x1', c: 3, r: 1 },
  { k: '2x2', c: 2, r: 2 }, { k: '2x3', c: 2, r: 3 }, { k: '3x2', c: 3, r: 2 },
  { k: '3x3', c: 3, r: 3 }, { k: '3x4', c: 3, r: 4 }, { k: '4x3', c: 4, r: 3 },
];
let CL = null;

async function openCollage(pages) {
  const d = curDoc();
  busy(t('loading'));
  try {
    const imgs = [];
    for (const p of pages) {
      const bmp = await decode(await store.read(pagePath(d, p.f)));
      imgs.push({ bmp, css: pcss(p) });
    }
    const n = imgs.length;
    const def = n <= 2 ? 'id' : n === 3 ? '1x3' : n === 4 ? '2x2' : n <= 6 ? '2x3' : n <= 9 ? '3x3' : '3x4';
    CL = { imgs, layout: def, scale: 100 };
  } catch (e) { busy(false); return toast(t('readFail')); }
  busy(false);
  $('#cl-layouts').innerHTML = LAYOUTS.map((L) => {
    const icon = L.k === 'id'
      ? '<i class="lic id"><b></b><b></b></i>'
      : `<i class="lic" style="grid-template-columns:repeat(${L.c},1fr);grid-template-rows:repeat(${L.r},1fr)">${'<b></b>'.repeat(L.c * L.r)}</i>`;
    return `<button data-k="${L.k}">${icon}<span>${L.n || L.k.replace('x', ' x ')}</span></button>`;
  }).join('');
  $$('#cl-layouts button').forEach((b) => b.addEventListener('click', () => { CL.layout = b.dataset.k; clDraw(); }));
  $('#cl-scale').value = 100;
  show('collage');
  requestAnimationFrame(() => {
    clDraw();
    const on = $('#cl-layouts button.on');
    if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

/** 在 A4 画布上排好图片；返回放不下的数量 */
function drawCollage(ctx, W, H, imgs, layoutKey, scalePct) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const mm = W / 210;
  const sc = scalePct / 100;
  const L = LAYOUTS.find((x) => x.k === layoutKey) || LAYOUTS[0];
  const place = (img, x, y, w, h, fit) => {
    // fit=true：等比例放进框里；false：铺满框（ID Card 用）
    const iw = img.bmp.width, ih = img.bmp.height;
    let dw = w, dh = h;
    if (fit) { const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s; }
    ctx.save();
    if (img.css && img.css !== 'none') ctx.filter = img.css;
    ctx.drawImage(img.bmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  };
  if (L.k === 'id') {
    // 身份证真实尺寸 85.6 × 54 mm，上下排，整组置中
    const boxes = imgs.map((im) => {
      const portrait = im.bmp.height > im.bmp.width;
      return portrait ? [54 * mm * sc, 85.6 * mm * sc] : [85.6 * mm * sc, 54 * mm * sc];
    });
    const gap = 14 * mm * sc;
    let total = boxes.reduce((a, b) => a + b[1], 0) + gap * (boxes.length - 1);
    let k = 1;
    if (total > H - 20 * mm) { k = (H - 20 * mm) / total; total *= k; }
    let y = (H - total) / 2;
    imgs.forEach((im, i) => {
      const [bw, bh] = [boxes[i][0] * k, boxes[i][1] * k];
      const ar = im.bmp.width / im.bmp.height, br = bw / bh;
      // 比例接近卡片就铺满，差太多就等比例放
      place(im, (W - bw) / 2, y, bw, bh, Math.abs(ar - br) / br > 0.12);
      y += bh + gap * k;
    });
    return 0;
  }
  const M = 10 * mm, G = 5 * mm;
  const cw = (W - M * 2 - G * (L.c - 1)) / L.c;
  const ch = (H - M * 2 - G * (L.r - 1)) / L.r;
  const cells = L.c * L.r;
  imgs.slice(0, cells).forEach((im, i) => {
    const col = i % L.c, row = Math.floor(i / L.c);
    const w = cw * sc, h = ch * sc;
    place(im, M + col * (cw + G) + (cw - w) / 2, M + row * (ch + G) + (ch - h) / 2, w, h, true);
  });
  return Math.max(0, imgs.length - cells);
}

function clDraw() {
  if (!CL) return;
  $$('#cl-layouts button').forEach((b) => b.classList.toggle('on', b.dataset.k === CL.layout));
  $('#cl-sv').textContent = CL.scale + '%';
  const cv = $('#cl-canvas');
  const st = $('#cl-stage').getBoundingClientRect();
  const ratio = 297 / 210;
  let h = st.height - 20, w = h / ratio;
  if (w > st.width - 20) { w = st.width - 20; h = w * ratio; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const extra = drawCollage(cv.getContext('2d'), cv.width, cv.height, CL.imgs, CL.layout, CL.scale);
  $('#cl-note').textContent = extra ? t('collageExtra', { n: extra }) : CL.layout === 'id' && CL.scale === 100 ? t('idRealSize') : '';
}
$('#cl-scale').addEventListener('input', (e) => { CL.scale = +e.target.value; clDraw(); });
window.addEventListener('resize', () => { if (VIEW === 'collage') clDraw(); });

function closeCollage() {
  if (CL) CL.imgs.forEach((im) => freeBmp(im.bmp));
  CL = null;
  show('doc');
}
$('#cl-back').addEventListener('click', closeCollage);

async function collageApply() {
  const d = curDoc();
  busy(t('processing'));
  try {
    const cv = document.createElement('canvas');
    cv.width = 2480; cv.height = 3508; // A4 300dpi
    drawCollage(cv.getContext('2d'), cv.width, cv.height, CL.imgs, CL.layout, CL.scale);
    const blob = await cvBlob(cv, 0.92);
    freeCv(cv);
    busy(false);
    closeCollage();
    SEL = null;
    const nd = await newDocFrom([blob], { name: `${d.name} ${t('collage')}` });
    if (nd) { nd.pdfOpts.paper = 'a4'; await saveDB(); toast(t('collageDone'), 3500); }
  } catch (e) {
    busy(false);
    toast(t('saveFail') + (e.message || e));
  }
}
$('#cl-ok').addEventListener('click', collageApply);

function docBack() {
  if (SEL) return exitSel();
  const d = curDoc();
  DOC = null;
  if (SHARE_MODE) return finishShare();
  show('home');
  renderHome();
}

$('#doc-back').addEventListener('click', docBack);
$('#doc-title').addEventListener('click', () => { const d = curDoc(); if (d) renameDoc(d); });
$('#doc-add-gallery').addEventListener('click', () => addPages('gallery'));
$('#doc-add-scan').addEventListener('click', () => addPages('scan'));
$('#doc-pdf').addEventListener('click', () => { const d = curDoc(); if (d) pdfSheet(d); });
$('#doc-menu').addEventListener('click', () => { const d = curDoc(); if (d) docMenu(d, false); });
$('#doc-share').addEventListener('click', () => { const d = curDoc(); if (d) shareSheet(d); });
$('#doc-more').addEventListener('click', () => { const d = curDoc(); if (d) outputSheet(d); });

/* =========================================================
   单页：左右滑动看每一页
   ========================================================= */
function openPage(i) {
  const d = curDoc();
  if (!d || i < 0) return;
  PIDX = Math.min(i, d.pages.length - 1);
  renderSlides();
  show('page');
  requestAnimationFrame(() => {
    const s = $('#pg-slides');
    s.style.scrollBehavior = 'auto';
    s.scrollLeft = PIDX * s.clientWidth;
    s.style.scrollBehavior = '';
  });
}

function renderSlides() {
  const d = curDoc();
  $('#pg-slides').innerHTML = d.pages.map((p) => `<div class="slide"><img loading="lazy" src="${store.url(pagePath(d, p.f))}" style="filter:${pcss(p)}" alt="" /></div>`).join('');
  updatePageInd();
}
function updatePageInd() {
  const d = curDoc();
  if (!d) return;
  $('#pg-ind').textContent = `${PIDX + 1} / ${d.pages.length}`;
  $('#pg-title').textContent = d.name;
}
$('#pg-slides').addEventListener('scroll', () => {
  const s = $('#pg-slides');
  const i = Math.round(s.scrollLeft / Math.max(1, s.clientWidth));
  if (i !== PIDX) { PIDX = i; updatePageInd(); }
}, { passive: true });

function pageBack() { renderDoc(); show('doc'); }

async function rotatePage(deg) {
  const d = curDoc();
  const p = d.pages[PIDX];
  busy(t('rotating'));
  try {
    p.rot = (((p.rot || 0) + deg) % 360 + 360) % 360;
    p.quad = rotateQuad(p.quad, deg);
    await processPage(d, p);
    await touch(d);
  } catch (e) { toast(t('rotateFail')); }
  busy(false);
  renderSlides();
  runOcrQueue();
}

async function deletePage() {
  const d = curDoc();
  const p = d.pages[PIDX];
  if (d.pages.length === 1) {
    if (!(await confirmSheet(t('delLastPageQ'), t('delLastPageD'), t('del'), true))) return;
    await trashDoc(d);
    DOC = null;
    show('home');
    renderHome();
    return;
  }
  if (!(await confirmSheet(t('delPageQ', { n: PIDX + 1 }), '', t('del'), true))) return;
  d.pages.splice(PIDX, 1);
  await removePageFiles(d, p);
  await touch(d);
  PIDX = Math.min(PIDX, d.pages.length - 1);
  openPage(PIDX);
  toast(t('deleted'));
}

$('#pg-back').addEventListener('click', pageBack);
$('#pg-crop').addEventListener('click', () => openCrop(PIDX));
$('#pg-filter').addEventListener('click', () => openFilter(PIDX));
$('#pg-del').addEventListener('click', deletePage);
$('#pg-ocr').addEventListener('click', () => { const d = curDoc(); textSheet(d, d.pages[PIDX]); });
$('#pg-rotate').addEventListener('click', () => rotatePage(90));
$('#pg-share').addEventListener('click', () => { const d = curDoc(); shareImages(d, [d.pages[PIDX]]); });
$('#pg-more').addEventListener('click', async () => {
  const d = curDoc();
  const p = d.pages[PIDX];
  const v = await actionSheet(t('pageN', { n: PIDX + 1 }), [
    { icon: I.image, label: t('saveGallery'), value: 'gal' },
    { icon: I.rotL, label: t('rotateLeft'), value: 'rl' },
    { icon: I.trash, label: t('delPage'), value: 'del', danger: true },
  ]);
  if (v === 'gal') saveToGallery(d, [p]);
  else if (v === 'rl') rotatePage(-90);
  else if (v === 'del') deletePage();
});

/* =========================================================
   边界调整：拖四个角拉正
   ========================================================= */
let CR = null;

async function openCrop(i) {
  const d = curDoc();
  const p = d.pages[i];
  busy(t('loading'));
  try {
    const bmp = await decode(await store.read(pagePath(d, p.o)));
    CR = { i, rot: p.rot || 0, q: (p.quad || FULL_QUAD).map((pt) => [...pt]), bmp, url: null };
    await cropPreview();
    show('crop');
    requestAnimationFrame(drawCrop);
  } catch (e) { toast(t('readFail')); }
  busy(false);
}

async function cropPreview() {
  const cv = toCanvas(CR.bmp, { max: 1600, rotate: CR.rot });
  CR.pw = cv.width; CR.ph = cv.height;
  const blob = await cvBlob(cv, 0.85);
  freeCv(cv);
  if (CR.url) URL.revokeObjectURL(CR.url);
  CR.url = URL.createObjectURL(blob);
  const img = $('#cr-img');
  img.src = CR.url;
  await img.decode().catch(() => {});
}

/** 图片在画面里的位置 */
function cropRect() {
  const st = $('#cr-stage').getBoundingClientRect();
  const pad = 22;
  const s = Math.min((st.width - pad * 2) / CR.pw, (st.height - pad * 2) / CR.ph);
  const w = CR.pw * s, h = CR.ph * s;
  return { x: (st.width - w) / 2, y: (st.height - h) / 2, w, h, st };
}

function drawCrop() {
  if (!CR) return;
  const r = cropRect();
  const img = $('#cr-img');
  Object.assign(img.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  const P = CR.q.map(([x, y]) => [r.x + x * r.w, r.y + y * r.h]);
  const poly = P.map((p) => p.join(',')).join(' ');
  const mids = P.map((p, k) => { const n = P[(k + 1) % 4]; return [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]; });
  const W = r.st.width, H = r.st.height;
  $('#cr-svg').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('#cr-svg').innerHTML = `
    <path d="M0 0H${W}V${H}H0Z M${P.map((p) => p.join(' ')).join(' L')} Z" fill="rgba(0,0,0,.45)" fill-rule="evenodd"/>
    <polygon points="${poly}" fill="none" stroke="#22D35B" stroke-width="2.5"/>
    ${mids.map((m, k) => `<rect class="hd" data-e="${k}" x="${m[0] - 9}" y="${m[1] - 9}" width="18" height="18" rx="3" fill="#22D35B"/>`).join('')}
    ${P.map((p, k) => `<circle class="hd" data-c="${k}" cx="${p[0]}" cy="${p[1]}" r="12" fill="rgba(34,211,91,.35)" stroke="#22D35B" stroke-width="3"/>`).join('')}`;
}

(function cropDrag() {
  const svg = $('#cr-svg');
  let drag = null;
  const pos = (e) => {
    const r = cropRect();
    const b = svg.getBoundingClientRect();
    return [(e.clientX - b.left - r.x) / r.w, (e.clientY - b.top - r.y) / r.h];
  };
  const clamp = (v) => Math.max(0, Math.min(1, v));
  svg.addEventListener('pointerdown', (e) => {
    if (!CR) return;
    const r = cropRect();
    const b = svg.getBoundingClientRect();
    const px = e.clientX - b.left, py = e.clientY - b.top;
    // 找最近的角或边（手指大，范围放宽）
    let best = null, bd = 44;
    CR.q.forEach(([x, y], k) => {
      const dd = Math.hypot(r.x + x * r.w - px, r.y + y * r.h - py);
      if (dd < bd) { bd = dd; best = { c: k }; }
    });
    if (!best) {
      CR.q.forEach((p, k) => {
        const n = CR.q[(k + 1) % 4];
        const dd = Math.hypot(r.x + ((p[0] + n[0]) / 2) * r.w - px, r.y + ((p[1] + n[1]) / 2) * r.h - py);
        if (dd < bd) { bd = dd; best = { e: k }; }
      });
    }
    if (!best) return;
    drag = { ...best, last: pos(e) };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = pos(e);
    if (drag.c != null) {
      CR.q[drag.c] = [clamp(x), clamp(y)];
    } else {
      const dx = x - drag.last[0], dy = y - drag.last[1];
      const a = drag.e, b = (drag.e + 1) % 4;
      for (const k of [a, b]) CR.q[k] = [clamp(CR.q[k][0] + dx), clamp(CR.q[k][1] + dy)];
    }
    drag.last = [x, y];
    drawCrop();
  });
  const end = () => { drag = null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
})();

async function cropRotate(deg) {
  CR.rot = (((CR.rot + deg) % 360) + 360) % 360;
  CR.q = rotateQuad(CR.q, deg);
  await cropPreview();
  drawCrop();
}

function closeCrop() {
  if (CR) { freeBmp(CR.bmp); if (CR.url) URL.revokeObjectURL(CR.url); }
  CR = null;
  renderSlides();
  show('page');
  requestAnimationFrame(() => { const s = $('#pg-slides'); s.style.scrollBehavior = 'auto'; s.scrollLeft = PIDX * s.clientWidth; s.style.scrollBehavior = ''; });
}

async function cropApply() {
  const d = curDoc();
  const p = d.pages[CR.i];
  // 角的顺序乱了（交叉）就按位置重新排
  const q = CR.q.map((pt) => [...pt]);
  const cx = q.reduce((a, v) => a + v[0], 0) / 4, cy = q.reduce((a, v) => a + v[1], 0) / 4;
  q.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let s = 0;
  q.forEach((v, k) => { if (v[0] + v[1] < q[s][0] + q[s][1]) s = k; });
  const ordered = [0, 1, 2, 3].map((k) => q[(s + k) % 4]);
  busy(t('processing'));
  try {
    p.rot = CR.rot;
    p.quad = isFullQuad(ordered) ? null : ordered;
    await processPage(d, p);
    await touch(d);
  } catch (e) { toast(t('saveFail') + (e.message || e)); }
  busy(false);
  closeCrop();
  runOcrQueue();
}

$('#cr-back').addEventListener('click', closeCrop);
$('#cr-full').addEventListener('click', () => { CR.q = FULL_QUAD.map((p) => [...p]); drawCrop(); });
$('#cr-rl').addEventListener('click', () => cropRotate(-90));
$('#cr-rr').addEventListener('click', () => cropRotate(90));
$('#cr-ok').addEventListener('click', cropApply);
window.addEventListener('resize', () => { if (VIEW === 'crop') drawCrop(); });

/* =========================================================
   滤镜：原图 / 照片 / 文档 / 明亮 / 黑白 + 亮度、对比度
   ========================================================= */
let FL = null;

function openFilter(i) {
  const d = curDoc();
  const p = d.pages[i];
  FL = { i, filter: OLD_FILTER[p.filter] || p.filter || 'none', b: p.b || 0, c: p.c || 0, rot: 0 };
  $('#fl-img').src = store.url(pagePath(d, p.f));
  const turl = store.url(pagePath(d, p.t));
  $('#fl-tabs').innerHTML = FILTERS.map((f) => `<button data-k="${f.k}"><img src="${turl}" style="filter:${pcss({ filter: f.k })}" alt="" /><span>${esc(t(f.n))}</span></button>`).join('');
  $$('#fl-tabs button').forEach((b) => b.addEventListener('click', () => { FL.filter = b.dataset.k; flUpdate(); }));
  $('#fl-b').value = FL.b;
  $('#fl-c').value = FL.c;
  flUpdate();
  show('filter');
}
function flUpdate() {
  $$('#fl-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === FL.filter));
  const img = $('#fl-img');
  img.style.filter = pcss(FL);
  img.style.transform = FL.rot ? `rotate(${FL.rot}deg)` : '';
  $('#fl-bv').textContent = FL.b > 0 ? '+' + FL.b : FL.b;
  $('#fl-cv').textContent = FL.c > 0 ? '+' + FL.c : FL.c;
}
$('#fl-b').addEventListener('input', (e) => { FL.b = +e.target.value; flUpdate(); });
$('#fl-c').addEventListener('input', (e) => { FL.c = +e.target.value; flUpdate(); });
$('#fl-rl').addEventListener('click', () => { FL.rot -= 90; flUpdate(); });
$('#fl-rr').addEventListener('click', () => { FL.rot += 90; flUpdate(); });
$('#fl-reset').addEventListener('click', () => { FL.b = 0; FL.c = 0; $('#fl-b').value = 0; $('#fl-c').value = 0; flUpdate(); });
$('#fl-back').addEventListener('click', () => { FL = null; closeCrop(); });

async function filterApply(all) {
  const d = curDoc();
  const targets = all ? d.pages : [d.pages[FL.i]];
  for (const p of targets) { p.filter = FL.filter; p.b = FL.b; p.c = FL.c; }
  const p = d.pages[FL.i];
  const deg = ((FL.rot % 360) + 360) % 360;
  if (deg) {
    busy(t('processing'));
    try {
      p.rot = ((p.rot || 0) + deg) % 360;
      p.quad = rotateQuad(p.quad, deg);
      await processPage(d, p);
    } catch (e) { toast(t('rotateFail')); }
    busy(false);
  }
  await touch(d);
  FL = null;
  if (all) toast(t('appliedAll'));
  closeCrop();
  runOcrQueue();
}
$('#fl-ok').addEventListener('click', () => filterApply(false));
$('#fl-all').addEventListener('click', () => filterApply(true));

/* =========================================================
   PDF / 导出
   ========================================================= */
async function buildPdf(d, onProgress) {
  const { PDFDocument } = PDFLib;
  const o = d.pdfOpts || {};
  const Q = QUALITY[o.quality] || QUALITY.std;
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.name);
  pdf.setCreator('YourScanner');
  pdf.setProducer('YourScanner');
  for (let i = 0; i < d.pages.length; i++) {
    if (onProgress) onProgress(i + 1, d.pages.length);
    const pg = d.pages[i];
    const raw = await store.read(pagePath(d, pg.f));
    let img = null, w, h;
    // 没滤镜、没水印、画质选清晰：原图直接放进 PDF，不再重新压缩（快很多）
    if (pcss(pg) === 'none' && !(o.wm || '').trim() && o.quality === 'hd') {
      try { img = await pdf.embedJpg(new Uint8Array(await raw.arrayBuffer())); w = img.width; h = img.height; } catch (e) { img = null; }
    }
    if (!img) {
      const bmp = await decode(raw);
      const cv = toCanvas(bmp, { max: Q.max, css: pcss(pg), wm: (o.wm || '').trim() });
      freeBmp(bmp);
      w = cv.width; h = cv.height;
      const blob = await cvBlob(cv, Q.q);
      freeCv(cv);
      img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    }
    let pw, ph;
    if (o.paper === 'auto') { pw = A4[0]; ph = (A4[0] * h) / w; }
    else [pw, ph] = w > h ? [A4[1], A4[0]] : A4;
    const page = pdf.addPage([pw, ph]);
    const s = Math.min(pw / w, ph / h);
    page.drawImage(img, { x: (pw - w * s) / 2, y: (ph - h * s) / 2, width: w * s, height: h * s });
    await sleep(0);
  }
  return pdf.save();
}

let pdfJob = null;
/** 需要时才生成 PDF（改过才重做） */
async function ensurePdf(d, quiet) {
  if (d.pdf && !d.pdfDirty) return;
  if (pdfJob && pdfJob.id === d.id) { await pdfJob.p; if (!d.pdfDirty) return; }
  const run = async () => {
    const bytes = await buildPdf(d, quiet ? null : (i, n) => busy(t('makingPdf', { i, n })));
    const name = safeName(d.name) + '.pdf';
    await store.write(pagePath(d, name), new Blob([bytes], { type: 'application/pdf' }));
    if (d.pdf && d.pdf !== name) await store.del(pagePath(d, d.pdf));
    d.pdf = name;
    d.pdfSize = bytes.length;
    d.pdfDirty = false;
    await saveDB();
  };
  pdfJob = { id: d.id, p: run() };
  try { await pdfJob.p; } finally { pdfJob = null; if (!quiet) busy(false); }
}

/** PDF 设置：纸张、画质、水印，显示文件大小 */
async function pdfSheet(d) {
  try { await ensurePdf(d); } catch (e) { busy(false); return toast(t('saveFail') + (e.message || e)); }
  const o = d.pdfOpts;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([k, n]) => `<button data-k="${k}" class="${k === cur ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`;
  const v = await openSheet(`
    <h3>${esc(d.pdf)}</h3>
    <p class="desc" id="ps-size">${esc(t('pdfInfo', { n: d.pages.length, size: fmtSize(d.pdfSize) }))}</p>
    <div class="opt-label">${esc(t('paper'))}</div>${seg('ps-paper', Object.entries(PAPER).map(([k, n]) => [k, t(n)]), o.paper)}
    <div class="opt-label">${esc(t('quality'))}</div>${seg('ps-q', Object.entries(QUALITY).map(([k, q]) => [k, t(q.n)]), o.quality)}
    <div class="opt-label">${esc(t('watermark'))}</div>
    <input type="text" id="ps-wm" value="${esc(o.wm || '')}" placeholder="${esc(t('wmPh'))}" />
    <div class="tools four">
      <button data-a="share">${I.share}<span>${esc(t('share'))}</span></button>
      <button data-a="mail">${I.mail}<span>${esc(t('email'))}</span></button>
      <button data-a="print">${I.print}<span>${esc(t('print'))}</span></button>
      <button data-a="save">${I.save}<span>${esc(t('saveDevice'))}</span></button>
    </div>`, (sh) => {
    const rebuild = async () => {
      d.pdfDirty = true;
      await saveDB();
      try { await ensurePdf(d); } catch (e) { busy(false); }
      $('#ps-size', sh).textContent = t('pdfInfo', { n: d.pages.length, size: fmtSize(d.pdfSize) });
    };
    const bindSeg = (id, key) => $$(`#${id} button`, sh).forEach((b) => b.addEventListener('click', async () => {
      $$(`#${id} button`, sh).forEach((x) => x.classList.toggle('on', x === b));
      if (o[key] === b.dataset.k) return;
      o[key] = b.dataset.k;
      DB.settings[key] = b.dataset.k;
      await rebuild();
    }));
    bindSeg('ps-paper', 'paper');
    bindSeg('ps-q', 'quality');
    $('#ps-wm', sh).addEventListener('change', async (e) => { o.wm = e.target.value.trim(); await rebuild(); });
    $$('.tools button', sh).forEach((b) => b.addEventListener('click', () => {
      const wm = $('#ps-wm', sh).value.trim();
      closeSheet({ a: b.dataset.a, wm });
    }));
  });
  if (!v) return;
  if ((v.wm || '') !== (o.wm || '')) { o.wm = v.wm; d.pdfDirty = true; await saveDB(); }
  if (v.a === 'share') sharePdf(d);
  else if (v.a === 'mail') emailPdf(d);
  else if (v.a === 'print') printPdf(d);
  else if (v.a === 'save') savePdfToDevice(d);
}

const isCancel = (e) => /cancel/i.test((e && (e.message || e.errorMessage)) || '');

async function sharePdf(d) {
  try {
    await ensurePdf(d);
    if (!NATIVE) return webDownload(store.url(pagePath(d, d.pdf)), d.pdf);
    await store.clearShare();
    const uri = await store.copyToShare(pagePath(d, d.pdf), d.pdf);
    await ShareP.share({ title: d.name, files: [uri], dialogTitle: t('sharePdf') });
  } catch (e) {
    busy(false);
    if (!isCancel(e)) toast(t('shareFail') + (e.message || e), 4000);
  }
}

function webDownload(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
}

/** 导出处理好的页面图片（带滤镜） */
async function renderPagesToFiles(d, pages) {
  await store.clearShare();
  const base = safeName(d.name);
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    busy(t('preparingImg', { i: i + 1, n: pages.length }));
    const p = pages[i];
    const bmp = await decode(await store.read(pagePath(d, p.f)));
    const cv = toCanvas(bmp, { max: STORE_MAX, css: pcss(p), wm: ((d.pdfOpts && d.pdfOpts.wm) || '').trim() });
    freeBmp(bmp);
    const blob = await cvBlob(cv, 0.9);
    freeCv(cv);
    const idx = d.pages.indexOf(p) + 1;
    const name = d.pages.length > 1 ? `${base}_${pad2(idx)}.jpg` : `${base}.jpg`;
    out.push(NATIVE ? { name, uri: await store.blobToShare(name, blob) } : { name, url: URL.createObjectURL(blob) });
  }
  busy(false);
  return out;
}

async function shareImages(d, pages) {
  try {
    const files = await renderPagesToFiles(d, pages || d.pages);
    if (!NATIVE) return files.forEach((f) => webDownload(f.url, f.name));
    await ShareP.share({ title: d.name, files: files.map((f) => f.uri), dialogTitle: t('shareImg') });
  } catch (e) {
    busy(false);
    if (!isCancel(e)) toast(t('shareFail') + (e.message || e), 4000);
  }
}

async function saveToGallery(d, pages) {
  try {
    const files = await renderPagesToFiles(d, pages || d.pages);
    if (!NATIVE) return files.forEach((f) => webDownload(f.url, f.name));
    busy(t('saving'));
    for (const f of files) await YsNative.saveToGallery({ path: f.uri, name: f.name, mime: 'image/jpeg' });
    busy(false);
    toast(t('savedGallery', { n: files.length }), 3000);
  } catch (e) {
    busy(false);
    toast(t('saveFail') + (e.message || e), 4000);
  }
}

async function savePdfToDevice(d) {
  try {
    await ensurePdf(d);
    if (!NATIVE) return webDownload(store.url(pagePath(d, d.pdf)), d.pdf);
    await YsNative.saveToDownloads({ path: store.uri(pagePath(d, d.pdf)), name: d.pdf, mime: 'application/pdf' });
    toast(t('savedDevice', { name: d.pdf }), 3500);
  } catch (e) {
    busy(false);
    toast(t('saveFail') + (e.message || e), 4000);
  }
}

async function printPdf(d) {
  try {
    await ensurePdf(d);
    if (!NATIVE) return toast(t('phoneOnly'));
    await YsNative.print({ path: store.uri(pagePath(d, d.pdf)), name: d.pdf });
  } catch (e) {
    busy(false);
    toast(t('printFail') + (e.message || e), 4000);
  }
}

async function emailPdf(d) {
  try {
    await ensurePdf(d);
    if (!NATIVE) return webDownload(store.url(pagePath(d, d.pdf)), d.pdf);
    await store.clearShare();
    const uri = await store.copyToShare(pagePath(d, d.pdf), d.pdf);
    try {
      await YsNative.email({ path: uri, subject: d.name, title: t('email') });
    } catch (e) {
      await ShareP.share({ title: d.name, files: [uri], dialogTitle: t('email') });
    }
  } catch (e) {
    busy(false);
    if (!isCancel(e)) toast(t('shareFail') + (e.message || e), 4000);
  }
}

/** 底部「分享」 */
async function shareSheet(d) {
  const v = await actionSheet(t('share'), [
    { icon: I.docs, label: t('sharePdf'), right: d.pdf && !d.pdfDirty ? fmtSize(d.pdfSize) : null, value: 'pdf' },
    { icon: I.image, label: t('shareImg'), right: t('nPages', { n: d.pages.length }), value: 'img' },
  ]);
  if (v === 'pdf') sharePdf(d);
  else if (v === 'img') shareImages(d);
}

/** 底部「更多」 */
async function outputSheet(d) {
  const v = await actionSheet(null, [
    { icon: I.mail, label: t('email'), value: 'mail' },
    { icon: I.print, label: t('print'), value: 'print' },
    { icon: I.image, label: t('saveGallery'), value: 'gal' },
    { icon: I.save, label: t('saveDevice'), value: 'dev' },
    { icon: I.text, label: t('txTitle'), value: 'text' },
  ]);
  if (v === 'mail') emailPdf(d);
  else if (v === 'print') printPdf(d);
  else if (v === 'gal') saveToGallery(d);
  else if (v === 'dev') savePdfToDevice(d);
  else if (v === 'text') textSheet(d);
}

/* =========================================================
   文件菜单：重命名 / 移动 / 复制 / 删除
   ========================================================= */
async function renameDoc(d) {
  const n = await promptSheet(t('rename'), d.name);
  if (!n || n === d.name) return false;
  d.name = n;
  if (d.pdf) {
    const pdf = safeName(n) + '.pdf';
    if (pdf !== d.pdf) {
      try { await store.move(pagePath(d, d.pdf), pagePath(d, pdf)); d.pdf = pdf; } catch (e) { d.pdfDirty = true; }
    }
  }
  d.updated = Date.now();
  await saveDB();
  if (VIEW === 'doc') renderDoc(); else renderHome();
  return true;
}

async function docMenu(d, fromHome) {
  const after = () => (fromHome ? renderHome() : renderDoc());
  const v = await actionSheet(d.name, [
    ...(fromHome ? [{ icon: I.share, label: t('sharePdf'), value: 'share' }, { icon: I.image, label: t('shareImg'), value: 'shareimg' }] : []),
    { icon: I.edit, label: t('rename'), value: 'rename' },
    { icon: I.folder, label: t('moveTo'), right: d.folder || t('uncat'), value: 'move' },
    { icon: I.dup, label: t('duplicate'), value: 'dup' },
    ...(fromHome ? [] : [{ icon: I.text, label: t('txTitle'), value: 'text' }]),
    { icon: I.trash, label: t('del'), value: 'del', danger: true },
  ]);
  if (v === 'share') return sharePdf(d);
  if (v === 'shareimg') return shareImages(d);
  if (v === 'text') return textSheet(d);
  if (v === 'rename') return renameDoc(d);
  if (v === 'move') {
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
    return after();
  }
  if (v === 'dup') {
    busy(t('duplicating'));
    try {
      const nid = uid();
      for (const f of docFiles(d)) await store.write(`docs/${nid}/${f}`, await store.read(pagePath(d, f)));
      const nd = JSON.parse(JSON.stringify(d));
      Object.assign(nd, { id: nid, name: d.name + ' ' + t('copySuffix'), created: Date.now(), updated: Date.now(), pdfDirty: true });
      if (nd.pdf) { await store.del(`docs/${nid}/${nd.pdf}`); nd.pdf = null; }
      DB.docs.push(nd);
      await saveDB();
      busy(false);
      toast(t('dupDone'));
      return fromHome ? renderHome() : openDoc(nid);
    } catch (e) { busy(false); toast(t('dupFail')); }
    return;
  }
  if (v === 'del') {
    await trashDoc(d);
    if (fromHome) renderHome();
    else { DOC = null; show('home'); renderHome(); }
  }
}

/* ---------- 识别出的文字 ---------- */
async function textSheet(d, page) {
  const pages = page ? [page] : d.pages;
  const text = page ? page.text || '' : docText(d);
  const pending = pages.some((p) => p.ocr === 'pending');
  const desc = !NATIVE ? t('txWeb') : pending ? t('txPending') : !text.trim() ? t('txNone') : t('txHint');
  const v = await openSheet(`
    <h3>${esc(page ? t('pageText', { n: d.pages.indexOf(page) + 1 }) : t('txTitle'))}</h3><p class="desc">${esc(desc)}</p>
    <textarea readonly id="tx">${esc(text)}</textarea>
    <div class="btns"><button id="tx-re">${esc(t('reOcr'))}</button><button class="primary" id="tx-copy">${esc(t('copyAll'))}</button></div>`, (sh) => {
    $('#tx-copy', sh).onclick = () => closeSheet('copy');
    $('#tx-re', sh).onclick = () => closeSheet('re');
  });
  if (v === 'copy') {
    if (!text.trim()) return toast(t('noTextCopy'));
    toast((await copyText(text)) ? t('copied') : t('copyFail'));
  } else if (v === 're') {
    if (!NATIVE) return toast(t('ocrPhoneOnly'));
    pages.forEach((p) => { p.ocr = 'pending'; });
    await saveDB();
    toast(t('ocrPending'));
    runOcrQueue(true);
  }
}

async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove();
    return ok;
  }
}

/* =========================================================
   离线文字识别（后台一页一页做）
   ========================================================= */
let ocrRunning = false;
async function runOcrQueue(notify) {
  if (!NATIVE || !Ocr || ocrRunning) return;
  ocrRunning = true;
  let did = 0;
  try {
    for (;;) {
      let job = null;
      for (const d of DB.docs) {
        if (d.trashed) continue;
        const p = d.pages.find((x) => x.ocr === 'pending');
        if (p) { job = { d, p }; break; }
      }
      if (!job) break;
      const { d, p } = job;
      const f = p.f;
      try {
        const r = await Ocr.recognize({ path: store.uri(pagePath(d, f)) });
        if (p.f === f) { p.text = (r && r.text) || ''; p.ocr = 'done'; }
      } catch (e) {
        if (e && (e.code === 'UNIMPLEMENTED' || /not implemented/i.test(e.message || ''))) return;
        if (p.f === f) p.ocr = 'error';
      }
      did++;
      await saveDB();
    }
    if (did && notify) toast(t('ocrDoneToast'));
    if (did && VIEW === 'home' && query) renderHome();
  } finally {
    ocrRunning = false;
  }
}
