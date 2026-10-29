import type { KeyPointLevel, LessonArtifact } from '@tutor/shared'

const LEVEL_LABEL: Record<KeyPointLevel, string> = {
  high: '★★★ 必须掌握',
  medium: '★★ 理解即可',
  low: '★ 了解即可'
}

export function artifactToMarkdown(artifact: LessonArtifact): string {
  const date = new Date(artifact.createdAt)
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const lines: string[] = []

  lines.push(`# ${artifact.documentTitle || '学习材料'}`)
  lines.push('')
  lines.push(
    `> 生成模型：${artifact.providerName || artifact.providerId} · ${artifact.model}　|　生成时间：${dateText}　|　提示词版本：${artifact.promptVersion}`
  )
  lines.push('')
  lines.push('## 讲解大纲')
  lines.push('')
  artifact.outline.forEach((node, index) => {
    lines.push(`${index + 1}. **${node.title}**${node.summary ? `　—　${node.summary}` : ''}`)
  })
  lines.push('')

  artifact.outline.forEach((node, index) => {
    const explanation = artifact.explanations.find((e) => e.sectionId === node.id)
    lines.push(`## ${index + 1}. ${node.title}`)
    lines.push('')
    if (explanation?.markdown) lines.push(explanation.markdown.trim())
    else lines.push('_（这一节还没有内容）_')
    lines.push('')
  })

  if (artifact.keyPoints.length) {
    lines.push('## 重点划分')
    lines.push('')
    lines.push('| 等级 | 重点内容 | 所属知识点 |')
    lines.push('| --- | --- | --- |')
    for (const kp of artifact.keyPoints) {
      const section = artifact.outline.find((n) => n.id === kp.sectionId)
      lines.push(`| ${LEVEL_LABEL[kp.level]} | ${kp.text.replace(/\|/g, '\\|')} | ${section?.title ?? ''} |`)
    }
    lines.push('')
  }

  if (artifact.warnings.length) {
    lines.push('## 生成提示')
    lines.push('')
    artifact.warnings.forEach((warning) => lines.push(`- ${warning}`))
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('_由「AI 课堂助手」生成，内容仅供自学参考。_')
  return lines.join('\n')
}
