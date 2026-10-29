<script setup lang="ts">
import { onMounted } from 'vue'
import { dateZhCN, zhCN } from 'naive-ui'
import MainLayout from './MainLayout.vue'
import { initStore } from './store'
import { themeOverrides } from './theme'

onMounted(() => {
  void initStore()
})
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides" abstract>
    <n-message-provider :max="4">
      <n-dialog-provider>
        <MainLayout />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
