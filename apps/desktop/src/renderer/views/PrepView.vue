<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { CalendarEvent, PrepGoal, PrepPhase, PrepTask, PrepTaskKind } from '@tutor/shared'
import { isDateKey, toDateKey } from '@tutor/study'
import Icon from '../components/Icon.vue'
import {
  advisePrep,
  generatePrep,
  loadPrep,
  removePrepGoal,
  saveCalendarEvent,
  savePrepGoal,
  state
} from '../store'

const message = useMessage()

/** 任务类型的中文名（避免把 pedagogy（含 node 依赖）打进渲染层） */
const KIND_LABEL: Record<PrepTaskKind, string> = {
  read: '学习',
  practice: '练习',
  review: '复习',
  mock: '模考',
  listen: '听力',
  write: '写作',
  vocab: '词汇'
}

function kindLabel(kind: PrepTaskKind): string {
  return KIND_LABEL[kind] ?? '任务'
}

const goals = computed(() => state.prepGoals)
const activeId = ref('')
const active = computed<PrepGoal | null>(() => goals.value.find((goal) => goal.id === activeId.value) ?? null)

/* -------------------------------- 新建目标 -------------------------------- */
const createOpen = ref(false)
const generating = ref(false)
const draft = ref({
  title: '两个月备考四级',
  examName: '英语四级',
  examDate: null as string | null,
  weeks: 8,
  dailyMinutes: 90,
  baseline: '上次 425 分左右',
  targetScore: '目标 500 分',
  materialIds: [] as string[]
})

const materialOptions = computed(() => state.docs.map((doc) => ({ label: doc.title, value: doc.id })))

function openCreate() {
  draft.value = {
    title: '两个月备考四级',
    examName: '英语四级',
    examDate: null as string | null,
    weeks: 8,
    dailyMinutes: 90,
    baseline: '上次 425 分左右',
    targetScore: '目标 500 分',
    materialIds: state.docs.slice(0, 2).map((doc) => doc.id)
  }
  createOpen.value = true
}

async function submitCreate() {
  if (!draft.value.title.trim()) {
    message.warning('给目标起个名字')
    return
  }
  generating.value = true
  try {
    const result = await generatePrep({
      title: draft.value.title.trim(),
      examName: draft.value.examName.trim(),
      examDate: isDateKey(draft.value.examDate) ? (draft.value.examDate as string) : undefined,
      weeks: Math.min(30, Math.max(1, Number(draft.value.weeks) || 8)),
      dailyMinutes: Math.min(480, Math.max(15, Number(draft.value.dailyMinutes) || 90)),
      baseline: draft.value.baseline.trim() || undefined,
      targetScore: draft.value.targetScore.trim() || undefined,
      materialIds: draft.value.materialIds
    })
    if (!result.ok || !result.goal) {
      message.error(result.error ?? '生成失败', { duration: 8000 })
      return
    }
    activeId.value = result.goal.id
    createOpen.value = false
    const local = (result.goal.summary ?? '').includes('本地模板')
    message.success(local ? '已生成基础计划（本地模板，接入模型后更贴合你的情况）' : '已生成备考计划', { duration: 6000 })
  } finally {
    generating.value = false
  }
}

/* -------------------------------- 进度 -------------------------------- */
const todayKey = computed(() => toDateKey(new Date()))

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)
}

const daysToExam = computed(() => {
  if (!active.value?.examDate) return null
  return daysBetween(todayKey.value, active.value.examDate)
})

const currentWeek = computed(() => {
  if (!active.value) return 1
  const passed = Math.max(0, daysBetween(active.value.startDate, todayKey.value))
  return Math.min(active.value.weeks, Math.floor(passed / 7) + 1)
})

const allTasks = computed(() => active.value?.phases.flatMap((phase) => phase.tasks) ?? [])
const doneCount = computed(() => allTasks.value.filter((task) => task.done).length)
const progress = computed(() => (allTasks.value.length ? Math.round((doneCount.value / allTasks.value.length) * 100) : 0))

const weekTasks = computed(() => allTasks.value.filter((task) => task.week === currentWeek.value))
const currentPhase = computed<PrepPhase | null>(
  () => active.value?.phases.find((phase) => currentWeek.value >= phase.weekFrom && currentWeek.value <= phase.weekTo) ?? null
)

/* -------------------------------- 任务操作 -------------------------------- */
async function toggleTask(task: PrepTask) {
  if (!active.value) return
  const phases = active.value.phases.map((phase) => ({
    ...phase,
    tasks: phase.tasks.map((item) => (item.id === task.id ? { ...item, done: !item.done } : item))
  }))
  await savePrepGoal({ ...active.value, phases })
}

async function addWeekToCalendar() {
  if (!active.value || !weekTasks.value.length) {
    message.warning('本周没有任务')
    return
  }
  const base = new Date(`${active.value.startDate}T00:00:00`)
  base.setDate(base.getDate() + (currentWeek.value - 1) * 7)
  const events: CalendarEvent[] = weekTasks.value.map((task, index): CalendarEvent => {
    const date = new Date(base)
    date.setDate(base.getDate() + (index % 7))
    const key = toDateKey(date)
    return {
      id: `cal_${Date.now().toString(36)}_${index}`,
      title: `${kindLabel(task.kind)}：${task.title}`,
      date: key,
      allDay: true,
      type: 'study',
      note: `备考「${active.value?.title}」第 ${currentWeek.value} 周 · 约 ${task.minutes} 分钟`,
      createdAt: new Date().toISOString()
    }
  })
  for (const event of events) {
    await saveCalendarEvent(event)
  }
  message.success(`已把 ${events.length} 条任务排进第 ${currentWeek.value} 周的日历`)
}

/* -------------------------------- 建议 -------------------------------- */
const advising = ref(false)
const advice = ref<string[]>([])

async function loadAdvice() {
  if (!active.value) return
  advising.value = true
  try {
    const result = await advisePrep(active.value.id)
    if (result.ok && result.advice) {
      advice.value = result.advice
    } else {
      message.error(result.error ?? '获取建议失败')
    }
  } finally {
    advising.value = false
  }
}

async function removeGoal(goal: PrepGoal) {
  await removePrepGoal(goal.id)
  if (activeId.value === goal.id) activeId.value = goals.value[0]?.id ?? ''
  message.success('已删除该目标')
}

const kindColor: Record<PrepTaskKind, string> = {
  read: '#2f4bd8',
  practice: '#1f9d76',
  review: '#b7791f',
  mock: '#c53030',
  listen: '#0284c7',
  write: '#8b5cf6',
  vocab: '#0f766e'
}

onMounted(async () => {
  if (!state.prepGoals.length) await loadPrep()
  if (!activeId.value && goals.value.length) activeId.value = goals.value[0].id
})
</script>

<template>
  <div class="page prep-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1>备考规划</h1>
        <p>说出你的目标和期限，AI 拆成阶段计划；每周任务可以勾选、可以直接排进日历，也能结合你导入的材料给建议。</p>
      </div>
      <div class="head-side">
        <n-button size="small" type="primary" @click="openCreate">
          <template #icon><Icon name="plus" :size="14" /></template>
          新建备考目标
        </n-button>
      </div>
    </header>

    <div v-if="!goals.length" class="empty-state" style="padding-top: 40px">
      <div class="empty-visual">
        <div class="empty-card card-a"><Icon name="target" :size="18" /></div>
        <div class="empty-card card-b"><Icon name="calendar" :size="20" /></div>
        <div class="empty-card card-c"><Icon name="sparkles" :size="18" /></div>
      </div>
      <h3>还没有备考目标</h3>
      <p>比如「两个月备考四级」「三周复习高数期末」——填目标、期限、每天能投入多久，AI 会给你一张分阶段计划表。</p>
      <n-button type="primary" @click="openCreate">新建第一个目标</n-button>
    </div>

    <div v-else class="prep-body">
      <aside class="prep-list">
        <button
          v-for="goal in goals"
          :key="goal.id"
          class="prep-item"
          :class="{ active: goal.id === activeId }"
          @click="activeId = goal.id"
        >
          <div class="prep-title">{{ goal.title }}</div>
          <div class="prep-meta">
            {{ goal.weeks }} 周 · 每天 {{ goal.dailyMinutes }} 分钟
            <template v-if="goal.examDate"> · {{ goal.examDate }}</template>
          </div>
        </button>
      </aside>

      <section v-if="active" class="prep-detail">
        <div class="detail-head">
          <div>
            <h2>{{ active.title }}</h2>
            <p class="detail-sub">{{ active.summary }}</p>
          </div>
          <div class="detail-actions">
            <n-popconfirm @positive-click="removeGoal(active)">
              <template #trigger>
                <n-button size="tiny" quaternary type="error">删除</n-button>
              </template>
              删除这个备考目标？
            </n-popconfirm>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat">
            <span class="stat-value">{{ daysToExam === null ? '—' : Math.max(0, daysToExam) }}</span>
            <span class="stat-label">距考试天数</span>
          </div>
          <div class="stat">
            <span class="stat-value">第 {{ currentWeek }} / {{ active.weeks }} 周</span>
            <span class="stat-label">当前进度</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ doneCount }} / {{ allTasks.length }}</span>
            <span class="stat-label">已完成任务</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ progress }}%</span>
            <span class="stat-label">完成度</span>
            <n-progress type="line" :percentage="progress" :show-indicator="false" :height="4" style="margin-top: 4px" />
          </div>
        </div>

        <div v-if="active.advice.length" class="advice-box">
          <div class="advice-title"><Icon name="sparkles" :size="13" /> 备考建议</div>
          <ul>
            <li v-for="(item, index) in active.advice" :key="index">{{ item }}</li>
            <li v-for="(item, index) in advice" :key="`ai_${index}`">{{ item }}</li>
          </ul>
        </div>

        <div class="week-card">
          <div class="week-head">
            <span class="week-title">第 {{ currentWeek }} 周任务</span>
            <span v-if="currentPhase" class="week-phase">{{ currentPhase.focus }}</span>
            <div class="week-actions">
              <n-button size="tiny" @click="addWeekToCalendar">排进本周日历</n-button>
              <n-button size="tiny" quaternary :loading="advising" @click="loadAdvice">结合材料给建议</n-button>
            </div>
          </div>
          <div v-if="!weekTasks.length" class="week-empty">这周没有安排任务，可以查看其他阶段的计划。</div>
          <label v-for="task in weekTasks" :key="task.id" class="task-row" :class="{ done: task.done }">
            <n-checkbox :checked="task.done" @update:checked="toggleTask(task)" />
            <span class="task-kind" :style="{ color: kindColor[task.kind] }">{{ kindLabel(task.kind) }}</span>
            <span class="task-title">{{ task.title }}</span>
            <span class="task-min">{{ task.minutes }} 分钟</span>
          </label>
        </div>

        <div class="phases">
          <div v-for="phase in active.phases" :key="phase.id" class="phase-card">
            <div class="phase-head">
              <span class="phase-name">{{ phase.name }}</span>
              <span class="phase-range">第 {{ phase.weekFrom }}-{{ phase.weekTo }} 周</span>
            </div>
            <div class="phase-focus">{{ phase.focus }}</div>
            <label v-for="task in phase.tasks" :key="task.id" class="task-row small" :class="{ done: task.done }">
              <n-checkbox :checked="task.done" @update:checked="toggleTask(task)" />
              <span class="task-kind" :style="{ color: kindColor[task.kind] }">{{ kindLabel(task.kind) }}</span>
              <span class="task-title">{{ task.title }}</span>
              <span class="task-min">第{{ task.week }}周 · {{ task.minutes }} 分钟</span>
            </label>
          </div>
        </div>
      </section>
    </div>

    <!-- 新建目标 -->
    <n-modal v-model:show="createOpen" preset="card" title="新建备考目标" :bordered="false" style="width: 640px">
      <n-form label-placement="top" :show-feedback="false">
        <div class="form-row">
          <n-form-item label="目标（一句话）" style="flex: 2">
            <n-input v-model:value="draft.title" placeholder="两个月备考四级" />
          </n-form-item>
          <n-form-item label="考试名称" style="flex: 1">
            <n-input v-model:value="draft.examName" placeholder="英语四级" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="考试日期（可选）" style="flex: 1">
            <n-date-picker
              v-model:formatted-value="draft.examDate"
              type="date"
              value-format="yyyy-MM-dd"
              :is-date-disabled="() => false"
              clearable
              style="width: 100%"
            />
          </n-form-item>
          <n-form-item label="准备周数" style="flex: 1">
            <n-input-number v-model:value="draft.weeks" :min="1" :max="30" style="width: 100%" />
          </n-form-item>
          <n-form-item label="每天可投入（分钟）" style="flex: 1">
            <n-input-number v-model:value="draft.dailyMinutes" :min="15" :max="480" :step="15" style="width: 100%" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="当前水平（可选）" style="flex: 1">
            <n-input v-model:value="draft.baseline" placeholder="上次 425 分 / 零基础" />
          </n-form-item>
          <n-form-item label="目标结果（可选）" style="flex: 1">
            <n-input v-model:value="draft.targetScore" placeholder="500 分 / 及格" />
          </n-form-item>
        </div>
        <n-form-item label="关联材料（可多选，AI 会结合它们给建议）">
          <n-select v-model:value="draft.materialIds" multiple :options="materialOptions" placeholder="选择已导入的课件/真题" />
        </n-form-item>
      </n-form>
      <p class="create-tip">生成后会按周拆成阶段任务；没有接入真实模型时会用本地模板计划，结构一样，之后可重新生成。</p>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="createOpen = false">取消</n-button>
          <n-button type="primary" :loading="generating" @click="submitCreate">生成计划</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.prep-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.prep-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.prep-item {
  text-align: left;
  border: 1px solid var(--border-soft);
  background: #fff;
  border-radius: 10px;
  padding: 9px 11px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.prep-item.active {
  border-color: var(--primary);
  background: #f4f7ff;
  box-shadow: 0 0 0 2px rgba(51, 85, 209, 0.08);
}
.prep-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.prep-meta {
  font-size: 10.5px;
  color: var(--text-faint);
}
.prep-detail {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.detail-head h2 {
  margin: 0 0 4px;
  font-size: 17px;
}
.detail-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.6;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.stat {
  background: #f8faff;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-strong);
}
.stat-label {
  font-size: 10.5px;
  color: var(--text-faint);
}
.advice-box {
  border: 1px solid #e6def7;
  background: #fdfbff;
  border-radius: 10px;
  padding: 10px 14px;
}
.advice-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #6d28d9;
  margin-bottom: 6px;
}
.advice-box ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-regular);
}
.week-card {
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.week-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.week-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.week-phase {
  font-size: 11px;
  color: var(--text-muted);
}
.week-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.week-empty {
  font-size: 12px;
  color: var(--text-faint);
  padding: 4px 0;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 8px;
  cursor: pointer;
}
.task-row:hover {
  background: #f7f9fd;
}
.task-row.small {
  padding: 3px 4px;
}
.task-row.done .task-title {
  text-decoration: line-through;
  color: var(--text-faint);
}
.task-kind {
  font-size: 10.5px;
  font-weight: 600;
  flex-shrink: 0;
}
.task-title {
  font-size: 12.5px;
  color: var(--text-regular);
  flex: 1;
}
.task-min {
  font-size: 10.5px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.phases {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.phase-card {
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 10px 14px;
}
.phase-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.phase-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.phase-range {
  font-size: 10.5px;
  color: var(--text-faint);
}
.phase-focus {
  font-size: 11.5px;
  color: var(--text-muted);
  margin: 3px 0 6px;
}
.create-tip {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.6;
}
@media (max-width: 860px) {
  .prep-body {
    grid-template-columns: 1fr;
  }
  .prep-list {
    flex-direction: row;
    overflow-x: auto;
  }
  .prep-item {
    min-width: 180px;
  }
}
</style>
