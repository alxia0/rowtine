// Task D2 — retrait de l'éditeur texte (ReaderMdEditor) du crayon PatternForm.
// Avant ce lot, un diagramme pouvait être saisi via le textarea MD directement
// dans PatternForm (ReaderMdEditor). Cette capacité est retirée : le diagramme
// s'écrit désormais via l'écran de correction post-import (CorrectionView).
// Ce test vérifie uniquement la non-régression : un diagramme déjà présent dans
// `initial.reader` (import, ou correction antérieure) survit intact au submit,
// porté par le spread `initial`, sans passer par normalizeReaderForSave.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import PatternForm from '@/components/PatternForm.vue'

vi.mock('@/utils/photo', () => ({
  pickAndCropImage: () => Promise.resolve('data:image/png;base64,AAA'),
}))

function makeInitial() {
  return {
    name: 'P',
    sizes: ['S'],
    reader: {
      sizeLabels: ['S'],
      sections: [
        {
          id: 'dos',
          kind: 'diagramme',
          title: 'Dos',
          steps: [{ chart: true }],
          chart: {
            cols: 18,
            rows: 4,
            repeat: '18 m × 4 rangs',
            readDir: 'droite à gauche',
            img: 'data:image/png;base64,AAA',
          },
        },
      ],
    },
  }
}

function mountForm(initial = makeInitial()) {
  return mount(PatternForm, {
    props: { initial, submitLabel: 'Enregistrer' },
    global: { plugins: [createPinia(), i18n] },
  })
}

describe('PatternForm — le diagramme survit à la sauvegarde (Task D2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('un diagramme présent dans initial.reader est intact dans le payload submit (aucune re-normalisation)', async () => {
    const initial = makeInitial()
    const wrapper = mountForm(initial)
    await flushPromises()

    await wrapper.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    const payload = emitted[0][0]

    expect(payload.reader).toEqual(initial.reader)
    expect(payload.reader.sections[0].chart).toEqual(initial.reader.sections[0].chart)
  })
})
