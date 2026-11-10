package com.yourscanhubs.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import com.getcapacitor.JSArray;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 保存到相册 / 保存到“下载” / 打印 PDF / 发送邮件
 */
@CapacitorPlugin(name = "YsNative")
public class YsNativePlugin extends Plugin {

    private static File fileFrom(String path) {
        if (path == null || path.isEmpty()) return null;
        if (path.startsWith("file://")) return new File(Uri.parse(path).getPath());
        return new File(path);
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        saveMedia(call, true);
    }

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        saveMedia(call, false);
    }

    private void saveMedia(PluginCall call, boolean image) {
        File src = fileFrom(call.getString("path"));
        if (src == null || !src.exists()) {
            call.reject("文件不存在");
            return;
        }
        String name = call.getString("name", src.getName());
        String mime = call.getString("mime", image ? "image/jpeg" : "application/pdf");
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/YourScanner");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri collection = image
                        ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri uri = cr.insert(collection, v);
                if (uri == null) throw new IOException("无法建立文件");
                try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new IOException("无法写入");
                    copy(in, out);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS), "YourScanner");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法建立文件夹");
                File dst = new File(dir, name);
                try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
                    copy(in, out);
                }
                MediaScannerConnection.scanFile(getContext(), new String[]{dst.getAbsolutePath()}, new String[]{mime}, null);
            }
            JSObject r = new JSObject();
            r.put("ok", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "保存失败");
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        File src = fileFrom(call.getString("path"));
        if (src == null || !src.exists()) {
            call.reject("文件不存在");
            return;
        }
        String name = call.getString("name", "YourScanner.pdf");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .build();
                pm.print(name, new PdfAdapter(src, name), attrs);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "打印失败");
            }
        });
    }

    private static class PdfAdapter extends PrintDocumentAdapter {
        private final File file;
        private final String name;

        PdfAdapter(File file, String name) {
            this.file = file;
            this.name = name;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                             CancellationSignal cancellationSignal, LayoutResultCallback callback, Bundle extras) {
            if (cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name.endsWith(".pdf") ? name : name + ".pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                    .build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                            CancellationSignal cancellationSignal, WriteResultCallback callback) {
            try (InputStream in = new FileInputStream(file);
                 OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                copy(in, out);
                callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }

    private static Bitmap decodeScaled(File src, final int max) throws IOException {
        if (Build.VERSION.SDK_INT >= 28) {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(src), (decoder, info, source) -> {
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                int m = Math.max(w, h);
                if (m > max) {
                    float sc = (float) max / m;
                    decoder.setTargetSize(Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)));
                }
            });
        }
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(src.getAbsolutePath(), o);
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / sample > max * 2) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        Bitmap b = BitmapFactory.decodeFile(src.getAbsolutePath(), o2);
        if (b == null) return null;
        int m = Math.max(b.getWidth(), b.getHeight());
        if (m > max) {
            float sc = (float) max / m;
            Bitmap s = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * sc)), Math.max(1, Math.round(b.getHeight() * sc)), true);
            if (s != b) b.recycle();
            b = s;
        }
        return b;
    }

    /** 存一页：原图 o_ + 缩略图 t_，返回 {o, t, size} */
    private static JSObject writePage(Bitmap bmp, File outDir, String id, int thumbMax) throws IOException {
        return writePage(bmp, outDir, id, thumbMax, 90);
    }

    private static JSObject writePage(Bitmap bmp, File outDir, String id, int thumbMax, int quality) throws IOException {
        // 透明背景（PNG 等）铺上白底，不然存成 JPEG 会变黑
        if (bmp.hasAlpha()) {
            Bitmap flat = Bitmap.createBitmap(bmp.getWidth(), bmp.getHeight(), Bitmap.Config.ARGB_8888);
            flat.eraseColor(Color.WHITE);
            new Canvas(flat).drawBitmap(bmp, 0, 0, null);
            JSObject r = writePage(flat, outDir, id, thumbMax, quality, true);
            flat.recycle();
            return r;
        }
        return writePage(bmp, outDir, id, thumbMax, quality, true);
    }

    private static JSObject writePage(Bitmap bmp, File outDir, String id, int thumbMax, int quality, boolean flat) throws IOException {
        File o = new File(outDir, "o_" + id + ".jpg");
        try (OutputStream os = new FileOutputStream(o)) {
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, os);
        }
        int w = bmp.getWidth(), h = bmp.getHeight();
        float sc = Math.min(1f, (float) thumbMax / Math.max(w, h));
        Bitmap th = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)), true);
        File t = new File(outDir, "t_" + id + ".jpg");
        try (OutputStream os = new FileOutputStream(t)) {
            th.compress(Bitmap.CompressFormat.JPEG, 75, os);
        }
        if (th != bmp) th.recycle();
        JSObject r = new JSObject();
        r.put("o", o.getName());
        r.put("t", t.getName());
        r.put("size", o.length());
        return r;
    }

    /** 用别的 app（例如 WPS）打开文件 */
    @PluginMethod
    public void openWith(PluginCall call) {
        File src = fileFrom(call.getString("path"));
        if (src == null || !src.exists()) {
            call.reject("文件不存在");
            return;
        }
        String mime = call.getString("mime", "*/*");
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", src);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(view, call.getString("title", "Open with"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "无法打开");
        }
    }

    /** 分享处理完后清掉，免得下次回到 app 又导入一次 */
    @PluginMethod
    public void clearIntent(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
            call.resolve();
        });
    }

    /* ---------- 相册多选 + 直接存成页面（全部在原生层，最快） ---------- */
    @PluginMethod
    public void pickImages(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 33) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit());
        } else {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("image/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            JSObject r = new JSObject();
            r.put("pages", new JSArray());
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        final List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            ClipData cd = data.getClipData();
            for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        final File outDir = fileFrom(call.getString("outDir"));
        final String prefix = call.getString("prefix", String.valueOf(System.currentTimeMillis()));
        final int max = call.getInt("max", 2480);
        final int thumbMax = call.getInt("thumbMax", 420);
        if (outDir == null) {
            call.reject("缺少 outDir");
            return;
        }
        new Thread(() -> {
            JSArray pages = new JSArray();
            int bad = 0;
            if (!outDir.exists()) outDir.mkdirs();
            for (int i = 0; i < uris.size(); i++) {
                JSObject ev = new JSObject();
                ev.put("i", i + 1);
                ev.put("n", uris.size());
                notifyListeners("progress", ev);
                try {
                    Bitmap bmp = decodeUri(uris.get(i), max);
                    if (bmp == null) { bad++; continue; }
                    pages.put(writePage(bmp, outDir, prefix + "_" + i, thumbMax));
                    bmp.recycle();
                } catch (Exception e) {
                    bad++;
                }
            }
            JSObject r = new JSObject();
            r.put("pages", pages);
            r.put("bad", bad);
            call.resolve(r);
        }).start();
    }

    private Bitmap decodeUri(Uri uri, final int max) throws IOException {
        ContentResolver cr = getContext().getContentResolver();
        if (Build.VERSION.SDK_INT >= 28) {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(cr, uri), (decoder, info, source) -> {
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                int m = Math.max(w, h);
                if (m > max) {
                    float sc = (float) max / m;
                    decoder.setTargetSize(Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)));
                }
            });
        }
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) { BitmapFactory.decodeStream(in, null, o); }
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / sample > max * 2) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        Bitmap b;
        try (InputStream in = cr.openInputStream(uri)) { b = BitmapFactory.decodeStream(in, null, o2); }
        if (b == null) return null;
        int m = Math.max(b.getWidth(), b.getHeight());
        if (m > max) {
            float sc = (float) max / m;
            Bitmap s2 = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * sc)), Math.max(1, Math.round(b.getHeight() * sc)), true);
            if (s2 != b) b.recycle();
            b = s2;
        }
        return b;
    }

    /** 一张图片直接在原生层存成页面（比网页里处理快很多，也支持 HEIC） */
    @PluginMethod
    public void importImage(PluginCall call) {
        File src = fileFrom(call.getString("path"));
        File outDir = fileFrom(call.getString("outDir"));
        String id = call.getString("id", String.valueOf(System.currentTimeMillis()));
        int max = call.getInt("max", 2480);
        int thumbMax = call.getInt("thumbMax", 420);
        if (src == null || !src.exists() || outDir == null) {
            call.reject("文件不存在");
            return;
        }
        new Thread(() -> {
            try {
                if (!outDir.exists()) outDir.mkdirs();
                Bitmap bmp = decodeScaled(src, max);
                if (bmp == null) {
                    call.reject("无法读取图片");
                    return;
                }
                JSObject r = writePage(bmp, outDir, id, thumbMax);
                bmp.recycle();
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "无法读取图片");
            }
        }).start();
    }

    /** PDF 每一页转成图片（Android 自带 PdfRenderer，很快） */
    @PluginMethod
    public void pdfToImages(PluginCall call) {
        File src = fileFrom(call.getString("path"));
        File outDir = fileFrom(call.getString("outDir"));
        String prefix = call.getString("prefix", String.valueOf(System.currentTimeMillis()));
        int max = call.getInt("max", 2200);
        int thumbMax = call.getInt("thumbMax", 420);
        if (src == null || !src.exists() || outDir == null) {
            call.reject("文件不存在");
            return;
        }
        new Thread(() -> {
            try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(src, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(pfd)) {
                if (!outDir.exists()) outDir.mkdirs();
                int n = renderer.getPageCount();
                JSArray pages = new JSArray();
                for (int i = 0; i < n; i++) {
                    Bitmap bmp;
                    try (PdfRenderer.Page page = renderer.openPage(i)) {
                        float sc = Math.min(4f, (float) max / Math.max(page.getWidth(), page.getHeight()));
                        int w = Math.max(1, Math.round(page.getWidth() * sc));
                        int h = Math.max(1, Math.round(page.getHeight() * sc));
                        bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                        bmp.eraseColor(Color.WHITE);
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    }
                    pages.put(writePage(bmp, outDir, prefix + "_" + i, thumbMax, 82));
                    bmp.recycle();
                    JSObject ev = new JSObject();
                    ev.put("i", i + 1);
                    ev.put("n", n);
                    notifyListeners("progress", ev);
                }
                JSObject r = new JSObject();
                r.put("pages", pages);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "PDF 打不开");
            }
        }).start();
    }

    /** 系统能读的任何图片（HEIC 等）转成 JPEG，最长边 2480 */
    @PluginMethod
    public void toJpeg(PluginCall call) {
        File src = fileFrom(call.getString("path"));
        if (src == null || !src.exists()) {
            call.reject("文件不存在");
            return;
        }
        try {
            Bitmap bmp;
            final int max = 2480;
            if (Build.VERSION.SDK_INT >= 28) {
                bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(src), (decoder, info, source) -> {
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                    int m = Math.max(w, h);
                    if (m > max) {
                        float sc = (float) max / m;
                        decoder.setTargetSize(Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)));
                    }
                });
            } else {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(src.getAbsolutePath(), o);
                int sample = 1;
                while (Math.max(o.outWidth, o.outHeight) / sample > max * 2) sample *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options();
                o2.inSampleSize = sample;
                bmp = BitmapFactory.decodeFile(src.getAbsolutePath(), o2);
            }
            if (bmp == null) {
                call.reject("无法读取图片");
                return;
            }
            if (bmp.hasAlpha()) {
                Bitmap flat = Bitmap.createBitmap(bmp.getWidth(), bmp.getHeight(), Bitmap.Config.ARGB_8888);
                flat.eraseColor(Color.WHITE);
                new Canvas(flat).drawBitmap(bmp, 0, 0, null);
                bmp.recycle();
                bmp = flat;
            }
            File out = new File(getContext().getCacheDir(), "conv_" + System.currentTimeMillis() + ".jpg");
            try (OutputStream os = new FileOutputStream(out)) {
                bmp.compress(Bitmap.CompressFormat.JPEG, 92, os);
            }
            bmp.recycle();
            JSObject r = new JSObject();
            r.put("path", Uri.fromFile(out).toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "无法读取图片");
        }
    }

    @PluginMethod
    public void email(PluginCall call) {
        File src = fileFrom(call.getString("path"));
        if (src == null || !src.exists()) {
            call.reject("文件不存在");
            return;
        }
        String subject = call.getString("subject", "");
        String mime = call.getString("mime", "application/pdf");
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", src);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_SUBJECT, subject);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(subject, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
            Intent chooser = Intent.createChooser(send, call.getString("title", "Email"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "发送失败");
        }
    }
}
