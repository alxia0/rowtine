package com.rowtine.app;

import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Insets d'écran sûrs. WebView Android ne remonte via env(safe-area-inset-*) que
// l'encoche, jamais les barres système, alors que Capacitor 8 étend la WebView
// sous elles — d'où l'en-tête coupé par la barre d'état (mesuré 27/07 sur Nexus 7).
// Ce plugin lit les insets réels et les publie en dp (= px CSS) ; c'est
// src/native/safe-area.js qui les pose sur <html>.
@CapacitorPlugin(name = "SafeArea")
public class SafeAreaPlugin extends Plugin {

    private JSObject last = null;

    @Override
    public void load() {
        // decorView et PAS webView.getParent() ni android.R.id.content :
        // ViewCompat.setOnApplyWindowInsetsListener n'accepte QU'UN listener par vue,
        // et Capacitor occupe déjà celui de webView.getParent() (SystemBars.java).
        // Pire, sur cette combinaison (Android < 15 + WebView < 140) son listener
        // remet explicitement systemBars|displayCutout à zéro. Le decorView est en
        // amont dans la chaîne de distribution : on y voit donc les insets réels,
        // avant qu'ils ne soient annulés.
        final View root = getBridge().getActivity().getWindow().getDecorView();
        // On RENVOIE les insets inchangés : ce listener observe, il ne consomme pas.
        // Les consommer casserait la mise en page native (dont le contournement
        // adjustNothing du clavier, cf. AndroidManifest).
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets si = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout());
            JSObject payload = toDp(si);
            if (last == null || !payload.toString().equals(last.toString())) {
                last = payload;
                notifyListeners("safeAreaChanged", payload);
            }
            // ViewCompat.onApplyWindowInsets(v, ...) et PAS le simple retour de windowInsets :
            // poser un OnApplyWindowInsetsListener sur une vue COURT-CIRCUITE son
            // onApplyWindowInsets() natif (dispatchApplyWindowInsets appelle l'un OU
            // l'autre, jamais les deux) — mécanisme documenté du framework Android, pas une
            // supposition. Sur le decorView, onApplyWindowInsets() est ce qui peint les
            // scrims de barre de statut/navigation (updateColorViews). Retourner l'objet
            // brut à la place N'A PAS été mesuré sur device (aucun test A/B fait) : c'est
            // une PRÉCAUTION pour éviter de shunter ce rendu système, pas un défaut observé.
            // Cet appel invoque le vrai onApplyWindowInsets() du decorView sans redéclencher
            // le dispatch (donc pas de boucle) : on observe toujours sans consommer.
            return ViewCompat.onApplyWindowInsets(v, windowInsets);
        });
        ViewCompat.requestApplyInsets(root);
    }

    // get() plutôt qu'un simple événement : au démarrage à froid la page web n'est
    // pas encore chargée quand les premiers insets arrivent, l'événement serait
    // perdu. Le JS demande donc l'état courant dès qu'il est prêt.
    @PluginMethod
    public void get(PluginCall call) {
        if (last != null) {
            call.resolve(last);
            return;
        }
        final View root = getBridge().getActivity().getWindow().getDecorView();
        WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(root);
        if (wi == null) {
            call.reject("insets indisponibles");
            return;
        }
        last = toDp(wi.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout()));
        call.resolve(last);
    }

    private JSObject toDp(Insets px) {
        float d = getContext().getResources().getDisplayMetrics().density;
        JSObject o = new JSObject();
        o.put("top", Math.round(px.top / d));
        o.put("right", Math.round(px.right / d));
        o.put("bottom", Math.round(px.bottom / d));
        o.put("left", Math.round(px.left / d));
        return o;
    }
}
