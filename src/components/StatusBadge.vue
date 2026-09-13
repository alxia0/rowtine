<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { STATUS_ORDER, STATUS_META } from '@/constants/status'
import { useDismissMenu } from '@/composables/useDismissMenu'

const props = defineProps({
  status: { type: String, default: 'wip' },
  editable: { type: Boolean, default: false },
  // Alignement du menu popover : 'right' (par défaut) ouvre vers la gauche depuis
  // le bord droit du badge (cas ProjectCard, badge en haut à droite) ; 'left' ouvre
  // vers la droite depuis le bord gauche (cas ProjectDetailView, badge en début d'écran).
  menuAlign: { type: String, default: 'right' },
})
const emit = defineEmits(['change'])
const { t } = useI18n()
const meta = computed(() => STATUS_META[props.status] || STATUS_META.wip)

// Popover de sélection rapide (uniquement en mode éditable) : même mécanique que les
// autres menus déroulants de l'app (kebab de ProjectDetailView).
const { open, triggerRef, menuRef } = useDismissMenu()
function select(s) {
  open.value = false
  if (s !== props.status) emit('change', s)
}
</script>

<template>
  <!-- Racine unique (nécessaire pour l'héritage d'attrs/class du parent, ex. positionnement
  du badge dans ProjectCard) : on branche le contenu selon `editable` à l'intérieur. -->
  <span class="badge-wrap">
    <button
      v-if="editable"
      ref="triggerRef"
      type="button"
      class="badge badge--editable"
      :style="{ '--c': meta.color }"
      :aria-label="t('project.changeStatus')"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="open = !open"
    >{{ t(meta.labelKey) }}</button>
    <span v-else class="badge" :style="{ '--c': meta.color }">{{ t(meta.labelKey) }}</span>
    <template v-if="editable">
      <Transition name="menu">
        <nav
          v-if="open"
          ref="menuRef"
          :class="['menu', menuAlign === 'left' ? 'menu--left' : 'menu--right']"
        >
          <button
            v-for="s in STATUS_ORDER"
            :key="s"
            type="button"
            class="menu__item"
            :class="{ 'menu__item--on': s === status }"
            :aria-current="s === status ? 'true' : null"
            @click="select(s)"
          >
            <span class="menu__dot" :style="{ '--c': STATUS_META[s].color }"></span>
            {{ t(STATUS_META[s].labelKey) }}
          </button>
        </nav>
      </Transition>
      <div v-if="open" class="menu__scrim" @click="open = false"></div>
    </template>
  </span>
</template>

<style scoped>
.badge-wrap {
  position: relative;
  display: inline-flex;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--c);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  padding: 3px 10px;
  white-space: nowrap;
}
.badge::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
  flex-shrink: 0;
}
.badge--editable {
  cursor: pointer;
}
.badge--editable:active {
  box-shadow: var(--clay-press);
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 60;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--e-3);
  padding: var(--sp-2);
  min-width: 160px;
  display: flex;
  flex-direction: column;
}
.menu--right {
  right: 0;
}
.menu--left {
  left: 0;
}
.menu__item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  text-align: left;
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  white-space: nowrap;
}
.menu__item--on {
  background: var(--surface);
}
.menu__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
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
