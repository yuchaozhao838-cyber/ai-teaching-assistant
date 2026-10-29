<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{ markdown: string }>()
const html = computed(() => renderMarkdown(props.markdown))
</script>

<template>
  <div class="md-body" v-html="html" />
</template>
