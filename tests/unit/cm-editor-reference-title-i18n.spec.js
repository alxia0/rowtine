// @vitest-environment jsdom
// Titre d'un bloc référence (Aide-mémoire) en vue enrichie de l'éditeur : le texte
// SOURCE (## Aiguilles {needles}, etc.) est TOUJOURS canonique/FR (cf.
// referenceBlocksToMd, prompt IA, round-trip) — seul l'AFFICHAGE doit suivre la
// langue de l'app, comme reader-reference.js le fait déjà pour le lecteur (labels
// passés à createCmEditor, cf. ReaderTextEditor.vue useI18n()). Retour terrain 21/07 :
// titres « en dur » en français + « Aiguilles » qui exclut le crochet.
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'

function mount(value, labels) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value, labels })
  return { host, editor }
}

describe('titre de bloc référence — libellé localisé en vue enrichie (jamais le texte source)', () => {
  it('titre canonique (## Aiguilles {needles}) : affiche labels.needles, texte source INCHANGÉ', () => {
    const value = '## Aiguilles {needles}\n\nAig. n° 4\n'
    const { host, editor } = mount(value, { needles: 'Aiguilles/Crochet' })
    const line = host.querySelector('.cm-line.md-reference')
    expect(line.textContent).toContain('Aiguilles/Crochet')
    expect(editor.getValue()).toBe(value)
  })

  it('même document, labels EN : affiche le libellé EN, texte source (FR canonique) inchangé', () => {
    const value = '## Aiguilles {needles}\n\nAig. n° 4\n'
    const { host, editor } = mount(value, { needles: 'Needles/Hook' })
    const line = host.querySelector('.cm-line.md-reference')
    expect(line.textContent).toContain('Needles/Hook')
    expect(editor.getValue()).toBe(value)
  })

  it('titre RÉÉCRIT (ligne en cours de re-balisage, pas encore canonique) : le vrai texte reste visible, pas de substitution', () => {
    const value = '## Aiguilles circulaires n° 4 {needles}\n'
    const { host } = mount(value, { needles: 'Aiguilles/Crochet' })
    const line = host.querySelector('.cm-line.md-reference')
    expect(line.textContent).toContain('Aiguilles circulaires n° 4')
    expect(line.textContent).not.toContain('Aiguilles/Crochet')
  })

  it('repli FR du banc (aucun labels custom) : le titre canonique suit quand même FR_TOOLBAR_LABELS', () => {
    const value = '## Aiguilles {needles}\n'
    const { host } = mount(value)
    const line = host.querySelector('.cm-line.md-reference')
    expect(line.textContent).toContain('Aiguilles/Crochet')
  })

  // Seule paire tag/clé-interne divergente (REF_TAG_KEY_OVERRIDES, refblocks.js :
  // measurements -> sizeTable) — les 6 autres tags sont identiques à leur clé,
  // ce cas est le seul où canonicalReferenceLabel exerce la traduction tag->clé.
  it('tag/clé divergents (measurements -> sizeTable) : le titre canonique « Tailles » affiche quand même labels.measurements', () => {
    const value = '## Tailles {measurements}\n\n| mesure | valeur |\n|---|---|\n| tour de buste | 90 |\n'
    const { host, editor } = mount(value, { measurements: 'Sizes' })
    const line = host.querySelector('.cm-line.md-reference')
    expect(line.textContent).toContain('Sizes')
    expect(editor.getValue()).toBe(value)
  })
})
