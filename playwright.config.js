import { defineConfig, devices } from '@playwright/test'
import { resolveE2EPort } from './playwright-config-port.js'

// Rowtine tourne dans une WebView Android : on émule un Pixel 5 (tactile, viewport mobile)
// pour rester au plus près de la cible. VITE_E2E=1 active le seam caméra de src/utils/photo.js.
// Port surchargeable (E2E_PORT=… yarn test:e2e) : d'autres bancs de développement du dépôt
// écoutent sur 5173 — le mdedit (`yarn mdedit`) notamment — et la suite e2e doit pouvoir
// tourner à côté. Sans cela, le `reuseExistingServer` hors CI réutiliserait n'importe quel
// serveur déjà posé sur le port par défaut, fût-il
// un autre outil servi sans VITE_E2E=1 : les tests tourneraient contre le mauvais appliquatif.
// Défaut inchangé : 5173.
const PORT = resolveE2EPort(process.env.E2E_PORT)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // Chaque test repart d'une base vide (on purge IndexedDB) → on évite la parallélisation
  // intra-fichier qui partagerait le même profil de navigateur.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Cette ligne préexiste (baseline du projet) : la suite e2e a toujours asséré des
    // libellés FRANÇAIS. On la documente ici car elle est devenue indispensable depuis que
    // la langue de l'appareil est pré-sélectionnée (lot A, 30/07) — sans elle, le navigateur
    // du poste (souvent en-US) ferait basculer l'onboarding en anglais et des dizaines
    // d'assertions tomberaient d'un coup. Elle reste aussi cohérente avec un appareil
    // francophone réel.
    locale: 'fr-FR',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'android-pixel5',
      use: { ...devices['Pixel 5'] }, // hasTouch, viewport mobile, userAgent Android
    },
  ],

  // On sert un build réel via `vite preview` (et non `vite dev`) : pas de compilation de
  // chunks à la volée → pas de flakiness de timeout sous parallélisme, et un rendu au plus
  // près de l'APK Android. VITE_E2E=1 est lu au build (active le seam caméra).
  // Itération rapide en local : `yarn dev` côté + `reuseExistingServer` réutilise le serveur.
  webServer: {
    command: `yarn build && yarn preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { VITE_E2E: '1' },
  },
})
