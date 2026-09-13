// Source unique du numéro de version, du numéro de build et du nom du créateur, pour
// l'écran À propos.
//
// Version et build : lus depuis package.json (source unique partagée avec
// android/app/build.gradle, cf. commentaire là-bas) — jamais recopiés en dur ici. Vite
// résout les imports JSON nativement, y compris sous Vitest (même moteur).
//
// Import NOMMÉ (pas `import pkg from '../../package.json'`) : un import par défaut embarque
// tout l'objet dans le chunk, devDependencies et scripts compris (~2,5 Ko mesurés en revue,
// 02/08) ; Rollup peut faire du tree-shaking sur des imports nommés et ne garder que ce qui
// est réellement utilisé.
import { version, buildNumber } from '../../package.json'

export const APP_VERSION = version
export const APP_BUILD = buildNumber

// Nom du créateur affiché dans « À propos ». Corrigé le 09/08/2026 suite à un retour d'usage :
// l'app est créée par Alexia O., c'est ce nom-là qui doit apparaître (un nom provisoire était
// utilisé jusque-là). Contrairement au nom de l'app (src/i18n/*.json,
// clé `app.name`), il n'y a pas de raison de le faire varier par langue.
export const APP_CREATOR = 'Alexia O.'
