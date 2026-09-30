package com.rowtine.app;

import android.app.Activity;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Écran gardé allumé pendant le suivi d'un projet (réglage du 30/09/2026). Pose ou retire
// FLAG_KEEP_SCREEN_ON sur la fenêtre de l'activité : aucune permission requise, et le
// drapeau disparaît avec la fenêtre si l'activité est détruite. Le lecteur (JS, via
// src/native/keep-awake.js) décide quand : actif tant qu'il est monté, retiré au démontage.
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        // Les drapeaux de fenêtre ne se touchent que depuis le thread UI.
        activity.runOnUiThread(() -> {
            if (on) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }
}
