// Guide, figures agrandissables (lot du 11/08, §6) — LE CAS D'UNE FIGURE DONT LA
// CAPTURE N'EXISTE PAS ENCORE.
//
// Pourquoi un fichier à part : la garde ne peut se mesurer qu'en faisant MENTIR le résolveur
// d'images (`guideImagesFor`), donc avec un `vi.mock` de portée fichier — GuideView.spec.js,
// lui, doit continuer d'exercer les VRAIES images (c'est lui qui vérifie la bascule de thème).
//
// Le trou n'est pas théorique : le contenu du guide cite les cinq nouvelles captures de ce lot
// AVANT que les fichiers .webp soient produits (en deux temps). Pendant cette
// fenêtre, `images[block.src]` vaut `undefined` pour ces noms-là.
//
// Ce qui casserait sans la garde : `lightbox.show()` fait `.filter(Boolean)` sur le tableau
// qu'on lui donne. Une liste non filtrée avec un trou est donc COMPACTÉE en silence par le
// store, tandis qu'un index compté sur les blocs image d'origine ne l'est pas — chaque figure
// après le trou ouvrirait la capture SUIVANTE. C'est exactement ce que ce test attrape.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import { useLightboxStore } from '@/stores/lightbox'
import guideFr from '@/generated/guide-content.fr.json'

const resolveur = vi.hoisted(() => ({ fn: () => ({}) }))
vi.mock('@/content/guide/images', () => ({
  guideImagesFor: (...args) => resolveur.fn(...args),
}))

// Depuis le lot du 19/08/2026 (« le guide s'ouvre sur une section »), GuideView.vue appelle
// `useRoute()` au montage pour lire `route.query.section` — voir le même mock, avec la même
// justification, dans GuideView.spec.js. Sans lui, `route.query.section` lève sur `undefined`
// à chaque montage de ce fichier (aucun routeur n'est installé ci-dessous non plus).
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

// Importé APRÈS les mocks (hissés par Vitest) pour que la vue consomme bien le faux résolveur.
const GuideView = (await import('@/views/GuideView.vue')).default

// Section de référence : la première du guide portant au moins TROIS figures. À deux figures,
// retirer la première ne laisserait qu'un bouton et la question de l'index ne se poserait plus.
const blocsImageParSection = guideFr.sections.map((s) => s.blocks.filter((b) => b.type === 'image'))
const I_SECTION = blocsImageParSection.findIndex((imgs) => imgs.length >= 3)
const BLOCS = blocsImageParSection[I_SECTION]
const NOM_ABSENT = BLOCS[0].src // la PREMIÈRE figure de la section n'a pas de capture

function faussesImages() {
  const map = {}
  for (const bloc of blocsImageParSection.flat()) {
    if (bloc.src === NOM_ABSENT) continue // capture pas encore produite
    map[bloc.src] = `/faux/${bloc.src}.webp`
  }
  return map
}

beforeEach(() => {
  resolveur.fn = () => faussesImages()
})

function mountGuide() {
  i18n.global.locale.value = 'fr'
  return mount(GuideView, {
    global: { plugins: [createTestingPinia({ stubActions: false }), i18n], stubs: { AppHeader: true } },
  })
}

describe('GuideView — une figure sans capture ne décale pas les autres', () => {
  it('la section garde une <img> par bloc, mais un bouton EN MOINS (la figure sans capture ne promet pas un agrandissement)', () => {
    expect(I_SECTION).toBeGreaterThanOrEqual(0)
    const section = mountGuide().findAll('.section')[I_SECTION]
    expect(section.findAll('img')).toHaveLength(BLOCS.length)
    expect(section.findAll('.figure__btn')).toHaveLength(BLOCS.length - 1)
  })

  it('toucher une figure située APRÈS le trou ouvre bien CETTE capture, pas la suivante', async () => {
    const wrapper = mountGuide()
    const lightbox = useLightboxStore()
    const section = wrapper.findAll('.section')[I_SECTION]

    // La figure visée est désignée par SA PROPRE capture, jamais par un rang de bouton : un
    // décalage d'un cran change aussi le nombre de boutons rendus, et un test qui dirait
    // « le premier bouton » pourrait alors tomber juste par accident (mesuré).
    const attendue = `/faux/${BLOCS[2].src}.webp`
    const bouton = section.findAll('.figure__btn').find((b) => b.find('img').attributes('src') === attendue)
    expect(bouton, `aucun bouton ne porte ${attendue}`).toBeTruthy()
    await bouton.trigger('click')

    expect(lightbox.open).toBe(true)
    expect(lightbox.photos).toHaveLength(BLOCS.length - 1) // le trou n'est pas dans la liste
    // L'invariant : la visionneuse montre LA capture qu'on a touchée.
    expect(lightbox.current).toBe(attendue)
    expect(lightbox.index).toBe(1) // position DANS LA LISTE FILTRÉE, pas le rang du bloc (2)
  })
})
