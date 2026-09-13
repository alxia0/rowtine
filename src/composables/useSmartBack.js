import { useRouter } from 'vue-router'

// Retour « intelligent » : revient à l'écran précédent s'il existe dans l'historique,
// sinon retombe sur un écran sûr (accueil par défaut). Évite de sortir de l'app — ou
// de rester bloqué — sur un deep-link / démarrage à froid posé sur un écran de détail.
// Préférable au `router.push({ name: '...' })` codé en dur : on revient là d'où l'on vient
// (un patron ouvert depuis un projet renvoie au projet, pas à la bibliothèque).
export function useSmartBack(fallback = { name: 'home' }) {
  const router = useRouter()
  return function goBack() {
    if (window.history.state && window.history.state.back != null) router.back()
    else router.push(fallback)
  }
}
