// Unitaire — l'écran d'import RETROUVE son bloc de réussite au retour du guide (revue
// du 19/08/2026, important 6, tranché : « corrige ce point dans le
// guide et le reste »).
//
// LE DÉFAUT : « Comment corriger » du bloc de réussite fait un `router.push` vers le guide.
// Au retour, `LocalPdfImportView` se REMONTE — `handoff.take()` ne rend plus rien, et l'écran
// repartait vierge (« Choisir un fichier »). Le nom du patron, la phrase d'avertissement et
// le bouton « Voir le patron » avaient disparu : l'utilisatrice qui suit le conseil qu'on
// vient de lui donner perd le fil qu'on venait de lui tendre. Aucune donnée perdue (le patron
// est en base), mais plus rien à quoi se raccrocher.
//
// POURQUOI UN VRAI ROUTEUR ICI : `local-pdf-import-view.spec.js` mocke `vue-router`, donc
// `router.push` n'y est qu'un espion — l'écran n'y est jamais démonté ni remonté, et ce
// défaut y est invisible par construction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import fr from '@/i18n/fr.json'

vi.mock('@/utils/pdf-import', () => ({ parsePdfLocally: vi.fn() }))

import { parsePdfLocally } from '@/utils/pdf-import'
import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useImportReportStore } from '@/stores/import-report'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true }

const okResult = () => ({
  scanned: false,
  pattern: { name: 'Pull torsadé', photos: [] },
  reader: { sizeLabels: [], sections: [], reference: {} },
  warnings: ['ligne douteuse'],
  confidence: { global: 90, level: 'high', bySection: {} },
  stats: {},
})

const App = { template: '<RouterView />' }

function creerRouteur() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/import', name: 'import-local', component: LocalPdfImportView },
      { path: '/guide', name: 'guide', component: { template: '<div class="guide-stub" />' } },
      { path: '/p/:id', name: 'pattern', component: { template: '<div class="pattern-stub" />' } },
    ],
  })
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

function boutonParTexte(w, texte) {
  return w.findAll('button').find((b) => b.text().includes(texte))
}

async function choisirFichier(w) {
  const input = w.find('input[type=file]')
  Object.defineProperty(input.element, 'files', {
    value: [new File(['x'], 'pull.pdf')],
    configurable: true,
  })
  await input.trigger('change')
  await settle()
}

beforeEach(() => {
  setActivePinia(createPinia())
  parsePdfLocally.mockReset().mockResolvedValue(okResult())
})

describe("écran d'import — aller-retour vers le guide", () => {
  it('« Comment corriger » puis retour : le bloc de réussite est là, tel qu elle l a laissé', async () => {
    vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(9)
    const importReport = useImportReportStore()

    const router = creerRouteur()
    router.push('/import')
    await router.isReady()
    const w = mount(App, { global: { plugins: [i18n, router], stubs } })
    await settle()

    await choisirFichier(w)

    // PRÉCONDITION : le bloc de réussite est bien là AVANT le départ — sinon son absence au
    // retour ne prouverait rien.
    expect(w.find('.done').exists()).toBe(true)
    expect(w.text()).toContain('Pull torsadé')
    expect(w.text()).toContain(fr.importLocal.doneCaveat)
    expect(boutonParTexte(w, fr.importLocal.viewPattern)).toBeTruthy()

    await boutonParTexte(w, fr.importLocal.doneHowToFix).trigger('click')
    await settle()

    // Le guide s'ouvre : l'interaction ne change pas.
    expect(router.currentRoute.value.name).toBe('guide')
    // Et l'écran d'import est réellement DÉMONTÉ — c'est ce démontage qui effaçait tout.
    expect(w.findComponent(LocalPdfImportView).exists()).toBe(false)
    // Le relais des avertissements, lui, survit (vérifié plutôt que cru sur parole) : il
    // n'est vidé qu'à la fiche du bon patron, pas par ce détour.
    expect(String(importReport.patternId)).toBe('9')
    expect(importReport.warnings).toHaveLength(1)

    // Le geste de retour ramène sur l'écran d'import : c'est l'ÉTAT de cet écran qui est en
    // cause, rien d'autre.
    router.back()
    await settle()
    expect(router.currentRoute.value.name).toBe('import-local')

    // LE CŒUR : elle retrouve exactement ce qu'elle a quitté.
    expect(w.find('.done').exists()).toBe(true)
    expect(w.text()).toContain('Pull torsadé')
    expect(w.text()).toContain(fr.importLocal.doneCaveat)
    expect(w.text()).toContain(fr.importLocal.warnings.replace('{n}', '1'))
    expect(boutonParTexte(w, fr.importLocal.viewPattern)).toBeTruthy()
    // Et le bouton « Choisir un fichier » n'est PAS revenu : l'écran n'est pas reparti de
    // zéro (c'était le symptôme exact du cul-de-sac).
    expect(w.find('label.file-pick').exists()).toBe(false)

    // Le bouton « Voir le patron » marche toujours après l'aller-retour : le bloc restauré
    // n'est pas une coquille vide, il porte le bon identifiant.
    await boutonParTexte(w, fr.importLocal.viewPattern).trigger('click')
    await settle()
    expect(router.currentRoute.value.name).toBe('pattern')
    expect(router.currentRoute.value.params.id).toBe('9')
  })

  it("repartir SANS passer par le guide ne laisse rien derrière : l écran suivant repart vierge", async () => {
    // L'autre moitié du relais. Il ne doit vivre que le temps de l'aller-retour vers le
    // guide : une utilisatrice qui quitte l'écran par le bouton retour, puis y revient plus
    // tard, ne doit PAS retrouver la réussite d'un import précédent — ce serait un mensonge
    // d'interface, et c'est précisément ce que la pose du relais dans `howToFix` (et non à
    // l'enregistrement) rend impossible.
    vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(9)

    const router = creerRouteur()
    router.push('/import')
    await router.isReady()
    const w = mount(App, { global: { plugins: [i18n, router], stubs } })
    await settle()

    await choisirFichier(w)
    // PRÉCONDITION : l'import a bien réussi, le bloc de réussite est là.
    expect(w.find('.done').exists()).toBe(true)

    // Elle s'en va SANS toucher « Comment corriger », puis revient sur l'écran d'import.
    router.push('/guide')
    await settle()
    router.push('/import')
    await settle()

    expect(w.find('.done').exists()).toBe(false)
    expect(w.find('label.file-pick').exists()).toBe(true)
  })

  it("la voie SCANNÉE n'a jamais eu de bloc de réussite : le retour du guide ne lui en invente pas", async () => {
    // Piège nommé par la revue : un état de réussite qui survivrait « au cas où » ferait
    // apparaître un bloc là où rien n'a jamais été enregistré. Le PDF scanné n'enregistre
    // RIEN — l'écran doit rester celui du choix de fichier, à l'aller comme au retour.
    parsePdfLocally.mockResolvedValue({ ...okResult(), scanned: true })
    const add = vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(9)

    const router = creerRouteur()
    router.push('/import')
    await router.isReady()
    const w = mount(App, { global: { plugins: [i18n, router], stubs } })
    await settle()

    await choisirFichier(w)

    // PRÉCONDITION : rien n'a été enregistré, aucun bloc de réussite.
    expect(add).not.toHaveBeenCalled()
    expect(w.find('.done').exists()).toBe(false)

    router.push('/guide')
    await settle()
    router.back()
    await settle()

    expect(router.currentRoute.value.name).toBe('import-local')
    expect(w.find('.done').exists()).toBe(false)
    expect(w.find('label.file-pick').exists()).toBe(true)
  })
})
