// @vitest-environment jsdom
// Unitaire — réglages : valeurs par défaut, onboarding, profil, persistance Dexie.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('store settings', () => {
  // Task A2 (30/07) : la langue par défaut n'est plus codée en dur en français, elle suit
  // l'appareil (`detectDeviceLocale`). On fixe ici `navigator.language` pour ne pas dépendre
  // du défaut de jsdom (typiquement 'en-US') — sans ce mock, l'assertion ne prouverait rien
  // de spécifique au câblage.
  it('charge des valeurs par défaut sur une base vierge (langue = celle de l’appareil)', async () => {
    // `detectDeviceLocale` lit `navigator.languages` EN PRIORITÉ sur `navigator.language`
    // (cf. src/utils/app-locale.js) — sous jsdom, `navigator.languages` vaut par défaut
    // `['en-US', 'en']`, un tableau non vide : mocker seulement `navigator.language`
    // n'aurait donc aucun effet, il faut mocker `navigator.languages`.
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    const store = useSettingsStore()
    await store.load()
    expect(store).toMatchObject({ firstName: '', defaultTechnique: 'knitting', locale: 'de', onboarded: false })
  })

  // Câblage A2 : `detectDeviceLocale()` n'intervient qu'à défaut de valeur persistée — une
  // fois un choix enregistré (ici via `saveProfile`, cf. test plus bas), il l'emporte sur
  // l'appareil au chargement suivant, quelle que soit la langue de l'appareil à ce moment-là.
  it('un choix de langue déjà persisté l’emporte sur la langue de l’appareil au chargement suivant', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    const store = useSettingsStore()
    await store.load()
    await store.saveProfile({ locale: 'es' })

    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['it-IT']) // appareil « change » de langue
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.locale).toBe('es')
  })

  // Revue finale (31/07) — défaut critique manqué par la tâche C4 : une utilisatrice
  // déjà onboardée AVANT le chantier multilingue n'a jamais de `locale` en base
  // (`completeOnboarding` ne l'écrivait pas). Avant le chantier, l'application était
  // figée en français : elle doit RESTER en français, pas basculer silencieusement
  // dans la langue de l'appareil à la première mise à jour.
  it('une utilisatrice déjà onboardée SANS locale en base reste en français, quelle que soit la langue de l’appareil', async () => {
    await db.settings.put({ key: 'onboarded', value: true }) // onboardée AVANT le chantier : pas de clé 'locale'
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    const store = useSettingsStore()
    await store.load()
    expect(store).toMatchObject({ onboarded: true, locale: 'fr' })
  })

  // Symétrique du test ci-dessus : une base totalement vierge (pas encore onboardée)
  // est bien un premier lancement, et DOIT suivre l'appareil — sinon on romprait
  // l'intention même du chantier ("la langue de l'appareil est proposée au 1er
  // lancement") en corrigeant le bug de bascule silencieuse.
  it('une utilisatrice PAS ENCORE onboardée (premier lancement) suit la langue de l’appareil', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    const store = useSettingsStore()
    await store.load()
    expect(store).toMatchObject({ onboarded: false, locale: 'de' })
  })

  it('completeOnboarding fixe et persiste le profil', async () => {
    const store = useSettingsStore()
    await store.completeOnboarding({ firstName: '  Alex  ', technique: 'crochet' })
    expect(store).toMatchObject({ firstName: 'Alex', defaultTechnique: 'crochet', onboarded: true })

    // Une nouvelle instance relit la même base et retrouve l’état.
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded).toMatchObject({ firstName: 'Alex', defaultTechnique: 'crochet', onboarded: true })
  })

  it('saveProfile ne met à jour que les champs fournis', async () => {
    const store = useSettingsStore()
    await store.completeOnboarding({ firstName: 'Alex', technique: 'knitting' })
    await store.saveProfile({ locale: 'en' })
    expect(store.locale).toBe('en')
    expect(store.firstName).toBe('Alex') // inchangé
  })

  // P3 : astuce « balaie pour revenir » déplacée en pop-up d'accueil au 1er passage —
  // le mécanisme « vue une fois » doit être PERSISTÉ (pas juste en mémoire), sinon la pop-up
  // reviendrait à chaque lancement de l'app. Motif calqué sur completeOnboarding ci-dessus.
  it('swipeHintSeen vaut false par défaut sur une base vierge', async () => {
    const store = useSettingsStore()
    await store.load()
    expect(store.swipeHintSeen).toBe(false)
  })

  it('markSwipeHintSeen fixe et PERSISTE le drapeau (résiste à une nouvelle instance de store)', async () => {
    const store = useSettingsStore()
    await store.load()
    await store.markSwipeHintSeen()
    expect(store.swipeHintSeen).toBe(true)

    // Preuve de persistance : une toute nouvelle instance de store (~= nouveau lancement
    // de l'app) relit la même base Dexie et retrouve le drapeau à true.
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.swipeHintSeen).toBe(true)
  })

  it('theme vaut "system" par défaut sur une base vierge', async () => {
    const store = useSettingsStore()
    await store.load()
    expect(store.theme).toBe('system')
  })

  it('saveTheme fixe et PERSISTE le thème (résiste à une nouvelle instance)', async () => {
    const store = useSettingsStore()
    await store.load()
    await store.saveTheme('dark')
    expect(store.theme).toBe('dark')

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.theme).toBe('dark')
  })

  it('completeOnboarding persiste aussi le thème quand fourni', async () => {
    const store = useSettingsStore()
    await store.completeOnboarding({ firstName: 'Alex', technique: 'knitting', theme: 'light' })
    expect(store.theme).toBe('light')
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.theme).toBe('light')
  })

  // ÉVO E (11/08) — premier jour de la semaine. Même motif que le thème ci-dessus : défaut,
  // persistance qui résiste à une nouvelle instance.
  it('weekStart vaut 1 (lundi) par défaut sur une base vierge', async () => {
    const store = useSettingsStore()
    await store.load()
    expect(store.weekStart).toBe(1)
  })

  it('saveWeekStart fixe et PERSISTE le premier jour de la semaine (résiste à une nouvelle instance)', async () => {
    const store = useSettingsStore()
    await store.load()
    await store.saveWeekStart(0)
    expect(store.weekStart).toBe(0)

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.weekStart).toBe(0)
  })

  // T2 (31/08) — teinte d'accent : défaut DYNAMIQUE par thème (rose 320 sombre / bleu 230
  // clair) tant qu'aucun choix explicite ; le choix explicite persiste et prime.
  it('base vierge : aucun choix explicite, la teinte effective suit le thème effectif (320 sombre / 230 clair)', async () => {
    const store = useSettingsStore()
    await store.load()
    expect(store.accentHueChosen).toBe(false)
    expect(store.effectiveAccentHue('dark')).toBe(320)
    expect(store.effectiveAccentHue('light')).toBe(230)
  })

  it('saveAccentHue marque le choix EXPLICITE et PERSISTE (résiste à une nouvelle instance)', async () => {
    const store = useSettingsStore()
    await store.load()
    await store.saveAccentHue(190)
    expect(store.accentHue).toBe(190)
    expect(store.accentHueChosen).toBe(true)
    // Le choix prime sur le défaut dynamique, quel que soit le thème.
    expect(store.effectiveAccentHue('dark')).toBe(190)
    expect(store.effectiveAccentHue('light')).toBe(190)

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.accentHue).toBe(190)
    expect(reloaded.accentHueChosen).toBe(true)
  })

  it('migration : une accentHue persistée SANS marqueur (installation d’avant T2) est un choix explicite', async () => {
    // accentHue n'a jamais été écrite au boot (seul saveAccentHue l'écrit) : sa présence
    // en base ne peut venir que d'un geste utilisateur.
    await db.settings.put({ key: 'accentHue', value: 70 })
    const store = useSettingsStore()
    await store.load()
    expect(store.accentHueChosen).toBe(true)
    expect(store.effectiveAccentHue('dark')).toBe(70) // pas de bascule surprise
  })

  it('rememberBadgeColor : ajoute en tête, déduplique, plafonne à 8, persiste', async () => {
    const store = useSettingsStore()
    await store.load()
    expect(store.badgeColorHistory).toEqual([])

    await store.rememberBadgeColor('hsl(120 70% 50%)')
    await store.rememberBadgeColor('hsl(240 70% 50%)')
    await store.rememberBadgeColor('hsl(120 70% 50%)') // déjà présente : remonte en tête, pas de doublon
    expect(store.badgeColorHistory).toEqual(['hsl(120 70% 50%)', 'hsl(240 70% 50%)'])

    for (let h = 0; h < 10; h++) await store.rememberBadgeColor(`hsl(${h} 70% 50%)`)
    expect(store.badgeColorHistory).toHaveLength(8)
    expect(store.badgeColorHistory[0]).toBe('hsl(9 70% 50%)') // le plus récent en tête

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.badgeColorHistory).toEqual(store.badgeColorHistory)
  })
})
