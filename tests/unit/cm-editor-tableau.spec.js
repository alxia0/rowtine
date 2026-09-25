// @vitest-environment jsdom
// Un bloc de tableau Markdown doit s'afficher en VRAI tableau en vue enrichie.
// Avant ce correctif, `lineType` classait `| mesure | S | M |` en `'texte'` (aucun test ne
// matchait le tuyau), donc l'écran « Corriger le patron » montrait le tableau des tailles
// barres verticales comprises — soit précisément ce que la tricoteuse vient corriger, sous sa
// forme la moins lisible.
//
// Sur le modèle de tests/unit/cm-editor-sous-titre.spec.js : un vrai `createCmEditor` monté en
// jsdom. On lit le DOM RÉELLEMENT construit par CodeMirror (`view.contentDOM`), pas les plages
// de décoration internes — celles-ci ne prouveraient que l'intention, pas le rendu.
//
// Le lot le plus important de ce fichier est le REPLI : un tableau mal formé ne
// doit JAMAIS faire disparaître du contenu. Chacun de ces tests vérifie les deux moitiés de la
// règle : aucune `<table>` (donc pas de widget), ET le texte source intégralement présent.
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import { moveLineUp, moveLineDown } from '@/components/cm/move-line'
import { runScopeHandlers } from '@codemirror/view'

function mount(value) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value })
  return { host, editor, view: editor.view }
}

// Place le curseur en tête de la ligne 1-based demandée, comme le fait le clic sur une
// cellule (selectTableLine) — sans passer par le DOM, pour les tests de flèches.
function putCursorOnLine(view, lineNo) {
  view.dispatch({ selection: { anchor: view.state.doc.line(lineNo).from } })
}

const EN_TETE = '| mesure | S | M | L |'
const SEPARATEUR = '|---|---|---|---|'
const RANGEE_1 = '| Tour de tête | 52 | 56 | 58 |'
const RANGEE_2 = '| Hauteur | 20 | 21 | 22 |'

// Le tableau des tailles tel que `refblocks.js` l'émet (referenceBlocksToMd, ligne ~75) :
// titre balisé, ligne vide, en-tête, séparatrice, rangées.
const DOC_BIEN_FORME = ['## Tailles {measurements}', '', EN_TETE, SEPARATEUR, RANGEE_1, RANGEE_2, '', 'texte après'].join(
  '\n'
)

describe('tableau Markdown rendu en vraie <table> (vue enrichie)', () => {
  it('rend une <table> dont le nombre de colonnes est celui de l’en-tête source', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    // 4 colonnes : `mesure`, `S`, `M`, `L` — comptées sur la source, pas codées en dur, pour
    // que le test suive l'en-tête si on l'édite.
    const colonnesSource = EN_TETE.trim().slice(1, -1).split('|').length
    expect(table.querySelectorAll('thead th')).toHaveLength(colonnesSource)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(table.querySelectorAll('tbody tr')[0].querySelectorAll('td')).toHaveLength(colonnesSource)
    host.remove()
  })

  it('les barres verticales ne sont plus dans le texte rendu, les valeurs si', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    const text = view.contentDOM.textContent
    expect(text).not.toContain('|')
    expect(text).toContain('Tour de tête')
    expect(text).toContain('58')
    // La ligne séparatrice ne doit JAMAIS être rendue comme une rangée.
    expect(text).not.toContain('---')
    host.remove()
  })

  it('setMarkupHidden(false) : le balisage brut réapparaît, barres comprises', () => {
    const { editor, view, host } = mount(DOC_BIEN_FORME)
    editor.setMarkupHidden(false)
    const text = view.contentDOM.textContent
    expect(view.contentDOM.querySelector('table')).toBeNull()
    expect(text).toContain(EN_TETE)
    expect(text).toContain(SEPARATEUR)
    expect(text).toContain(RANGEE_1)
    host.remove()
  })

  it('une rangée plus COURTE que l’en-tête se rend, cases manquantes vides', () => {
    // Le cas d'un patron fraîchement importé, ouvert dans « Corriger le patron » AVANT tout
    // enregistrement — donc le scénario même de cet écran. Vérifié sur l'émetteur réel :
    // `referenceBlocksToMd({ sizeTable: [{ label: 'Tour', values: ['52'] }] }, ['S','M','L'])`
    // produit `| Tour | 52 |` sous un en-tête à 4 colonnes, sans jamais compléter ; et
    // `resizeReferenceSizeTable` (qui, lui, recadre) est délibérément HORS du chemin
    // d'import, il ne s'applique qu'à l'enregistrement. Replier sur cette forme éteindrait
    // la fonctionnalité précisément là où elle sert.
    const doc = [EN_TETE, SEPARATEUR, '| Tour de tête | 52 |', RANGEE_2].join('\n')
    const { view, host } = mount(doc)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    const cellules = table.querySelectorAll('tbody tr')[0].querySelectorAll('td')
    // 4 cellules alignées sur l'en-tête, les deux dernières vides — rien d'inventé.
    expect(cellules).toHaveLength(4)
    expect(cellules[1].textContent).toBe('52')
    expect(cellules[2].textContent).toBe('')
    expect(cellules[3].textContent).toBe('')
    // Et rien n'est perdu non plus : la valeur présente reste lisible.
    expect(view.contentDOM.textContent).toContain('Tour de tête')
    host.remove()
  })

  it('une rangée aux cellules vides reste une rangée (cas réel des tailles ajoutées)', () => {
    // `| | | |` n'est fait que de barres et d'espaces : la regex de ligne séparatrice du
    // parseur (isTableSep, refblocks.js) le reconnaît à tort comme séparateur. Interdire
    // toute séparatrice après l'en-tête ferait donc replier le tableau des tailles au premier
    // ajout de taille non renseignée — le scénario même des commits récents (« La case vide
    // d'une taille ajoutée survit au second enregistrement »). Seule la POSITION compte :
    // séparatrice = la ligne d'indice 1 du bloc, rien d'autre.
    const doc = [EN_TETE, SEPARATEUR, RANGEE_1, '|  |  |  |  |'].join('\n')
    const { view, host } = mount(doc)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    host.remove()
  })
})

// Point de revue nº1 — le groupement des lignes en BLOC doit être celui du parseur, sinon
// l'écran ne dit pas ce qui sera enregistré. `parseTableBlock` (refblocks.js) prend TOUTES
// les lignes-tuyau de la rubrique, trous compris ; le premier jet de `buildTableDecorations`
// ne groupait que les lignes CONTIGUËS. Les deux scénarios ci-dessous sont ceux où les deux
// règles divergeaient — dans les deux sens — et chacun est atteignable à une pression de
// flèche.
describe('groupement aligné sur le parseur (lignes-tuyau de la rubrique)', () => {
  it('une ligne vide ENTRE deux rangées ne coupe pas le tableau', () => {
    // Avant : l'éditeur montrait un tableau à une rangée PLUS une rangée brute isolée, alors
    // que l'enregistrement remettait la rangée dans le tableau.
    const doc = ['## Tailles {measurements}', '', EN_TETE, SEPARATEUR, RANGEE_1, '', RANGEE_2].join('\n')
    const { view, host } = mount(doc)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(view.contentDOM.textContent).not.toContain('|')
    host.remove()
  })

  it('une ligne vide entre l’en-tête et la séparatrice ne replie plus tout en brut', () => {
    // Avant : repli total ici, alors que le parseur y lisait une table valide (il cherche la
    // séparatrice à la 2e LIGNE-TUYAU, pas à la 2e ligne).
    const doc = ['## Tailles {measurements}', '', EN_TETE, '', SEPARATEUR, RANGEE_1].join('\n')
    const { view, host } = mount(doc)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1)
    host.remove()
  })

  it('une ligne de CONTENU entre deux rangées interdit le widget, rien n’est masqué', () => {
    // La contrepartie assumée : le parseur regrouperait quand même les deux rangées, mais un
    // widget ne peut pas couvrir le groupe sans MASQUER la ligne de contenu qui le coupe. On
    // sous-affiche donc — ce qui n'est jamais un mensonge — au lieu de montrer un tableau
    // amputé ou d'avaler du texte.
    const doc = ['## Tailles {measurements}', '', EN_TETE, SEPARATEUR, RANGEE_1, 'une remarque', RANGEE_2].join('\n')
    const { view, host } = mount(doc)
    expect(view.contentDOM.querySelector('table')).toBeNull()
    const text = view.contentDOM.textContent
    for (const l of [EN_TETE, SEPARATEUR, RANGEE_1, RANGEE_2]) expect(text).toContain(l)
    expect(text).toContain('une remarque')
    host.remove()
  })

  // Point de revue nº1 (re-revue) — la PORTÉE du refus est le groupe entier, donc toute la
  // rubrique : une seule ligne de contenu intercalée supprime le rendu de TOUS ses tableaux.
  // C'est le coût assumé de l'alignement sur le parseur (dont le groupe est lui aussi la
  // rubrique entière). Ce test le fixe pour qu'il soit constaté, pas découvert.
  it('une ligne de contenu entre deux tables supprime le rendu de TOUTE la rubrique', () => {
    const doc = [
      '## Abréviations {abbreviations}',
      '',
      '| abr. | définition |',
      '|---|---|',
      '| dim. | diminuer |',
      '',
      'une remarque au milieu',
      '',
      '| abr. | définition |',
      '|---|---|',
      '| aug. | augmenter |',
    ].join('\n')
    const { view, host } = mount(doc)
    expect(view.contentDOM.querySelectorAll('table')).toHaveLength(0)
    const text = view.contentDOM.textContent
    for (const l of ['| dim. | diminuer |', '| aug. | augmenter |', 'une remarque au milieu']) {
      expect(text).toContain(l)
    }
    host.remove()
  })

  // …et l'atténuation : un SOUS-TITRE, lui, referme le groupe au lieu de le faire tomber.
  // Divergence délibérée avec le parseur (qui ne coupe pas sur `###`) : elle rend deux
  // tableaux là où la règle stricte n'en rendait aucun, sans rien masquer — le sous-titre
  // reste affiché entre les deux, dièses déjà masqués.
  it('un sous-titre ### ferme le groupe au lieu de faire tomber toute la rubrique', () => {
    const doc = [
      '## Abréviations {abbreviations}',
      '',
      '| abr. | définition |',
      '|---|---|',
      '| dim. | diminuer |',
      '',
      '### Points fantaisie',
      '',
      '| abr. | définition |',
      '|---|---|',
      '| aug. | augmenter |',
    ].join('\n')
    const { view, host } = mount(doc)
    expect(view.contentDOM.querySelectorAll('table')).toHaveLength(2)
    const text = view.contentDOM.textContent
    expect(text).toContain('Points fantaisie')
    expect(text).not.toContain('###')
    expect(text).not.toContain('|')
    host.remove()
  })

  it('un titre de rubrique ferme le groupe : deux tableaux voisins restent deux tableaux', () => {
    const doc = [
      '## Abréviations {abbreviations}',
      '',
      '| abr. | définition |',
      '|---|---|',
      '| dim. | diminuer |',
      '',
      '## Tailles {measurements}',
      '',
      EN_TETE,
      SEPARATEUR,
      RANGEE_1,
    ].join('\n')
    const { view, host } = mount(doc)
    const tables = view.contentDOM.querySelectorAll('table')
    expect(tables).toHaveLength(2)
    expect(tables[0].querySelectorAll('thead th')).toHaveLength(2)
    expect(tables[1].querySelectorAll('thead th')).toHaveLength(4)
    host.remove()
  })
})

describe('repli : un tableau mal formé ne perd JAMAIS de contenu', () => {
  // Chaque cas monte l'éditeur en vue enrichie (le défaut) et exige les deux moitiés de la
  // règle cardinale : pas de widget, et tout le texte source encore lisible à l'écran.
  const cas = [
    {
      nom: 'ligne séparatrice absente',
      lignes: [EN_TETE, RANGEE_1, RANGEE_2],
    },
    {
      nom: 'rangée PLUS LONGUE que l’en-tête',
      // Repli, et pas un rendu tronqué : l'éditeur devrait décider à quelle colonne
      // appartient la 5e valeur. C'est `fitSizeRowValues` (reader.js) qui tranche, à
      // l'enregistrement, en repliant le surplus dans la dernière colonne. Montrer la ligne
      // brute laisse la tricoteuse placer la valeur elle-même. Voir le test symétrique dans
      // le describe précédent : une rangée plus COURTE, elle, se rend avec des cases vides.
      lignes: [EN_TETE, SEPARATEUR, RANGEE_1, '| Hauteur | 20 | 21 | 22 | 23 |'],
    },
    {
      nom: 'une seule ligne qui ressemble à une rangée',
      lignes: [RANGEE_1],
    },
    {
      nom: 'en-tête et séparatrice sans aucune rangée',
      lignes: [EN_TETE, SEPARATEUR],
    },
    {
      nom: 'séparatrice mal placée (au-dessus de l’en-tête)',
      lignes: [SEPARATEUR, EN_TETE, RANGEE_1],
    },
    {
      // Point de revue nº4 : ce cas est le SEUL à n'être refusé que par la garde
      // `isTableSep(lignes[0])`. Le cas ci-dessus, lui, tombe déjà sur la garde
      // précédente (« séparatrice à l'indice 1 ») — le retrait de cette garde-ci
      // laissait donc la suite verte. Ici les deux premières lignes sont des
      // séparatrices : l'indice 1 en est bien une, et seule la garde sur l'en-tête
      // empêche de rendre un tableau dont l'en-tête serait `--- | ---`.
      nom: 'deux séparatrices d’affilée : l’en-tête ne peut pas être une séparatrice',
      lignes: ['|---|---|', '|---|---|', '| a | b |'],
    },
    {
      nom: 'largeur de la séparatrice différente de celle de l’en-tête',
      lignes: [EN_TETE, '|---|---|', RANGEE_1],
    },
  ]

  for (const { nom, lignes } of cas) {
    it(`${nom} : aucune <table>, tout le texte source reste affiché`, () => {
      const { view, host } = mount(['avant', ...lignes, 'après'].join('\n'))
      expect(view.contentDOM.querySelector('table')).toBeNull()
      const text = view.contentDOM.textContent
      for (const ligne of lignes) expect(text).toContain(ligne)
      expect(text).toContain('avant')
      expect(text).toContain('après')
      host.remove()
    })
  }

  it('les lignes repliées portent la classe de ligne md-tableau', () => {
    const { view, host } = mount([EN_TETE, RANGEE_1].join('\n'))
    const lignes = [...view.contentDOM.querySelectorAll('.cm-line.md-tableau')]
    expect(lignes).toHaveLength(2)
    host.remove()
  })
})

// Point de revue nº5 — l'AUTRE moitié de la couverture. Tout le reste de ce fichier épingle
// « pas de widget → texte conservé » ; ceci épingle le cas inverse, celui où le widget se
// pose alors qu'il ne devrait pas. C'est une frontière connue de la règle « la séparatrice
// est la 2e ligne-tuyau, point » (voir tableBlockModel) : une rangée aux cases toutes vides
// tombant à cette place est prise pour la séparatrice, et la vraie séparatrice descend d'un
// cran, où elle s'affiche en rangée de `---`.
//
// Ce n'est PAS une violation de la règle cardinale : la seule ligne masquée est vide, donc
// aucun contenu ne disparaît. Mais c'est à une pression de flèche d'un document réel, et ça
// doit être documenté plutôt que découvert. Le test dit l'état exact, pour qu'un changement
// de règle le fasse remarquer au lieu de passer inaperçu.
describe('frontière connue : une rangée vide en 2e ligne-tuyau est prise pour la séparatrice', () => {
  const doc = [EN_TETE, '|  |  |  |  |', SEPARATEUR, RANGEE_1].join('\n')

  it('le widget se pose, la vraie séparatrice s’affiche en rangée de tirets', () => {
    const { view, host } = mount(doc)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    const rangees = table.querySelectorAll('tbody tr')
    expect(rangees).toHaveLength(2)
    expect(rangees[0].textContent).toBe('------------')
    host.remove()
  })

  it('aucun CONTENU n’est perdu pour autant : la ligne avalée est vide', () => {
    const { view, host } = mount(doc)
    const text = view.contentDOM.textContent
    // Tout le texte porteur de sens des 4 lignes source est encore à l'écran.
    for (const mot of ['mesure', 'S', 'M', 'L', 'Tour de tête', '52', '56', '58']) {
      expect(text).toContain(mot)
    }
    // Et la ligne prise pour la séparatrice ne portait, elle, aucun caractère utile.
    expect('|  |  |  |  |'.replace(/[|\s]/g, '')).toBe('')
    host.remove()
  })
})

describe('clic sur une cellule : le curseur va sur la ligne source correspondante', () => {
  it('une cellule de la 2e rangée pose le curseur sur la ligne source de cette rangée', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    const cellules = view.contentDOM.querySelectorAll('tbody tr')[1].querySelectorAll('td')
    cellules[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // Bloc = lignes 3..6 (1-based) : en-tête 3, séparatrice 4, rangée 1 → 5, rangée 2 → 6.
    const ligne = view.state.doc.lineAt(view.state.selection.main.head)
    expect(ligne.number).toBe(6)
    expect(ligne.text).toBe(RANGEE_2)
    host.remove()
  })

  it('une cellule d’en-tête pose le curseur sur la ligne d’en-tête', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    const th = view.contentDOM.querySelectorAll('thead th')[2]
    th.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe(EN_TETE)
    host.remove()
  })
})

// Point de revue nº3 — l'exigence veut que le clic pose le curseur ; un curseur
// INVISIBLE ne remplit pas l'objet de l'exigence. La ligne source est masquée par le widget,
// donc `cm-active-block` (posé sur `.cm-line` par `lineTypePlugin`) tombe sur une ligne qui
// n'est pas rendue. On marque donc la rangée elle-même.
describe('la rangée du curseur est marquée dans le tableau rendu', () => {
  const marquees = (view) => [...view.contentDOM.querySelectorAll('tr.is-cursor-row')]

  it('un clic sur une cellule marque SA rangée, et elle seule', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    const rangees = view.contentDOM.querySelectorAll('tbody tr')
    rangees[1].querySelectorAll('td')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const m = marquees(view)
    expect(m).toHaveLength(1)
    expect(m[0].textContent).toContain('Hauteur')
    host.remove()
  })

  it('le marquage SUIT le curseur d’une rangée à l’autre', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 5) // RANGEE_1
    expect(marquees(view)[0].textContent).toContain('Tour de tête')
    putCursorOnLine(view, 6) // RANGEE_2
    const m = marquees(view)
    expect(m).toHaveLength(1)
    expect(m[0].textContent).toContain('Hauteur')
    host.remove()
  })

  it('l’en-tête peut être marqué lui aussi', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 3) // ligne d'en-tête
    const m = marquees(view)
    expect(m).toHaveLength(1)
    expect(m[0].closest('thead')).toBeTruthy()
    host.remove()
  })

  it('curseur hors du tableau : plus aucune rangée marquée', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 6)
    expect(marquees(view)).toHaveLength(1)
    putCursorOnLine(view, 8) // « texte après »
    expect(marquees(view)).toHaveLength(0)
    host.remove()
  })

  // Point de revue nº3 (re-revue) : c'est CE test qui exerce `eq()`, et lui seul. Une
  // édition ailleurs dans le document est une transaction `docChanged` : le champ recalcule
  // ses décorations, un NOUVEAU TableWidget est construit, et c'est `eq()` — qui compare le
  // texte source du bloc et son offset, tous deux inchangés ici — qui décide que CM6 peut
  // réutiliser le nœud DOM existant. D'où les deux assertions : le marquage doit être reposé
  // (le DOM d'un widget re-rendu reviendrait sans la classe), ET le nœud doit être le MÊME
  // objet (c'est la preuve qu'`eq()` a bien renvoyé vrai — un `eq()` cassé le remplacerait).
  it('une édition ailleurs : le nœud du tableau est réutilisé (eq) et le marquage reposé', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 6)
    const table = view.contentDOM.querySelector('table')
    const avant = view.state.selection.main.head
    view.dispatch({ changes: { from: view.state.doc.line(8).from, insert: 'X' }, selection: { anchor: avant } })
    expect(view.contentDOM.querySelector('table')).toBe(table)
    const m = marquees(view)
    expect(m).toHaveLength(1)
    expect(m[0].textContent).toContain('Hauteur')
    host.remove()
  })

  it('déplacer le curseur ne recalcule même pas les décorations de tableau', () => {
    // Ce test ne prouve PAS `eq()` — correction d'une affirmation trop généreuse du premier
    // rapport. Sur une transaction de SÉLECTION seule, `EditorView.decorations.compute` ne
    // recalcule rien (ni le doc ni `hideMarkup` n'ont bougé) : le `DecorationSet` est le même
    // par référence et `eq()` n'est jamais appelé. Le nœud est donc conservé pour une raison
    // plus forte encore, et ce test resterait vert avec un `eq()` toujours faux — c'est le
    // test ci-dessus qui couvre ce cas-là.
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 5)
    const table = view.contentDOM.querySelector('table')
    putCursorOnLine(view, 6)
    expect(view.contentDOM.querySelector('table')).toBe(table)
    host.remove()
  })
})

// Décision assumée : les flèches restent INCHANGÉES
// (elles déplacent la ligne source du curseur). La raison tient dans ces deux tests : les
// règles de repli ci-dessus font que TOUT déplacement cassant la structure ramène le bloc à
// son texte brut. La casse s'annonce donc d'elle-même — le widget ne la masque pas — ce qui
// est exactement ce que « jamais de perte silencieuse » demande.
describe('flèches monter/descendre dans un bloc de tableau', () => {
  it('réordonner deux rangées DANS le bloc : le tableau reste rendu, l’ordre change', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 6) // RANGEE_2
    moveLineUp(view)
    expect(view.state.doc.line(5).text).toBe(RANGEE_2)
    expect(view.state.doc.line(6).text).toBe(RANGEE_1)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('tbody tr')[0].textContent).toContain('Hauteur')
    host.remove()
  })

  it('faire passer une rangée de l’autre côté de la séparatrice : le balisage brut réapparaît', () => {
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 5) // RANGEE_1, juste sous la séparatrice
    moveLineUp(view) // la rangée passe AU-DESSUS de la séparatrice → structure cassée
    expect(view.contentDOM.querySelector('table')).toBeNull()
    const text = view.contentDOM.textContent
    expect(text).toContain(EN_TETE)
    expect(text).toContain(SEPARATEUR)
    expect(text).toContain(RANGEE_1)
    expect(text).toContain(RANGEE_2)
    host.remove()
  })

  it('descendre la dernière rangée d’un cran (par-dessus la ligne vide) la garde dans le tableau', () => {
    // Correction d'un énoncé faux du premier rapport, qui prétendait que la rangée « sortait
    // du bloc ». Elle n'en sort pas : le groupement suit celui du parseur, qui tolère les
    // lignes vides. L'affichage et l'enregistrement disent donc la même chose — c'est le
    // comportement voulu, pas un accident.
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 6) // RANGEE_2, dernière rangée
    moveLineDown(view) // passe après la ligne vide qui suit
    expect(view.state.doc.line(7).text).toBe(RANGEE_2)
    const table = view.contentDOM.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    host.remove()
  })

  it('la pousser d’un cran de plus, au-delà d’une ligne de texte : tout revient en brut', () => {
    // C'est CE mécanisme-là qui rend la casse visible, et pas « le bloc fait moins de trois
    // lignes » comme l'affirmait le premier rapport : une fois une ligne de CONTENU
    // intercalée entre les rangées, le groupe n'est plus couvrable par une plage de
    // remplacement sans masquer ce contenu — donc plus de widget du tout, et les quatre
    // lignes source réapparaissent barres comprises. Impossible de ne pas le voir.
    const { view, host } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 6)
    moveLineDown(view) // par-dessus la ligne vide
    moveLineDown(view) // par-dessus « texte après »
    expect(view.state.doc.line(8).text).toBe(RANGEE_2)
    expect(view.contentDOM.querySelector('table')).toBeNull()
    const text = view.contentDOM.textContent
    for (const l of [EN_TETE, SEPARATEUR, RANGEE_1, RANGEE_2]) expect(text).toContain(l)
    // La rangée échappée est bien une LIGNE distincte de l'éditeur, pas juste une sous-chaîne
    // du texte : elle porte sa propre `.cm-line.md-tableau`.
    const lignes = [...view.contentDOM.querySelectorAll('.cm-line.md-tableau')]
    expect(lignes.map((l) => l.textContent)).toContain(RANGEE_2)
    host.remove()
  })
})

// Protège : Retour-arrière / Suppr avec le curseur posé DANS un tableau (clic sur une cellule) n'efface pas de rangées.
describe('tableau : Retour-arrière et Suppr depuis une rangée', () => {
  const touche = (view, key) => runScopeHandlers(view, new KeyboardEvent('keydown', { key, cancelable: true }), 'editor')

  it.each(['Backspace', 'Delete'])('%s sur une rangée intérieure ne supprime aucune ligne du tableau', (key) => {
    const { view, host, editor } = mount(DOC_BIEN_FORME)
    putCursorOnLine(view, 5) // RANGEE_1, strictement à l'intérieur du bloc
    touche(view, key)
    expect(editor.getValue()).toBe(DOC_BIEN_FORME)
    host.remove()
  })
})
