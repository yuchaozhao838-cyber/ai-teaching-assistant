<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { ProblemDifficulty, ProblemItem, ProblemSet, ProblemType } from '@tutor/shared'
import Icon from '../components/Icon.vue'
import MarkdownView from '../components/MarkdownView.vue'
import {
  activeProvider,
  createManualProblemSet,
  deleteProblemSet,
  generateProblemSet,
  goPractice,
  saveProblemSet,
  state
} from '../store'
import { formatDateTime } from '../utils/format'
import { renderInline } from '../utils/markdown'

const message = useMessage()

const TYPE_LABEL: Record<ProblemType, string> = {
  choice: '选择题',
  fill: '填空题',
  calc: '计算题',
  proof: '证明题',
  short: '简答题'
}

const DIFF_LABEL: Record<ProblemDifficulty, string> = {
  easy: '基础',
  medium: '中等',
  hard: '进阶'
}

const selectedId = ref('')
const revealed = ref<Record<string, boolean>>({})
const generating = ref(false)

// 生成弹窗
const genOpen = ref(false)
const genSource = ref<'document' | 'topic'>('document')
const genDocumentId = ref('')
const genTopic = ref('')
const genMode = ref<'create' | 'extract'>('create')
const genCount = ref(6)
const genDifficulty = ref<'mixed' | ProblemDifficulty>('mixed')
const genTypes = ref<ProblemType[]>(['choice', 'calc'])

// 编辑弹窗
const editOpen = ref(false)
const editItem = ref<ProblemItem | null>(null)
const editIsNew = ref(false)
const editOptionsText = ref('')

const provider = computed(() => activeProvider())
const sets = computed(() => state.problemSets)
const current = computed<ProblemSet | null>(() => sets.value.find((s) => s.id === selectedId.value) ?? sets.value[0] ?? null)

const documentOptions = computed(() => state.docs.map((doc) => ({ label: doc.title, value: doc.id })))

const options = computed(() =>
  [
    { label: '选择题', value: 'choice' },
    { label: '填空题', value: 'fill' },
    { label: '计算题', value: 'calc' },
    { label: '证明题', value: 'proof' },
    { label: '简答题', value: 'short' }
  ] as Array<{ label: string; value: ProblemType }>
)

function selectSet(id: string) {
  selectedId.value = id
  revealed.value = {}
}

function toggleItem(item: ProblemItem) {
  revealed.value = { ...revealed.value, [item.id]: !revealed.value[item.id] }
}

function revealAll(value: boolean) {
  if (!current.value) return
  const next: Record<string, boolean> = {}
  for (const item of current.value.items) next[item.id] = value
  revealed.value = next
}

async function onGenerate() {
  if (genSource.value === 'document' && !genDocumentId.value) {
    message.warning('请选择一份材料')
    return
  }
  if (genSource.value === 'topic' && !genTopic.value.trim()) {
    message.warning('请填写出题主题，例如「导数与微分的计算」')
    return
  }
  generating.value = true
  try {
    const result = await generateProblemSet({
      documentId: genSource.value === 'document' ? genDocumentId.value : undefined,
      topic: genSource.value === 'topic' ? genTopic.value.trim() : undefined,
      mode: genMode.value,
      count: genCount.value,
      difficulty: genDifficulty.value,
      types: genTypes.value
    })
    if (result.ok && result.set) {
      genOpen.value = false
      selectSet(result.set.id)
      message.success(`已生成 ${result.set.items.length} 道题`, { duration: 5000 })
      for (const warning of result.warnings ?? []) message.warning(warning, { duration: 7000 })
    } else {
      message.error(result.error ?? '生成失败', { duration: 9000 })
    }
  } finally {
    generating.value = false
  }
}

async function onCreateManual() {
  const result = await createManualProblemSet('我的题集')
  if (result.ok && result.set) {
    selectSet(result.set.id)
    message.success('已创建空白题集，点「添加一题」自己出题')
  }
}

async function onDeleteSet() {
  if (!current.value) return
  await deleteProblemSet(current.value.id)
  selectedId.value = ''
  message.success('已删除题集')
}

function openEdit(item: ProblemItem | null) {
  editIsNew.value = !item
  editItem.value = item
    ? { ...item, options: [...item.options] }
    : {
        id: `prb_${Date.now().toString(36)}`,
        type: 'calc',
        difficulty: 'medium',
        stem: '',
        options: [],
        answer: '',
        explanation: '',
        origin: 'manual'
      }
  editOptionsText.value = (editItem.value?.options ?? []).join('\n')
  editOpen.value = true
}

async function saveEdit() {
  if (!current.value || !editItem.value) return
  const item = editItem.value
  if (!item.stem.trim()) {
    message.warning('题干不能为空')
    return
  }
  const optionsList = editOptionsText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const next: ProblemSet = {
    ...current.value,
    items: editIsNew.value
      ? [...current.value.items, { ...item, options: item.type === 'choice' ? optionsList : [] }]
      : current.value.items.map((existing) =>
          existing.id === item.id ? { ...item, options: item.type === 'choice' ? optionsList : [] } : existing
        )
  }
  const result = await saveProblemSet(next)
  if (result.ok) {
    editOpen.value = false
    message.success(editIsNew.value ? '已添加题目' : '已保存修改')
  } else {
    message.error(result.error ?? '保存失败')
  }
}

async function removeItem(item: ProblemItem) {
  if (!current.value) return
  const next: ProblemSet = { ...current.value, items: current.value.items.filter((x) => x.id !== item.id) }
  const result = await saveProblemSet(next)
  if (result.ok) message.success('已删除该题')
}

function typeOf(item: ProblemItem): string {
  return TYPE_LABEL[item.type] ?? '题目'
}

function diffOf(item: ProblemItem): string {
  return DIFF_LABEL[item.difficulty] ?? item.difficulty
}

function modeLabel(set: ProblemSet): string {
  if (set.mode === 'extract') return '整理已有题目'
  if (set.mode === 'manual') return '自己出题'
  return 'AI 出题'
}

void goPractice()
</script>

<template>
  <div class="page practice-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1>练习</h1>
        <p>按材料出题或整理现成题目，附逐步解析。答案默认收起，想看再点开——不强制做题。</p>
      </div>
      <div class="head-side">
        <n-button size="small" quaternary @click="onCreateManual">
          <template #icon><Icon name="plus" :size="14" /></template>
          空白题集
        </n-button>
        <n-button size="small" type="primary" @click="genOpen = true">
          <template #icon><Icon name="sparkles" :size="14" /></template>
          生成习题
        </n-button>
      </div>
    </header>

    <div v-if="!sets.length" class="empty-state" style="padding-top: 40px">
      <div class="empty-visual">
        <div class="empty-card card-a"><Icon name="edit" :size="18" /></div>
        <div class="empty-card card-b"><Icon name="sparkles" :size="20" /></div>
        <div class="empty-card card-c"><Icon name="star" :size="18" /></div>
      </div>
      <h3>还没有习题</h3>
      <p>
        点右上角「生成习题」：选一份材料，让 AI 出题并写解析；也可以选「整理已有题目」，把老师课件或网上的题整理成题目 + 答案 + 解析，
        或者直接建一份空白题集，自己出题。
      </p>
      <n-button type="primary" @click="genOpen = true">生成第一份习题</n-button>
    </div>

    <div v-else class="practice-body">
      <aside class="set-list">
        <button
          v-for="set in sets"
          :key="set.id"
          class="set-item"
          :class="{ active: current && current.id === set.id }"
          @click="selectSet(set.id)"
        >
          <span class="set-title">{{ set.title }}</span>
          <span class="set-meta">{{ modeLabel(set) }} · {{ set.items.length }} 题</span>
        </button>
      </aside>

      <div v-if="current" class="set-detail">
        <div class="detail-head">
          <div>
            <h2>{{ current.title }}</h2>
            <div class="detail-meta">
              <span>{{ modeLabel(current) }}</span>
              <span class="dot">·</span>
              <span>{{ current.items.length }} 题</span>
              <template v-if="current.model">
                <span class="dot">·</span>
                <span>{{ current.providerName }} · {{ current.model }}</span>
              </template>
              <span class="dot">·</span>
              <span>{{ formatDateTime(current.createdAt) }}</span>
            </div>
          </div>
          <div class="detail-actions">
            <n-button size="tiny" quaternary @click="revealAll(true)">全部展开答案</n-button>
            <n-button size="tiny" quaternary @click="revealAll(false)">全部收起</n-button>
            <n-button size="tiny" quaternary @click="openEdit(null)">添加一题</n-button>
            <n-popconfirm @positive-click="onDeleteSet">
              <template #trigger>
                <n-button size="tiny" quaternary type="error">删除题集</n-button>
              </template>
              删除《{{ current.title }}》？题目和解析都会删除。
            </n-popconfirm>
          </div>
        </div>

        <div v-if="current.warnings.length" class="warn-row">
          <n-alert v-for="(warning, index) in current.warnings" :key="index" type="warning" :bordered="false" style="margin-bottom: 8px">
            {{ warning }}
          </n-alert>
        </div>

        <div v-if="!current.items.length" class="detail-empty">
          题集是空的，点「添加一题」自己出题，或回资料库用「生成习题」。
        </div>

        <article v-for="(item, index) in current.items" :key="item.id" class="problem-card">
          <div class="problem-head">
            <div class="problem-tags">
              <span class="problem-no">第 {{ index + 1 }} 题</span>
              <n-tag size="tiny" :bordered="false">{{ typeOf(item) }}</n-tag>
              <n-tag size="tiny" :bordered="false" :type="item.difficulty === 'hard' ? 'error' : item.difficulty === 'easy' ? 'success' : 'warning'">
                {{ diffOf(item) }}
              </n-tag>
              <span v-if="item.sectionTitle" class="problem-section">{{ item.sectionTitle }}</span>
            </div>
            <div class="problem-tools">
              <n-button text size="tiny" @click="openEdit(item)"><template #icon><Icon name="edit" :size="13" /></template>编辑</n-button>
              <n-popconfirm @positive-click="removeItem(item)">
                <template #trigger>
                  <n-button text size="tiny" type="error"><template #icon><Icon name="trash" :size="13" /></template></n-button>
                </template>
                删除这道题？
              </n-popconfirm>
            </div>
          </div>

          <div class="problem-stem"><MarkdownView :markdown="item.stem" /></div>

          <ul v-if="item.options.length" class="problem-options">
            <li v-for="(option, optionIndex) in item.options" :key="optionIndex">
              <span class="option-letter">{{ String.fromCharCode(65 + optionIndex) }}.</span>
              <span class="option-text" v-html="renderInline(option)" />
            </li>
          </ul>

          <div class="problem-answer">
            <n-button size="tiny" :type="revealed[item.id] ? 'default' : 'primary'" :ghost="!revealed[item.id]" @click="toggleItem(item)">
              {{ revealed[item.id] ? '收起答案与解析' : '看答案与解析' }}
            </n-button>
          </div>

          <div v-if="revealed[item.id]" class="answer-block">
            <div class="answer-line">
              <span class="answer-label">答案</span>
              <div class="answer-content"><MarkdownView :markdown="item.answer" /></div>
            </div>
            <div class="answer-line">
              <span class="answer-label">解析</span>
              <div class="answer-content"><MarkdownView :markdown="item.explanation" /></div>
            </div>
            <div v-if="item.sourceQuote" class="quote-line">
              <span class="quote-label">材料依据</span>
              <span class="quote-text">{{ item.sourceQuote }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- 生成弹窗 -->
    <n-modal v-model:show="genOpen" preset="card" title="生成习题" :bordered="false" style="width: 680px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="题目来源">
          <n-radio-group v-model:value="genSource" size="small">
            <n-radio-button value="document">从材料出题</n-radio-button>
            <n-radio-button value="topic">按主题出题</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-if="genSource === 'document'" label="选择材料">
          <n-select v-model:value="genDocumentId" :options="documentOptions" placeholder="选一份已导入的材料" filterable />
        </n-form-item>
        <n-form-item v-else label="出题主题">
          <n-input v-model:value="genTopic" placeholder="例如：导数与微分的计算、线性代数矩阵的秩" />
        </n-form-item>

        <n-form-item label="生成方式">
          <n-radio-group v-model:value="genMode" size="small">
            <n-radio-button value="create">出新题</n-radio-button>
            <n-radio-button value="extract">整理已有题目（补解析）</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <div class="gen-row">
          <n-form-item label="题目数量" style="flex: 1">
            <n-input-number v-model:value="genCount" :min="1" :max="20" style="width: 100%" />
          </n-form-item>
          <n-form-item label="难度" style="flex: 1">
            <n-select
              v-model:value="genDifficulty"
              :options="[
                { label: '混合', value: 'mixed' },
                { label: '基础', value: 'easy' },
                { label: '中等', value: 'medium' },
                { label: '进阶', value: 'hard' }
              ]"
            />
          </n-form-item>
        </div>

        <n-form-item label="题型">
          <n-checkbox-group v-model:value="genTypes">
            <n-checkbox v-for="option in options" :key="option.value" :value="option.value" :label="option.label" />
          </n-checkbox-group>
        </n-form-item>
      </n-form>

      <p class="modal-tip">
        生成的是「题目 + 答案 + 逐步解析」。答案默认隐藏，浏览时点开即可，不要求作答。
        <template v-if="!provider || provider.kind === 'demo'"> 出题需要真实模型（当前是本地演示模型）。</template>
      </p>

      <template #footer>
        <div class="modal-footer">
          <n-button @click="genOpen = false">取消</n-button>
          <n-button type="primary" :loading="generating" @click="onGenerate">开始生成</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 编辑 / 新增题目 -->
    <n-modal v-model:show="editOpen" preset="card" :title="editIsNew ? '添加一题' : '编辑题目'" :bordered="false" style="width: 760px">
      <n-form v-if="editItem" label-placement="top" :show-feedback="false">
        <div class="gen-row">
          <n-form-item label="题型" style="flex: 1">
            <n-select
              v-model:value="editItem.type"
              :options="options"
            />
          </n-form-item>
          <n-form-item label="难度" style="flex: 1">
            <n-select
              v-model:value="editItem.difficulty"
              :options="[
                { label: '基础', value: 'easy' },
                { label: '中等', value: 'medium' },
                { label: '进阶', value: 'hard' }
              ]"
            />
          </n-form-item>
          <n-form-item label="考点" style="flex: 1">
            <n-input v-model:value="editItem.sectionTitle" placeholder="可不填" />
          </n-form-item>
        </div>
        <n-form-item label="题干（支持 Markdown / LaTeX）">
          <n-input v-model:value="editItem.stem" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" />
        </n-form-item>
        <n-form-item v-if="editItem.type === 'choice'" label="选项（一行一个，自动编号 A/B/C/D）">
          <n-input v-model:value="editOptionsText" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" />
        </n-form-item>
        <n-form-item label="答案">
          <n-input v-model:value="editItem.answer" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
        </n-form-item>
        <n-form-item label="解析">
          <n-input v-model:value="editItem.explanation" type="textarea" :autosize="{ minRows: 4, maxRows: 14 }" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="editOpen = false">取消</n-button>
          <n-button type="primary" @click="saveEdit">{{ editIsNew ? '添加' : '保存' }}</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.practice-page {
  overflow: hidden;
}
.practice-body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.set-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
}
.set-item {
  text-align: left;
  border: 1px solid var(--border-soft);
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.set-item.active {
  border-color: var(--primary);
  background: #f4f7ff;
  box-shadow: 0 0 0 2px rgba(51, 85, 209, 0.08);
}
.set-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.set-meta {
  font-size: 11px;
  color: var(--text-faint);
}
.set-detail {
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 14px 16px;
}
.detail-head h2 {
  font-size: 16px;
  margin: 0 0 6px;
}
.detail-meta {
  display: flex;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-faint);
  flex-wrap: wrap;
  align-items: center;
}
.detail-actions {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.detail-empty {
  color: var(--text-faint);
  font-size: 13px;
  padding: 32px 0;
  text-align: center;
}
.problem-card {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 14px 16px 16px;
  box-shadow: var(--shadow-sm);
}
.problem-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}
.problem-tags {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.problem-no {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
}
.problem-section {
  font-size: 11px;
  color: var(--text-faint);
}
.problem-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}
.problem-stem {
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--text-strong);
}
.problem-options {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.problem-options li {
  display: flex;
  gap: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-regular);
}
.option-letter {
  font-weight: 700;
  color: var(--text-muted);
}
.problem-answer {
  margin-top: 10px;
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
.gen-row {
  display: flex;
  gap: 12px;
}

.quote-line {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  padding: 6px 10px;
  background: #f7f9fc;
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-muted);
}

.quote-label {
  flex-shrink: 0;
  color: var(--text-faint);
}

.quote-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
