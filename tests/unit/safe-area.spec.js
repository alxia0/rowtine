import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyInsets, correctForPhysicalReservation } from '@/native/safe-area'

describe('applyInsets', () => {
  let el
  beforeEach(() => {
    el = document.createElement('html')
  })

  it('pose les quatre variables en pixels', () => {
    applyInsets({ top: 24, right: 0, bottom: 48, left: 0 }, el)
    expect(el.style.getPropertyValue('--sa-top')).toBe('24px')
    expect(el.style.getPropertyValue('--sa-right')).toBe('0px')
    expect(el.style.getPropertyValue('--sa-bottom')).toBe('48px')
    expect(el.style.getPropertyValue('--sa-left')).toBe('0px')
  })

  it('ignore un relevé incomplet plutôt que d’écrire NaN', () => {
    applyInsets({ top: 24 }, el)
    expect(el.style.getPropertyValue('--sa-top')).toBe('')
  })

  it('ignore une valeur non finie', () => {
    applyInsets({ top: Number.NaN, right: 0, bottom: 0, left: 0 }, el)
    expect(el.style.getPropertyValue('--sa-top')).toBe('')
  })

  it('borne les valeurs aberrantes à 0 minimum', () => {
    applyInsets({ top: -5, right: 0, bottom: 0, left: 0 }, el)
    expect(el.style.getPropertyValue('--sa-top')).toBe('0px')
  })
})

describe('correctForPhysicalReservation', () => {
  const DIMS_SANS_ECART = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 780 }

  it('ne change rien quand aucun écart (edge-to-edge réel, cas déjà validé)', () => {
    const insets = { top: 25, right: 0, bottom: 40, left: 0 }
    const capacitorInsets = { top: 25, right: 0, bottom: 0, left: 0 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, DIMS_SANS_ECART)
    expect(result).toEqual(insets)
  })

  it('ramène le bas à 0 quand la barre de nav est déjà réservée physiquement (mesuré Huawei LYA-L29, portrait, 3 boutons)', () => {
    const insets = { top: 25, right: 0, bottom: 40, left: 0 }
    const capacitorInsets = { top: 25, right: 0, bottom: 0, left: 0 }
    const dims = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 740 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result).toEqual({ top: 25, right: 0, bottom: 0, left: 0 })
  })

  it('ramène la droite à 0 en paysage (mesuré Huawei LYA-L29, paysage, 3 boutons)', () => {
    const insets = { top: 25, right: 40, bottom: 0, left: 25 }
    const capacitorInsets = { top: 25, right: 0, bottom: 0, left: 25 }
    const dims = { screenWidth: 780, screenHeight: 360, innerWidth: 740, innerHeight: 360 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result).toEqual({ top: 25, right: 0, bottom: 0, left: 25 })
  })

  it('ne régresse pas le correctif du 27/07 : --safe-area-inset-* absent (NaN) au démarrage à froid, pas encore injecté par Capacitor', () => {
    const insets = { top: 52, right: 0, bottom: 48, left: 0 }
    const capacitorInsets = { top: Number.NaN, right: Number.NaN, bottom: Number.NaN, left: Number.NaN }
    // Écart délibérément présent (780-732 = 48px) : c'est ce qui rend ce test non
    // trivial — le cas à protéger est qu'un écart mesurable, à lui seul, ne doit
    // jamais déclencher de soustraction quand la valeur Capacitor est INCONNUE.
    const dims = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 732 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result).toEqual(insets)
  })

  it('ne régresse pas le correctif du 27/07 : Capacitor zéro les quatre côtés (branche de compatibilité WebView ancienne) sans réservation physique réelle', () => {
    const insets = { top: 52, right: 0, bottom: 48, left: 0 }
    const capacitorInsets = { top: 0, right: 0, bottom: 0, left: 0 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, DIMS_SANS_ECART)
    expect(result).toEqual(insets)
  })

  it('ne soustrait rien si les deux côtés d\'un axe publient 0 chez Capacitor malgré un écart (repli documenté : bande cosmétique plutôt que contenu sous les barres)', () => {
    const insets = { top: 10, right: 0, bottom: 10, left: 0 }
    const capacitorInsets = { top: 0, right: 0, bottom: 0, left: 0 }
    const dims = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 740 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result).toEqual(insets)
  })

  it('ne descend jamais sous 0', () => {
    // otherSide (top) a un inset Capacitor NON nul : le repli « deux côtés à 0 »
    // ne doit pas s'appliquer ici. L'écart (45) reste sous la borne de plausibilité
    // (10 + 40 = 50) tout en dépassant l'inset natif du côté testé (10), pour
    // exercer réellement le plancher à 0 plutôt que la borne de plausibilité.
    const insets = { top: 40, right: 0, bottom: 10, left: 0 }
    const capacitorInsets = { top: 40, right: 0, bottom: 0, left: 0 }
    const dims = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 735 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result.bottom).toBe(0)
  })

  it("rejette un écart de type clavier (bien plus grand qu'une barre système plausible) sans sur-corriger un inset légitime", () => {
    // Même insets/Capacitor que le cas Huawei portrait mesuré, mais écart artificiellement
    // élargi (~300px, ordre de grandeur d'un clavier virtuel) : la borne doit rejeter
    // la soustraction plutôt que ramener --sa-bottom à 0 à tort.
    const insets = { top: 25, right: 0, bottom: 40, left: 0 }
    const capacitorInsets = { top: 25, right: 0, bottom: 0, left: 0 }
    const dims = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 480 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result.bottom).toBe(40)
  })

  it('rejette un écart de type écran partagé', () => {
    const insets = { top: 25, right: 0, bottom: 40, left: 0 }
    const capacitorInsets = { top: 25, right: 0, bottom: 0, left: 0 }
    const dims = { screenWidth: 360, screenHeight: 780, innerWidth: 360, innerHeight: 400 }
    const result = correctForPhysicalReservation(insets, capacitorInsets, dims)
    expect(result.bottom).toBe(40)
  })
})

describe('installSafeArea', () => {
  // Reproduit le cas mesuré sur @capacitor/core@8.4.1 : quand le plugin natif SafeArea
  // est absent (ex. ancienne APK installée), SafeArea.addListener(...) renvoie une
  // promesse qui rejette. Ce code ne l'awaite jamais (volontairement, pour ne pas
  // retarder l'appel à get() ni rater un événement entre les deux) : un simple
  // try/catch autour de l'appel n'intercepte donc RIEN de ce rejet — seul un .catch()
  // attaché directement à la promesse retournée le neutralise. Sans lui, ce rejet fuit
  // comme "unhandledRejection" au lieu d'être absorbé silencieusement.
  it("n'échappe aucun rejet de promesse non géré quand l'enregistrement de l'écouteur échoue", async () => {
    vi.resetModules()
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
      registerPlugin: () => ({
        addListener: () => Promise.reject(new Error('plugin natif absent')),
        get: () => Promise.reject(new Error('plugin natif absent')),
      }),
    }))

    const unhandled = []
    const onUnhandledRejection = (err) => unhandled.push(err)
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const { installSafeArea } = await import('@/native/safe-area')
      await expect(installSafeArea()).resolves.toBeUndefined()
      // Le rejet fautif est asynchrone et survient APRÈS le retour de installSafeArea() :
      // laisser passer quelques tours de boucle d'événements pour lui donner la chance
      // d'être signalé avant de vérifier qu'il ne l'a pas été.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      vi.doUnmock('@capacitor/core')
    }

    expect(unhandled).toEqual([])
  })
})

// Correctif de la course des insets au démarrage à froid (mesurée sur Pixel 7 /
// Android 17, 08/09) : pendant ~1,5-3 s, env(safe-area-inset-top) vaut 0 et --sa-top
// n'est pas encore posé → l'app se PEINT sous la barre d'état avant que l'inset
// natif n'arrive. installSafeArea() doit donc masquer le document de façon
// synchrone (avant tout await) et ne le révéler qu'une fois les insets connus —
// ou sur le garde-fou 4 s, ou sur l'échec du plugin : jamais d'app coincée cachée.
describe('installSafeArea — masquage de démarrage (anti-course des insets)', () => {
  // Réimporte le module APRÈS avoir posé le mock @capacitor/core : le module capture
  // registerPlugin/Capacitor à l'import, même motif que le test ci-dessus.
  // Le module observe le VRAI document.documentElement (MutationObserver du
  // rattrapage de démarrage à froid) — un observateur créé par un test précédent
  // et non arrêté resterait vivant sur cet élément partagé même après
  // vi.resetModules() (son module devient inatteignable mais sa closure ne l'est
  // pas) : une mutation de style d'un test suivant le réveillerait et écrirait
  // --sa-* par-dessus les attentes de ce test-là. dernierModule permet d'appeler
  // stopCapacitorInsetsWatch() en afterEach pour éviter cette fuite inter-tests.
  let dernierModule = null
  async function importerAvecMock(plugin, { natif = true } = {}) {
    vi.resetModules()
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => natif },
      registerPlugin: () => plugin,
    }))
    dernierModule = await import('@/native/safe-area')
    return dernierModule
  }

  afterEach(() => {
    dernierModule?.stopCapacitorInsetsWatch?.()
    dernierModule = null
    vi.doUnmock('@capacitor/core')
    vi.useRealTimers()
  })

  it('masque le document dès l’appel synchrone, puis révèle et écrit --sa-top après résolution', async () => {
    const { installSafeArea } = await importerAvecMock({
      addListener: () => Promise.resolve({ remove: () => {} }),
      get: () => Promise.resolve({ top: 52, right: 0, bottom: 48, left: 0 }),
    })

    const promesse = installSafeArea()
    // AVANT tout await : c'est le cœur de l'invariant. main.js appelle
    // installSafeArea() dans la même tâche que app.mount() ; le premier paint ne
    // peut survenir qu'après la fin de cette tâche, donc le masquage synchrone
    // précède mécaniquement toute peinture, montage compris.
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('hidden')

    await promesse
    // Révélé = propriété retirée (vide), et l'inset natif a bien été écrit.
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--sa-top')).toBe('52px')
  })

  it('retire la double réservation de la barre de nav avant d’écrire --sa-bottom (mesuré Huawei LYA-L29 3 boutons : écran 780, viewport 740)', async () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    const originalScreenWidth = window.screen.width
    const originalScreenHeight = window.screen.height
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 740 })
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 360 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 780 })
    // --safe-area-inset-bottom à 0 (posé par Capacitor sur webView.getParent(),
    // déjà rétréci) : le signal qui dit "ce côté est déjà réservé physiquement".
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '0px')
    document.documentElement.style.setProperty('--safe-area-inset-top', '25px')

    try {
      const { installSafeArea } = await importerAvecMock({
        addListener: () => Promise.resolve({ remove: () => {} }),
        get: () => Promise.resolve({ top: 25, right: 0, bottom: 40, left: 0 }),
      })

      await installSafeArea()

      expect(document.documentElement.style.getPropertyValue('--sa-bottom')).toBe('0px')
      expect(document.documentElement.style.getPropertyValue('--sa-top')).toBe('25px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
      Object.defineProperty(window.screen, 'width', { configurable: true, value: originalScreenWidth })
      Object.defineProperty(window.screen, 'height', { configurable: true, value: originalScreenHeight })
      document.documentElement.style.removeProperty('--safe-area-inset-bottom')
      document.documentElement.style.removeProperty('--safe-area-inset-top')
      document.documentElement.style.removeProperty('--sa-top')
      document.documentElement.style.removeProperty('--sa-bottom')
    }
  })

  it('rattrape la correction si Capacitor publie --safe-area-inset-* à 0 sur les deux côtés (course de démarrage à froid) puis les vraies valeurs plus tard', async () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    const originalScreenWidth = window.screen.width
    const originalScreenHeight = window.screen.height
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 740 })
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 360 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 780 })
    // Capacitor n'a pas encore injecté sa vraie valeur au moment de get() : les deux
    // côtés de l'axe lisent 0 (scénario mesuré en direct sur le Huawei, 12/09).
    document.documentElement.style.setProperty('--safe-area-inset-top', '0px')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '0px')

    try {
      const { installSafeArea } = await importerAvecMock({
        addListener: () => Promise.resolve({ remove: () => {} }),
        get: () => Promise.resolve({ top: 25, right: 0, bottom: 40, left: 0 }),
      })

      await installSafeArea()

      // Repli deux-côtés-à-zéro : correction pas encore appliquée (comportement sûr).
      expect(document.documentElement.style.getPropertyValue('--sa-bottom')).toBe('40px')

      // Capacitor injecte sa vraie valeur, en retard (scénario mesuré : onDOMReady
      // après le premier rendu).
      document.documentElement.style.setProperty('--safe-area-inset-top', '25px')
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '0px')

      // Le MutationObserver notifie en microtâche/macrotâche : laisser passer un tour
      // de boucle d'évènements.
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(document.documentElement.style.getPropertyValue('--sa-bottom')).toBe('0px')
      expect(document.documentElement.style.getPropertyValue('--sa-top')).toBe('25px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
      Object.defineProperty(window.screen, 'width', { configurable: true, value: originalScreenWidth })
      Object.defineProperty(window.screen, 'height', { configurable: true, value: originalScreenHeight })
      document.documentElement.style.removeProperty('--safe-area-inset-bottom')
      document.documentElement.style.removeProperty('--safe-area-inset-top')
      document.documentElement.style.removeProperty('--sa-top')
      document.documentElement.style.removeProperty('--sa-bottom')
    }
  })

  it('une mutation ultérieure sans changement logique laisse --sa-* stable', async () => {
    // Ce test ne peut PAS démontrer que le garde applyCorrectedInsets (comparaison
    // du résultat calculé avant réécriture) est nécessaire : mesuré empiriquement
    // (mutation locale du code, non conservée), jsdom ne met aucun nouveau record
    // de MutationObserver en file quand setProperty repose une valeur déjà
    // identique — le scénario de boucle que ce garde prévient ne se déclenche
    // donc jamais dans cet environnement de test, garde présent ou non. Il reste
    // utile comme test de non-régression sur le résultat final, et le garde
    // lui-même reste justifié pour un vrai moteur DOM (WebView Android), où cette
    // dédoublonnage n'est pas garanti — voir le commentaire de watchCapacitorInsets.
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    const originalScreenWidth = window.screen.width
    const originalScreenHeight = window.screen.height
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 740 })
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 360 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 780 })
    document.documentElement.style.setProperty('--safe-area-inset-top', '25px')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '0px')

    try {
      const { installSafeArea } = await importerAvecMock({
        addListener: () => Promise.resolve({ remove: () => {} }),
        get: () => Promise.resolve({ top: 25, right: 0, bottom: 40, left: 0 }),
      })

      await installSafeArea()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(document.documentElement.style.getPropertyValue('--sa-bottom')).toBe('0px')

      document.documentElement.style.setProperty('--safe-area-inset-bottom', '0px')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(document.documentElement.style.getPropertyValue('--sa-bottom')).toBe('0px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
      Object.defineProperty(window.screen, 'width', { configurable: true, value: originalScreenWidth })
      Object.defineProperty(window.screen, 'height', { configurable: true, value: originalScreenHeight })
      document.documentElement.style.removeProperty('--safe-area-inset-bottom')
      document.documentElement.style.removeProperty('--safe-area-inset-top')
      document.documentElement.style.removeProperty('--sa-top')
      document.documentElement.style.removeProperty('--sa-bottom')
    }
  })

  it('révèle aussi quand get() rejette (jamais d’app coincée invisible, repli env())', async () => {
    const { installSafeArea } = await importerAvecMock({
      addListener: () => Promise.reject(new Error('plugin natif absent')),
      get: () => Promise.reject(new Error('plugin natif absent')),
    })

    const promesse = installSafeArea()
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('hidden')

    await expect(promesse).resolves.toBeUndefined()
    // Plugin absent : layout dégradé (repli env()), mais document révélé — mieux
    // vaut un layout rarement dégradé qu'une app invisible.
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('')
  })

  it('révèle via le garde-fou 4 s quand get() ne répond jamais', async () => {
    vi.useFakeTimers()
    const { installSafeArea } = await importerAvecMock({
      addListener: () => Promise.resolve({ remove: () => {} }),
      get: () => new Promise(() => {}), // pont muet : ni resolve, ni reject
    })

    const promesse = installSafeArea()
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('hidden')

    vi.advanceTimersByTime(4000)
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('')
    // La promesse reste pendante par construction : neutralisée pour l'hygiène
    // (pas de rejet attendu — get() ne settle jamais).
    promesse.catch(() => {})
  })

  it('annule le garde-fou à la révélation (idempotence : rien ne bouge ensuite)', async () => {
    vi.useFakeTimers()
    const { installSafeArea } = await importerAvecMock({
      addListener: () => Promise.resolve({ remove: () => {} }),
      get: () => Promise.resolve({ top: 52, right: 0, bottom: 48, left: 0 }),
    })

    await installSafeArea()
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('')

    // La révélation a annulé le timer du garde-fou : avancer bien au-delà de 4 s
    // ne doit ni toucher visibility, ni lever (révélation appelée deux fois sans
    // effet — pas de timer fantôme).
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--sa-top')).toBe('52px')
  })

  it('hors plateforme native : visibility jamais touchée, plugin jamais appelé', async () => {
    const get = vi.fn(() => Promise.resolve({ top: 52, right: 0, bottom: 48, left: 0 }))
    const addListener = vi.fn(() => Promise.resolve({ remove: () => {} }))

    const { installSafeArea } = await importerAvecMock({ get, addListener }, { natif: false })

    await installSafeArea()
    // Web, banc, e2e web : comportement strictement inchangé — ni masquage, ni
    // sollicitation du pont (le repli env() de tokens.css suffit).
    expect(document.documentElement.style.getPropertyValue('visibility')).toBe('')
    expect(get).not.toHaveBeenCalled()
    expect(addListener).not.toHaveBeenCalled()
  })
})
