// @vitest-environment jsdom
// CorrectionHelp : aide dépliable (<details>/<summary> natifs) en tête de l'écran de
// correction, qui explique les balisages de la barre CM6, les blocs Référence et le piège
// avéré « Tailles » (lignes perdues). Composant feuille, i18n réel du projet.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import CorrectionHelp from '@/components/CorrectionHelp.vue'
import AppIcon from '@/components/AppIcon.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

function mountHelp() {
  return mount(CorrectionHelp, { global: { plugins: [i18n] } })
}

describe('CorrectionHelp', () => {
  it('est replié par défaut', () => {
    const wrapper = mountHelp()
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })

  it('affiche le résumé « Comment corriger le patron »', () => {
    const wrapper = mountHelp()
    expect(wrapper.find('summary').text()).toContain(tk('correction.help.title'))
  })

  // Sans <h2> entre le <h1> d'AppHeader et les <h3> du corps, un lecteur d'écran annonce un
  // saut de niveau : le titre du résumé est un <h2>, et reste DANS le <summary>.
  it('le titre du résumé est un <h2> (hiérarchie de titres : H1 AppHeader -> H2 résumé -> H3 corps)', () => {
    const wrapper = mountHelp()
    const summary = wrapper.find('summary')
    const h2 = summary.find('h2')
    expect(h2.exists()).toBe(true)
    expect(h2.text()).toContain(tk('correction.help.title'))
    // Le titre n'est plus un <span> enfant direct du <summary> (AppIcon, lui, rend encore un
    // <span> interne : on ne vérifie pas l'absence de tout <span>).
    expect(h2.classes()).toContain('help__summary-title')
  })

  it('affiche les 3 étapes dans l’ordre : sélection des lignes, puis Modifier le texte, puis Enregistre', () => {
    const wrapper = mountHelp()
    const steps = wrapper.findAll('.help__steps li').map((li) => li.text())
    expect(steps).toEqual([
      tk('correction.help.steps2'), tk('correction.help.steps1'), tk('correction.help.steps3'),
    ])
  })

  it('avertit que Tailles attend un tableau, pas des instructions', () => {
    const wrapper = mountHelp()
    // C'est LE piège avéré (des lignes ont été perdues ainsi) : le texte doit être là.
    expect(wrapper.text()).toContain('Pas des instructions par taille')
  })

  it('explique les 7 balisages', () => {
    const wrapper = mountHelp()
    const txt = wrapper.text()
    for (const mot of ['Étape', 'Compteur', 'Note', 'Section', 'Référence', 'Texte', 'Image']) {
      expect(txt).toContain(mot)
    }
  })

  it('P3 : Compteur/Section/Aide-mémoire sont des noms nus dans le tableau, sans « … » de menu déroulant', () => {
    const wrapper = mountHelp()
    // toolbar.counter/.section/.reference portent un « … » de menu, trompeur dans ce tableau
    // STATIQUE, et Image n'a plus de clé toolbar : ces 4 cellules viennent de
    // correction.help.cat.* (nom nu). Les autres réutilisent toolbar.step/.note/.text.
    const tagsTable = wrapper.findAll('.help__table')[0]
    const firstCol = tagsTable.findAll('tbody tr td:first-child').map((td) => td.text())
    // Ordre aligné sur la barre CM6 : [Étape][Note][Aide-mémoire] puis
    // [Compteur][Section][Texte], Image en dernier (sans contrôle dans la barre).
    expect(firstCol).toEqual([
      'correction.toolbar.step', 'correction.toolbar.note', 'correction.help.cat.reference',
      'correction.help.cat.counter', 'correction.help.cat.section', 'correction.toolbar.text',
      'correction.help.cat.image',
    ].map((k) => tk(k)))
    for (const label of firstCol) expect(label).not.toContain('…')
  })

  it('Conseils rejoint les 8 blocs Référence, juste après Matériel', () => {
    const wrapper = mountHelp()
    const refsTable = wrapper.findAll('.help__table')[1]
    const firstCol = refsTable.findAll('tbody tr td:first-child').map((td) => td.text())
    expect(firstCol).toEqual([
      'yarn', 'needles', 'gauge', 'materials', 'tips', 'abbreviations', 'measurements', 'techniques',
    ].map((k) => tk(`correction.toolbar.${k}`)))
    // La ligne Conseils a bien sa propre explication (correction.help.refTips),
    // pas une cellule vide ni le texte de sa voisine Matériel.
    const secondCol = refsTable.findAll('tbody tr td:nth-child(2)').map((td) => td.text())
    expect(secondCol[4]).toBeTruthy()
    expect(secondCol[4]).not.toBe(secondCol[3])
  })

  it('légende : icône SEULEMENT pour les balisages en icône dans la barre (Étape/Note/Texte)', () => {
    const wrapper = mountHelp()
    const tagsTable = wrapper.findAll('.help__table')[0]
    const icons = tagsTable.findAllComponents(AppIcon)
    // Les 3 menus (Compteur/Section/Aide-mémoire) gardent un libellé texte dans la barre, donc pas
    // d'icône dans la légende ; Image n'a pas de bouton. Seuls les 3 boutons en icône seule
    // (Étape, Note, Texte) sont décodés ici, dans l'ordre du tableau.
    expect(icons.map((i) => i.props('name'))).toEqual(['checkbox', 'note', 'text'])
    // Le 2e tableau (sous-catégories d'aide-mémoire) n'a jamais eu d'icône.
    const refsTable = wrapper.findAll('.help__table')[1]
    expect(refsTable.findAllComponents(AppIcon)).toHaveLength(0)
  })

  // L'aide explique le balisage brut du mode « Modifier le texte » (`## Fil {yarn}`,
  // `### Titre`) : {yarn} est un marqueur EN ANGLAIS lu par REF_TAG_TO_KEY (refblocks.js). Le
  // TRADUIRE fait retomber le bloc en section ordinaire et le sort de la fiche ; le SUPPRIMER
  // est sans danger tant que le titre français nu reste (compat `reservedKey`, cf.
  // find-reference-block.spec.js).
  it("explique le balisage brut du mode « Modifier le texte » : accolades, sous-titre, puces/notes/tableau", () => {
    const wrapper = mountHelp()
    const txt = wrapper.text()

    // DERNIER <h3> du corps plutôt qu'un index absolu : une section ajoutée en amont ne doit pas
    // faire échouer un test qui ne parle que de celle-ci.
    const headings = wrapper.findAll('.help__body h3').map((h) => h.text())
    expect(headings).toHaveLength(4)
    expect(headings.at(-1)).toContain(tk('correction.toolbar.editCode'))

    // 1. Les accolades de `## Fil {yarn}` : marqueur EN ANGLAIS, à ne pas traduire. Exemple
    // LITTÉRAL exact : `referenceBlocksToMd` écrit "## Fil {yarn}" EN FRANÇAIS quelle que soit la
    // langue (donnée gelée) et l'aide doit montrer exactement ce qu'affiche l'éditeur.
    expect(txt).toContain('## Fil {yarn}')
    expect(txt).toMatch(/ne le traduis pas/i)
    expect(txt).toContain('aide-mémoire')
    // L'aide n'affirme pas que supprimer le marqueur est dangereux (faux, cf. plus haut), seule
    // sa TRADUCTION l'est. Portée restreinte au bloc balisage : l'aide parle aussi ailleurs de
    // supprimer des images (.help__strips), « supprim » sur tout le texte confondrait les deux.
    expect(wrapper.find('.help__markup').text()).not.toMatch(/supprim/i)

    // 2. `### Titre` : un sous-titre, dans un bloc Techniques.
    expect(txt).toContain('### Titre')
    expect(txt).toContain('sous-titre')
    expect(txt).toContain('Techniques')

    // 3. `- ` = étape, `> ` = note, `| … |` = rangée de tableau.
    expect(txt).toContain(tk('correction.help.markupStep'))
    expect(txt).toContain(tk('correction.help.markupNote'))
    expect(txt).toContain(tk('correction.help.markupRow'))
  })
})
