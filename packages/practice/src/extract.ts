/**
 * 从「现成题目」文本里解析题目（不生成、不改题）。
 *
 * 设计目标：
 * 1. 尽量保留原文：题干照抄、选项照抄、答案照抄，没有答案就留空；
 * 2. 兼容粘贴文本的常见排版：公式可能单独占一行，题号/选项/答案也可能粘在一起；
 * 3. 题号和选项都保留为纯文本结构，便于预览后手工校正。
 *
 * 支持的题号：1. / 1、/ 1) / （1） / 第1题
 * 支持的选项：A. / A、/ A) / （A） / (A)
 * 支持的答案：答案：/ 【答案】/ 参考答案：/ 选择题末尾的【 C 】
 * 支持的解析：解析：/ 【解析】/ 【详解】/ 解：/ 证明：
 */
import type { ProblemDifficulty, ProblemItem, ProblemType } from '@tutor/shared'

type Draft = Omit<ProblemItem, 'id' | 'origin'> & { sourceQuote?: string; sourceNo?: number }

export interface ExtractResult {
  items: Draft[]
  warnings: string[]
}

/* ------------------------------- 识别规则 ------------------------------- */

const QUESTION_START = /^\s*(?:第\s*)?(\d{1,3})\s*[.、．)）]\s*(?=[^\d\s])/u
const QUESTION_ADJACENT = /^\s*(\d{1,3})(?=\s*[A-H]\s*[.、．)）:：]|[（(]\s*[A-H]|[【（(])/iu
const QUESTION_PAREN = /^\s*[（(]\s*(\d{1,3})\s*[)）]\s*(?=[^\d\s])/u
const QUESTION_DI = /^\s*第\s*(\d{1,3})\s*题\s*[.、:：]?\s*/u
const OPTION_START = /^\s*(?:[（(]\s*([A-H])\s*[)）]|([A-H])\s*[.、．)）:：])\s*(?=\S)/iu
const OPTION_INLINE = /(?:[（(]\s*[A-H]\s*[)）]|[A-H]\s*[.、．)）:：])\s*/giu
const QUESTION_SPACED = /^\s*(\d{1,3})\s+(?=[（(]\s*[）)])/u
const SECTION_LINE = /^\s*(?:[一二三四五六七八九十]+\s*[、.．]\s*|第[一二三四五六七八九十]+[部分章节]\s*)/u
const PRACTICE_TITLE = /^\s*(练习[一二三四五六七八九十\d]+)\s*$/u
const ANSWER_LINE = /^\s*(?:【\s*答案\s*】|答案|参考答案|正确答案)\s*[:：]?\s*/u
const EXPLAIN_LINE = /^\s*(?:【\s*(?:解析|详解|分析)\s*】|解析|详解|分析|解|证明)\s*[:：]\s*/u
/** 卷子后半部分的“参考答案/解答”整段：到这里就停止收题，避免把答案当成新题 */
const ANSWER_SECTION = /^\s*(?:参考答案(?:与评分要点)?|答案(?:与|及)?(?:解析|详解|解答)?|参考解答|解答与评分标准)\s*$/u

/** Skip common exam headers and non-question lines before the first question. */
const PAGE_NOISE = [
  /^\d{2,4}\s*[-—–]\s*\d{2,4}$/u,
  /^第\s*\d+\s*页(?:\s*\/\s*共\s*\d+\s*页)?$/u,
  /^\d+\s*\/\s*\d+$/u,
  /^[-—–]\s*\d+\s*[-—–]?$/u,
  /^20\d{2}\s*[—\-–]\s*20\d{2}(?:\s*学年)?$/u,
  /^单项选择题(?:每小题|\s*[（(]每小题)/u,
  /^选择题(?:每小题|\s*[（(]每小题)/u,
  /^将正确选项填入/u,
  /^得分\s*$/u,
  /^参考答案(?:与评分要点)?\s*$/u,
  /^命题教师签名/u
]

function isPageNoise(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  if (/^20\d{2}\s*[—\-–]\s*20\d{2}/u.test(text)) return true
  return PAGE_NOISE.some((re) => re.test(text))
}

/** Detect formula-like lines that should remain attached to nearby questions. */
function isFormulaLike(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  if (cjk >= 3) return false
  if (/[=<>≤≥≠≈∞∫∑∏√±×÷∂∇^_]/u.test(text)) return true
  if (/\\[a-zA-Z]+|(?:\d|[a-zA-Z])\s*[+\-*/]\s*(?:\d|[a-zA-Z])/u.test(text)) return true
  // 短行且只有字母数字和常见数学符号
  if (text.length <= 70 && /[a-zA-Z0-9]/u.test(text) && !/[，。；：、！？]/u.test(text)) return true
  return false
}

function cleanSection(line: string): string {
  return line
    .replace(SECTION_LINE, '')
    .replace(/[（(]\s*每小?题\s*\d+\s*分[^）)]*[）)]/u, '')
    .replace(/[（(]\s*共\s*\d+\s*分[）)]/u, '')
    .trim()
    .slice(0, 60)
}

function detectType(options: string[], answer: string, stem = ''): ProblemType {
  if (options.length >= 2) return 'choice'
  const text = `${stem}\n${answer}`
  if (/证明|求证|试证|证毕/u.test(text)) return 'proof'
  if (/_{3,}|＿{3,}/u.test(stem)) return 'fill'
  if (/计算|求极限|求导|求微分|求积分|求\s*[a-zA-Z]|导数|微分|积分|\blim\b/iu.test(stem)) return 'calc'
  if (answer.replace(/\s/g, '').length > 0) {
    return answer.replace(/\s/g, '').length <= 16 ? 'fill' : 'short'
  }
  return 'short'
}

function detectDifficulty(text: string): ProblemDifficulty {
  if (/难|综合|压轴|拓展/u.test(text)) return 'hard'
  if (/基础|简单|容易/u.test(text)) return 'easy'
  return 'medium'
}

/* ----------------------------- 行内结构拆分 ----------------------------- */

interface InlineParts {
  stem: string
  options: string[]
  answer: string
  explanation: string
}

/** 把「题干 + 选项 + 答案 + 解析」粘在一行的情况拆开 */
function splitInline(text: string): InlineParts {
  let rest = text.trim()
  let explanation = ''
  let answer = ''

  // 解析：放在最后，先切它，避免解析里的“答案”二字被误判
  const explainMatch = rest.match(/(?:【\s*(?:解析|详解|分析)\s*】|(?:解析|详解|分析|解|证明)\s*[:：])/u)
  if (explainMatch?.index != null) {
    explanation = rest.slice(explainMatch.index + explainMatch[0].length).trim()
    rest = rest.slice(0, explainMatch.index).trim()
  }

  const answerMatch = rest.match(/(?:【\s*答案\s*】|(?:答案|参考答案|正确答案)\s*[:：])/u)
  if (answerMatch?.index != null) {
    answer = rest.slice(answerMatch.index + answerMatch[0].length).trim()
    rest = rest.slice(0, answerMatch.index).trim()
  }

  // 选择题答案写在题干末尾：【 C 】或（C）
  const bracket = rest.match(/[【（(]\s*([A-H])\s*[】）)]\s*[.。]?\s*$/u)
  if (bracket) {
    if (!answer) answer = bracket[1]
    rest = rest.slice(0, bracket.index).trim()
  }

  // 一行里出现至少两个选项标记才拆，避免把题干里的 (A) 当成选项
  const optionRegex = /[（(]\s*([A-H])\s*[)）]|(?:^|\s|(?<=\d))([A-H])\s*[.、．)）:：]|(?<=\s)([A-H])\s+(?=\S)/giu
  const marks = [...rest.matchAll(optionRegex)]
  const labels = marks.map((mark) => mark[1] || mark[2] || mark[3] || '')
  const hasChoiceSequence = labels.some((label, index) => label.toUpperCase() === 'A' && labels.slice(index, index + 4).map((item) => item.toUpperCase()).join('') === 'ABCD')
  const optionCount = hasChoiceSequence ? marks.length : 0
  if (optionCount >= 2) {
    const first = marks[0].index ?? 0
    const stem = rest.slice(0, first).trim()
    const options: string[] = []
    for (let index = 0; index < marks.length; index += 1) {
      const start = (marks[index].index ?? 0) + marks[index][0].length
      const end = index + 1 < marks.length ? marks[index + 1].index ?? rest.length : rest.length
      const value = rest.slice(start, end).trim()
      if (value) options.push(value)
    }
    if (options.length >= 2) return { stem, options, answer, explanation }
  }

  return { stem: rest, options: [], answer, explanation }
}

/** 一行里排了多个选项（(A) … (B) … (C) …）时，按标记切开 */
function splitOptionLine(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const marker = /(?:[（(]\s*[A-H]\s*[)）]|(?:^|\s)[A-H]\s*[.、．)）:：]|^[A-H]\s+(?=\S))\s*/giu
  const marks = [...text.matchAll(marker)]
  const optionCount = marks.length
  if (!optionCount) return [text]
  const clean = (part: string) => part.replace(/^[|｜]\s*/u, '').replace(/\s*[|｜]$/u, '').trim()
  const parts: string[] = []
  let cursor = 0
  for (const match of marks) {
    const start = match.index ?? 0
    if (start > cursor) {
      const part = clean(text.slice(cursor, start))
      if (part) parts.push(part)
    }
    cursor = start + match[0].length
  }
  const tail = clean(text.slice(cursor))
  if (tail) parts.push(tail)
  return parts.filter(Boolean)
}

function parseInlineOptions(text: string): { stem: string; options: string[] } {
  const markers = [...text.matchAll(OPTION_INLINE)]
  if (markers.length < 2) return { stem: text, options: [] }
  const labels = markers.map((match) => match[0].match(/[A-H]/iu)?.[0]?.toUpperCase() ?? '')
  const orderedChoiceGroup = labels.length >= 3 && labels.slice(0, 3).join('') === 'ABC'
  if (!orderedChoiceGroup) return { stem: text, options: [] }
  const options: string[] = []
  const first = markers[0].index ?? 0
  const stem = text.slice(0, first).trim()
  for (let i = 0; i < markers.length; i += 1) {
    const start = (markers[i].index ?? 0) + markers[i][0].length
    const end = i + 1 < markers.length ? markers[i + 1].index ?? text.length : text.length
    const option = text.slice(start, end).trim()
    if (option) options.push(option)
  }
  return options.length >= 2 ? { stem, options } : { stem: text, options: [] }
}

/** 填空题答案写在题干末尾（如“则常数 k = 2 .”）时，把答案拆出来 */
function splitFillAnswer(stem: string): { stem: string; answer: string } {
  const match = stem.match(/([=＝]\s*)([^=＝\n.。]{1,24})\s*[.。]?\s*$/u)
  if (!match) return { stem, answer: '' }
  const value = match[2].trim()
  if (!value || /^[_＿\s]*$/u.test(value)) return { stem, answer: '' }
  if (/[\u4e00-\u9fa5，。；：、！？"'“”‘’]/u.test(value)) return { stem, answer: '' }
  if (/[=＝<>≤≥≠]/u.test(value)) return { stem, answer: '' }
  // 只接受像“数值/短表达式”的值，避免把 f(0)=0, f"(x)>0 这类题干条件当成答案
  if (!/^[\d\s+\-*/^().√πeEa-zA-Z[\]{}]+$/u.test(value)) return { stem, answer: '' }
  if (value.replace(/[\s()]/g, '').length > 18) return { stem, answer: '' }
  return { stem: `${stem.slice(0, match.index).trimEnd()} = ______`, answer: value }
}

/* ------------------------------ 答案表识别 ------------------------------ */

/**
 * 识别卷子开头的答案表：
 *   题号 1 2 3 4 5
 *   答案 A B C D A
 * 只做“能明确对上”的映射，对不上就跳过，绝不猜。
 */
function parseAnswerKey(lines: string[]): Map<number, string> {
  const map = new Map<number, string>()
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index].trim()
    if (!/^题\s*号/u.test(head)) continue
    const numbersPart = head.replace(/^.*?题\s*号/u, '')
    const numbers = (numbersPart.match(/\d{1,3}/g) ?? []).map(Number).filter((n) => n >= 1 && n <= 99)
    if (numbers.length < 2) continue

    let next = index + 1
    while (next < lines.length && !lines[next].trim()) next += 1
    if (next >= lines.length) continue
    const answerLine = lines[next].trim()
    if (!/^答\s*案/u.test(answerLine)) continue
    const raw = answerLine.replace(/^答\s*案\s*[:：]?\s*/u, '').trim()
    if (!raw) continue

    let cells = raw.split(/\t+|\s{2,}/u).map((cell) => cell.trim()).filter(Boolean)
    if (cells.length !== numbers.length) {
      cells = raw.split(/\s+/u).map((cell) => cell.trim()).filter(Boolean)
    }
    if (cells.length !== numbers.length) continue
    numbers.forEach((number, position) => {
      const value = cells[position]
      if (value && !/^[_＿\s]*$/u.test(value)) map.set(number, value)
    })
  }
  return map
}

/* -------------------------------- 主解析 -------------------------------- */

/** 单行文本里粘了多道题时，先按题号/选项/答案/解析补换行 */
function normalizeInlineLayout(text: string): string {
  return text
    .replace(/(?<!\d)(\d{1,3})(?=[A-Z]\s*[.、．)）:：])/gu, '\n$1 ')
    .replace(/(?<=[。；;！!？?])\s*(?=(?:第\s*)?\d{1,3}\s*[.、．)）]\s*[^\d\s])/gu, '\n')
    .replace(/(?<=[。；;！!？?])\s*(?=[（(]\s*\d{1,3}\s*[)）]\s*[^\d\s])/gu, '\n')
    .replace(/(?<=[。；;！!？?])\s*(?=第\s*\d{1,3}\s*题)/gu, '\n')
    .replace(/(?<=[^\n])(?=\s*(?:【\s*答案\s*】|参考答案|正确答案|答案\s*[:：]))/gu, '\n')
    .replace(/(?<=[^\n])(?=\s*(?:【\s*(?:解析|详解|分析)\s*】|解析\s*[:：]|详解\s*[:：]|分析\s*[:：]))/gu, '\n')
    .replace(/(?<=[^\n])(?=\s*[（(]\s*[A-H]\s*[)）]\s*\S)/giu, '\n')
    .replace(/(?<=[^\n])(?=\s*[A-H]\s*[.、．)）:：]\s*\S)/gu, '\n')
    .replace(/(?<=[。；;！!？?])\s*(?=\s*\d{1,3}\s+[\p{Script=Han}π√∫∑∂\[(])/gu, '\n')
}

function cleanStem(stem: string): string {
  return stem
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/【\s*】/g, '')
    .trim()
}

export function parseQuestionsFromText(raw: string): ExtractResult {
  const warnings: string[] = []
  const source = String(raw ?? '').replace(/\r\n?/g, '\n')
  const normalized = source.split('\n').length <= 2 ? normalizeInlineLayout(source) : source
  const lines = normalized.split('\n')
  const answerKey = parseAnswerKey(lines)

  const items: Draft[] = []
  let current: Draft | null = null
  let mode: 'stem' | 'options' | 'answer' | 'explain' = 'stem'
  let answerBuffer: string[] = []
  let explainBuffer: string[] = []
  let pending: string[] = []
  let sectionTitle = ''
  let practiceTitle = ''
  const seenPracticeTitles = new Set<string>()
  let lastSourceNo = 0
  let ignored = 0

  const sectionLabel = () => [practiceTitle, sectionTitle].filter(Boolean).join(' · ')

  const flush = () => {
    if (!current) return
    current.stem = cleanStem(current.stem)
    current.answer = answerBuffer.join('\n').trim()
    current.explanation = explainBuffer.join('\n').trim()

    if (!current.stem) {
      current = null
      answerBuffer = []
      explainBuffer = []
      return
    }

    // 只有一个选项多半是题干里带了个 (A)，不当作选择题
    if (current.options.length === 1) {
      current.stem = `${current.stem}\n${current.options[0]}`.trim()
      current.options = []
    }
    current.type =
      current.options.length >= 2
        ? 'choice'
        : detectType(current.options, current.answer, current.stem)

    // 选择题答案表只对「选择/填空」这类客观题小节生效，避免把二、三的大题题号套错
    if (
      !current.answer &&
      current.type === 'choice' &&
      current.sourceNo &&
      /选择|填空/u.test(current.sectionTitle ?? '')
    ) {
      const key = answerKey.get(current.sourceNo)
      if (key) current.answer = key
    }

    const usable = current.stem.length >= 4 && /[\u4e00-\u9fa5A-Za-z0-9]/u.test(current.stem)
    if (!usable) {
      current = null
      answerBuffer = []
      explainBuffer = []
      return
    }

    if (!current.answer && current.type === 'choice') {
      warnings.push(`第 ${items.length + 1} 题（原题号 ${current.sourceNo ?? '?'}）没找到答案，已留空`)
    }
    items.push(current)
    current = null
    answerBuffer = []
    explainBuffer = []
    mode = 'stem'
  }

  const startQuestion = (line: string, match: RegExpExecArray) => {
    flush()
    const sourceNo = Number(match[1])
    lastSourceNo = sourceNo
    const rest = line.slice(match.index + match[0].length).trim()
    const inline = splitInline(rest)
    const explicitOptions = parseInlineOptions(inline.stem)
    const stem = explicitOptions.options.length >= 2 ? explicitOptions.stem : inline.stem
    const options = explicitOptions.options.length >= 2 ? explicitOptions.options : inline.options
    const fill = splitFillAnswer(stem)
    const stemLines = [...pending, fill.stem].filter(Boolean)
    current = {
      type: 'choice',
      difficulty: detectDifficulty(line),
      stem: stemLines.join('\n'),
      options,
      answer: inline.answer || fill.answer,
      explanation: inline.explanation,
      sectionTitle: sectionLabel() || undefined,
      sourceNo
    }
    pending = []
    mode = inline.explanation ? 'explain' : inline.answer || fill.answer ? 'answer' : options.length ? 'options' : 'stem'
    if (inline.explanation) explainBuffer = [inline.explanation]
    if (inline.answer || fill.answer) answerBuffer = [inline.answer || fill.answer]
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t+/g, ' ').replace(/\s+$/g, '')
    if (!line.trim()) {
      if (mode === 'stem' && current) (current as Draft).stem += '\n'
      if (mode === 'explain') explainBuffer.push('')
      continue
    }

    if (isPageNoise(line)) {
      ignored += 1
      continue
    }

    // 练习一 / 练习二 这种大标题
    const practiceMatch = PRACTICE_TITLE.exec(line)
    if (practiceMatch) {
      const title = practiceMatch[1]
      // 同一个“练习一”第二次出现，通常是卷子末尾的答案区，停止收题
      if (seenPracticeTitles.has(title)) {
        flush()
        break
      }
      seenPracticeTitles.add(title)
      flush()
      practiceTitle = title
      sectionTitle = ''
      pending = []
      continue
    }

    // 一、选择与填空题
    if (SECTION_LINE.test(line) && !QUESTION_START.test(line) && !QUESTION_PAREN.test(line)) {
      flush()
      sectionTitle = cleanSection(line)
      pending = []
      continue
    }

    // 参考答案整段开始：停止收题（答案表已经在 parseAnswerKey 里单独处理过）
    if (ANSWER_SECTION.test(line) || /^\s*参考答案/u.test(line)) {
      flush()
      break
    }

    // 题号
    const diMatch = QUESTION_DI.exec(line)
    const questionMatch = diMatch ?? QUESTION_START.exec(line) ?? QUESTION_PAREN.exec(line) ?? QUESTION_ADJACENT.exec(line) ?? (/^\s*\d{1,3}\s+[（(]\s*[）)]/u.test(line) ? QUESTION_SPACED.exec(line) : null)
    if (questionMatch) {
      startQuestion(line, questionMatch)
      continue
    }

    // Keep formula-like lines preceding a numbered question with that question.
    if (!current) {
      if (isFormulaLike(line)) pending.push(line.trim())
      else ignored += 1
      continue
    }
    // startQuestion 里会给 current 赋值，但 TS 的控制流分析看不到闭包内的赋值，
    // 这里显式收窄一次，避免把 current 误判成 never。
    const active = current as Draft

    // 答案 / 解析
    if (ANSWER_LINE.test(line)) {
      mode = 'answer'
      const value = line.replace(ANSWER_LINE, '').trim()
      if (value) answerBuffer.push(value)
      continue
    }
    if (EXPLAIN_LINE.test(line)) {
      mode = 'explain'
      const value = line.replace(EXPLAIN_LINE, '').trim()
      if (value) explainBuffer.push(value)
      continue
    }

    // 选项
    const optionMatch = OPTION_START.exec(line)
    if (optionMatch && mode !== 'explain') {
      mode = 'options'
      const value = line.replace(OPTION_START, '').trim()
      const parts = splitOptionLine(value)
      if (parts.length) active.options.push(...parts)
      continue
    }
    // Some pasted sources put an option marker on its own line.
    if (/^\s*[（(]\s*[A-H]\s*[)）]\s*$/iu.test(line) || /^\s*[A-H]\s*[.、．)）:：]\s*$/iu.test(line)) {
      mode = 'options'
      active.options.push(line.replace(/[（(]\s*([A-H])\s*[)）]|^\s*([A-H])\s*[.、．)）:：]/iu, '$1$2').trim())
      continue
    }

    // 普通内容按当前模式归位
    if (mode === 'answer') {
      answerBuffer.push(line.trim())
    } else if (mode === 'explain') {
      explainBuffer.push(line.trim())
    } else if (mode === 'options' && active.options.length && !isFormulaLike(line)) {
      // 选项经常排成两列/两行，续行里可能又出现 (C)/(D) 标记
      const more = splitOptionLine(line)
      const startsLikeOption = /^\s*[|｜]?\s*(?:[（(]\s*[A-H]\s*[)）]|[A-H]\s*[.、．)）:：])/iu.test(line)
      if (more.length > 1 || startsLikeOption) active.options.push(...more)
      else if (/^[A-H]$/iu.test(active.options[active.options.length - 1] ?? '')) active.options[active.options.length - 1] = line.trim()
      else active.options[active.options.length - 1] += ` ${line.trim()}`
    } else {
      // Keep pasted line breaks so formulas and multi-line stems remain readable.
      active.stem += `${active.stem ? '\n' : ''}${line.trim()}`
    }
  }
  flush()

  // Remove duplicate questions that may occur in pasted text.
  const seen = new Set<string>()
  const deduped = items.filter((item) => {
    const key = item.stem.replace(/\s+/g, '').slice(0, 120)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!deduped.length) {
    warnings.push(
      '没识别出题目：请确认每道题以「1.」「2、」「（1）」「第1题」这类编号开头。'
    )
  } else if (ignored > 0 && ignored > deduped.length) {
    warnings.push(`已忽略 ${ignored} 行标题或非题目内容`)
  }

  return { items: deduped, warnings }
}
