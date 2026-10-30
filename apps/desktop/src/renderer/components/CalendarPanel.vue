<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { CalendarEvent, CalendarEventType, HomeworkRule } from '@tutor/shared'
import { expandHomeworkRules, monthGrid, shiftDateKey, toDateKey, weekdayOf } from '@tutor/study'
import Icon from './Icon.vue'
import {
  exportIcs,
  importIcs,
  removeCalendarEvent,
  removeHomeworkRule,
  saveCalendarEvent,
  saveHomeworkRule,
  state
} from '../store'

const message = useMessage()

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth())
const selected = ref(toDateKey(now))

const TYPE_LABEL: Record<CalendarEventType, string> = {
  study: '学习',
  exam: '考试',
  deadline: '截止',
  custom: '日程'
}

const TYPE_COLOR: Record<CalendarEventType, string> = {
  study: '#2f4bd8',
  exam: '#d92d20',
  deadline: '#d97706',
  custom: '#5a6b85'
}

const grid = computed(() => monthGrid(year.value, month.value))
const monthLabel = computed(() => `${year.value} 年 ${month.value + 1} 月`)

/** 按天聚合：学习分钟来自时间轴，事件来自日历 + 作业规则展开 */
const dayStats = computed(() => {
  const map = new Map<string, { minutes: number; events: CalendarEvent[] }>()
  for (const day of grid.value) map.set(day, { minutes: 0, events: [] })
  for (const event of state.studyEvents) {
    const entry = map.get(event.date)
    if (entry) entry.minutes += event.minutes
  }
  const from = grid.value[0]
  const to = grid.value[grid.value.length - 1]
  const allEvents = [...state.calendarEvents, ...expandHomeworkRules(state.homeworkRules, from, to)]
  for (const event of allEvents) {
    const entry = map.get(event.date)
    if (entry) entry.events.push(event)
  }
  return map
})

const selectedEvents = computed(() => {
  const entry = dayStats.value.get(selected.value)
  if (!entry) return []
  return [...entry.events].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
})

const upcoming = computed(() => {
  const from = toDateKey(new Date())
  const list = [...state.calendarEvents, ...expandHomeworkRules(state.homeworkRules, from, shiftDateKey(from, 30))]
  return list.filter((event) => event.date >= from).sort((a, b) => `${a.date}${a.startTime ?? ''}`.localeCompare(`${b.date}${b.startTime ?? ''}`))
})

function isToday(day: string) {
  return day === toDateKey(new Date())
}

function dayNumber(day: string) {
  return Number(day.slice(8, 10))
}

function prevMonth() {
  if (month.value === 0) {
    month.value = 11
    year.value -= 1
  } else {
    month.value -= 1
  }
}

function nextMonth() {
  if (month.value === 11) {
    month.value = 0
    year.value += 1
  } else {
    month.value += 1
  }
}

function goToday() {
  const today = new Date()
  year.value = today.getFullYear()
  month.value = today.getMonth()
  selected.value = toDateKey(today)
}

/* -------------------------------- 新增日程 -------------------------------- */
const eventOpen = ref(false)
const eventDraft = ref({
  title: '',
  date: toDateKey(new Date()),
  startTime: '09:00',
  endTime: '10:00',
  allDay: false,
  type: 'study' as CalendarEventType,
  note: ''
})

function openAddEvent() {
  eventDraft.value = {
    title: '',
    date: selected.value,
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    type: 'study',
    note: ''
  }
  eventOpen.value = true
}

async function submitEvent() {
  if (!eventDraft.value.title.trim()) {
    message.warning('给日程起个名字')
    return
  }
  await saveCalendarEvent({
    id: '',
    title: eventDraft.value.title.trim(),
    date: eventDraft.value.date,
    startTime: eventDraft.value.allDay ? undefined : eventDraft.value.startTime,
    endTime: eventDraft.value.allDay ? undefined : eventDraft.value.endTime,
    allDay: eventDraft.value.allDay,
    type: eventDraft.value.type,
    note: eventDraft.value.note || undefined,
    source: 'app',
    createdAt: new Date().toISOString()
  })
  eventOpen.value = false
  message.success('已添加到日历')
}

async function removeEvent(event: CalendarEvent) {
  if (event.source === 'rule') {
    message.warning('这是作业规则自动生成的，请到「作业规则」里改')
    return
  }
  await removeCalendarEvent(event.id)
  message.success('已删除')
}

/* -------------------------------- 作业规则 -------------------------------- */
const ruleOpen = ref(false)
const ruleDraft = ref<HomeworkRule>({
  id: '',
  courseName: '',
  assignWeekday: 1,
  assignTime: '09:00',
  submitDurationDays: 3,
  startDate: toDateKey(new Date()),
  endDate: shiftDateKey(toDateKey(new Date()), 120),
  active: true
})

function openRule() {
  ruleDraft.value = {
    id: '',
    courseName: '',
    assignWeekday: 1,
    assignTime: '09:00',
    submitDurationDays: 3,
    startDate: toDateKey(new Date()),
    endDate: shiftDateKey(toDateKey(new Date()), 120),
    active: true
  }
  ruleOpen.value = true
}

async function submitRule() {
  if (!ruleDraft.value.courseName.trim()) {
    message.warning('填一下课程名')
    return
  }
  await saveHomeworkRule({
    ...ruleDraft.value,
    id: ruleDraft.value.id || `rule_${Date.now().toString(36)}`,
    courseName: ruleDraft.value.courseName.trim()
  })
  ruleOpen.value = false
  message.success('规则已保存，日历里会自动出现布置与截止')
}

/* -------------------------------- ICS 导入导出 -------------------------------- */
const fileInput = ref<HTMLInputElement | null>(null)

function triggerImport() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  const result = await importIcs(text)
  if (result.ok) {
    message.success(`导入 ${result.imported} 条日程${result.skipped ? `，跳过重复 ${result.skipped} 条` : ''}`)
  } else {
    message.error(result.error ?? '导入失败')
  }
  input.value = ''
}

async function onExport() {
  const result = await exportIcs()
  if (result.ok) message.success('已导出 .ics 文件，可导入系统日历')
  else message.error('导出失败')
}

const weekdayNames = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <div class="calendar-panel">
    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="cal-arrow" @click="prevMonth">‹</button>
        <span class="cal-month">{{ monthLabel }}</span>
        <button class="cal-arrow" @click="nextMonth">›</button>
        <n-button size="tiny" quaternary @click="goToday">今天</n-button>
      </div>
      <div class="cal-actions">
        <n-button size="tiny" quaternary @click="triggerImport">导入 .ics</n-button>
        <n-button size="tiny" quaternary @click="onExport">导出 .ics</n-button>
        <n-button size="tiny" type="primary" @click="openAddEvent">
          <template #icon><Icon name="plus" :size="13" /></template>
          添加日程
        </n-button>
      </div>
    </div>

    <div class="cal-body">
      <div class="cal-grid-wrap">
        <div class="cal-weekdays">
          <span v-for="name in weekdayNames" :key="name">{{ name }}</span>
        </div>
        <div class="cal-grid">
          <button
            v-for="day in grid"
            :key="day"
            class="cal-cell"
            :class="{
              other: day.slice(5, 7) !== String(month + 1).padStart(2, '0'),
              today: isToday(day),
              selected: day === selected
            }"
            @click="selected = day"
          >
            <span class="cal-day">{{ dayNumber(day) }}</span>
            <span v-if="dayStats.get(day)?.minutes" class="cal-minutes">{{ dayStats.get(day)?.minutes }}′</span>
            <span class="cal-dots">
              <i
                v-for="event in (dayStats.get(day)?.events ?? []).slice(0, 3)"
                :key="event.id"
                class="dot"
                :style="{ background: TYPE_COLOR[event.type] }"
              />
            </span>
          </button>
        </div>
      </div>

      <div class="cal-side">
        <div class="side-title">
          {{ selected }} · 周{{ weekdayNames[weekdayOf(selected) - 1] }}
          <span class="side-minutes">{{ dayStats.get(selected)?.minutes ?? 0 }} 分钟学习</span>
        </div>
        <div v-if="!selectedEvents.length" class="side-empty">这一天还没有安排</div>
        <div v-for="event in selectedEvents" :key="event.id" class="event-row">
          <span class="event-bar" :style="{ background: TYPE_COLOR[event.type] }" />
          <div class="event-main">
            <div class="event-title">{{ event.title }}</div>
            <div class="event-meta">
              {{ event.allDay ? '全天' : `${event.startTime} - ${event.endTime ?? ''}` }}
              · {{ TYPE_LABEL[event.type] }}
              <span v-if="event.source === 'rule'" class="event-tag">自动</span>
            </div>
          </div>
          <button class="event-del" @click="removeEvent(event)">×</button>
        </div>

        <div class="side-title" style="margin-top: 14px">
          作业规则
          <n-button size="tiny" quaternary @click="openRule">+ 添加</n-button>
        </div>
        <div v-if="!state.homeworkRules.length" class="side-empty">录入一次，每周自动生成布置与截止</div>
        <div v-for="rule in state.homeworkRules" :key="rule.id" class="rule-row">
          <div class="rule-main">
            <div class="rule-title">{{ rule.courseName }}</div>
            <div class="rule-meta">每周{{ weekdayNames[rule.assignWeekday - 1] }} {{ rule.assignTime }} 布置 · {{ rule.submitDurationDays }} 天后截止</div>
          </div>
          <button class="event-del" @click="removeHomeworkRule(rule.id)">×</button>
        </div>

        <div class="side-title" style="margin-top: 14px">接下来的日程</div>
        <div v-if="!upcoming.length" class="side-empty">还没有未来的安排</div>
        <div v-for="event in upcoming.slice(0, 5)" :key="event.id" class="upcoming-row">
          <span class="up-date">{{ event.date.slice(5) }}</span>
          <span class="up-title">{{ event.title }}</span>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".ics,text/calendar" style="display: none" @change="onFileChange" />

    <!-- 添加日程 -->
    <n-modal v-model:show="eventOpen" preset="card" title="添加日程" :bordered="false" style="width: 520px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="标题">
          <n-input v-model:value="eventDraft.title" placeholder="例如：高数第三章复习" />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="日期" style="flex: 1">
            <n-input v-model:value="eventDraft.date" placeholder="YYYY-MM-DD" />
          </n-form-item>
          <n-form-item label="类型" style="flex: 1">
            <n-select
              v-model:value="eventDraft.type"
              :options="[
                { label: '学习', value: 'study' },
                { label: '考试', value: 'exam' },
                { label: '截止', value: 'deadline' },
                { label: '自定义', value: 'custom' }
              ]"
            />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="开始" style="flex: 1">
            <n-input v-model:value="eventDraft.startTime" :disabled="eventDraft.allDay" placeholder="09:00" />
          </n-form-item>
          <n-form-item label="结束" style="flex: 1">
            <n-input v-model:value="eventDraft.endTime" :disabled="eventDraft.allDay" placeholder="10:00" />
          </n-form-item>
          <n-form-item label="全天" style="flex: 0 0 90px">
            <n-switch v-model:value="eventDraft.allDay" />
          </n-form-item>
        </div>
        <n-form-item label="备注">
          <n-input v-model:value="eventDraft.note" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="eventOpen = false">取消</n-button>
          <n-button type="primary" @click="submitEvent">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 作业规则 -->
    <n-modal v-model:show="ruleOpen" preset="card" title="新增作业规则" :bordered="false" style="width: 560px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="课程名">
          <n-input v-model:value="ruleDraft.courseName" placeholder="例如：高等数学" />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="每周布置日" style="flex: 1">
            <n-select
              v-model:value="ruleDraft.assignWeekday"
              :options="weekdayNames.map((name, index) => ({ label: `周${name}`, value: index + 1 }))"
            />
          </n-form-item>
          <n-form-item label="布置时间" style="flex: 1">
            <n-input v-model:value="ruleDraft.assignTime" placeholder="09:00" />
          </n-form-item>
          <n-form-item label="几天后截止" style="flex: 1">
            <n-input-number v-model:value="ruleDraft.submitDurationDays" :min="1" :max="30" style="width: 100%" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="生效开始" style="flex: 1">
            <n-input v-model:value="ruleDraft.startDate" placeholder="YYYY-MM-DD" />
          </n-form-item>
          <n-form-item label="生效结束" style="flex: 1">
            <n-input v-model:value="ruleDraft.endDate" placeholder="YYYY-MM-DD" />
          </n-form-item>
        </div>
      </n-form>
      <p class="rule-tip">保存后，日历里每周会自动出现「作业布置」和「作业截止」两条提醒，不需要每周手动加。</p>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="ruleOpen = false">取消</n-button>
          <n-button type="primary" @click="submitRule">保存规则</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.calendar-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cal-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.cal-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cal-arrow {
  border: 1px solid var(--border-soft);
  background: #fff;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
}
.cal-month {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  min-width: 108px;
  text-align: center;
}
.cal-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.cal-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
  align-items: start;
}
.cal-grid-wrap {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 10px;
}
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
  margin-bottom: 6px;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.cal-cell {
  position: relative;
  border: none;
  background: #fbfcfe;
  border-radius: 8px;
  min-height: 56px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  cursor: pointer;
  border: 1px solid transparent;
}
.cal-cell:hover {
  border-color: var(--border-strong);
}
.cal-cell.other {
  opacity: 0.4;
}
.cal-cell.today .cal-day {
  color: #fff;
  background: var(--primary);
  border-radius: 50%;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cal-cell.selected {
  border-color: var(--primary);
  background: #f4f7ff;
}
.cal-day {
  font-size: 12px;
  color: var(--text-regular);
  font-variant-numeric: tabular-nums;
}
.cal-minutes {
  font-size: 9.5px;
  color: var(--primary);
  background: #eef2ff;
  border-radius: 4px;
  padding: 0 3px;
}
.cal-dots {
  display: flex;
  gap: 2px;
  margin-top: auto;
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  display: inline-block;
}
.cal-side {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.side-minutes {
  font-weight: 400;
  color: var(--text-faint);
}
.side-empty {
  font-size: 11.5px;
  color: var(--text-faint);
}
.event-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border-soft);
}
.event-bar {
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
  flex-shrink: 0;
}
.event-main {
  flex: 1;
  min-width: 0;
}
.event-title {
  font-size: 12.5px;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-meta {
  font-size: 10.5px;
  color: var(--text-faint);
  margin-top: 1px;
}
.event-tag {
  background: #fdf3e3;
  color: #b7791f;
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
}
.event-del {
  border: none;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.rule-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 5px 0;
  border-bottom: 1px dashed var(--border-soft);
}
.rule-main {
  flex: 1;
}
.rule-title {
  font-size: 12.5px;
  color: var(--text-strong);
}
.rule-meta {
  font-size: 10.5px;
  color: var(--text-faint);
}
.upcoming-row {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-regular);
}
.up-date {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.up-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.rule-tip {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.6;
}

@media (max-width: 860px) {
  .cal-body {
    grid-template-columns: 1fr;
  }
  .cal-cell {
    min-height: 48px;
  }
}
</style>
