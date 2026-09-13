// Réglages utilisateur (prénom, technique par défaut, langue, onboarding fait).
// Persistés localement via Dexie.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSetting, setSetting } from '@/db/db'
import { CURRENCIES, DEFAULT_CURRENCY } from '@/constants/currencies'
import { detectDeviceLocale } from '@/utils/app-locale'
import { DEFAULT_HUES, defaultHueFor } from '@/theme/palette'
import { applyAccent } from '@/theme/apply'
import { resolveEffective } from '@/theme/resolve'

export const useSettingsStore = defineStore('settings', () => {
  const firstName = ref('')
  const defaultTechnique = ref('knitting') // 'knitting' | 'crochet'
  const locale = ref(detectDeviceLocale())
  const onboarded = ref(false)
  const theme = ref('system') // 'system' | 'light' | 'dark'
  // Teinte d'accent (0-360). `accentHueChosen` distingue un CHOIX EXPLICITE (ColorPicker /
  // nuancier) du défaut : tant qu'il est faux, la teinte rendue est DYNAMIQUE selon le thème
  // effectif (rose 320 en sombre, bleu 230 en clair, cf. theme/palette.js::defaultHueFor) et
  // `accentHue` n'est qu'un placeholder ignoré par le rendu. Migration installations
  // existantes : `accentHue` n'a JAMAIS été écrite au boot (seul saveAccentHue, sur geste
  // utilisateur, l'écrit — vérifié au 31/08), donc une `accentHue` persistée SANS le marqueur
  // est un choix d'avant le marqueur → traitée comme explicite, aucune bascule surprise.
  const accentHue = ref(DEFAULT_HUES.light) // 0-360 (lu uniquement si accentHueChosen)
  const accentHueChosen = ref(false)
  const loaded = ref(false)
  // Astuce « balaie pour revenir en arrière » (onboarding.swipeHint) : montrée en pop-up au
  // 1er passage sur l'accueil, puis plus jamais (P3). Doit être PERSISTÉE — un simple
  // ref en mémoire réafficherait la pop-up à chaque lancement de l'app.
  const swipeHintSeen = ref(false)
  // Pop-up de bienvenue de l'accueil (lot 10/08/2026). Sens « À MONTRER », et non
  // « déjà montré » : c'est ce qui met les installations existantes à l'abri SANS code de
  // migration. Une base déjà en service n'a pas cette clé, donc ne verra rien.
  // Une restauration ne la fait JAMAIS réapparaître non plus — mais pas parce qu'aucune
  // sauvegarde ne porterait cette clé (c'est déjà faux dès la première sauvegarde écrite
  // après ce lot, une fois `welcomeDue` posé puis effacé en base). L'invariant réel :
  // `runRestore` (src/backup/restore-service.js) efface explicitement ce drapeau après
  // avoir écrit le snapshot restauré, quelle que soit la sauvegarde restaurée (récente ou
  // d'avant ce lot) — retrouver son travail ne fait pas de vous une nouvelle utilisatrice.
  const welcomeDue = ref(false)
  // Message « tes données sont de retour » (lot du 06/09/2026). Jumeau de `welcomeDue`
  // ci-dessus — même sens « à montrer », jamais « déjà montré », donc la même garantie
  // structurelle : une base qui n'a pas cette clé ne voit rien, sans migration. Ils se
  // distinguent par LEUR ORIGINE, pas par leur mécanique : `welcomeDue` est posé par la
  // porte du dossier quand la base ne contient que le semis ; `restoredDue` est posé PAR
  // la restauration qui vient d'écraser ce semis (restore-service.js écrit la clé
  // DIRECTEMENT en base, AVANT `reloadStores()` — cf. son commentaire, même contrat que
  // `welcomeDue`) pour que l'accueil remplace la bienvenue par « tes données sont de
  // retour » au lieu de laisser l'utilisatrice sans aucun message. Effacé avec lui à
  // l'acquittement de la pop-up (HomeView::dismissWelcome).
  const restoredDue = ref(false)
  // Avertissement « un patron importé se relit » (lot du 19/08/2026). MÊME SENS que
  // `welcomeDue` ci-dessus — « à montrer », jamais « déjà montré » — et pour la même raison
  // structurelle : une base déjà en service n'a pas cette clé, donc ne verra jamais cet
  // avertissement, sans une ligne de migration. L'application d'Alexia est dans ce cas.
  // Posé par la porte du dossier, en même temps que la bienvenue ; effacé au seul
  // acquittement de la pop-up (LibraryView), jamais à sa demande — si l'utilisatrice quitte
  // la Bibliothèque avant de l'avoir vue, l'avertissement revient à la visite suivante.
  const importCaveatDue = ref(false)
  // Localisation (lot 2, 25/07). Le stockage des laines reste TOUJOURS en mètres et en
  // grammes : ces réglages ne changent que l'affichage et la saisie. Valeurs par défaut
  // métrique/euro pour qu'un compte existant ne change pas de comportement.
  const unitSystem = ref('metric') // 'metric' | 'imperial'
  const currency = ref(DEFAULT_CURRENCY)
  // Premier jour de la semaine (ÉVO E, 11/08) : 1 = lundi (défaut, comportement inchangé pour
  // tout compte existant), 0 = dimanche. Convention `Date.getDay()` — cf. `startOfWeek`
  // (utils/time-periods.js), qui reçoit cette valeur PAR PARAMÈTRE (jamais lue depuis ce store
  // à l'intérieur d'une fonction pure). Portée : la grille calendaire, les barres par jour de
  // semaine et le total hebdomadaire de l'Accueil — « tout ce qui parle de semaine ».
  const weekStart = ref(1) // 0 | 1

  async function load() {
    // Les quatorze clés sont lues EN PARALLÈLE : chaque `getSetting` est une transaction
    // IndexedDB distincte, et cette fonction est attendue par le tout premier `beforeEach`
    // du routeur — avant la parallélisation, treize allers-retours en file d'attente
    // retardaient d'autant le premier écran (sensible sur la tablette cible). Aucune ne
    // dépend d'une autre en LECTURE ; la seule dépendance est à l'affectation (`locale` a
    // besoin d'`onboarded`), et l'ordre des affectations ci-dessous est conservé tel quel.
    const [
      storedFirstName,
      storedTechnique,
      storedOnboarded,
      storedLocale,
      storedTheme,
      storedHue,
      storedHueChosen,
      storedSwipeHint,
      storedWelcomeDue,
      storedRestoredDue,
      storedImportCaveat,
      storedUnitSystem,
      storedCurrency,
      storedWeekStart,
    ] = await Promise.all([
      getSetting('firstName'),
      getSetting('defaultTechnique'),
      getSetting('onboarded'),
      getSetting('locale'),
      getSetting('theme'),
      getSetting('accentHue'),
      getSetting('accentHueChosen'),
      getSetting('swipeHintSeen'),
      getSetting('welcomeDue'),
      getSetting('restoredDue'),
      getSetting('importCaveatDue'),
      getSetting('unitSystem'),
      getSetting('currency'),
      getSetting('weekStart'),
    ])
    firstName.value = storedFirstName ?? ''
    defaultTechnique.value = storedTechnique ?? 'knitting'
    onboarded.value = storedOnboarded ?? false
    // Rien de persisté = premier lancement : on propose la langue de l'appareil.
    // Mais une utilisatrice DÉJÀ onboardée sans `locale` en base n'est pas un premier
    // lancement : c'est une installation d'avant le chantier multilingue, où la langue
    // était 'fr' figée en dur (jamais écrite en base). Si on la faisait basculer sur
    // detectDeviceLocale() ici, son interface changerait de langue au premier
    // redémarrage après mise à jour, sans qu'elle ait rien demandé, autour d'un contenu
    // (exemples, patron libre) resté en français. L'appareil ne doit décider QUE pour un
    // vrai premier lancement.
    locale.value = storedLocale ?? (onboarded.value ? 'fr' : detectDeviceLocale())
    theme.value = storedTheme ?? 'system'
    accentHue.value = storedHue ?? DEFAULT_HUES.light
    // Marqueur absent mais teinte persistée = installation d'avant le marqueur : choix
    // explicite (cf. commentaire de déclaration ci-dessus).
    accentHueChosen.value = storedHueChosen ?? (storedHue !== undefined && storedHue !== null)
    swipeHintSeen.value = storedSwipeHint ?? false
    welcomeDue.value = storedWelcomeDue ?? false
    restoredDue.value = storedRestoredDue ?? false
    importCaveatDue.value = storedImportCaveat ?? false
    unitSystem.value = storedUnitSystem ?? 'metric'
    currency.value = storedCurrency ?? DEFAULT_CURRENCY
    weekStart.value = storedWeekStart ?? 1
    loaded.value = true
  }

  async function completeOnboarding({ firstName: fn, technique, theme: th }) {
    firstName.value = (fn ?? '').trim()
    defaultTechnique.value = technique
    onboarded.value = true
    await setSetting('firstName', firstName.value)
    await setSetting('defaultTechnique', technique)
    await setSetting('onboarded', true)
    // `welcomeDue` ne se pose plus ici (lot « ordre des pop-ups », 10/08/2026) : la porte du
    // dossier passe désormais entre la fin de cet écran et l'accueil, et c'est ELLE qui décide
    // du moment — cf. `setWelcomeDue()` ci-dessous, appelée depuis
    // OnboardingFolderPrompt.vue::onChooseNow().
    if (th !== undefined) {
      theme.value = th
      await setSetting('theme', th)
    }
  }

  async function markSwipeHintSeen() {
    swipeHintSeen.value = true
    await setSetting('swipeHintSeen', true)
  }

  async function clearWelcomeDue() {
    welcomeDue.value = false
    await setSetting('welcomeDue', false)
  }

  // Pose le drapeau « bienvenue à montrer » (lot « ordre des pop-ups », 10/08/2026).
  // Appelée depuis OnboardingFolderPrompt.vue::onChooseNow(), juste après une désignation
  // de dossier réussie — voir le commentaire à cet appel pour la raison de l'ordre avec
  // la restauration éventuelle. Même forme que `clearWelcomeDue()` ci-dessus : mémoire ET
  // base, `await` sur l'écriture (pas de tâche de fond).
  async function setWelcomeDue() {
    welcomeDue.value = true
    await setSetting('welcomeDue', true)
  }

  // Jumeaux de `setWelcomeDue()` / `clearWelcomeDue()` ci-dessus, pour la même raison :
  // mémoire ET base, `await` sur l'écriture (pas de tâche de fond — cf. le piège
  // `swipeHintSeen` commenté au-dessus de `clearWelcomeDue()`). Nuance d'origine :
  // `setRestoredDue()` n'a AUCUN appelant dans l'app — restore-service.js écrit la clé
  // DIRECTEMENT en base via `setSetting`, AVANT `reloadStores()`, parce que le store
  // n'est pas encore l'état de référence au moment de l'écriture (il le devient au
  // rechargement, cf. son commentaire) ; elle existe pour la symétrie du store et pour
  // les tests, qui simulent par elle le basculement vu par `settingsStore.load()`.
  async function setRestoredDue() {
    restoredDue.value = true
    await setSetting('restoredDue', true)
  }

  async function clearRestoredDue() {
    restoredDue.value = false
    await setSetting('restoredDue', false)
  }

  // Même forme que `setWelcomeDue()` / `clearWelcomeDue()` ci-dessus : mémoire ET base,
  // `await` sur l'écriture, pas de tâche de fond.
  async function setImportCaveatDue() {
    importCaveatDue.value = true
    await setSetting('importCaveatDue', true)
  }

  async function clearImportCaveatDue() {
    importCaveatDue.value = false
    await setSetting('importCaveatDue', false)
  }

  async function saveTheme(value) {
    theme.value = value
    await setSetting('theme', value)
  }

  // Teinte RÉELLEMENT à rendre pour un thème effectif donné : le choix explicite s'il
  // existe, sinon le défaut dynamique (rose/bleu). C'est la seule porte du rendu (router,
  // SettingsView, StatsView) — ne jamais lire `accentHue` directement pour peindre.
  function effectiveAccentHue(effectiveTheme) {
    return accentHueChosen.value ? accentHue.value : defaultHueFor(effectiveTheme)
  }

  async function saveAccentHue(value) {
    accentHue.value = value
    // Tout appel à saveAccentHue EST un geste utilisateur (nuancier ou relâché du glissé,
    // SettingsView.vue) : le choix devient explicite et persistant.
    accentHueChosen.value = true
    await setSetting('accentHue', value)
    await setSetting('accentHueChosen', true)
  }

  // Seam e2e — alternance des couleurs par défaut dans les captures du guide (spec
  // 2026-09-05) : force la teinte d'accent SANS passer par l'écran Réglages, en plein
  // milieu du parcours du générateur. `hue` en nombre = le geste du nuancier
  // (saveAccentHue : mémoire + base + marqueur de choix) suivi de l'application
  // immédiate (applyAccent, comme SettingsView.setAccentHue) — les tokens changent avant
  // la photo, sans navigation. `hue` null = retour au DÉFAUT DYNAMIQUE, l'état d'un
  // premier lancement qu'aucun geste des Réglages ne permet de retrouver (un choix
  // explicite y est définitif) : les captures « bleu » du guide clair le photographient.
  async function e2eSetAccentHue(hue) {
    const effective = resolveEffective(theme.value)
    if (hue == null) {
      accentHue.value = DEFAULT_HUES.light
      accentHueChosen.value = false
      await setSetting('accentHueChosen', false)
      applyAccent(defaultHueFor(effective), effective)
    } else {
      await saveAccentHue(hue)
      applyAccent(hue, effective)
    }
  }

  // Même motif que `saveTheme` ci-dessus : effet immédiat, une seule clé, aucune donnée
  // touchée — on ne change qu'un repère de lecture, jamais une session ni une date déjà écrite.
  async function saveWeekStart(value) {
    weekStart.value = value
    await setSetting('weekStart', value)
  }

  // Chaque clé est enregistrée indépendamment (on peut changer la devise sans toucher aux
  // unités). Une valeur hors liste est ignorée : un réglage corrompu afficherait un symbole
  // vide sur tous les écrans.
  async function saveUnits(data) {
    if (data.unitSystem === 'metric' || data.unitSystem === 'imperial') {
      unitSystem.value = data.unitSystem
      await setSetting('unitSystem', data.unitSystem)
    }
    if (CURRENCIES.includes(data.currency)) {
      currency.value = data.currency
      await setSetting('currency', data.currency)
    }
  }

  async function saveProfile(data) {
    if (data.firstName !== undefined) {
      firstName.value = data.firstName.trim()
      await setSetting('firstName', firstName.value)
    }
    if (data.technique !== undefined) {
      defaultTechnique.value = data.technique
      await setSetting('defaultTechnique', data.technique)
    }
    if (data.locale !== undefined) {
      locale.value = data.locale
      await setSetting('locale', data.locale)
    }
  }

  // Enregistrement du seam (idiom __E2E_PHOTO__ de src/utils/photo.js) : uniquement en
  // build de test (VITE_E2E est posé par le webServer de la config Playwright), éliminé
  // au build de production. L'action reste testable en unitaire sans cette fenêtre.
  if (import.meta.env.VITE_E2E && typeof window !== 'undefined') {
    window.__E2E_ACCENT__ = { set: (hue) => e2eSetAccentHue(hue) }
  }

  return {
    firstName,
    defaultTechnique,
    locale,
    onboarded,
    theme,
    accentHue,
    accentHueChosen,
    effectiveAccentHue,
    swipeHintSeen,
    welcomeDue,
    restoredDue,
    importCaveatDue,
    loaded,
    unitSystem,
    currency,
    weekStart,
    load,
    completeOnboarding,
    markSwipeHintSeen,
    clearWelcomeDue,
    setWelcomeDue,
    setRestoredDue,
    clearRestoredDue,
    setImportCaveatDue,
    clearImportCaveatDue,
    saveTheme,
    saveAccentHue,
    e2eSetAccentHue,
    saveWeekStart,
    saveProfile,
    saveUnits,
  }
})
