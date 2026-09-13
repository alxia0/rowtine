// Tâche « dernier reliquat 4 langues » (29/07) — la puce compteur du mode
// enrichi (CounterWidget, cm-editor.js) codait en dur son `title` HTML
// (survol souris) : `span.title = 'Modifier le compteur'`, invariant quelle
// que soit la langue de l'éditeur (cf. ReaderTextEditor.vue useI18n()). Passe
// maintenant par labels.editCounterTitle (même mécanisme de repli par clé que
// labels.prompt, cf. cm-editor-prompt-i18n.spec.js pour le patron de test).
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import fr from '@/i18n/fr.json'

function mountHost() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

describe('CounterWidget — title localisé (labels.editCounterTitle)', () => {
  it('banc tools/mdedit (aucun opts.labels) : repli FR, comme aujourd’hui', () => {
    const host = mountHost()
    createCmEditor(host, { value: '- {×3} Rang test\n' })
    const chip = host.querySelector('.cm-counter-chip')
    expect(chip.title).toBe(fr.correction.toolbar.editCounterTitle)
    host.remove()
  })

  it('éditeur EN : le title suit opts.labels.editCounterTitle (pas de FR figé)', () => {
    const host = mountHost()
    createCmEditor(host, { value: '- {×3} Rang test\n', labels: { editCounterTitle: 'Edit the counter' } })
    const chip = host.querySelector('.cm-counter-chip')
    expect(chip.title).toBe('Edit the counter')
    expect(chip.title).not.toBe(fr.correction.toolbar.editCounterTitle)
    host.remove()
  })

  it('deux éditeurs coexistants (FR + EN) : chacun garde son title, aucune fuite via un état de module partagé', () => {
    const hostFr = mountHost()
    const hostEn = mountHost()
    createCmEditor(hostFr, { value: '- {×3} Rang FR\n' })
    createCmEditor(hostEn, { value: '- {×3} Rang EN\n', labels: { editCounterTitle: 'Edit the counter' } })

    expect(hostFr.querySelector('.cm-counter-chip').title).toBe(fr.correction.toolbar.editCounterTitle)
    expect(hostEn.querySelector('.cm-counter-chip').title).toBe('Edit the counter')

    hostFr.remove()
    hostEn.remove()
  })
})
