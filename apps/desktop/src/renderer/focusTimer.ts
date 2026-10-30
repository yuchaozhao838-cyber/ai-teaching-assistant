/**
 * 全局番茄钟计时器：
 * 计时状态放在组件外，切视图 / 进迷你窗口都不会丢，分钟数也跟着当前预设走。
 */
import { computed, reactive } from 'vue'
import type { FocusMode, FocusPreset, FocusTaskRef } from '@tutor/shared'
import { finishFocusSession, state } from './store'

export interface TimerState {
  mode: FocusMode
  presetId: string
  running: boolean
  totalMs: number
  remainingMs: number
  startedAt: string | null
  elapsedMs: number
  pausedMs: number
  /** 本轮已完成的番茄数（决定何时进长休） */
  finishedCount: number
  taskRef?: FocusTaskRef
}

export interface TimerFinishedPayload {
  mode: FocusMode
  completed: boolean
  minutes: number
  nextMode: FocusMode
  autoStartNext: boolean
}

export const timer = reactive<TimerState>({
  mode: 'focus',
  presetId: '',
  running: false,
  totalMs: 0,
  remainingMs: 0,
  startedAt: null,
  elapsedMs: 0,
  pausedMs: 0,
  finishedCount: 0
})

let ticker: number | null = null
let lastTick = 0
const listeners = new Set<(payload: TimerFinishedPayload) => void>()
/** 上一次响过的时间，避免重复响铃 */
let lastSignalAt = 0

export const currentPreset = computed<FocusPreset>(() => {
  const presets = state.focusPresets
  return (
    presets.find((item) => item.id === timer.presetId) ??
    presets[0] ?? {
      id: 'preset_25_5',
      name: '25 / 5 标准',
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      pomodorosPerLongBreak: 4,
      autoStartNext: false
    }
  )
})

export function minutesOfMode(mode: FocusMode = timer.mode): number {
  const preset = currentPreset.value
  if (mode === 'focus') return preset.focusMinutes
  if (mode === 'shortBreak') return preset.shortBreakMinutes
  return preset.longBreakMinutes
}

function presetsReady(): boolean {
  return (state.focusPresets?.length ?? 0) > 0
}

/** 首次进入时初始化：跟着第一个预设（或上次选的预设）走，不再写死 25 分钟 */
export function initTimer(): void {
  if (timer.totalMs > 0) return
  if (!presetsReady()) {
    timer.totalMs = 25 * 60000
    timer.remainingMs = timer.totalMs
    return
  }
  if (!timer.presetId) timer.presetId = state.focusPresets[0].id
  resetTimer(timer.mode)
}

export function selectPreset(id: string): void {
  timer.presetId = id
  timer.finishedCount = 0
  resetTimer('focus')
}

export function resetTimer(nextMode: FocusMode = timer.mode): void {
  stopTicker()
  timer.mode = nextMode
  timer.running = false
  timer.startedAt = null
  timer.elapsedMs = 0
  timer.pausedMs = 0
  timer.totalMs = (presetsReady() ? minutesOfMode(nextMode) : nextMode === 'focus' ? 25 : 5) * 60000
  timer.remainingMs = timer.totalMs
}

export function startTimer(): void {
  if (presetsReady() && !timer.totalMs) resetTimer()
  if (!timer.startedAt) timer.startedAt = new Date().toISOString()
  timer.running = true
  lastTick = Date.now()
  startTicker()
  requestNotificationPermission()
}

export function pauseTimer(): void {
  timer.running = false
  stopTicker()
}

export function skipTimer(): void {
  void finishRun(timer.mode !== 'focus')
}

function startTicker(): void {
  stopTicker()
  lastTick = Date.now()
  ticker = window.setInterval(tick, 250)
}

function stopTicker(): void {
  if (ticker) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function tick(): void {
  if (!timer.running) return
  const now = Date.now()
  const delta = Math.min(2000, now - lastTick)
  lastTick = now
  timer.elapsedMs += delta
  timer.remainingMs = Math.max(0, timer.totalMs - timer.elapsedMs)
  if (timer.remainingMs <= 0) void finishRun(true)
}

/** 发出结束提示（音效 + 系统通知 + 事件） */
function signal(kind: 'focusDone' | 'breakDone'): void {
  const stamp = Date.now()
  if (stamp - lastSignalAt < 1200) return
  lastSignalAt = stamp

  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const context = new Ctx()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = kind === 'focusDone' ? 880 : 660
    gain.gain.value = 0.08
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    window.setTimeout(() => {
      oscillator.stop()
      void context.close()
    }, 500)
  } catch {
    /* 不支持音频就静默 */
  }

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(kind === 'focusDone' ? '专注完成' : '休息结束', {
        body: kind === 'focusDone' ? '已记录这次专注，休息一下吧' : '可以开始下一轮专注了'
      })
    }
  } catch {
    /* ignore */
  }
}

function requestNotificationPermission(): void {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  } catch {
    /* ignore */
  }
}

export async function finishRun(completed: boolean): Promise<TimerFinishedPayload> {
  pauseTimer()
  const endedAt = new Date().toISOString()
  const beginAt = timer.startedAt ?? new Date(Date.now() - timer.elapsedMs).toISOString()
  const planned = Math.round(timer.totalMs / 60000)
  const actual = completed ? planned : Math.max(0, Math.round(timer.elapsedMs / 60000))

  const session = {
    mode: timer.mode,
    presetId: timer.presetId || undefined,
    plannedMinutes: planned,
    startedAt: beginAt,
    endedAt,
    pausedMinutes: Math.round(timer.pausedMs / 60000),
    actualMinutes: actual,
    completed,
    taskRef: timer.taskRef
  }

  if (timer.mode === 'focus') {
    await finishFocusSession(session)
    if (completed) {
      timer.finishedCount += 1
      const preset = currentPreset.value
      const isLong = timer.finishedCount % Math.max(1, preset.pomodorosPerLongBreak) === 0
      const nextMode: FocusMode = isLong ? 'longBreak' : 'shortBreak'
      const payload: TimerFinishedPayload = {
        mode: 'focus',
        completed,
        minutes: actual,
        nextMode,
        autoStartNext: preset.autoStartNext
      }
      resetTimer(nextMode)
      if (payload.autoStartNext) startTimer()
      emit(payload)
      signal('focusDone')
      return payload
    }
    const payload: TimerFinishedPayload = {
      mode: 'focus',
      completed: false,
      minutes: actual,
      nextMode: 'focus',
      autoStartNext: false
    }
    resetTimer('focus')
    emit(payload)
    return payload
  }

  // 休息结束
  const payload: TimerFinishedPayload = {
    mode: timer.mode,
    completed,
    minutes: actual,
    nextMode: 'focus',
    autoStartNext: false
  }
  resetTimer('focus')
  emit(payload)
  signal('breakDone')
  return payload
}

function emit(payload: TimerFinishedPayload): void {
  for (const listener of listeners) {
    try {
      listener(payload)
    } catch {
      /* ignore */
    }
  }
}

export function onTimerFinished(callback: (payload: TimerFinishedPayload) => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** 显示与进度（迷你窗口与主界面共用） */
export const timerDisplay = computed(() => {
  const seconds = Math.max(0, Math.round(timer.remainingMs / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
})

export const timerProgress = computed(() => {
  if (!timer.totalMs) return 0
  return Math.min(1, Math.max(0, 1 - timer.remainingMs / timer.totalMs))
})
