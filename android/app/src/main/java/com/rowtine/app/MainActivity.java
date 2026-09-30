package com.rowtine.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImageDecodePlugin.class);
        registerPlugin(RowtineSafPlugin.class);
        registerPlugin(SafeAreaPlugin.class);
        registerPlugin(RowNotificationPlugin.class);
        registerPlugin(KeepAwakePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
