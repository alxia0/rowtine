package com.rowtine.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.widget.RemoteViews;

import androidx.activity.result.ActivityResult;
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
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.atomic.AtomicLong;

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
    // Libellés de la notification « appui retenu » (processus mort, spec
    // 2026-09-30-notification-appui-attente) : voyagent en extras comme closed*, le JS
    // les fournit (i18n) à chaque show.
    static final String EXTRA_PENDING_TITLE = "pendingTitle";
    static final String EXTRA_PENDING_TEXT = "pendingText";
    // Appui retenu (clé unique, écrasée à chaque nouvel appui — la notification de
    // remplacement n'a pas de bouton, « dernier gagne » par sûreté). Receiver et activité
    // partagent le même processus : ne JAMAIS déclarer android:process sur le receiver,
    // la lecture SharedPreferences n'y survivrait pas (impasse MODE_MULTI_PROCESS).
    private static final String PREFS_ROW = "row-notification";
    private static final String KEY_PENDING = "pendingRowAction";
    // Écriture (receiver, thread principal) contre lecture puis effacement (méthodes du
    // plugin, thread des plugins) : sans verrou, un effacement pourrait emporter l'entrée
    // d'un appui plus récent écrite entre sa lecture et son remove.
    private static final Object PREFS_LOCK = new Object();
    private static final String ALIAS = "notifications";

    // Instance vivante lue par le receiver : null = processus neuf ou activité détruite.
    static volatile RowNotificationPlugin instance = null;

    // Dernière charge utile, pour le receiver. Vides dans un processus neuf : les mêmes
    // valeurs voyagent donc aussi en extras de l'intent du bouton.
    static volatile String closedTitle = null;
    static volatile String closedText = null;
    static volatile String pendingTitle = null;
    static volatile String pendingText = null;
    static volatile long projectId = -1;

    // Acquittement des appuis reçus en processus vivant (spec 2026-10-01
    // appui-webview-gele). Un tapId = « <démarrage du processus>-<numéro> » : unique d'un
    // processus à l'autre, numéro croissant dans un processus. Le JS acquitte dès qu'il a
    // pris sa décision ; un acquittement d'un numéro plus récent vaut pour les plus
    // anciens (JS vivant). Un WebView gelé n'acquitte pas : le minuteur du receiver conclut.
    static final long ACK_GRACE_MS = 1500;
    private static final String TAP_PREFIX = System.currentTimeMillis() + "-";
    private static final AtomicLong tapSeq = new AtomicLong(0);
    private static volatile long ackedSeq = 0;

    static String newTapId() {
        return TAP_PREFIX + tapSeq.incrementAndGet();
    }

    // Numéro d'un tapId de CE processus, ou -1 (autre processus, format inconnu).
    static long seqOf(String tapId) {
        if (tapId == null || !tapId.startsWith(TAP_PREFIX)) return -1;
        try {
            return Long.parseLong(tapId.substring(TAP_PREFIX.length()));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    // Vrai si le JS a répondu à cet appui, ou à un appui plus récent.
    static boolean isAcked(String tapId) {
        long seq = seqOf(tapId);
        return seq >= 0 && seq <= ackedSeq;
    }

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

    // Aucun écouteur JS (lecteur pas encore à l'écoute, page rechargée) : l'événement n'a
    // pas de destinataire, mais l'appui est déjà retenu (écrit par le receiver avant
    // l'émission). La notification est effacée ; faute d'acquittement, le receiver affiche
    // « Appui retenu » à ACK_GRACE_MS, et le lecteur rejouera l'entrée à l'ouverture du
    // projet puis reposera sa charge.
    void fireRowAction(long projectId, String stepId, int delta, String tapId) {
        if (!hasListeners("rowAction")) {
            NotificationManagerCompat.from(getContext()).cancel(NOTIF_ID);
            return;
        }
        JSObject data = new JSObject();
        data.put("projectId", projectId);
        data.put("stepId", stepId);
        data.put("delta", delta);
        data.put("tapId", tapId);
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
        // Exemption batterie (spec 2026-10-01) : sans elle, la notification s'afficherait
        // pour disparaître à la première mise en arrière-plan — porte finale côté natif.
        if (!isIgnoringBatteryOptimizations()) return false;
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
        pendingTitle = call.getString("pendingTitle");
        pendingText = call.getString("pendingText");

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
    // closedTitle/closedText et pendingTitle/pendingText voyagent aussi : le receiver en a
    // besoin si le processus est mort.
    private static PendingIntent rowPendingIntent(Context ctx, int requestCode, long id, String stepId, int delta) {
        Intent intent = new Intent(ctx, RowNotificationReceiver.class);
        intent.setAction(ACTION_ROW);
        intent.putExtra(EXTRA_PROJECT_ID, id);
        intent.putExtra(EXTRA_STEP_ID, stepId);
        intent.putExtra(EXTRA_DELTA, delta);
        intent.putExtra(EXTRA_CLOSED_TITLE, closedTitle);
        intent.putExtra(EXTRA_CLOSED_TEXT, closedText);
        intent.putExtra(EXTRA_PENDING_TITLE, pendingTitle);
        intent.putExtra(EXTRA_PENDING_TEXT, pendingText);
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

    // Exclusion des optimisations de batterie (spec 2026-10-01) : ce qui laisse le processus
    // survivre en arrière-plan verrouillé (doze), donc les boutons de la notification
    // fonctionner. Disponible dès l'API 23 (minSdk 24) : pas de garde de version.
    private boolean isIgnoringBatteryOptimizations() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(result);
    }

    // Demande d'exemption. Dialogue système direct d'abord (résultat FIABLE au retour :
    // relecture du PowerManager, jamais le resultCode du dialogue, identique quel que soit
    // le choix). Sinon replis : liste des optimisations, puis infos app — le résultat
    // immédiat de ces écrans n'est PAS fiable (la liste revient presque aussitôt) :
    // `fallback:true` le dit, le JS ne décide rien dessus, seule la relecture au retour au
    // premier plan compte. Aucun rejet ne fuit : échec total → {ignoring:false, fallback:true}.
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isIgnoringBatteryOptimizations()) {
            JSObject done = new JSObject();
            done.put("ignoring", true);
            done.put("fallback", false);
            call.resolve(done);
            return;
        }
        String pkg = getContext().getPackageName();
        try {
            Intent direct = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            direct.setData(Uri.fromParts("package", pkg, null));
            startActivityForResult(call, direct, "batteryDirectCallback");
            return;
        } catch (Exception ignored) {
            // ROM sans le dialogue direct : repli ci-dessous.
        }
        try {
            startActivityForResult(
                call,
                new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                "batteryFallbackCallback"
            );
            return;
        } catch (Exception ignored) {
            // Repli suivant.
        }
        try {
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            details.setData(Uri.fromParts("package", pkg, null));
            startActivityForResult(call, details, "batteryFallbackCallback");
        } catch (Exception e) {
            JSObject none = new JSObject();
            none.put("ignoring", false);
            none.put("fallback", true);
            call.resolve(none);
        }
    }

    @ActivityCallback
    private void batteryDirectCallback(PluginCall call, ActivityResult result) {
        JSObject done = new JSObject();
        done.put("ignoring", isIgnoringBatteryOptimizations());
        done.put("fallback", false);
        call.resolve(done);
    }

    @ActivityCallback
    private void batteryFallbackCallback(PluginCall call, ActivityResult result) {
        JSObject done = new JSObject();
        done.put("ignoring", isIgnoringBatteryOptimizations());
        done.put("fallback", true);
        call.resolve(done);
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

    // Appui retenu par le receiver (processus mort, ou processus vivant tant que le JS ne l'a
    // pas traité) : {projectId, stepId, delta, tapId?}, ou rien.
    // Lecture SANS effacement : un lecteur d'un AUTRE projet doit pouvoir laisser
    // l'entrée en place. SharedPreferences est thread-safe : pas besoin du thread UI de
    // takeLaunchProject (qui lit, lui, l'intent de l'activité).
    @PluginMethod
    public void readPendingRowAction(PluginCall call) {
        JSObject pending = readPendingRowAction(getContext());
        if (pending == null) call.resolve();
        else call.resolve(pending);
    }

    // Acquittement d'un appui par le JS : plus de repli « Appui retenu ». `keep` vrai :
    // l'entrée retenue reste (appui non traité, à rejouer). Sinon elle est effacée si c'est
    // bien CELLE de ce tapId (jamais celle d'un appui plus récent). Idempotente.
    @PluginMethod
    public void ackRowAction(PluginCall call) {
        String tapId = call.getString("tapId");
        boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
        long seq = seqOf(tapId);
        if (seq > ackedSeq) ackedSeq = seq;
        // Le JS a répondu : les veilles du receiver jusqu'à ce numéro rendent leur broadcast.
        RowNotificationReceiver.releaseAcked(ackedSeq);
        if (!keep && tapId != null) {
            synchronized (PREFS_LOCK) {
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS_ROW, Context.MODE_PRIVATE);
                String raw = prefs.getString(KEY_PENDING, null);
                if (raw != null) {
                    try {
                        if (tapId.equals(new JSONObject(raw).optString("tapId", null))) {
                            prefs.edit().remove(KEY_PENDING).commit();
                        }
                    } catch (JSONException e) {
                        // Entrée illisible : sera oubliée à la prochaine lecture.
                    }
                }
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void clearPendingRowAction(PluginCall call) {
        synchronized (PREFS_LOCK) {
            getContext().getSharedPreferences(PREFS_ROW, Context.MODE_PRIVATE)
                .edit().remove(KEY_PENDING).commit();
        }
        call.resolve();
    }

    // Retient l'appui d'un bouton, écrit par le receiver AVANT les gardes d'affichage et
    // avant toute émission au JS : processus mort (sans tapId) comme processus vivant (avec
    // le tapId de l'événement rowAction, qui évite de compter l'appui deux fois). commit()
    // bloquant : le processus est tuable dès la fin du receiver. Tampon d'un appui DÉJÀ
    // ÉMIS : le lecteur seul écrit la progression, le natif n'interprète jamais cette entrée.
    static void savePendingRowAction(Context ctx, long projectId, String stepId, int delta) {
        savePendingRowAction(ctx, projectId, stepId, delta, null);
    }

    static void savePendingRowAction(Context ctx, long projectId, String stepId, int delta, String tapId) {
        try {
            JSONObject json = new JSONObject();
            json.put("v", 1);
            json.put("ts", System.currentTimeMillis());
            json.put("projectId", projectId);
            json.put("stepId", stepId);
            json.put("delta", delta);
            if (tapId != null) json.put("tapId", tapId);
            synchronized (PREFS_LOCK) {
                ctx.getSharedPreferences(PREFS_ROW, Context.MODE_PRIVATE)
                    .edit().putString(KEY_PENDING, json.toString()).commit();
            }
        } catch (JSONException e) {
            // Clés constantes : impossible en pratique. Pas d'appui retenu, comme avant.
        }
    }

    // Sous PREFS_LOCK : une entrée illisible est effacée, jamais celle écrite entre-temps.
    private static JSObject readPendingRowAction(Context ctx) {
        synchronized (PREFS_LOCK) {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_ROW, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_PENDING, null);
            if (raw == null) return null;
            try {
                JSONObject json = new JSONObject(raw);
                if (json.optInt("v", -1) != 1) return forgetPending(prefs);
                long id = json.optLong("projectId", -1);
                String stepId = json.optString("stepId", null);
                if (stepId == null || id <= 0) return forgetPending(prefs);
                JSObject pending = new JSObject();
                pending.put("projectId", id);
                pending.put("stepId", stepId);
                pending.put("delta", json.optInt("delta", 1));
                String tapId = json.optString("tapId", "");
                if (!tapId.isEmpty()) pending.put("tapId", tapId);
                return pending;
            } catch (JSONException e) {
                return forgetPending(prefs);
            }
        }
    }

    // Entrée illisible ou de version inconnue : effacée, rendue comme absente. Appelée sous
    // PREFS_LOCK.
    private static JSObject forgetPending(SharedPreferences prefs) {
        prefs.edit().remove(KEY_PENDING).commit();
        return null;
    }
}
