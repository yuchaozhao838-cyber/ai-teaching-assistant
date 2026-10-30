<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { FocusMode, FocusPreset, FocusTaskRef } from '@tutor/shared'
import Icon from '../components/Icon.vue'
import CalendarPanel from '../components/CalendarPanel.vue'
import TimetablePanel from '../components/TimetablePanel.vue'
import {
  currentPreset,
  finishRun,
  initTimer,
  onTimerFinished,
  pauseTimer,
  resetTimer as resetTimerImpl,
  selectPreset,
  skipTimer,
  startTimer,
  timer,
  timerDisplay,
  timerProgress
} from '../focusTimer'
import { loadStudy, removeFocusPreset, saveFocusPreset, setMini, state } from '../store'

const message = useMessage()

const mini = computed(() => state.mini)

async function enterMini() {
  await setMini(true)
}

async function exitMini() {
  await setMini(false)
}

const MODE_LABEL: Record<FocusMode, string> = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' }

const presets = computed(() => state.focusPresets)
const preset = currentPreset
const presetId = computed({
  get: () => timer.presetId,
  set: (value: string) => selectPreset(value)
})
const mode = computed(() => timer.mode)
const running = computed(() => timer.running)
const remainingMs = computed(() => timer.remainingMs)
const totalMs = computed(() => timer.totalMs)
const finishedCount = computed(() => timer.finishedCount)

const taskType = ref<'none' | 'document' | 'problemSet'>('none')
const taskId = ref('')

const taskOptions = computed(() => {
  if (taskType.value === 'document') {
    return state.docs.map((doc) => ({ label: doc.title, value: doc.id }))
  }
  if (taskType.value === 'problemSet') {
    return state.problemSets.map((set) => ({ label: set.title, value: set.id }))
  }
  return []
})

const taskRef = computed<FocusTaskRef | undefined>(() => {
  if (taskType.value === 'none' || !taskId.value) return undefined
  const title = taskOptions.value.find((item) => item.value === taskId.value)?.label
  return { type: taskType.value, id: taskId.value, title }
})

const displayTime = timerDisplay
const progress = timerProgress

const ringStyle = computed(() => {
  const radius = 92
  const circumference = 2 * Math.PI * radius
  return {
    strokeDasharray: `${circumference}`,
    strokeDashoffset: `${circumference * (1 - progress.value)}`
  }
})

const stats = computed(() => state.studyStats)
const recentSessions = computed(() => state.focusSessions.slice(0, 6))

function resetTimer(nextMode: FocusMode = timer.mode) {
  resetTimerImpl(nextMode)
}

function start() {
  timer.taskRef = taskRef.value
  startTimer()
}

function pause() {
  pauseTimer()
}

function skip() {
  skipTimer()
}

function complete(completed: boolean) {
  void finishRun(completed)
}

function switchPreset(id: string) {
  selectPreset(id)
}

/** 迷你窗口里换预设（计时中不允许，避免把正在跑的番茄重置） */
function cyclePreset() {
  if (timer.running || !presets.value.length) return
  const index = presets.value.findIndex((item) => item.id === timer.presetId)
  const next = presets.value[(index + 1) % presets.value.length]
  if (next) selectPreset(next.id)
}

/* ------------------------------- 自定义预设 ------------------------------- */
const customOpen = ref(false)
const draft = ref<FocusPreset>({ ...preset.value, id: '', name: '' })

function openCustom() {
  draft.value = { ...preset.value, id: '', name: '' }
  customOpen.value = true
}

async function saveCustom() {
  const value = draft.value
  if (!value.name.trim()) {
    message.warning('给预设起个名字')
    return
  }
  const presetToSave: FocusPreset = {
    id: `preset_${Date.now().toString(36)}`,
    name: value.name.trim().slice(0, 12),
    focusMinutes: Math.min(120, Math.max(1, Number(value.focusMinutes) || 25)),
    shortBreakMinutes: Math.min(120, Math.max(1, Number(value.shortBreakMinutes) || 5)),
    longBreakMinutes: Math.min(120, Math.max(1, Number(value.longBreakMinutes) || 15)),
    pomodorosPerLongBreak: Math.min(12, Math.max(1, Number(value.pomodorosPerLongBreak) || 4)),
    autoStartNext: Boolean(value.autoStartNext)
  }
  await saveFocusPreset(presetToSave)
  selectPreset(presetToSave.id)
  customOpen.value = false
  message.success('预设已保存')
}

async function removePreset(id: string) {
  await removeFocusPreset(id)
  if (timer.presetId === id) {
    selectPreset(presets.value[0]?.id ?? 'preset_25_5')
  }
}

function formatClock(iso: string) {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

let unsubscribeFinished: (() => void) | null = null

onMounted(async () => {
  if (!state.studyStats) await loadStudy()
  initTimer()
  unsubscribeFinished = onTimerFinished((payload) => {
    if (payload.mode === 'focus' && payload.completed) {
      message.success(`完成一个番茄：${payload.minutes} 分钟`)
    } else if (payload.mode === 'focus') {
      message.info('已结束本次专注，未完成的部分不计入统计')
    } else {
      message.success('休息结束，继续加油')
    }
  })
})

onUnmounted(() => {
  unsubscribeFinished?.()
})
</script>

<template>
  <!-- 迷你窗口：只显示计时与两个按钮 -->
  <div v-if="mini" class="mini-focus">
    <div class="mini-top">
      <span class="mini-phase">{{ MODE_LABEL[mode] }}</span>
      <button class="mini-close" title="退出迷你窗口" @click="exitMini">×</button>
    </div>
    <div class="mini-time">{{ displayTime }}</div>
    <div class="mini-preset">
      <button class="mini-chip" :disabled="running" :title="running ? '计时中不能换预设' : '点击切换预设'" @click="cyclePreset">
        {{ preset.name }}
      </button>
      <span class="mini-hint">{{ preset.focusMinutes }} 分钟</span>
    </div>
    <div class="mini-progress">
      <div class="mini-bar" :style="{ width: `${Math.round(progress * 100)}%` }" />
    </div>
    <div class="mini-actions">
      <button class="mini-btn primary" @click="running ? pause() : start()">
        {{ running ? '暂停' : remainingMs === totalMs ? '开始' : '继续' }}
      </button>
      <button class="mini-btn" @click="pause(); void complete(false)">结束</button>
    </div>
  </div>

  <div v-else class="page focus-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1>专注</h1>
        <p>番茄工作法：专注 → 短休 → 长休。完成的专注会记进学习时间轴，用来算今天的进度和连续天数。</p>
      </div>
      <div class="head-side">
        <n-button v-if="state.focusTab === 'timer'" size="small" quaternary @click="enterMini">
          <template #icon><Icon name="clock" :size="14" /></template>
          迷你窗口
        </n-button>
        <n-button v-if="state.focusTab === 'timer'" size="small" quaternary @click="openCustom">
          <template #icon><Icon name="plus" :size="14" /></template>
          自定义时长
        </n-button>
      </div>
    </header>

    <div class="focus-tabs">
      <button class="focus-tab" :class="{ active: state.focusTab === 'timer' }" @click="state.focusTab = 'timer'">番茄钟</button>
      <button class="focus-tab" :class="{ active: state.focusTab === 'calendar' }" @click="state.focusTab = 'calendar'">日历</button>
      <button class="focus-tab" :class="{ active: state.focusTab === 'timetable' }" @click="state.focusTab = 'timetable'">课表</button>
    </div>

    <CalendarPanel v-if="state.focusTab === 'calendar'" />
    <TimetablePanel v-if="state.focusTab === 'timetable'" />

    <div v-show="state.focusTab === 'timer'" class="focus-layout">
      <!-- 计时器 -->
      <section class="timer-card">
        <div class="phase-tabs">
          <button
            v-for="item in (['focus', 'shortBreak', 'longBreak'] as FocusMode[])"
            :key="item"
            class="phase-tab"
            :class="{ active: mode === item, running: running && mode === item }"
            @click="!running && resetTimer(item)"
          >
            {{ MODE_LABEL[item] }}
          </button>
        </div>

        <div class="ring-wrap">
          <svg viewBox="0 0 200 200" class="ring">
            <circle class="ring-track" cx="100" cy="100" r="92" />
            <circle class="ring-progress" cx="100" cy="100" r="92" :style="ringStyle" />
          </svg>
          <div class="ring-center">
            <div class="ring-time">{{ displayTime }}</div>
            <div class="ring-label">{{ running ? MODE_LABEL[mode] + '中…' : MODE_LABEL[mode] }}</div>
          </div>
        </div>

        <div class="timer-actions">
          <n-button v-if="!running" type="primary" size="large" @click="start">
            <template #icon><Icon name="play" :size="16" /></template>
            {{ remainingMs === totalMs ? '开始' : '继续' }}
          </n-button>
          <n-button v-else size="large" @click="pause">
            <template #icon><Icon name="pause" :size="16" /></template>
            暂停
          </n-button>
          <n-button size="large" quaternary @click="skip">跳过</n-button>
          <n-button size="large" quaternary @click="resetTimer(mode)">重置</n-button>
        </div>

        <div class="task-row">
          <span class="task-label">关联任务</span>
          <n-select
            v-model:value="taskType"
            size="small"
            style="width: 120px"
            :options="[
              { label: '不关联', value: 'none' },
              { label: '学习材料', value: 'document' },
              { label: '习题集', value: 'problemSet' }
            ]"
            @update:value="taskId = ''"
          />
          <n-select
            v-if="taskType !== 'none'"
            v-model:value="taskId"
            size="small"
            style="flex: 1; min-width: 120px"
            :options="taskOptions"
            placeholder="选择要专注的内容"
            filterable
          />
        </div>

        <p class="preset-tip">当前预设：{{ preset.name }} · 专注 {{ preset.focusMinutes }} 分钟 / 短休 {{ preset.shortBreakMinutes }} 分钟 / 每 {{ preset.pomodorosPerLongBreak }} 个番茄长休</p>
      </section>

      <!-- 右侧：预设与统计 -->
      <section class="side-col">
        <div class="panel">
          <div class="panel-title">我的预设</div>
          <div class="preset-list">
            <div
              v-for="item in presets"
              :key="item.id"
              class="preset-item"
              :class="{ active: item.id === presetId }"
              @click="switchPreset(item.id)"
            >
              <div class="preset-name">{{ item.name }}</div>
              <div class="preset-meta">{{ item.focusMinutes }} / {{ item.shortBreakMinutes }} / {{ item.longBreakMinutes }} 分钟</div>
              <button
                v-if="presets.length > 1"
                class="preset-remove"
                title="删除预设"
                @click.stop="removePreset(item.id)"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">今日</div>
          <div class="stat-row">
            <div class="stat">
              <div class="stat-value">{{ stats?.today.focusCount ?? 0 }}</div>
              <div class="stat-label">番茄</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ stats?.today.focusMinutes ?? 0 }}</div>
              <div class="stat-label">分钟</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ stats?.streakDays ?? 0 }}</div>
              <div class="stat-label">连续天数</div>
            </div>
          </div>
          <div class="week-bars">
            <div v-for="day in stats?.last7Days ?? []" :key="day.date" class="bar-col">
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :style="{ height: `${Math.min(100, day.minutes * 2)}%` }"
                  :class="{ empty: day.minutes === 0 }"
                />
              </div>
              <div class="bar-label">{{ day.date.slice(5) }}</div>
            </div>
          </div>
          <div class="week-summary">
            本周专注 {{ stats?.week.focusMinutes ?? 0 }} 分钟 · {{ stats?.week.focusCount ?? 0 }} 个番茄
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">最近专注</div>
          <div v-if="!recentSessions.length" class="empty-hint">还没有记录，开始第一个番茄吧</div>
          <div v-for="session in recentSessions" :key="session.id" class="session-row">
            <span class="session-time">{{ formatClock(session.startedAt) }}</span>
            <span class="session-title">{{ session.taskRef?.title ?? (session.mode === 'focus' ? '专注' : MODE_LABEL[session.mode]) }}</span>
            <span class="session-minutes">{{ session.actualMinutes }} 分钟</span>
          </div>
        </div>
      </section>
    </div>

    <!-- 自定义预设 -->
    <n-modal v-model:show="customOpen" preset="card" title="自定义专注时长" :bordered="false" style="width: 480px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="预设名称">
          <n-input v-model:value="draft.name" placeholder="例如：45/10 考试冲刺" />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="专注（分钟）" style="flex: 1">
            <n-input-number v-model:value="draft.focusMinutes" :min="1" :max="120" style="width: 100%" />
          </n-form-item>
          <n-form-item label="短休（分钟）" style="flex: 1">
            <n-input-number v-model:value="draft.shortBreakMinutes" :min="1" :max="120" style="width: 100%" />
          </n-form-item>
          <n-form-item label="长休（分钟）" style="flex: 1">
            <n-input-number v-model:value="draft.longBreakMinutes" :min="1" :max="120" style="width: 100%" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="每几个番茄长休" style="flex: 1">
            <n-input-number v-model:value="draft.pomodorosPerLongBreak" :min="1" :max="12" style="width: 100%" />
          </n-form-item>
          <n-form-item label="自动进入下一阶段" style="flex: 1">
            <n-switch v-model:value="draft.autoStartNext" />
          </n-form-item>
        </div>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="customOpen = false">取消</n-button>
          <n-button type="primary" @click="saveCustom">保存并使用</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.mini-focus {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  background: #0f172a;
  color: #e6ecff;
  box-sizing: border-box;
}
.mini-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #8fa2c9;
}
.mini-phase {
  letter-spacing: 0.08em;
}
.mini-close {
  border: none;
  background: transparent;
  color: #8fa2c9;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.mini-close:hover {
  color: #fff;
}
.mini-time {
  font-size: 46px;
  font-weight: 700;
  text-align: center;
  color: #fff;
  letter-spacing: 1px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.mini-preset {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 2px;
}
.mini-chip {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.06);
  color: #dce4ff;
  border-radius: 8px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
}
.mini-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mini-hint {
  font-size: 10.5px;
  color: #8fa2c9;
}
.mini-progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  overflow: hidden;
}
.mini-bar {
  height: 100%;
  background: linear-gradient(90deg, #6d8bff, #3b5bdb);
  transition: width 0.3s linear;
}
.mini-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 2px;
}
.mini-btn {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: #dce4ff;
  border-radius: 8px;
  padding: 5px 16px;
  font-size: 12.5px;
  cursor: pointer;
}
.mini-btn:hover {
  border-color: rgba(255, 255, 255, 0.45);
}
.mini-btn.primary {
  background: #2f4bd8;
  border-color: #2f4bd8;
  color: #fff;
}
</style>

<style scoped>
.focus-layout {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.focus-tabs {
  display: inline-flex;
  gap: 4px;
  background: #eef2fa;
  border-radius: 10px;
  padding: 3px;
  align-self: flex-start;
}

.focus-tab {
  border: none;
  background: none;
  padding: 5px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-muted);
  cursor: pointer;
}

.focus-tab.active {
  background: #fff;
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 35, 95, 0.08);
}
.timer-card {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: var(--shadow-sm);
}
.phase-tabs {
  display: flex;
  gap: 6px;
  background: #f2f5fb;
  padding: 4px;
  border-radius: 10px;
}
.phase-tab {
  border: none;
  background: none;
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-muted);
  cursor: pointer;
}
.phase-tab.active {
  background: #fff;
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 35, 95, 0.08);
}
.phase-tab.running {
  color: #1f9d76;
}
.ring-wrap {
  position: relative;
  width: 240px;
  height: 240px;
  margin: 22px 0 8px;
}
.ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.ring-track {
  fill: none;
  stroke: #eef1f8;
  stroke-width: 12;
}
.ring-progress {
  fill: none;
  stroke: var(--primary);
  stroke-width: 12;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s linear;
}
.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.ring-time {
  font-size: 46px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}
.ring-label {
  font-size: 12.5px;
  color: var(--text-muted);
}
.timer-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  width: 100%;
  padding-top: 16px;
  border-top: 1px dashed var(--border-soft);
}
.task-label {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.preset-tip {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--text-faint);
  text-align: center;
  line-height: 1.6;
}
.side-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 14px 16px;
}
.panel-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.preset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preset-item {
  position: relative;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
}
.preset-item.active {
  border-color: var(--primary);
  background: #f4f7ff;
}
.preset-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-strong);
}
.preset-meta {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 2px;
}
.preset-remove {
  position: absolute;
  right: 6px;
  top: 4px;
  border: none;
  background: none;
  color: var(--text-faint);
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
}
.stat-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.stat {
  flex: 1;
  text-align: center;
  background: #f7f9fd;
  border-radius: 10px;
  padding: 8px 4px;
}
.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--primary);
}
.stat-label {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 2px;
}
.week-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 72px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
}
.bar-track {
  flex: 1;
  width: 100%;
  background: #f2f5fb;
  border-radius: 5px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.bar-fill {
  width: 100%;
  background: linear-gradient(180deg, #5b78e8, #2f4bd8);
  border-radius: 5px;
  min-height: 2px;
}
.bar-fill.empty {
  background: #e4e9f5;
}
.bar-label {
  font-size: 9.5px;
  color: var(--text-faint);
}
.week-summary {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--text-muted);
  text-align: center;
}
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--border-soft);
}
.session-row:last-child {
  border-bottom: none;
}
.session-time {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.session-title {
  flex: 1;
  color: var(--text-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-minutes {
  color: var(--primary);
  font-weight: 600;
}
.empty-hint {
  font-size: 12px;
  color: var(--text-faint);
  padding: 6px 0;
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

@media (max-width: 860px) {
  .focus-layout {
    grid-template-columns: 1fr;
  }
  .ring-wrap {
    width: 200px;
    height: 200px;
  }
  .ring-time {
    font-size: 38px;
  }
}
</style>
