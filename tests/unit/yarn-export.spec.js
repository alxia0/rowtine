// Export CSV du stock (SettingsView::exportYarns) — extrait en fonction pure `yarnExportTable`
// pour être testable seul (suit le précédent matchesQuery/sortYarns de ce même module).
// La règle du projet est « jamais perdre d'info » : un futur ajout de colonne qui décale
// en-têtes et valeurs (colonne ajoutée d'un côté seulement, deux valeurs interverties) doit
// faire rougir un test — c'est tout l'enjeu de ce fichier. Revue « Stock de laines »
// (modèle + date d'achat) 17/07.
//
// Le passage multilingue (29/07) : le booléen `en` a disparu de la signature — les en-têtes
// passent TOUS par `t(key)`. Le test qui suit vérifie donc que chaque position d'en-tête
// demande la BONNE CLÉ (via le `t` factice `(key) => [key]`), plutôt que de comparer des
// chaînes françaises/anglaises figées — c'est la seule façon de couvrir 4 langues (et les
// suivantes) sans dupliquer un test par langue.
//
// Les travaux sur le budget (01/08) : bain et date d'achat ne sont plus des champs de la laine —
// ce sont des dérivés des lignes du registre d'achats, fournies à `yarnExportTable` via
// `linesFor(yarnId)`. Les fixtures portent donc un `id` et les lignes vivent à côté, dans
// `linesFor`, plutôt que sur l'objet laine lui-même.
import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import { yarnExportTable } from '@/utils/yarn-filter'
import fr from '@/i18n/fr.json'

// `t` factice : renvoie la clé elle-même entre crochets — suffit à vérifier QUELLE clé est
// demandée à quelle position, sans dépendre de vue-i18n ni d'un fichier de langue réel.
const t = (key) => `[${key}]`

// Caractéristiques : contrairement aux tests de position ci-dessus, celui des
// libellés de caractéristiques doit comparer un texte RÉEL (« Vegan, Fibres biologiques
// (GOTS) »), pas une clé entre crochets — le `t` factice ne peut donc pas servir ici. On
// verrouille la locale sur `fr` (pas `i18n` global de l'app, dont la locale dépend de
// l'appareil) pour un résultat déterministe.
const realT = createI18n({ legacy: false, locale: 'fr', messages: { fr } }).global.t

const laineComplete = {
  id: 1, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu glacier', weight: 'dk',
  lengthM: 210, quantity: 3, price: 4.5, composition: ['Laine', 'Alpaga'],
  // pas de champ `bain` ni `purchasedAt` : retirés du formulaire précédemment.
}
const laineMinimale = {
  id: 2, brand: 'Katia', colorName: 'Écru', quantity: 1,
  // pas de model, pas de weight, pas de composition — et aucune ligne d'achat (linesFor)
}

// Une seule ligne pour laineComplete : suffisant pour les positions/valeurs de base. Le
// dédoublonnage et l'agrégation multi-lignes (règle « jamais perdre d'info ») ont leur
// propre test ci-dessous, avec un jeu à deux lignes.
const linesFor = (id) => (id === 1 ? [{ bain: 'AB123', date: '2026-01-15' }] : [])

describe('yarnExportTable', () => {
  it('métrique : autant de valeurs par ligne que d’en-têtes (laine complète et laine minimale)', () => {
    const { head, rows } = yarnExportTable([laineComplete, laineMinimale], { t, system: 'metric', linesFor })
    for (const row of rows) expect(row).toHaveLength(head.length)
  })

  it('impérial : autant de valeurs par ligne que d’en-têtes (laine complète et laine minimale)', () => {
    const { head, rows } = yarnExportTable([laineComplete, laineMinimale], { t, system: 'imperial', linesFor })
    for (const row of rows) expect(row).toHaveLength(head.length)
  })

  it('« Marque », « Modèle » et « Date d’achat » demandent les bonnes clés, aux bonnes positions', () => {
    const { head, rows } = yarnExportTable([laineComplete], { t, linesFor })
    expect(head[0]).toBe(t('settings.export.yarn.brand'))
    expect(head[1]).toBe(t('settings.export.yarn.model'))
    expect(head[11]).toBe(t('settings.export.yarn.purchaseDate'))
    expect(rows[0][1]).toBe('Baby Merino')
    expect(rows[0][11]).toBe('2026-01-15')
  })

  // Point 5 : plusieurs lignes d'achat pour la MÊME laine ne doivent
  // perdre ni un bain, ni la date la plus récente — l'export les agrège, il ne choisit
  // pas laquelle garder. Bains et dates du jeu d'essai tous distincts.
  //
  // Ordre du jeu d'essai (revue, 01/08) : `linesFor` en production, c'est
  // `usePurchasesStore().forYarn`, qui rend TOUJOURS les lignes plus récentes d'abord
  // (byRecentFirst, stores/purchases.js) — jamais l'ordre de saisie. Un fixture en ordre
  // croissant de date ne décrirait pas ce que l'app produit réellement ; celui-ci est
  // pré-trié plus récent d'abord, comme le vrai store (même modèle que
  // yarn-detail-dialog.spec.js, qui passe par le vrai store).
  it('agrège les bains dédoublonnés et la date la plus récente, sans rien perdre (jamais perdre d’info)', () => {
    const linesMulti = (id) => (id === 1 ? [
      { bain: 'B03', date: '2026-05-04' },
      { bain: 'A12', date: '2026-02-20' },
      { bain: 'A12', date: '2026-01-15' }, // même bain que la ligne précédente : ne doit pas se dupliquer
    ] : [])
    const { head, rows } = yarnExportTable([laineComplete], { t, linesFor: linesMulti })
    expect(head[10]).toBe(t('settings.export.yarn.dyeLot'))
    expect(rows[0][10]).toBe('B03 · A12')
    expect(rows[0][11]).toBe('2026-05-04')
  })

  it('« Type de coloris »/« Colour type » et « Notes couleur »/« Colour notes » sont juste après « Coloris »/« Colour »', () => {
    const multicolore = { ...laineComplete, colorType: 'mouchete', colorNotes: 'bleu, vert, jaune' }
    const { head, rows } = yarnExportTable([multicolore], { t, linesFor })
    expect(head[2]).toBe(t('settings.export.yarn.color'))
    expect(head[3]).toBe(t('settings.export.yarn.colorType'))
    expect(head[4]).toBe(t('settings.export.yarn.colorNotes'))
    expect(rows[0][3]).toBe('[yarn.colorTypes.mouchete]')
    expect(rows[0][4]).toBe('bleu, vert, jaune')

    const uni = yarnExportTable([laineMinimale], { t, linesFor }) // colorType absent → traité comme 'uni' (pré-existant)
    expect(uni.rows[0][3]).toBe('[yarn.colorTypes.uni]')
    expect(uni.rows[0][4]).toBe('')
  })

  it('une laine sans modèle, ni bain, ni date d’achat exporte des cellules vides, pas undefined, sans décaler la ligne', () => {
    const { head, rows } = yarnExportTable([laineMinimale], { t, linesFor })
    const row = rows[0]
    expect(row).toHaveLength(head.length)
    expect(row[1]).toBe('') // modèle
    expect(row[10]).toBe('') // bain
    expect(row[11]).toBe('') // date d'achat
    expect(row[1]).not.toBeUndefined()
    expect(row[10]).not.toBeUndefined()
    expect(row[11]).not.toBeUndefined()
  })

  it('sans `linesFor` fourni (appelant qui ne connaît pas encore le registre), bain et date sortent vides sans planter', () => {
    expect(() => yarnExportTable([laineComplete], { t })).not.toThrow()
    const { rows } = yarnExportTable([laineComplete], { t })
    expect(rows[0][10]).toBe('')
    expect(rows[0][11]).toBe('')
  })

  // SUPPRIMÉ le 29/07 (revue du passage multilingue) : un cas « locale: 'de' » qui NE POUVAIT
  // PAS ROUGIR. Il construisait la table avec `locale: 'de'` puis affirmait
  // `expect(head[0]).not.toBe('Marque')` — or `yarnExportTable` bâtit ses en-têtes à
  // l'identique quelle que soit la locale (elle ne s'en sert que pour le séparateur décimal
  // et le symbole de devise), et le `t` factice de ce fichier renvoie toujours '[clé]'. Les
  // deux `.not.toBe(...)` étaient donc vrais par construction, indépendamment du code testé :
  // exactement le défaut récurrent documenté de ce projet.
  //
  // Rien n'est perdu en couverture :
  //   - la seule assertion utile du cas (`head[0]` demande bien la clé « brand ») est reprise
  //     dans le test des positions ci-dessus ;
  //   - `head[6]` (clé de longueur) est déjà couvert par yarn-export-units.spec.js ;
  //   - le VRAI garde-fou d'une locale tierce est dans yarn-export-units.spec.js :
  //     `expect(rows[0][6]).toBe('229,66')` pour `locale: 'de'`. Celui-là rougirait pour de
  //     bon si le séparateur décimal redevenait conditionné au seul français — il porte sur
  //     une VALEUR calculée par le code, pas sur une chaîne que le test fabrique lui-même.

  // Le 05/08 : `yarnExportTable` liste ses colonnes une par une (yarn-filter.js) —
  // sans ajout explicite, les caractéristiques ne sortiraient jamais de l'export, sans le
  // moindre message. Ces deux tests couvrent la colonne « Caractéristiques ».
  it('exporte une colonne « Caractéristiques » avec les libellés traduits', () => {
    const { head, rows } = yarnExportTable([{ brand: 'Drops', labels: ['vegan', 'gots'] }], { t: realT })
    expect(head).toContain('Caractéristiques')
    const col = head.indexOf('Caractéristiques')
    expect(rows[0][col]).toBe('Vegan, Fibres biologiques (GOTS)')
  })

  it('laisse la colonne vide pour une laine sans caractéristique', () => {
    const { head, rows } = yarnExportTable([{ brand: 'Drops' }], { t: realT })
    expect(rows[0][head.indexOf('Caractéristiques')]).toBe('')
  })

  // Revue finale (correction 1, 06/08/2026) : le test ci-dessus (`['vegan', 'gots']`) ne
  // pouvait pas tomber si l'export retombait sur l'ordre de COCHAGE au lieu de l'ordre
  // CANONIQUE (YARN_LABELS) — les deux ordres coïncident sur cette paire. Ici l'ordre de
  // cochage est délibérément inversé par rapport au canonique : mesuré, avant correction,
  // l'export sortait « Fibres biologiques (GOTS), Vegan » (ordre de cochage) alors que la
  // fiche détaillée affichait déjà « Vegan, Fibres biologiques (GOTS) » (ordre canonique).
  // Seule une lecture qui respecte YARN_LABELS fait apparaître Vegan avant GOTS ici.
  it('exporte les caractéristiques dans l’ordre canonique de YARN_LABELS, jamais l’ordre de cochage', () => {
    const { head, rows } = yarnExportTable([{ brand: 'Drops', labels: ['gots', 'vegan'] }], { t: realT })
    expect(rows[0][head.indexOf('Caractéristiques')]).toBe('Vegan, Fibres biologiques (GOTS)')
  })
})
