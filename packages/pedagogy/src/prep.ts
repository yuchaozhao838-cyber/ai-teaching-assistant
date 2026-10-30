import type { ChatMessage } from '@tutor/ai-core'
import type { PrepGoal, PrepPhase, PrepTask, PrepTaskKind } from '@tutor/shared'

/** 生成计划的输入（来自表单） */
export interface PrepPlanInput {
  title: string
  examName: string
  examDate?: string
  weeks: number
  dailyMinutes: number
  baseline?: string
  targetScore?: string
  materialTitles: string[]
}

const KIND_LABEL: Record<PrepTaskKind, string> = {
  read: '学习',
  practice: '练习',
  review: '复习',
  mock: '模考',
  listen: '听力',
  write: '写作',
  vocab: '词汇'
}

export function kindLabel(kind: PrepTaskKind): string {
  return KIND_LABEL[kind] ?? '任务'
}

export function buildPrepPlanMessages(input: PrepPlanInput): ChatMessage[] {
  const materials = input.materialTitles.length
    ? input.materialTitles.slice(0, 8).join('、')
    : '（用户暂时没有导入材料）'

  return [
    {
      role: 'system',
      content:
        '你是备考规划师。只输出一个 JSON 对象，不要 Markdown 代码块、不要解释文字。JSON 必须能被 JSON.parse 直接解析。'
    },
    {
      role: 'user',
      content: `请为下面这个备考目标制定分阶段计划。

【目标】${input.title}
【考试】${input.examName || '未指定'}${input.examDate ? `（考试日期 ${input.examDate}）` : ''}
【周期】${input.weeks} 周，每天可投入 ${input.dailyMinutes} 分钟
【当前水平】${input.baseline || '未说明'}
【目标分数/结果】${input.targetScore || '未说明'}
【已有材料】${materials}

输出 JSON 结构：
{
  "summary": "两三句话说明总体策略",
  "phases": [
    {
      "name": "阶段名，如 第一阶段：打基础（第1-3周）",
      "weekFrom": 1,
      "weekTo": 3,
      "focus": "这一阶段的核心目标，一句话",
      "tasks": [
        { "title": "具体任务，动宾短语，如 每天背 30 个核心词汇", "kind": "vocab", "week": 1, "minutes": 30 }
      ]
    }
  ],
  "advice": ["2~4 条可执行的建议"]
}

要求：
- phases 覆盖第 1 周到第 ${input.weeks} 周，不重叠不留空；
- 每个阶段 3~6 条任务，week 必须落在该阶段的区间内；
- kind 只能是 read / practice / review / mock / listen / write / vocab；
- minutes 与每天可投入时间匹配（单条不超过 ${input.dailyMinutes} 分钟）；
- 任务要具体可执行，不要"提高英语水平"这类空话；
- 如果有材料，任务尽量指明用哪份材料练。`
    }
  ]
}

export function buildPrepAdviceMessages(goal: PrepGoal, materialNames: string[]): ChatMessage[] {
  const taskLines = goal.phases
    .flatMap((phase) => phase.tasks)
    .slice(0, 40)
    .map((task) => `- 第${task.week}周 ${kindLabel(task.kind)}：${task.title}${task.done ? '（已完成）' : ''}`)
    .join('\n')

  return [
    {
      role: 'system',
      content: '你是备考教练。用中文给出简洁、具体、可当天执行的建议，不超过 5 条，每条一句话。'
    },
    {
      role: 'user',
      content: `备考目标：${goal.title}
考试：${goal.examName}${goal.examDate ? `（${goal.examDate}）` : ''}
周期：${goal.weeks} 周，每天 ${goal.dailyMinutes} 分钟
当前水平：${goal.baseline || '未说明'}
目标：${goal.targetScore || '未说明'}
已有材料：${materialNames.length ? materialNames.join('、') : '（无）'}

计划任务：
${taskLines}

请给出针对这个用户的备考建议，重点包括：
1. 现有材料够不够、缺什么（如缺真题就明确说）；
2. 每天 ${goal.dailyMinutes} 分钟怎么分配最有效；
3. 这个阶段最该盯住的一件事。
每条一句，最多 5 条。`
    }
  ]
}

/* ------------------------------ 解析与兜底 ------------------------------ */

function extractJson(text: string): unknown | null {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const candidate = fenced ? fenced[1] : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

function normalizeKind(value: unknown): PrepTaskKind {
  const text = String(value ?? '').toLowerCase()
  const allow: PrepTaskKind[] = ['read', 'practice', 'review', 'mock', 'listen', 'write', 'vocab']
  return (allow.find((item) => text.includes(item)) ?? 'practice') as PrepTaskKind
}

/** 把模型输出转成结构化的 phases；失败返回 null */
export function parsePrepPlan(text: string, weeks: number, dailyMinutes: number): { summary: string; phases: PrepPhase[]; advice: string[] } | null {
  const data = extractJson(text) as
    | { summary?: unknown; phases?: unknown; advice?: unknown }
    | null
  if (!data || !Array.isArray(data.phases) || !data.phases.length) return null

  const phases: PrepPhase[] = []
  for (const rawPhase of data.phases as Array<Record<string, unknown>>) {
    const weekFrom = Math.max(1, Number(rawPhase.weekFrom) || 1)
    const weekTo = Math.min(weeks, Math.max(weekFrom, Number(rawPhase.weekTo) || weekFrom))
    const rawTasks = Array.isArray(rawPhase.tasks) ? (rawPhase.tasks as Array<Record<string, unknown>>) : []
    const tasks: PrepTask[] = rawTasks.slice(0, 8).map((rawTask, index) => {
      const week = Number(rawTask.week)
      const safeWeek = Number.isFinite(week) ? Math.min(weekTo, Math.max(weekFrom, week)) : weekFrom
      const minutes = Number(rawTask.minutes)
      return {
        id: `task_${phases.length}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        title: String(rawTask.title ?? '任务').slice(0, 60),
        kind: normalizeKind(rawTask.kind),
        week: safeWeek,
        minutes: Number.isFinite(minutes) ? Math.min(dailyMinutes, Math.max(10, minutes)) : Math.min(dailyMinutes, 30),
        done: false
      }
    })
    phases.push({
      id: `phase_${phases.length}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(rawPhase.name ?? `第 ${weekFrom}-${weekTo} 周`).slice(0, 40),
      weekFrom,
      weekTo,
      focus: String(rawPhase.focus ?? '').slice(0, 120),
      tasks
    })
  }

  phases.sort((a, b) => a.weekFrom - b.weekFrom)
  const advice = Array.isArray(data.advice)
    ? (data.advice as unknown[]).map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 5)
    : []
  return { summary: String(data.summary ?? '').slice(0, 200), phases, advice }
}

/** 没有模型时的本地计划（保证功能可用、结构一致） */
export function localPrepPlan(input: PrepPlanInput): { summary: string; phases: PrepPhase[]; advice: string[] } {
  const total = Math.max(1, Math.min(30, input.weeks))
  const third = Math.max(1, Math.round(total / 3))
  const ranges: Array<[number, number]> = [
    [1, Math.min(total, third)],
    [Math.min(total, third + 1), Math.min(total, third * 2)],
    [Math.min(total, third * 2 + 1), total]
  ]

  const template: Array<{ name: string; focus: string; tasks: Array<{ title: string; kind: PrepTaskKind; minutes: number }> }> = [
    {
      name: `第一阶段：摸底与打基础（第 ${ranges[0][0]}-${ranges[0][1]} 周）`,
      focus: '找出短板、建立每日习惯',
      tasks: [
        { title: `做一套${input.examName || '考试'}真题摸底，记录各题型错题数`, kind: 'mock', minutes: Math.min(input.dailyMinutes, 60) },
        { title: '每天固定时段背核心词汇，用间隔重复复习前一天', kind: 'vocab', minutes: Math.min(input.dailyMinutes, 25) },
        { title: '把错题按题型归类，建立错题本', kind: 'review', minutes: Math.min(input.dailyMinutes, 30) },
        { title: '整理一份自己的弱项清单（不超过 5 条）', kind: 'read', minutes: Math.min(input.dailyMinutes, 20) }
      ]
    },
    {
      name: `第二阶段：专项突破（第 ${ranges[1][0]}-${ranges[1][1]} 周）`,
      focus: '针对弱项做专项训练',
      tasks: [
        { title: '每天一个专项小练习（阅读/听力/写作轮换）', kind: 'practice', minutes: Math.min(input.dailyMinutes, 40) },
        { title: '每周复盘一次错题，能讲清楚为什么错', kind: 'review', minutes: Math.min(input.dailyMinutes, 30) },
        { title: '积累写作/翻译模板并仿写两篇', kind: 'write', minutes: Math.min(input.dailyMinutes, 35) }
      ]
    },
    {
      name: `第三阶段：模考与冲刺（第 ${ranges[2][0]}-${ranges[2][1]} 周）`,
      focus: '按考试节奏模考、查漏补缺',
      tasks: [
        { title: '每周一套限时模考，严格掐表', kind: 'mock', minutes: Math.min(input.dailyMinutes, 90) },
        { title: '模考后当天订正，只看错题和不确定题', kind: 'review', minutes: Math.min(input.dailyMinutes, 40) },
        { title: '考前三天只过错题本和高频词汇', kind: 'review', minutes: Math.min(input.dailyMinutes, 30) }
      ]
    }
  ]

  const phases: PrepPhase[] = template.map((phase, index) => {
    const [weekFrom, weekTo] = ranges[index]
    if (weekTo < weekFrom) return null
    return {
      id: `phase_${index}`,
      name: phase.name,
      weekFrom,
      weekTo,
      focus: phase.focus,
      tasks: phase.tasks.map((task, taskIndex) => ({
        id: `task_${index}_${taskIndex}`,
        title: task.title,
        kind: task.kind,
        week: weekFrom,
        minutes: task.minutes,
        done: false
      }))
    }
  }).filter(Boolean) as PrepPhase[]

  return {
    summary: `用 ${total} 周、每天 ${input.dailyMinutes} 分钟准备${input.examName || '考试'}：前期摸底打基础，中期专项突破，最后模考冲刺。这是本地模板，接入真实模型后会按你的情况定制。`,
    phases,
    advice: [
      '先把真题做一套，有了分数才知道该在哪花时间。',
      `每天 ${input.dailyMinutes} 分钟建议拆成两段（如 25 + ${Math.max(10, input.dailyMinutes - 25)}），比一次性硬撑更容易坚持。`,
      '错题本比新资料有用：同一类错三次以上，就该专门攻它。'
    ]
  }
}
