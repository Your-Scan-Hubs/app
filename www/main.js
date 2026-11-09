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
  await newDocFrom(blobs, { ask: true });
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
