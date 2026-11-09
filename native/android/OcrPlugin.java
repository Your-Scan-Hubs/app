package com.yourscanhubs.app;

import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import java.io.File;

/**
 * 离线文字识别（ML Kit 中文模型，同时支持英文/马来文等拉丁字母）。
 * JS: Ocr.recognize({ path: "file:///..." }) -> { text }
 */
@CapacitorPlugin(name = "Ocr")
public class OcrPlugin extends Plugin {

    private TextRecognizer recognizer;

    private TextRecognizer getRecognizer() {
        if (recognizer == null) {
            recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        }
        return recognizer;
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少 path");
            return;
        }
        try {
            Uri uri = (path.startsWith("file://") || path.startsWith("content://"))
                    ? Uri.parse(path)
                    : Uri.fromFile(new File(path));
            InputImage image = InputImage.fromFilePath(getContext(), uri);
            getRecognizer().process(image)
                    .addOnSuccessListener(result -> {
                        JSObject ret = new JSObject();
                        ret.put("text", result.getText());
                        call.resolve(ret);
                    })
                    .addOnFailureListener(e -> call.reject("识别失败: " + e.getMessage()));
        } catch (Exception e) {
            call.reject("读取图片失败: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) {
            recognizer.close();
            recognizer = null;
        }
        super.handleOnDestroy();
    }
}
