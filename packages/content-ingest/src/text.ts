import type { Block } from '@tutor/shared'
import { newId } from './utils'

/** 纯文本 / Markdown → Block[] */
export function textToBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const push = (type: Block['type'], text: string, extra?: Partial<Block>) => {
    if (!text.trim()) return
    blocks.push({ id: newId('b'), type, text: text.trim(), ...extra })
  }

  let inCode = false
  let codeBuf: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*```/.test(line)) {
      if (inCode) {
        push('code', codeBuf.join('\n'))
        codeBuf = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(raw)
      continue
    }
    if (!line.trim()) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      push('heading', heading[2], { level: heading[1].length })
      continue
    }
    const formula = /^\s*\$\$\s*([\s\S]+?)\s*\$\$\s*$/.exec(line)
    if (formula) {
      push('formula', formula[1], { latex: formula[1] })
      continue
    }
    if (/^\s*[-*+•]\s+/.test(line)) {
      push('list', line.replace(/^\s*[-*+•]\s+/, ''), { ordered: false })
      continue
    }
    if (/^\s*\d+[.)、]\s+/.test(line)) {
      push('list', line.replace(/^\s*\d+[.)、]\s+/, ''), { ordered: true })
      continue
    }
    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && (line.match(/\|/g)?.length ?? 0) >= 2) {
      push('table', line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()).join(' | '))
      continue
    }
    push('paragraph', line)
  }
  if (inCode && codeBuf.length) push('code', codeBuf.join('\n'))
  return blocks
}
