import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import StepImages from '@/components/StepImages.vue'
import { useLightboxStore } from '@/stores/lightbox'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('StepImages', () => {
  it('affiche une vignette par image', () => {
    const wrapper = mount(StepImages, {
      props: { imgs: ['data:image/png;base64,A', 'data:image/png;base64,B'] },
      global: { plugins: [i18n] },
    })
    expect(wrapper.findAll('img')).toHaveLength(2)
  })

  it('un tap ouvre la visionneuse sur la bonne image', async () => {
    const wrapper = mount(StepImages, {
      props: { imgs: ['data:image/png;base64,A', 'data:image/png;base64,B'] },
      global: { plugins: [i18n] },
    })
    await wrapper.findAll('button')[1].trigger('click')
    const lightbox = useLightboxStore()
    expect(lightbox.open).toBe(true)
    expect(lightbox.current).toBe('data:image/png;base64,B')
  })

  it('rien à afficher si imgs vide', () => {
    const wrapper = mount(StepImages, { props: { imgs: [] }, global: { plugins: [i18n] } })
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
