package com.rowtine.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.Map;
import java.util.TreeMap;

// Bouton « Cocher le rang » de la notification du rang en cours, ou moins et plus d'un
// compteur (extra `delta`, +1 par défaut).
// Processus vivant : l'appui est retenu, puis part au lecteur (événement rowAction), seul à
// écrire. Sans acquittement du JS sous ACK_GRACE_MS (WebView gelé, ou aucun écouteur
// rowAction, voir fireRowAction), la notification est remplacée par « Appui retenu » et le
// lecteur rejouera l'entrée.
// Processus mort : depuis Android 12, un receiver lancé par une action de notification
// ne peut pas ouvrir d'activité (« notification trampoline »). L'appui est retenu en
// SharedPreferences (savePendingRowAction) et la notification remplace son contenu par
// « Appui retenu » : le lecteur rejouera l'appui à l'ouverture du projet (useRowNotification),
// seulement si l'étape visée est toujours l'étape en cours. Rien n'est coché ici.
public class RowNotificationReceiver extends BroadcastReceiver {

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    // Veille d'un appui du processus vivant : minuteur du repli et broadcast tenu ouvert
    // (goAsync). Sans goAsync, Android tient le receiver pour fini au retour de onReceive :
    // le processus redevient « en cache », parfois figé aussitôt (EMUI), et le minuteur ne
    // tournerait qu'au dégel. finish() une seule fois, quel que soit le chemin.
    private static final class Watch {
        final Runnable timer;
        final PendingResult result;
        private boolean finished = false;

        Watch(Runnable timer, PendingResult result) {
            this.timer = timer;
            this.result = result;
        }

        void finish() {
            if (finished) return;
            finished = true;
            if (result != null) result.finish();
        }
    }

    // Veilles en cours, par numéro d'appui. Lue et écrite sur le thread principal SEULEMENT
    // (onReceive, minuteur, releaseAcked) : pas de verrou.
    private static final TreeMap<Long, Watch> watches = new TreeMap<>();

    // Acquittement du JS jusqu'au numéro `ackedSeq` : les veilles correspondantes s'arrêtent
    // sans repli et rendent leur broadcast. Les broadcasts vers un receiver du manifeste sont
    // livrés en série : sans cela, un second appui attendrait la fin du minuteur du premier.
    // Appelable depuis n'importe quel thread (le travail est posté sur le thread principal).
    static void releaseAcked(final long ackedSeq) {
        if (ackedSeq <= 0) return;
        MAIN.post(() -> {
            Map<Long, Watch> done = watches.headMap(ackedSeq, true);
            for (Watch w : done.values()) {
                MAIN.removeCallbacks(w.timer);
                w.finish();
            }
            done.clear();
        });
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        long projectId = intent.getLongExtra(RowNotificationPlugin.EXTRA_PROJECT_ID, RowNotificationPlugin.projectId);
        String stepId = intent.getStringExtra(RowNotificationPlugin.EXTRA_STEP_ID);
        int delta = intent.getIntExtra(RowNotificationPlugin.EXTRA_DELTA, 1);

        RowNotificationPlugin plugin = RowNotificationPlugin.instance;
        if (plugin != null) {
            if (stepId == null) return;
            // Processus vivant (spec 2026-10-01 appui-webview-gele) : retenir d'abord, puis
            // veiller, puis émettre au JS. Un WebView gelé en arrière-plan n'exécute pas son
            // JS : sans acquittement sous ACK_GRACE_MS, la notification annonce « Appui
            // retenu » (le lecteur rejouera l'entrée), au lieu de rester muette. La veille
            // est posée avant l'émission : un acquittement ne peut pas la devancer.
            final String tapId = RowNotificationPlugin.newTapId();
            if (projectId > 0) {
                RowNotificationPlugin.savePendingRowAction(context, projectId, stepId, delta, tapId);
            }
            watch(context.getApplicationContext(), intent, projectId, tapId, goAsync());
            plugin.fireRowAction(projectId, stepId, delta, tapId);
            return;
        }
        postClosed(context, intent, projectId, stepId, delta);
    }

    // Thread principal (appelé depuis onReceive).
    private static void watch(final Context appContext, final Intent intent, final long pid, final String tapId, PendingResult pr) {
        final long seq = RowNotificationPlugin.seqOf(tapId);
        final Watch[] self = new Watch[1];
        Runnable timer = () -> {
            try {
                if (!RowNotificationPlugin.isAcked(tapId)) postPendingNotification(appContext, intent, pid);
            } finally {
                watches.remove(seq);
                self[0].finish();
            }
        };
        self[0] = new Watch(timer, pr);
        watches.put(seq, self[0]);
        MAIN.postDelayed(timer, RowNotificationPlugin.ACK_GRACE_MS);
    }

    private void postClosed(Context context, Intent intent, long projectId, String stepId, int delta) {
        // Retenir d'abord : la rétention ne dépend pas de l'affichage (un canal coupé
        // individuellement ne doit pas perdre l'appui). commit() dans savePendingRowAction.
        if (stepId != null && projectId > 0) {
            RowNotificationPlugin.savePendingRowAction(context, projectId, stepId, delta);
        }
        postPendingNotification(context, intent, projectId);
    }

    // Notification « Appui retenu » (sans bouton), commune au processus mort et au repli du
    // processus vivant dont le JS n'a pas répondu. N'écrit rien dans la rétention.
    private static void postPendingNotification(Context context, Intent intent, long projectId) {
        // Processus neuf : les champs statiques sont vides, les extras font foi. Libellés :
        // « appui retenu » d'abord, invitation d'avant ensuite (notification postée par une
        // APK antérieure, extras sans pending*), statique en dernier repli.
        String title = intent.getStringExtra(RowNotificationPlugin.EXTRA_PENDING_TITLE);
        String text = intent.getStringExtra(RowNotificationPlugin.EXTRA_PENDING_TEXT);
        if (title == null) title = intent.getStringExtra(RowNotificationPlugin.EXTRA_CLOSED_TITLE);
        if (text == null) text = intent.getStringExtra(RowNotificationPlugin.EXTRA_CLOSED_TEXT);
        if (title == null) title = RowNotificationPlugin.pendingTitle;
        if (text == null) text = RowNotificationPlugin.pendingText;
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
