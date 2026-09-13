// Unitaire — le réglage `importCaveatDue` (avertissement d'import, 19/08/2026).
//
// Sens choisi : « À MONTRER », et non « déjà montré » — le même que `welcomeDue`, et pour la
// même raison structurelle : une base DÉJÀ EN SERVICE n'a pas cette clé, donc ne verra rien,
// SANS une ligne de migration. Le sens inverse ferait surgir un avertissement neuf chez
// une utilisatrice, dont l'application est en service depuis des semaines.
//
// Même mise en garde que dans tests/unit/settings-welcome-due.spec.js pour le test « une
// base ANCIENNE » (G7) ci-dessous : c'est un TÉMOIN de la garantie structurelle ci-dessus,
// pas sa démonstration isolée — `load()` ne dérive jamais `importCaveatDue` d'`onboarded`,
// donc aucune mutation ne peut faire rougir G7 sans faire rougir en même temps le test
// « base vierge » juste au-dessus (vérifié par mutation).
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting, setSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('importCaveatDue', () => {
  it('est faux sur une base vierge', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.importCaveatDue).toBe(false)
  })

  it('G7 — est faux sur une base ANCIENNE, déjà en service avant ce lot', async () => {
    // PRÉCONDITION : l'état exact d'une installation en service — onboardée, astuce vue,
    // bienvenue déjà consommée, et AUCUNE clé `importCaveatDue`.
    await setSetting('onboarded', true)
    await setSetting('swipeHintSeen', true)
    expect(await getSetting('importCaveatDue')).toBeUndefined()

    const s = useSettingsStore()
    await s.load()
    expect(s.importCaveatDue).toBe(false)
  })

  it('setImportCaveatDue() pose le drapeau en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()
    expect(s.importCaveatDue).toBe(true)

    // La preuve qui compte : une session NEUVE relit la base et retrouve le drapeau.
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.importCaveatDue).toBe(true)
  })

  it('clearImportCaveatDue() efface le drapeau en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()
    await s.clearImportCaveatDue()
    expect(s.importCaveatDue).toBe(false)

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.importCaveatDue).toBe(false)
  })

  it('completeOnboarding ne pose PAS ce drapeau — c est la porte du dossier qui le pose', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.completeOnboarding({ firstName: 'Alexia', technique: 'knitting' })
    expect(s.importCaveatDue).toBe(false)
    expect(await getSetting('importCaveatDue')).toBeUndefined()
  })
})
