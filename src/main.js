import './styles/tokens.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { installStorageGuard, storageAwareErrorHandler } from '@/db/storage-guard'
import { installSafeArea } from '@/native/safe-area'
import { installKeyboardAvoidance } from '@/utils/keyboard-avoidance'

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.use(router)

// Montage immédiat : le chargement des réglages (Dexie) est attendu dans le garde
// de navigation (router/index.js), pas en bloquant le montage de l'app.

// Filet de sécurité stockage (doit être posé après Pinia, avant le montage).
// installStorageGuard() couvre les promesses flottantes hors Vue ; errorHandler
// couvre le cas dominant (handlers async / cycle de vie awaités par Vue).
installStorageGuard()
app.config.errorHandler = storageAwareErrorHandler()

// Insets d'écran sûrs (barre d'état/navigation) : le natif est la seule source
// fiable sur Android (cf. src/native/safe-area.js). No-op hors plateforme native.
installSafeArea()

// Le clavier ne doit masquer aucun champ de saisie (retour d'usage du 29/07) : un seul
// écouteur global, posé une fois ici (cf. src/utils/keyboard-avoidance.js pour le
// mécanisme complet et son raisonnement).
installKeyboardAvoidance()

app.mount('#app')
