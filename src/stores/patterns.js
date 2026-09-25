// Bibliothèque de patrons — CRUD local, lecture seule côté affichage (PRD §7.7).
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db, plain } from '@/db/db'
import { patternToReader } from '@/utils/reader'
import { buildFreePattern } from '@/constants/free-pattern'
import { createLoadGuard } from '@/stores/load-guard'
import { isLibraryPattern } from '@/utils/pattern-price'

export function emptyPattern() {
  return {
    name: '',
    type: 'knitting', // knitting | crochet
    category: '',
    categoryCustom: '', // saisie libre quand category === 'other'
    author: '', // créateur·rice du patron
    authorUrl: '', // lien vers son site
    // Prix du patron acheté (lot 07/08). Champs NON INDEXÉS : aucune migration Dexie n'est
    // nécessaire, la base stocke l'objet entier et ces trois-là ne sont jamais requêtés par
    // index. Le jour où l'un devrait l'être, la procédure complète de src/db/db.js s'applique.
    // Ne valent QUE sur un patron de bibliothèque — cf. src/utils/pattern-price.js.
    price: '', // saisi, virgule française admise ; '' = rien noté ; '0' = gratuit VÉRIFIÉ
    priceCurrency: '', // estampillée à l'écriture, comme les lignes d'achat de laine
    purchasedAt: '', // 'AAAA-MM-JJ' ; '' -> groupe « Date inconnue » de l'écran Dépenses
    sizes: [],
    source: '',
    // Aiguilles/crochet + échantillon — repris par le projet à la sélection du patron (Lot U2).
    needleMm: '',
    needleUs: '',
    gaugeStitches: '',
    gaugeRows: '',
    photos: [], // data URLs ; la 1re sert de vignette d'aperçu
    pdf: '', // PDF original uploadé (data URL application/pdf) ; '' si absent
    gallery: [], // images extraites du PDF : [{ src, page, w, h }]
    coverIndex: 0, // index de la photo de couverture dans `gallery` (repli sur 0 si absent/hors bornes, cf. pattern-cover.js)
    // sections : [{ name, instructions, isDiagram, bySize: { [taille]: instructions } }]
    // `instructions` = texte commun / par défaut ; `bySize` = variantes par taille (optionnel).
    sections: [],
  }
}

export const usePatternsStore = defineStore('patterns', () => {
  const patterns = ref([])
  const loaded = ref(false)
  const freePatternId = ref(null)

  // Gabarits de bibliothèque : ni instances de projet, ni builtin (Lot B — hygiène des requêtes).
  const libraryPatterns = computed(() => patterns.value.filter(isLibraryPattern))
  // Patrons sélectionnables à la création d'un projet : tout sauf les instances d'autres projets.
  const selectablePatterns = computed(() => patterns.value.filter((p) => p.ownerProjectId == null))

  // Jeton de rechargement (cf. `stores/load-guard.js`) : une lecture partie avant une
  // écriture ne doit jamais réassigner son instantané par-dessus une lecture plus récente,
  // sous peine de faire disparaître de la bibliothèque un patron pourtant importé.
  // La migration paresseuse ci-dessous rappelle `load()` : ce rechargement imbriqué prend un
  // jeton PLUS RÉCENT, donc l'extérieur ne réassignera plus rien après lui. Pas d'interblocage
  // possible — l'imbriqué n'attend jamais l'extérieur, l'attente ne remonte que vers le plus
  // récent, et la migration s'arrête au second passage (tous les patrons ont alors un reader
  // et un coverIndex).
  const loadGuard = createLoadGuard()
  function load() {
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.patterns.orderBy('id').reverse().toArray()
      if (!isCurrent()) return
      patterns.value = rows
      loaded.value = true
      const bi = rows.find((p) => p.builtin)
      if (bi) freePatternId.value = bi.id
      // Migration paresseuse : ne fait rien si tous les patrons ont déjà un reader ET un
      // coverIndex numérique — sans ce second critère, une base déjà migrée pour `reader`
      // (donc tous ses patrons dotés d'un `reader`) ne relancerait jamais `coverIndex` en
      // arrivant sur cette version : le champ resterait absent pour la Task 4 (bouton étoile).
      if (rows.some((p) => !p.reader || typeof p.coverIndex !== 'number')) {
        await migrateReadersIfNeeded()
      }
    })
  }
  async function get(id) {
    return db.patterns.get(Number(id))
  }
  async function add(data) {
    const id = await db.patterns.add({ ...emptyPattern(), ...plain(data) })
    await load()
    return id
  }
  async function update(id, data) {
    await db.patterns.update(Number(id), plain(data))
    await load()
  }
  async function remove(id) {
    const p = await db.patterns.get(Number(id))
    await db.patterns.delete(Number(id))
    await load()
    return p
  }
  async function restore(p) {
    await db.patterns.put(p)
    await load()
  }

  // 3 patrons exemples au 1er lancement (cf. constants/demo), seulement si la base est vide.
  // `locale` : la langue choisie à l'écran de bienvenue. Les exemples sont semés dans
  // CETTE langue et n'en changeront plus — un changement de langue ultérieur dans les
  // Réglages ne les réécrit pas (décision produit, 30/07) : ce sont dès lors les données de
  // l'utilisatrice, qui a pu les modifier ou cocher des sections.
  // Renvoie { [demoId]: id } — indexé par l'identifiant STABLE, jamais par le nom affiché.
  async function seedSamplesIfEmpty(locale) {
    // Ne comptent que les vrais patrons de bibliothèque (ni builtin, ni instance de projet) :
    // ni le patron libre ni une instance ne doivent empêcher le seed des exemples au 1er lancement.
    const seedable = await db.patterns.filter(isLibraryPattern).count()
    if (seedable > 0) return {}
    const { loadDemoContent } = await import('@/constants/demo')
    const { patterns: demoPatterns } = await loadDemoContent(locale)
    const ids = {}
    for (const p of demoPatterns) {
      // `demoId` sert à retrouver le patron ici et nulle part ailleurs : il n'a rien à
      // faire dans la base, où il deviendrait un champ fantôme sur les données de
      // l'utilisatrice.
      const { demoId, ...pattern } = p
      ids[demoId] = await db.patterns.add({ ...emptyPattern(), ...plain(pattern) })
    }
    await load()
    return ids
  }

  // Garantit l'existence du patron libre builtin (idempotent). Renvoie son id.
  // `locale` : même règle que pour les exemples — les libellés du patron libre sont figés
  // à la création, dans la langue choisie à l'accueil, et n'en changent plus ensuite.
  async function ensureFreePattern(locale) {
    // `.filter().first()` et NON `(await toArray()).find(...)` : cette fonction est appelée à
    // CHAQUE démarrage (App.vue) et à chaque ouverture du formulaire de projet
    // (ProjectEditView) ; `toArray()` matérialisait la bibliothèque ENTIÈRE en mémoire — PDF
    // d'origine et galerie compris, tous deux stockés en data URL base64, donc plusieurs Mo par
    // patron importé — juste pour tester un booléen. Le curseur Dexie s'arrête au premier patron
    // `builtin` ; même ordre (clé primaire), donc même résultat.
    let p = await db.patterns.filter((x) => x.builtin).first()
    if (!p) {
      const { loadDemoContent } = await import('@/constants/demo')
      const { freePattern } = await loadDemoContent(locale)
      const id = await db.patterns.add({ ...emptyPattern(), ...plain(buildFreePattern(freePattern)) })
      p = await db.patterns.get(id)
      await load()
    }
    freePatternId.value = p.id
    return p.id
  }

  // Migration idempotente : garantit un champ `reader` sur chaque patron (unification Lot A).
  // Backfille aussi `pdf`, `gallery` et `coverIndex` sur les patrons anciens.
  async function migrateReadersIfNeeded() {
    const all = await db.patterns.toArray()
    let n = 0
    for (const p of all) {
      const patch = {}
      if (!p.reader) patch.reader = patternToReader(p)
      if (typeof p.pdf !== 'string') patch.pdf = ''
      if (!Array.isArray(p.gallery)) patch.gallery = []
      if (typeof p.coverIndex !== 'number') patch.coverIndex = 0
      if (Object.keys(patch).length) {
        await db.patterns.update(p.id, patch)
        n++
      }
    }
    if (n) await load()
    return n
  }

  // Copy-on-write : fork le patron courant d'un projet en une INSTANCE éditable dédiée
  // (ownerProjectId), nommée comme le projet. No-op si c'est déjà l'instance du projet.
  // Ne modifie pas project.patternId — l'appelant repointe le projet vers l'id renvoyé.
  async function forkForProject(project) {
    if (!project || project.patternId == null) return null
    const cur = await db.patterns.get(project.patternId)
    if (!cur) return null
    if (cur.ownerProjectId === project.id) return cur.id // déjà l'instance du projet
    const clone = plain(cur)
    delete clone.id
    clone.ownerProjectId = project.id
    clone.name = project.name
    clone.builtin = false
    // Le PRIX ne suit jamais la copie (lot 07/08). Une copie de travail est le duplicata d'un
    // patron déjà compté dans les Dépenses : lui laisser le prix le compterait deux fois. Et
    // `sourcePatternId` (`?? cur.id` : gère la copie d'une copie, la chaîne remonte toujours à
    // la bibliothèque) permet au formulaire du projet de continuer à écrire sur l'ORIGINAL —
    // sans lui, la saisie irait dans la copie et ne changerait rien au total, en silence.
    clone.sourcePatternId = cur.sourcePatternId ?? cur.id
    delete clone.price
    delete clone.priceCurrency
    delete clone.purchasedAt
    const newId = await db.patterns.add(clone)
    await load()
    return newId
  }

  return { patterns, loaded, load, get, add, update, remove, restore, seedSamplesIfEmpty, migrateReadersIfNeeded, freePatternId, ensureFreePattern, libraryPatterns, selectablePatterns, forkForProject }
})
