import { onMounted, onBeforeUnmount } from 'vue'

// Geste « retour » : balayage horizontal vers la droite depuis le bord gauche de l'écran.
// Déclenche `onBack` (typiquement le retour intelligent). Seuils volontairement
// conservateurs pour ne pas gêner les gestes horizontaux internes (segments, sliders) :
// le geste ne démarre que près du bord gauche, exige une distance minimale, et reste
// quasi horizontal (filtre l'axe vertical pour ne pas confondre avec le scroll).
export function useSwipeBack(onBack, { edge = 28, minDistanceX = 70, maxOffAxisRatio = 0.5 } = {}) {
  let startX = 0
  let startY = 0
  let startId = null
  let tracking = false

  function onStart(e) {
    const t = e.touches[0]
    if (!t) return
    tracking = t.clientX <= edge
    startX = t.clientX
    startY = t.clientY
    // Identité du doigt suivi. `e.touches[0]` reste le PREMIER doigt posé : sur un 2e
    // `touchstart` (pincement), il vaut encore le doigt du bord, donc `tracking` survit — et
    // sans ce repère, le `touchend` du 2e doigt (celui qui a parcouru l'écran) passait pour la
    // fin du balayage de bord et déclenchait un retour au beau milieu d'un pincement (visionneuse
    // photo, diagramme plein écran : l'écran se fermait tout seul).
    startId = t.identifier
  }
  function onEnd(e) {
    if (!tracking) return
    // Un `touchend` d'un AUTRE doigt ne conclut pas le geste — et ne l'annule pas non plus : le
    // doigt du bord est peut-être encore posé.
    // Boucle indexée et non `[...e.changedTouches]` : `TouchList` n'est pas itérable sur les
    // WebView Android anciennes que l'app cible (même prudence que `useSplitReader`).
    let t = null
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === startId) t = e.changedTouches[i]
    }
    if (!t) return
    tracking = false
    const dx = t.clientX - startX
    const dy = Math.abs(t.clientY - startY)
    if (dx >= minDistanceX && dy <= dx * maxOffAxisRatio) onBack()
  }

  onMounted(() => {
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', onStart)
    window.removeEventListener('touchend', onEnd)
  })
}
