// Unitaire — le réglage `welcomeDue` (lot « pop-ups du premier lancement », 10/08/2026).
//
// Sens choisi : « à montrer », et non « déjà montré ». C'est ce sens qui protège les
// installations DÉJÀ EN SERVICE sans une ligne de migration : une base qui n'a pas ce
// réglage ne voit rien, sans que personne n'ait à deviner son âge. Cette garantie est
// STRUCTURELLE : `load()` ne dérive jamais `welcomeDue` d'`onboarded` (il n'y a pas de
// branchement entre les deux). Le test « une base ancienne » ci-dessous est le TÉMOIN de
// cette propriété, pas sa démonstration : aucune mutation ne peut le faire rougir sans
// faire rougir en même temps le test « base vierge ».
//
// CORRECTIF (lot « ordre des pop-ups », 10/08/2026) : `completeOnboarding()` ne pose plus
// ce drapeau — deux pop-ups contradictoires s'affichaient en même temps au premier
// lancement (la porte du dossier ET la bienvenue). C'est désormais `setWelcomeDue()`,
// appelée depuis la porte du dossier après une désignation réussie, qui le pose — cf.
// tests/unit/onboarding-folder-prompt.spec.js.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting, setSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('welcomeDue', () => {
  it('est faux sur une base vierge', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.welcomeDue).toBe(false)
  })

  it('completeOnboarding ne pose plus le drapeau (déplacé vers la porte du dossier)', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.completeOnboarding({ firstName: 'Alexia', technique: 'knitting' })
    expect(s.welcomeDue).toBe(false)
    expect(await getSetting('welcomeDue')).toBeUndefined()
  })

  it('setWelcomeDue() pose le drapeau à vrai, en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setWelcomeDue()
    expect(s.welcomeDue).toBe(true)

    // La preuve qui compte : une session NEUVE relit la base et retrouve le drapeau.
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.welcomeDue).toBe(true)
  })

  it('est faux sur une base ancienne, déjà onboardée avant ce lot', async () => {
    // Exactement l'état d'une installation en service : onboardée, astuce déjà vue,
    // et AUCUNE clé `welcomeDue` en base.
    await setSetting('onboarded', true)
    await setSetting('swipeHintSeen', true)
    const s = useSettingsStore()
    await s.load()
    expect(s.welcomeDue).toBe(false)
  })

  it('clearWelcomeDue() efface le drapeau en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setWelcomeDue()
    await s.clearWelcomeDue()
    expect(s.welcomeDue).toBe(false)

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.welcomeDue).toBe(false)
  })
})

// ─── `restoredDue` (lot du 06/09/2026) ────────────────────────────────────────────
//
// Jumeau de `welcomeDue` ci-dessus — même sens « à montrer », jamais « déjà montré »,
// donc la même garantie structurelle : une base qui n'a pas cette clé ne voit rien,
// sans migration. Ils se distinguent par LEUR ORIGINE, pas par leur mécanique :
// `welcomeDue` est posé par la porte quand la base ne contient que le semis ;
// `restoredDue` est posé PAR la restauration qui vient d'écraser ce semis
// (restore-service.js écrit la clé DIRECTEMENT en base, avant `reloadStores()` —
// `setRestoredDue()` n'a d'ailleurs aucun appelant dans l'app, elle est là pour la
// symétrie du store). HomeView lit le drapeau pour choisir les textes de la pop-up.
describe('restoredDue', () => {
  it('est faux sur une base vierge', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.restoredDue).toBe(false)
  })

  it('setRestoredDue() pose le drapeau à vrai, en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setRestoredDue()
    expect(s.restoredDue).toBe(true)

    // La preuve qui compte : une session NEUVE relit la base et retrouve le drapeau.
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.restoredDue).toBe(true)
  })

  it('clearRestoredDue() efface le drapeau en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setRestoredDue()
    await s.clearRestoredDue()
    expect(s.restoredDue).toBe(false)

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.restoredDue).toBe(false)
  })
})
