import PptxGenJS from 'pptxgenjs'
import type { KeyPointLevel, LessonArtifact } from '@tutor/shared'
import { parseMarkdown, runsToPlain } from './markdown'
import { isMostlyMath, normalizeMathText } from './latex'

const FONT = 'Microsoft YaHei'
const INK = '1B2A3F'
const MUTED = '5C6B7A'
const ACCENT = '3355D1'

const LEVEL_TITLE: Record<KeyPointLevel, string> = {
  high: '★★★ 必须掌握',
  medium: '★★ 理解即可',
  low: '★ 了解即可'
}

const LEVEL_COLOR: Record<KeyPointLevel, string> = {
  high: 'C0392B',
  medium: 'B7791F',
  low: '4A6FA5'
}

function bulletsFromMarkdown(markdown: string, limit = 6): string[] {
  const lines: string[] = []
  for (const block of parseMarkdown(markdown)) {
    if (block.type === 'list') {
      for (const item of block.items) {
        const text = normalizeMathText(runsToPlain(item))
        if (text.length > 3) lines.push(text)
      }
    } else if (block.type === 'paragraph') {
      const raw = runsToPlain(block.runs).trim()
      if (raw.length <= 12) continue
      const text = normalizeMathText(raw)
      // 纯公式的行保留，但过长（>80 字）就不放进 PPT 了
      if (isMostlyMath(raw) && text.length > 80) continue
      if (text.length > 8) lines.push(text)
    }
    if (lines.length >= limit) break
  }
  return lines
    .slice(0, limit)
    .map((line) => (line.length > 90 ? `${line.slice(0, 88)}…` : line))
}

export async function exportPptx(artifact: LessonArtifact, outPath: string): Promise<string> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'TUTOR_16x9', width: 13.333, height: 7.5 })
  pptx.layout = 'TUTOR_16x9'
  pptx.author = 'AI 课堂助手'
  pptx.title = artifact.documentTitle
  pptx.subject = 'AI 生成的知识点讲解'

  const date = new Date(artifact.createdAt)
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  // ---- 封面 ----
  const cover = pptx.addSlide()
  cover.background = { color: '101C33' }
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT } })
  cover.addText('AI 知识点讲解', {
    x: 0.9,
    y: 1.5,
    w: 11.5,
    h: 0.6,
    fontSize: 18,
    color: '8FA6D8',
    fontFace: FONT,
    charSpacing: 2
  })
  cover.addText(artifact.documentTitle || '学习材料', {
    x: 0.9,
    y: 2.1,
    w: 11.3,
    h: 2.2,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    fontFace: FONT,
    valign: 'top',
    lineSpacingMultiple: 1.1
  })
  cover.addText(`${artifact.providerName || artifact.providerId} · ${artifact.model}　|　${dateText}　|　共 ${artifact.outline.length} 个知识点`, {
    x: 0.9,
    y: 6.2,
    w: 11.5,
    h: 0.5,
    fontSize: 14,
    color: '97A6BE',
    fontFace: FONT
  })

  // ---- 大纲 ----
  const agenda = pptx.addSlide()
  agenda.background = { color: 'FFFFFF' }
  agenda.addText('讲解大纲', { x: 0.8, y: 0.6, w: 6, h: 0.7, fontSize: 28, bold: true, color: INK, fontFace: FONT })
  agenda.addShape(pptx.ShapeType.rect, { x: 0.85, y: 1.32, w: 0.9, h: 0.06, fill: { color: ACCENT } })
  artifact.outline.forEach((node, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const x = 0.85 + col * 6.05
    const y = 1.75 + row * 1.05
    agenda.addText(String(index + 1).padStart(2, '0'), {
      x,
      y,
      w: 0.7,
      h: 0.8,
      fontSize: 22,
      bold: true,
      color: 'C6D0E4',
      fontFace: FONT
    })
    agenda.addText(
      [
        { text: node.title, options: { fontSize: 17, bold: true, color: INK, fontFace: FONT, breakLine: true } },
        ...(node.summary
          ? [{ text: node.summary, options: { fontSize: 12, color: MUTED, fontFace: FONT } } as any]
          : [])
      ],
      { x: x + 0.7, y, w: 5.2, h: 0.9, valign: 'top' }
    )
  })

  // ---- 每个知识点一页（最多 6 页，避免 PPT 过长） ----
  const maxSectionSlides = 6
  artifact.outline.slice(0, maxSectionSlides).forEach((node, index) => {
    const explanation = artifact.explanations.find((e) => e.sectionId === node.id)
    const bullets = bulletsFromMarkdown(explanation?.markdown ?? '', 5)
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.5, fill: { color: 'F4F6FC' } })
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.5, w: 13.333, h: 0.05, fill: { color: 'DCE4F5' } })
    slide.addText(`${String(index + 1).padStart(2, '0')}　${node.title}`, {
      x: 0.7,
      y: 0.4,
      w: 11.9,
      h: 0.8,
      fontSize: 26,
      bold: true,
      color: INK,
      fontFace: FONT
    })
    if (node.summary) {
      slide.addText(node.summary, {
        x: 0.7,
        y: 1.62,
        w: 11.9,
        h: 0.4,
        fontSize: 14,
        color: MUTED,
        fontFace: FONT
      })
    }
    if (bullets.length) {
      slide.addText(
        bullets.map((text, i) => ({
          text,
          options: { bullet: { code: '25CF' }, fontSize: 15, color: '233246', fontFace: FONT, breakLine: true, paraSpaceAfter: 8 }
        })),
        { x: 0.75, y: 2.15, w: 8.4, h: 4.4, valign: 'top', lineSpacingMultiple: 1.15 }
      )
    }
    const sectionPoints = artifact.keyPoints.filter((kp) => kp.sectionId === node.id).slice(0, 3)
    if (sectionPoints.length) {
      const estimatedLines = sectionPoints.reduce((acc, kp) => acc + Math.max(1, Math.ceil(kp.text.length / 13)), 0)
      const boxHeight = Math.min(4.5, 1.35 + estimatedLines * 0.3 + sectionPoints.length * 0.15)
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 9.5,
        y: 2.15,
        w: 3.2,
        h: boxHeight,
        fill: { color: 'FBF7EF' },
        line: { color: 'EFE3CC', width: 1 },
        rectRadius: 0.05
      })
      slide.addText('本节重点', { x: 9.7, y: 2.3, w: 2.8, h: 0.4, fontSize: 13, bold: true, color: '9A7B3F', fontFace: FONT })
      slide.addText(
        sectionPoints.map((kp) => ({
          text: normalizeMathText(kp.text),
          options: {
            fontSize: 11,
            color: LEVEL_COLOR[kp.level],
            fontFace: FONT,
            breakLine: true,
            paraSpaceAfter: 6
          }
        })),
        { x: 9.7, y: 2.72, w: 2.8, h: boxHeight - 0.7, valign: 'top' }
      )
    }
  })

  // ---- 重点划分 ----
  if (artifact.keyPoints.length) {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addText('重点划分', { x: 0.8, y: 0.55, w: 6, h: 0.7, fontSize: 28, bold: true, color: INK, fontFace: FONT })
    slide.addShape(pptx.ShapeType.rect, { x: 0.85, y: 1.27, w: 0.9, h: 0.06, fill: { color: ACCENT } })

    const groups: KeyPointLevel[] = ['high', 'medium', 'low']
    groups.forEach((level, groupIndex) => {
      const points = artifact.keyPoints.filter((kp) => kp.level === level).slice(0, 6)
      const x = 0.8 + groupIndex * 4.05
      slide.addText(LEVEL_TITLE[level], {
        x,
        y: 1.6,
        w: 3.7,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: LEVEL_COLOR[level],
        fontFace: FONT
      })
      if (!points.length) {
        slide.addText('—', { x, y: 2.05, w: 3.7, h: 0.4, fontSize: 12, color: 'AAB4C0', fontFace: FONT })
        return
      }
      slide.addText(
        points.map((kp) => ({
          text: normalizeMathText(kp.text),
          options: { bullet: { code: '25AA' }, fontSize: 11, color: '3C4A59', fontFace: FONT, breakLine: true, paraSpaceAfter: 6 }
        })),
        { x, y: 2.05, w: 3.75, h: 4.6, valign: 'top', lineSpacingMultiple: 1.1 }
      )
    })
  }

  // ---- 结尾 ----
  const end = pptx.addSlide()
  end.background = { color: '101C33' }
  end.addText('复习建议', { x: 0.9, y: 1.6, w: 11, h: 0.8, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: FONT })
  end.addText(
    [
      { text: '① 先过一遍「必须掌握」，确认能自己复述定义与条件', options: { breakLine: true, fontSize: 16, color: 'C9D4E8', fontFace: FONT, paraSpaceAfter: 10 } },
      { text: '② 再对照「理解即可」整理成一个知识框架图', options: { breakLine: true, fontSize: 16, color: 'C9D4E8', fontFace: FONT, paraSpaceAfter: 10 } },
      { text: '③ 合上讲义，试着把每节开头那句话讲出来；讲不出的回到原文', options: { breakLine: true, fontSize: 16, color: 'C9D4E8', fontFace: FONT, paraSpaceAfter: 10 } },
      { text: '④ 用老师给的题目检验，错题对应回本讲义的小节', options: { fontSize: 16, color: 'C9D4E8', fontFace: FONT } }
    ],
    { x: 0.95, y: 2.6, w: 11.2, h: 3.2, valign: 'top' }
  )
  end.addText('由「AI 课堂助手」生成 · 内容仅供自学参考', {
    x: 0.95,
    y: 6.5,
    w: 11,
    h: 0.4,
    fontSize: 12,
    color: '7C8BA5',
    fontFace: FONT
  })

  await pptx.writeFile({ fileName: outPath })
  return outPath
}
