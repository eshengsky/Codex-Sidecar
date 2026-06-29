import { createI18n } from 'vue-i18n'
import type { AppLocale, LanguageMode } from '@/types/sidecar'
import { messages } from './messages'

export const getSystemLocale = (): AppLocale => {
  const language = (navigator.languages?.[0] || navigator.language || '').toLowerCase()

  return language.startsWith('zh') ? 'zh' : 'en'
}

export const resolveLanguageMode = (languageMode: LanguageMode): AppLocale => {
  return languageMode === 'auto' ? getSystemLocale() : languageMode
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: resolveLanguageMode('auto'),
  fallbackLocale: 'en',
  messages
})

export const applyI18nLanguageMode = (languageMode: LanguageMode) => {
  i18n.global.locale.value = resolveLanguageMode(languageMode)
}
