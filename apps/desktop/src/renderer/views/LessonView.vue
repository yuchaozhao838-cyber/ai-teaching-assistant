<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import type { ExportFormat, KeyPointLevel, OutlineNode } from '@tutor/shared'
import Icon from '../components/Icon.vue'
import MarkdownView from '../components/MarkdownView.vue'
import { renderInline } from '../utils/markdown'
import {
  activeProvider,
  cancelGeneration,
  explanationOf,
  exportArtifact,
  goLibrary,
  goSettings,
  keyPointsOf,
  openDocument,
  regenerateLesson,
  regenerateSection,
  saveSection,
  state,
  startLesson
} from '../store'
import { formatDateTime, formatNumber } from '../utils/format'

const message = useMessage()

const activeSection = ref('')
const kpFilter = ref<'all' | KeyPointLevel>('all')
const editOpen = ref(false)
const editDraft = ref({ id: '', title: '', markdown: '' })
const starting = ref(false)
const regenId = ref('')
const contentRef = ref<HTMLElement | null>(null)

const artifact = computed(() => state.artifact)
const outline = computed<OutlineNode[]>(() => state.artifact?.outline ?? [])
const keyPoints = computed(() => state.artifact?.keyPoints ?? [])
const doc = computed(() => state.docs.find((d) => d.id === state.activeDocId))
const provider = computed(() => activeProvider())

const title = computed(() => artifact.value?.documentTitle || doc.value?.title || '讲解')

const percent = computed(() => {
  const progress = state.progress
  if (!progress) return 0
  switch (progress.phase) {
    case 'prepare':
      return 5
    case 'chunking':
      return progress.total ? 5 + ((progress.current ?? 0) / progress.total) * 12 : 8
    case 'outline':
      return 20
    case 'explain': {
      const total = progress.total || outline.value.length || 1
      return 25 + (Math.min(progress.current ?? 0, total) / total) * 62
    }
    case 'keypoints':
      return 92
    case 'persist':
      return 96
    case 'done':
      return 100
    case 'failed':
      return 100
    default:
      return 0
  }
})

const phaseLabel = computed(() => {
  const phase = state.progress?.phase
  if (phase === 'chunking') return '分块提炼'
  if (phase === 'outline') return '生成大纲'
  if (phase === 'explain') return '逐节讲解'
  if (phase === 'keypoints') return '划重点'
  if (phase === 'done') return '已完成'
  if (phase === 'failed') return '已中断'
  return '准备中'
})

const filteredKeyPoints = computed(() =>
  kpFilter.value === 'all' ? keyPoints.value : keyPoints.value.filter((kp) => kp.level === kpFilter.value)
)

const levelCount = computed(() => ({
  high: keyPoints.value.filter((kp) => kp.level === 'high').length,
  medium: keyPoints.value.filter((kp) => kp.level === 'medium').length,
  low: keyPoints.value.filter((kp) => kp.level === 'low').length
}))

const exportOptions = [
  { label: 'Word 文档（.docx）', key: 'docx' },
  { label: 'PowerPoint（.pptx）', key: 'pptx' },
  { label: 'PDF（.pdf）', key: 'pdf' },
  { label: 'Markdown（.md）', key: 'md' }
]

const LEVEL_LABEL: Record<KeyPointLevel, string> = {
  high: '必须掌握',
  medium: '理解即可',
  low: '了解即可'
}

function displayMarkdown(sectionId: string): string {
  const stored = explanationOf(sectionId)?.markdown ?? ''
  if (regenId.value === sectionId) return state.streamings[sectionId] ?? stored
  return stored || (state.streamings[sectionId] ?? '')
}

function isStreaming(sectionId: string): boolean {
  if (regenId.value === sectionId) return true
  return !explanationOf(sectionId) && Boolean(state.streamings[sectionId])
}

function sectionTitle(sectionId: string): string {
  return outline.value.find((node) => node.id === sectionId)?.title ?? ''
}

function scrollTo(sectionId: string) {
  activeSection.value = sectionId
  const element = document.getElementById(`sec-${sectionId}`)
  if (element && contentRef.value) {
    contentRef.value.scrollTo({ top: element.offsetTop - 16, behavior: 'smooth' })
  }
}

function onSectionRef(sectionId: string, el: unknown) {
  if (!el) return
  void sectionId
}

async function onStart() {
  if (!state.activeDocId) {
    message.warning('请先在资料库选择一份材料')
    return
  }
  starting.value = true
  try {
    const result = await startLesson(state.activeDocId)
    if (!result.ok) message.error(result.error ?? '无法开始生成', { duration: 8000 })
  } finally {
    starting.value = false
  }
}

async function onRegenerateAll() {
  const result = await regenerateLesson()
  if (!result.ok) message.error(result.error ?? '无法重新生成', { duration: 8000 })
}

async function onCancel() {
  await cancelGeneration()
  message.info('已请求取消，正在保存已完成的内容…')
}

async function onRegenerateSection(node: OutlineNode) {
  regenId.value = node.id
  const result = await regenerateSection(node.id)
  if (!result.ok) {
    message.error(result.error ?? '重新生成失败')
    regenId.value = ''
  }
}

function openEdit(node: OutlineNode) {
  editDraft.value = { id: node.id, title: node.title, markdown: explanationOf(node.id)?.markdown ?? '' }
  editOpen.value = true
}

async function submitEdit() {
  const result = await saveSection(editDraft.value.id, editDraft.value.markdown)
  if (result.ok) {
    message.success('已保存本节修改')
    editOpen.value = false
  } else {
    message.error('保存失败')
  }
}

async function onExport(key: string) {
  const format = key as ExportFormat
  if (format === 'pdf') message.loading('正在渲染 PDF…', { duration: 1500 })
  const result = await exportArtifact(format)
  if (result.canceled) return
  if (result.ok) {
    message.success(`已导出：${result.path}`, { duration: 6000 })
  } else {
    message.error(result.error ?? '导出失败', { duration: 8000 })
  }
}

watch(
  () => state.progress?.title,
  async (sectionTitleValue) => {
    if (!sectionTitleValue) return
    const node = outline.value.find((item) => item.title === sectionTitleValue)
    if (!node) return
    activeSection.value = node.id
    await nextTick()
    scrollTo(node.id)
  }
)

watch(
  () => state.artifact?.id,
  () => {
    activeSection.value = outline.value[0]?.id ?? ''
    regenId.value = ''
  }
)

watch(
  () => state.generating,
  (generating) => {
    if (!generating) regenId.value = ''
  }
)
</script>

<template>
  <div class="page lesson-page">
    <header class="page-head lesson-head">
      <div class="lesson-title-wrap">
        <n-button quaternary circle size="small" class="back-btn" @click="goLibrary">
          <Icon name="arrowLeft" :size="16" />
        </n-button>
        <div>
          <h1 class="lesson-title">{{ title }}</h1>
          <div class="lesson-meta">
            <template v-if="artifact">
              <span>{{ artifact.providerName }} · {{ artifact.model }}</span>
              <span class="dot">·</span>
              <span>{{ formatDateTime(artifact.createdAt) }}</span>
              <span class="dot">·</span>
              <span>{{ outline.length }} 个知识点</span>
              <span class="dot">·</span>
              <span>{{ keyPoints.length }} 条重点</span>
              <span v-if="artifact.stats" class="dot">·</span>
              <span v-if="artifact.stats">{{ formatNumber(artifact.stats.chars) }} 字</span>
            </template>
            <template v-else-if="doc">
              <span>{{ formatNumber(doc.meta.charCount) }} 字</span>
              <span class="dot">·</span>
              <span>{{ doc.meta.blockCount }} 个内容块</span>
              <span class="dot">·</span>
              <span>未生成讲解</span>
            </template>
          </div>
        </div>
      </div>

      <div class="lesson-actions">
        <template v-if="state.generating">
          <n-button size="small" quaternary @click="onCancel" :loading="state.canceling">
            <template #icon><Icon name="close" :size="14" /></template>
            取消
          </n-button>
        </template>
        <template v-else-if="artifact">
          <n-button size="small" quaternary :disabled="!outline.length" @click="onRegenerateAll">
            <template #icon><Icon name="refresh" :size="14" /></template>
            重新生成
          </n-button>
          <n-dropdown :options="exportOptions" trigger="click" @select="onExport">
            <n-button size="small" type="primary">
              <template #icon><Icon name="download" :size="14" /></template>
              导出
            </n-button>
          </n-dropdown>
        </template>
      </div>
    </header>

    <!-- 未生成：准备面板 -->
    <section v-if="!artifact && !state.generating" class="prepare-wrap">
      <div class="prepare-card">
        <div class="prepare-icon"><Icon name="sparkles" :size="26" /></div>
        <h2>{{ doc ? doc.title : '还没有选择材料' }}</h2>
        <p v-if="doc" class="prepare-desc">
          约 {{ formatNumber(doc.meta.charCount) }} 字 · {{ doc.meta.blockCount }} 个内容块。AI 会先拆出 5-8 个知识点，
          再逐节讲解，最后划出「必须掌握 / 理解即可 / 了解即可」三档重点。
        </p>
        <p v-else class="prepare-desc">请先回到资料库选择或导入一份材料。</p>

        <div class="prepare-steps">
          <div class="prepare-step">
            <span class="step-idx">01</span>
            <div><strong>拆解大纲</strong><small>按认知顺序排知识点</small></div>
          </div>
          <div class="prepare-step">
            <span class="step-idx">02</span>
            <div><strong>逐节讲解</strong><small>公式 / 例子 / 易错点</small></div>
          </div>
          <div class="prepare-step">
            <span class="step-idx">03</span>
            <div><strong>划重点</strong><small>三档等级 + 导出</small></div>
          </div>
        </div>

        <div class="prepare-foot">
          <n-button v-if="doc" type="primary" size="large" :loading="starting" @click="onStart">
            开始生成讲解
          </n-button>
          <n-button v-else type="primary" size="large" @click="goLibrary">去资料库选择材料</n-button>
          <span class="prepare-hint">
            使用
            <button class="inline-link" @click="goSettings">
              {{ provider ? (provider.kind === 'demo' ? '本地演示模型' : provider.model) : '未配置模型' }}
            </button>
            ，预计 1-3 分钟
          </span>
        </div>
      </div>
    </section>

    <!-- 生成中 / 已有内容 -->
    <template v-else>
      <div v-if="state.generating" class="progress-strip">
        <div class="progress-head">
          <span class="progress-phase">{{ phaseLabel }}</span>
          <span class="progress-msg">{{ state.progress?.message }}</span>
          <span class="progress-count" v-if="state.progress?.total">
            {{ Math.min(state.progress.current ?? 0, state.progress.total) }}/{{ state.progress.total }}
          </span>
        </div>
        <n-progress type="line" :percentage="percent" :height="5" :show-indicator="false" :processing="true" />
      </div>

      <n-alert v-if="state.error" type="error" :bordered="false" class="lesson-alert" closable @close="state.error = ''">
        {{ state.error }}
      </n-alert>
      <n-alert
        v-for="(warning, index) in artifact?.warnings ?? []"
        :key="index"
        type="warning"
        :bordered="false"
        class="lesson-alert"
      >
        {{ warning }}
      </n-alert>

      <div class="lesson-body">
        <aside class="outline-panel">
          <div class="panel-head">
            <span>讲解大纲</span>
            <span class="panel-count">{{ outline.length }}</span>
          </div>
          <div class="outline-list">
            <button
              v-for="(node, index) in outline"
              :key="node.id"
              class="outline-item"
              :class="{
                active: activeSection === node.id,
                streaming: state.generating && state.progress?.title === node.title,
                done: Boolean(explanationOf(node.id))
              }"
              @click="scrollTo(node.id)"
            >
              <span class="outline-idx">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="outline-text">{{ node.title }}</span>
              <span v-if="keyPointsOf(node.id).length" class="outline-dot">{{ keyPointsOf(node.id).length }}</span>
            </button>
            <div v-if="!outline.length" class="outline-empty">
              <n-spin size="small" />
              <span>{{ state.generating ? '正在设计大纲…' : '暂无大纲' }}</span>
            </div>
          </div>
        </aside>

        <div class="content-panel" ref="contentRef">
          <article
            v-for="(node, index) in outline"
            :id="`sec-${node.id}`"
            :key="node.id"
            class="section-card"
            :ref="(el) => onSectionRef(node.id, el)"
          >
            <div class="section-head">
              <div class="section-heading">
                <span class="section-num">{{ String(index + 1).padStart(2, '0') }}</span>
                <h2>{{ node.title }}</h2>
              </div>
              <div class="section-tools">
                <span v-if="explanationOf(node.id)?.manual" class="manual-tag">已编辑</span>
                <n-button text size="tiny" :disabled="!explanationOf(node.id)" @click="openEdit(node)">
                  <template #icon><Icon name="edit" :size="13" /></template>
                  编辑
                </n-button>
                <n-button text size="tiny" @click="onRegenerateSection(node)">
                  <template #icon><Icon name="refresh" :size="13" /></template>
                  重生成
                </n-button>
              </div>
            </div>
            <p v-if="node.summary" class="section-summary">{{ node.summary }}</p>

            <div v-if="displayMarkdown(node.id)" class="md-wrap">
              <MarkdownView :markdown="displayMarkdown(node.id)" />
              <span v-if="isStreaming(node.id)" class="stream-caret" />
            </div>
            <div v-else class="section-placeholder">
              <n-spin v-if="state.generating" size="small" />
              <span>{{ state.generating ? '等待生成…' : '这一节还没有内容，可以点「重生成」' }}</span>
            </div>
          </article>

          <div v-if="!outline.length" class="content-empty">
            <n-spin v-if="state.generating" size="large" />
            <p>{{ state.generating ? state.progress?.message ?? '正在生成…' : '还没有讲解内容' }}</p>
          </div>
        </div>

        <aside class="kp-panel">
          <div class="panel-head">
            <span>重点划分</span>
            <span class="panel-count">{{ keyPoints.length }}</span>
          </div>
          <div class="kp-filter">
            <button class="kp-filter-btn" :class="{ active: kpFilter === 'all' }" @click="kpFilter = 'all'">全部</button>
            <button class="kp-filter-btn high" :class="{ active: kpFilter === 'high' }" @click="kpFilter = 'high'">
              必考 {{ levelCount.high }}
            </button>
            <button class="kp-filter-btn medium" :class="{ active: kpFilter === 'medium' }" @click="kpFilter = 'medium'">
              理解 {{ levelCount.medium }}
            </button>
            <button class="kp-filter-btn low" :class="{ active: kpFilter === 'low' }" @click="kpFilter = 'low'">
              了解 {{ levelCount.low }}
            </button>
          </div>
          <div class="kp-list">
            <div v-for="kp in filteredKeyPoints" :key="kp.id" class="kp-item" :class="kp.level">
              <div class="kp-level">
                <Icon name="star" :size="11" />
                {{ LEVEL_LABEL[kp.level] }}
              </div>
              <div class="kp-text" v-html="renderInline(kp.text)" />
              <div class="kp-meta">
                {{ sectionTitle(kp.sectionId) }}
                <template v-if="kp.rationale"> · <span v-html="renderInline(kp.rationale)" /></template>
              </div>
            </div>
            <div v-if="!filteredKeyPoints.length" class="kp-empty">
              {{ state.generating ? '正在划重点…' : '暂无重点' }}
            </div>
          </div>
          <div v-if="artifact?.stats" class="kp-foot">
            生成耗时 {{ Math.round((artifact.stats.elapsedMs ?? 0) / 1000) }}s · 提示词 {{ artifact.promptVersion }}
          </div>
        </aside>
      </div>
    </template>

    <n-modal v-model:show="editOpen" preset="card" :title="`编辑：${editDraft.title}`" :bordered="false" style="width: 760px">
      <n-input
        v-model:value="editDraft.markdown"
        type="textarea"
        :autosize="{ minRows: 14, maxRows: 24 }"
        placeholder="用 Markdown 书写，公式用 $...$ 或 $$...$$"
        class="edit-textarea"
      />
      <template #footer>
        <div class="modal-footer">
          <n-button @click="editOpen = false">取消</n-button>
          <n-button type="primary" @click="submitEdit">保存本节</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.lesson-head {
  align-items: flex-start;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-soft);
  margin-bottom: 16px;
}
.lesson-title-wrap {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
}
.back-btn {
  margin-top: 2px;
}
.lesson-title {
  font-size: 20px;
  margin: 0 0 6px;
  line-height: 1.35;
  letter-spacing: 0.2px;
}
.lesson-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 12.5px;
  color: var(--text-muted);
}
.lesson-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.progress-strip {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 14px;
  box-shadow: var(--shadow-sm);
}
.progress-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12.5px;
}
.progress-phase {
  font-weight: 600;
  color: var(--primary);
}
.progress-msg {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.progress-count {
  margin-left: auto;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.lesson-alert {
  margin-bottom: 10px;
}
.lesson-body {
  display: grid;
  grid-template-columns: 226px minmax(0, 1fr) 288px;
  gap: 16px;
  align-items: start;
  flex: 1;
  min-height: 0;
}
.outline-panel,
.kp-panel {
  position: sticky;
  top: 0;
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 14px 12px;
  box-shadow: var(--shadow-sm);
  max-height: calc(100vh - 190px);
  display: flex;
  flex-direction: column;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-strong);
  padding: 0 4px 10px;
  letter-spacing: 0.3px;
}
.panel-count {
  color: var(--text-faint);
  font-weight: 500;
}
.outline-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 -4px;
  padding: 0 4px;
}
.outline-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px 8px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-regular);
  font-size: 13px;
  line-height: 1.45;
  transition: background 0.15s ease, color 0.15s ease;
}
.outline-item:hover {
  background: #f4f6fb;
}
.outline-item.active {
  background: #eef2ff;
  color: var(--primary);
  font-weight: 500;
}
.outline-item.streaming .outline-idx {
  color: var(--primary);
}
.outline-idx {
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  padding-top: 2px;
}
.outline-text {
  flex: 1;
  min-width: 0;
}
.outline-dot {
  font-size: 10.5px;
  color: #b7791f;
  background: #fdf6e3;
  border-radius: 5px;
  padding: 0 5px;
  line-height: 16px;
  flex-shrink: 0;
}
.outline-empty {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-faint);
  font-size: 12.5px;
  padding: 8px;
}
.content-panel {
  overflow-y: auto;
  max-height: calc(100vh - 190px);
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.section-card {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 20px 24px 22px;
  box-shadow: var(--shadow-sm);
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.section-heading {
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-width: 0;
}
.section-num {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: #eef2ff;
  border-radius: 6px;
  padding: 2px 6px;
  letter-spacing: 0.5px;
}
.section-heading h2 {
  font-size: 17px;
  margin: 0;
  line-height: 1.4;
  color: var(--text-strong);
}
.section-tools {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.75;
}
.section-tools:hover {
  opacity: 1;
}
.manual-tag {
  font-size: 11px;
  color: #1f9d76;
  background: #e8f7f1;
  padding: 1px 6px;
  border-radius: 5px;
}
.section-summary {
  color: var(--text-muted);
  font-size: 13px;
  margin: 8px 0 0;
}
.md-wrap {
  margin-top: 10px;
  position: relative;
}
.stream-caret {
  display: inline-block;
  width: 8px;
  height: 15px;
  background: var(--primary);
  animation: blink 1s steps(2, start) infinite;
  vertical-align: -2px;
  border-radius: 1px;
}
.section-placeholder {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-faint);
  font-size: 13px;
  padding: 18px 0 6px;
}
.content-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--text-muted);
  padding: 90px 0;
}
.kp-filter {
  display: flex;
  gap: 4px;
  padding: 0 2px 10px;
  flex-wrap: wrap;
}
.kp-filter-btn {
  border: 1px solid var(--border-soft);
  background: #fff;
  border-radius: 7px;
  font-size: 11.5px;
  padding: 3px 8px;
  cursor: pointer;
  color: var(--text-muted);
}
.kp-filter-btn.active {
  background: var(--text-strong);
  color: #fff;
  border-color: var(--text-strong);
}
.kp-filter-btn.high.active {
  background: #c0392b;
  border-color: #c0392b;
}
.kp-filter-btn.medium.active {
  background: #b7791f;
  border-color: #b7791f;
}
.kp-filter-btn.low.active {
  background: #4a6fa5;
  border-color: #4a6fa5;
}
.kp-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px;
}
.kp-item {
  border-radius: 9px;
  padding: 9px 11px;
  border-left: 3px solid #cbd5e1;
  background: #f8fafc;
}
.kp-item.high {
  border-left-color: #c0392b;
  background: #fdf3f2;
}
.kp-item.medium {
  border-left-color: #b7791f;
  background: #fdf9ee;
}
.kp-item.low {
  border-left-color: #4a6fa5;
  background: #f1f5fb;
}
.kp-level {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 3px;
  letter-spacing: 0.3px;
}
.kp-text {
  font-size: 12.8px;
  line-height: 1.7;
  color: var(--text-strong);
  overflow-wrap: anywhere;
  overflow-x: auto;
}
.kp-text :deep(.katex) {
  font-size: 1.02em;
}
.kp-text :deep(.katex-display) {
  margin: 4px 0;
  overflow-x: auto;
}
.kp-text :deep(p) {
  margin: 0;
}
.kp-meta {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.kp-empty {
  color: var(--text-faint);
  font-size: 12.5px;
  padding: 12px 4px;
}
.kp-foot {
  border-top: 1px solid var(--border-soft);
  margin-top: 10px;
  padding-top: 8px;
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
}
.prepare-wrap {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 40px;
}
.prepare-card {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  padding: 40px 44px 32px;
  max-width: 720px;
  width: 100%;
  box-shadow: var(--shadow-md);
  text-align: center;
}
.prepare-icon {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  background: linear-gradient(135deg, #3355d1, #6d8bff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 18px;
  box-shadow: 0 8px 20px rgba(51, 85, 209, 0.28);
}
.prepare-card h2 {
  font-size: 19px;
  margin: 0 0 10px;
}
.prepare-desc {
  color: var(--text-muted);
  font-size: 13.5px;
  line-height: 1.85;
  margin: 0 auto 26px;
  max-width: 520px;
}
.prepare-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 30px;
}
.prepare-step {
  background: #f7f9fc;
  border-radius: 12px;
  padding: 14px 12px;
  text-align: left;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.step-idx {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  background: #e8edff;
  border-radius: 6px;
  padding: 2px 5px;
}
.prepare-step strong {
  display: block;
  font-size: 13px;
  margin-bottom: 2px;
}
.prepare-step small {
  color: var(--text-faint);
  font-size: 11.5px;
}
.prepare-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.prepare-hint {
  font-size: 12px;
  color: var(--text-faint);
}
.inline-link {
  border: none;
  background: none;
  color: var(--primary);
  cursor: pointer;
  padding: 0 2px;
  font-size: inherit;
  font-family: inherit;
}
.edit-modal {
  width: 760px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
