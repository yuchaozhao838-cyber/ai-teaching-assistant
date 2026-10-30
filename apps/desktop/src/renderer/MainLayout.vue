<script setup lang="ts">
import { computed } from 'vue'
import LibraryView from './views/LibraryView.vue'
import LessonView from './views/LessonView.vue'
import SettingsView from './views/SettingsView.vue'
import PracticeView from './views/PracticeView.vue'
import FocusView from './views/FocusView.vue'
import IdeasView from './views/IdeasView.vue'
import PrepView from './views/PrepView.vue'
import Icon from './components/Icon.vue'
import { activeProvider, goFocus, goIdeas, goLibrary, goPractice, goPrep, goSettings, openArtifact, openDocument, state } from './store'
import { formatRelative } from './utils/format'

const recentArtifacts = computed(() => state.artifacts.slice(0, 8))

const providerText = computed(() => {
  const provider = activeProvider()
  if (!provider) return '未配置模型'
  if (provider.kind === 'demo') return '本地演示模型'
  return provider.model || provider.name
})

function openCurrentLesson() {
  if (state.view === 'lesson') return
  if (state.artifact) {
    state.view = 'lesson'
    return
  }
  const latest = state.artifacts[0]
  if (latest) {
    void openArtifact(latest.id)
    return
  }
  if (state.docs[0]) {
    void openDocument(state.docs[0].id)
    return
  }
  goLibrary()
}
</script>

<template>
  <!-- 迷你窗口：只留番茄钟 -->
  <div v-if="state.mini" class="mini-shell">
    <FocusView />
  </div>

  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">讲</div>
        <div class="brand-text">
          <div class="brand-title">AI 课堂助手</div>
          <div class="brand-sub">讲解闭环 · 本地优先</div>
        </div>
      </div>

      <nav class="nav">
        <button class="nav-item" :class="{ active: state.view === 'library' }" @click="goLibrary">
          <Icon name="library" :size="17" />
          <span>资料库</span>
          <span v-if="state.docs.length" class="nav-count">{{ state.docs.length }}</span>
        </button>
        <button class="nav-item" :class="{ active: state.view === 'lesson' }" @click="openCurrentLesson">
          <Icon name="sparkles" :size="17" />
          <span>讲解</span>
          <span v-if="state.generating" class="nav-pulse" />
          <span v-else-if="state.artifacts.length" class="nav-count">{{ state.artifacts.length }}</span>
        </button>
        <button class="nav-item" :class="{ active: state.view === 'practice' }" @click="goPractice">
          <Icon name="edit" :size="17" />
          <span>练习</span>
          <span v-if="state.problemSets.length" class="nav-count">{{ state.problemSets.length }}</span>
        </button>
        <button class="nav-item" :class="{ active: state.view === 'prep' }" @click="goPrep">
          <Icon name="target" :size="17" />
          <span>备考</span>
          <span v-if="state.prepGoals.length" class="nav-count">{{ state.prepGoals.length }}</span>
        </button>
        <button class="nav-item" :class="{ active: state.view === 'ideas' }" @click="goIdeas">
          <Icon name="bulb" :size="17" />
          <span>灵感</span>
          <span v-if="state.ideas.length" class="nav-count">{{ state.ideas.length }}</span>
        </button>
        <button class="nav-item" :class="{ active: state.view === 'focus' }" @click="goFocus">
          <Icon name="clock" :size="17" />
          <span>专注</span>
          <span v-if="state.studyStats?.today.focusCount" class="nav-count">{{ state.studyStats.today.focusCount }}</span>
        </button>
      </nav>

      <div class="recent">
        <div class="recent-head">
          <span>最近讲解</span>
          <span class="recent-hint">{{ state.artifacts.length }}</span>
        </div>
        <div class="recent-list">
          <button
            v-for="artifact in recentArtifacts"
            :key="artifact.id"
            class="recent-item"
            :class="{ active: state.view === 'lesson' && state.activeArtifactId === artifact.id }"
            @click="openArtifact(artifact.id)"
          >
            <span class="status-dot" :class="artifact.status" />
            <span class="recent-title">{{ artifact.documentTitle }}</span>
            <span class="recent-time">{{ formatRelative(artifact.updatedAt) }}</span>
          </button>
          <div v-if="!recentArtifacts.length" class="recent-empty">还没有讲解记录</div>
        </div>
      </div>

      <div class="sidebar-foot">
        <button class="nav-item" :class="{ active: state.view === 'settings' }" @click="goSettings">
          <Icon name="settings" :size="17" />
          <span>设置</span>
        </button>
        <div class="model-line" :title="providerText">
          <span class="pulse" :class="{ on: Boolean(state.settings) }" />
          <span class="model-name">{{ providerText }}</span>
        </div>
        <div class="version">v{{ state.info?.version ?? '1.0.0' }} · Electron 桌面端</div>
      </div>
    </aside>

    <main class="main">
      <LibraryView v-if="state.view === 'library'" />
      <LessonView v-else-if="state.view === 'lesson'" />
      <PracticeView v-else-if="state.view === 'practice'" />
      <PrepView v-else-if="state.view === 'prep'" />
      <IdeasView v-else-if="state.view === 'ideas'" />
      <FocusView v-else-if="state.view === 'focus'" />
      <SettingsView v-else-if="state.view === 'settings'" />
      <LibraryView v-else />
    </main>
  </div>
</template>

<style scoped>
.mini-shell {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: #0f172a;
}
</style>
