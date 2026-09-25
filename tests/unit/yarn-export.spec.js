// Export CSV du stock (`yarnExportTable`, fonction pure) : un ajout de colonne qui décale
// en-têtes et valeurs doit faire rougir un test (règle « jamais perdre d'info »). Les en-têtes
// passent par `t(key)` : on vérifie la BONNE CLÉ à chaque position, ce qui couvre toutes les
// langues. Bain et date d'achat viennent des lignes d'achat (`linesFor(yarnId)`), pas de la laine.
import { describe, it, expect } from 'vitest'
import { yarnExportTable } from '@/utils/yarn-filter'
import { createTestI18n } from './helpers/i18n-router'

// `t` factice : renvoie la clé elle-même entre crochets — suffit à vérifier QUELLE clé est
// demandée à quelle position, sans dépendre de vue-i18n ni d'un fichier de langue réel.
const t = (key) => `[${key}]`

// Libellés de caractéristiques : texte RÉEL, donc pas de `t` factice ; locale verrouillée sur
// `fr` (celle de l'app dépend de l'appareil) pour un résultat déterministe.
const realT = createTestI18n().global.t

const laineComplete = {
  id: 1, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu glacier', weight: 'dk',
  lengthM: 210, quantity: 3, price: 4.5, composition: ['Laine', 'Alpaga'],
  // pas de champ `bain` ni `purchasedAt` : ils viennent des lignes d'achat.
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

  // Plusieurs lignes d'achat pour la MÊME laine ne perdent ni un bain, ni la date la plus
  // récente : l'export agrège. Jeu pré-trié plus récent d'abord, comme le vrai
  // `usePurchasesStore().forYarn` (byRecentFirst), jamais l'ordre de saisie.
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

  // `yarnExportTable` liste ses colonnes une par une : sans ajout explicite, les
  // caractéristiques ne sortiraient jamais de l'export, sans le moindre message.
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

  // Ordre de cochage délibérément inverse de l'ordre canonique (YARN_LABELS) : seule une
  // lecture qui respecte YARN_LABELS met Vegan avant GOTS, comme la fiche détaillée.
  it('exporte les caractéristiques dans l’ordre canonique de YARN_LABELS, jamais l’ordre de cochage', () => {
    const { head, rows } = yarnExportTable([{ brand: 'Drops', labels: ['gots', 'vegan'] }], { t: realT })
    expect(rows[0][head.indexOf('Caractéristiques')]).toBe('Vegan, Fibres biologiques (GOTS)')
  })
})
