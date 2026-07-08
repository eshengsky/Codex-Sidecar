<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
    <div class="flex min-w-0 items-center gap-2">
      <UInput
        v-model="searchTerm"
        icon="i-lucide-search"
        :placeholder="t('explorations.search')"
        size="sm"
        color="neutral"
        class="min-w-0 flex-1"
      />
      <UTooltip :text="t('explorations.new')">
        <UButton icon="i-lucide-plus" color="neutral" variant="outline" size="sm" square @click="openExplorationCreate" />
      </UTooltip>
    </div>

    <div class="flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-2.5 -mr-2.5 pb-2">
      <UEmpty
        v-if="visibleExplorations.length === 0"
        :title="explorationEmptyTitle"
        :description="explorationEmptyDescription"
        variant="naked"
        size="xs"
        class="min-h-[260px] self-center"
      />

      <template v-else>
        <article
          v-for="run in visibleExplorations"
          :key="run.id"
          class="flex min-w-0 flex-col gap-2.5 rounded-[9px] border border-default bg-default p-2.5 text-gray-900 dark:text-gray-100"
        >
          <div class="flex min-w-0 items-start gap-2">
            <p class="m-0 line-clamp-3 min-w-0 flex-1 basis-0 text-[13px] leading-[1.45] text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">
              {{ getExplorationPreviewText(run) }}
            </p>
            <span class="mt-0.5 flex-none text-[11px] leading-none whitespace-nowrap text-gray-500 dark:text-gray-400">{{ formatRelativeTime(run.updatedAt, appLocale) }}</span>
          </div>

          <div v-if="run.sourceThreadId" class="flex min-w-0 items-center gap-1 text-xs leading-none text-gray-500 dark:text-gray-400">
            <span class="flex-none">{{ t('explorations.basedOnPrefix') }}</span>
            <button
              type="button"
              class="min-w-0 flex-1 basis-0 overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left leading-none text-gray-700 underline-offset-2 hover:text-gray-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:text-gray-300 dark:hover:text-white cursor-pointer"
              @click="openExplorationSourceThread(run)"
            >
              {{ getExplorationSourceLabel(run) }}
            </button>
          </div>

          <div class="flex min-w-0 items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1">
              <span class="flex-none rounded-md bg-neutral-100 px-2 py-1 text-[11px] leading-none text-gray-600 dark:bg-neutral-800 dark:text-gray-300">{{ t('explorations.countLabel', { count: run.concurrency }) }}</span>
              <span class="rounded-md px-2 py-1 text-[11px] leading-none" :class="explorationStatusClass(run.status)">
                {{ getExplorationStatusLabel(run.status) }}
              </span>
            </div>
            <div class="flex flex-none items-center gap-1">
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-lucide-external-link"
                :disabled="isExplorationResultDisabled(run)"
                @click="openExplorationResult(run)"
              >
                {{ t('explorations.openResult') }}
              </UButton>
              <UTooltip :text="t('explorations.deleteRecord')">
                <UButton
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  :aria-label="t('explorations.deleteRecord')"
                  :loading="explorationDeletingId === run.id"
                  :disabled="isExplorationDeleteDisabled(run)"
                  @click="openExplorationDeleteConfirm(run)"
                />
              </UTooltip>
            </div>
          </div>
        </article>
      </template>
    </div>

    <UModal
      v-model:open="explorationCreateOpen"
      :title="t('explorations.new')"
      @after:leave="resetExplorationCreateForm"
    >
      <template #title>
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 truncate">{{ t('explorations.new') }}</span>
          <UPopover
            mode="hover"
            :open-delay="200"
            :close-delay="0"
            :content="{ side: 'bottom', align: 'start', sideOffset: 6 }"
          >
            <button
              type="button"
              :aria-label="t('explorations.tipsTitle')"
              tabindex="-1"
              class="inline-flex size-4 flex-none cursor-default items-center justify-center rounded-full border-0 bg-transparent p-0 text-gray-400 transition-colors hover:bg-transparent hover:text-gray-700 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-gray-400 dark:text-gray-500 dark:hover:text-gray-200"
            >
              <UIcon name="i-lucide-circle-question-mark" class="size-3.5" />
            </button>

            <template #content>
              <div class="flex max-w-72 flex-col gap-1.5 px-3 py-2.5 text-xs leading-snug font-normal text-gray-600 dark:text-gray-300">
                <span class="font-medium text-gray-700 dark:text-gray-200">{{ t('explorations.tipsTitle') }}</span>
                <span>{{ t('explorations.tipsParallel') }}</span>
                <span>{{ t('explorations.tipsTradeoff') }}</span>
              </div>
            </template>
          </UPopover>
        </div>
      </template>

      <template #body>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('explorations.context') }}</label>
            <USelectMenu
              v-model="explorationSourceThreadId"
              :items="explorationSourceOptions"
              value-key="id"
              label-key="label"
              :placeholder="t('explorations.noContextPlaceholder')"
              :search-input="{ placeholder: t('explorations.searchContext') }"
              clear
              color="neutral"
              variant="outline"
              size="sm"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('explorations.runCount') }}</label>
            <div class="flex w-fit rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800" role="radiogroup" :aria-label="t('explorations.runCount')">
              <button
                v-for="count in explorationConcurrencyOptions"
                :key="count"
                type="button"
                class="inline-flex h-7 w-9 items-center justify-center rounded-[7px] border-0 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                :class="explorationConcurrency === count ? 'bg-default text-gray-950 shadow-sm dark:bg-accented dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
                :disabled="explorationCreating"
                role="radio"
                :aria-checked="explorationConcurrency === count"
                @click="explorationConcurrency = count"
              >
                x{{ count }}
              </button>
            </div>
          </div>

          <div class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-default bg-default p-2">
            <textarea
              v-model="explorationPrompt"
              class="min-h-[112px] w-full resize-none border-0 bg-transparent px-1 py-1 text-[13px] leading-[1.5] text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
              :placeholder="t('explorations.promptPlaceholder')"
            />

            <div v-if="explorationImages.length > 0" class="flex min-w-0 flex-wrap gap-1.5 py-1">
              <span
                v-for="image in explorationImages"
                :key="image.path"
                class="inline-flex max-w-full items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] leading-none text-gray-700 dark:bg-neutral-800 dark:text-gray-200"
              >
                <span class="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">{{ image.name }}</span>
                <button
                  type="button"
                  class="inline-flex h-4 w-4 items-center justify-center rounded border-0 bg-transparent text-gray-500 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:text-gray-100"
                  :aria-label="t('explorations.removeImage')"
                  @click.stop="removeExplorationImage(image.path)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </span>
            </div>

            <div class="flex min-w-0 items-center gap-2 pt-1">
              <UTooltip :text="t('explorations.attachImage')">
                <UButton
                  icon="i-lucide-image-plus"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  :disabled="explorationCreating"
                  @click="chooseExplorationImages"
                />
              </UTooltip>

              <div class="min-w-0 flex-1 basis-0" />

              <UTooltip :text="t('explorations.send')">
                <UButton
                  icon="i-lucide-arrow-up"
                  color="neutral"
                  variant="solid"
                  size="sm"
                  square
                  class="rounded-full bg-gray-950 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-white dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-white dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500"
                  :ui="{  }"
                  :loading="explorationCreating"
                  :disabled="explorationSubmitDisabled"
                  @click="submitExploration"
                />
              </UTooltip>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="explorationDeleteConfirmOpen"
      :title="t('explorations.deleteConfirmTitle')"
      @after:leave="clearExplorationDeleteConfirm"
    >
      <template #body>
        <p class="m-0 text-[13px] leading-[1.55] text-gray-700 dark:text-gray-200">
          {{ t('explorations.deleteConfirmDescription') }}
        </p>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-1.5">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="explorationDeletingId !== null"
            @click="closeExplorationDeleteConfirm"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="neutral"
            size="sm"
            :loading="explorationDeletingId !== null"
            :disabled="!pendingDeleteExploration"
            @click="confirmDeleteExploration"
          >
            {{ t('common.delete') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppLocale, ExplorationCreateRequest, ExplorationRun, ExplorationRunStatus, ThreadSummary } from '@/types/sidecar'
import { formatRelativeTime } from '@/utils/format'

type ExplorationSourceOption = {
  id: string
  label: string
}

const props = defineProps<{
  explorations: ExplorationRun[]
  threads: ThreadSummary[]
  appLocale: AppLocale
}>()

const emit = defineEmits<{
  created: [run: ExplorationRun]
  deleted: [runId: string]
  feedback: [message: string]
  'open-source-thread': [threadId: string]
}>()

const { t } = useI18n()
const searchTerm = ref('')
const explorationCreateOpen = ref(false)
const explorationPrompt = ref('')
const explorationConcurrency = ref<2 | 3 | 4 | 5>(3)
const explorationSourceThreadId = ref<string | null>(null)
const explorationImages = ref<Array<{ path: string, name: string }>>([])
const explorationCreating = ref(false)
const explorationDeleteConfirmOpen = ref(false)
const pendingDeleteExploration = ref<ExplorationRun | null>(null)
const explorationDeletingId = ref<string | null>(null)
const explorationConcurrencyOptions = [2, 3, 4, 5] as const
const explorationSourceOptions = ref<ExplorationSourceOption[]>([])

const normalizedSearchTerm = computed(() => searchTerm.value.trim().toLowerCase())

const hasExplorationSearch = computed(() => searchTerm.value.trim().length > 0)

const visibleExplorations = computed(() => {
  const term = normalizedSearchTerm.value

  if (!term) {
    return props.explorations
  }

  return props.explorations.filter(run => {
    return [
      run.title,
      run.prompt,
      run.sourceThreadTitle,
      run.status,
      run.id
    ].some(value => String(value || '').toLowerCase().includes(term))
  })
})

const explorationEmptyTitle = computed(() => hasExplorationSearch.value ? t('explorations.emptySearchTitle') : t('explorations.emptyTitle'))
const explorationEmptyDescription = computed(() => hasExplorationSearch.value ? t('explorations.emptySearchDescription') : t('explorations.emptyDescription'))

const getExplorationSourceOptions = () => props.threads.map(thread => ({
  id: thread.id,
  label: thread.title || thread.codexTitle || t('common.unnamedThread')
}))

const openExplorationCreate = () => {
  // Snapshot once so polling refreshes do not reset the SelectMenu scroll position.
  explorationSourceOptions.value = getExplorationSourceOptions()
  explorationCreateOpen.value = true
}

const explorationSubmitDisabled = computed(() => {
  return explorationCreating.value || (!explorationPrompt.value.trim() && explorationImages.value.length === 0)
})

const getExplorationStatusLabel = (status: ExplorationRunStatus | 'pending') => {
  return t(`explorations.status.${status}`)
}

const isExplorationRunning = (run: ExplorationRun) => run.status === 'running' || run.status === 'summarizing'

const isExplorationResultDisabled = (run: ExplorationRun) => isExplorationRunning(run) || explorationDeletingId.value === run.id

const isExplorationDeleteDisabled = (run: ExplorationRun) => isExplorationRunning(run) || Boolean(explorationDeletingId.value)

const getExplorationPreviewText = (run: ExplorationRun) => {
  return run.prompt.trim() || t('explorations.images', { count: run.images.length })
}

const getExplorationSourceLabel = (run: ExplorationRun) => {
  return run.sourceThreadTitle || run.sourceThreadId || t('common.unnamedThread')
}

const openExplorationSourceThread = (run: ExplorationRun) => {
  if (!run.sourceThreadId) {
    return
  }

  emit('open-source-thread', run.sourceThreadId)
}

const explorationStatusClass = (status: ExplorationRunStatus) => {
  if (status === 'completed') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
  }

  if (status === 'partialFailed') {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200'
  }

  if (status === 'failed') {
    return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200'
  }

  return 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-200'
}

const resetExplorationCreateForm = () => {
  explorationPrompt.value = ''
  explorationConcurrency.value = 3
  explorationSourceThreadId.value = null
  explorationImages.value = []
}

const chooseExplorationImages = async () => {
  if (explorationCreating.value) {
    return
  }

  try {
    const selectedImages = await window.sidecar.chooseExplorationImages()
    const imageByPath = new Map(explorationImages.value.map(image => [image.path, image]))

    for (const image of selectedImages) {
      imageByPath.set(image.path, image)
    }

    explorationImages.value = [...imageByPath.values()]

    if (selectedImages.length > 0) {
      emit('feedback', t('feedback.explorationImagesAdded'))
    }
  } catch (error) {
    emit('feedback', error instanceof Error ? error.message : String(error))
  }
}

const removeExplorationImage = (imagePath: string) => {
  explorationImages.value = explorationImages.value.filter(image => image.path !== imagePath)
}

const openExplorationDeleteConfirm = (run: ExplorationRun) => {
  if (isExplorationDeleteDisabled(run)) {
    return
  }

  pendingDeleteExploration.value = run
  explorationDeleteConfirmOpen.value = true
}

const closeExplorationDeleteConfirm = () => {
  if (explorationDeletingId.value) {
    return
  }

  explorationDeleteConfirmOpen.value = false
}

const clearExplorationDeleteConfirm = () => {
  if (!explorationDeletingId.value) {
    pendingDeleteExploration.value = null
  }
}

const confirmDeleteExploration = async () => {
  const run = pendingDeleteExploration.value

  if (!run || isExplorationRunning(run) || explorationDeletingId.value) {
    return
  }

  explorationDeletingId.value = run.id

  try {
    await window.sidecar.deleteExplorationRun(run.id)
    emit('deleted', run.id)
    explorationDeleteConfirmOpen.value = false
    pendingDeleteExploration.value = null
  } catch (error) {
    emit('feedback', error instanceof Error ? error.message : String(error))
  } finally {
    explorationDeletingId.value = null
  }
}

const submitExploration = async () => {
  if (explorationSubmitDisabled.value) {
    return
  }

  const request: ExplorationCreateRequest = {
    prompt: explorationPrompt.value,
    imagePaths: explorationImages.value.map(image => image.path),
    concurrency: explorationConcurrency.value,
    sourceThreadId: explorationSourceThreadId.value
  }

  explorationCreating.value = true

  try {
    const run = await window.sidecar.createExplorationRun(request)

    emit('created', run)
    explorationCreateOpen.value = false
    resetExplorationCreateForm()
    emit('feedback', t('feedback.explorationCreated'))
  } catch (error) {
    emit('feedback', error instanceof Error ? error.message : String(error))
  } finally {
    explorationCreating.value = false
  }
}

const openExplorationResult = async (run: ExplorationRun) => {
  if (explorationDeletingId.value === run.id) {
    return
  }

  if (isExplorationRunning(run)) {
    emit('feedback', t('feedback.explorationOpenAfterDone'))
    return
  }

  try {
    await window.sidecar.openExplorationResult(run.id)
  } catch (error) {
    emit('feedback', error instanceof Error ? error.message : String(error))
  }
}
</script>
