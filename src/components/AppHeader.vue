<script setup>
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSmartBack } from '@/composables/useSmartBack'
import { useDismissMenu } from '@/composables/useDismissMenu'
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  title: { type: String, required: true },
  // Affiche un bouton retour ‹ à gauche (écrans de détail). Les écrans de 1er niveau
  // (accueil, stock, biblio, réglages) le laissent à false : ils n'ont que le burger.
  back: { type: Boolean, default: false },
})

const router = useRouter()
const { t } = useI18n()
const { open, triggerRef, menuRef } = useDismissMenu()
const goBack = useSmartBack()

// Navigation = menu burger en haut à droite (décision design 28/06, pas de barre basse).
// Neuf entrées (Sessions, 31/08, rangée avec les écrans de consultation), par intention : ce
// sur quoi on travaille, ce qu'on consulte, puis l'aide et les réglages. Statistiques et Dépenses avaient jusque-là
// pour seul chemin une tuile de l'accueil — et celle des Dépenses ne s'affiche même que
// s'il existe au moins un achat, ce qui laissait l'écran inatteignable sur une app neuve.
// Le Guide, lui, DÉMÉNAGE d'À propos : une seule porte d'entrée, pas deux.
// `{ sep: true }` est un séparateur décoratif, pas une entrée : il n'est ni focalisable
// ni annoncé par un lecteur d'écran.
const items = [
  { name: 'home', label: 'nav.home' },
  { name: 'stash', label: 'nav.stash' },
  { name: 'library', label: 'nav.library' },
  { name: 'stats', label: 'nav.stats' },
  { name: 'sessions', label: 'nav.sessions' },
  { name: 'expenses', label: 'nav.expenses' },
  { sep: true },
  { name: 'guide', label: 'nav.guide' },
  { name: 'settings', label: 'nav.settings' },
  { name: 'about', label: 'nav.about' },
]

function go(name) {
  open.value = false
  router.push({ name })
}
</script>

<template>
  <header class="hdr">
    <button v-if="back" class="hdr__back" :aria-label="t('common.back')" @click="goBack"><AppIcon name="chevronLeft" :size="24" /></button>
    <h1 class="hdr__title">{{ title }}</h1>
    <button
      ref="triggerRef"
      class="hdr__burger"
      :aria-label="t('nav.menu')"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AppIcon name="list" :size="22" />
    </button>

    <Transition name="menu">
      <nav v-if="open" ref="menuRef" class="menu">
        <template v-for="(it, i) in items" :key="it.name || `sep-${i}`">
          <hr v-if="it.sep" class="menu__sep" aria-hidden="true" />
          <button v-else class="menu__item" @click="go(it.name)">{{ t(it.label) }}</button>
        </template>
      </nav>
    </Transition>
    <div v-if="open" class="menu__scrim" @click="open = false"></div>
  </header>
</template>

<style scoped>
.hdr {
  /* Collant : le burger (navigation) reste toujours accessible au scroll. */
  position: sticky;
  top: 0;
  z-index: 40;
  /* Fond opaque : le contenu passe sous le header sans transparence au scroll. */
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: max(var(--sp-4), var(--sa-top)) max(var(--sp-4), var(--sa-right)) var(--sp-4)
    max(var(--sp-4), var(--sa-left));
  max-width: var(--w-content);
  margin: 0 auto;
}
.hdr__title {
  flex: 1;
  font-size: 23px;
}
.hdr__back,
.hdr__burger {
  flex-shrink: 0;
  border: 1px solid var(--line);
  background: var(--tile);
  color: var(--ink);
  width: 44px;
  height: 44px;
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
}
.hdr__back:active,
.hdr__burger:active {
  box-shadow: var(--clay-press);
  transform: scale(0.97);
}
.hdr__burger {
  font-size: 20px;
}
.hdr__back {
  font-size: 24px;
  line-height: 1;
}
.menu {
  position: absolute;
  top: calc(60px + var(--sa-top));
  right: max(var(--sp-4), var(--sa-right));
  z-index: 60;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--e-3);
  padding: var(--sp-2);
  min-width: 200px;
  /* Huit entrées ne tiennent plus sur un téléphone TOURNÉ (640×360) : 8 × 44 px + le
     séparateur + les marges dépassent la hauteur disponible sous le bandeau. Le panneau
     se borne donc à ce qui reste sous lui et défile en interne, plutôt que de sortir de
     l'écran par le bas — où les dernières entrées seraient inatteignables : `.menu` est
     en `position: absolute` dans un bandeau `sticky`, donc faire défiler la PAGE ne les
     remonte pas, et le voile (`.menu__scrim`) referme le menu au moindre appui.
     DOUBLET vh/dvh, même motif que `html, body, #app` dans tokens.css : la WebView du
     Huawei (sans GMS, < Chromium 108) ignore `dvh`, et un `calc()` qui contient une unité
     inconnue est INVALIDE — la déclaration entière serait abandonnée, `overflow-y` ne
     s'engagerait jamais et la borne disparaîtrait sur l'appareil même qui en a besoin.
     Cette WebView-là garde donc la 1re ligne (`vh`) ; les modernes gardent la 2de (`dvh`),
     seule à tenir compte de la barre d'adresse rétractable, qui rend `vh` plus grand que
     le visible et rétablirait le débordement qu'on corrige ici.
     `--sa-bottom` est déduit lui aussi : sur un appareil à barre de gestes, la dernière
     entrée passerait sinon sous l'encoche basse. */
  max-height: calc(100vh - 60px - var(--sa-top) - var(--sa-bottom) - var(--sp-4));
  max-height: calc(100dvh - 60px - var(--sa-top) - var(--sa-bottom) - var(--sp-4));
  overflow-y: auto;
  /* Le défilement interne ne doit pas entraîner la page derrière une fois arrivé au bout. */
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
}
.menu__item {
  text-align: left;
  /* Un bouton de menu ne doit pas s'écraser quand le panneau défile. */
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  padding: 12px 14px;
  border-radius: var(--r-sm);
}
.menu__item:active {
  background: var(--surface);
}
.menu__sep {
  border: none;
  border-top: 1px solid var(--line);
  margin: var(--sp-2) var(--sp-2);
  /* Un <hr> ne rétrécit pas dans un conteneur défilant sans ça. */
  flex-shrink: 0;
}
.menu__scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
}
.menu-enter-active,
.menu-leave-active {
  transition: all var(--motion-fast);
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
