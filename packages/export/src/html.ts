import { marked } from 'marked'
import katex from 'katex'
import type { KeyPointLevel, LessonArtifact } from '@tutor/shared'
import { protectMath, restoreMath } from './markdown'

const LEVEL_LABEL: Record<KeyPointLevel, string> = {
  high: '★★★ 必须掌握',
  medium: '★★ 理解即可',
  low: '★ 了解即可'
}

const LEVEL_CLASS: Record<KeyPointLevel, string> = {
  high: 'kp-high',
  medium: 'kp-medium',
  low: 'kp-low'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderMath(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, {
      output: 'mathml',
      displayMode: display,
      throwOnError: false,
      strict: false
    })
  } catch {
    return `<code>${escapeHtml(latex)}</code>`
  }
}

export function markdownToHtml(markdown: string): string {
  const { text, math } = protectMath(markdown ?? '')
  const html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string
  return restoreMath(html, math, (latex, display) => renderMath(latex, display))
}

export function renderLessonHtml(artifact: LessonArtifact): string {
  const date = new Date(artifact.createdAt)
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const outlineHtml = artifact.outline
    .map(
      (node, index) =>
        `<li><span class="idx">${index + 1}</span><div><strong>${escapeHtml(node.title)}</strong>${
          node.summary ? `<p>${escapeHtml(node.summary)}</p>` : ''
        }</div></li>`
    )
    .join('')

  const sectionsHtml = artifact.outline
    .map((node, index) => {
      const explanation = artifact.explanations.find((e) => e.sectionId === node.id)
      return `<section class="section">
        <h2><span class="num">${String(index + 1).padStart(2, '0')}</span>${escapeHtml(node.title)}</h2>
        ${node.summary ? `<p class="lead">${escapeHtml(node.summary)}</p>` : ''}
        <div class="prose">${markdownToHtml(explanation?.markdown ?? '')}</div>
      </section>`
    })
    .join('')

  const levels: KeyPointLevel[] = ['high', 'medium', 'low']
  const keyPointsHtml = levels
    .map((level) => {
      const points = artifact.keyPoints.filter((kp) => kp.level === level)
      if (!points.length) return ''
      const items = points
        .map((kp) => {
          const section = artifact.outline.find((n) => n.id === kp.sectionId)
          // 重点条目里常带 $...$ 公式，这里走 Markdown → KaTeX(MathML)，避免导出后出现原始 LaTeX
          return `<li class="${LEVEL_CLASS[level]}"><div class="kp-text">${markdownToHtml(kp.text)}</div>
            <div class="kp-meta">${section ? escapeHtml(section.title) : ''}${
              kp.rationale ? ` · ${markdownToHtml(kp.rationale)}` : ''
            }</div></li>`
        })
        .join('')
      return `<div class="kp-group"><h3>${LEVEL_LABEL[level]}<span class="count">${points.length} 条</span></h3><ul>${items}</ul></div>`
    })
    .join('')

  const warningsHtml = artifact.warnings.length
    ? `<div class="warnings"><strong>生成提示</strong><ul>${artifact.warnings
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join('')}</ul></div>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(artifact.documentTitle)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;
    color: #1c2a3a;
    font-size: 11.2pt;
    line-height: 1.75;
  }
  .cover { padding: 26mm 4mm 10mm; border-bottom: 2px solid #3355d1; margin-bottom: 8mm; }
  .cover .tag { font-size: 9pt; letter-spacing: 3px; color: #3355d1; font-weight: 700; }
  .cover h1 { font-size: 24pt; margin: 6mm 0 4mm; line-height: 1.35; color: #142033; }
  .cover .meta { font-size: 9pt; color: #6b7887; }
  h2 { font-size: 14.5pt; margin: 0 0 3mm; color: #1a2b45; border-left: 4px solid #3355d1; padding-left: 3mm; }
  h2 .num { color: #a9b6c6; font-size: 11pt; margin-right: 3mm; letter-spacing: 1px; }
  h3 { font-size: 11.5pt; margin: 4mm 0 2mm; color: #24406e; }
  p { margin: 0 0 2.6mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }
  .lead { color: #6b7887; font-size: 9.5pt; margin-bottom: 3mm; }
  .section { break-inside: auto; margin-bottom: 9mm; }
  .prose { text-align: justify; }
  .prose blockquote {
    margin: 3mm 0; padding: 2.5mm 4mm; border-left: 3px solid #e0a92c;
    background: #fdf8ec; color: #6a5320; font-size: 10pt;
  }
  .prose code { background: #f2f4f7; padding: 0.4mm 1.2mm; border-radius: 2px; font-size: 9.6pt; font-family: Consolas, monospace; }
  .prose pre { background: #f5f7fa; padding: 3mm; border-radius: 3px; overflow: hidden; }
  .prose table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.6pt; }
  .prose th, .prose td { border: 1px solid #dde3ea; padding: 1.6mm 2mm; text-align: left; }
  .prose th { background: #eef2fa; }
  .prose math { font-size: 1em; }
  .page-break { break-before: page; }
  .outline { margin-top: 4mm; }
  .outline ul { list-style: none; padding: 0; }
  .outline li { display: flex; gap: 3mm; margin-bottom: 2.4mm; break-inside: avoid; }
  .outline .idx { color: #3355d1; font-weight: 700; font-size: 10pt; min-width: 7mm; }
  .outline p { color: #6b7887; font-size: 9.5pt; margin: 0.4mm 0 0; }
  .kp-group { break-inside: avoid; margin-bottom: 6mm; }
  .kp-group h3 { font-size: 12pt; margin-bottom: 2.4mm; }
  .kp-group .count { font-size: 8.5pt; color: #98a4b2; font-weight: 400; margin-left: 3mm; }
  .kp-group ul { list-style: none; padding: 0; margin: 0; }
  .kp-group li { padding: 2.2mm 3mm; margin-bottom: 2mm; border-radius: 2mm; border-left: 3px solid #ccc; break-inside: avoid; }
  .kp-high { background: #fdf1f1; border-left-color: #c0392b !important; }
  .kp-medium { background: #fdf8e9; border-left-color: #b7791f !important; }
  .kp-low { background: #eef3fb; border-left-color: #4a6fa5 !important; }
  .kp-text { font-size: 10.4pt; font-weight: 600; }
  .kp-text p, .kp-meta p { margin: 0; display: inline; }
  .kp-text .katex, .kp-meta .katex { font-size: 1em; }
  .kp-meta { font-size: 8.6pt; color: #7d8998; margin-top: 0.8mm; font-weight: 400; }
  .warnings { margin-top: 6mm; padding: 3mm; background: #f7f9fb; border: 1px solid #e6ebf1; font-size: 8.8pt; color: #6b7887; }
  .warnings ul { margin: 1.5mm 0 0; padding-left: 5mm; }
  .footer-note { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #e6ebf1; font-size: 8.4pt; color: #98a4b2; text-align: center; }
</style>
</head>
<body>
  <div class="cover">
    <div class="tag">AI 知识点详解与重点划分</div>
    <h1>${escapeHtml(artifact.documentTitle || '学习材料')}</h1>
    <div class="meta">
      生成模型：${escapeHtml(artifact.providerName || artifact.providerId)} · ${escapeHtml(artifact.model)}<br />
      生成时间：${dateText}　·　知识点 ${artifact.outline.length} 个　·　重点 ${artifact.keyPoints.length} 条　·　提示词版本 ${escapeHtml(
        artifact.promptVersion
      )}
    </div>
  </div>

  <div class="outline">
    <h2>讲解大纲</h2>
    <ul>${outlineHtml}</ul>
  </div>

  <div class="page-break"></div>
  ${sectionsHtml}

  ${
    keyPointsHtml
      ? `<div class="page-break"></div><h2 style="margin-bottom:5mm">重点划分</h2>${keyPointsHtml}`
      : ''
  }
  ${warningsHtml}
  <div class="footer-note">由「AI 课堂助手」生成 · 内容仅供自学参考，请以教材与老师讲解为准</div>
</body>
</html>`
}
