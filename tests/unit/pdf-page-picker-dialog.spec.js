// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('@/utils/pdf', () => ({
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PAGE'),
  pdfPageCount: vi.fn().mockResolvedValue(2),
}))
import PdfPagePickerDialog from '@/components/PdfPagePickerDialog.vue'

const i18n = createTestI18n()
const stubs = { AppIcon: true }

describe('PdfPagePickerDialog', () => {
  it('open:false → rien dans le DOM', () => {
    const w = mount(PdfPagePickerDialog, {
      props: { open: false, pdf: 'data:application/pdf;base64,AAAA' },
      global: { plugins: [i18n], stubs },
    })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('open:true → affiche le PdfViewer en mode pickable, "Utiliser cette page" relaie pick + ferme (update:open false)', async () => {
    const w = mount(PdfPagePickerDialog, {
      props: { open: true, pdf: 'data:application/pdf;base64,AAAA' },
      global: { plugins: [i18n], stubs },
    })
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r)) // laisse PdfViewer.onMounted (render()) se résoudre
    await w.find('[data-test=pick]').trigger('click')
    expect(w.emitted('pick')).toBeTruthy()
    expect(w.emitted('pick')[0][0]).toContain('PAGE')
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('bouton fermer émet update:open false SANS émettre pick', async () => {
    const w = mount(PdfPagePickerDialog, {
      props: { open: true, pdf: 'data:application/pdf;base64,AAAA' },
      global: { plugins: [i18n], stubs },
    })
    await w.find('.ppd__close').trigger('click')
    expect(w.emitted('update:open')).toEqual([[false]])
    expect(w.emitted('pick')).toBeFalsy()
  })
})
