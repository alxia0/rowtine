package com.rowtine.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// Plugin de stockage SAF : dossier désigné par l'utilisatrice (ACTION_OPEN_DOCUMENT_TREE),
// permission persistée, opérations par chemin relatif via DocumentFile. Seul backend de
// stockage depuis N3 (le plugin MANAGE a été retiré).
@CapacitorPlugin(name = "RowtineSaf")
public class RowtineSafPlugin extends Plugin {

    private static final String PREFS = "rowtine_saf";
    private static final String KEY_URI = "tree_uri";
    private static final String KEY_BASE = "base_name";

    // Désignation en attente (phase 1) : URI accordée + sondes demandées par le JS,
    // PAS encore persistés. confirmFolder valide et persiste, discardFolder jette.
    private volatile Uri pendingUri;

    // Sondes factuelles de la désignation en attente, lues sur l'appel chooseFolder
    // AVANT l'ouverture du sélecteur : l'aller-retour activité (navigation de
    // l'utilisatrice dans le picker) ne doit rien devoir aux arguments que l'appel
    // transporte encore à son retour. Le natif n'a AUCUNE liste à lui — il sonde ce
    // que le JS lui passe (folder-base.js) et rapporte les hits bruts.
    private volatile java.util.List<String> pendingProbes;

    // Racine effective mémorisée (arbre accordé → descente base_name). Évite un
    // findFile(base) par op ; invalidée avec le cache de dossiers (purge à toute
    // mutation) et à toute (re)désignation. volatile : lue/écrite hors du fil UI.
    private volatile DocumentFile cachedEffectiveRoot;

    // Cache de handles de DOSSIERS (jamais de fichiers) : évite que resolveDir
    // ré-énumère findFile (→ listFiles = requête ContentResolver) à chaque segment
    // de chaque op. Clé = chemin normalisé (segments joints par '/'). Purge INTÉGRALE
    // à toute mutation — invalidation grossière mais sûre, choisie faute de validation
    // device en session (un handle périmé après rename/remove écrirait au mauvais endroit).
    private final Map<String, DocumentFile> dirCache = new ConcurrentHashMap<>();

    private void clearDirCache() { dirCache.clear(); cachedEffectiveRoot = null; }

    // Sonde de capacite d'une ecriture MULTI-TRANCHES en cours : « ce fournisseur
    // sait-il mesurer un document ? ». Cle = URI du document temporaire (et NON le
    // chemin relatif : deux dossiers designes, ou une re-designation en cours de
    // session, produisent le meme chemin relatif pour deux documents differents).
    // Posee a la tranche 0, lue par les suivantes, RETIREE a la publication comme a
    // tout rejet — une entree perimee ferait refuser une ecriture legitime chez un
    // fournisseur aveugle. Ce n'est PAS un cache general de capacite : une ecriture
    // en un seul appel n'y entre jamais, faute de tranche a sequencer derriere elle.
    private final Map<String, Boolean> measuringWrites = new ConcurrentHashMap<>();

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // URI d'arbre mémorisée ET encore autorisée en persistance, sinon null.
    private Uri persistedTreeUri() {
        String saved = prefs().getString(KEY_URI, null);
        if (saved == null) return null;
        Uri uri = Uri.parse(saved);
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isReadPermission() && p.isWritePermission()) return uri;
        }
        return null; // droit perdu (réinstallation) → re-désignation nécessaire
    }

    // Racine EFFECTIVE : dossier accordé, puis descente dans base_name si non vide.
    // Toute la logique de chemins (resolveDir/locate) reste relative à cette racine.
    private DocumentFile treeRoot() {
        DocumentFile cached = cachedEffectiveRoot;
        if (cached != null) return cached;
        Uri uri = persistedTreeUri();
        if (uri == null) return null;
        DocumentFile granted = DocumentFile.fromTreeUri(getContext(), uri);
        if (granted == null) return null;
        String base = prefs().getString(KEY_BASE, "");
        DocumentFile eff = base.isEmpty() ? granted : granted.findFile(base);
        // base non vide : enfant supprimé en externe → « pas de dossier ». base vide :
        // eff EST le dossier accordé (non null ici) — seul isDirectory() peut encore
        // le faire échouer, quand le dossier a disparu de l'arbre.
        if (eff == null || !eff.isDirectory()) return null;
        cachedEffectiveRoot = eff;
        return eff;
    }

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        // L'app crée elle-même le dossier « Rowtine » (find-or-create sous le parent
        // accordé) : le picker n'a plus à atterrir sur un « Rowtine » à créer par
        // l'utilisatrice.
        //
        // ATTERRISSAGE SUR `Documents` (10/08/2026), et non plus sur la racine `primary:`.
        // Mesuré sur un Pixel 7 (Android 17) : ouvert sur la racine, le bouton « Utiliser ce
        // dossier » est GRISÉ — Android 11+ interdit d'accorder la racine du stockage partagé.
        // L'utilisatrice devait donc deviner qu'il fallait d'abord descendre d'un cran, sans
        // que rien ne le lui dise. En atterrissant dans `Documents`, le bouton est actif
        // immédiatement : un seul appui, sans navigation.
        //
        // `EXTRA_INITIAL_URI` n'est qu'une SUGGESTION : si `Documents` n'existe pas sur un
        // appareil, le sélecteur retombe de lui-même sur un emplacement valide plutôt que
        // d'échouer. Aucun repli à écrire ici.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Uri initialUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents", "primary:Documents");
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
        }
        // Lecture des sondes AVANT l'aller-retour activité : elles sont mémorisées
        // dans le champ pendingProbes, pas relues sur l'appel au retour.
        JSArray rawProbes = call.getArray("probes");
        java.util.List<String> probes = new java.util.ArrayList<>();
        if (rawProbes != null) {
            for (int i = 0; i < rawProbes.length(); i++) {
                Object o = rawProbes.opt(i);
                // Coercion défensive : le contrat promet string[], mais une entrée
                // non chaîne est IGNORÉE plutôt que rejetée — invalider tout
                // l'aller-retour du sélecteur pour une entrée de trop transformerait
                // un défaut côté pont (affaire JS) en panne de désignation.
                if (o instanceof String) probes.add((String) o);
            }
        }
        pendingProbes = probes;
        startActivityForResult(call, intent, "folderChosen");
    }

    @ActivityCallback
    private void folderChosen(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) {
            // Sélecteur annulé : plus rien n'est en attente (pendingUri n'a jamais été
            // posé, les sondes mémorisées à l'ouverture ne servent plus à rien).
            pendingProbes = null;
            ret.put("granted", false);
            ret.put("name", (String) null);
            ret.put("probeHits", new JSArray());
            call.resolve(ret);
            return;
        }
        final int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        DocumentFile granted = DocumentFile.fromTreeUri(getContext(), uri);
        // Faits bruts, AUCUNE décision : chaque sonde passée par le JS est cherchée
        // sur l'arbre accordé (findFile + isDirectory) et le hit revient tel quel.
        // La politique — quelle base retenir — appartient à folder-base.js.
        JSArray probeHits = new JSArray();
        java.util.List<String> probes = pendingProbes;
        if (granted != null && probes != null) {
            for (String p : probes) {
                DocumentFile hit = granted.findFile(p);
                if (hit == null) continue; // sonde sans réponse : n'apparaît pas dans les hits
                JSObject h = new JSObject();
                h.put("name", p);
                h.put("isDir", hit.isDirectory());
                probeHits.put(h);
            }
        }
        // Mémorise l'attente ; NE PERSISTE PAS (confirmFolder le fera).
        pendingUri = uri;
        ret.put("granted", true);
        ret.put("name", granted != null ? granted.getName() : null);
        ret.put("probeHits", probeHits);
        call.resolve(ret);
    }

    @PluginMethod
    public void confirmFolder(PluginCall call) {
        Uri uri = pendingUri;
        if (uri == null) { call.reject("aucune désignation en attente"); return; }
        // La SEULE décision que le natif applique, et il la VALIDE : base vide (le
        // dossier accordé est retenu tel quel) ou l'enfant « Rowtine ». Toute autre
        // valeur est rejetée, pas interprétée — un chemin arbitraire venu du pont
        // créerait ou désignerait n'importe quoi sur l'arbre accordé.
        String base = call.getString("base");
        if (base == null || (!base.isEmpty() && !"Rowtine".equals(base))) {
            call.reject("base invalide : " + base);
            return;
        }
        DocumentFile granted = DocumentFile.fromTreeUri(getContext(), uri);
        if (granted == null) { call.reject("dossier accordé invalide"); return; }
        if (!base.isEmpty()) {
            DocumentFile child = granted.findFile(base);
            if (child == null) child = granted.createDirectory(base);
            if (child == null || !child.isDirectory()) { call.reject("création du dossier Rowtine impossible"); return; }
        }
        // Relâche la permission de l'ancien dossier si on en change.
        String oldSaved = prefs().getString(KEY_URI, null);
        if (oldSaved != null && !oldSaved.equals(uri.toString())) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                        Uri.parse(oldSaved),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { /* ancienne permission déjà perdue : sans effet */ }
        }
        prefs().edit().putString(KEY_URI, uri.toString()).putString(KEY_BASE, base).apply();
        pendingUri = null;
        pendingProbes = null;
        clearDirCache(); // nouvelle racine effective
        measuringWrites.clear(); // racine changee : toutes les URI sondees sont caduques
        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void discardFolder(PluginCall call) {
        if (pendingUri != null) {
            String saved = prefs().getString(KEY_URI, null);
            // Ne relâcher que si ce n'est PAS le dossier actif persisté : re-sélectionner
            // le MÊME dossier puis annuler ne doit pas révoquer l'accès en cours
            // (takePersistableUriPermission est idempotent → une seule permission par URI).
            if (saved == null || !saved.equals(pendingUri.toString())) {
                try {
                    getContext().getContentResolver().releasePersistableUriPermission(
                            pendingUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) { /* rien à relâcher */ }
            }
            pendingUri = null;
            pendingProbes = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void hasFolder(PluginCall call) {
        DocumentFile root = treeRoot(); // racine EFFECTIVE (descend base_name)
        JSObject ret = new JSObject();
        ret.put("granted", root != null && root.canWrite());
        ret.put("name", root != null ? root.getName() : null);
        // Identifiant DISCRIMINANT (avenant 04/08/2026, tâche 8) : `name` ne
        // discrimine PAS. Avant l'adoption de dossier il valait toujours « Rowtine »
        // (treeRoot() descendait systématiquement dans base_name) ; depuis, la base
        // peut être vide (folder-base.js) et la racine effective porte le nom du
        // dossier choisi — deux dossiers DIFFÉRENTS peuvent donc porter le même nom.
        // `tree_uri`, en revanche, est persistée dans les SharedPreferences et
        // discrimine réellement.
        ret.put("uri", prefs().getString(KEY_URI, null));
        call.resolve(ret);
    }

    private boolean isUnsafe(String path) {
        if (path == null) return false;
        for (String seg : path.split("/")) if (seg.equals("..")) return true;
        return false;
    }

    private String[] segments(String path) {
        if (path == null || path.isEmpty()) return new String[0];
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String s : path.split("/")) if (!s.isEmpty() && !s.equals(".")) out.add(s);
        return out.toArray(new String[0]);
    }

    // Résout le DOSSIER au chemin donné. create=true → crée les dossiers manquants.
    // Retourne null si un segment est un fichier (conflit) ou si absent sans create.
    private DocumentFile resolveDir(DocumentFile root, String[] segs, int len, boolean create) {
        if (len <= 0) return root;
        StringBuilder full = new StringBuilder();
        for (int i = 0; i < len; i++) { if (i > 0) full.append('/'); full.append(segs[i]); }
        DocumentFile hit = dirCache.get(full.toString());
        if (hit != null) return hit;

        DocumentFile cur = root;
        StringBuilder running = new StringBuilder();
        for (int i = 0; i < len; i++) {
            if (i > 0) running.append('/');
            running.append(segs[i]);
            String rk = running.toString();
            DocumentFile step = dirCache.get(rk);
            if (step != null) { cur = step; continue; } // ancêtre déjà caché
            DocumentFile next = cur.findFile(segs[i]);
            if (next == null) {
                if (!create) return null;
                next = cur.createDirectory(segs[i]);
                if (next == null) return null;
            } else if (!next.isDirectory()) {
                return null; // un fichier occupe ce segment
            }
            cur = next;
            dirCache.put(rk, cur); // ne cache QUE des dossiers
        }
        return cur;
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        clearDirCache();
        String path = call.getString("path", "");
        if (isUnsafe(path)) { call.reject("chemin invalide (..)"); return; }
        DocumentFile root = treeRoot();
        if (root == null) { call.reject("aucun dossier désigné"); return; }
        String[] segs = segments(path);
        DocumentFile dir = resolveDir(root, segs, segs.length, true);
        if (dir == null) { call.reject("mkdir a échoué : " + path); return; }
        call.resolve();
    }

    @PluginMethod
    public void exists(PluginCall call) {
        String path = call.getString("path");
        if (isUnsafe(path)) { call.reject("chemin invalide (..)"); return; }
        DocumentFile root = treeRoot();
        JSObject ret = new JSObject();
        ret.put("exists", root != null && locate(root, segments(path)) != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void readdir(PluginCall call) {
        String path = call.getString("path", "");
        if (isUnsafe(path)) { call.reject("chemin invalide (..)"); return; }
        JSArray entries = new JSArray();
        DocumentFile root = treeRoot();
        String[] segs = segments(path);
        DocumentFile dir = root == null ? null : resolveDir(root, segs, segs.length, false);
        if (dir != null && dir.isDirectory()) {
            for (DocumentFile child : dir.listFiles()) {
                JSObject e = new JSObject();
                e.put("name", child.getName());
                boolean isDir = child.isDirectory();
                e.put("isDir", isDir);
                // Taille en octets, fichiers seulement (0 pour un dossier : sans
                // objet). ⚠️ 0 signifie AUSSI « taille inconnue » :
                // DocumentFile.length() rend 0 chez certains fournisseurs SAF —
                // c'est le signal convenu avec le JS (restore.js) pour MASQUER
                // proprement la sous-barre de lecture du dossier en cours (total
                // à 0), jamais une taille à afficher.
                e.put("size", isDir ? 0 : child.length());
                entries.put(e);
            }
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries); // dossier absent → [] (parité)
        call.resolve(ret);
    }

    // Localise un fichier OU dossier au chemin exact, ou null.
    private DocumentFile locate(DocumentFile root, String[] segs) {
        if (segs.length == 0) return root;
        DocumentFile parent = resolveDir(root, segs, segs.length - 1, false);
        return parent == null ? null : parent.findFile(segs[segs.length - 1]);
    }

    // Suffixe du document TEMPORAIRE d'une écriture par tranches. Une écriture qui
    // s'étale sur plusieurs appels n'atterrit JAMAIS sous le nom final : elle
    // remplit `<nom>.part`, et le nom final n'apparaît qu'au tout dernier appel,
    // par renommage. Une appli tuée en cours de route laisse donc soit l'ANCIEN
    // fichier intact, soit un résidu `.part` — jamais un fichier tronqué qui
    // passerait pour valide. C'est le natif qui tient cet invariant, pas
    // l'appelant : aucun code JS ne peut placer une tranche sous le nom final.
    static final String PART_SUFFIX = ".part";

    // ECRITURE PAR TRANCHES : le pic memoire du pont est borne par MAX_CHUNK_BYTES,
    // JAMAIS par la taille du fichier — meme cause, sens inverse de readFile.
    //
    // MECANISME DU PLANTAGE (releve sur la tablette apres restauration) :
    //   java.lang.OutOfMemoryError: Failed to allocate a 3184976 byte allocation
    //     at org.json.JSONStringer.toString / org.json.JSONObject.toString
    //     at com.getcapacitor.Bridge.callPluginMethod(Bridge.java:835)
    // La frame est celle de Capacitor, PAS celle de cette methode : Bridge.java:834-835
    // fait `call.getData().toString()` sur les ARGUMENTS entrants AVANT d'invoquer le
    // plugin. Aucun code ecrit ici ne peut donc empecher cet OutOfMemoryError — la
    // seule prevention est que le JS n'envoie jamais plus d'une tranche a la fois.
    // Ce que le natif apporte, c'est de rendre la borne NON OPTIONNELLE : il refuse
    // toute charge utile superieure a MAX_CHUNK_BYTES, donc un appelant distrait
    // echoue partout et toujours, au lieu de « marcher » sur les appareils au gros
    // tas et de tomber sur une Nexus 7 selon la fragmentation du moment.
    //
    // Entree : path, data, encoding ("utf8"|"base64"),
    //          offset (octets deja ecrits, defaut 0),
    //          last   (derniere tranche, defaut true),
    //          total  (taille finale annoncee, facultatif, controlee a la publication).
    //
    // offset == 0 && last  -> ecriture DIRECTE sous le nom final, en un seul appel
    //                         (chemin d'origine, inchange : un petit fichier ne paie
    //                         ni tranche, ni fichier temporaire, ni renommage).
    // sinon                -> tranche : ecrite dans `<nom>.part`, publiee au dernier appel.
    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        if (isUnsafe(path)) { call.reject("chemin invalide (..)"); return; }
        int offset = call.getInt("offset", 0);
        if (offset < 0) { call.reject("decalage invalide : " + offset); return; }
        // Purge du cache de dossiers AVANT treeRoot(), comme le faisait la version
        // d'avant les tranches : `cachedEffectiveRoot` et les handles de dossiers
        // peuvent etre perimes (renommage, suppression), et un handle perime ecrirait
        // AU MAUVAIS ENDROIT. La purge n'a lieu qu'a la PREMIERE tranche : les
        // suivantes n'ecrivent que dans un document deja cree, et re-resoudre tout le
        // chemin par findFile pour chacune des ~33 tranches d'une photo de 3 Mo
        // couterait cher sur une tablette deja lente.
        if (offset == 0) clearDirCache();
        DocumentFile root = treeRoot();
        if (root == null) { call.reject("aucun dossier désigné"); return; }
        String data = call.getString("data", "");
        boolean b64 = "base64".equals(call.getString("encoding", "utf8"));
        Boolean lastFlag = call.getBoolean("last", Boolean.TRUE);
        boolean last = lastFlag == null || lastFlag;
        boolean chunked = offset > 0 || !last;
        String[] segs = segments(path);
        if (segs.length == 0) { call.reject("chemin vide"); return; }

        // Une tranche voyage TOUJOURS en base64 : couper de l'UTF-8 a un octet
        // arbitraire couperait un caractere accentue en deux, et les deux moities
        // seraient irrecuperables une fois ecrites.
        if (chunked && !b64) { call.reject("une tranche doit etre transmise en base64 : " + path); return; }
        // ALIGNEMENT BASE64, imperatif a l'ecriture aussi : 4 caracteres valent 3
        // octets. Une tranche NON finale dont le base64 n'est pas un multiple de 4,
        // ou qui porte du remplissage « = », ne decode pas exactement les octets
        // voulus — le fichier ecrit serait corrompu EN SILENCE, le pire cas possible
        // pour une sauvegarde. Refus bruyant plutot que corruption muette.
        if (chunked && !last && (data.length() % 4 != 0 || data.indexOf('=') >= 0)) {
            call.reject("tranche non alignee a l'octet " + offset + " de " + path
                    + " : le base64 d'une tranche non finale doit etre un multiple de 4 caracteres, sans remplissage");
            return;
        }

        byte[] bytes = b64 ? Base64.decode(data, Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
        // ECRETAGE : la borne est refusee ici, pas seulement conseillee cote JS.
        if (bytes.length > MAX_CHUNK_BYTES) {
            call.reject("charge utile hors borne pour " + path + " : " + bytes.length
                    + " octets pour un maximum de " + MAX_CHUNK_BYTES + " — le pont doit ecrire par tranches");
            return;
        }

        DocumentFile parent = resolveDir(root, segs, segs.length - 1, true);
        if (parent == null) { call.reject("dossier parent impossible : " + path); return; }
        String name = segs[segs.length - 1];

        // TOUTE ecriture passe par le document temporaire, quelle que soit sa taille
        // (decision du 13/08/2026). L'ancien chemin court (`delete` puis `create` puis
        // `write` sous le nom final) indexait la protection sur la TAILLE et non sur le
        // BESOIN : un projet.json, patron.json, patron.md, corbeille.json,
        // reglages.json ou manifeste.json pouvait toujours apparaitre TRONQUE sous son
        // nom final, et restore.js fait `JSON.parse` sans garde — un projet.json
        // tronque fait echouer la restauration ENTIERE, pas une entree.
        // Le cout est UN renommage de plus par petit fichier ; l'aller-retour reste
        // UNIQUE (creation, ecriture et publication tiennent dans ce seul appel).
        String tmpName = name + PART_SUFFIX;
        DocumentFile tmp;
        if (offset == 0) {
            // Un residu d'une ecriture interrompue est jete, jamais complete : on ne
            // sait rien de son contenu.
            DocumentFile stale = parent.findFile(tmpName);
            if (stale != null && !stale.delete()) { call.reject("residu impossible a effacer : " + path + PART_SUFFIX); return; }
            tmp = parent.createFile("application/octet-stream", tmpName);
            if (tmp == null) { call.reject("création impossible : " + path + PART_SUFFIX); return; }
            // createFile ne garantit PAS que le nom obtenu est le nom demande : un
            // fournisseur peut desambiguiser en « x (1) ». On ne suppose rien du
            // comportement, on CONSTATE le nom obtenu — sinon les tranches suivantes
            // iraient chercher un document qui n'existe pas sous ce nom.
            if (!tmpName.equals(tmp.getName())) {
                call.reject("nom temporaire inattendu pour " + path + " : le fournisseur a cree \""
                        + tmp.getName() + "\" au lieu de \"" + tmpName + "\"");
                return;
            }
        } else {
            tmp = parent.findFile(tmpName);
            if (tmp == null || tmp.isDirectory()) {
                call.reject("tranche orpheline pour " + path + " : le fichier temporaire a disparu");
                return;
            }
            // Controle de sequence. CONDITIONNEL a `have > 0` seulement chez un
            // fournisseur dont on a MESURE qu'il ne sait pas mesurer (cf. sonde
            // ci-dessous) : DocumentFile.length() rend 0 chez certains, et un controle
            // inconditionnel y refuserait la 2e tranche, si bien que plus AUCUN gros
            // fichier ne s'ecrirait. Chez un fournisseur qui SAIT mesurer, le controle
            // est obligatoire — sans quoi un mode "wa" qui tronquerait a chaque tranche
            // publierait un fichier ne contenant que la DERNIERE, sans une ligne de log.
            long have = tmp.length();
            boolean measures = Boolean.TRUE.equals(measuringWrites.get(tmp.getUri().toString()));
            if ((measures || have > 0) && have != offset) {
                measuringWrites.remove(tmp.getUri().toString());
                call.reject("tranche desordonnee pour " + path + " : le fichier temporaire porte "
                        + have + " octets, la tranche annonce le decalage " + offset);
                return;
            }
        }

        // "wa" = ajout en fin de fichier. Chaque tranche ouvre et referme son flux :
        // le natif ne garde AUCUN flux entre deux appels du pont, donc rien a fuir si
        // l'application est tuee entre deux tranches.
        String mode = offset == 0 ? "wt" : "wa";
        try (OutputStream out = getContext().getContentResolver().openOutputStream(tmp.getUri(), mode)) {
            if (out == null) { call.reject("ouverture impossible en mode \"" + mode + "\" (ajout en fin de fichier) : " + path); return; }
            out.write(bytes);
        } catch (Exception e) {
            measuringWrites.remove(tmp.getUri().toString());
            call.reject("écriture de tranche impossible en mode \"" + mode + "\" (ajout en fin de fichier) : " + e.getMessage(), e);
            return;
        }

        // SONDE DE CAPACITE, armee a la tranche 0 d'une ecriture MULTI-TRANCHES. On
        // vient d'ecrire `bytes.length` octets en "wt" sur un document neuf : si
        // length() les retrouve, ce fournisseur sait mesurer, et les controles de
        // sequence et de total deviennent OBLIGATOIRES pour la suite de CETTE ecriture.
        // Sans cela, les deux controles tombent ENSEMBLE sur la meme reserve `> 0`, et
        // un "wa" mal implemente chez un fournisseur aveugle publie un fichier
        // silencieusement ampute. Une ecriture en UN SEUL appel n'est pas sondee : il
        // n'y a aucune tranche a sequencer derriere elle.
        if (offset == 0 && !last) {
            measuringWrites.put(tmp.getUri().toString(), tmp.length() == bytes.length);
        }
        if (!last) { call.resolve(); return; }

        // PUBLICATION. Derniere occasion de refuser : une tranche perdue rendrait un
        // fichier plus court que la taille annoncee, et c'est au renommage que la
        // corruption deviendrait definitive.
        String probeKey = tmp.getUri().toString();
        // La cle est TOUJOURS retiree — une entree perimee ferait rejeter une ecriture
        // parfaitement legitime plus tard — mais elle n'est CONSULTEE que pour une
        // ecriture en plusieurs appels : une ecriture en un seul appel n'arme jamais la
        // sonde, et l'URI d'un document etant derivee de son chemin chez
        // ExternalStorageProvider, elle retomberait sinon sur le residu d'une ecriture
        // multi-tranches abandonnee au meme endroit.
        Boolean sonde = measuringWrites.remove(probeKey);
        boolean measures = offset > 0 && Boolean.TRUE.equals(sonde);
        int total = call.getInt("total", -1);
        // ATTENDU : la taille annoncee par l'appelant quand il en donne une, sinon —
        // ecriture en UN SEUL appel — le nombre d'octets que CE MEME appel vient de
        // decoder. Rien n'est deduit d'une chaine cote JS : une longueur base64 deduite
        // serait fausse sur un base64 enroule, que le decodeur Java accepte pourtant.
        // Le natif compare donc ce qu'il a ECRIT a ce qu'il RELIT, deux grandeurs qu'il
        // tient lui-meme. Sans cela, tout binaire de moins de 96 Kio — donc TOUTES les
        // photos, mesurees a 54 706 / 67 464 / 84 150 octets sur le Huawei — etait
        // publie sans qu'on sache ce qui avait atterri, alors que le projet.json d'a
        // cote, lui, etait verifie.
        long expected = total >= 0 ? total : (offset == 0 ? bytes.length : -1);
        long written = tmp.length();
        if (expected >= 0 && (measures || written > 0) && written != expected) {
            call.reject("ecriture incomplete pour " + path + " : " + written + " octets pour "
                    + expected + " attendus — le fichier temporaire n'est PAS publie");
            return;
        }
        // FOURNISSEUR AVEUGLE + ecriture multi-tranches : length() n'ayant rien dit,
        // ni la garde de sequence ni celle du total n'ont pu mordre, et un mode "wa"
        // qui tronquerait publierait un fichier ne contenant que la DERNIERE tranche,
        // sans une ligne de log. On compte alors les octets en les faisant DEFILER
        // (tampon de 8 Kio, rien ne s'accumule en memoire : la borne du pont tient).
        // Cout paye uniquement dans ce mode degrade — les deux appareils valides ont
        // un fournisseur qui mesure, donc ils n'y passent jamais.
        if (expected >= 0 && !measures && written <= 0) {
            long counted;
            try {
                counted = countBytes(tmp);
            } catch (Exception e) {
                // Une ecriture en PLUSIEURS appels n'a aucune autre garde : ne pas
                // pouvoir verifier est alors un echec. Une ecriture en UN SEUL appel,
                // elle, n'avait AUCUN controle jusqu'ici ; transformer l'echec d'un
                // controle AJOUTE en echec d'une ecriture qui a reussi ferait perdre
                // des sauvegardes qui marchaient. On renonce a verifier, sans rejeter.
                if (offset > 0) { call.reject("verification impossible pour " + path + " : " + e.getMessage(), e); return; }
                counted = -1;
            }
            if (counted >= 0 && counted != expected) {
                call.reject("ecriture incomplete pour " + path + " : " + counted
                        + " octets comptes pour " + expected + " attendus — le fichier temporaire n'est PAS publie");
                return;
            }
        }
        clearDirCache();
        DocumentFile existing = parent.findFile(name);
        // SAF n'offre aucun remplacement atomique : il faut effacer la cible avant de
        // renommer. La fenetre entre les deux ne transporte AUCUNE donnee ; une appli
        // tuee pile la laisse le fichier ABSENT, pas tronque — la sauvegarde suivante
        // le reecrit. Absent est rattrapable, corrompu ne l'est pas.
        if (existing != null && !existing.delete()) { call.reject("remplacement impossible : " + path); return; }
        try {
            Uri renamed = DocumentsContract.renameDocument(getContext().getContentResolver(), tmp.getUri(), name);
            if (renamed == null) { call.reject("publication impossible : " + path); return; }
            // Un URI non nul dit que l'operation n'a pas echoue, PAS sous quel nom le
            // document a atterri : c'est le fournisseur qui tranche, et il peut
            // desambiguiser (collision de casse, entree recreee entre-temps, cible dont
            // la suppression a rendu `true` sans effet). On ne suppose donc rien de son
            // comportement et on CONSTATE que le fichier existe bien sous le nom vise —
            // deux lignes qui transforment un silence en rejet. Aucune execution
            // reussie n'exerce cette branche : elle ne peut pas etre validee sur
            // appareil, seulement rendue impossible a franchir sans bruit.
            if (parent.findFile(name) == null) {
                call.reject("publication non confirmee pour " + path
                        + " : le renommage a reussi mais aucun fichier ne porte ce nom");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("publication impossible : " + e.getMessage(), e);
        }
    }

    // Taille d'une tranche du pont, DANS LES DEUX SENS (lecture et ecriture) : le pic
    // memoire du pont est borne par cette constante, JAMAIS par la taille du fichier.
    // En lecture, Capacitor serialise le resultat en
    // JSON (JSONStringer -> StringBuilder -> String), donc trois exemplaires de la
    // meme chaine cohabitent le temps de call.resolve(). Un fichier de 2,4 Mo
    // (3,18 Mo en base64) suffisait a saturer les 16 Mo de tas d'une Nexus 7
    // (OutOfMemoryError dans StringFactory.newStringFromChars, reproduit 3x).
    // En ecriture, c'est le meme mecanisme en sens inverse : Bridge.java:834-835
    // serialise les ARGUMENTS entrants (`call.getData().toString()`) avant meme
    // d'invoquer la methode du plugin. Meme trace, meme tas, autre direction.
    //
    // MULTIPLE DE 3, imperatif : le base64 encode 3 octets en 4 caracteres. Une
    // tranche dont le nombre d'octets n'est pas multiple de 3 se termine par du
    // remplissage « = », et la CONCATENATION des tranches devient invalide. Comme
    // toute tranche sauf la derniere est PLEINE (voir la boucle de lecture), le
    // multiple de 3 de la constante garantit l'alignement par construction.
    //
    // 384 Kio = 3 × 131 072, multiple de 3 (invariant d'alignement base64). Mesuré le
    // 06/09/2026 : TOUTE requete SAF coute ~300 ms fixes sur une tablette lente (findFile
    // du parent = enumeration ContentResolver, + reouverture du flux) — le debit de la
    // sauvegarde ne depend donc QUE du nombre d'appels. La borne memoire reste le critere :
    // la pire allocation unitaire (char[] du JSONStringer, pessimiste 2 octets/char au
    // doublement) vaut ~2 Mo pour 384 Kio de tranche, sous l'allocation de 3 184 976 octets
    // qui a tue la tablette le 13/08 (OutOfMemoryError a JSONStringer.toString, ~2 505 Kio
    // restants). 768 Kio depasserait ce seuil : ne pas monter sans re-mesurer sur l'appareil.
    static final int MAX_CHUNK_BYTES = 393216; // 384 Kio = 3 × 131072

    // Lit UNE tranche du fichier, jamais plus de MAX_CHUNK_BYTES octets.
    //
    // Entree  : path, encoding ("utf8"|"base64"), offset (octets, defaut 0),
    //           length (octets, defaut et PLAFOND MAX_CHUNK_BYTES).
    // Sortie  : data      la tranche,
    //           size      taille TOTALE du fichier en octets (pour l'appelant),
    //           bytesRead octets de CETTE tranche,
    //           eof       vrai si la tranche atteint la fin du fichier,
    //           base64    vrai si data est du base64.
    //
    // `length` est ECRETE ici : meme un appelant qui demanderait le fichier entier
    // n'obtient qu'une tranche. La borne est donc structurelle, pas une convention
    // respectee cote application.
    //
    // Des qu'il y a decoupage (offset > 0, ou fin non atteinte), data est TOUJOURS
    // du base64 : couper de l'UTF-8 a un octet arbitraire couperait un caractere
    // multi-octets en deux. Le decodage UTF-8 se fait cote application, une fois le
    // fichier recompose.
    @PluginMethod
    public void readFile(PluginCall call) {
        String path = call.getString("path");
        if (isUnsafe(path)) { call.reject("chemin invalide (..)"); return; }
        DocumentFile root = treeRoot();
        DocumentFile f = root == null ? null : locate(root, segments(path));
        if (f == null || f.isDirectory()) { call.reject("fichier introuvable : " + path); return; }
        boolean b64 = "base64".equals(call.getString("encoding", "utf8"));
        long size = f.length();
        // Fichiers < 2 Gio : offset et length tiennent dans un int (une sauvegarde
        // Rowtine est faite de patrons et de photos, jamais de fichiers de cet ordre).
        int offset = call.getInt("offset", 0);
        if (offset < 0) { call.reject("decalage invalide : " + offset); return; }
        int want = call.getInt("length", MAX_CHUNK_BYTES);
        if (want <= 0 || want > MAX_CHUNK_BYTES) want = MAX_CHUNK_BYTES;
        // Ecretage a la baisse sur un multiple de 3 : conserve l'invariant
        // d'alignement meme si l'appelant demande une taille quelconque.
        want -= want % 3;
        if (want == 0) want = 3;
        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            // skip() peut sauter MOINS que demande sans lever d'exception. Un seul
            // appel a skip(offset) renverrait donc les MAUVAIS octets en silence :
            // corruption invisible, jamais signalee a la restauration. La boucle
            // repete jusqu'a atteindre EXACTEMENT le decalage ; si skip ne progresse
            // pas, elle avance d'un octet lu, ce qui garantit la progression. Elle ne
            // sort avant le decalage que sur une VRAIE fin de fichier.
            long skipped = 0;
            boolean hitEnd = false;
            while (skipped < offset) {
                long s = in.skip(offset - skipped);
                if (s > 0) { skipped += s; continue; }
                if (in.read() == -1) { hitEnd = true; break; }
                skipped++;
            }
            if (hitEnd) { // decalage au-dela de la fin : tranche vide, fin de fichier
                JSObject end = new JSObject();
                end.put("data", "");
                end.put("size", size);
                end.put("bytesRead", 0);
                end.put("eof", true);
                end.put("base64", true);
                call.resolve(end);
                return;
            }
            // Tampon PRE-DIMENSIONNE a la tranche et rempli en place : plus
            // d'accumulateur qui double sa capacite au fil de la lecture, ni de
            // recopie finale du tampon, soit deux copies completes de moins.
            byte[] buf = new byte[want];
            int filled = 0;
            while (filled < want) {
                int n = in.read(buf, filled, want - filled);
                if (n == -1) break;
                filled += n;
            }
            // Tranche incomplete = fin de fichier. C'est la SEULE tranche autorisee a
            // ne pas etre un multiple de 3 : l'appelant n'en concatene aucune apres.
            boolean eof = filled < want;
            boolean sliced = offset > 0 || !eof;
            String out = (b64 || sliced)
                    ? Base64.encodeToString(buf, 0, filled, Base64.NO_WRAP)
                    : new String(buf, 0, filled, StandardCharsets.UTF_8);
            JSObject ret = new JSObject();
            ret.put("data", out);
            ret.put("size", size);
            ret.put("bytesRead", filled);
            ret.put("eof", eof);
            ret.put("base64", b64 || sliced);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("lecture impossible : " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        clearDirCache();
        String path = call.getString("path");
        if (path == null || path.isEmpty()) { call.resolve(); return; } // jamais la racine
        if (isUnsafe(path)) { call.reject("chemin invalide (..)"); return; }
        DocumentFile root = treeRoot();
        DocumentFile f = root == null ? null : locate(root, segments(path));
        // DocumentFile.delete est récursif ; absent → no-op (idempotent, pas d'erreur)
        if (f != null && !f.delete()) { call.reject("suppression impossible : " + path); return; }
        call.resolve();
    }

    @PluginMethod
    public void rename(PluginCall call) {
        clearDirCache();
        String from = call.getString("from");
        String to = call.getString("to");
        if (from == null || from.isEmpty() || to == null || to.isEmpty()) { call.reject("chemin vide"); return; }
        if (isUnsafe(from) || isUnsafe(to)) { call.reject("chemin invalide (..)"); return; }
        if (from.equals(to)) { call.resolve(); return; }
        DocumentFile root = treeRoot();
        if (root == null) { call.reject("aucun dossier désigné"); return; }
        String[] fromSegs = segments(from), toSegs = segments(to);
        DocumentFile src = locate(root, fromSegs);
        if (src == null) { call.reject("source introuvable : " + from); return; }
        DocumentFile toParent = resolveDir(root, toSegs, toSegs.length - 1, true);
        DocumentFile fromParent = resolveDir(root, fromSegs, fromSegs.length - 1, false);
        String toName = toSegs[toSegs.length - 1];
        // Round-trip N0 : from/to partagent toujours le même parent → renameDocument en place.
        if (fromParent != null && toParent != null && fromParent.getUri().equals(toParent.getUri())) {
            DocumentFile dst = toParent.findFile(toName);
            if (dst != null && !dst.delete()) { // remplace la destination (parité)
                call.reject("renommage impossible : destination occupée : " + to);
                return;
            }
            try {
                // renameDocument peut renvoyer null en ÉCHEC SANS lever d'exception
                // (cf. revue finale, finding 3) : sans ce contrôle, l'appel résout comme
                // un succès alors que le dossier d'origine subsiste (doublon `slug [id]`).
                Uri renamed = DocumentsContract.renameDocument(getContext().getContentResolver(), src.getUri(), toName);
                if (renamed == null) {
                    call.reject("renommage impossible : " + from + " -> " + to);
                    return;
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("renommage impossible : " + e.getMessage(), e);
            }
            return;
        }
        // Cross-dossier (non exercé par le round-trip) : copie récursive + suppression.
        try {
            if (toParent == null) { call.reject("dossier cible impossible : " + to); return; }
            DocumentFile dst = toParent.findFile(toName);
            if (dst != null && !dst.delete()) {
                call.reject("renommage impossible : destination occupée : " + to);
                return;
            }
            copyRecursive(src, toParent, toName);
            if (!src.delete()) { call.reject("déplacement incomplet : " + from); return; }
            call.resolve();
        } catch (Exception e) {
            call.reject("déplacement impossible : " + e.getMessage(), e);
        }
    }

    // Le natif renvoie du BRUT, pas une décision : la composition (nom lisible à partir
    // du nom donné par l'utilisatrice, de la marque et du modèle) est faite côté JS
    // (device-identity.js), qui est testable — pas ce fichier Java.
    @PluginMethod
    public void deviceName(PluginCall call) {
        JSObject ret = new JSObject();
        String userName = null;
        try {
            userName = android.provider.Settings.Global.getString(
                getContext().getContentResolver(), "device_name");
        } catch (Exception ignored) { /* absent avant API 25, ou refusé : on s'en passe */ }
        ret.put("userName", userName == null ? "" : userName);
        ret.put("model", Build.MODEL == null ? "" : Build.MODEL);
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        call.resolve(ret);
    }

    // Compte les octets d'un document SANS jamais le charger en memoire : tampon fixe
    // de 8 Kio, on ne garde que le total. Seul moyen de verifier une ecriture chez un
    // fournisseur dont length() ne dit rien.
    private long countBytes(DocumentFile f) throws Exception {
        long n = 0;
        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            if (in == null) return -1;
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) != -1) n += r;
        }
        return n;
    }

    private void copyRecursive(DocumentFile src, DocumentFile destParent, String name) throws Exception {
        if (src.isDirectory()) {
            DocumentFile dir = destParent.createDirectory(name);
            if (dir == null) throw new Exception("création impossible : " + name);
            for (DocumentFile child : src.listFiles()) copyRecursive(child, dir, child.getName());
        } else {
            DocumentFile f = destParent.createFile("application/octet-stream", name);
            if (f == null) throw new Exception("création impossible : " + name);
            try (InputStream in = getContext().getContentResolver().openInputStream(src.getUri());
                 OutputStream out = getContext().getContentResolver().openOutputStream(f.getUri(), "wt")) {
                byte[] chunk = new byte[8192]; int n;
                while ((n = in.read(chunk)) != -1) out.write(chunk, 0, n);
            }
        }
    }
}
