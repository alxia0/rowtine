// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('@/utils/pdf', () => ({
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PAGE'),
  pdfPageCount: vi.fn().mockResolvedValue(3),
}))
import PdfViewer from '@/components/PdfViewer.vue'
import { renderPdfPageToDataUrl } from '@/utils/pdf'

const i18n = createTestI18n()
const mountViewer = () =>
  mount(PdfViewer, { props: { pdf: 'data:application/pdf;base64,AAAA' }, global: { plugins: [i18n], stubs: { AppIcon: true } } })

describe('PdfViewer', () => {
  it('affiche la 1re page et le compteur, navigue', async () => {
    const w = mountViewer()
    await flushPromises()
    expect(w.find('img').attributes('src')).toContain('PAGE')
    expect(w.text()).toMatch(/1\s*\/\s*3/)
    await w.find('[data-test=next]').trigger('click')
    await flushPromises()
    expect(w.text()).toMatch(/2\s*\/\s*3/)
  })
  it('ne dépasse pas les bornes', async () => {
    const w = mountViewer()
    await flushPromises()
    await w.find('[data-test=prev]').trigger('click') // déjà page 1
    await flushPromises()
    expect(w.text()).toMatch(/1\s*\/\s*3/)
  })

  it('mode pickable : bouton "Utiliser cette page", émet pick avec la page COURANTE après navigation', async () => {
    const w = mount(PdfViewer, {
      props: { pdf: 'data:application/pdf;base64,AAAA', pickable: true },
      global: { plugins: [i18n], stubs: { AppIcon: true } },
    })
    await flushPromises()
    expect(w.find('[data-test=pick]').exists()).toBe(true)
    await w.find('[data-test=next]').trigger('click')
    await flushPromises()
    await w.find('[data-test=pick]').trigger('click')
    expect(w.emitted('pick')).toBeTruthy()
    expect(w.emitted('pick')[0][0]).toContain('PAGE') // renderPdfPageToDataUrl mocké plus haut
  })

  // Protège : « Utiliser cette page » n'envoie jamais l'image d'une autre page que celle affichée.
  it('mode pickable : pendant le rendu de la page suivante, pick est inactif ; un rendu dépassé ne gagne pas', async () => {
    const w = mount(PdfViewer, {
      props: { pdf: 'data:application/pdf;base64,AAAA', pickable: true },
      global: { plugins: [i18n], stubs: { AppIcon: true } },
    })
    await flushPromises()
    const pending = {}
    renderPdfPageToDataUrl.mockImplementation((_f, n) => new Promise((r) => (pending[n] = r)))
    await w.find('[data-test=next]').trigger('click') // page 2
    await w.find('[data-test=next]').trigger('click') // page 3
    expect(w.find('[data-test=pick]').attributes('disabled')).toBeDefined()
    await w.find('[data-test=pick]').trigger('click')
    expect(w.emitted('pick')).toBeFalsy()

    pending[3]('data:image/jpeg;base64,P3')
    await flushPromises()
    pending[2]('data:image/jpeg;base64,P2') // rendu dépassé, arrivé en dernier
    await flushPromises()
    await w.find('[data-test=pick]').trigger('click')
    expect(w.emitted('pick')[0][0]).toBe('data:image/jpeg;base64,P3')
    renderPdfPageToDataUrl.mockReset().mockResolvedValue('data:image/jpeg;base64,PAGE')
  })

  // Protège : un rendu en échec ne laisse pas « Chargement » affiché pour toujours.
  it('un rendu en échec retire l’indicateur de chargement', async () => {
    const w = mountViewer()
    await flushPromises()
    renderPdfPageToDataUrl.mockRejectedValueOnce(new Error('boom'))
    await w.find('[data-test=next]').trigger('click')
    await flushPromises()
    expect(w.find('.pdfv__loading').exists()).toBe(false)
  })

  it('sans pickable (défaut), aucun bouton "Utiliser cette page" — comportement inchangé', async () => {
    const w = mountViewer()
    await flushPromises()
    expect(w.find('[data-test=pick]').exists()).toBe(false)
  })
})
