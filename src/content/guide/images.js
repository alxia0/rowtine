// Résout le nom d'une capture du guide ("00-bienvenue", extrait par le parseur depuis
// `![alt](images/fr/00-bienvenue.webp)`) vers son URL réelle, par langue ET par thème.
//
// `import.meta.glob` (Vite) résout tout ceci À LA COMPILATION : les fichiers WebP sont
// embarqués dans le paquet, aucune requête réseau ni résolution dynamique au chargement.
//
// ⚠️ DEUX globs SÉPARÉS, chacun avec sa propre expression. Ne PAS les fusionner en
// `./images*/*/*.webp` : l'expression du clair (`\.\/images\/`) cesserait de reconnaître le
// dossier sombre, l'index sombre serait vide, le repli renverrait les images claires — la
// fonctionnalité ne ferait rien et tous les tests passeraient.
const modulesClair = import.meta.glob('./images/*/*.webp', { eager: true, query: '?url', import: 'default' })
const modulesSombre = import.meta.glob('./images-dark/*/*.webp', { eager: true, query: '?url', import: 'default' })

function indexer(modules, motif) {
  const parLangue = {}
  for (const [chemin, url] of Object.entries(modules)) {
    const m = motif.exec(chemin)
    if (!m) continue
    const [, lang, nom] = m
    parLangue[lang] ??= {}
    parLangue[lang][nom] = url
  }
  return parLangue
}

const CLAIR = indexer(modulesClair, /^\.\/images\/([a-z]{2})\/([\w-]+)\.webp$/)
const SOMBRE = indexer(modulesSombre, /^\.\/images-dark\/([a-z]{2})\/([\w-]+)\.webp$/)

// Comble les trous du jeu sombre avec le clair : pour chaque nom absent du sombre, on garde
// l'URL claire. Ainsi une campagne sombre interrompue en cours de langue (certaines captures
// pas encore refaites) affiche les images claires manquantes plutôt qu'un `<img>` cassé.
// Ne filtre PAS les clés du sombre qui seraient absentes du clair (image sombre orpheline) :
// cette fonction ne garantit pas la parité des noms. C'est le test de parité de
// `tests/unit/guide-images-dark.spec.js` (« le dossier sombre porte EXACTEMENT les mêmes
// fichiers que le clair », qui compare les DEUX DOSSIERS SUR LE DISQUE — comparer les clés
// fusionnées par cette fonction ne détecterait jamais une image sombre manquante) qui tient
// cet invariant, et qui doit échouer bruyamment s'il est rompu.
export function fusionnerJeux(clair, sombre) {
  return { ...clair, ...sombre }
}

// `effectif` : 'light' | 'dark' — le thème RÉELLEMENT rendu, pas le réglage (« Système » doit
// être résolu par l'appelant, cf. src/theme/useEffectiveTheme.js).
export function guideImagesFor(lang, effectif = 'light') {
  const clair = CLAIR[lang] ?? {}
  if (effectif !== 'dark') return clair
  return fusionnerJeux(clair, SOMBRE[lang] ?? {})
}
