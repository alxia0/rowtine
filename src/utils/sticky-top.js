// Hauteur de l'empilement de bandeaux COLLANTS en haut du document.
//
// Depuis le 31/08/2026, le résultat est PLANCHÉ sur l'inset de zone sûre du haut
// (--sa-top, cf. measureSafeAreaTop plus bas) : un écran sans bandeau collant
// (l'onboarding) doit quand même dégager la barre d'état.
//
// Extrait de src/utils/keyboard-avoidance.js le 19/08/2026 (correctif « le guide ne défile
// pas jusqu'à sa section ») pour être partagé : GuideView en a besoin pour la même raison
// que l'évitement de clavier — un `scrollIntoView({ block: 'start' })` cale la cible sur le
// haut de la FENÊTRE, alors que le contenu réellement visible commence sous les bandeaux.
// Le code et sa justification sont inchangés, seul l'emplacement bouge ; importer ce
// mécanisme depuis un module nommé « évitement de clavier » aurait été trompeur.
//
// Empilement : AppHeader partout, et sur l'écran de correction de patron, `.rte__bar`
// s'ajoute (cale son propre `top` CSS sous AppHeader — cf. ReaderTextEditor.vue). Un
// SEUL bandeau collant y côtoie AppHeader depuis leur fusion (les flèches +
// « Modifier le texte » et la barre de requalification, auparavant deux bandeaux
// séparés au `top` en désaccord, sont désormais montés dans le même conteneur
// `.rte__bar`). Jamais nommés ici (mécanisme générique, pas un
// `header` supposé) : on les DÉCOUVRE par leur `position: sticky` calculée et un `top`
// CSS fini et positif (un bandeau collé en BAS, ex. `.correct__actions`/`.onb__cta-bar`,
// calcule `top: auto` → `parseFloat` renvoie `NaN`, exclu naturellement). Comme chaque
// `top` intègre déjà la hauteur de ceux du dessus (mesuré : `.rte__bar` cale son `top`
// sur la hauteur d'AppHeader), le MAXIMUM de `top + hauteur` donne directement le bas
// du dernier bandeau empilé, sans avoir à les sommer nous-mêmes.
//
// ⚠️ Une valeur figée en dur (76, la hauteur supposée d'un SEUL bandeau) avait déjà
// sous-estimé le bandeau réel et laissé le haut des champs masqué dessous (retour d'usage du
// 22/07) : la mesure est faite À CHAQUE APPEL, car la hauteur dépend de la safe-area du haut
// (encoche, orientation), qui n'est pas la même d'un appareil ou d'une rotation à l'autre.
//
// PLANCHER --sa-top (retour d'usage du 31/08/2026 : sur l'onboarding, le champ prénom
// passait DERRIÈRE la barre d'état — l'horloge — quand le clavier s'ouvrait) : cette WebView
// est bord à bord (viewport-fit=cover, index.html ; cible 35), le haut de la fenêtre est
// DERRIÈRE la barre d'état. Les écrans à bandeau collant le portent déjà : AppHeader (et les
// en-têtes propres collants) ont un padding max(--sp-4, var(--sa-top)), leur hauteur mesurée
// inclut donc l'inset — le max ci-dessous ne compte JAMAIS double. Mais un écran SANS
// bandeau collant en haut n'offre rien à découvrir et le repli retombait à 0 : l'onboarding
// (seule vue sans en-tête — son padding-top de .onb est un padding ORDINAIRE, que le
// défilement emporte) calait alors le champ actif au ras de la fenêtre via le
// scroll-margin-top de keyboard-avoidance.js. Le résultat ne peut donc JAMAIS être inférieur
// à l'inset du haut lui-même : c'est le minimum de place à dégager, bandeau ou pas. La même
// coordination vaut pour tout autre défilement d'ancre (GuideView) sur un écran sans bandeau.
// Mesure la VALEUR UTILISÉE de --sa-top (l'inset de zone sûre du HAUT, en pixels).
//
// Pourquoi une sonde plutôt que lire la variable ? La valeur calculée d'une custom
// property peut rester, selon les moteurs, la chaîne « env(safe-area-inset-top, 0px) »
// NON substituée — env() n'est résolu en pixels qu'à l'UTILISATION dans une propriété
// réelle. La sonde (élément fixe, invisible, hors flux, créé une seule fois) porte
// `height: var(--sa-top)` : sa hauteur rendue EST l'inset, que la variable vienne du
// repli env() de tokens.css (web, aperçu Vite) ou de l'écrasement inline natif de
// SafeAreaPlugin (src/native/safe-area.js — la barre d'état réelle, que env() ne
// remonte pas sous Android). Restée dans le DOM, la sonde suit les mises à jour
// (rotation, pliage) sans aucune re-création.
//
// jsdom ne calcule aucune mise en page : la sonde y mesure 0, ce qui laisse inchangé le
// repli historique « 0 + respiration » de tous les tests unitaires existants.
let sondeSaTop = null

export function measureSafeAreaTop() {
  if (!sondeSaTop || !sondeSaTop.isConnected) {
    sondeSaTop = document.createElement('div')
    // data-test : couture de test — la sonde est sinon un élément anonyme impossible à
    // stubber (jsdom ne lui donne aucune mise en page, cf. ci-dessus).
    sondeSaTop.dataset.test = 'sa-top-sonde'
    sondeSaTop.setAttribute('aria-hidden', 'true')
    sondeSaTop.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:var(--sa-top);' +
      'visibility:hidden;pointer-events:none;border:0;margin:0;padding:0;'
    document.body.appendChild(sondeSaTop)
  }
  return sondeSaTop.getBoundingClientRect().height
}

export function measureStickyTopHeight() {
  let maxBottom = measureSafeAreaTop()
  const nodes = document.querySelectorAll('*')
  for (const node of nodes) {
    const style = getComputedStyle(node)
    if (style.position !== 'sticky') continue
    const top = parseFloat(style.top)
    // > 300 : trop loin du haut pour être un bandeau EMPILÉ au sommet (garde-fou contre
    // un futur élément collant sans rapport, ailleurs sur un écran long).
    if (!Number.isFinite(top) || top < 0 || top > 300) continue
    const height = node.getBoundingClientRect().height
    if (height <= 0) continue
    maxBottom = Math.max(maxBottom, top + height)
  }
  return maxBottom
}

// Respiration entre le bas du dernier bandeau collant et le haut de la cible : sans elle, la
// cible touche le bandeau, ce qui la fait lire comme SOUS lui. Valeur d'origine de
// keyboard-avoidance.js, reprise telle quelle pour que les deux défilements du même écran se
// posent au même endroit.
//
// Doublée de 8 à 16px (2026-08-23 — retour terrain : une ligne tapée DANS l'éditeur,
// via `recheckCaretMargin`, se lisait comme collée au bandeau plutôt que confortablement en
// dessous). 16px = `--sp-4` (tokens.css) : pas une valeur choisie au hasard, la respiration
// double s'aligne sur l'échelle d'espacement du projet. Bump PARTAGÉ, pas une constante locale
// à keyboard-avoidance.js : cette valeur profite aussi à GuideView.vue (défilement vers une
// section d'ancre, même besoin de dégager un bandeau opaque) sans lui être spécifique, et le
// mécanisme de mesure des bandeaux collants reste UNIQUE (cf. l'en-tête de ce fichier et celui
// de keyboard-avoidance.js, généralisation du 29/07) — une constante dupliquée aurait rouvert
// exactement la duplication que cette généralisation a supprimée. Vérifié à l'implémentation :
// aucun test de GuideView ne verrouille l'ancienne valeur (8) de façon incompatible.
export const RESPIRATION_SOUS_BANDEAUX = 16
