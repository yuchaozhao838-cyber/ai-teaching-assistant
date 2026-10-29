<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })

const ICONS: Record<string, string[]> = {
  library: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  sparkles: [
    'M12 3.5l1.7 4.6L18 9.8l-4.3 1.7L12 16l-1.7-4.5L6 9.8l4.3-1.7z',
    'M18.6 15.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z'
  ],
  file: ['M14 2.8v5h5', 'M6.4 2.8h7.6L19 7.8v13.4H6.4z'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z', 'M3.2 12h17.6', 'M12 3c2.6 3.2 2.6 14.4 0 18', 'M12 3c-2.6 3.2-2.6 14.4 0 18'],
  text: ['M4 6.5h16', 'M4 12h12', 'M4 17.5h8'],
  settings: ['M4 7h6', 'M14 7h6', 'M4 17h6', 'M14 17h6', 'M10 5v4', 'M16 15v4', 'M10 15v4'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2'],
  trash: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13.5h9L17.5 7'],
  arrowRight: ['M4.5 12h14', 'M13 6.5l5.5 5.5-5.5 5.5'],
  arrowLeft: ['M19.5 12h-14', 'M11 6.5L5.5 12l5.5 5.5'],
  refresh: ['M20 12a8 8 0 1 1-2.4-5.7', 'M20 4.2v4.2h-4.2'],
  check: ['M5 12.8l4.2 4.2L19 7'],
  book: ['M4.5 5.2A2.2 2.2 0 0 1 6.7 3H19v18H6.7a2.2 2.2 0 0 1-2.2-2.2z', 'M8.4 7.4h7'],
  edit: ['M4 20h4.2L20 8.2 15.8 4 4 15.8z'],
  folder: ['M3 7.4A2.4 2.4 0 0 1 5.4 5h4.2l2 2.2h7A2.4 2.4 0 0 1 21 9.6v8A2.4 2.4 0 0 1 18.6 20H5.4A2.4 2.4 0 0 1 3 17.6z'],
  star: ['M12 3.4l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.4l-5.4 2.9 1-6.1L3.2 9.9l6.1-.9z'],
  alert: ['M12 3.5L21 19.5H3z', 'M12 9.5v4.4', 'M12 16.9v.1'],
  zap: ['M13.5 2.5L4.5 14h6l-1 7.5L19.5 10h-6z'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  layers: ['M12 3l8.5 4.6L12 12.2 3.5 7.6z', 'M4 12.4l8 4.4 8-4.4', 'M4 16.6l8 4.4 8-4.4'],
  clock: ['M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 1 0 0-17.6z', 'M12 7.4V12l3.2 2']
}

const paths = computed(() => ICONS[props.name] ?? ICONS.layers)
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
