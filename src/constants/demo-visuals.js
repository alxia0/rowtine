// Photos des patrons de démonstration — des data URL, comme les photos ajoutées par
// l'utilisatrice : le même code d'affichage et la même visionneuse plein écran les
// prennent en charge sans cas particulier.
//
// HISTORIQUE. Les photos des vrais patrons ont été retirées le 30/07 (contenu sous
// copyright, et 989 Ko dans l'APK) et remplacées par des croquis SVG dessinés maison.
// Le 12/08, ces croquis cèdent la place à trois photographies générées par IA — libres
// de droits pour le projet, et bien plus parlantes qu'un trait : une utilisatrice qui
// ouvre l'app pour la première fois voit un vrai bonnet, une vraie écharpe, un vrai sac.
//
// LES NOMS D'EXPORT NE CHANGENT PAS. `DEMO_SKETCH_*` est ce qu'importent les quatre
// fichiers src/constants/demo/<langue>.js. Les renommer n'apporterait rien et
// multiplierait les sites de changement — le nom dit d'où vient la chose, pas ce
// qu'elle est.
//
// LA FORME NE CHANGE PAS NON PLUS, et c'est le point important : ces chaînes sont
// écrites dans `photos[0]` de la fiche patron, donc SÉRIALISÉES dans les sauvegardes et
// dans l'export .zip. Une data URL survit à l'aller-retour ; un chemin `public/...`
// deviendrait une image cassée après restauration sur un autre appareil. C'est la
// troisième fois qu'une image des patrons d'exemple menace la restauration : l'image est
// rattachée au PATRON, et `resolveCover` (src/utils/project-cover.js) y retombe pour
// donner leur couverture aux projets liés.
import { PHOTO_BONNET, PHOTO_ECHARPE, PHOTO_SAC } from '@/generated/demo-photos'

export const DEMO_SKETCH_BONNET = PHOTO_BONNET
export const DEMO_SKETCH_ECHARPE = PHOTO_ECHARPE
export const DEMO_SKETCH_SAC = PHOTO_SAC
