// Export tableur (CSV) des projets et des patrons — `projectExportTable` / `patternExportTable`.
//
// Ces deux tables étaient écrites EN LIGNE dans SettingsView.vue, donc hors de portée d'un
// test de module : 19 clés de traduction qu'aucun test ne vérifiait. Une clé mal orthographiée
// ne se voit pas à la relecture et sort le CHEMIN DE CLÉ BRUT en en-tête de colonne du fichier
// tableur, chez l'utilisatrice. Extraites dans `src/utils/export-tables.js` à la revue finale
// du passage multilingue (29/07), sur le modèle de `yarnExportTable` (déjà extraite et testée).
//
// Deux familles de tests, qui ne se recouvrent pas :
//   A. STRUCTURE — quelle clé à quelle position, autant de valeurs que d'en-têtes. `t` factice
//      renvoyant '[clé]' : indépendant de tout fichier de langue.
//   B. RÉSOLUTION DANS LES 4 LANGUES — chaque clé d'en-tête existe VRAIMENT et donne un
//      libellé lisible, en français, anglais, allemand et espagnol.
//
// Piège central de la famille B : l'instance i18n de l'app a `fallbackLocale: 'en'`. Résoudre
// les clés à travers elle rendrait le test INCAPABLE DE ROUGIR pour l'allemand et l'espagnol —
// une clé manquante retomberait sur l'anglais et le test resterait vert, alors que c'est
// précisément le défaut visé. On résout donc contre les fichiers JSON BRUTS, sans aucun repli.
import { describe, it, expect } from 'vitest'
import { projectExportTable, patternExportTable, toolExportTable } from '@/utils/export-tables'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

// --- A. Structure -------------------------------------------------------------------------

const t = (key) => `[${key}]`

const projetComplet = {
  name: 'Pull d’hiver', technique: 'knitting', status: 'wip', sizes: ['S', 'M'], activeSize: 'M',
  needles: [{ mm: 4, us: 6 }, { mm: 3.5, us: 4 }], gaugeStitches: 22, gaugeRows: 30,
  startedAt: '2026-01-05', finishedAt: '2026-02-20', stars: 4,
}
// Projet non migré : aiguilles scalaires (`needleMm`/`needleUs`) au lieu d'une liste.
const projetAncien = { name: 'Écharpe', technique: 'crochet', status: 'done', needleMm: 5, needleUs: 8 }

const patronComplet = {
  name: 'Twist Loop Top', type: 'knitting', category: 'clothing', author: 'A. B.', sizes: ['S', 'M', 'L'],
  source: 'PDF', reader: { sizeLabels: [], sections: [{ id: 's1', steps: [] }, { id: 's2', steps: [] }] },
}
const patronMinimal = { name: 'Bonnet', type: 'crochet' } // ni catégorie, ni auteur, ni tailles, ni sections

describe('projectExportTable — structure', () => {
  it('les 12 en-têtes demandent les bonnes clés, dans le bon ordre', () => {
    const { head } = projectExportTable([], { t })
    expect(head).toEqual([
      t('settings.export.project.name'), t('settings.export.project.craft'), t('settings.export.project.status'),
      t('settings.export.project.sizes'), t('settings.export.project.activeSize'), t('settings.export.project.needlesMm'),
      t('settings.export.project.needlesUs'), t('settings.export.project.gaugeStitches'), t('settings.export.project.gaugeRows'),
      t('settings.export.project.start'), t('settings.export.project.end'), t('settings.export.project.rating'),
    ])
  })

  it('autant de valeurs par ligne que d’en-têtes (projet complet et projet non migré)', () => {
    const { head, rows } = projectExportTable([projetComplet, projetAncien], { t })
    for (const row of rows) expect(row).toHaveLength(head.length)
  })

  it('technique et statut passent par `t`, jamais par la valeur brute stockée', () => {
    const { rows } = projectExportTable([projetComplet], { t })
    expect(rows[0][1]).toBe('[technique.knitting]')
    expect(rows[0][2]).toBe('[status.wip]')
  })

  it('plusieurs aiguilles sont jointes ; un projet non migré retombe sur ses scalaires', () => {
    const { rows } = projectExportTable([projetComplet, projetAncien], { t })
    expect(rows[0][5]).toBe('4 / 3.5') // mm
    expect(rows[0][6]).toBe('6 / 4') // US
    expect(rows[1][5]).toBe('5')
    expect(rows[1][6]).toBe('8')
  })
})

describe('patternExportTable — structure', () => {
  it('les 7 en-têtes demandent les bonnes clés, dans le bon ordre', () => {
    const { head } = patternExportTable([], { t })
    expect(head).toEqual([
      t('settings.export.pattern.name'), t('settings.export.pattern.type'), t('settings.export.pattern.category'),
      t('settings.export.pattern.author'), t('settings.export.pattern.sizes'), t('settings.export.pattern.source'),
      t('settings.export.pattern.sections'),
    ])
  })

  it('autant de valeurs par ligne que d’en-têtes (patron complet et patron minimal)', () => {
    const { head, rows } = patternExportTable([patronComplet, patronMinimal], { t })
    for (const row of rows) expect(row).toHaveLength(head.length)
  })

  it('type et catégorie passent par `t` ; le nombre de sections est compté, pas stocké', () => {
    const { rows } = patternExportTable([patronComplet], { t })
    expect(rows[0][1]).toBe('[technique.knitting]')
    expect(rows[0][2]).toBe('[pattern.categories.clothing]')
    expect(rows[0][6]).toBe(2)
  })

  it('un patron sans catégorie ni sections exporte des cellules vides / zéro, sans décaler la ligne', () => {
    const { rows } = patternExportTable([patronMinimal], { t })
    expect(rows[0][2]).toBe('') // catégorie absente
    expect(rows[0][4]).toBe('') // tailles absentes → chaîne vide, pas undefined
    expect(rows[0][6]).toBe(0) // aucune section
  })
})

// --- B. Résolution dans les 4 langues ------------------------------------------------------

const LANGUES = [
  ['fr', fr],
  ['en', en],
  ['de', de],
  ['es', es],
]

// Résout « a.b.c » dans un objet de messages BRUT. Renvoie `undefined` si le chemin n'existe
// pas — aucun repli, contrairement à l'instance i18n de l'app.
function resoudre(messages, chemin) {
  return chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), messages)
}

describe.each(LANGUES)('en-têtes d’export résolus en %s', (locale, messages) => {
  // `t` réel pour cette langue : si la clé manque, on renvoie le CHEMIN BRUT — exactement ce
  // que ferait vue-i18n sans repli, et exactement ce qui atterrirait dans le fichier tableur.
  const tLangue = (key) => resoudre(messages, key) ?? key

  it('les 12 en-têtes de projets sont des libellés lisibles, jamais un chemin de clé', () => {
    const { head } = projectExportTable([], { t: tLangue })
    expect(head).toHaveLength(12)
    for (const [i, libelle] of head.entries()) {
      expect(typeof libelle, `en-tête projet n°${i} en ${locale}`).toBe('string')
      expect(libelle.trim(), `en-tête projet n°${i} en ${locale}`).not.toBe('')
      expect(libelle, `en-tête projet n°${i} en ${locale} : clé non résolue`).not.toMatch(/^settings\.export\./)
    }
  })

  it('les 7 en-têtes de patrons sont des libellés lisibles, jamais un chemin de clé', () => {
    const { head } = patternExportTable([], { t: tLangue })
    expect(head).toHaveLength(7)
    for (const [i, libelle] of head.entries()) {
      expect(typeof libelle, `en-tête patron n°${i} en ${locale}`).toBe('string')
      expect(libelle.trim(), `en-tête patron n°${i} en ${locale}`).not.toBe('')
      expect(libelle, `en-tête patron n°${i} en ${locale} : clé non résolue`).not.toMatch(/^settings\.export\./)
    }
  })

  it('les valeurs traduites des lignes (technique, statut, catégorie) se résolvent aussi', () => {
    // Les en-têtes ne sont pas les seules traductions de ces tables : le contenu des colonnes
    // « Technique », « Statut » et « Catégorie » passe lui aussi par `t`.
    const projets = projectExportTable([projetComplet, projetAncien], { t: tLangue }).rows
    for (const row of projets) {
      expect(row[1], `technique en ${locale}`).not.toMatch(/^technique\./)
      expect(row[2], `statut en ${locale}`).not.toMatch(/^status\./)
    }
    const patrons = patternExportTable([patronComplet], { t: tLangue }).rows
    expect(patrons[0][1], `type en ${locale}`).not.toMatch(/^technique\./)
    expect(patrons[0][2], `catégorie en ${locale}`).not.toMatch(/^pattern\.categories\./)
  })
})

// --- C. Outils ----------------------------------------------------------------------------

const outilCirculaire = { type: 'circular', category: 'needle', sizeMm: 4, lengthCm: 80, price: '12.5', priceCurrency: 'CHF', quantity: 1, status: 'available' }
const outilKit = { type: 'interchangeable', category: 'kit', kitSizes: [3.5, 5], kitCables: [60, 80], quantity: 1, status: 'available' }
const outilCable = { type: 'cable', category: 'needle', lengthCm: 80, quantity: 2, status: 'lent' }
const outilCrochet = { type: 'standard', category: 'hook', sizeMm: 4, material: 'aluminium', quantity: 1, status: 'available' }
const tFr = (key, params = {}) => (resoudre(fr, key) ?? key).replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m)

describe('toolExportTable', () => {
  it('une cellule par en-tête, pour chaque forme de fiche', () => {
    const { head, rows } = toolExportTable([outilCirculaire, outilKit, outilCable], { t: tFr, locale: 'fr' })
    expect(head).toHaveLength(21)
    for (const row of rows) expect(row).toHaveLength(head.length)
  })

  it('aucune cellule ne sort un chemin de clé', () => {
    const { head, rows } = toolExportTable([outilCirculaire, outilKit, outilCable, outilCrochet], { t: tFr, locale: 'fr' })
    for (const cell of [...head, ...rows.flat()]) expect(String(cell)).not.toMatch(/tools\.|settings\.export/)
  })

  it('kit : tailles et câbles en une cellule', () => {
    const { head, rows } = toolExportTable([outilKit], { t: tFr, locale: 'fr' })
    expect(rows[0][head.length - 3]).toBe('3,5 / 5')
    expect(rows[0][head.length - 2]).toBe('60 cm ; 80 cm')
  })

  it('kit de crochets : la colonne tunisien dit « interchangeable » quand il l’est, vide sinon', () => {
    const kit = { type: 'hookKit', category: 'kit', kitSizes: [4, 5], kitCables: [], tunisian: false, quantity: 1, status: 'available' }
    const { head, rows } = toolExportTable([kit, { ...kit, tunisian: true, kitCables: [80] }], { t: tFr, locale: 'fr' })
    const col = head.indexOf(tFr('settings.export.tool.tunisianKind'))
    expect(rows[0][col]).toBe('')
    expect(rows[1][col]).toBe(tFr('tools.tunisianKinds.interchangeable'))
    expect(rows[1][head.length - 3]).toBe('4 / 5')
    expect(rows[1][head.length - 2]).toBe('80 cm')
  })

  it('kit : plusieurs câbles de même longueur écrits « 20 cm ×2 ; 35 cm »', () => {
    const { head, rows } = toolExportTable([{ ...outilKit, kitCables: [35, 20, 20] }], { t: tFr, locale: 'fr' })
    expect(rows[0][head.length - 2]).toBe('20 cm ×2 ; 35 cm')
  })

  it('kit : le diamètre de la fixation est écrit, un câble par couple longueur et diamètre', () => {
    const kitCables = [{ cm: 80, join: 'l' }, { cm: 20, join: 's' }, { cm: 20, join: 's' }, { cm: 80, join: 's' }, { cm: 100, join: null }]
    const { head, rows } = toolExportTable([{ ...outilKit, kitCables }], { t: tFr, locale: 'fr' })
    expect(rows[0][head.length - 2]).toBe('20 cm S ×2 ; 80 cm S ; 80 cm L ; 100 cm')
  })

  it('prix sans symbole, devise en code ; sans prix, les deux vides', () => {
    const { rows } = toolExportTable([outilCirculaire, outilCable], { t: tFr, locale: 'fr' })
    expect(rows[0][13]).toBe('12,5')
    expect(rows[0][14]).toBe('CHF')
    expect(rows[1][13]).toBe('')
    expect(rows[1][14]).toBe('')
  })

  it('équivalent calculé : numéro US en aiguille, lettre en crochet', () => {
    const { rows } = toolExportTable([outilCirculaire, outilCrochet], { t: tFr, locale: 'fr' })
    expect(rows[0][3]).toBe('6')
    expect(rows[1][3]).toBe('G-6')
  })
  // Protège les valeurs à clé : longueur nommée, nombre d'aiguilles, crochet tunisien, manche, état prêté.
  it('valeurs à clé traduites : chaussette, tunisien câblé à manche ergonomique, outil prêté', () => {
    const dpn = { type: 'dpn', category: 'needle', sizeMm: 2.5, lengthKind: 'sock', dpnCount: 5, quantity: 1, status: 'available' }
    const tunisien = { type: 'tunisian', category: 'hook', sizeMm: 5, lengthCm: 100, tunisianKind: 'cabled', handle: 'ergonomic', quantity: 1, status: 'available' }
    const { head, rows } = toolExportTable([dpn, tunisien, outilCable], { t: tFr, locale: 'fr' })
    const col = (name) => head.indexOf(tFr(`settings.export.tool.${name}`))
    expect(rows[0][col('length')]).toBe(tFr('tools.lengthKinds.sock'))
    expect(rows[0][col('dpnCount')]).toBe('5')
    expect(rows[1][col('length')]).toBe('100')
    expect(rows[1][col('tunisianKind')]).toBe(tFr('tools.tunisianKinds.cabled'))
    expect(rows[1][col('handle')]).toBe(tFr('tools.handles.ergonomic'))
    expect(rows[2][col('status')]).toBe(tFr('tools.statuses.lent'))
  })

  // Protège l'état par défaut : une fiche sans `status` se lit disponible, comme partout ailleurs.
  it('outil sans état : sorti comme disponible', () => {
    const { head, rows } = toolExportTable([{ type: 'straight', category: 'needle', sizeMm: 4 }], { t: tFr, locale: 'fr' })
    expect(rows[0][head.indexOf(tFr('settings.export.tool.status'))]).toBe(tFr('tools.statuses.available'))
  })

  // Protège l'en-tête de longueur : la colonne peut contenir une longueur nommée, il ne promet pas des cm.
  it.each(LANGUES)('en-tête de longueur sans unité en %s', (locale, messages) => {
    expect(resoudre(messages, 'settings.export.tool.length')).not.toMatch(/cm/)
  })
})
