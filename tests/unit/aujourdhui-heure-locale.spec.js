// Unitaire — « aujourd'hui » se calcule en heure LOCALE, jamais en UTC.
//
// Défaut connu : entre minuit
// local et minuit UTC, `new Date().toISOString().slice(0, 10)` rend la veille (ou le lendemain
// à l'ouest de Greenwich). Deux écrans de l'app pouvaient donc afficher deux jours calendaires
// différents dans la même session — déjà vu produire un artefact visible sur une série de
// captures.
//
// La mesure du 21/08/2026 a trouvé CINQ sites, pas un seul : seul `StashView.todayISO` était
// connu jusque-là. Les quatre autres — `SettingsView.today`, `YarnPurchases.openAddMissing`
// et les deux `startedAt` de `projects.seedExamplesIfEmpty` — partagent exactement la même
// racine. `projects.js` importait DÉJÀ `ymdLocal` et ne s'en servait pas pour `startedAt`.
//
// Forme de bascule de fuseau reprise de tests/unit/session-manual-timezone.spec.js : `process.env.TZ`
// prend effet à chaud quand il est posé dans un beforeEach. Une affectation en tête de fichier ne
// marcherait PAS (Vitest hisse les imports au-dessus des instructions du module).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import { ymdLocal } from '@/utils/time-periods'
import { useSettingsStore } from '@/stores/settings'
import { useProjectsStore } from '@/stores/projects'
import { usePurchasesStore } from '@/stores/purchases'
import StashView from '@/views/StashView.vue'
import YarnPurchases from '@/components/YarnPurchases.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// 11 août 2026 à 01 h UTC = 10 août à 18 h à Los Angeles. UTC dit « le 11 », le calendrier de
// l'utilisatrice dit « le 10 ». Instant repris de tests/unit/journal-jours-actifs.spec.js:73,
// où le même piège est déjà nommé.
const INSTANT = new Date('2026-08-11T01:00:00.000Z')
const JOUR_LOCAL = '2026-08-10'
const JOUR_UTC = '2026-08-11'

const TZ_ORIGINE = process.env.TZ

function basculeVersLosAngeles() {
  process.env.TZ = 'America/Los_Angeles'
  // `toFake: ['Date']` et RIEN d'autre : un `useFakeTimers()` complet gèle aussi setTimeout, dont
  // fake-indexeddb a besoin pour rendre la main — mesuré le 21/08, les trois tests à base Dexie
  // ci-dessous partaient alors en timeout de 20 s. Seule l'horloge doit mentir, pas la boucle.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(INSTANT)
}

function retourAuFuseauDeLaMachine() {
  vi.useRealTimers()
  if (TZ_ORIGINE === undefined) delete process.env.TZ
  else process.env.TZ = TZ_ORIGINE
}

describe('témoin — sans lui, ce fichier ne prouve rien', () => {
  beforeEach(basculeVersLosAngeles)
  afterEach(retourAuFuseauDeLaMachine)

  it('l’ancienne façon de faire se trompe de jour ICI', () => {
    // Cette assertion est FAUSSE depuis la France : elle ne peut passer que si la bascule de
    // fuseau a réellement eu lieu. C'est le garde-fou de tout le reste du fichier.
    expect(new Date().toISOString().slice(0, 10)).toBe(JOUR_UTC)
    expect(ymdLocal(new Date())).toBe(JOUR_LOCAL)
  })
})

describe('la date d’achat proposée à la création d’une laine (StashView)', () => {
  beforeEach(basculeVersLosAngeles)
  afterEach(retourAuFuseauDeLaMachine)

  it('propose le jour LOCAL, pas le jour UTC', async () => {
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'stash', component: StashView }],
    })
    router.push('/')
    await router.isReady()
    const pinia = createPinia()
    const w = mount(StashView, { global: { plugins: [router, i18n, pinia] } })
    // cf. stash-purchases-form.spec.js : settings.load() enchaîne des lectures Dexie
    // séquentielles, un compte de tours fixe est fragile — on attend le signal réel.
    const settings = useSettingsStore(pinia)
    let tours = 0
    while (!settings.loaded && tours < 20) {
      await flushPromises()
      tours++
    }
    await flushPromises()
    // Le champ de date d'achat n'existe qu'en CRÉATION (`v-if="!editId"`), une fois le
    // formulaire ouvert — même geste qu'en stash-purchases-form.spec.js:59.
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    expect(w.find('#yarn-purchased-at').element.value).toBe(JOUR_LOCAL)
    w.unmount()
  })
})

describe('la date proposée pour un achat oublié (YarnPurchases)', () => {
  beforeEach(basculeVersLosAngeles)
  afterEach(retourAuFuseauDeLaMachine)

  it('propose le jour LOCAL, pas le jour UTC', async () => {
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    const pinia = createPinia()
    setActivePinia(pinia)
    await usePurchasesStore(pinia).load()
    // Stock à 12, historique à 0 → écart positif : « Ajouter l'achat manquant » s'affiche.
    const w = mount(YarnPurchases, {
      props: { yarnId: 1, yarnLabel: 'DROPS · Bleu ciel', yarn: { id: 1, quantity: 12 } },
      global: { plugins: [i18n, pinia] },
    })
    await flushPromises()
    await w.find('[data-test="purchases-correct"]').trigger('click')
    await w.find('[data-test="purchases-correct-add"]').trigger('click')
    await flushPromises()
    expect(w.find('#ypur-date').element.value).toBe(JOUR_LOCAL)
    w.unmount()
  })
})

describe('la date de début des projets d’exemple (projects.seedExamplesIfEmpty)', () => {
  beforeEach(basculeVersLosAngeles)
  afterEach(retourAuFuseauDeLaMachine)

  it('date les projets du jour LOCAL, pas du jour UTC', async () => {
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    const pinia = createPinia()
    setActivePinia(pinia)
    const projects = useProjectsStore(pinia)
    await projects.seedExamplesIfEmpty('knitting')
    const tous = await db.projects.toArray()
    expect(tous.length).toBeGreaterThan(0)
    for (const p of tous) {
      if (p.startedAt) expect(p.startedAt).toBe(JOUR_LOCAL)
    }
  })
})

// ─── Garde de non-réintroduction ────────────────────────────────────────────
// Les tests ci-dessus prouvent QUATRE sites. Le cinquième (`SettingsView.today`, qui nomme les
// fichiers d'export) ne vaut pas le montage d'un écran d'export complet : un fichier daté de la
// veille est trompeur, pas destructeur. Ce balayage le couvre, ET empêche la réintroduction du
// motif ailleurs — c'est lui qui a trouvé les quatre sites qui n'étaient pas connus.
describe('aucun fichier de src/ ne retronque une date UTC', () => {
  function tousLesFichiers(dossier) {
    const out = []
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom)
      if (statSync(chemin).isDirectory()) out.push(...tousLesFichiers(chemin))
      else if (/\.(js|vue)$/.test(nom)) out.push(chemin)
    }
    return out
  }

  it('`toISOString().slice(0, 10)` n’apparaît nulle part — utiliser ymdLocal()', () => {
    const racine = join(process.cwd(), 'src')
    const fautifs = tousLesFichiers(racine).filter((f) =>
      /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(readFileSync(f, 'utf8')),
    )
    expect(fautifs.map((f) => f.slice(racine.length + 1))).toEqual([])
  })
})
