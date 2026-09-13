<script setup>
// La ligne de progression des opérations de dossier.
// Rendu UNIQUE de `syncProgress` : les deux points d'appel (Réglages, invite de dossier
// du 1er lancement) montent ce composant plutôt que de redessiner chacun leur barre.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { syncProgress } from '@/backup/progress'

const { t, locale } = useI18n()

// `owner` (première revue ; correctif de commentaire) : distingue QUI
// a ouvert l'opération en cours. `syncProgress` est un état global unique ; sans ce
// filtre, une restauration lancée depuis le bandeau de décision (`BackupDecisionPrompt`,
// qui monte sa PROPRE instance de ce composant sous ses boutons, owner="app") ferait
// apparaître DEUX barres si les Réglages sont ouverts en même temps (celle des
// Réglages ET celle du bandeau, toutes deux montées, toutes deux lisant le même
// `syncProgress.active`). En ne rendant que l'instance dont l'`owner` correspond à
// celui qui a ouvert l'opération (`beginSyncProgress(phase, owner)`), une seule des
// deux s'affiche jamais.
const props = defineProps({
  owner: { type: String, default: 'inline' },
})

const visible = computed(() => syncProgress.active && syncProgress.owner === props.owner)

// `total` vaut 0 pendant la phase d'écriture et au tout premier événement : la barre
// reste alors à 0 % plutôt que de produire un NaN dans le style.
const pct = computed(() =>
  syncProgress.total > 0 ? Math.round((syncProgress.done / syncProgress.total) * 100) : 0,
)

const label = computed(() => {
  if (syncProgress.phase === 'backup') {
    return t('saf.progressBackup', {
      done: syncProgress.done,
      total: syncProgress.total,
      written: syncProgress.written,
    })
  }
  if (syncProgress.phase === 'read') {
    // `current` (nom du dossier en cours d'import) : vide au report initial et hors
    // restauration → libellé chiffré seul ; non vide → « Lecture… 12 sur 24 — <nom> »,
    // pour que le délai se voie comme du travail sur un élément nommé.
    // Avec une sous-barre vivante : le fichier EN COURS est nommé aussi, et
    // les Mo du dossier donnent l'échelle du reste à faire.
    if (sub.value) {
      return t('saf.progressReadFile', {
        done: syncProgress.done,
        total: syncProgress.total,
        current: syncProgress.current,
        file: sub.value.file,
        subDone: fmtMo(sub.value.done),
        subTotal: fmtMo(sub.value.total),
      })
    }
    return syncProgress.current
      ? t('saf.progressReadCurrent', {
          done: syncProgress.done,
          total: syncProgress.total,
          current: syncProgress.current,
        })
      : t('saf.progressRead', { done: syncProgress.done, total: syncProgress.total })
  }
  return t('saf.progressWrite')
})

// Sous-barre du dossier EN COURS : elle vit à la cadence des TRANCHES
// (~0,5-2 s), là où la piste principale ne bouge qu'au dossier suivant — c'est elle
// qui répond à « j'ai cru qu'il avait planté ». Masquée si `sub` est absente ou sans
// total exploitable (fournisseur SAF aveugle : DocumentFile.length() rend 0, on se
// replie sur le libellé `current` seul au lieu d'afficher une progression inventée —
// et une division par 0 ne peut plus produire de NaN).
const sub = computed(() =>
  syncProgress.sub && syncProgress.sub.total > 0 ? syncProgress.sub : null,
)

const subPct = computed(() =>
  sub.value ? Math.round((sub.value.done / sub.value.total) * 100) : 0,
)

// Mo arrondis à 0,1, formatés À LA LOCALE (virgule française, point anglais) — les
// « 0,0 » des petits fichiers sont assumés (simple > joli). L'UNITÉ, elle, vit dans
// la clé i18n (Mo/MB par langue), jamais ici.
const fmtMo = (octets) =>
  new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    octets / (1024 * 1024),
  )

// Annonce de NIVEAU PHASE pour les lecteurs d'écran (première revue).
// `report?.()` (orchestrator.js) est appelé PAR FICHIER ÉCRIT, pas par entrée : sur
// 33 Mo, `label` change des centaines de fois. Si ce texte chiffré était dans la
// région `aria-live`, chaque changement mettrait une annonce en file — inutilisable.
// Cette phrase, elle, ne change qu'aux transitions de phase ('backup' → syncBusy,
// 'read'/'write', deux phases d'une même restauration → restoreBusy) : c'est donc
// elle, et SEULE elle, qui doit vivre dans la région `aria-live`.
const phaseAnnouncement = computed(() =>
  syncProgress.phase === 'backup' ? t('saf.syncBusy') : t('saf.restoreBusy'),
)
</script>

<template>
  <div
    v-if="visible"
    class="sync-progress mt"
    data-test="sync-progress"
    role="status"
    aria-live="polite"
  >
    <div class="sync-progress__track">
      <div
        class="sync-progress__bar"
        data-test="sync-progress-bar"
        :style="{ width: pct + '%' }"
      ></div>
    </div>
    <!-- Sous-piste du dossier en cours : fine, même style que la principale,
         SOUS elle — la principale dit où on en est de l'ensemble, celle-ci dit que le
         dossier en cours travaille, à la cadence des tranches. -->
    <div v-if="sub" class="sync-progress__subtrack" data-test="sync-progress-subtrack">
      <div
        class="sync-progress__subbar"
        data-test="sync-progress-subbar"
        :style="{ width: subPct + '%' }"
      ></div>
    </div>
    <!-- Visible à l'écran mais EXCLU de l'arbre d'accessibilité : c'est le texte
         chiffré qui change par fichier écrit (cf. commentaire de `phaseAnnouncement`
         ci-dessus). -->
    <p class="sync-progress__label" aria-hidden="true">{{ label }}</p>
    <!-- Announced-only : présent dans l'arbre d'accessibilité, invisible à l'écran.
         Seul contenu de la région `aria-live` — ne change qu'aux transitions de phase. -->
    <span class="sr-only">{{ phaseAnnouncement }}</span>
  </div>
</template>

<style scoped>
.sync-progress { margin-top: var(--sp-3); }
.sync-progress__track {
  height: 6px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.sync-progress__bar {
  height: 100%;
  background: var(--brand);
  border-radius: 999px;
  transition: width 200ms linear;
}
/* Sous-piste du dossier en cours : 3 px — un détail visuel, pas un second
   message ; même langage graphique que la principale, légèrement en retrait. */
.sync-progress__subtrack {
  height: 3px;
  margin-top: var(--sp-1);
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
  opacity: 0.7;
}
.sync-progress__subbar {
  height: 100%;
  background: var(--brand);
  border-radius: 999px;
  transition: width 200ms linear;
}
.sync-progress__label {
  margin-top: var(--sp-2);
  font-size: 12.5px;
  color: var(--ink-55);
  /* Un nom de dossier long ne doit jamais renvoyer à la ligne (la ligne danserait
     dans la modale) : pointillés au-delà de la largeur disponible. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
