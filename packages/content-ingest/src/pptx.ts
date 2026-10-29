import AdmZip from 'adm-zip'
import type { Block } from '@tutor/shared'
import { decodeEntities } from './html'
import { newId, normalizeText } from './utils'

interface TextRun {
  text: string
  size: number
}

function slideParagraphs(xml: string): TextRun[][] {
  const paragraphs: TextRun[][] = []
  const paraRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let pm: RegExpExecArray | null
  while ((pm = paraRe.exec(xml))) {
    const body = pm[1]
    const runs: TextRun[] = []
    const runRe = /<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g
    let rm: RegExpExecArray | null
    while ((rm = runRe.exec(body))) {
      const runXml = rm[1]
      const t = /<a:t>([\s\S]*?)<\/a:t>/.exec(runXml)
      if (!t) continue
      const sizeMatch = /sz="(\d+)"/.exec(runXml)
      runs.push({
        text: decodeEntities(t[1]),
        size: sizeMatch ? Number(sizeMatch[1]) / 100 : 18
      })
    }
    if (!runs.length) {
      const t = /<a:t>([\s\S]*?)<\/a:t>/.exec(body)
      if (t) runs.push({ text: decodeEntities(t[1]), size: 18 })
    }
    if (runs.length && runs.map((r) => r.text).join('').trim()) paragraphs.push(runs)
  }
  return paragraphs
}

/** PPTX → Block[]：每个 slide 的第一段视为标题，其余按字号判断是否为小标题 */
export function pptxToBlocks(filePath: string): { blocks: Block[]; warnings: string[]; slideCount: number } {
  const zip = new AdmZip(filePath)
  const slides = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = Number(/(\d+)\.xml$/.exec(a.entryName)?.[1] ?? 0)
      const nb = Number(/(\d+)\.xml$/.exec(b.entryName)?.[1] ?? 0)
      return na - nb
    })
  const blocks: Block[] = []
  const warnings: string[] = []

  slides.forEach((entry, index) => {
    let xml = ''
    try {
      xml = entry.getData().toString('utf8')
    } catch {
      warnings.push(`第 ${index + 1} 页解析失败`)
      return
    }
    const paragraphs = slideParagraphs(xml)
    paragraphs.forEach((runs, pIndex) => {
      const text = normalizeText(runs.map((r) => r.text).join(''))
      if (!text) return
      const maxSize = Math.max(...runs.map((r) => r.size))
      if (pIndex === 0) {
        blocks.push({ id: newId('b'), type: 'heading', text, level: 2 })
        return
      }
      if (maxSize >= 24 && text.length <= 40) {
        blocks.push({ id: newId('b'), type: 'heading', text, level: 3 })
        return
      }
      blocks.push({ id: newId('b'), type: 'paragraph', text })
    })
  })

  if (!blocks.length) warnings.push('未从 PPTX 中提取到文字，请尝试手动粘贴补充')
  return { blocks, warnings, slideCount: slides.length }
}
