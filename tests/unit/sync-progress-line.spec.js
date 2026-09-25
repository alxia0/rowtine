// @vitest-environment jsdom
// Unitaire — la ligne de progression (spec 2026-08-04, §4.3/§4.4).
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SyncProgressLine from '@/components/SyncProgressLine.vue'
import { syncProgress, beginSyncProgress, endSyncProgress } from '@/backup/progress'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
const mountLine = (owner) =>
  mount(SyncProgressLine, { props: owner ? { owner } : {}, global: { plugins: [i18n] } })

afterEach(() => {
  endSyncProgress()
})

describe('SyncProgressLine', () => {
  it("n'affiche rien tant qu'aucune opération demandée n'est en cours", () => {
    const wrapper = mountLine()
    expect(wrapper.find('[data-test="sync-progress"]').exists()).toBe(false)
  })

  it('affiche les deux chiffres de la sauvegarde', async () => {
    const report = beginSyncProgress('backup')
    const wrapper = mountLine()
    report({ phase: 'backup', done: 3, total: 12, written: 42 })
    await wrapper.vm.$nextTick()

    const text = wrapper.find('[data-test="sync-progress"]').text()
    expect(text).toContain('3')
    expect(text).toContain('12')
    expect(text).toContain('42')
  })

  it('affiche la progression de lecture pendant une restauration', async () => {
    const report = beginSyncProgress('read')
    const wrapper = mountLine()
    report({ phase: 'read', done: 2, total: 7 })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="sync-progress"]').text()).toContain('2')
    expect(wrapper.find('[data-test="sync-progress"]').text()).toContain('7')
  })

  it('phase read AVEC un courant : affiche ce qui est en train d\'être importé (progressReadCurrent)', async () => {
    const report = beginSyncProgress('read')
    const wrapper = mountLine()
    report({ phase: 'read', done: 12, total: 24, current: 'Marisol Shawl' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sync-progress__label').text()).toBe(tk('saf.progressReadCurrent', { done: 12, total: 24, current: 'Marisol Shawl' }))
  })

  it('phase read SANS courant (report initial ou finally) : libellé inchangé (progressRead)', async () => {
    const report = beginSyncProgress('read')
    const wrapper = mountLine()
    report({ phase: 'read', done: 2, total: 7, current: '' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sync-progress__label').text()).toBe(tk('saf.progressRead', { done: 2, total: 7 }))

    report({ phase: 'read', done: 3, total: 7, current: undefined })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sync-progress__label').text()).toBe(tk('saf.progressRead', { done: 3, total: 7 }))
  })

  // Sous-barre du dossier en cours : une seconde piste fine, sous la
  // principale, qui vit à la cadence des TRANCHES ; le libellé nomme le fichier en
  // cours et les Mo du dossier (une décimale, à la locale — virgule française).
  it('phase read AVEC sub : seconde piste rendue, dimensionnée en %, et libellé avec fichier et Mo', async () => {
    const report = beginSyncProgress('read')
    const wrapper = mountLine()
    // 0,5 Mo lus sur 8,9 Mo (524 288 / 9 332 326 octets) — l'ordre de grandeur du
    // retour terrain (marisol-shawl, ~8 Mo figés 10-25 s).
    report({
      phase: 'read',
      done: 12,
      total: 24,
      current: 'Marisol Shawl',
      sub: { file: 'patron.json', done: 524288, total: 9332326 },
    })
    await wrapper.vm.$nextTick()

    // La sous-piste : 524288 / 9332326 ≈ 5,6 % → 6 %.
    expect(wrapper.find('[data-test="sync-progress-subbar"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="sync-progress-subbar"]').attributes('style')).toContain('6%')
    expect(wrapper.find('.sync-progress__label').text()).toBe(
      tk('saf.progressReadFile', {
        done: 12, total: 24, current: 'Marisol Shawl', file: 'patron.json', subDone: '0,5', subTotal: '8,9',
      }),
    )
  })

  it('sub annulée (null) : la seconde piste disparaît, repli propre sur le libellé dossier seul', async () => {
    const report = beginSyncProgress('read')
    const wrapper = mountLine()
    report({
      phase: 'read',
      done: 1,
      total: 2,
      current: 'Marisol Shawl',
      sub: { file: 'patron.json', done: 10, total: 100 },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress-subbar"]').exists()).toBe(true)

    // Tailles inconnues (fournisseur SAF aveugle) : sub:null → plus de seconde piste,
    // plus de fichier nommé — jamais de progression inventée.
    report({ phase: 'read', done: 2, total: 2, current: 'Marisol Shawl', sub: null })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress-subbar"]').exists()).toBe(false)
    expect(wrapper.find('.sync-progress__label').text()).toBe(tk('saf.progressReadCurrent', { done: 2, total: 2, current: 'Marisol Shawl' }))
  })

  it('sub sans total exploitable (0) : traitée comme absente, jamais de division par zéro', async () => {
    const report = beginSyncProgress('read')
    const wrapper = mountLine()
    report({
      phase: 'read',
      done: 1,
      total: 2,
      current: 'Marisol Shawl',
      sub: { file: 'patron.json', done: 0, total: 0 },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress-subbar"]').exists()).toBe(false)
    expect(wrapper.find('.sync-progress__label').text()).toBe(tk('saf.progressReadCurrent', { done: 1, total: 2, current: 'Marisol Shawl' }))
  })

  it('largeur de barre proportionnelle, et jamais de division par zéro', async () => {
    const report = beginSyncProgress('backup')
    const wrapper = mountLine()
    report({ phase: 'backup', done: 0, total: 0, written: 0 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress-bar"]').attributes('style')).toContain('0%')

    report({ phase: 'backup', done: 3, total: 12, written: 5 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress-bar"]').attributes('style')).toContain('25%')
  })

  it('disparaît quand l\'opération se termine', async () => {
    beginSyncProgress('backup')
    const wrapper = mountLine()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress"]').exists()).toBe(true)

    endSyncProgress()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="sync-progress"]').exists()).toBe(false)
  })

  it('repart de zéro à chaque nouvelle opération (aucun résidu de la précédente)', async () => {
    const first = beginSyncProgress('backup')
    first({ phase: 'backup', done: 9, total: 10, written: 88 })
    endSyncProgress()

    beginSyncProgress('read')
    expect(syncProgress.done).toBe(0)
    expect(syncProgress.total).toBe(0)
    expect(syncProgress.written).toBe(0)
    expect(syncProgress.phase).toBe('read')
  })

  // Isolation par propriétaire (première passe de revue, finding 3) : `syncProgress` est un
  // état GLOBAL unique. Sans ce filtre, une restauration lancée depuis le bandeau de
  // App.vue (owner 'app') ferait apparaître DEUX barres si les Réglages (owner
  // 'inline') sont montés en même temps.
  describe('isolation par owner', () => {
    it("une barre owner=\"app\" ne s'affiche pas quand l'opération courante appartient à \"inline\"", async () => {
      const report = beginSyncProgress('read', 'inline')
      const appLine = mountLine('app')
      report({ phase: 'read', done: 1, total: 2 })
      await appLine.vm.$nextTick()

      expect(appLine.find('[data-test="sync-progress"]').exists()).toBe(false)
    })

    it("une barre owner=\"inline\" ne s'affiche pas quand l'opération courante appartient à \"app\"", async () => {
      const report = beginSyncProgress('read', 'app')
      const inlineLine = mountLine('inline')
      report({ phase: 'read', done: 1, total: 2 })
      await inlineLine.vm.$nextTick()

      expect(inlineLine.find('[data-test="sync-progress"]').exists()).toBe(false)
    })

    it('la barre du bon owner reste visible, seule', async () => {
      const report = beginSyncProgress('read', 'app')
      const appLine = mountLine('app')
      const inlineLine = mountLine('inline')
      report({ phase: 'read', done: 1, total: 2 })
      await appLine.vm.$nextTick()
      await inlineLine.vm.$nextTick()

      expect(appLine.find('[data-test="sync-progress"]').exists()).toBe(true)
      expect(inlineLine.find('[data-test="sync-progress"]').exists()).toBe(false)
    })
  })
})
