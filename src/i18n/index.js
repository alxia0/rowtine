// i18n : FR complet, EN en place dès le départ.
import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import fr from './fr.json'
import en from './en.json'
import de from './de.json'
import es from './es.json'
import { detectDeviceLocale } from '@/utils/app-locale'

// Repli en anglais, pas en français : une clé manquante dans une langue
// tierce (allemand, espagnol...) doit s'afficher en anglais plutôt qu'en
// français au milieu d'un écran dans une autre langue. L'anglais est un
// repli acceptable partout, le français non (vérifié : les 778 clés de
// en.json sont toutes présentes dans fr.json, donc ce changement n'a
// aucun effet sur le repli côté français lui-même).
const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  // Langue de l'appareil dès la création de l'instance : le router la remplacera par la
  // langue PERSISTÉE au 1er montage, mais il s'exécute après — sans ce défaut-ci, le tout
  // premier rendu clignoterait en français avant de basculer.
  locale: detectDeviceLocale(),
  fallbackLocale: 'en',
  messages: { fr, en, de, es },
})

// `<html lang>` suit la locale — ICI et nulle part ailleurs (revue du 29/07, passage
// multilingue). `index.html` livre `lang="fr"` en dur et rien ne le mettait à jour : TalkBack
// prononçait donc l'allemand et l'espagnol avec la phonétique française (inintelligible), et
// la césure CSS comme le correcteur orthographique de la WebView (éditeur de correction)
// travaillaient eux aussi avec la mauvaise langue.
//
// UN SEUL observateur, posé sur la source de vérité (la locale de i18n), plutôt que trois
// appels aux trois endroits qui écrivent cette locale (router/index.js, OnboardingView
// `setLang`, SettingsView `setLocale`) : trois copies finiraient par diverger, et un
// quatrième point d'écriture ajouté demain n'y penserait pas.
//
// `immediate: true` couvre l'état INITIAL (au premier import, avant tout changement) autant
// que les changements. `flush: 'sync'` : l'attribut est posé dans le même tick que
// l'affectation de la locale, sans attendre le cycle de rendu de Vue — un lecteur d'écran
// qui interroge le document juste après le changement lit déjà la bonne valeur.
//
// Garde `typeof document` : le module est importable hors DOM (script d'outillage, banc).
watch(
  i18n.global.locale,
  (locale) => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale
  },
  { immediate: true, flush: 'sync' },
)

export default i18n
