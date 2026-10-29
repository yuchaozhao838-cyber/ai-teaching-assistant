import mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import type { Block } from '@tutor/shared'
import { htmlToBlocks } from './html'

export async function docxToBlocks(filePath: string): Promise<{ blocks: Block[]; warnings: string[] }> {
  const buffer = await readFile(filePath)
  const result = await mammoth.convertToHtml({ buffer }, { includeDefaultStyleMap: true })
  const blocks = htmlToBlocks(result.value ?? '')
  const warnings = result.messages
    .filter((m) => m.type === 'error')
    .map((m) => m.message)
    .slice(0, 5)
  return { blocks, warnings }
}
