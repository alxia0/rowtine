package com.rowtine.app;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;

// Sélection ET décodage d'une image de galerie côté natif, en repli du chemin
// <input type="file"> (utils/photo.js) qui livre les octets d'origine à la WebView :
// Chromium/WebView ne sait pas décoder le HEIC/HEIF (réglage « haute efficacité » par
// défaut sur de nombreux appareils Android récents), ce qui laisse un cadre de
// recadrage vide (bug remonté par Anne-Sophie, 21/09/2026, confirmé avec un fichier
// HEIC réel). android.graphics.ImageDecoder (API 28+) EST le décodeur HEIF de l'OS,
// aucune bibliothèque tierce, donc aucune licence LGPL à embarquer (alternative
// heic2any/heic-to écartée pour cette raison).
@CapacitorPlugin(name = "ImageDecode")
public class ImageDecodePlugin extends Plugin {

    private static final int MAX_DIM = 1280;
    private static final int JPEG_QUALITY = 80;

    @PluginMethod
    public void pickAndDecode(PluginCall call) {
        // ImageDecoder (et le décodage HEIF de l'OS en général) n'existe pas avant
        // Android 9. minSdkVersion vaut 24 : on rejette ICI, AVANT d'ouvrir le moindre
        // sélecteur, avec un code distinct. Le JS (utils/photo.js) reconnaît ce code et
        // repart sur le chemin web (input fichier + décodage WebView, JPEG/PNG), au lieu
        // d'ouvrir un sélecteur pour rien puis d'annoncer un échec de décodage.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("décodage indisponible sous Android 9 (API " + Build.VERSION.SDK_INT + ")", "UNSUPPORTED_API");
            return;
        }
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Sélecteur de photos moderne (Android 13+) : même sélecteur que celui déjà
            // utilisé par <input type="file"> côté WebView (aucune permission requise,
            // READ_MEDIA_IMAGES a été retirée le 21/09/2026 précisément parce qu'il ne
            // la requiert pas, à ne pas réintroduire).
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            // Filtre MIME comme la branche ACTION_OPEN_DOCUMENT ci-dessous : sans lui, le
            // sélecteur propose aussi les vidéos, dont le décodage échouerait ensuite.
            intent.setType("image/*");
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
        }
        startActivityForResult(call, intent, "imagePicked");
    }

    @ActivityCallback
    private void imagePicked(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) {
            // Sélecteur annulé : résolution normale avec dataUrl null, jamais un rejet
            // (même convention que RowtineSafPlugin.folderChosen pour une annulation).
            JSObject ret = new JSObject();
            ret.put("dataUrl", (String) null);
            call.resolve(ret);
            return;
        }
        try {
            ImageDecoder.Source source = ImageDecoder.createSource(getContext().getContentResolver(), uri);
            Bitmap decoded = ImageDecoder.decodeBitmap(source, (decoder, info, src) -> {
                // Sous-échantillonnage AU DÉCODAGE plutôt qu'après : évite de matérialiser
                // un bitmap plein format en mémoire avant de le réduire (une photo
                // moderne peut dépasser 12 Mpx).
                int w = info.getSize().getWidth();
                int h = info.getSize().getHeight();
                int sample = 1;
                while (Math.max(w, h) / (sample * 2) >= MAX_DIM) sample *= 2;
                if (sample > 1) decoder.setTargetSampleSize(sample);
                // Allocation LOGICIELLE obligatoire : par défaut ImageDecoder rend un
                // bitmap Config.HARDWARE, que canvas.drawBitmap() refuse sur un Canvas
                // logiciel (IllegalArgumentException). Sans cette ligne, l'import échoue
                // pour presque toutes les photos réelles, HEIC ou non.
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            });

            double scale = Math.min(1.0, (double) MAX_DIM / Math.max(decoded.getWidth(), decoded.getHeight()));
            int outW = Math.max(1, (int) Math.round(decoded.getWidth() * scale));
            int outH = Math.max(1, (int) Math.round(decoded.getHeight() * scale));

            Bitmap out = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            // Fond blanc AVANT le dessin : même règle que resizeDataUrl (image-resize.js)
            // et PhotoCropper.confirm() : un JPEG n'a pas d'alpha, un canvas transparent
            // composité sans remplissage devient noir. C'est l'ABSENCE de cette étape
            // côté LegacyCameraFlow.java (plugin @capacitor/camera) qui avait produit le
            // défaut PNG-transparent→noir du 04/09 ; on ne le répète pas ici.
            canvas.drawColor(Color.WHITE);
            canvas.drawBitmap(decoded, null, new Rect(0, 0, outW, outH), null);
            decoded.recycle();

            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            out.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, bos);
            out.recycle();

            JSObject ret = new JSObject();
            ret.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            // Fichier choisi mais illisible (format non supporté même par l'OS, fichier
            // corrompu) : à distinguer d'une annulation. Le JS (utils/photo.js) affiche
            // un message à l'utilisatrice sur ce rejet, contrairement à une résolution
            // avec dataUrl null.
            call.reject("décodage impossible : " + e.getMessage(), e);
        }
    }
}
