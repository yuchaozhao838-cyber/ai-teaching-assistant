<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { MistakeItem, MistakeStatus } from '@tutor/shared'
import { mistakeSummary } from '@tutor/study'
import Icon from './Icon.vue'
import MarkdownView from './MarkdownView.vue'
import { addMistakes, clearMasteredMistakes, removeMistake, state, updateMistake } from '../store'
import { formatDateTime } from '../utils/format'
import { renderInline } from '../utils/markdown'

const message = useMessage()

const statusFilter = ref<'all' | MistakeStatus>('learning')
const knowledgeFilter = ref<string>('')
const expanded = ref<Record<string, boolean>>({})

const mistakes = computed(() => state.mistakes)
const summary = computed(() => mistakeSummary(mistakes.value))

const knowledgeOptions = computed(() => [
  { label: '全部知识点', value: '' },
  ...summary.value.byKnowledge.map((item) => ({ label: `${item.knowledge}（${item.count}）`, value: item.knowledge }))
])

const list = computed(() => {
  return mistakes.value.filter((item) => {
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) return false
    if (knowledgeFilter.value && (item.knowledgePoint?.trim() || '未标注知识点') !== knowledgeFilter.value) return false
    return true
  })
})

function toggle(item: MistakeItem) {
  expanded.value = { ...expanded.value, [item.id]: !expanded.value[item.id] }
}

async function markMastered(item: MistakeItem) {
  await updateMistake(item.id, {
    status: 'mastered',
    reviewCount: item.reviewCount + 1,
    lastReviewedAt: new Date().toISOString()
  })
  message.success('已标记为掌握')
}

async function markLearning(item: MistakeItem) {
  await updateMistake(item.id, {
    status: 'learning',
    reviewCount: item.reviewCount + 1,
    lastReviewedAt: new Date().toISOString()
  })
  message.info('已记录一次复习，保持关注')
}

async function remove(item: MistakeItem) {
  await removeMistake(item.id)
  message.success('已移除')
}

async function clearMastered() {
  await clearMasteredMistakes()
  message.success('已清空掌握的错题')
}

/* -------------------------------- 手动添加 -------------------------------- */
const addOpen = ref(false)
const draft = ref({
  knowledgePoint: '',
  type: 'short' as MistakeItem['type'],
  stem: '',
  optionsText: '',
  answer: '',
  explanation: '',
  wrongAnswer: ''
})

function openAdd() {
  draft.value = { knowledgePoint: '', type: 'short', stem: '', optionsText: '', answer: '', explanation: '', wrongAnswer: '' }
  addOpen.value = true
}

async function saveAdd() {
  if (!draft.value.stem.trim()) {
    message.warning('题干不能为空')
    return
  }
  await addMistakes([
    {
      source: 'manual',
      knowledgePoint: draft.value.knowledgePoint.trim() || undefined,
      type: draft.value.type,
      stem: draft.value.stem,
      options: draft.value.optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      answer: draft.value.answer,
      explanation: draft.value.explanation,
      wrongAnswer: draft.value.wrongAnswer || undefined
    }
  ])
  addOpen.value = false
  message.success('已加入错题本')
}

const TYPE_LABEL: Record<MistakeItem['type'], string> = {
  single: '单选',
  multiple: '多选',
  blank: '填空',
  short: '简答'
}
</script>

<template>
  <div class="mistakes-panel">
    <div class="mistake-head">
      <div class="mistake-nums">
        <span class="num-strong">{{ summary.learning }}</span> 待掌握
        <span class="dot">·</span>
        <span class="num-muted">{{ summary.mastered }}</span> 已掌握
        <span class="dot">·</span>
        共 {{ summary.total }} 题
      </div>
      <div class="mistake-actions">
        <n-button size="tiny" type="primary" @click="openAdd">
          <template #icon><Icon name="plus" :size="13" /></template>
          手动添加
        </n-button>
        <n-button v-if="summary.mastered" size="tiny" quaternary @click="clearMastered">清空已掌握</n-button>
      </div>
    </div>

    <div class="mistake-filters">
      <n-radio-group v-model:value="statusFilter" size="small">
        <n-radio-button value="learning">待掌握</n-radio-button>
        <n-radio-button value="mastered">已掌握</n-radio-button>
        <n-radio-button value="all">全部</n-radio-button>
      </n-radio-group>
      <n-select
        v-model:value="knowledgeFilter"
        size="small"
        style="width: 180px"
        :options="knowledgeOptions"
      />
    </div>

    <div v-if="!list.length" class="mistake-empty">
      {{ statusFilter === 'learning' ? '没有待掌握的错题，保持住！' : '这里还是空的' }}
      <div class="empty-tip">做习题时点「错题」按钮，或点右上「手动添加」，都会进到这里</div>
    </div>

    <article v-for="item in list" :key="item.id" class="mistake-card" :class="item.status">
      <div class="mistake-meta">
        <span class="badge" :class="item.status">{{ item.status === 'mastered' ? '已掌握' : '待掌握' }}</span>
        <span class="badge-type">{{ TYPE_LABEL[item.type] }}</span>
        <span v-if="item.knowledgePoint" class="badge-knowledge">{{ item.knowledgePoint }}</span>
        <span class="badge-source">{{ item.source === 'quiz' ? '来自练习' : '手动录入' }}</span>
        <span class="mistake-time">{{ formatDateTime(Date.parse(item.createdAt)) }}</span>
      </div>

      <div class="mistake-stem"><MarkdownView :markdown="item.stem" /></div>

      <ul v-if="item.options?.length" class="mistake-options">
        <li v-for="(option, index) in item.options" :key="index">
          <span class="option-letter">{{ String.fromCharCode(65 + index) }}.</span>
          <span v-html="renderInline(option)" />
        </li>
      </ul>

      <div v-if="item.wrongAnswer" class="wrong-answer">当时选错：{{ item.wrongAnswer }}</div>

      <div class="mistake-tools">
        <n-button size="tiny" :ghost="!expanded[item.id]" :type="expanded[item.id] ? 'default' : 'primary'" @click="toggle(item)">
          {{ expanded[item.id] ? '收起答案' : '看答案与解析' }}
        </n-button>
        <n-button v-if="item.status !== 'mastered'" size="tiny" type="success" @click="markMastered(item)">已掌握</n-button>
        <n-button v-else size="tiny" @click="markLearning(item)">仍不会</n-button>
        <n-button size="tiny" quaternary @click="remove(item)">移除</n-button>
        <span class="review-hint">复习 {{ item.reviewCount }} 次</span>
      </div>

      <div v-if="expanded[item.id]" class="answer-block">
        <div class="answer-line">
          <span class="answer-label">答案</span>
          <div class="answer-content"><MarkdownView :markdown="item.answer" /></div>
        </div>
        <div class="answer-line">
          <span class="answer-label">解析</span>
          <div class="answer-content"><MarkdownView :markdown="item.explanation" /></div>
        </div>
      </div>
    </article>

    <n-modal v-model:show="addOpen" preset="card" title="手动添加错题" :bordered="false" style="width: 720px">
      <n-form label-placement="top" :show-feedback="false">
        <div class="form-row">
          <n-form-item label="知识点" style="flex: 1">
            <n-input v-model:value="draft.knowledgePoint" placeholder="例如：链式法则" />
          </n-form-item>
          <n-form-item label="题型" style="flex: 1">
            <n-select
              v-model:value="draft.type"
              :options="[
                { label: '单选', value: 'single' },
                { label: '多选', value: 'multiple' },
                { label: '填空', value: 'blank' },
                { label: '简答', value: 'short' }
              ]"
            />
          </n-form-item>
        </div>
        <n-form-item label="题干（支持 Markdown / LaTeX）">
          <n-input v-model:value="draft.stem" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" />
        </n-form-item>
        <n-form-item label="选项（一行一个，可留空）">
          <n-input v-model:value="draft.optionsText" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="正确答案" style="flex: 1">
            <n-input v-model:value="draft.answer" />
          </n-form-item>
          <n-form-item label="当时选错（可留空）" style="flex: 1">
            <n-input v-model:value="draft.wrongAnswer" />
          </n-form-item>
        </div>
        <n-form-item label="解析">
          <n-input v-model:value="draft.explanation" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="addOpen = false">取消</n-button>
          <n-button type="primary" @click="saveAdd">加入错题本</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.mistakes-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mistake-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.mistake-nums {
  font-size: 12.5px;
  color: var(--text-muted);
}
.num-strong {
  font-size: 17px;
  font-weight: 700;
  color: #d97706;
}
.num-muted {
  font-weight: 700;
  color: #1f9d76;
}
.dot {
  margin: 0 6px;
  color: var(--border-strong);
}
.mistake-actions {
  display: flex;
  gap: 6px;
}
.mistake-filters {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.mistake-empty {
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
  padding: 40px 0;
}
.empty-tip {
  font-size: 11.5px;
  margin-top: 6px;
}
.mistake-card {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-left: 3px solid #e8a33d;
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: var(--shadow-sm);
}
.mistake-card.mastered {
  border-left-color: #1f9d76;
  opacity: 0.85;
}
.mistake-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--text-faint);
  margin-bottom: 8px;
}
.badge {
  border-radius: 5px;
  padding: 1px 6px;
  font-weight: 600;
}
.badge.learning {
  background: #fdf3e3;
  color: #b7791f;
}
.badge.mastered {
  background: #e8f7f1;
  color: #1f9d76;
}
.badge-type,
.badge-knowledge,
.badge-source {
  background: #f2f5fb;
  color: #5a6b85;
  border-radius: 5px;
  padding: 1px 6px;
}
.mistake-time {
  margin-left: auto;
}
.mistake-stem {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text-strong);
}
.mistake-options {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12.5px;
  color: var(--text-regular);
}
.option-letter {
  font-weight: 700;
  color: var(--text-muted);
  margin-right: 4px;
}
.wrong-answer {
  margin-top: 8px;
  font-size: 12px;
  color: #c53030;
  background: #fdf2f2;
  border-radius: 6px;
  padding: 4px 8px;
  display: inline-block;
}
.mistake-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.review-hint {
  font-size: 10.5px;
  color: var(--text-faint);
}
.answer-block {
  margin-top: 10px;
  border-top: 1px dashed var(--border-soft);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.answer-line {
  display: flex;
  gap: 10px;
}
.answer-label {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: #1f9d76;
  background: #e8f7f1;
  border-radius: 6px;
  padding: 1px 8px;
  height: 20px;
  line-height: 18px;
  margin-top: 3px;
}
.answer-line:last-child .answer-label {
  color: #b7791f;
  background: #fdf6e3;
}
.answer-content {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.8;
}
.form-row {
  display: flex;
  gap: 12px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
