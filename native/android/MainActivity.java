package com.yourscanhubs.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OcrPlugin.class);
        registerPlugin(YsNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** app 已经开着时又有文件分享进来：换成新的 intent，通知网页处理 */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String a = intent.getAction();
        if ((Intent.ACTION_SEND.equals(a) || Intent.ACTION_SEND_MULTIPLE.equals(a)) && getBridge() != null) {
            getBridge().triggerWindowJSEvent("ysShare");
        }
    }
}
