# YourScanner

给办公室同事用的文件扫描 app（Android），无广告。

- **拍照扫描**：Google ML Kit 文档扫描器，自动框边、拉正、滤镜，多页连拍
- **相册合成 PDF**：一次选多张照片，拖动排序、旋转、滤镜，合成一个 PDF
- **分享进来**：在相册 / WhatsApp 里选图片 → 分享 → YourScanner
- **文字识别**：离线 OCR（中文 / 英文 / 马来文），可以按文件里的文字搜索
- **文件夹、重命名、复制、分享 PDF / 图片**
- 文件只保存在手机里，不上传

## 下载
推送到 `main` 后 GitHub Actions 自动打包，在 Releases → `android-latest` 下载 `YourScanner.apk`。
签名固定，新版本可以直接覆盖安装。

## 结构
- `www/` 界面（index.html / style.css / app.js，`vendor/` 里是 Capacitor、pdf-lib、SortableJS）
- `native/android/` 原生代码（OCR 插件、MainActivity、测试签名）
- `.github/workflows/android.yml` 打包流程
