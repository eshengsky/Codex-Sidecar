<template>
  <div
    ref="rootRef"
    class="flex h-full w-full bg-transparent outline-none"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <div
      v-if="menu"
      class="flex max-h-full w-full flex-col overflow-hidden bg-default text-default"
    >
      <div class="relative isolate flex-1 overflow-y-auto p-1">
        <button
          v-for="(item, index) in menu.items"
          :key="item.id"
          type="button"
          class="group relative flex w-full min-w-0 flex-col items-start rounded-md border-0 bg-transparent p-1.5 text-left text-xs leading-4 outline-none transition-colors before:absolute before:inset-px before:z-[-1] before:rounded-md before:transition-colors disabled:cursor-not-allowed disabled:opacity-75"
          :class="[
            item.description ? 'min-h-11 gap-0.5' : 'min-h-7 justify-center',
            item.disabled ? '' : 'cursor-pointer hover:text-highlighted hover:before:bg-elevated/50',
            activeIndex === index && !item.disabled ? 'text-highlighted before:bg-elevated/50' : ''
          ]"
          :disabled="item.disabled"
          @mouseenter="activeIndex = index"
          @click="selectItem(item)"
        >
          <span class="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ item.label }}</span>
          <span v-if="item.description" class="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-3 text-gray-500 dark:text-gray-400">{{ item.description }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { PopupMenuData, PopupMenuItem } from '@/types/sidecar'

const props = defineProps<{
  menu: PopupMenuData | null
}>()

const emit = defineEmits<{
  select: [itemId: string]
  close: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const activeIndex = ref(-1)

const getFirstEnabledIndex = () => props.menu?.items.findIndex(item => !item.disabled) ?? -1

const moveActiveIndex = (direction: 1 | -1) => {
  const items = props.menu?.items || []

  if (items.length === 0) {
    activeIndex.value = -1
    return
  }

  let nextIndex = activeIndex.value

  for (let step = 0; step < items.length; step += 1) {
    nextIndex = (nextIndex + direction + items.length) % items.length

    if (!items[nextIndex]?.disabled) {
      activeIndex.value = nextIndex
      return
    }
  }

  activeIndex.value = -1
}

const selectItem = (item: PopupMenuItem) => {
  if (item.disabled) {
    return
  }

  emit('select', item.id)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActiveIndex(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActiveIndex(-1)
    return
  }

  if (event.key === 'Enter') {
    const item = props.menu?.items[activeIndex.value]

    if (item) {
      event.preventDefault()
      selectItem(item)
    }
  }
}

watch(() => props.menu?.id, async () => {
  activeIndex.value = getFirstEnabledIndex()
  await nextTick()
  rootRef.value?.focus()
}, { immediate: true })

onMounted(() => {
  rootRef.value?.focus()
})
</script>
