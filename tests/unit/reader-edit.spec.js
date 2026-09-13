import { describe, it, expect } from 'vitest'
import { emptyReaderStep, stepType, broadcast, normalizeReaderForSave } from '@/utils/reader-edit'
import { patternToMd } from '@/utils/pattern-md/serialize'
import { mdToPattern } from '@/utils/pattern-md/parse'

describe('reader-edit helpers', () => {
  it('emptyReaderStep par type', () => {
    expect(emptyReaderStep('row')).toEqual({ t: '' })
    expect(emptyReaderStep('note')).toEqual({ t: '', note: true })
    expect(emptyReaderStep('repeat')).toEqual({ t: '', repeat: true, total: [] })
  })
  it('stepType discrimine', () => {
    expect(stepType({ chart: true })).toBe('chart')
    expect(stepType({ t: 'x', note: true })).toBe('note')
    expect(stepType({ t: 'x', repeat: true })).toBe('repeat')
    expect(stepType({ t: 'x' })).toBe('row')
  })
  it('broadcast remplit N tailles (min 1)', () => {
    expect(broadcast(5, 3)).toEqual([5, 5, 5])
    expect(broadcast('', 0)).toEqual([0])
  })
  it('normalize : sizeLabels←sizes, ids slug, REP total diffusé, vides retirés', () => {
    const reader = {
      reference: { tiles: [] }, // champ riche préservé
      sizeLabels: [],
      sections: [
        { id: '', icon: '🧶', title: 'Encolure', steps: [
          { t: 'Monter les mailles' },
          { t: '', note: true },                 // vide → retiré
          { t: 'Répéter', repeat: true, total: 4 }, // total scalaire → diffusé
        ] },
        { id: '', icon: '🧶', title: '', steps: [] }, // section vide → retirée
      ],
    }
    const out = normalizeReaderForSave(reader, ['S', 'M', 'L'])
    expect(out.sizeLabels).toEqual(['S', 'M', 'L'])
    expect(out.reference).toEqual({ tiles: [] })       // préservé
    expect(out.sections).toHaveLength(1)
    expect(out.sections[0].id).toBe('encolure')
    expect(out.sections[0].steps).toHaveLength(2)      // note vide retirée
    expect(out.sections[0].steps[1].total).toEqual([4, 4, 4]) // REP diffusé sur 3 tailles
  })
  it('préserve un REP total déjà de longueur N (patron riche)', () => {
    const reader = { sizeLabels: [], sections: [
      { id: 's', icon: '🧶', title: 'S', steps: [{ t: 'r', repeat: true, total: [8, 9, 10] }] },
    ] }
    const out = normalizeReaderForSave(reader, ['A', 'B', 'C'])
    expect(out.sections[0].steps[0].total).toEqual([8, 9, 10]) // inchangé
  })
  it('normalize : préserve le tag de provenance origin d’un pas marqueur (cadence)', () => {
    // Le champ additif `origin` doit traverser compactStepCounts + resizeStepCounts
    // (spreads { ...step }) sans être supprimé : serialize.js s'appuie dessus pour
    // ré-émettre le marqueur plutôt que le legacy « - × … ».
    const reader = { sizeLabels: [], sections: [
      { id: 's', title: 'S', steps: [{ t: 'Rangs 1-4', repeat: true, every: 4, total: [6], origin: 'editor' }] },
    ] }
    const out = normalizeReaderForSave(reader, ['A', 'B', 'C'])
    expect(out.sections[0].steps[0].origin).toBe('editor') // survit à la sauvegarde
    expect(out.sections[0].steps[0].every).toBe(4) // la PÉRIODE de cadence survit (sinon la cadence redevient une répétition simple)
    expect(out.sections[0].steps[0].total).toEqual([6, 6, 6]) // total (nb de fois) diffusé aux 3 tailles
    expect(out.sections[0].steps[0].repeat).toBe(true)
  })
  it('normalize : repli sur reader.sizeLabels quand sizes est vide', () => {
    const reader = { sizeLabels: ['XS', 'S', 'M'], sections: [
      { id: 's', icon: '🧶', title: 'S', steps: [{ t: 'Monter {{0}} m', c: [[10, 12, 14]] }] },
    ] }
    const out = normalizeReaderForSave(reader, []) // sizes métadonnées vides
    expect(out.sizeLabels).toEqual(['XS', 'S', 'M']) // conservé, pas écrasé
    expect(out.sections[0].steps[0].c[0]).toEqual([10, 12, 14]) // counts intacts
  })
  it('normalize : un step image seule ({ imgs }, sans texte ni chart) survit', () => {
    // Régression (19/08/2026) : demoteChartToImage (reader-correction.js) produit
    // un step { imgs: [img] } sans `t` ni `chart` — CorrectionView.vue repasse désormais
    // systématiquement par normalizeReaderForSave à l'enregistrement (pour redimensionner
    // les tailles), et le filtre d'origine (texte non vide OU chart) le faisait disparaître
    // silencieusement. cf. tests/unit/CorrectionView.spec.js (D5.2 et le test de renommage).
    const reader = { sizeLabels: ['S'], sections: [
      { id: 's', title: 'Diagramme', kind: 'pelote', steps: [{ imgs: ['data:image/png;base64,xx'] }] },
    ] }
    const out = normalizeReaderForSave(reader, ['S'])
    expect(out.sections).toHaveLength(1)
    expect(out.sections[0].steps).toHaveLength(1)
    expect(out.sections[0].steps[0].imgs).toEqual(['data:image/png;base64,xx'])
  })
  it('impact sur le moteur d’import : un step image seule survit a un aller-retour patternToMd -> mdToPattern', () => {
    // Consequence NON demandee par le plan initial (celui-ci affirmait ne pas toucher au
    // moteur d'import) mais reelle et positive du correctif ci-dessus : mdToPattern
    // (parse.js) appelle normalizeReaderForSave (ligne ~89) sur CHAQUE reader reparse, y
    // compris a la reimportation d'un .md exporte. Avant le correctif, un step { imgs }
    // sans texte (ex. section "juste une image" demontee d'un diagramme, cf. le test
    // ci-dessus) survivait a l'export (patternToMd) mais disparaissait a la reimportation
    // (mdToPattern) -- perte silencieuse sur ce chemin precis. Verifie ici par execution
    // reelle du couple serialize/parse, pas seulement par la fonction pure isolee.
    const pattern = {
      name: 'Test',
      reader: {
        sizeLabels: ['S'],
        sections: [
          { id: 'diag', title: 'Diagramme', kind: 'pelote', steps: [{ imgs: ['data:image/png;base64,QUJD'] }] },
        ],
      },
    }
    const { md } = patternToMd(pattern)
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const steps = reparsed.reader.sections[0].steps
    expect(steps).toHaveLength(1)
    expect(Array.isArray(steps[0].imgs) && steps[0].imgs.length).toBeTruthy()
  })
})
