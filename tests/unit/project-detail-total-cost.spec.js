// La fiche projet affiche le COÛT du projet (lot 08/08) : le prix des laines qu'il a
// réservées ou déjà tricotées. Lecture seule — la saisie des prix vit sur les fiches laine.
//
// Fixture : trois points MESURÉS avant écriture du plan, ne pas les retirer —
//  1. `route.query = { tab: 'infos' }` : la tuile vit dans le panneau « Détails », qui n'est
//     PAS l'onglet par défaut (ProjectDetailView.vue:59) ;
//  2. `vi.waitFor(loading === false)` : un seul flushPromises() laisse le squelette masquer
//     tout le panneau ;
//  3. `setSetting('currency') + settings.load()` : la devise des laines vient du réglage
//     global. EUR étant DEFAULT_CURRENCY, tester en EUR ne prouverait rien.
//
// LIMITE ASSUMÉE de cette fixture : parce qu'elle charge le magasin `settings` AVANT le
// montage, le filet `if (!settings.loaded) settings.load()` de la vue n'est exercé par
// AUCUN test de ce fichier. Il reproduit à l'identique le motif de StashView.vue:86 et
// d'ExpensesView — à ne pas compter comme couvert lors de la revue.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db, setSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const route = { params: {}, query: {} }
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }))

// Monte la fiche d'un projet neuf. `yarns` : laines à créer (le projet leur est injecté via
// `reserved` / `knitted`). `pattern` : champs du patron lié (omis = projet sans patron).
// `currency` : le réglage global, qui pilote la devise des LAINES (jamais celle du patron).
async function monter({ yarns = [], pattern = null, currency = 'CHF' } = {}) {
  // `patternId` n'est POSÉ que s'il y a un patron : écrire `patternId: undefined` sur un
  // projet libre le ferait passer pour un projet dont le patron a été supprimé
  // (`patternMissing`, ProjectDetailView.vue:111) — un autre écran, un autre test.
  const projectId = pattern
    ? await db.projects.add({
        name: 'Bonnet',
        patternId: await db.patterns.add({ name: 'Sabai', type: 'knitting', ...pattern }),
      })
    : await db.projects.add({ name: 'Bonnet' })
  for (const y of yarns) {
    const { reserved = 0, knitted = 0, ...rest } = y
    await db.yarns.add({
      brand: 'Drops', quantity: 10, ...rest,
      reservations: reserved ? { [projectId]: reserved } : {},
      consumed: knitted ? { [projectId]: knitted } : {},
    })
  }
  await setSetting('currency', currency)
  await useSettingsStore().load()
  route.params = { id: String(projectId) }
  route.query = { tab: 'infos' }
  const w = mount(ProjectDetailView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
  await flushPromises()
  await vi.waitFor(() => expect(w.vm.loading).toBe(false))
  return w
}

const tuile = (w) => w.find('[data-test="project-total-cost"]')

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

describe('fiche projet — coût du projet (laines)', () => {
  it('1. ni laine ni prix de patron ⇒ AUCUNE tuile (pas une tuile vide)', async () => {
    const w = await monter()
    expect(tuile(w).exists()).toBe(false)
  })

  it('2. laines réservées et tricotées ⇒ le montant, dans la devise du RÉGLAGE', async () => {
    const w = await monter({
      currency: 'CHF',
      yarns: [
        { price: '4,50', reserved: 3 }, // 13,50
        { price: '2', knitted: 2 },     //  4
      ],
    })
    const txt = tuile(w).text()
    // 17,50 : valeur à CENTIMES à dessein — sur un montant rond, formatMoney profil
    // « detail » n'écrit aucune décimale, et le format ne serait pas réellement exercé.
    expect(txt).toContain('17,50')
    // CHF et non EUR : EUR est DEFAULT_CURRENCY, l'assertion passerait sur un repli codé
    // en dur. C'est CE `toContain` qui prouve que `settings.currency` est lu.
    expect(txt).toContain('CHF')
  })

  it('3. des pelotes mais AUCUN prix connu ⇒ « — », jamais « 0 € »', async () => {
    const w = await monter({ yarns: [{ price: '', reserved: 4 }] })
    const txt = tuile(w).text()
    expect(tuile(w).exists()).toBe(true)
    // Aucun chiffre de MONTANT : afficher « 0 » ferait passer une ignorance pour une
    // gratuité. (`not.toContain('0,00')` ne pourrait jamais rougir — formatMoney n'écrit
    // pas les centimes d'un montant rond.)
    expect(txt).toContain('—')
  })

  it('4. laine réservée par un AUTRE projet ⇒ elle ne compte pas ici', async () => {
    const autre = await db.projects.add({ name: 'Écharpe' })
    await db.yarns.add({ brand: 'Katia', quantity: 9, price: '100', reservations: { [autre]: 5 }, consumed: {} })
    const w = await monter({ yarns: [{ price: '4,50', reserved: 3 }] })
    // Prémisse ASSERTÉE, pas supposée : tout ce test repose sur le fait que les deux projets
    // ont des ids différents. Si un changement d'ordre de création dans `monter` les faisait
    // coïncider, le test deviendrait un no-op qui passe toujours.
    expect(autre).not.toBe(w.vm.project.id)
    const txt = tuile(w).text()
    // `toContain('13,50')` seul ne mord pas : sous la fuite entre projets (tout le stock
    // compté), le montant devient 513,50 CHF — cette chaîne CONTIENT « 13,50 » ET NE
    // CONTIENT PAS « 500 », donc les deux assertions passeraient quand même (constat de
    // revue, 08/08). `\b` ne mord pas non plus ici : les deux spans (`itile__k` puis
    // `itile__v`) sont collés sans espace dans le rendu (« ...projet13,50 CHF »), et entre
    // « t » et « 1 » il n'y a AUCUNE frontière de mot (lettre et chiffre sont tous deux
    // `\w`). Le lookbehind négatif sur un chiffre distingue vraiment les deux cas : rien
    // (ou une lettre) précède « 13,50 » dans le bon montant, un « 5 » le précède dans la fuite.
    expect(txt).toMatch(/(?<!\d)13,50/)
    expect(txt).not.toContain('500')
  })

  it('5. prix du patron ⇒ entre parenthèses, dans SA propre devise', async () => {
    // Laines en CHF (réglage), patron en EUR (devise propre du patron) : ce cas EXISTE dans
    // la vraie vie. C'est la seule assertion qui interdit qu'un jour les deux montants
    // soient additionnés — une somme unique ne pourrait pas porter deux devises.
    const w = await monter({
      currency: 'CHF',
      yarns: [{ price: '4,50', reserved: 3 }],
      pattern: { price: '18,90', priceCurrency: 'EUR' },
    })
    const txt = tuile(w).text()
    expect(txt).toContain('13,50')
    expect(txt).toContain('CHF')
    expect(txt).toContain('18,90')
    expect(txt).toContain('€')
    expect(txt).toContain('patron')
  })

  it('6. patron sans prix noté ⇒ AUCUNE parenthèse', async () => {
    const w = await monter({ yarns: [{ price: '4,50', reserved: 3 }], pattern: { price: '' } })
    expect(tuile(w).text()).not.toContain('(')
  })

  it('7. patron à « 0 » ⇒ « patron : Gratuit », jamais un montant', async () => {
    const w = await monter({
      yarns: [{ price: '4,50', reserved: 3 }],
      pattern: { price: '0', priceCurrency: 'EUR' },
    })
    const txt = tuile(w).text()
    expect(txt).toContain(fr.pattern.priceFree)
    // Le montant des LAINES reste, celui du patron ne devient pas « 0 € ».
    expect(txt).toContain('13,50')
  })

  it('8. laine sans prix parmi des laines chiffrées ⇒ le total le DIT', async () => {
    const w = await monter({
      currency: 'CHF',
      yarns: [{ price: '4,50', reserved: 3 }, { price: '', reserved: 2 }, { price: '', knitted: 1 }],
    })
    const txt = tuile(w).text()
    expect(txt).toContain('13,50') // le total ne compte que ce qui est connu
    // Deux LAINES sans prix (et non trois pelotes) : la mention compte des fiches.
    expect(txt).toContain(fr.project.costUnknownPrices.replace('{n}', '2'))
  })

  it('9. laine réservée ⇒ la liste affiche RÉSERVÉ / STOCK, pas le stock seul', async () => {
    // Constat de revue (08/08) : `×{{ y.quantity }}` seul affichait le STOCK (10 pelotes),
    // jamais ce que la tuile de coût, juste en dessous, facture (1 pelote réservée par
    // défaut) — « ×10 » suivi d'un coût pour 1 pelote se lisait comme un total cassé.
    const w = await monter({ yarns: [{ price: '4,50', reserved: 1 }] }) // quantity: 10 (défaut de `monter`)
    const txt = w.find('.yarnlist').text()
    // Doit distinguer vraiment « 1 / 10 » de « 10 » seul : sous la mutation qui remet
    // `y.quantity` seul, la ligne redevient « ×10 » et ce test doit rougir.
    expect(txt).toMatch(/×1\s*\/\s*10/)
    expect(txt).not.toMatch(/×10(?!\s*\/)/)
  })
})
