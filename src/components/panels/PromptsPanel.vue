<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden">
    <div class="flex min-w-0 items-center gap-2">
      <UInput
        v-model="searchTerm"
        icon="i-lucide-search"
        :placeholder="t('prompts.search')"
        size="sm"
        color="neutral"
        class="min-w-0 flex-1"
      />
      <UTooltip :text="t('prompts.add')">
        <UButton icon="i-lucide-plus" color="neutral" variant="outline" size="sm" square @click="openNewTemplate" />
      </UTooltip>
    </div>

    <div class="flex min-h-0 flex-col gap-1.5 overflow-y-auto overflow-x-hidden pr-2.5 -mr-2.5 pb-2">
      <UEmpty
        v-if="visibleTemplates.length === 0"
        :title="promptEmptyTitle"
        :description="promptEmptyDescription"
        variant="naked"
        size="xs"
        class="min-h-[220px] self-center"
      />

      <article
        v-for="template in visibleTemplates"
        v-else
        :key="template.id"
        class="flex min-w-0 flex-col gap-1.5 rounded-lg border border-default bg-default p-2.5 text-gray-900 hover:bg-neutral-50 dark:text-gray-100 dark:hover:bg-neutral-800"
      >
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-tight font-semibold text-gray-900 dark:text-gray-100">
            {{ template.name }}
          </h3>
          <div class="flex flex-none items-center justify-end gap-1.5" @keydown.stop>
            <UTooltip :text="t('common.copy')">
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('common.copy')"
                @click.stop="copyTemplate(template)"
              />
            </UTooltip>
            <UTooltip :text="t('common.edit')">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('common.edit')"
                @click.stop="openTemplateEditor(template)"
              />
            </UTooltip>
          </div>
        </div>

        <p class="m-0 min-w-0 line-clamp-2 text-xs leading-snug text-gray-600 [overflow-wrap:anywhere] dark:text-gray-300">
          {{ getTemplatePreview(template) }}
        </p>
      </article>
    </div>

    <UModal v-model:open="templateModalOpen" :title="editingTemplateId ? t('prompts.editTitle') : t('prompts.newTitle')">
      <template #title>
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 truncate">{{ editingTemplateId ? t('prompts.editTitle') : t('prompts.newTitle') }}</span>
          <UPopover
            v-if="!editingTemplateId"
            mode="hover"
            :open-delay="200"
            :close-delay="0"
            :content="{ side: 'bottom', align: 'start', sideOffset: 6 }"
          >
            <button
              type="button"
              :aria-label="t('prompts.tipsTitle')"
              class="inline-flex size-4 flex-none cursor-default items-center justify-center rounded-full border-0 bg-transparent p-0 text-gray-400 transition-colors hover:bg-transparent hover:text-gray-700 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-gray-400 dark:text-gray-500 dark:hover:text-gray-200"
            >
              <UIcon name="i-lucide-circle-question-mark" class="size-3.5" />
            </button>

            <template #content>
              <div class="flex max-w-72 flex-col gap-1.5 px-3 py-2.5 text-xs leading-snug font-normal text-gray-600 dark:text-gray-300">
                <span class="font-medium text-gray-700 dark:text-gray-200">{{ t('prompts.tipsTitle') }}</span>
                <span>{{ t('prompts.tipsAgent') }}</span>
                <span>{{ t('prompts.tipsSkill') }}</span>
                <span>{{ t('prompts.tipsPrompt') }}</span>
              </div>
            </template>
          </UPopover>
        </div>
      </template>

      <template #body>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('prompts.titleLabel') }}</label>
            <UInput v-model="templateDraft.name" :placeholder="t('prompts.titlePlaceholder')" size="xs" color="neutral" autofocus />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-gray-600 dark:text-gray-300">{{ t('prompts.bodyLabel') }}</label>
            <UTextarea v-model="templateDraft.body" :rows="9" :placeholder="t('prompts.bodyPlaceholder')" size="xs" color="neutral" />
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-1.5">
          <UButton
            v-if="editingTemplateId"
            color="error"
            variant="ghost"
            size="sm"
            @click="deleteEditingTemplate"
          >
            {{ t('common.delete') }}
          </UButton>
          <UButton color="neutral" variant="ghost" size="sm" @click="templateModalOpen = false">{{ t('common.cancel') }}</UButton>
          <UButton color="neutral" size="sm" @click="saveTemplateDraft">{{ t('common.save') }}</UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PromptTemplate } from '@/types/sidecar'

const props = defineProps<{
  templates: PromptTemplate[]
}>()

const emit = defineEmits<{
  save: [templates: PromptTemplate[]]
  copied: []
  failed: [message: string]
}>()

const searchTerm = ref('')
const editableTemplates = ref<PromptTemplate[]>([])
const templateModalOpen = ref(false)
const editingTemplateId = ref<string | null>(null)
const templateDraft = ref<PromptTemplate>(createBlankTemplate())
const { t } = useI18n()

watch(
  () => props.templates,
  templates => {
    editableTemplates.value = templates.map(template => ({ ...template }))
  },
  { immediate: true, deep: true }
)

const normalizedSearchTerm = computed(() => searchTerm.value.trim().toLowerCase())

const hasPromptSearch = computed(() => searchTerm.value.trim().length > 0)

const visibleTemplates = computed(() => {
  const term = normalizedSearchTerm.value

  if (!term) {
    return editableTemplates.value
  }

  return editableTemplates.value.filter(template => {
    return [
      template.name,
      template.body
    ].some(value => String(value || '').toLowerCase().includes(term))
  })
})

const promptEmptyTitle = computed(() => hasPromptSearch.value ? t('prompts.emptySearchTitle') : t('prompts.emptyTitle'))
const promptEmptyDescription = computed(() => hasPromptSearch.value ? t('prompts.emptySearchDescription') : t('prompts.emptyDescription'))

function createBlankTemplate(): PromptTemplate {
  return {
    id: crypto.randomUUID(),
    name: '',
    body: '',
    defaultPath: ''
  }
}

const emitSave = () => {
  emit(
    'save',
    editableTemplates.value.map(template => ({ ...template }))
  )
}

const openNewTemplate = () => {
  editingTemplateId.value = null
  templateDraft.value = createBlankTemplate()
  templateModalOpen.value = true
}

const openTemplateEditor = (template: PromptTemplate) => {
  editingTemplateId.value = template.id
  templateDraft.value = { ...template }
  templateModalOpen.value = true
}

const saveTemplateDraft = () => {
  const nextTemplate = {
    ...templateDraft.value,
    name: templateDraft.value.name.trim() || t('common.unnamedPrompt')
  }

  if (editingTemplateId.value) {
    editableTemplates.value = editableTemplates.value.map(template => template.id === editingTemplateId.value
      ? nextTemplate
      : template)
  } else {
    editableTemplates.value = [nextTemplate, ...editableTemplates.value]
  }

  templateModalOpen.value = false
  emitSave()
}

const deleteEditingTemplate = () => {
  if (!editingTemplateId.value) {
    return
  }

  editableTemplates.value = editableTemplates.value.filter(template => template.id !== editingTemplateId.value)
  templateModalOpen.value = false
  emitSave()
}

const getTemplatePreview = (template: PromptTemplate) => {
  return template.body.replace(/\s+/g, ' ').trim() || t('prompts.emptyPreview')
}

const copyTemplate = async (template: PromptTemplate) => {
  const prompt = template.body

  if (!prompt.trim()) {
    emit('failed', t('prompts.emptyBodyError'))
    return
  }

  await window.sidecar.copyText(prompt)
  emit('copied')
}
</script>
