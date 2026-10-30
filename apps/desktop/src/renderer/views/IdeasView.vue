<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import type { IdeaNote } from '@tutor/shared'
import Icon from '../components/Icon.vue'
import MarkdownView from '../components/MarkdownView.vue'
import { loadIdeas, polishIdea, removeIdea, saveIdea, state } from '../store'
import { formatDateTime } from '../utils/format'

const message = useMessage()

const ideas = computed(() => state.ideas)
const keyword = ref('')
const activeId = ref('')

const active = computed<IdeaNote | null>(() => ideas.value.find((item) => item.id === activeId.value) ?? null)

const filtered = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) return ideas.value
  return ideas.value.filter(
    (idea) =>
      idea.title.toLowerCase().includes(word) ||
      idea.content.toLowerCase().includes(word) ||
      idea.tags.some((tag) => tag.toLowerCase().includes(word))
  )
})

/* 编辑草稿：与列表分离，避免每敲一个字就覆盖别人 */
const draft = ref({ title: '', content: '', tagsText: '' })
const saving = ref(false)
const dirty = ref(false)
const preview = ref(true)

function loadDraft(idea: IdeaNote | null) {
  draft.value = {
    title: idea?.title ?? '',
    content: idea?.content ?? '',
    tagsText: (idea?.tags ?? []).join(', ')
  }
  dirty.value = false
}

watch(
  () => activeId.value,
  () => {
    loadDraft(active.value)
  }
)

let saveTimer: number | null = null
function scheduleSave() {
  dirty.value = true
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void persist()
  }, 900)
}

async function persist() {
  if (!active.value || !dirty.value) return
  saving.value = true
  try {
    await saveIdea({
      ...active.value,
      title: draft.value.title,
      content: draft.value.content,
      tags: draft.value.tagsText.split(/[,，\s]+/).filter(Boolean)
    })
    dirty.value = false
  } finally {
    saving.value = false
  }
}

async function createIdea() {
  const idea = await saveIdea({
    id: '',
    title: '新灵感',
    content: '',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'manual'
  })
  activeId.value = idea.id
  await loadDraft(idea)
  message.success('已新建一条灵感，直接开始写吧')
}

async function remove(item: IdeaNote) {
  await removeIdea(item.id)
  if (activeId.value === item.id) activeId.value = ideas.value[0]?.id ?? ''
  message.success('已删除')
}

/* -------------------------------- AI 润色 -------------------------------- */
const polishing = ref<'' | 'polish' | 'outline' | 'title'>('')
const polished = ref('')

async function runPolish(mode: 'polish' | 'outline' | 'title') {
  const text = draft.value.content.trim()
  if (!text) {
    message.warning('先写点内容再让 AI 处理')
    return
  }
  polishing.value = mode
  try {
    const result = await polishIdea({ text, mode, title: draft.value.title })
    if (!result.ok || !result.text) {
      message.error(result.error ?? '处理失败', { duration: 8000 })
      return
    }
    if (mode === 'title') {
      polished.value = result.text
      const first = result.text.split('\n').map((line) => line.replace(/^[-*\d.、\s]+/, '').trim()).filter(Boolean)[0]
      if (first) {
        draft.value.title = first.slice(0, 60)
        scheduleSave()
        message.success('已用第一个候选标题')
      }
      return
    }
    polished.value = result.text
  } finally {
    polishing.value = ''
  }
}

function applyPolished() {
  if (!polished.value) return
  draft.value.content = polished.value
  polished.value = ''
  scheduleSave()
  message.success('已替换为 AI 版本')
}

/* -------------------------------- 导出 -------------------------------- */
function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function noteToMarkdown(idea: IdeaNote): string {
  const lines = [`# ${idea.title || '未命名灵感'}`, '']
  if (idea.tags.length) lines.push(`> 标签：${idea.tags.join(' / ')}`, '')
  lines.push(`> 创建：${new Date(idea.createdAt).toLocaleString('zh-CN')} · 更新：${new Date(idea.updatedAt).toLocaleString('zh-CN')}`, '')
  lines.push(idea.content || '（空）', '')
  return lines.join('\n')
}

function exportCurrent() {
  if (!active.value) return
  download(`${(draft.value.title || '灵感').replace(/[\\/:*?"<>|]/g, '-')}.md`, noteToMarkdown({ ...active.value, ...draft.value, tags: draft.value.tagsText.split(/[,，\s]+/).filter(Boolean) } as IdeaNote))
  message.success('已导出当前灵感')
}

function exportAll() {
  if (!ideas.value.length) {
    message.warning('还没有灵感可导出')
    return
  }
  const text = ideas.value.map((idea) => noteToMarkdown(idea)).join('\n---\n\n')
  download(`灵感记录-${new Date().toISOString().slice(0, 10)}.md`, `# 灵感记录合集\n\n共 ${ideas.value.length} 条\n\n---\n\n${text}`)
  message.success(`已导出 ${ideas.value.length} 条灵感`)
}

function exportJson() {
  if (!ideas.value.length) return
  download(
    `灵感记录-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), ideas: ideas.value }, null, 2)
  )
  message.success('已导出 JSON')
}

onMounted(async () => {
  if (!state.ideas.length) await loadIdeas()
  if (!activeId.value && ideas.value.length) activeId.value = ideas.value[0].id
})
</script>

<template>
  <div class="page ideas-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1>灵感</h1>
        <p>随手记下临时想法，AI 帮你润色成通顺段落，最后导出成 Markdown 带走。</p>
      </div>
      <div class="head-side">
        <n-button size="small" quaternary @click="exportAll">导出全部</n-button>
        <n-button size="small" quaternary @click="exportJson">导出 JSON</n-button>
        <n-button size="small" type="primary" @click="createIdea">
          <template #icon><Icon name="plus" :size="14" /></template>
          新建灵感
        </n-button>
      </div>
    </header>

    <div v-if="!ideas.length" class="empty-state" style="padding-top: 40px">
      <div class="empty-visual">
        <div class="empty-card card-a"><Icon name="bulb" :size="18" /></div>
        <div class="empty-card card-b"><Icon name="sparkles" :size="20" /></div>
        <div class="empty-card card-c"><Icon name="edit" :size="18" /></div>
      </div>
      <h3>还没有灵感记录</h3>
      <p>点右上「新建灵感」，把突发的想法、老师随口提的一句、做题时想到的思路记下来；写乱了就点「AI 润色」。</p>
      <n-button type="primary" @click="createIdea">记下第一条</n-button>
    </div>

    <div v-else class="ideas-body">
      <aside class="idea-list">
        <n-input v-model:value="keyword" size="small" placeholder="搜索标题 / 内容 / 标签" clearable />
        <button
          v-for="idea in filtered"
          :key="idea.id"
          class="idea-item"
          :class="{ active: idea.id === activeId }"
          @click="activeId = idea.id"
        >
          <div class="idea-title">{{ idea.title || '未命名灵感' }}</div>
          <div class="idea-meta">{{ formatDateTime(Date.parse(idea.updatedAt)) }}</div>
          <div v-if="idea.content" class="idea-preview">{{ idea.content.replace(/\s+/g, ' ').slice(0, 48) }}</div>
        </button>
        <div v-if="!filtered.length" class="idea-empty">没有匹配的灵感</div>
      </aside>

      <section v-if="active" class="idea-editor">
        <div class="editor-head">
          <n-input v-model:value="draft.title" placeholder="标题" @update:value="scheduleSave" />
          <div class="editor-tools">
            <n-button size="tiny" quaternary @click="preview = !preview">{{ preview ? '编辑模式' : '预览模式' }}</n-button>
            <n-popconfirm @positive-click="remove(active)">
              <template #trigger>
                <n-button size="tiny" quaternary type="error">删除</n-button>
              </template>
              删除这条灵感？
            </n-popconfirm>
            <n-button size="tiny" @click="exportCurrent">导出 .md</n-button>
          </div>
        </div>

        <div class="editor-tags">
          <n-input v-model:value="draft.tagsText" size="small" placeholder="标签，用逗号分隔（如：高数, 想法）" @update:value="scheduleSave" />
          <span class="save-state">{{ saving ? '保存中…' : dirty ? '未保存' : '已保存' }}</span>
        </div>

        <div class="editor-body">
          <template v-if="preview">
            <div class="preview-pane">
              <MarkdownView v-if="draft.content.trim()" :markdown="draft.content" />
              <div v-else class="preview-empty">还没有内容，切到「编辑模式」开始写</div>
            </div>
          </template>
          <n-input
            v-else
            v-model:value="draft.content"
            type="textarea"
            placeholder="随手记：想到什么写什么，写乱了再让 AI 润色…"
            :autosize="{ minRows: 12, maxRows: 30 }"
            @update:value="scheduleSave"
          />
        </div>

        <div class="ai-bar">
          <span class="ai-label"><Icon name="sparkles" :size="13" /> AI 处理</span>
          <n-button size="small" :loading="polishing === 'polish'" @click="runPolish('polish')">润色成通顺文字</n-button>
          <n-button size="small" :loading="polishing === 'outline'" @click="runPolish('outline')">整理成要点</n-button>
          <n-button size="small" :loading="polishing === 'title'" @click="runPolish('title')">起标题</n-button>
          <span class="ai-tip">需要真实模型（设置里配置）</span>
        </div>

        <div v-if="polished" class="polished-box">
          <div class="polished-head">
            <span>AI 结果（可替换原文）</span>
            <div>
              <n-button size="tiny" type="primary" @click="applyPolished">替换原文</n-button>
              <n-button size="tiny" quaternary @click="polished = ''">丢弃</n-button>
            </div>
          </div>
          <pre class="polished-text">{{ polished }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ideas-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.idea-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
}
.idea-item {
  text-align: left;
  border: 1px solid var(--border-soft);
  background: #fff;
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.idea-item.active {
  border-color: var(--primary);
  background: #f4f7ff;
  box-shadow: 0 0 0 2px rgba(51, 85, 209, 0.08);
}
.idea-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.idea-meta {
  font-size: 10.5px;
  color: var(--text-faint);
}
.idea-preview {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.idea-empty {
  font-size: 12px;
  color: var(--text-faint);
  padding: 12px 4px;
}
.idea-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 14px 16px;
  min-height: 0;
}
.editor-head {
  display: flex;
  gap: 10px;
  align-items: center;
}
.editor-tools {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.editor-tags {
  display: flex;
  align-items: center;
  gap: 10px;
}
.save-state {
  font-size: 11px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.editor-body {
  flex: 1;
  min-height: 220px;
  display: flex;
}
.preview-pane {
  flex: 1;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 12px 14px;
  overflow-y: auto;
  background: #fbfcff;
  font-size: 13px;
  line-height: 1.8;
}
.preview-empty {
  color: var(--text-faint);
  font-size: 12.5px;
}
.editor-body :deep(.n-input) {
  flex: 1;
}
.ai-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px dashed var(--border-soft);
  padding-top: 10px;
}
.ai-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: #6d28d9;
  font-weight: 600;
}
.ai-tip {
  font-size: 10.5px;
  color: var(--text-faint);
}
.polished-box {
  border: 1px solid #e6def7;
  background: #fdfbff;
  border-radius: 10px;
  padding: 10px 12px;
}
.polished-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  color: #6d28d9;
  font-weight: 600;
  margin-bottom: 6px;
}
.polished-text {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-regular);
  max-height: 240px;
  overflow-y: auto;
  font-family: inherit;
}

@media (max-width: 860px) {
  .ideas-body {
    grid-template-columns: 1fr;
  }
  .idea-list {
    flex-direction: row;
    overflow-x: auto;
  }
  .idea-item {
    min-width: 180px;
    flex: 0 0 auto;
  }
}
</style>
