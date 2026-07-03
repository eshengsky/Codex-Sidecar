<template>
  <div class="sidecar-markdown" :data-markdown-dark="isDark">
    <Markdown
      :content="content"
      mode="static"
      caret="block"
      :is-dark="isDark"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import 'vue-stream-markdown/theme.css'

defineProps<{
  content: string
}>()

const isDark = ref(false)

const syncTheme = () => {
  isDark.value = document.documentElement.classList.contains('dark')
}

let themeObserver: MutationObserver | null = null

onMounted(() => {
  syncTheme()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
})
</script>

<style>
.sidecar-markdown {
  min-width: 0;
  color: var(--ui-text);
  font-size: 14px;
  line-height: 1.6;
}

.sidecar-markdown .stream-markdown.light,
.sidecar-markdown .stream-markdown-overlay.light {
  --foreground: var(--ui-color-neutral-900);
  --background: transparent;
  --card: var(--ui-color-neutral-50);
  --card-foreground: var(--ui-color-neutral-900);
  --popover: var(--ui-color-neutral-50);
  --popover-foreground: var(--ui-color-neutral-900);
  --primary: var(--ui-primary);
  --primary-foreground: var(--ui-color-neutral-50);
  --secondary: var(--ui-color-neutral-100);
  --secondary-foreground: var(--ui-color-neutral-900);
  --muted: var(--ui-color-neutral-100);
  --muted-foreground: var(--ui-color-neutral-500);
  --accent: var(--ui-color-neutral-100);
  --accent-foreground: var(--ui-color-neutral-900);
  --destructive: var(--ui-color-error, #ef4444);
  --border: var(--ui-color-neutral-200);
  --input: var(--ui-color-neutral-200);
  --ring: var(--ui-color-neutral-400);
}

.sidecar-markdown .stream-markdown.dark,
.sidecar-markdown .stream-markdown-overlay.dark {
  --foreground: var(--ui-color-neutral-100);
  --background: transparent;
  --card: var(--ui-color-neutral-900);
  --card-foreground: var(--ui-color-neutral-100);
  --popover: var(--ui-color-neutral-900);
  --popover-foreground: var(--ui-color-neutral-100);
  --primary: var(--ui-primary);
  --primary-foreground: var(--ui-color-neutral-950);
  --secondary: var(--ui-color-neutral-800);
  --secondary-foreground: var(--ui-color-neutral-100);
  --muted: var(--ui-color-neutral-800);
  --muted-foreground: var(--ui-color-neutral-400);
  --accent: var(--ui-color-neutral-800);
  --accent-foreground: var(--ui-color-neutral-100);
  --destructive: var(--ui-color-error, #f87171);
  --border: var(--ui-color-neutral-700);
  --input: var(--ui-color-neutral-700);
  --ring: var(--ui-color-neutral-600);
}

.sidecar-markdown .stream-markdown {
  background: transparent;
  color: inherit;
}

.sidecar-markdown .stream-markdown [data-stream-markdown="code-block-header"] {
  position: static !important;
  top: auto !important;
}

.sidecar-markdown .stream-markdown [data-stream-markdown="inline-code"] {
  font-size: 13px;
}

.sidecar-markdown .stream-markdown [data-stream-markdown="code-block"],
.sidecar-markdown .stream-markdown [data-stream-markdown="inline-code"] {
  font-family: "Geist Mono Variable", "SF Mono", SFMono-Regular, ui-monospace, Menlo, Consolas, monospace;
}
</style>
