package com.rowtine.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

// Bouton « Cocher le rang » de la notification du rang en cours, ou moins et plus d'un
// compteur (extra `delta`, +1 par défaut).
// Processus vivant : l'appui part au lecteur (événement rowAction), seul à écrire ; sans
// écouteur rowAction, la notification est effacée (voir fireRowAction).
// Processus mort : depuis Android 12, un receiver lancé par une action de notification
// ne peut pas ouvrir d'activité (« notification trampoline »). On remplace donc la
// notification par une invitation à rouvrir l'app, sans rien cocher.
public class RowNotificationReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        long projectId = intent.getLongExtra(RowNotificationPlugin.EXTRA_PROJECT_ID, RowNotificationPlugin.projectId);
        String stepId = intent.getStringExtra(RowNotificationPlugin.EXTRA_STEP_ID);
        int delta = intent.getIntExtra(RowNotificationPlugin.EXTRA_DELTA, 1);

        RowNotificationPlugin plugin = RowNotificationPlugin.instance;
        if (plugin != null) {
            if (stepId != null) plugin.fireRowAction(projectId, stepId, delta);
            return;
        }
        postClosed(context, intent, projectId);
    }

    private void postClosed(Context context, Intent intent, long projectId) {
        // Processus neuf : les champs statiques sont vides, les extras font foi.
        String title = intent.getStringExtra(RowNotificationPlugin.EXTRA_CLOSED_TITLE);
        String text = intent.getStringExtra(RowNotificationPlugin.EXTRA_CLOSED_TEXT);
        if (title == null) title = RowNotificationPlugin.closedTitle;
        if (text == null) text = RowNotificationPlugin.closedText;

        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!RowNotificationPlugin.notificationsEnabled(context)) return;
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return;
        }

        // Le canal survit au processus ; ne le recréer que s'il a disparu, sous un nom
        // de repli (le nom traduit ne vit que côté JS).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannelCompat(RowNotificationPlugin.CHANNEL_ID) == null) {
            RowNotificationPlugin.ensureChannel(manager, "Rowtine");
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, RowNotificationPlugin.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_rowtine)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(false)
            .setAutoCancel(true)
            .setShowWhen(false)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(RowNotificationPlugin.launchPendingIntent(context, projectId));

        try {
            manager.notify(RowNotificationPlugin.NOTIF_ID, builder.build());
        } catch (SecurityException e) {
            // Permission retirée entre-temps : rien à afficher.
        }
    }
}
