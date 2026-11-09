package com.yourscanhubs.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
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

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

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
                        (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/YourScan");
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
                        image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS), "YourScan");
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
        String name = call.getString("name", "YourScan.pdf");
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
