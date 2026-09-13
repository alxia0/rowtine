// Tâche T2 (lot 3b) : traduction à l'AFFICHAGE de « Taille unique » — la chaîne française
// gelée `'Taille unique'` reste le code interne en donnée (isSingleSize, reader.js) ; seule sa
// présentation à l'écran suit la langue courante (sizeLabelText). Deux garanties à prouver :
// 1. le rendu dans les quatre langues (sur ReaderSheet, modèle reader-sheet-i18n.spec.js) ;
// 2. qu'un changement de langue ne modifie JAMAIS la donnée en base (reader.sizeLabels reste
//    strictement ['Taille unique']) — c'est la preuve que rien n'est parti dans la donnée.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'
import i18n from '@/i18n'
import ReaderSheet from '@/components/ReaderSheet.vue'

// Même approche que reader-view.spec.js : mock vue-router pour éviter la complexité du vrai
// routeur et les leaks async.
const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'

function mountSheetWithSizeTable(locale, messages) {
  const localeI18n = createI18n({ legacy: false, locale, messages })
  const reference = {
    abbrFull: [],
    tabs: [
      {
        id: 'tailles',
        label: 'Tableau des tailles',
        blocks: [{ h3: 'Tailles', sizeTable: { rows: [{ label: 'Tour de poitrine (cm)', values: ['90'] }] } }],
      },
    ],
  }
  return mount(ReaderSheet, {
    props: { reference, sizeLabels: ['Taille unique'], sizeIndex: null, open: true, activeTab: 'tailles' },
    global: { plugins: [localeI18n] },
  })
}

describe('ReaderSheet — « Taille unique » traduite à l’affichage dans les quatre langues', () => {
  it('FR : en-tête de colonne rend « Taille unique » (chaîne gelée, identité)', () => {
    const w = mountSheetWithSizeTable('fr', { fr })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('Taille unique')
  })
  it('EN : en-tête de colonne rend « One size », pas le français en dur', () => {
    const w = mountSheetWithSizeTable('en', { en })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('One size')
  })
  it('DE : en-tête de colonne rend « Einheitsgröße »', () => {
    const w = mountSheetWithSizeTable('de', { de })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('Einheitsgröße')
  })
  it('ES : en-tête de colonne rend « Talla única »', () => {
    const w = mountSheetWithSizeTable('es', { es })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('Talla única')
  })
  it('une vraie taille nommée (contenu du patron) n’est JAMAIS traduite, dans aucune langue', () => {
    const reference = {
      abbrFull: [],
      tabs: [{ id: 'tailles', label: 'Tableau des tailles', blocks: [{ h3: 'Tailles', sizeTable: { rows: [] } }] }],
    }
    const localeI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const w = mount(ReaderSheet, {
      props: { reference, sizeLabels: ['M'], sizeIndex: null, open: true, activeTab: 'tailles' },
      global: { plugins: [localeI18n] },
    })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('M')
  })
})

// Reader en taille unique, pour le test de non-régression de donnée ci-dessous.
const SINGLE_SIZE_READER = {
  sizeLabels: ['Taille unique'],
  sections: [{ id: 'corps', icon: '🧶', title: 'Corps', steps: [{ t: 'Monter 80 mailles' }] }],
}

async function seedSingleSizeProject() {
  const patternId = await db.patterns.add({ name: 'Écharpe', type: 'knitting', reader: SINGLE_SIZE_READER })
  const projectId = await db.projects.add({ name: 'P', technique: 'knitting', patternId })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return { patternId, projectId }
}

const wrappers = []
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  return w
}

// Même stratégie que reader-view.spec.js : laisse l'onMounted async se vider.
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

describe('ReaderView — changement de langue : la donnée « Taille unique » ne bouge jamais', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    nav.router.push.mockClear()
    nav.router.replace.mockClear()
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    i18n.global.locale.value = 'fr'
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount()
    i18n.global.locale.value = 'fr'
  })

  it('après passage en espagnol, l’affichage change mais reader.sizeLabels reste ["Taille unique"] en base', async () => {
    const { patternId } = await seedSingleSizeProject()
    const w = mountReader()
    await settle()
    // Repli initial (langue de l'appareil détectée avant la restauration) : on force ES
    // explicitement pour ce test, sur le modèle documenté dans src/i18n/index.js.
    i18n.global.locale.value = 'es'
    await flushPromises()

    // Affichage : la pastille de taille est traduite.
    expect(w.find('.szpill').text()).toContain('Talla única')

    // Donnée : rien n'a été réécrit. Vérifié à la source (IndexedDB), pas seulement en mémoire.
    const stored = await db.patterns.get(patternId)
    expect(stored.reader.sizeLabels).toEqual(['Taille unique'])
  })

  it('en français (langue d’origine), la pastille de taille reste littéralement « Taille unique »', async () => {
    await seedSingleSizeProject()
    const w = mountReader()
    await settle()
    expect(w.find('.szpill').text()).toContain('Taille unique')
  })
})
