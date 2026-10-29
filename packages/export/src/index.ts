import { writeFile } from 'node:fs/promises'
import type { LessonArtifact } from '@tutor/shared'
import { buildDocxBuffer } from './docx'
import { exportPptx } from './pptx'
import { artifactToMarkdown } from './md'
import { renderLessonHtml } from './html'

export type PrintToPdf = (html: string) => Promise<Buffer>

export { buildDocxBuffer } from './docx'
export { exportPptx } from './pptx'
export { artifactToMarkdown } from './md'
export { renderLessonHtml, markdownToHtml, renderMath } from './html'
export { parseMarkdown, runsToPlain } from './markdown'

export async function exportDocx(artifact: LessonArtifact, outPath: string): Promise<string> {
  const buffer = await buildDocxBuffer(artifact)
  await writeFile(outPath, buffer)
  return outPath
}

export async function exportMarkdown(artifact: LessonArtifact, outPath: string): Promise<string> {
  await writeFile(outPath, artifactToMarkdown(artifact), 'utf8')
  return outPath
}

export async function exportPdf(artifact: LessonArtifact, outPath: string, printToPdf: PrintToPdf): Promise<string> {
  const html = renderLessonHtml(artifact)
  const buffer = await printToPdf(html)
  await writeFile(outPath, buffer)
  return outPath
}
