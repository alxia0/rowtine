// Parcours critique #3 — Session de tricot : chrono persistant + progression de rangs.
// Lot A : le suivi se fait maintenant via le lecteur de patron (/project/{id}/read)
// et non plus via la vue session (/project/{id}/section/{sectionId}).
// On part du projet démo lié à Bonnet Torsade seedé à l'onboarding.
//
// Lot « la séance visible dès la pause » (30/08) : le chrono est JOURNALISANT — chaque
// pause commet son temps au journal, la reprise décide fusion (dernier contact du projet
// < 2 h) ou split (épisode neuf, pastille à zéro). Le bloc « micro-séances » ci-dessous
// éprouve cette règle de bout en bout : (a) sortie de bulle puis retour rapide = UNE
// ligne au total cumulé ; (b) écart >= 2 h simulé par horloge falsifiée = DEUX lignes et
// pastille repartie à zéro ; (c) édition inline de la dernière ligne puis reprise = la
// fusion se fait quand même (l'écart se mesure au dernier contact `lastWriteAt`, pas à
// la date de naissance `date` de la ligne).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

// Entre dans le lecteur du projet démo « en cours » (Bonnet Torsade), éventuellement sous
// horloge falsifiée. `page.clock.install()` agit par script d'initialisation : elle ne
// touche que les documents À VENIR — elle doit donc précéder la toute première navigation
// du test. C'est pourquoi ce helper existe alors qu'un beforeEach suffisait : le test (b)
// falsifie l'horloge AVANT l'onboarding, ce qu'un beforeEach qui navigue déjà ne permet
// pas — d'où aussi les deux blocs ci-dessous, l'un au beforeEach, l'autre s'installant
// lui-même. Mesuré sur ce banc (sonde du 30/08, supprimée depuis) : après install(),
// l'horloge AVANCE EN TEMPS RÉEL (les attentes du test accumulent normalement du temps
// de tricot) ; seul fastForward() la déplace d'un bloc, et les timers prévus y tirent
// AU PLUS une fois — aucun déluge de callbacks.
async function ouvrirLecteurDemo(page, { horlogeFaussee = false } = {}) {
  if (horlogeFaussee) await page.clock.install()
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  // Le projet démo « en cours » (Bonnet Torsade) expose la section « Reprendre » sur l'accueil.
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  // Entrer dans le suivi lecteur.
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
}

// Lit la table `sessions` directement dans IndexedDB — même contournement délibéré que
// helpers.js (pas d'import du module app sous `vite preview`, les chemins y sont hashés).
// Ne sert ici qu'à ATTENDRE qu'un commit du chrono ait réellement touché le disque avant
// de falsifier l'horloge ou de naviguer : les assertions de fond, elles, lisent le texte
// rendu par l'interface, jamais la base.
async function lireSessions(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const rq = db.transaction('sessions', 'readonly').objectStore('sessions').getAll()
            rq.onsuccess = () => {
              resolve(rq.result)
              db.close()
            }
            rq.onerror = () => {
              reject(rq.error)
              db.close()
            }
          } catch (e) {
            reject(e)
            db.close()
          }
        }
      }),
  )
}

// « 2:05 » ou « 1:02:03 » -> secondes : comparer le temps RENDU (fmtDuration : m:ss sous
// l'heure, h:mm:ss au-delà) à un plancher sans dépendre du format choisi par la vue.
function dureeRendue(texte) {
  return String(texte).trim().split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
}

test.describe('chrono persistant (rechargements, navigation)', () => {
  test.beforeEach(async ({ page }) => {
    await ouvrirLecteurDemo(page)
  })

  test('avancer d’une étape persiste après rechargement', async ({ page }) => {
    // La progression démarre à 0 %.
    await expect(page.locator('.rhdr__pct')).toHaveText('0 %')

    // Cocher la première étape.
    await page.locator('.rcheck').first().click()
    await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
    await expect(page.locator('.rhdr__pct')).not.toHaveText('0 %')

    // Laisse la transaction IndexedDB se valider avant de recharger.
    await page.waitForTimeout(300)
    await page.reload()

    // L'état est restauré depuis IndexedDB.
    await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
    await expect(page.locator('.rhdr__pct')).not.toHaveText('0 %')
  })

  test('le chrono démarré reste actif après un rechargement', async ({ page }) => {
    await expect(page.locator('.chrono-fab')).toBeVisible()

    await page.locator('.chrono-fab__body').click() // démarre le chrono

    // Laisse filer ~1,5 s pour accumuler du temps, puis recharge.
    await page.waitForTimeout(1500)
    await page.reload()

    // Le chrono persistant est restauré « en marche » :
    // .chrono-fab--idle est absent quand active.running est true (ReaderView.vue :430).
    await expect(page.locator('.chrono-fab')).toBeVisible()
    await expect(page.locator('.chrono-fab')).not.toHaveClass(/chrono-fab--idle/)
  })

  test('le chrono poursuit vers la fiche, et quitter le projet enregistre la session', async ({ page }) => {
    await page.locator('.chrono-fab__body').click() // démarre le chrono
    await page.waitForTimeout(1100)
    // Retour vers la fiche projet : MÊME projet, la séance poursuit (lot « chrono unifié »,
    // 2026-08-30 — l'ancien « le back enregistre la session » fermerait là où rien ne s'arrête).
    await page.locator('.rhdr__back').click()
    await expect(page).toHaveURL(/\/project\/\d+/)
    await expect(page).not.toHaveURL(/\/read/)
    await expect(page.getByText(/Temps enregistré/)).toBeHidden()
    // Quitter le PROJET (retour vers l'accueil) : le garde « sortie de bulle » ferme la
    // séance, l'enregistre et le signale.
    await page.locator('.phdr__back').click()
    await expect(page.getByText(/Temps enregistré/)).toBeVisible()
    await expect(page).toHaveURL('/')
  })
})

test.describe('micro-séances : fusion, split, édition inline', () => {
  test('sortie de bulle puis retour immédiat : UNE seule ligne, total cumulé', async ({ page }) => {
    await ouvrirLecteurDemo(page)
    // Premier passage : ~1,6 s de tricot (floor >= 1 s au journal), puis sortie de la
    // bulle du projet — le garde du routeur ferme la séance et la PAUSE COMMITTANTE a
    // déjà écrit la première ligne quand le snackbar apparaît.
    await page.locator('.chrono-fab__body').click() // démarre le chrono
    await page.waitForTimeout(1600)
    await page.locator('.rhdr__back').click() // vers la fiche : la séance POURSUIT (bulle)
    await expect(page).toHaveURL(/\/project\/\d+/)
    await page.locator('.phdr__back').click() // hors du projet : fermeture + signalement
    await expect(page).toHaveURL('/')
    await expect(page.getByText(/Temps enregistré/)).toBeVisible() // 1re ligne en base
    // Retour < 2 h : reprendre le suivi, relancer le chrono, le re-pauser.
    await page.locator('.resume').click()
    await expect(page).toHaveURL(/\/project\/\d+/)
    await page.getByRole('button', { name: /Suivre le patron/ }).click()
    await expect(page).toHaveURL(/\/project\/\d+\/read/)
    await page.locator('.chrono-fab__body').click() // reprise -> FUSION (dernier contact < 2 h)
    await page.waitForTimeout(1600)
    await page.locator('.chrono-fab__body').click() // pause -> le chunk rejoint LA MÊME ligne
    // Le commit cumulé doit avoir touché le disque avant qu'on ne lise l'onglet : la
    // durée de la ligne couvre les DEUX passages (>= 2 s), pas seulement le dernier.
    await expect
      .poll(async () => (await lireSessions(page))[0]?.durationSec ?? 0)
      .toBeGreaterThanOrEqual(2)
    // Onglet Séances : UNE seule ligne — la micro-séance du retour a fusionné dans la
    // première au lieu d'en créer une deuxième.
    await page.locator('.rhdr__back').click()
    await page.getByRole('tab', { name: /Sessions/ }).click()
    await expect(page.locator('.ses-row')).toHaveCount(1)
    const meta = await page.locator('.ses-row .ses-row__meta').first().textContent()
    expect(dureeRendue(meta)).toBeGreaterThanOrEqual(2)
    // La ligne est la CIBLE de l'épisode encore ouvert (en pause à CE projet) : le badge
    // « en pause » la désigne, preuve rendue que la fusion a visé la bonne ligne.
    await expect(page.locator('.ses-row .ses-live')).toHaveText('en pause')
  })

  test('pause, écart simulé de 2 h, reprise : DEUX lignes, pastille repartie à zéro', async ({ page }) => {
    await ouvrirLecteurDemo(page, { horlogeFaussee: true })
    // Épisode 1 : ~1,6 s de tricot, pause -> première ligne au journal.
    await page.locator('.chrono-fab__body').click() // démarre le chrono
    await page.waitForTimeout(1600)
    await page.locator('.chrono-fab__body').click() // pause COMMITTANTE
    // Attendre que cette écriture ait VRAIMENT touché le disque avant de sauter le
    // temps : un fastForward pendant la transaction horodaterait `lastWriteAt` APRÈS le
    // saut, l'écart mesuré à la reprise serait ~0 et la fusion se ferait à tort (échec
    // de test qui ne prouverait rien). Une table `sessions` vide à l'onboarding (aucun
    // seed de démo n'y écrit) fait de ce compte un témoin fiable du commit.
    await expect.poll(async () => (await lireSessions(page)).length).toBe(1)
    // L'écart : 2 h 05, marge franche sur la fenêtre de fusion de 2 h (le bord PILE est
    // déjà un split strict côté adoption). Personne n'attend 2 h réelles en e2e :
    // l'horloge FALSIFIÉE les fait passer d'un bloc, sans toucher une ligne de prod.
    await page.clock.fastForward(2 * 60 * 60 * 1000 + 5 * 60 * 1000)
    // Reprise : l'épisode est mort -> SPLIT, triplet remis à zéro.
    await page.locator('.chrono-fab__body').click()
    // La pastille est repartie DE ZÉRO : l'épisode vient de naître, le premier relevé
    // (poll immédiat) tombe sous la seconde et fmtDuration rend « 0:00 ». Une reprise
    // qui poursuivrait le compteur afficherait le solde de l'épisode 1 (0:01).
    await expect(page.locator('.chrono-fab__time')).toHaveText('0:00')
    // Épisode 2 : ~1,6 s de tricot, pause -> NOUVELLE ligne, jamais un update de la 1re.
    await page.waitForTimeout(1600)
    await page.locator('.chrono-fab__body').click()
    await expect.poll(async () => (await lireSessions(page)).length).toBe(2)
    // L'onglet Séances porte les DEUX épisodes en deux lignes distinctes.
    await page.locator('.rhdr__back').click()
    await page.getByRole('tab', { name: /Sessions/ }).click()
    await expect(page.locator('.ses-row')).toHaveCount(2)
    // Chaque ligne ne porte QUE son épisode (>= 1 s chacun) : le temps du premier
    // passage n'a été ni doublé dans la deuxième, ni perdu.
    const metas = await page.locator('.ses-row .ses-row__meta').allTextContents()
    expect(metas.length).toBe(2)
    for (const m of metas) expect(dureeRendue(m)).toBeGreaterThanOrEqual(1)
  })

  test('édition inline de la dernière ligne puis reprise : la fusion se fait quand même', async ({ page }) => {
    await ouvrirLecteurDemo(page)
    // Un épisode court, en pause -> première ligne au journal.
    await page.locator('.chrono-fab__body').click() // démarre le chrono
    await page.waitForTimeout(1600)
    await page.locator('.chrono-fab__body').click() // pause COMMITTANTE
    // Sur la fiche, onglet Séances : rectifier LA ligne. La date part 5 jours en arrière
    // (le rectificateur replace la séance là où elle a eu lieu) et la durée à 2 min — le
    // prérempli arrondit un chunk de ~1 s à 0 min, une base nulle rendrait le total
    // final ambigu ; 2 min le sépare sans peine du chunk de la reprise.
    await page.locator('.rhdr__back').click()
    await page.getByRole('tab', { name: /Sessions/ }).click()
    await expect(page.locator('.ses-row')).toHaveCount(1)
    await page.locator('.ses-row__edit').click()
    // Le vieux jour, calculé CÔTÉ NAVIGATEUR (même fuseau que l'app qui relira la
    // valeur) : un champ type=date ne porte ni heure ni fuseau, l'aller-retour est
    // exact ; la ligne atterrira au MIDI LOCAL du jour saisi (localDayToDate).
    const vieuxJour = await page.evaluate(() => {
      const d = new Date(Date.now() - 5 * 86400000)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    })
    await page.locator('.addform input[type="date"]').fill(vieuxJour)
    await page.locator('.addform input[inputmode="numeric"]').first().fill('2')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Session mise à jour.')).toBeVisible() // l'édition est en base
    // Reprise DEPUIS LA FICHE (la pastille du dock vit sur tous les onglets) : la
    // décision d'écart mesure le DERNIER CONTACT — `lastWriteAt`, INTACT car l'édition
    // inline est un update partiel — et non `date`, désormais 5 jours en arrière. La
    // reprise FUSIONNE donc dans la ligne rectifiée ; c'est LE piège du scénario : un
    // écart lu sur `date` splitterait et l'onglet montrerait deux lignes.
    await page.locator('.chrono-fab__body').click()
    await page.waitForTimeout(1600)
    await page.locator('.chrono-fab__body').click() // pause : le chunk rejoint la même ligne
    await expect
      .poll(async () => (await lireSessions(page))[0]?.durationSec ?? 0)
      .toBeGreaterThanOrEqual(121)
    // Toujours UNE seule ligne, et le total vaut base rectifiée + chunk (>= 2:01).
    await expect(page.locator('.ses-row')).toHaveCount(1)
    const meta = await page.locator('.ses-row .ses-row__meta').first().textContent()
    expect(dureeRendue(meta)).toBeGreaterThanOrEqual(121)
    // La fusion n'a pas menti sur la date : le commit de fusion est un update PARTIEL,
    // la ligne reste posée sur le jour rectifié (rendu local fr : jj/mm/aaaa).
    const dateRendue = await page.locator('.ses-row .ses-row__date').textContent()
    const attendu = await page.evaluate((iso) => {
      const [y, m, d] = iso.split('-').map(Number)
      return new Date(y, m - 1, d).toLocaleDateString('fr-FR')
    }, vieuxJour)
    expect(dateRendue.trim()).toBe(attendu)
  })
})

// Revue de code du 31/08 — jumeau e2e de tests/unit/project-remove-chrono.spec.js (le défaut
// y est éprouvé à la source : remove() -> discard -> cascade -> router.replace -> garde).
// Ici, le même parcours au doigt : supprimer un projet dont le chrono tourne ne doit laisser
// AUCUNE ligne de séance. L'ancien flux purgeait les sessions du projet (cascade de
// projectsStore.remove) puis le retour à l'accueil déclenchait le garde « sortie de bulle »,
// dont la pause commitante RÉÉCRIVAIT une ligne pour un projet disparu — une séance orpheline.
test.describe('suppression d’un projet dont le chrono tourne', () => {
  test('supprimer le projet pendant que son chrono tourne : AUCUNE ligne au journal, pas de « Temps enregistré »', async ({ page }) => {
    await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
    // Même porte d'entrée que ouvrirLecteurDemo (le projet démo « en cours », Bonnet
    // Torsade), mais on RESTE sur la fiche : c'est elle qui porte le dock chrono (lot
    // « chrono unifié » : la pastille vit sur tous les onglets) et le menu ⋮.
    await page.locator('.resume').click()
    await expect(page).toHaveURL(/\/project\/(\d+)/)
    const pid = Number(page.url().match(/\/project\/(\d+)/)[1])
    // Chrono lancé DEPUIS LA FICHE, puis ~1,6 s de tricot : un solde >= 1 s au journal —
    // exactement le solde que l'ancien flux réécrivait en ligne orpheline après la purge.
    await page.locator('.chrono-fab__body').click()
    await expect(page.locator('.chrono-fab')).not.toHaveClass(/chrono-fab--idle/) // il court
    await page.waitForTimeout(1600)
    // Menu ⋮ puis l'item destructeur. Pas de dialogue intermédiaire : dans cette UI,
    // l'appui sur « Supprimer le projet » EST le geste irréversible — l'annulation vit
    // dans le snackbar « Annuler » de la corbeille, après coup, pas avant.
    await page.locator('.phdr__kebab').click()
    await page.getByRole('button', { name: 'Supprimer le projet' }).click()
    // L'URL ne bascule sur '/' qu'une fois le garde « sortie de bulle » RÉSOLU (vue-router
    // attend ses gardes avant de confirmer la navigation) : l'éventuelle écriture orpheline
    // a donc DÉJÀ touché le disque à cet instant. La lecture brute qui suit est
    // déterministe, pas une course contre le garde.
    await expect(page).toHaveURL('/')
    // Journal lu dans IndexedDB brut (motif countSessions des specs voisines, via
    // lireSessions). Contexte neuf par test : TOUTE ligne serait celle de CE projet — le
    // filtre sur pid ne fait que le dire. Mutation interceptée : retirer le discard()
    // pré-cascade de ProjectDetailView.remove fait revenir l'orpheline (la cascade purge
    // les sessions, puis le garde ferme le chrono ENCORE ACTIF du projet mort et sa pause
    // commitante écrit 1 ligne) -> rouge ici.
    const rows = await lireSessions(page)
    expect(rows.length).toBe(0)
    expect(rows.filter((s) => s.projectId === pid).length).toBe(0)
    // La confirmation visible est celle de la SUPPRESSION, jamais un « Temps enregistré » :
    // le temps non commis part avec le projet, il n'y a rien de sauvé à annoncer. Snackbar
    // à emplacement unique : ce témoin est best-effort (une écriture orpheline serait
    // éventuellement recouverte par la confirmation de suppression), l'assertion forte est
    // le compte en base ci-dessus.
    await expect(page.getByText(/» supprimé\./)).toBeVisible()
    await expect(page.getByText(/Temps enregistré/)).toBeHidden()
  })
})
