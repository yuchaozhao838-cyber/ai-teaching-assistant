import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { KeyPointLevel, LessonArtifact } from '@tutor/shared'
import { parseMarkdown, runsToPlain, type InlineRun } from './markdown'
import { normalizeMathText } from './latex'

const FONT = 'Microsoft YaHei'
const MONO = 'Consolas'

const LEVEL_LABEL: Record<KeyPointLevel, string> = {
  high: '★★★ 必须掌握',
  medium: '★★ 理解即可',
  low: '★ 了解即可'
}

const LEVEL_FILL: Record<KeyPointLevel, string> = {
  high: 'FDE7E7',
  medium: 'FFF6DE',
  low: 'EAF1FE'
}

function toRuns(runs: InlineRun[], size = 22): TextRun[] {
  const out: TextRun[] = []
  for (const run of runs) {
    // Word 里没有公式渲染，把 $...$ 转成可读的线性写法
    const text = normalizeMathText(run.text)
    if (!text) continue
    out.push(
      new TextRun({
        text,
        bold: run.bold,
        italics: run.italic,
        font: run.code ? MONO : FONT,
        size
      })
    )
  }
  return out
}

function headingLevel(depth: number) {
  if (depth <= 1) return HeadingLevel.HEADING_2
  if (depth === 2) return HeadingLevel.HEADING_3
  return HeadingLevel.HEADING_4
}

function markdownToParagraphs(markdown: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const block of parseMarkdown(markdown)) {
    switch (block.type) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: headingLevel(block.level),
            spacing: { before: 220, after: 100 },
            children: toRuns(block.runs, block.level <= 1 ? 26 : 23)
          })
        )
        break
      case 'paragraph':
        out.push(
          new Paragraph({
            spacing: { after: 120, line: 320 },
            children: toRuns(block.runs)
          })
        )
        break
      case 'list':
        block.items.forEach((item, index) => {
          out.push(
            new Paragraph({
              spacing: { after: 60, line: 300 },
              indent: { left: 420, hanging: 220 },
              children: [
                new TextRun({
                  text: block.ordered ? `${index + 1}. ` : '• ',
                  bold: true,
                  font: FONT,
                  size: 22
                }),
                ...toRuns(item)
              ]
            })
          )
        })
        break
      case 'code':
        out.push(
          new Paragraph({
            spacing: { before: 80, after: 140, line: 260 },
            shading: { type: ShadingType.CLEAR, fill: 'F4F5F7' },
            indent: { left: 200 },
            children: [new TextRun({ text: block.text, font: MONO, size: 19 })]
          })
        )
        break
      case 'quote':
        out.push(
          new Paragraph({
            spacing: { before: 80, after: 140, line: 300 },
            indent: { left: 320 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'F0A020', space: 8 } },
            children: block.runs.map(
              (run) =>
                new TextRun({
                  text: normalizeMathText(run.text),
                  bold: run.bold,
                  italics: true,
                  font: run.code ? MONO : FONT,
                  size: 21,
                  color: '5A6672'
                })
            )
          })
        )
        break
      case 'table': {
        const rows = [
          new TableRow({
            tableHeader: true,
            children: block.header.map(
              (cell) =>
                new TableCell({
                  shading: { type: ShadingType.CLEAR, fill: 'EEF2FA' },
                  children: [new Paragraph({ children: toRuns(cell) })]
                })
            )
          }),
          ...block.rows.map(
            (row) =>
              new TableRow({
                children: row.map((cell) => new TableCell({ children: [new Paragraph({ children: toRuns(cell) })] }))
              })
          )
        ]
        out.push(
          new Paragraph({ spacing: { before: 100 }, children: [] }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
          new Paragraph({ spacing: { after: 120 }, children: [] })
        )
        break
      }
      case 'hr':
        out.push(
          new Paragraph({
            spacing: { before: 120, after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDE3EA' } },
            children: []
          })
        )
        break
      default:
        break
    }
  }
  return out
}

function keyPointTable(artifact: LessonArtifact): Table {
  const titleOf = (sectionId: string) => artifact.outline.find((n) => n.id === sectionId)?.title ?? ''
  const header = new TableRow({
    tableHeader: true,
    children: ['等级', '重点内容', '所属知识点'].map(
      (text) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: 'E9EEF8' },
          children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: FONT, size: 21 })] })]
        })
    )
  })
  const rows = artifact.keyPoints.map(
    (kp) =>
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: LEVEL_FILL[kp.level] },
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: LEVEL_LABEL[kp.level], font: FONT, size: 19 })] })]
          }),
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [new TextRun({ text: normalizeMathText(kp.text), font: FONT, size: 21 })],
                spacing: { after: 40 }
              }),
              ...(kp.rationale
                ? [
                    new Paragraph({
                      children: [new TextRun({ text: `为什么重要：${kp.rationale}`, font: FONT, size: 17, color: '7A8794' })]
                    })
                  ]
                : [])
            ]
          }),
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: titleOf(kp.sectionId), font: FONT, size: 19 })] })]
          })
        ]
      })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows]
  })
}

export async function buildDocxBuffer(artifact: LessonArtifact): Promise<Buffer> {
  const created = new Date(artifact.createdAt)
  const dateText = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(
    created.getDate()
  ).padStart(2, '0')} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 160 },
      children: [new TextRun({ text: artifact.documentTitle || '学习材料', bold: true, font: FONT, size: 44, color: '1F2D3D' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 900 },
      children: [new TextRun({ text: '知识点详解与重点划分', font: FONT, size: 28, color: '4A5B6E' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: `生成模型：${artifact.providerName || artifact.providerId} · ${artifact.model}`, font: FONT, size: 19, color: '7A8794' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: `生成时间：${dateText}　提示词版本：${artifact.promptVersion}`, font: FONT, size: 19, color: '7A8794' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: '由「AI 课堂助手」生成 · 内容仅供自学参考', font: FONT, size: 19, color: '9AA6B2' })]
    }),
    new Paragraph({ children: [new TextRun({ text: '', break: 1 })] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 200 },
      children: [new TextRun({ text: '讲解大纲', font: FONT, size: 32, color: '1F2D3D' })]
    }),
    ...artifact.outline.map(
      (node, index) =>
        new Paragraph({
          spacing: { after: 100, line: 300 },
          indent: { left: 240 },
          children: [
            new TextRun({ text: `${index + 1}. ${node.title}`, bold: true, font: FONT, size: 22 }),
            ...(node.summary ? [new TextRun({ text: `　—　${node.summary}`, font: FONT, size: 19, color: '6B7887' })] : [])
          ]
        })
    )
  ]

  children.push(
    new Paragraph({
      pageBreakBefore: true,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      children: [new TextRun({ text: '第一节　知识点详解', font: FONT, size: 32, color: '1F2D3D', bold: true })]
    })
  )

  artifact.outline.forEach((node, index) => {
    const explanation = artifact.explanations.find((e) => e.sectionId === node.id)
    if (index > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 400 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E3E8EF' } },
          children: []
        })
      )
    }
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 260, after: 120 },
        children: [new TextRun({ text: `${index + 1}. ${node.title}`, font: FONT, size: 28, color: '23408F', bold: true })]
      })
    )
    if (node.summary) {
      children.push(
        new Paragraph({
          spacing: { after: 140 },
          children: [new TextRun({ text: node.summary, italics: true, font: FONT, size: 20, color: '6B7887' })]
        })
      )
    }
    if (explanation?.markdown) {
      children.push(...markdownToParagraphs(explanation.markdown))
    }
  })

  if (artifact.keyPoints.length) {
    children.push(
      new Paragraph({
        pageBreakBefore: true,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
        children: [new TextRun({ text: '第二节　重点划分', font: FONT, size: 32, color: '1F2D3D', bold: true })]
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: '★ 越多越重要：★★★ 必须掌握（考试高频）／★★ 理解即可／★ 了解即可',
            font: FONT,
            size: 19,
            color: '7A8794'
          })
        ]
      }),
      keyPointTable(artifact)
    )
  }

  if (artifact.warnings.length) {
    children.push(
      new Paragraph({
        spacing: { before: 360, after: 100 },
        children: [new TextRun({ text: '生成提示', bold: true, font: FONT, size: 21, color: '9A6A00' })]
      }),
      ...artifact.warnings.map(
        (warning) =>
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: `· ${warning}`, font: FONT, size: 19, color: '7A8794' })]
          })
      )
    )
  }

  const doc = new Document({
    creator: 'AI 课堂助手',
    title: artifact.documentTitle,
    description: 'AI 生成的知识点详解与重点划分',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
          paragraph: { spacing: { line: 300 } }
        }
      }
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } }
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ['AI 课堂助手生成 · 仅供自学参考 · 第 ', PageNumber.CURRENT, ' 页'],
                    font: FONT,
                    size: 16,
                    color: '9AA6B2'
                  })
                ]
              })
            ]
          })
        },
        children
      }
    ]
  })

  return Packer.toBuffer(doc)
}

export { runsToPlain }
