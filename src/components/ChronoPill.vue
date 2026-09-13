<script setup>
// Pastille chrono, extraite du lecteur (lot « chrono unifié », 2026-08-30) pour être
// réutilisée par la fiche projet. Elle est AUTONOME sur l'état : elle lit elle-même le
// store activeSession (`running`, `elapsedSec`) et rend ses trois aspects — en marche =
// icône + temps ; en pause = « Reprendre » + temps ; jamais lancé = « Chrono » en appel
// à l'action pulsé. Elle ne sait en revanche RIEN de la politique : un appui sur le CORPS
// émet `toggle`, et chaque parent décide (lecteur : play/pause simple).
//
// Spec 08/09/2026 (fusion chrono + œil, variante B) : l'EXTRÉMITÉ de la pastille porte une
// zone chevron ▾ qui ouvre un mini-menu d'UNE entrée « Masquer le chrono » — l'affordance
// se voit, l'œil permanent disparaît des deux surfaces. Le composant reste sans politique :
// l'entrée émet `hide`, chaque parent y branche SA fonction de masquage existante (celle de
// l'ancien œil), qui détient `showTimer`. `canHide` (défaut true) retire le chevron quand
// il n'y a nulle part où persister le réglage — cas « patron libre » du lecteur (ctx
// pattern, sans projet) : la pastille y reste toujours visible. Le menu se referme par
// Échap / appui au dehors (scrim) — même mécanique `useDismissMenu` que les autres menus
// de la maison ; il s'ouvre VERS LE HAUT, les deux surfaces accueillant la pastille en
// bas d'écran (barre d'action du lecteur, dock de la fiche).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useActiveSessionStore, fmtDuration } from '@/stores/activeSession'
import { useDismissMenu } from '@/composables/useDismissMenu'
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  // Faux = pas de chevron (rien à persister derrière). Vrai par défaut : la fiche projet
  // et le lecteur en contexte projet passent canHide tel quel.
  canHide: { type: Boolean, default: true },
})
const emit = defineEmits(['toggle', 'hide'])
const { t } = useI18n()
const active = useActiveSessionStore()
const chrono = computed(() => fmtDuration(active.elapsedSec))
// Mini-menu « Masquer le chrono » : état + Échap + focus, gérés par le composable maison
// (le scrim ci-dessous couvre l'appui au dehors, même motif que le kebab de la fiche).
const { open: menuOpen, triggerRef, menuRef } = useDismissMenu()
// L'entrée referme le menu PUIS émet : le parent déclenche son masquage (clôture de
// session commitante puis showTimer:false) — jamais ici, le composant est sans politique.
function requestHide() {
  menuOpen.value = false
  emit('hide')
}
</script>

<template>
  <!-- Capsule à DEUX boutons frères (jamais l'un dans l'autre) : le corps garde l'unique
       geste lecture/pause, le chevron n'y répond donc structurellement JAMAIS — pas besoin
       de stopPropagation, les deux cibles sont disjointes. -->
  <div class="chrono-fab" :class="{ 'chrono-fab--idle': !active.running }">
    <button
      type="button"
      class="chrono-fab__body"
      :aria-label="active.running ? t('session.pause') : t('reader.chronoStart')"
      @click="emit('toggle')"
    >
      <span class="chrono-fab__ic"><AppIcon :name="active.running ? 'pause' : 'play'" :size="18" /></span>
      <template v-if="active.running">
        <span class="chrono-fab__time">{{ chrono }}</span>
      </template>
      <template v-else-if="active.elapsedSec > 0">
        <span class="chrono-fab__lbl">{{ t('reader.chronoResume') }}</span>
        <span class="chrono-fab__time">{{ chrono }}</span>
      </template>
      <template v-else>
        <span class="chrono-fab__lbl">{{ t('reader.chronoStart') }}</span>
      </template>
    </button>
    <button
      v-if="canHide"
      ref="triggerRef"
      type="button"
      class="chrono-fab__chev"
      :aria-label="t('reader.hideTimer')"
      aria-haspopup="true"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <AppIcon name="chevronDown" :size="16" />
    </button>
    <!-- Mini-menu ouvert VERS LE HAUT (bottom: 100%) : la pastille vit en bas d'écran sur
         ses deux surfaces, le menu ne doit jamais passer sous la barre/le dock. Scrim après
         le menu dans le DOM, SOUS lui en empilement (z-index) : appui n'importe où = fermer,
         sans jamais émettre hide (fermer n'est pas masquer). -->
    <template v-if="menuOpen">
      <nav ref="menuRef" class="chrono-fab__menu">
        <button type="button" class="chrono-fab__menu-item" @click="requestHide">{{ t('reader.hideTimer') }}</button>
      </nav>
      <div class="chrono-fab__scrim" @click="menuOpen = false"></div>
    </template>
  </div>
</template>

<style scoped>
/* Uniquement le PROPRE rendu de la pastille (hauteur, couleurs, typo, pulsation) : les
   règles de DISPOSITION dans la barre qui l'accueille — flex, min-width, marges,
   resserrage au seuil téléphone — restent chez le parent (cf. ReaderView.vue), elles
   dépendent de lui : la fiche projet positionne la pastille autrement qu'ici.
   Retour device 27/07 : largeur ajustée à son contenu, jamais toute la barre. Pas de
   largeur en dur non plus : les libellés traduits (« Timer », « Cronómetro ») n'ont pas
   la même longueur.
   La capsule est un conteneur (position:relative = ancre du mini-menu) : couleurs, bord
   et rayon y vivent ; la typo et le padding du geste vivent sur le CORPS (le padding de
   la capsule d'avant), pour que le chevron complete la pilule sans en hériter. */
.chrono-fab {
  position: relative;
  min-height: 52px;
  display: inline-flex;
  align-items: stretch;
  border-radius: var(--r-pill);
  /* En marche / en pause : la pastille suit la teinte du thème (décision produit 09/09 —
     l'ancienne capsule crème figée ne suivait rien). Fond TRANSLUCIDE de la teinte
     (indicateur, hiérarchisé sous l'idle plein et pulsant) ; brand-deep porte le texte
     dans les deux thèmes (rôle clair conservé en bande chaude, cf. palette.js). NB : la
     tuile « Reprendre » de l'accueil garde sa crème — famille crème/sauge assumée
     (HomeView), à distinguer si un jour elle doit suivre aussi. */
  background: rgba(var(--brand-rgb), 0.16);
  border: 1px solid rgba(var(--brand-rgb), 0.35);
  color: var(--brand-deep);
  box-shadow: 0 12px 24px -12px rgba(var(--brand-rgb), 0.35), 0 1px 1px rgba(255, 255, 255, 0.4) inset;
}
.chrono-fab__body {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* gap et padding reserrés sur téléphone PAR LE PARENT (seuil 430 px, cf. ReaderView.vue)
     pour libérer la place du libellé « Reprendre » ; la hauteur n'a jamais manqué.
     ⚠️ Le sélecteur parent vise .chrono-fab__body (et plus .chrono-fab) depuis la fusion
     chevron : le padding d'origine de la capsule a déménagé ici. */
  gap: 9px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: inherit;
  font-weight: 800;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
/* Zone chevron : partie de la capsule (pas un bouton rapporté à côté), séparée du corps
   par un mince liseré. Hauteur = celle de la pilule (align-items: stretch, ≥ 44 px :
   la capsule fait 52 px). Même teinte que l'icône du corps, inversée sur l'appel à
   l'action pulsé (fond de teinte pleine). */
.chrono-fab__chev {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  border: none;
  border-left: 1px solid var(--line);
  border-radius: 0 var(--r-pill) var(--r-pill) 0;
  background: transparent;
  color: var(--brand-deep);
}
/* Zone de touche étendue : la cible tactile maison est ≥ 44 px de côté ; 40 px visuels
   n'y suffisaient pas. Le pseudo-élément élargit la surface CLIQUABLE à 48 px (± 4 px)
   SANS toucher au rendu de la capsule (aucune boîte ajoutée au flux, boundingBox du
   bouton inchangée) — technique du « hit area » transparent. Empiète 4 px sur le corps
   (dont le centre de clic reste loin) et 4 px hors capsule côté droit. */
.chrono-fab__chev::after {
  content: '';
  position: absolute;
  inset: 0 -4px;
}
.chrono-fab--idle .chrono-fab__chev {
  color: var(--on-accent);
}
.chrono-fab__ic {
  flex: none;
  font-size: 15px;
  color: var(--brand-deep);
}
.chrono-fab__lbl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 800;
}
/* à l'arrêt : appel à l'action bien visible (teinte pleine + pulsation) pour penser à le
   lancer. La pulsation vit sur la CAPSULE : le chevron pulse avec elle, c'est une seule
   pastille. */
.chrono-fab--idle {
  background: var(--brand-grad);
  border-color: transparent;
  color: var(--on-accent);
  box-shadow: 0 12px 24px -12px rgba(var(--brand-rgb), 0.6), 0 1px 1px rgba(255, 255, 255, 0.3) inset;
  animation: chrono-pulse 1.8s ease-in-out infinite;
}
.chrono-fab--idle .chrono-fab__ic {
  color: var(--on-accent);
}
@keyframes chrono-pulse {
  0%,
  100% {
    box-shadow: 0 12px 24px -12px rgba(var(--brand-rgb), 0.6), 0 0 0 0 rgba(var(--brand-rgb), 0.45);
  }
  50% {
    box-shadow: 0 12px 24px -12px rgba(var(--brand-rgb), 0.6), 0 0 0 7px rgba(var(--brand-rgb), 0);
  }
}
/* Mini-menu d'UNE entrée, même facture que les autres menus de la maison (kebab de la
   fiche, StatusBadge) : fond --bg, bord --line, ombre --e-3. VERS LE HAUT et aligné sur
   le bord GAUCHE de la pastille (elle vit à gauche de la barre/dock : le menu s'étend
   vers le centre de l'écran, jamais hors cadre). */
.chrono-fab__menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 60;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--e-3);
  padding: var(--sp-2);
  min-width: 180px;
  display: flex;
  flex-direction: column;
}
.chrono-fab__menu-item {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  padding: 12px 14px;
  border-radius: var(--r-sm);
  white-space: nowrap;
}
.chrono-fab__scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
}
</style>
