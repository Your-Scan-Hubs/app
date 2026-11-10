'use strict';
/* =========================================================
   入口按钮 / 返回键 / 分享进来 / 启动
   ========================================================= */
$('#btn-scan').addEventListener('click', async () => newDocFrom(await getScan()));
$('#btn-gallery').addEventListener('click', newDocFromGallery);

function finishShare() {
  if (SendIntent) SendIntent.finish();
}

let shareBusy = false;
/** 别的 app 分享进来的文件：在主程序里直接建新文件 */
async function checkShareIntent() {
  if (!SendIntent || shareBusy) return;
  let r;
  try { r = await SendIntent.checkSendIntentReceived(); } catch (e) { return; }
  if (!r || !r.url) return;
  shareBusy = true;
  try {
    if (YsNative) { try { await YsNative.clearIntent(); } catch (e) {} }
    const items = [r, ...(r.additionalItems || [])].filter((x) => x && x.url);
    if (!items.length) return;
    closeSheet(null);
    closeDrawer();
    const files = [];
    for (const it of items) {
      const u = decodeURIComponent(it.url);
      // 用真正的文件名（例如 BersihMax_A4.pdf），不用聊天附带的标题
      const fileName = (u.split('/').pop() || '').trim();
      const name = /\.[a-z0-9]{2,5}$/i.test(fileName) ? fileName : (it.title || fileName || '').trim();
      files.push({ path: u, name, type: it.type && !it.type.includes('*') ? it.type : '' });
    }
    if (!files.length) { toast(t('readImgsFail')); return; }
    busy(false);
    await newDocFrom(files, { ask: files.every((f) => isImage({ type: f.type }, f.name)) });
    for (const f of files) { try { await FS.deleteFile({ path: f.path }); } catch (e) {} }
  } finally {
    busy(false);
    shareBusy = false;
  }
}
window.addEventListener('ysShare', checkShareIntent);

function goBack() {
  if (!$('#busy').hidden) return;
  if (sheetOpen()) return closeSheet(null);
  if (drawerOpen()) return closeDrawer();
  if (VIEW === 'crop' || VIEW === 'filter') { FL = null; return closeCrop(); }
  if (VIEW === 'collage') return closeCollage();
  if (VIEW === 'page') return pageBack();
  if (VIEW === 'doc') return docBack();
  if (SHARE_MODE) return finishShare();
  if (HSEL) return exitHomeSel();
  if (!$('#search-bar').hidden) return openSearch(false);
  if (curFolder !== '__all') { curFolder = '__all'; return renderHome(); }
  (AppP.minimizeApp ? AppP.minimizeApp() : AppP.exitApp()).catch(() => AppP.exitApp());
}

if (AppP) {
  AppP.addListener('backButton', goBack);
  AppP.addListener('resume', () => runOcrQueue());
}

(async function boot() {
  setLang('en');
  try {
    await store.init();
    await loadDB();
    // 英文优先：旧设定“跟随手机”改成英文（之后可以在右上角切换）
    if (!DB.settings.langSet) { DB.settings.lang = DB.settings.lang && DB.settings.lang !== 'auto' && DB.settings.lang !== 'zh' ? DB.settings.lang : 'en'; DB.settings.langSet = 1; await saveDB(); }
    if (migrate()) await saveDB();
    applyTheme();
  } catch (e) {
    toast(t('loadFail') + (e.message || e), 5000);
  }
  if (AppP) { try { APP_VER = (await AppP.getInfo()).version; } catch (e) {} }
  await autoPurge();
  applyLang();
  await checkShareIntent();
  runOcrQueue();
})();
