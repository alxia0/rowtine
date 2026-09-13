import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'

vi.mock('@/utils/pdf', () => ({
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PAGE'),
  pdfPageCount: vi.fn().mockResolvedValue(3),
}))
import PdfViewer from '@/components/PdfViewer.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
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

  it('sans pickable (défaut), aucun bouton "Utiliser cette page" — comportement inchangé', async () => {
    const w = mountViewer()
    await flushPromises()
    expect(w.find('[data-test=pick]').exists()).toBe(false)
  })
})
