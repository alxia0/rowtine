// Retour terrain (16/07/2026) : étiqueter des lignes avec la catégorie « Taille »
// de l'aide-mémoire les faisait DISPARAÎTRE du patron (« contenu non reconnu
// (table attendue), lignes ignorées »). Avertir ne suffit pas : le contenu saisi
// par la travailleuse ne doit jamais être détruit — il est rétrogradé en notes.
import { describe, it, expect } from 'vitest'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { patternToMd } from '@/utils/pattern-md/serialize'
import { retagSelection } from '@/utils/pattern-md/md-retag-selection'
import { editableToReader } from '@/utils/pattern-md/reader-editable'
import { formatWarningFr } from '@/utils/pattern-md/warning-codes'

// Les avertissements sont désormais des objets structurés `{ code, params }` (tâche B3) — ce
// fichier de test, lui, continue de vérifier leur CONTENU en français (il tourne sous Node, pas
// dans l'app). `formatWarningFr` est exactement le repli prévu pour ça (cf. warning-codes.js) ;
// il laisse passer telles quelles les chaînes brutes que `parse.js` pousse encore ailleurs
// (kind inconnu, image indentée…), hors périmètre de cette tâche.
const asFr = (warnings) => warnings.map(formatWarningFr).join(' ')

const FM = '---\nrowtine: 1\ntitle: Essai\n---\n\n'

// Tous les textes de notes d'un reader, à plat (l'emplacement où le contenu
// rétrogradé doit atterrir).
const noteTexts = (reader) =>
  (reader?.sections || []).flatMap((s) => (s.steps || []).filter((st) => st.note).map((st) => st.t))

describe('bloc Tailles — non destructif', () => {
  it('avertit MAIS conserve le contenu non tabulaire, en notes', () => {
    const res = mdToPattern(`${FM}## Tailles {measurements}

Ceci n'est pas une table : une ligne saisie par l'utilisatrice.
`)
    // On avertit toujours…
    expect(asFr(res.warnings)).toMatch(/Tailles/i)
    // … mais on ne dit plus « ignorées », puisque ce n'est plus vrai.
    expect(asFr(res.warnings)).not.toMatch(/ignorée/i)
    expect(asFr(res.warnings)).toMatch(/conservé/i)
    // … et le texte survit, comme note, à la place du bloc.
    expect(noteTexts(res.pattern.reader)).toContain(
      "Ceci n'est pas une table : une ligne saisie par l'utilisatrice."
    )
  })

  it('conserve le TITRE quand le bloc ne produit aucune table (geste réel de retag)', () => {
    // Geste réel : « Aide mémoire… > Tailles » réécrit CHAQUE ligne sélectionnée
    // en `## <la ligne> {measurements}` (md-retag.js) — la ligne EST le titre.
    const res = mdToPattern(`${FM}## Taille 1 : 36-38 {measurements}
`)
    expect(noteTexts(res.pattern.reader)).toContain('Taille 1 : 36-38')
  })

  it('conserve une ligne de table au mauvais nombre de valeurs', () => {
    const res = mdToPattern(`---
rowtine: 1
sizes: S · M · L
---

## Tailles {measurements}

| mesure | S | M | L |
|---|---|---|---|
| Tour de poitrine | 74 | 82 | 90 |
| Longueur dos | 40 | 42 |
`)
    expect(asFr(res.warnings)).toMatch(/Longueur dos/)
    expect(asFr(res.warnings)).not.toMatch(/ignorée/i)
    // La ligne exploitable reste dans le tableau des tailles…
    const rows = res.pattern.reader.reference.tabs.find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows).toEqual([{ label: 'Tour de poitrine', values: ['74', '82', '90'] }])
    // … et la ligne rejetée survit en note plutôt que d'être jetée.
    expect(noteTexts(res.pattern.reader).join(' ')).toContain('Longueur dos')
  })

  it('non-régression : une table valide ne produit ni note ni avertissement', () => {
    const res = mdToPattern(`---
rowtine: 1
sizes: S · M · L
---

## Tailles {measurements}

| mesure | S | M | L |
|---|---|---|---|
| Tour de poitrine (cm) | 74 | 82 | 90 |
`)
    expect(res.warnings).toEqual([])
    expect(res.pattern.reader.sections).toEqual([])
    expect(res.pattern.reader.reference.tabs.find((t) => t.id === 'tailles')).toBeTruthy()
  })

  it('le contenu rétrogradé est stable à la re-sérialisation (pas de re-absorption)', () => {
    const md1 = `${FM}## Corps {body}

- Rang 1 : monter 90 m

## Tailles {measurements}

Mesures prises à plat, sans étirer.
`
    const first = mdToPattern(md1)
    // Aller-retour complet : le patron est ré-émis en MD puis relu. La section de
    // repli ne doit PAS redevenir un bloc réservé (sinon on re-détruirait).
    const { md: md2 } = patternToMd(first.pattern)
    const second = mdToPattern(md2)
    expect(noteTexts(second.pattern.reader)).toContain('Mesures prises à plat, sans étirer.')
    // Stable : le 2e passage n'avertit plus (plus rien à rétrograder).
    expect(second.warnings).toEqual([])
    expect(md2).not.toMatch(/Mesures prises à plat[\s\S]*\{measurements\}/)
  })
})

// Depuis le correctif du 19/08/2026 (retagSelection, transformation de BLOC) : le geste
// « sélectionner des lignes, choisir une catégorie Aide mémoire » alimente désormais la
// RUBRIQUE correspondante, plus les notes. La garde anti-perte ci-dessous reste vraie et
// verte : elle protège un MD qui porterait un titre NON réservé, quelle qu'en soit
// l'origine (saisie manuelle, import externe) — un cas que ce chantier ne touche pas.
describe('écran « Corriger le patron » — le vrai chemin de sauvegarde', () => {
  // mdFragmentToReader renvoie baseReader tel quel quand le parse ne produit
  // AUCUNE section : un fragment ne contenant QUE le bloc Tailles masquerait donc
  // le bug (édition silencieusement annulée). Le patron d'origine avait d'autres
  // sections — c'est ce cas-là qu'on reproduit.
  const baseReader = {
    sizeLabels: [],
    sections: [
      { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Rang 1 : monter 90 m' }] },
      { id: 'tailles-perso', kind: 'pelote', title: 'Mes tailles', steps: [{ t: 'Taille 1 : 36-38' }, { t: 'Taille 2 : 40-42' }] },
    ],
  }

  it('étiqueter des lignes en « Taille » les fait passer dans le tableau des tailles', () => {
    const fragment = `## Corps {body}

- Rang 1 : monter 90 m

## Mes tailles

- Taille 1 : 36-38
- Taille 2 : 40-42
`
    // La travailleuse sélectionne les deux lignes de tailles (7 et 8) et choisit
    // « Aide mémoire… > Tailles » : retagSelection est exactement ce que fait la barre.
    const { changes } = retagSelection(fragment, 7, 8, 'reference', {
      tag: 'measurements',
      sizeLabels: [],
    })
    let out = ''
    let cursor = 0
    for (const c of changes) {
      out += fragment.slice(cursor, c.from) + c.insert
      cursor = c.to
    }
    out += fragment.slice(cursor)
    // Un titre RÉSERVÉ, plus la ligne elle-même en guise de titre.
    expect(out).toContain('## Tailles {measurements}')
    expect(out).not.toContain('## Taille 1 : 36-38 {measurements}')

    const { reader, warnings } = editableToReader(out, baseReader)
    // Le contenu est désormais dans la RUBRIQUE, plus en notes.
    const rows = reader.reference.tabs.find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows.map((r) => r.label)).toEqual(['Taille 1 : 36-38', 'Taille 2 : 40-42'])
    expect(noteTexts(reader)).toEqual([])
    // La section de travail voisine n'est pas emportée au passage.
    expect(JSON.stringify(reader.sections)).toContain('Rang 1 : monter 90 m')
    expect(asFr(warnings)).not.toMatch(/ignorée/i)
  })
})

// Retour terrain (« littéralement supprimées, ce n'est pas acceptable ») reproduit
// sur les 5 rubriques HORS-TABLE du menu « Aide mémoire » (Fil, Aiguilles,
// Échantillon, Matériel, Techniques). Étiqueter une LIGNE d'instruction en l'une
// d'elles la réécrit en `## <la ligne> {tag}` (corps vide) : le titre — donc la
// ligne — était jeté EN SILENCE, et une ligne de travail voisine happée par le
// corps finissait aspirée dans la rubrique. Désormais : quand le titre n'est pas
// le libellé réservé, le bloc entier (titre + corps happé) est rétrogradé en
// notes, sans polluer la rubrique.
describe('rubriques hors-table — non destructif', () => {
  const RUBRICS = [
    { tag: 'yarn', label: 'Fil', reservedTitle: 'Fil', ligne: 'Laine 100% mérinos coloris Rouille', body: 'Coton DK, 3 pelotes' },
    // `ligne` ne doit JAMAIS contenir le mot du libellé de bloc (« Aiguilles ») : sinon
    // l'assertion `toMatch(new RegExp(label))` de la ligne 186 matcherait via `{line}` et
    // resterait verte même si la résolution `{block}` (BLOCK_NAMES_FR.needles) était cassée —
    // constaté par mutation (relecture), non discriminant avant ce correctif.
    { tag: 'needles', label: 'Aiguilles', reservedTitle: 'Aiguilles', ligne: 'Broches circulaires bambou n° 4', body: 'Aig. circulaires n° 4' },
    { tag: 'gauge', label: 'Échantillon', reservedTitle: 'Échantillon', ligne: '18 mailles et 24 rangs au jersey', body: '10 × 10 cm = 20 m × 26 rgs' },
    { tag: 'materials', label: 'Matériel', reservedTitle: 'Matériel', ligne: 'Un lot de 4 anneaux marqueurs', body: '- 4 anneaux marqueurs' },
    // Bloc Conseils, sur le modèle exact de Matériel (même invariant non
    // destructif : un titre réécrit non reconnu survit en note, jamais perdu).
    { tag: 'tips', label: 'Conseils', reservedTitle: 'Conseils', ligne: 'Voir le tuto vidéo sur le site', body: '- Voir la vidéo de montage.' },
    { tag: 'techniques', label: 'Techniques', reservedTitle: 'Techniques', ligne: 'Montage tubulaire des mailles', body: '### Montage\nMonter les mailles ainsi…' },
  ]

  it.each(RUBRICS)('$label : une ligne étiquetée (titre réécrit) survit en note + avertissement honnête', ({ tag, label, ligne }) => {
    const res = mdToPattern(`${FM}## Corps {body}

- Rang 1 : monter 90 m

## ${ligne} {${tag}}
`)
    // La ligne (devenue titre) survit, comme note.
    expect(noteTexts(res.pattern.reader)).toContain(ligne)
    // On avertit — honnêtement (jamais « ignorée »).
    expect(asFr(res.warnings)).toMatch(new RegExp(label))
    expect(asFr(res.warnings)).toMatch(/conservé/i)
    expect(asFr(res.warnings)).not.toMatch(/ignorée/i)
    // Pas de rubrique parasite bâtie depuis une ligne d'instruction.
    expect(res.pattern.reader.reference).toBeFalsy()
    // La section de travail voisine n'est pas emportée.
    expect(JSON.stringify(res.pattern.reader.sections)).toContain('Rang 1 : monter 90 m')
  })

  it.each(RUBRICS)('$label : un vrai bloc réservé alimente la rubrique, sans note ni avertissement (non-régression)', ({ tag, reservedTitle, body }) => {
    const res = mdToPattern(`${FM}## ${reservedTitle} {${tag}}

${body}
`)
    expect(res.warnings).toEqual([])
    expect(noteTexts(res.pattern.reader)).toEqual([])
    expect(res.pattern.reader.reference).toBeTruthy()
    expect(res.pattern.reader.reference.tabs.length).toBeGreaterThan(0)
  })

  it('Fil — vrai chemin editableToReader : deux lignes étiquetées « Fil » alimentent la rubrique', () => {
    const baseReader = {
      sizeLabels: [],
      sections: [
        { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Rang 1 : monter 90 m' }] },
        { id: 'mat', kind: 'pelote', title: 'Matériaux', steps: [{ t: 'Laine 100% mérinos coloris Rouille' }, { t: 'Aiguilles n° 4' }] },
      ],
    }
    const fragment = `## Corps {body}

- Rang 1 : monter 90 m

## Matériaux

- Laine 100% mérinos coloris Rouille
- Aiguilles n° 4
`
    // Sélection des deux lignes matériaux (7 et 8) → « Aide mémoire… > Fil ».
    const { changes } = retagSelection(fragment, 7, 8, 'reference', { tag: 'yarn' })
    let out = ''
    let cursor = 0
    for (const c of changes) {
      out += fragment.slice(cursor, c.from) + c.insert
      cursor = c.to
    }
    out += fragment.slice(cursor)
    expect(out).toContain('## Fil {yarn}')
    expect(out).not.toContain('## Laine 100% mérinos coloris Rouille {yarn}')

    const { reader, warnings } = editableToReader(out, baseReader)
    const tab = reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.yarn')
    expect(bloc.p.join(' ')).toContain('Laine 100% mérinos coloris Rouille')
    expect(bloc.p.join(' ')).toContain('Aiguilles n° 4')
    expect(noteTexts(reader)).toEqual([])
    // La section de travail voisine (Corps) n'est pas emportée.
    expect(JSON.stringify(reader.sections)).toContain('Rang 1 : monter 90 m')
    expect(asFr(warnings)).not.toMatch(/ignorée/i)
  })

  it('Fil rétrogradé : stable à la re-sérialisation (pas de re-absorption en {yarn})', () => {
    const first = mdToPattern(`${FM}## Corps {body}

- Rang 1 : monter 90 m

## Laine 100% mérinos coloris Rouille {yarn}
`)
    expect(noteTexts(first.pattern.reader)).toContain('Laine 100% mérinos coloris Rouille')
    const { md: md2 } = patternToMd(first.pattern)
    const second = mdToPattern(md2)
    // La note survit au 2e passage…
    expect(noteTexts(second.pattern.reader)).toContain('Laine 100% mérinos coloris Rouille')
    // … et le 2e passage n'avertit plus (plus rien à rétrograder) : stable.
    expect(second.warnings).toEqual([])
    // La ligne ne redevient pas un bloc réservé {yarn} qui la re-détruirait.
    expect(md2).not.toMatch(/Laine 100% mérinos[\s\S]*\{yarn\}/)
  })

  it('absorption : une ligne de travail happée par un titre « Fil » réécrit survit en note, pas dans la rubrique', () => {
    const res = mdToPattern(`${FM}## Laine 100% mérinos {yarn}
- Rang 2 : tricoter à l'endroit
`)
    const notes = noteTexts(res.pattern.reader)
    // Le titre réécrit survit…
    expect(notes).toContain('Laine 100% mérinos')
    // … et la ligne de travail happée n'est ni perdue…
    expect(notes.join(' ')).toContain('Rang 2 : tricoter')
    // … ni aspirée dans une rubrique Fil parasite.
    expect(JSON.stringify(res.pattern.reader.reference || {})).not.toContain('Rang 2 : tricoter')
  })
})
