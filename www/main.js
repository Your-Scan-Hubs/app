'use strict';
/* =========================================================
   入口按钮 / 返回键 / 分享进来 / 启动
   ========================================================= */
$('#btn-scan').addEventListener('click', async () => newDocFrom(await getScan()));
$('#btn-gallery').addEventListener('click', async () => newDocFrom(await pickImages(), { ask: true }));

function finishShare() {
  if (SendIntent) SendIntent.finish();
}

async function checkShareIntent() {
  if (!SendIntent) return;
  let r;
  try { r = await SendIntent.checkSendIntentReceived(); } catch (e) { return; }
  if (!r || !r.url) return;
  const items = [r, ...(r.additionalItems || [])].filter((x) => x && x.url);
  if (!items.length) return;
  SHARE_MODE = true;
  busy(t('readingImgs'));
  const files = [];
  for (const it of items) {
    const u = decodeURIComponent(it.url);
    try {
      const blob = await fetchUri(u);
      const name = (it.title || u.split('/').pop() || '').trim();
      files.push({ blob: it.type && it.type !== blob.type && it.type.includes('/') && !it.type.includes('*') ? new Blob([blob], { type: it.type }) : blob, name });
    } catch (e) {}
    try { await FS.deleteFile({ path: u }); } catch (e) {}
  }
  const onlyImages = files.every((f) => isImage(f.blob, f.name));
  const { blobs, pdfName } = await expandFiles(files);
  busy(false);
  if (!blobs.length) { if (!files.length) toast(t('readImgsFail')); setTimeout(finishShare, 3500); return; }
  await newDocFrom(blobs, { ask: onlyImages, name: onlyImages ? null : pdfName });
}

function goBack() {
  if (!$('#busy').hidden) return;
  if (sheetOpen()) return closeSheet(null);
  if (drawerOpen()) return closeDrawer();
  if (VIEW === 'crop' || VIEW === 'filter') { FL = null; return closeCrop(); }
  if (VIEW === 'page') return pageBack();
  if (VIEW === 'doc') return docBack();
  if (SHARE_MODE) return finishShare();
  if (!$('#search-bar').hidden) return openSearch(false);
  if (curFolder !== '__all') { curFolder = '__all'; return renderHome(); }
  (AppP.minimizeApp ? AppP.minimizeApp() : AppP.exitApp()).catch(() => AppP.exitApp());
}

if (AppP) {
  AppP.addListener('backButton', goBack);
  AppP.addListener('resume', () => runOcrQueue());
}

(async function boot() {
  setLang(null);
  try {
    await store.init();
    await loadDB();
    if (migrate()) await saveDB();
  } catch (e) {
    toast(t('loadFail') + (e.message || e), 5000);
  }
  if (AppP) { try { APP_VER = (await AppP.getInfo()).version; } catch (e) {} }
  await autoPurge();
  applyLang();
  await checkShareIntent();
  runOcrQueue();
})();
