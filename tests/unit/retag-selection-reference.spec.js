// @vitest-environment jsdom
// LE test qui manquait : le geste complet « sélectionner des lignes, cliquer une catégorie
// Aide mémoire » doit peupler l'onglet correspondant. Avant cela, il renvoyait le
// texte en notes dans le patron (retour terrain, 19/08/2026).
import { describe, it, expect } from 'vitest'
import { retagSelection } from '@/utils/pattern-md/md-retag-selection'
import { mdToPattern } from '@/utils/pattern-md/parse'

// Applique les `changes` de retagSelection sur le texte, comme le ferait CodeMirror.
const apply = (text, changes) => {
  let out = ''
  let cursor = 0
  for (const c of changes) {
    out += text.slice(cursor, c.from) + c.insert
    cursor = c.to
  }
  return out + text.slice(cursor)
}

const FM = (sizes) =>
  sizes ? `---\nrowtine: 1\nsizes: ${sizes}\n---\n\n` : '---\nrowtine: 1\n---\n\n'

describe('retagSelection — type reference', () => {
  it('produit UN SEUL changement pour toute la plage', () => {
    const doc = 'Coton DK, 400 m\n3 pelotes\nColoris contraste'
    const { changes } = retagSelection(doc, 1, 3, 'reference', { tag: 'yarn' })
    expect(changes).toHaveLength(1)
    expect(changes[0].from).toBe(0)
    expect(changes[0].to).toBe(doc.length)
  })

  it('émet un titre de rubrique RÉSERVÉ, pas le texte de la ligne', () => {
    const doc = 'Coton DK, 400 m\n3 pelotes'
    const { changes } = retagSelection(doc, 1, 2, 'reference', { tag: 'yarn' })
    const out = apply(doc, changes)
    expect(out).toContain('## Fil {yarn}')
    expect(out).not.toContain('## Coton DK, 400 m {yarn}')
    expect(out).toContain('Coton DK, 400 m')
    expect(out).toContain('3 pelotes')
  })

  it('le bloc émis alimente RÉELLEMENT l\'onglet de l\'aide-mémoire', () => {
    const doc = 'Coton DK, 400 m\n3 pelotes'
    const { changes } = retagSelection(doc, 1, 2, 'reference', { tag: 'yarn' })
    const res = mdToPattern(FM() + apply(doc, changes))
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.yarn')
    expect(bloc.p.join(' ')).toContain('Coton DK, 400 m')
    expect(bloc.p.join(' ')).toContain('3 pelotes')
    // Et RIEN ne part en notes.
    expect(res.pattern.reader.sections).toEqual([])
  })

  it('démarque les lignes avant de les verser (puces, notes)', () => {
    const doc = '- 4 anneaux marqueurs\n> 1 aiguille à laine'
    const { changes } = retagSelection(doc, 1, 2, 'reference', { tag: 'materials' })
    const res = mdToPattern(FM() + apply(doc, changes))
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.materials')
    expect(bloc.p).toEqual(['4 anneaux marqueurs', '1 aiguille à laine'])
  })

  it('idempotent : requalifier deux fois vers la même rubrique ne double rien', () => {
    const doc = 'Coton DK, 400 m'
    const first = apply(doc, retagSelection(doc, 1, 1, 'reference', { tag: 'yarn' }).changes)
    const lines = first.split('\n').length
    const second = apply(first, retagSelection(first, 1, lines, 'reference', { tag: 'yarn' }).changes)
    const res = mdToPattern(FM() + second)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.yarn')
    expect(bloc.p.join(' ')).toBe('Coton DK, 400 m')
  })

  it('Tailles : la table émise est relue par le parseur, sans avertissement', () => {
    const doc = 'Tour de poitrine 90 (100) 110\nLongueur totale 55 (58) 61'
    const { changes } = retagSelection(doc, 1, 2, 'reference', {
      tag: 'measurements',
      sizeLabels: ['S', 'M', 'L'],
    })
    const res = mdToPattern(FM('S · M · L') + apply(doc, changes))
    expect(res.warnings).toEqual([])
    const rows = res.pattern.reader.reference.tabs
      .find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows).toEqual([
      { label: 'Tour de poitrine', values: ['90', '100', '110'] },
      { label: 'Longueur totale', values: ['55', '58', '61'] },
    ])
  })

  it('Tailles : le gabarit de repli est une table VALIDE, relue sans avertissement', () => {
    const doc = 'Mesures prises à plat'
    const { changes } = retagSelection(doc, 1, 1, 'reference', {
      tag: 'measurements',
      sizeLabels: ['S', 'M', 'L'],
    })
    const out = apply(doc, changes)
    expect(out).toContain('| mesure | S | M | L |')
    const res = mdToPattern(FM('S · M · L') + out)
    expect(res.warnings).toEqual([])
    const rows = res.pattern.reader.reference.tabs
      .find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows).toEqual([{ label: 'Mesures prises à plat', values: ['', '', ''] }])
  })

  it('Abréviations : le glossaire est peuplé', () => {
    const doc = 'm = maille\naug : augmentation'
    const { changes } = retagSelection(doc, 1, 2, 'reference', { tag: 'abbreviations' })
    const res = mdToPattern(FM() + apply(doc, changes))
    expect(res.pattern.reader.reference.abbr).toEqual({ m: 'maille', aug: 'augmentation' })
  })

  it('les lignes HORS sélection ne sont pas touchées', () => {
    const doc = '## Corps {body}\n\n- Rang 1 : monter 90 m\n\nCoton DK, 400 m'
    const { changes } = retagSelection(doc, 5, 5, 'reference', { tag: 'yarn' })
    const res = mdToPattern(FM() + apply(doc, changes))
    expect(JSON.stringify(res.pattern.reader.sections)).toContain('Rang 1 : monter 90 m')
  })

  it('les autres types restent ligne à ligne (non-régression)', () => {
    const doc = 'une ligne\nune autre'
    const { changes } = retagSelection(doc, 1, 2, 'rang')
    expect(changes).toHaveLength(2)
  })

  // Geste de rattrapage (arbitrage produit, 20/08/2026) : l'utilisatrice range son fil dans
  // « Matériel » par erreur, sélectionne le bloc entier et clique « Fil ». Le mot « Matériel »
  // — vocabulaire de l'app, pas une saisie — ne doit pas atterrir comme ligne de contenu dans
  // la rubrique Fil.
  it('rattrapage : reverser un bloc de référence déjà posé vers une AUTRE rubrique écarte son titre', () => {
    const doc = '## Matériel {materials}\n\n- Coton DK, 400 m\n- 3 pelotes'
    const { changes } = retagSelection(doc, 1, 4, 'reference', { tag: 'yarn' })
    const out = apply(doc, changes)
    expect(out).toContain('## Fil {yarn}')
    expect(out).not.toContain('Matériel')
    const res = mdToPattern(FM() + out)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.yarn')
    expect(bloc.p.join(' ')).toContain('Coton DK, 400 m')
    expect(bloc.p.join(' ')).toContain('3 pelotes')
    expect(bloc.p.join(' ')).not.toContain('Matériel')
  })

  // Frontière symétrique de la garde anti-perte : un titre de SECTION DE TRAVAIL (`{body}`,
  // ni tag de référence ni titre réservé nu) est un nom donné par l'utilisatrice à sa section —
  // du contenu du patron. Il doit survivre, pas être écarté comme un titre de rubrique.
  it('un titre de SECTION de travail (pas une rubrique) survit en contenu', () => {
    const doc = '## Corps {body}\n\n- Rang 1 : monter 90 m\n- Rang 2 : tricoter'
    const { changes } = retagSelection(doc, 1, 4, 'reference', { tag: 'tips' })
    const out = apply(doc, changes)
    expect(out).toContain('## Conseils {tips}')
    const res = mdToPattern(FM() + out)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'tips')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.tips')
    expect(bloc.p).toContain('Corps')
    expect(bloc.p.join(' ')).toContain('Rang 1 : monter 90 m')
    expect(bloc.p.join(' ')).toContain('Rang 2 : tricoter')
  })
})

describe('menu Aide mémoire — couverture des rubriques', () => {
  it('les huit balises du menu produisent toutes un bloc exploitable', async () => {
    const TAGS = ['yarn', 'needles', 'gauge', 'materials', 'tips', 'abbreviations', 'measurements', 'techniques']
    for (const tag of TAGS) {
      const doc = 'une ligne de contenu'
      const { changes } = retagSelection(doc, 1, 1, 'reference', { tag, sizeLabels: [] })
      expect(changes, `tag ${tag}`).toHaveLength(1)
      expect(changes[0].insert, `tag ${tag}`).toMatch(/^## /)
    }
  })

  // Le menu « Aide mémoire » est passé de <select> (dont le
  // HTML listait toutes les <option> dès la construction de la barre) à une puce qui
  // n'ouvre son popover qu'au clic (openMenuPopover) : « Conseils » ne peut donc plus se
  // vérifier dans buildToolbarHtml seul, il faut monter l'éditeur réel, cliquer la puce
  // et lire le popover ouvert.
  it('Conseils est présent dans le menu de la barre', async () => {
    const { createCmEditor } = await import('@/components/cm/cm-editor')
    const fr = (await import('@/i18n/fr.json')).default
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: '' })
    editor.toolbar.querySelector('.cm-retag-ref').click()
    const items = [...document.querySelectorAll('.cm-menu-popover__item')].map((b) => b.textContent)
    expect(items).toContain(fr.correction.toolbar.tips)
    document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
    host.remove()
  })
})

describe('i18n — libellé Conseils de la barre', () => {
  it.each(['fr', 'en', 'es', 'de'])('%s expose correction.toolbar.tips', async (locale) => {
    const json = (await import(`@/i18n/${locale}.json`)).default
    expect(json.correction.toolbar.tips).toBeTruthy()
  })
})
