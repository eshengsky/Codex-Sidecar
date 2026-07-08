<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-auto pb-2">
    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.language') }}</h3>
      </div>
      <USelect
        :model-value="languageMode"
        :items="languageOptions"
        value-key="value"
        label-key="label"
        color="neutral"
        variant="outline"
        size="sm"
        class="w-[100px] flex-none"
        :aria-label="t('settings.language')"
        :disabled="languageSaving"
        @update:model-value="saveLanguageMode"
      />
    </article>

    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.theme') }}</h3>
      </div>
      <div
        class="flex flex-none rounded-lg bg-neutral-200/70 p-0.5 dark:bg-neutral-800"
        role="radiogroup"
        :aria-label="t('settings.theme')"
      >
        <UTooltip
          v-for="option in themeOptions"
          :key="option.value"
          :text="option.label"
        >
          <button
            type="button"
            class="inline-flex h-6 w-9 items-center justify-center rounded-[7px] border-0 text-gray-500 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 disabled:cursor-default disabled:opacity-60 dark:text-gray-400"
            :class="themeMode === option.value ? 'bg-default text-gray-950 shadow-sm dark:bg-accented dark:text-white' : 'hover:text-gray-900 dark:hover:text-gray-100'"
            role="radio"
            :aria-checked="themeMode === option.value"
            :aria-label="option.label"
            :disabled="themeSaving"
            @click="saveThemeMode(option.value, $event)"
          >
            <UIcon :name="option.icon" class="h-4 w-4" />
          </button>
        </UTooltip>
      </div>
    </article>

    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.showMiniTool') }}</h3>
      </div>
      <USwitch
        :model-value="showMiniTool"
        color="neutral"
        :disabled="showMiniToolSaving"
        :aria-label="t('settings.showMiniTool')"
        @update:model-value="saveShowMiniTool"
      />
    </article>

    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.miniOverDock') }}</h3>
      </div>
      <USwitch
        :model-value="miniOverDock"
        color="neutral"
        :disabled="miniOverDockSaving"
        :aria-label="t('settings.miniOverDock')"
        @update:model-value="saveMiniOverDock"
      />
    </article>

    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.showMiniPrompts') }}</h3>
      </div>
      <USwitch
        :model-value="showMiniPrompts"
        color="neutral"
        :disabled="showMiniPromptsSaving"
        :aria-label="t('settings.showMiniPrompts')"
        @update:model-value="saveShowMiniPrompts"
      />
    </article>

    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.data') }}</h3>
      </div>
      <div class="flex flex-none gap-1.5">
        <UButton color="neutral" variant="outline" size="sm" class="justify-center" :loading="exporting" :disabled="importing" @click="emit('exportData')">
          {{ t('common.export') }}
        </UButton>
        <UButton color="neutral" variant="outline" size="sm" class="justify-center" :loading="importing" :disabled="exporting" @click="emit('importData')">
          {{ t('common.import') }}
        </UButton>
      </div>
    </article>

    <article class="flex min-w-0 items-center justify-between gap-3 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100">
      <div class="min-w-0 flex-1 basis-0">
        <h3 class="m-0 text-[13px]">{{ t('settings.version') }} · v{{ appVersion }}</h3>
      </div>
      <UButton
        v-if="updateReady"
        color="neutral"
        variant="outline"
        size="sm"
        class="flex-none justify-center"
        :loading="updateInstalling"
        @click="installUpdate"
      >
        {{ t('settings.restartUpdate') }}
      </UButton>
      <span v-else class="flex-none text-xs leading-none text-gray-500 dark:text-gray-400">
        {{ t('settings.upToDate') }}
      </span>
    </article>

    <footer class="mt-auto flex flex-none items-center justify-center gap-1.5 pt-2 text-xs leading-none text-gray-500 dark:text-gray-400">
      <span>Codex Sidecar</span>
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent p-0 text-xs leading-none text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:text-gray-100"
        @click="openGitHub"
      >
        GitHub
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import packageJson from '../../../package.json'
import type { LanguageMode, ThemeMode } from '@/types/sidecar'

const props = defineProps<{
  languageMode: LanguageMode
  languageOptions: Array<{ value: LanguageMode, label: string }>
  themeMode: ThemeMode
  themeOptions: Array<{ value: ThemeMode, label: string, icon: string }>
  showMiniTool: boolean
  miniOverDock: boolean
  showMiniPrompts: boolean
  exporting: boolean
  importing: boolean
}>()

const emit = defineEmits<{
  applyLanguageMode: [value: LanguageMode]
  applyThemeMode: [value: ThemeMode]
  applyShowMiniTool: [value: boolean]
  applyMiniOverDock: [value: boolean]
  applyShowMiniPrompts: [value: boolean]
  feedback: [message: string]
  exportData: []
  importData: []
}>()

const { t } = useI18n()
const languageSaving = ref(false)
const themeSaving = ref(false)
const showMiniToolSaving = ref(false)
const miniOverDockSaving = ref(false)
const showMiniPromptsSaving = ref(false)
const updateInstalling = ref(false)
const appVersion = packageJson.version
const updateState = ref<SidecarUpdateState | null>(null)
let languageMutationVersion = 0
let themeMutationVersion = 0
let showMiniToolMutationVersion = 0
let miniOverDockMutationVersion = 0
let showMiniPromptsMutationVersion = 0
let unsubscribeUpdateState: (() => void) | null = null

const updateReady = computed(() => updateState.value?.canInstall === true)

const isLanguageMode = (value: unknown): value is LanguageMode => value === 'auto' || value === 'en' || value === 'zh'
const isThemeMode = (value: unknown): value is ThemeMode => value === 'auto' || value === 'light' || value === 'dark'

const openGitHub = async () => {
  try {
    await window.sidecar.openGitHub()
  } catch (error) {
    emit('feedback', error instanceof Error ? error.message : String(error))
  }
}

const refreshUpdateState = async () => {
  try {
    updateState.value = await window.sidecar.getUpdateState()
  } catch (error) {
    emit('feedback', error instanceof Error ? error.message : String(error))
  }
}

const installUpdate = async () => {
  if (!updateReady.value || updateInstalling.value) {
    return
  }

  updateInstalling.value = true

  try {
    const result = await window.sidecar.installUpdate()

    if (!result.ok) {
      emit('feedback', result.error || 'Failed to install update.')
      updateInstalling.value = false
    }
  } catch (error) {
    updateInstalling.value = false
    emit('feedback', error instanceof Error ? error.message : String(error))
  }
}

onMounted(() => {
  void refreshUpdateState()
  unsubscribeUpdateState = window.sidecar.onUpdateStateChanged(state => {
    updateState.value = state
  })
})

onBeforeUnmount(() => {
  unsubscribeUpdateState?.()
  unsubscribeUpdateState = null
})

const applyThemeModeWithTransition = (nextThemeMode: ThemeMode, event?: MouseEvent) => {
  const viewTransitionDocument = document as Document & {
    startViewTransition?: (updateCallback: () => void) => { ready: Promise<void> }
  }
  const target = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!target || typeof viewTransitionDocument.startViewTransition !== 'function' || reducedMotion) {
    emit('applyThemeMode', nextThemeMode)
    return
  }

  const { top, left, width, height } = target.getBoundingClientRect()
  const x = left + width / 2
  const y = top + height / 2
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  viewTransitionDocument.startViewTransition(() => {
    emit('applyThemeMode', nextThemeMode)
  }).ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`]
      },
      {
        duration: 800,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)'
      }
    )
  }).catch(() => undefined)
}

const saveLanguageMode = async (value: unknown) => {
  if (!isLanguageMode(value) || value === props.languageMode) {
    return
  }

  const previousLanguageMode = props.languageMode
  const version = ++languageMutationVersion

  languageSaving.value = true
  emit('applyLanguageMode', value)

  try {
    const settings = await window.sidecar.setLanguageMode(value)

    if (version === languageMutationVersion) {
      emit('applyLanguageMode', settings.languageMode)
    }
  } catch (error) {
    if (version === languageMutationVersion) {
      emit('applyLanguageMode', previousLanguageMode)
      emit('feedback', error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === languageMutationVersion) {
      languageSaving.value = false
    }
  }
}

const saveThemeMode = async (value: unknown, event?: MouseEvent) => {
  if (!isThemeMode(value) || value === props.themeMode) {
    return
  }

  const previousThemeMode = props.themeMode
  const version = ++themeMutationVersion

  themeSaving.value = true
  applyThemeModeWithTransition(value, event)

  try {
    const settings = await window.sidecar.setThemeMode(value)

    if (version === themeMutationVersion) {
      emit('applyThemeMode', settings.themeMode)
    }
  } catch (error) {
    if (version === themeMutationVersion) {
      emit('applyThemeMode', previousThemeMode)
      emit('feedback', error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === themeMutationVersion) {
      themeSaving.value = false
    }
  }
}

const saveShowMiniTool = async (value: unknown) => {
  if (typeof value !== 'boolean' || value === props.showMiniTool) {
    return
  }

  const previousShowMiniTool = props.showMiniTool
  const version = ++showMiniToolMutationVersion

  showMiniToolSaving.value = true
  emit('applyShowMiniTool', value)

  try {
    const settings = await window.sidecar.setShowMiniTool(value)

    if (version === showMiniToolMutationVersion) {
      emit('applyShowMiniTool', settings.showMiniTool)
    }
  } catch (error) {
    if (version === showMiniToolMutationVersion) {
      emit('applyShowMiniTool', previousShowMiniTool)
      emit('feedback', error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === showMiniToolMutationVersion) {
      showMiniToolSaving.value = false
    }
  }
}

const saveMiniOverDock = async (value: unknown) => {
  if (typeof value !== 'boolean' || value === props.miniOverDock) {
    return
  }

  const previousMiniOverDock = props.miniOverDock
  const version = ++miniOverDockMutationVersion

  miniOverDockSaving.value = true
  emit('applyMiniOverDock', value)

  try {
    const settings = await window.sidecar.setMiniOverDock(value)

    if (version === miniOverDockMutationVersion) {
      emit('applyMiniOverDock', settings.miniOverDock)
    }
  } catch (error) {
    if (version === miniOverDockMutationVersion) {
      emit('applyMiniOverDock', previousMiniOverDock)
      emit('feedback', error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === miniOverDockMutationVersion) {
      miniOverDockSaving.value = false
    }
  }
}

const saveShowMiniPrompts = async (value: unknown) => {
  if (typeof value !== 'boolean' || value === props.showMiniPrompts) {
    return
  }

  const previousShowMiniPrompts = props.showMiniPrompts
  const version = ++showMiniPromptsMutationVersion

  showMiniPromptsSaving.value = true
  emit('applyShowMiniPrompts', value)

  try {
    const settings = await window.sidecar.setShowMiniPrompts(value)

    if (version === showMiniPromptsMutationVersion) {
      emit('applyShowMiniPrompts', settings.showMiniPrompts)
    }
  } catch (error) {
    if (version === showMiniPromptsMutationVersion) {
      emit('applyShowMiniPrompts', previousShowMiniPrompts)
      emit('feedback', error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (version === showMiniPromptsMutationVersion) {
      showMiniPromptsSaving.value = false
    }
  }
}
</script>
