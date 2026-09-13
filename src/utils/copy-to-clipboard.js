// Copie de texte vers le presse-papiers, sans dépendance neuve (PAS de
// @capacitor/clipboard : l'API web suffit dans notre contexte). Premier choix
// `navigator.clipboard.writeText` : l'app est servie https://localhost sous
// Capacitor (contexte sécurisé) et les déclencheurs sont des clics (user
// activation présente) — les deux conditions de l'API y sont réunies. Repli
// historique `textarea` hors écran + `document.execCommand('copy')` pour les
// rares webviews où la première voie manque ou échoue.
//
// ⚠️ CONTRAT : renvoie un booléen (true = copié), ne lève JAMAIS. Un échec de
// copie n'a pas le droit d'être muet : c'est l'APPELANT qui l'annonce
// (snackbar « copie impossible » dans App.vue) — ici on se contente de le
// mesurer, y compris en rattrapant les exceptions des deux voies.
export async function copyToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refus de permission, document non focalisé… : on tente le repli plutôt
    // que d'abandonner — le rapport d'échec DOIT sortir de l'appareil.
  }
  let textarea = null
  try {
    textarea = document.createElement('textarea')
    textarea.value = text
    // readonly : empêche un clavier virtuel de s'ouvrir sur appareil ;
    // position fixe hors écran : la sélection ne doit provoquer ni scroll ni
    // flash de l'interface (le display:none historique casse la sélection sur
    // certains navigateurs, d'où le déport hors écran à la place).
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    // setSelectionRange : requis par les WebKit/iOS pour copier un contenu non
    // vide ; sans lui la sélection peut retomber à zéro au moment de la copie.
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    return !!ok
  } catch {
    return false
  } finally {
    // Nettoyage GARANTI, y compris si execCommand lève : un textarea résiduel
    // dans le body polluerait la page entière (lecteur d'écran, tabindex).
    textarea?.remove()
  }
}
