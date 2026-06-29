import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import './assets/css/main.css'
import './plugins/iconify-local'

import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { i18n } from './i18n'

// Nuxt UI reads router composables even though Sidecar is a single-screen app.
const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }]
})

createApp(App).use(router).use(i18n).use(ui).mount('#app')
