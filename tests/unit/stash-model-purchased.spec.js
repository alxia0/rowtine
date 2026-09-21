// Régression — le champ #yarn-model de StashView doit rester lié à form.model et repartir
// dans le payload envoyé au store (yarnsStore.add). Historiquement ce test couvrait AUSSI
// #yarn-purchased (date d'achat) : ce champ a été retiré du formulaire lors des travaux
// sur le budget laine (01/08) — une fiche peut désormais porter plusieurs achats, tracés dans le
// registre `purchases`, pas dans un unique champ de la fiche. Réécrit pour la nouvelle
// réalité (pas supprimé) : la date d'achat s'observe maintenant sur la
// ligne que la création écrit automatiquement dans `purchasesStore`.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { ymdLocal } from '@/utils/time-periods'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true }

function mountView() {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const w = mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
  return { w, pinia }
}

function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

async function openForm(w) {
  await findButtonByText(w, fr.yarn.add).trigger('click')
}

function todayISO() {
  // Heure LOCALE depuis le 21/08 : en UTC, ce helper aurait attendu la veille
  // pour tout test lancé entre minuit et 02 h, heure française.
  return ymdLocal(new Date())
}

describe('StashView — modèle (binding formulaire) et ligne d’achat automatique à la création', () => {
  it('une laine saisie avec un modèle arrive en base avec cette valeur', async () => {
    const { w, pinia } = mountView()
    await openForm(w)
    await w.find('#yarn-color-name').setValue('Bleu glacier') // requis par save()
    await w.find('#yarn-model').setValue('Baby Merino')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()

    expect(useYarnsStore(pinia).add).toHaveBeenCalledTimes(1)
    const payload = useYarnsStore(pinia).add.mock.calls[0][0]
    expect(payload.model).toBe('Baby Merino')
  })

  it('la date d’achat (retirée du formulaire) se retrouve désormais sur la ligne créée automatiquement dans purchases', async () => {
    const { w, pinia } = mountView()
    useYarnsStore(pinia).add.mockResolvedValue(42) // id que la fiche neuve recevrait réellement
    await openForm(w)
    await w.find('#yarn-color-name').setValue('Bleu glacier')
    await w.find('#yarn-model').setValue('Baby Merino')
    await w.find('#yarn-quantity').setValue('4')
    await w.find('#yarn-price').setValue('9,50')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()

    expect(usePurchasesStore(pinia).add).toHaveBeenCalledTimes(1)
    const line = usePurchasesStore(pinia).add.mock.calls[0][0]
    expect(line.yarnId).toBe(42) // l'id retourné par yarnsStore.add, pas un id inventé
    expect(line.date).toBe(todayISO())
    expect(line.quantity).toBe(4)
    expect(line.unitPrice).toBe(9.5)
    expect(line.kind).toBe('buy')
  })
})
