// Installe une implémentation IndexedDB en mémoire AVANT tout import de Dexie,
// pour que les stores (@/db/db) s'ouvrent contre une base jetable.
import 'fake-indexeddb/auto'

// jsdom n'implémente pas window.scrollTo (émet un warning « Not implemented »).
// Plusieurs vues remontent la page à l'ouverture d'un formulaire (ex. StashView) :
// on le neutralise ici pour garder la sortie des tests propre, sans le mocker dans
// chaque test au cas par cas.
if (typeof globalThis.scrollTo !== 'function' || !('mock' in globalThis.scrollTo)) {
  globalThis.scrollTo = () => {}
  if (globalThis.window) globalThis.window.scrollTo = globalThis.scrollTo
}

// jsdom n'implémente PAS DU TOUT `Element.prototype.scrollIntoView` (contrairement à
// `window.scrollTo`, qui existe au moins en stub bruyant) : l'appeler lève
// `TypeError: ... is not a function`. Trouvé au lot du 19/08 (tâche « le guide s'ouvre sur
// une section ») — `GuideView.vue#openSection` y fait appel sur l'élément `<details>` visé,
// et c'est le premier test de la suite à exercer cette fonction pour de vrai (le test
// existant du guide clique seulement le sommaire, jamais `openSection`). Sans ce polyfill,
// l'appel plante et pollue la suite d'une erreur non gérée (une promesse rejetée si
// l'appelant est asynchrone, un avertissement `[Vue warn]` sinon) : le test concerné restait
// vert par accident dans les deux cas.
if (typeof globalThis.Element !== 'undefined' && typeof globalThis.Element.prototype.scrollIntoView !== 'function') {
  globalThis.Element.prototype.scrollIntoView = () => {}
}

// jsdom ne fait pas de mise en page, donc `Range.prototype.getClientRects` n'existe
// pas du tout (contrairement à `Element.prototype.getClientRects`, que jsdom stub en
// renvoyant une liste vide). CodeMirror 6 (`clientRectsFor`, @codemirror/view) l'appelle
// pourtant sur un vrai `Range` dès qu'il mesure du texte — `EditorView.scrollIntoView`
// programme une telle mesure via `requestAnimationFrame`. Sans ce polyfill, l'appel
// plante de façon ASYNCHRONE (après la fin synchrone du test qui a dispatché l'effet) et
// pollue la suite d'une erreur non gérée, invisible en exécution isolée d'un seul fichier
// (exit 0 quand même) mais qui fait sortir la suite complète en erreur. Trouvé lors du travail du
// 20/08 (« corriger une ligne depuis le lecteur » — `reveal-line.js`). Tous les
// appelants internes de `clientRectsFor` gardent leur lecture sur `rects.length` ou
// `rects[i] || null` avant d'utiliser un rect (cf. index.js:2026, 3310, 3342, 3366,
// 10048) : une liste vide est donc une réponse SÛRE, pas juste une réponse qui ne plante
// pas — elle fait retomber CodeMirror sur ses valeurs de repli.
if (typeof globalThis.Range !== 'undefined' && typeof globalThis.Range.prototype.getClientRects !== 'function') {
  globalThis.Range.prototype.getClientRects = () => []
}

// jsdom (origine opaque) n'expose pas localStorage ; la WebView Capacitor, si.
// Petit polyfill mémoire pour exercer la persistance « aperçu » du lecteur en test.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  globalThis.localStorage = ls
  if (globalThis.window) globalThis.window.localStorage = ls
}

// Langue du poste de test fixée en français (tâche A2, 30/07 — même correctif que
// `playwright.config.js` (locale: 'fr-FR') pour la suite e2e, tâche A3).
//
// Depuis que la langue par défaut de l'app suit l'appareil (`detectDeviceLocale`, cf.
// src/utils/app-locale.js) au lieu d'être figée en français, le singleton `@/i18n` importé
// tel quel par des dizaines de tests de composants démarre dans la langue de
// `navigator.languages` — qui vaut par défaut `['en-US', 'en']` sous jsdom, une langue
// SUPPORTÉE (donc jamais rattrapée par le repli anglais-si-non-supportée : ici c'est
// directement 'en' qui gagne). Sans ce réglage, toute la suite unitaire bascule
// silencieusement en anglais et des dizaines d'assertions de texte français tombent d'un
// coup — pas une régression de l'app, un changement du DÉFAUT de l'environnement de test.
// Un test qui veut simuler un autre appareil garde la main : ces deux propriétés restent
// des accesseurs (comme nativement sous jsdom), donc `vi.spyOn(navigator,
// 'language'|'languages', 'get').mockReturnValue(...)` continue de fonctionner test par test.
//
// ⚠️ PIÈGE pour un futur test qui voudrait surcharger la langue : `detectDeviceLocale()`
// lit `navigator.languages` EN PRIORITÉ sur `navigator.language` (cf.
// src/utils/app-locale.js:42 — la liste ordonnée l'emporte quand elle est non vide). Les
// deux accesseurs ci-dessous sont posés en français, donc un test qui ne mocke QUE
// `navigator.language` (comme le fait déjà `tests/unit/OnboardingView-units.spec.js:22`,
// pour une tout autre logique — `defaultsForLocale(navigator.language)`, qui lui ne lit
// jamais `navigator.languages`) obtiendrait silencieusement `'fr'` de `detectDeviceLocale()`
// quoi qu'il mocke, sans erreur ni avertissement. Pour tester un comportement qui dépend de
// `detectDeviceLocale()` (store settings, i18n, OnboardingView), la bonne surcharge est :
// `vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])` (voir
// tests/unit/settings.store.spec.js et tests/unit/onboarding-view.spec.js pour des exemples).
Object.defineProperty(globalThis.navigator, 'language', { get: () => 'fr-FR', configurable: true })
Object.defineProperty(globalThis.navigator, 'languages', { get: () => ['fr-FR', 'fr'], configurable: true })
