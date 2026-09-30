package com.rowtine.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.RemoteViews;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Notification permanente du rang en cours (spec 2026-09-29-notification-rang-en-cours).
// Le lecteur (JS) est le seul à écrire : ce plugin affiche ce qu'on lui donne et renvoie
// l'appui sur « Cocher le rang » en événement rowAction. Tout le texte vient du JS. Sur un
// compteur (charge avec `counter`), vue sur mesure : moins, « Répétition k / N », plus ; le
// bouton pressé part avec son `delta` (-1 ou +1).
// Processus mort : voir RowNotificationReceiver.
@CapacitorPlugin(
    name = "RowNotification",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public class RowNotificationPlugin extends Plugin {

    static final int NOTIF_ID = 4201;
    // Canal d'importance normale (sans son ni vibration, cf. ensureChannel). L'ancien
    // canal « row-progress », d'importance basse, rendait la notification « silencieuse »
    // pour Android : masquée de l'écran de verrouillage par défaut. L'importance d'un canal
    // ne se modifie plus après sa création, d'où un nouvel identifiant.
    static final String CHANNEL_ID = "row-progress-2";
    static final String LEGACY_CHANNEL_ID = "row-progress";
    static final String ACTION_OPEN_PROJECT = "com.rowtine.app.OPEN_PROJECT";
    static final String ACTION_ROW = "com.rowtine.app.ROW_ACTION";
    static final String EXTRA_PROJECT_ID = "projectId";
    static final String EXTRA_STEP_ID = "stepId";
    static final String EXTRA_DELTA = "delta";
    static final String EXTRA_CLOSED_TITLE = "closedTitle";
    static final String EXTRA_CLOSED_TEXT = "closedText";
    private static final String ALIAS = "notifications";

    // Instance vivante lue par le receiver : null = processus neuf ou activité détruite.
    static volatile RowNotificationPlugin instance = null;

    // Dernière charge utile, pour le receiver. Vides dans un processus neuf : les mêmes
    // valeurs voyagent donc aussi en extras de l'intent du bouton.
    static volatile String closedTitle = null;
    static volatile String closedText = null;
    static volatile long projectId = -1;

    @Override
    public void load() {
        // Une notification laissée par un processus précédent ne correspond plus à rien.
        NotificationManagerCompat.from(getContext()).cancel(NOTIF_ID);
        instance = this;
    }

    // Seulement si c'est encore nous : une activité relancée aussitôt fait passer le
    // load() de la nouvelle instance AVANT le onDestroy de l'ancienne. Sans cette garde,
    // le bouton croirait le processus mort pour toute la session.
    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            NotificationManagerCompat.from(getContext()).cancel(NOTIF_ID);
            instance = null;
        }
    }

    // Projet demandé par un appui sur la notification alors qu'aucun écouteur JS n'existait
    // encore ; rendu une fois par takeLaunchProject(). Lu et écrit sur le thread UI.
    private Long pendingOpenProject = null;

    // Appui sur la notification. Page chargée et à l'écoute : événement openProject.
    // Sinon il serait perdu : au démarrage à froid, BridgeActivity rejoue ici l'intent de
    // lancement avant le chargement de la page ; et si le processus est mort alors que sa
    // tâche reste dans les récents, Android ramène la tâche (START_TASK_TO_FRONT), recrée
    // l'activité avec son intent d'ORIGINE et livre l'intent de la notification par
    // onNewIntent juste après onCreate, toujours avant la page (relevé sur le Huawei,
    // Android 10). Le projet est alors retenu pour takeLaunchProject(). Une relance depuis
    // les récents (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) n'est pas un appui : ignorée.
    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null || !ACTION_OPEN_PROJECT.equals(intent.getAction())) return;
        if (!intent.hasExtra(EXTRA_PROJECT_ID)) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        long projectId = intent.getLongExtra(EXTRA_PROJECT_ID, -1);
        if (hasListeners("openProject")) {
            JSObject data = new JSObject();
            data.put("projectId", projectId);
            notifyListeners("openProject", data);
        } else {
            pendingOpenProject = projectId;
        }
    }

    // Aucun écouteur JS (lecteur pas encore à l'écoute, page rechargée) : l'appui serait
    // perdu en silence, sans rétention. La notification est effacée ; le lecteur la
    // repose au retour au premier plan ou au prochain changement de rang.
    void fireRowAction(long projectId, String stepId, int delta) {
        if (!hasListeners("rowAction")) {
            NotificationManagerCompat.from(getContext()).cancel(NOTIF_ID);
            return;
        }
        JSObject data = new JSObject();
        data.put("projectId", projectId);
        data.put("stepId", stepId);
        data.put("delta", delta);
        notifyListeners("rowAction", data);
    }

    static Intent launchIntent(Context ctx, long projectId) {
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setAction(ACTION_OPEN_PROJECT);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra(EXTRA_PROJECT_ID, projectId);
        return intent;
    }

    static PendingIntent launchPendingIntent(Context ctx, long projectId) {
        return PendingIntent.getActivity(
            ctx,
            2,
            launchIntent(ctx, projectId),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    // Canal de la notification : importance NORMALE. SystemUI masque de l'écran de
    // verrouillage les notifications d'importance inférieure (réglage « notifications
    // silencieuses » coupé par défaut, mesuré sur le Pixel 7) ; seule l'importance du canal
    // en décide, pas le drapeau setSilent(true), que les notifications gardent : il coupe
    // son, vibration et réveil de l'écran. Le canal lui-même n'a ni son, ni vibration, ni
    // voyant. L'ancien canal d'importance basse est supprimé. Sans effet sous API 26.
    static void ensureChannel(NotificationManagerCompat manager, String name) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (manager.getNotificationChannelCompat(LEGACY_CHANNEL_ID) != null) {
            manager.deleteNotificationChannel(LEGACY_CHANNEL_ID);
        }
        manager.createNotificationChannel(
            new NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                .setName(name)
                .setSound(null, null)
                .setVibrationEnabled(false)
                .setLightsEnabled(false)
                .setShowBadge(false)
                .build()
        );
    }

    // Notifications de l'app actives ET canal de la notification non coupé par l'utilisatrice
    // (API 26+ ; un canal pas encore créé ne compte pas comme coupé).
    static boolean notificationsEnabled(Context ctx) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(ctx);
        if (!manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannelCompat channel = manager.getNotificationChannelCompat(CHANNEL_ID);
            if (channel != null && channel.getImportance() == NotificationManagerCompat.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    // Permission effective : sous API 33 pas de permission d'exécution, seul compte
    // l'interrupteur système des notifications de l'app ; au-dessus, une permission
    // accordée mais des notifications coupées se lit aussi « denied ».
    private String effectiveState() {
        boolean enabled = notificationsEnabled(getContext());
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return enabled ? PermissionState.GRANTED.toString() : PermissionState.DENIED.toString();
        }
        PermissionState state = getPermissionState(ALIAS);
        if (state == null) return PermissionState.DENIED.toString();
        if (state == PermissionState.GRANTED && !enabled) return PermissionState.DENIED.toString();
        return state.toString();
    }

    private boolean canPost() {
        Context ctx = getContext();
        if (!notificationsEnabled(ctx)) return false;
        return (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ActivityCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        );
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put(ALIAS, effectiveState());
        return result;
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionResult());
    }

    // Sous API 33, ne jamais lancer la demande système : POST_NOTIFICATIONS y est inconnue,
    // la demande serait refusée et Capacitor mémoriserait « denied » pour de bon.
    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(ALIAS) == PermissionState.GRANTED) {
            call.resolve(permissionResult());
            return;
        }
        requestPermissionForAlias(ALIAS, call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        call.resolve(permissionResult());
    }

    @PluginMethod
    public void show(PluginCall call) {
        Context ctx = getContext();
        // Pas call.getLong : un petit nombre JS arrive en Integer, que getLong ignore (null).
        Object rawId = call.getData().opt("projectId");
        String stepId = call.getString("stepId");
        if (!(rawId instanceof Number) || stepId == null) {
            call.reject("projectId et stepId requis");
            return;
        }
        long id = ((Number) rawId).longValue();
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String subText = call.getString("subText");
        String bigText = call.getString("bigText", text);
        String actionLabel = call.getString("actionLabel", "");
        String channelName = call.getString("channelName", "Rowtine");

        projectId = id;
        closedTitle = call.getString("closedTitle");
        closedText = call.getString("closedText");

        if (!canPost()) {
            call.resolve();
            return;
        }

        NotificationManagerCompat manager = NotificationManagerCompat.from(ctx);
        // Créé ou renommé (nom traduit du JS) ; sans effet sous API 26.
        ensureChannel(manager, channelName);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_rowtine)
            .setContentTitle(title)
            .setContentText(text)
            .setSubText(subText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(launchPendingIntent(ctx, id));

        JSObject counter = call.getObject("counter");
        if (counter != null) {
            // Codes de requête distincts : deux PendingIntent qui ne diffèrent que par leurs
            // extras seraient confondus par Android (le moins enverrait +1).
            PendingIntent plus = rowPendingIntent(ctx, 3, id, stepId, 1);
            PendingIntent minus = counter.optBoolean("canMinus") ? rowPendingIntent(ctx, 4, id, stepId, -1) : null;
            builder
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setCustomContentView(counterViews(ctx, R.layout.notif_counter, counter, minus, plus));
            RemoteViews big = counterViews(ctx, R.layout.notif_counter_big, counter, minus, plus);
            big.setTextViewText(R.id.notif_counter_section, counter.optString("section", ""));
            big.setTextViewText(R.id.notif_counter_text, bigText);
            builder.setCustomBigContentView(big);
        } else {
            builder
                .setStyle(new NotificationCompat.BigTextStyle().bigText(bigText))
                .addAction(0, actionLabel, rowPendingIntent(ctx, 1, id, stepId, 1));
        }

        try {
            manager.notify(NOTIF_ID, builder.build());
        } catch (SecurityException e) {
            // Permission retirée entre la vérification et l'envoi : rien à afficher.
        }
        call.resolve();
    }

    // Intent d'un bouton de la notification vers RowNotificationReceiver. Les valeurs de
    // closedTitle/closedText voyagent aussi : le receiver en a besoin si le processus est mort.
    private static PendingIntent rowPendingIntent(Context ctx, int requestCode, long id, String stepId, int delta) {
        Intent intent = new Intent(ctx, RowNotificationReceiver.class);
        intent.setAction(ACTION_ROW);
        intent.putExtra(EXTRA_PROJECT_ID, id);
        intent.putExtra(EXTRA_STEP_ID, stepId);
        intent.putExtra(EXTRA_DELTA, delta);
        intent.putExtra(EXTRA_CLOSED_TITLE, closedTitle);
        intent.putExtra(EXTRA_CLOSED_TEXT, closedText);
        return PendingIntent.getBroadcast(ctx, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // Stepper du compteur (layout notif_counter, inclus dans notif_counter_big). `minus` nul :
    // compteur à 0, bouton grisé et sans action.
    private static RemoteViews counterViews(Context ctx, int layout, JSObject counter, PendingIntent minus, PendingIntent plus) {
        RemoteViews views = new RemoteViews(ctx.getPackageName(), layout);
        views.setTextViewText(R.id.notif_counter_label, counter.optString("label", ""));
        views.setContentDescription(R.id.notif_counter_minus, counter.optString("minusLabel", ""));
        views.setContentDescription(R.id.notif_counter_plus, counter.optString("plusLabel", ""));
        views.setOnClickPendingIntent(R.id.notif_counter_plus, plus);
        // État posé dans les deux sens : une mise à jour de la notification peut être réappliquée
        // sur la vue existante, un moins grisé à 0 le resterait sinon après un +1.
        // setImageAlpha et non setAlpha : ce dernier n'est permis en RemoteViews qu'à partir
        // d'Android 12 (avant, SystemUI refuse la vue et la notification disparaît).
        views.setBoolean(R.id.notif_counter_minus, "setEnabled", minus != null);
        views.setInt(R.id.notif_counter_minus, "setImageAlpha", minus != null ? 255 : 97);
        if (minus != null) views.setOnClickPendingIntent(R.id.notif_counter_minus, minus);
        return views;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIF_ID);
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", ctx.getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("réglages indisponibles");
        }
    }

    // Démarrage à froid depuis la notification : le projet retenu par handleOnNewIntent,
    // sinon l'extra de l'intent de lancement, une seule fois (même principe que
    // SafeArea.get()). Lu et retiré sur le thread UI, où vit l'intent de l'activité. Une
    // relance depuis les récents après mort du processus rejoue l'intent d'origine (extra
    // compris) avec FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY : ignorée, ce n'est pas un appui
    // sur la notification.
    @PluginMethod
    public void takeLaunchProject(PluginCall call) {
        final AppCompatActivity activity = getActivity();
        if (activity == null) {
            JSObject none = new JSObject();
            none.put("projectId", JSObject.NULL);
            call.resolve(none);
            return;
        }
        activity.runOnUiThread(() -> {
            JSObject result = new JSObject();
            Intent intent = activity.getIntent();
            if (pendingOpenProject != null) {
                result.put("projectId", pendingOpenProject.longValue());
                pendingOpenProject = null;
                if (intent != null) intent.removeExtra(EXTRA_PROJECT_ID);
                call.resolve(result);
                return;
            }
            boolean fromHistory = intent != null && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
            if (
                intent != null &&
                !fromHistory &&
                ACTION_OPEN_PROJECT.equals(intent.getAction()) &&
                intent.hasExtra(EXTRA_PROJECT_ID)
            ) {
                result.put("projectId", intent.getLongExtra(EXTRA_PROJECT_ID, -1));
                intent.removeExtra(EXTRA_PROJECT_ID);
            } else {
                result.put("projectId", JSObject.NULL);
            }
            call.resolve(result);
        });
    }
}
