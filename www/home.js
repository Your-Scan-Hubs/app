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
  let h = `<div class="dr-head"><div class="dr-brand"><img class="lg-l" src="img/logo-light.png" alt="" /><img class="lg-d" src="img/logo-dark.png" alt="" /><div class="dr-logo">YourScan</div></div><div class="dr-ver">${esc(t('version'))} ${esc(APP_VER || '1.0')}</div></div>`;
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
  if (k === 'about') return actionSheet('YourScan', [{ label: t('gotIt'), value: 'ok' }], `${t('version')} ${APP_VER || '1.0'} · ${t('aboutText')}`, '<div class="about-logo"><img class="lg-l" src="img/logo-light.png" alt="" /><img class="lg-d" src="img/logo-dark.png" alt="" /></div>');
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
  const text = docText(d);
  const hay = (d.name + '\n' + text).toLowerCase();
  const hayNs = hay.replace(/\s+/g, '');
  for (const t of toks) if (!hay.includes(t) && !hayNs.includes(t)) return { ok: false };
  // 找文字里的命中片段
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
      <div class="th">${d.pages[0] ? `<img loading="lazy" src="${store.url(`docs/${d.id}/${d.pages[0].t}`)}" style="filter:${pcss(d.pages[0])}" alt="" />` : ''}</div>
      <div class="info">
        <div class="nm">${esc(d.name)}</div>
        <div class="sub">${fmtSize(docSize(d))}<span class="pc">${d.pages.length}</span>${curFolder === '__all' && d.folder ? `<span class="tag">${esc(d.folder)}</span>` : ''}</div>
        <div class="sub">${fmtDate(inTrash ? d.trashed : d.updated)}</div>
        ${m.hit ? `<div class="hit">${m.hit}</div>` : ''}
      </div>
      <button class="icon-btn dots" aria-label="more"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
    </div>`).join('');
  $$('#doc-list .doc').forEach((row) => {
    const d = docById(row.dataset.id);
    row.addEventListener('click', () => (inTrash ? trashRowMenu(d) : openDoc(d.id)));
    $('.dots', row).addEventListener('click', (e) => {
      e.stopPropagation();
      if (inTrash) trashRowMenu(d); else docMenu(d, true);
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

const docFiles = (d) => [...new Set([...d.pages.flatMap((p) => [p.o, p.f, p.t]), d.pdf].filter(Boolean))];

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
  const total = live().reduce((a, d) => a + docSize(d), 0);
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
  else if (VIEW === 'doc' && DOC) renderDoc();
}
$('#btn-settings').addEventListener('click', () => (curFolder === '__trash' ? trashTopMenu() : settingsSheet()));

