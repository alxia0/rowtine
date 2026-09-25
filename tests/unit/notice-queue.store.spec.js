// Unitaire — la file des messages (spec 19/08/2026, §4.1).
//
// Ce n'est PAS un verrou : un demandeur refusé n'est jamais abandonné. Le magasin tient
// l'ensemble des demandeurs et calcule qui a la parole. Quand le plus fort se retire, le
// suivant prend la parole tout seul, sans que personne ait à réessayer.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { NOTICE, NOTICE_RANKS } from '@/constants/notice-queue'
import { useNoticeQueueStore } from '@/stores/notice-queue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('file des messages', () => {
  it('G1 — deux demandeurs, UN SEUL identifiant actif', () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.WELCOME)
    q.request(NOTICE.SWIPE_HINT)

    // PRÉCONDITION : la situation testée existe vraiment — il y a bien DEUX demandeurs.
    // Sans elle, un magasin qui n'enregistre rien passerait ce test.
    expect(q.requesters).toHaveLength(2)

    // Ce qui est prouvé : `active` est UN identifiant, jamais une collection.
    expect(typeof q.active).toBe('string')
    expect(q.active).toBe(NOTICE.WELCOME)
  })

  it('G2 — le rang décide QUI gagne, pas l ordre des demandes', () => {
    const q = useNoticeQueueStore()
    // Demandés dans l'ordre INVERSE du rang : le faible d'abord.
    q.request(NOTICE.SWIPE_HINT)
    q.request(NOTICE.VERSION_GUARD)

    // PRÉCONDITION : les deux sont demandeurs, et leurs rangs sont bien distincts.
    expect(q.requesters).toHaveLength(2)
    expect(NOTICE_RANKS[NOTICE.VERSION_GUARD]).toBeLessThan(NOTICE_RANKS[NOTICE.SWIPE_HINT])

    // Ce qui est prouvé : le vainqueur est NOMMÉ. « un message est rendu » ne suffirait pas.
    expect(q.active).toBe(NOTICE.VERSION_GUARD)
  })

  it('G3 — le retrait du plus fort rend la parole au suivant', () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)
    q.request(NOTICE.WELCOME)

    // PRÉCONDITION : avant le retrait, le fort a bien la parole ET le faible attend.
    expect(q.active).toBe(NOTICE.FOLDER_GATE)
    expect(q.requesters).toContain(NOTICE.WELCOME)

    q.withdraw(NOTICE.FOLDER_GATE)

    expect(q.active).toBe(NOTICE.WELCOME)
  })

  it('withdraw est idempotent et ne lève jamais', () => {
    const q = useNoticeQueueStore()
    expect(() => q.withdraw(NOTICE.WELCOME)).not.toThrow()
    q.request(NOTICE.WELCOME)
    q.withdraw(NOTICE.WELCOME)
    q.withdraw(NOTICE.WELCOME)
    expect(q.active).toBe(null)
  })

  it('sans aucun demandeur, active vaut null', () => {
    expect(useNoticeQueueStore().active).toBe(null)
  })

  it('une demande en double ne compte qu une fois', () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.WELCOME)
    q.request(NOTICE.WELCOME)
    expect(q.requesters).toHaveLength(1)
  })

  it('un identifiant inconnu LÈVE — un message qui ne s afficherait jamais est un bug', () => {
    const q = useNoticeQueueStore()
    expect(() => q.request('bidon')).toThrow()
  })

  it('la liste exposée est une COPIE : y écrire ne change pas la file', () => {
    // C'est ce qui ferme la seule porte par laquelle un identifiant inconnu pourrait
    // entrer sans passer par `request()`. Un inconnu dans la file rendrait `active`
    // incohérent en silence — et si l'inconnu arrivait en premier, PLUS AUCUN message ne
    // s'afficherait de toute la session.
    const q = useNoticeQueueStore()
    q.request(NOTICE.WELCOME)

    q.requesters.push('bidon')

    expect(q.requesters).toEqual([NOTICE.WELCOME])
    expect(q.active).toBe(NOTICE.WELCOME)
  })

  it('les huit messages ont un rang, tous distincts', () => {
    const ids = Object.values(NOTICE)
    expect(ids).toHaveLength(8)
    const rangs = ids.map((id) => NOTICE_RANKS[id])
    expect(rangs.every((r) => Number.isInteger(r))).toBe(true)
    expect(new Set(rangs).size).toBe(8)
  })
})
