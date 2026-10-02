// Contenu pur de la notification du rang en cours (aucun accès natif ni DOM ici).
import {
  withStepIds,
  currentStep,
  nextStepAfter,
  stepPosition,
  chartBefore,
  repeatTotal,
  countText,
  stepPlainText,
  sectionTitleLabel,
} from './reader'

const always = () => true

// Texte brut d'une étape, suivi de sa cadence (« tous les 4 rangs ») quand c'est un compteur
// à cadence (`step.every`) : sur sa propre ligne comme dans le lecteur (`bigText`), ou après
// une virgule (`oneLine`, texte de la notification repliée, qui n'affiche qu'une ligne).
function stepText(step, size, t, oneLine = false) {
  const text = stepPlainText(step, size)
  if (!step.every) return text
  return `${text}${oneLine ? ', ' : '\n'}${t('reader.cadenceEvery', { every: step.every })}`
}

// Ligne « Ensuite » vers `target` ({ step, section }), vue depuis la section `from`.
function nextLine(target, from, size, t) {
  const text = stepText(target.step, size, t)
  return target.section === from
    ? t('rowNotif.next', { text })
    : t('rowNotif.nextIn', { section: sectionTitleLabel(target.section, t), text })
}

// `state` : { size, done, counters, chartRows, chartAcks, isChartVisible }. `chartAcks` : ids
// des diagrammes acquittés (Set ou tableau) ; `isChartVisible(section)` : règle de taille du
// lecteur (défaut : toujours visible). Retourne null quand aucune étape suivie ne reste (tout
// fait, ou aucune étape suivie) : l'appelant annule alors la notification.
// `kind` : 'row' (rang à cocher), 'counter' (compteur à incrémenter ou décrémenter), 'chart' (rappel d'un
// diagramme franchi juste avant l'étape en cours). `stepId` : l'étape visée par le bouton.
export function buildRowNotification({ project, reader, state, t }) {
  const sections = withStepIds(reader?.sections || [])
  const size = typeof state?.size === 'number' ? state.size : null
  const done = state?.done || {}
  const counters = state?.counters || {}
  const chartRows = state?.chartRows || {}
  const acks = new Set(state?.chartAcks || [])
  const isChartVisible = state?.isChartVisible || always
  const progress = { size, done, counters, last: state?.last }

  const cur = currentStep(sections, progress)
  if (!cur) return null

  const common = {
    projectId: Number(project.id),
    subText: project.name,
    channelName: t('rowNotif.channel'),
    closedTitle: t('rowNotif.closedTitle'),
    closedText: t('rowNotif.closedText'),
    // Annonce « appui retenu » (processus mort) : le natif remplace la notification avec
    // ces libellés quand un bouton est pressé sans lecteur pour écrire (spec
    // 2026-09-30-notification-appui-attente).
    pendingTitle: t('rowNotif.pendingTitle'),
    pendingText: t('rowNotif.pendingText'),
  }

  const chart = chartBefore(sections, cur.step.id, isChartVisible, size)
  if (chart && !acks.has(chart.step.id)) {
    const grid = chart.section.chart || reader?.chart || null
    const rows = Number(grid?.rows) || 0
    // Position par défaut au rang 1, comme le lecteur (`st.chartRows[secId] || 1`).
    const row = chartRows[chart.section.id] || 1
    const text = rows > 0 ? t('rowNotif.chartRow', { row, rows }) : t('rowNotif.chartText')
    return {
      ...common,
      kind: 'chart',
      stepId: chart.step.id,
      title: t('rowNotif.chartTitle', { section: sectionTitleLabel(chart.section, t) }),
      text,
      bigText: `${text}\n\n${nextLine(cur, chart.section, size, t)}`,
      actionLabel: t('rowNotif.chartDone'),
    }
  }

  const text = stepText(cur.step, size, t, true)
  const body = stepText(cur.step, size, t)
  const next = nextStepAfter(sections, progress, cur.step.id)
  const bigText = next ? `${body}\n\n${nextLine(next, cur.section, size, t)}` : body
  const section = sectionTitleLabel(cur.section, t)

  if (cur.step.repeat) {
    const count = Math.min(counters[cur.step.id] || 0, repeatTotal(cur.step, size))
    // Sans taille choisie, toutes les tailles, comme le texte (« 3/8 (10) »).
    const total = countText(cur.step.total || [], size)
    return {
      ...common,
      kind: 'counter',
      stepId: cur.step.id,
      title: t('rowNotif.counterTitle', { count, total, section }),
      text,
      bigText,
      // Stepper de la vue sur mesure (moins, « Répétition k / N », plus) : remplace le bouton
      // d'action ; `title` et `text` restent pour l'écran de verrouillage.
      counter: {
        label: t('rowNotif.counterLabel', { count, total }),
        section,
        canMinus: count > 0,
        minusLabel: t('reader.repeatMinus'),
        plusLabel: t('reader.repeatPlus'),
      },
    }
  }

  const { index, total } = stepPosition(cur.section, cur.step.id, size)
  return {
    ...common,
    kind: 'row',
    stepId: cur.step.id,
    title: t('rowNotif.title', { index, total, section }),
    text,
    bigText,
    actionLabel: t('rowNotif.check'),
  }
}

// Décide où mener un appui sur la notification : la route du lecteur du projet, ou null s'il
// n'y a rien à faire (pas d'id, projet inconnu, lecteur de ce projet déjà à l'écran).
export function rowNotificationTarget(projectId, currentRoute, projectExists) {
  if (projectId === null || projectId === undefined || !projectExists) return null
  const id = String(projectId)
  if (currentRoute?.name === 'project-read' && String(currentRoute.params?.id) === id) return null
  return { name: 'project-read', params: { id } }
}

// Une cible en attente peut être appliquée : démarrage fini, onboarding fait, aucun message
// de la file (porte, garde-fou, décision) ne tient l'écran.
export function canApplyPendingRowTarget({ startupDone, onboarded, activeNotice }) {
  return !!startupDone && !!onboarded && (activeNotice === null || activeNotice === undefined)
}
