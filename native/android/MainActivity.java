package com.yourscanhubs.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OcrPlugin.class);
        registerPlugin(YsNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
