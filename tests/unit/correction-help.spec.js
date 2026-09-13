// Unitaire — CorrectionHelp : aide dépliable en tête de l'écran de
// correction. Repliée par défaut (<details>/<summary> natifs), explique les 7
// balisages de la barre CM6 et les 8 blocs Référence de la fiche patron
// (Conseils ajouté), avec un avertissement explicite sur le piège
// avéré « Tailles » (des lignes ont été perdues en y mettant des instructions
// par taille au lieu d'un tableau de mesures). Harnais : composant feuille
// sans store/route, i18n réel du projet (cf.
// tests/unit/reader-sheet-persize.spec.js — même motif pour ReaderSheet).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import CorrectionHelp from '@/components/CorrectionHelp.vue'
import AppIcon from '@/components/AppIcon.vue'

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
    expect(wrapper.find('summary').text()).toContain('Comment corriger le patron')
  })

  // (lot « aide accolades + hiérarchie des titres ») — AppHeader pose le <h1> de
  // l'écran ; sans <h2> entre lui et les <h3> du corps déplié, un lecteur d'écran annonce un
  // saut de niveau (couvert bout en bout, aide dépliée, par
  // tests/e2e/correction-barre-unique.spec.js). Ici, unitairement : le titre du résumé est
  // bien un <h2>, pas un <span>, et reste DANS le <summary> (repliable natif intact).
  it('le titre du résumé est un <h2> (hiérarchie de titres : H1 AppHeader -> H2 résumé -> H3 corps)', () => {
    const wrapper = mountHelp()
    const summary = wrapper.find('summary')
    const h2 = summary.find('h2')
    expect(h2.exists()).toBe(true)
    expect(h2.text()).toContain('Comment corriger le patron')
    // Plus de <span> PORTANT LE TITRE en enfant direct du <summary> (AppIcon, lui, continue
    // de rendre un <span> interne — cf. commentaire CSS de CorrectionHelp.vue — ce n'est
    // donc pas l'absence de tout <span> qui est vérifiée ici, mais que le titre n'en est
    // plus un).
    expect(h2.classes()).toContain('help__summary-title')
  })

  it('affiche les 3 étapes dans l’ordre : sélection des lignes, puis Modifier le texte, puis Enregistre', () => {
    const wrapper = mountHelp()
    const steps = wrapper.findAll('.help__steps li').map((li) => li.text())
    expect(steps).toHaveLength(3)
    expect(steps[0]).toContain('Sélectionne une ou plusieurs lignes')
    expect(steps[1]).toContain('Modifier le texte')
    expect(steps[2]).toContain('Enregistre')
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
    // Le 1er tableau (balisages) réutilise TELS QUELS toolbar.step/.note/.text,
    // mais toolbar.counter/.section/.reference portent un « … » de placeholder de
    // menu (barre CM6) — dans ce tableau STATIQUE, le "…" se lirait comme "ouvre un
    // menu" ; Image n'a lui plus DU TOUT de clé toolbar (bouton retiré).
    // Ces 4 cellules doivent donc venir de correction.help.cat.* (nom nu).
    const tagsTable = wrapper.findAll('.help__table')[0]
    const firstCol = tagsTable.findAll('tbody tr td:first-child').map((td) => td.text())
    // Ordre aligné sur celui de la barre CM6 depuis le regroupement (revue 28/07) :
    // [Étape][Note][Aide-mémoire] puis [Compteur][Section][Texte], Image en dernier (pas
    // de contrôle correspondant dans la barre).
    expect(firstCol).toEqual(['Étape', 'Note', 'Aide-mémoire', 'Compteur', 'Section', 'Texte', 'Image'])
    for (const label of firstCol) expect(label).not.toContain('…')
  })

  it('Conseils rejoint les 8 blocs Référence, juste après Matériel', () => {
    const wrapper = mountHelp()
    const refsTable = wrapper.findAll('.help__table')[1]
    const firstCol = refsTable.findAll('tbody tr td:first-child').map((td) => td.text())
    expect(firstCol).toEqual([
      'Fil', 'Aiguilles/Crochet', 'Échantillon', 'Matériel', 'Conseils',
      'Abréviations', 'Tailles', 'Techniques',
    ])
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
    // Retour device : les 3 menus (Compteur/Section/Aide-mémoire) gardent leur libellé
    // texte dans la barre → PAS d'icône accolée, donc PAS d'icône dans la légende non
    // plus ; Image n'a pas de bouton. Seuls les 3 boutons en icône seule
    // (Étape=checkbox / Note=note / Texte=text) sont décodés ici, dans l'ordre du tableau.
    expect(icons.map((i) => i.props('name'))).toEqual(['checkbox', 'note', 'text'])
    // Le 2e tableau (sous-catégories d'aide-mémoire) n'a jamais eu d'icône.
    const refsTable = wrapper.findAll('.help__table')[1]
    expect(refsTable.findAllComponents(AppIcon)).toHaveLength(0)
  })

  // (lot « aide accolades + hiérarchie des titres ») — le manque documenté :
  // l'aide ne disait RIEN du balisage brut visible en mode « Modifier le texte »
  // (`## Fil {yarn}`, `### Croiser une torsade`), alors que {yarn} est un marqueur de
  // catégorie EN ANGLAIS lu par REF_TAG_TO_KEY (src/utils/pattern-md/refblocks.js) — le
  // TRADUIRE fait retomber le bloc en section de travail ordinaire (parse.js:60, lineType
  // renvoie 'section' au lieu de 'reference') et le bloc quitte la fiche du patron. C'est
  // le seul endroit de l'app où une syntaxe technique est offerte à la frappe libre sans un
  // mot d'explication.
  //
  // Revue post-implémentation (point critique) : LE SUPPRIMER, lui, est SANS DANGER tant
  // que le titre français nu reste intact — `parse.js:60` retombe alors sur
  // `reservedKey(b.title)`, la compat FR héritée qui reconnaît "Fil" à son libellé nu (cf.
  // tests/unit/find-reference-block.spec.js, « trouve un titre réservé NU »). Le premier
  // jet de ce texte affirmait aussi ce risque de suppression — FAUX, corrigé.
  it("explique le balisage brut du mode « Modifier le texte » : accolades, sous-titre, puces/notes/tableau", () => {
    const wrapper = mountHelp()
    const txt = wrapper.text()

    // DERNIER <h3> du corps. Le corps en compte 4 depuis le lot « bandes du bas » (26/08/2026,
    // qui a inséré « Les bandes du bas de l'écran » juste après les 3 étapes) : viser la fin
    // plutôt qu'un index absolu, pour que l'ajout d'une section EN AMONT ne fasse plus échouer
    // un test qui ne parle que de celle-ci.
    const headings = wrapper.findAll('.help__body h3').map((h) => h.text())
    expect(headings).toHaveLength(4)
    expect(headings.at(-1)).toContain('Modifier le texte')

    // 1. Les accolades du titre `## Fil {yarn}` : marqueur EN ANGLAIS, ne pas le traduire
    // sous peine de faire sortir le bloc de l'aide-mémoire. Exemple LITTÉRAL exact (pas
    // juste « contient {yarn} ») : `referenceBlocksToMd` (src/utils/pattern-md/
    // refblocks.js:55) écrit "## Fil {yarn}" EN FRANÇAIS quelle que soit la langue de
    // l'app (donnée gelée, pas un libellé d'interface) — l'aide doit montrer EXACTEMENT ce
    // que l'éditeur affiche, pas une version « Yarn »/« Garn » localisée à tort du mot « Fil ».
    expect(txt).toContain('## Fil {yarn}')
    expect(txt).toMatch(/ne le traduis pas/i)
    expect(txt).toContain('aide-mémoire')
    // Revue post-implémentation : l'aide n'affirme PLUS que supprimer le marqueur est
    // dangereux (c'est faux, cf. commentaire ci-dessus) — seule sa TRADUCTION l'est.
    // Portée RESSERRÉE sur le bloc balisage (lot « bandes du bas », 26/08/2026) : l'aide parle
    // désormais AUSSI de supprimer des images de la galerie, plus haut, dans un bloc à part
    // (.help__strips). Chercher « supprim » dans le texte ENTIER confondait les deux sujets.
    expect(wrapper.find('.help__markup').text()).not.toMatch(/supprim/i)

    // 2. `### Titre` : un sous-titre, dans un bloc Techniques.
    expect(txt).toContain('### Titre')
    expect(txt).toContain('sous-titre')
    expect(txt).toContain('Techniques')

    // 3. `- ` = étape, `> ` = note, `| … |` = rangée de tableau.
    expect(txt).toContain('une étape')
    expect(txt).toContain('une note')
    expect(txt).toContain('une rangée de tableau')
  })
})
