// Emplacements PRÉVUS mais PAS ENCORE renseignés : ni l'adresse de contact ni le domaine du
// site (guide + pitch) n'existaient au 02/08.
// N'INVENTE AUCUNE VALEUR ICI — laisser vide tant que ce domaine n'a pas été choisi/acheté.
//
// Tant qu'une valeur est vide, le bloc correspondant de l'écran À propos ne se rend PAS :
// un bloc « Contact : » vide serait pire pour l'utilisatrice que pas de bloc du tout
// (AboutView.vue, `v-if="CONTACT_EMAIL"`). Le rappel qu'il faut les remplir AVANT diffusion
// vit dans tests/unit/app-links-todo.spec.js, pas ici. La rangée « Site web » n'a plus ce
// garde depuis le 12/08/2026 : `websiteUrlFor` ci-dessous (comme `guideUrlFor`) retombe
// toujours sur l'anglais et ne peut donc plus rendre une adresse vide — voir plus bas.

// FOURNIE le 05/08/2026. Deux écrans la lisent : « Nous contacter » (À propos) et
// le message des PDF scannés (LocalPdfImportView).
//
// ⚠️ NE PAS la remplacer par le dépôt sur « Nous contacter ». Essayé le 10/08 au matin, ANNULÉ
// le jour même après mesure sur un Pixel 7 : cf. `GITHUB_ISSUES_URL` ci-dessous. C'est la seule
// porte de l'app qui ne demande aucun compte.
export const CONTACT_EMAIL = 'contact@rowtine.app'

// Tickets du dépôt public. ADRESSE FOURNIE le 10/08/2026. Lue par « Suggérer une
// amélioration » (Réglages → Contribuer), qui ouvrait jusque-là le même client mail que
// « Nous contacter » — les deux rangées menaient au même endroit.
//
// ⚠️⚠️ MESURÉ SUR APPAREIL, et c'est ce qui a décidé de l'emplacement : sur un téléphone où
// l'application GitHub est installée, elle INTERCEPTE le lien et affiche « Sign in to
// GitHub.com ». Choisir le navigateur dans le sélecteur donne la même page. `curl` recevait
// pourtant la page publique en 200 sans redirection — la vérification en ligne de commande ne
// voit PAS ce que voit l'appareil. C'est le défaut exact reproché à l'adresse Gitea de la
// veille, et il n'a été vu que sur device.
//
// D'où la répartition : cette rangée-ci s'adresse à quelqu'un qui propose une amélioration
// (susceptible d'avoir un compte) ; « Nous contacter » garde le mail pour tous les autres.
//
// ⚠️ Au 10/08, le dépôt ne contient encore que la licence et le README (sa propre description
// annonce « Source code coming at 1.0 »). L'affirmation « open source » du guide et des fiches
// magasin ne deviendra donc vraie qu'une fois le code poussé.
export const GITHUB_ISSUES_URL = 'https://github.com/alxia0/rowtine/issues'

// Le SITE répond depuis le 12/08/2026 : une vérification en ligne a tranché la question.
// Ce n'est donc PLUS « toujours vide » — la rangée « Site web » d'À
// propos se rend de nouveau. Comme prévu par le commentaire d'origine, renseigner cette
// adresse a fait passer au ROUGE l'`it.fails` de tests/unit/app-links-todo.spec.js (un succès
// devenu échec) : converti là-bas en une vraie vérification de format, pas simplement
// supprimé.
//
// Défaut mesuré le 12/08/2026 : une seule adresse `https://rowtine.app/` redirige selon la
// langue du NAVIGATEUR, pas celle de l'app (vérifié par requête : `Accept-Language: fr` mène
// à `/fr/`, `en` à `/en/`). Une utilisatrice dont l'app est en français mais dont le
// navigateur système est en anglais arrivait donc sur le site en anglais. Tranché :
// cette rangée doit suivre la langue de l'APP, exactement comme le lien du guide en ligne
// ci-dessous — même table plate, même fonction de résolution, même repli sur l'anglais. Les
// quatre adresses ont été VÉRIFIÉES EN LIGNE le 12/08/2026 (HTTP 200, titre propre
// à chaque langue).
export const WEBSITE_URLS = {
  fr: 'https://rowtine.app/fr/',
  en: 'https://rowtine.app/en/',
  de: 'https://rowtine.app/de/',
  es: 'https://rowtine.app/es/',
}

// Résout la langue ACTIVE de l'interface vers l'adresse du site — même mécanisme et même
// repli que `guideUrlFor` juste en dessous : une langue inconnue ne doit jamais produire une
// adresse cassée.
export function websiteUrlFor(locale) {
  return WEBSITE_URLS[locale] ?? WEBSITE_URLS.en
}

// Adresses du guide EN LIGNE (celui qui se télécharge, sur le site), une par langue de
// l'interface — pas le même écran que le guide EMBARQUÉ dans l'app (GuideView.vue, contenu
// dans src/content/guide/). VÉRIFIÉES EN LIGNE le 12/08/2026 : les quatre
// répondent HTTP 200, avec le bon titre par langue, et la page française porte un PDF
// téléchargeable. ⚠️ `curl` nu reçoit 403 sur tout le domaine (un pare-feu bloque son agent
// par défaut) — ce n'est pas une preuve de mesure ici, la vérification a été faite avec un
// agent de navigateur.
//
// Recopiées telles quelles plutôt que dérivées d'un gabarit `${lang}` : les quatre adresses
// partagent aujourd'hui le même schéma (`/<lang>/guide/`), mais rien ne garantit qu'il le
// reste pour toujours — une page qui changerait de forme pour une seule langue romprait un
// calcul en silence, alors qu'une table plate se corrige ligne par ligne et se relit d'un
// coup d'œil.
export const GUIDE_URLS = {
  fr: 'https://rowtine.app/fr/guide/',
  en: 'https://rowtine.app/en/guide/',
  de: 'https://rowtine.app/de/guide/',
  es: 'https://rowtine.app/es/guide/',
}

// Résout la langue ACTIVE de l'interface vers son adresse. Une langue inconnue (filet pour
// une 5e langue future dont l'interface existerait avant que cette page du site soit
// traduite) ne doit JAMAIS produire une adresse cassée : repli explicite sur l'anglais — même
// choix que `fallbackLocale` de src/i18n/index.js et que le premier maillon de
// `FALLBACK_ORDER` dans src/content/guide/index.js, pas un 3e choix de repli inventé ici.
export function guideUrlFor(locale) {
  return GUIDE_URLS[locale] ?? GUIDE_URLS.en
}

// Page de dons « offrez-moi un café ». Adresse FOURNIE le 05/08/2026, le compte
// Ko-fi étant ouvert et en état de recevoir — elle n'est PAS déduite du nom de l'app ni
// devinée, malgré la ressemblance (le pseudo Ko-fi et le nom de l'app sont deux réservations
// indépendantes). Ne la modifier que sur indication explicite.
//
// Elle est renseignée, donc PAS de `v-if` comme pour les deux valeurs ci-dessus : la rangée
// « Soutenir » du bloc Contribuer (SettingsView.vue) se rend toujours.
//
// ⚠️ Emplacement : la décision du 02/08 avait tranché « aucun lien de don DANS l'app »
// (la politique Payments de Google Play n'exempte que les organismes reconnus d'utilité
// publique, un développeur indépendant n'entre pas dans cette case). Cette décision a été
// revue le 05/08 en connaissance du risque. Le lien ne déverrouille aucune fonction et ne
// promet aucune contrepartie — c'est ce qui le tient hors du champ « achat intégré ».
export const KOFI_URL = 'https://ko-fi.com/rowtine_app'
