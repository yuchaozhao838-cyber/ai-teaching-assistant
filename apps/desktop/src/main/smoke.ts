import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createDocument, ingestFromText } from '@tutor/content-ingest'
import type { ResourceService } from '@tutor/resource-service'
import { artifactToMarkdown, buildDocxBuffer, exportPdf, exportPptx } from '@tutor/export'
import { printHtmlToPdf } from './pdf'

const SEED = `# 第三章 导数与微分

## 3.1 导数的定义

设函数 $y=f(x)$ 在点 $x_0$ 的某个邻域内有定义，当自变量 $x$ 在 $x_0$ 处取得增量 $\\Delta x$ 时，函数取得增量
$\\Delta y = f(x_0+\\Delta x) - f(x_0)$。如果极限

$$\\lim_{\\Delta x \\to 0} \\frac{\\Delta y}{\\Delta x} = \\lim_{\\Delta x \\to 0} \\frac{f(x_0+\\Delta x)-f(x_0)}{\\Delta x}$$

存在，则称函数 $f(x)$ 在点 $x_0$ 处可导，该极限称为 $f(x)$ 在 $x_0$ 处的导数，记作 $f'(x_0)$ 或 $\\left.\\frac{dy}{dx}\\right|_{x=x_0}$。

注意：可导必连续，连续不一定可导。例如 $y=|x|$ 在 $x=0$ 处连续但不可导。

## 3.2 求导法则

四则运算法则：若 $u(x)$、$v(x)$ 都可导，则

- $(u \\pm v)' = u' \\pm v'$
- $(uv)' = u'v + uv'$
- $\\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}$，其中 $v \\neq 0$

复合函数求导（链式法则）：若 $y=f(u)$，$u=g(x)$，则 $\\frac{dy}{dx} = f'(u) \\cdot g'(x)$。

例：求 $y=\\sin(2x)$ 的导数。令 $u=2x$，则 $y'=\\cos u \\cdot 2 = 2\\cos(2x)$。

## 3.3 高阶导数与微分

二阶导数记作 $y''$ 或 $\\frac{d^2y}{dx^2}$，表示导数的导数，反映曲线的凹凸性与加速度。

微分的定义为 $dy = f'(x)dx$，它把函数增量的主要部分线性化，用于近似计算：当 $|\\Delta x|$ 很小时，
$f(x_0+\\Delta x) \\approx f(x_0) + f'(x_0)\\Delta x$。

常见错误：把 $dy$ 与 $\\Delta y$ 混为一谈。$dy$ 是线性主部，$\\Delta y - dy$ 是比 $\\Delta x$ 高阶的无穷小。`

export function smokeEnabled(): boolean {
  return process.env.AITUTOR_SMOKE === '1'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 自动化冒烟：截图 + 跑一遍「导入 → 生成 → 导出」链路，仅在 AITUTOR_SMOKE=1 时启用 */
export async function runSmoke(win: BrowserWindow, resources: ResourceService): Promise<void> {
  const outDir = process.env.AITUTOR_SMOKE_OUT || path.join(app.getPath('temp'), 'aitutor-smoke')
  await fs.mkdir(outDir, { recursive: true })
  const report: string[] = []

  const shot = async (name: string) => {
    try {
      const image = await win.webContents.capturePage()
      await fs.writeFile(path.join(outDir, `${name}.png`), image.toPNG())
      const size = image.getSize()
      report.push(`screenshot ${name}: ${size.width}x${size.height}`)
    } catch (error) {
      report.push(`screenshot ${name} FAILED: ${(error as Error).message}`)
    }
  }

  try {
    await sleep(1400)
    await shot('01-library-empty')

    const ingested = ingestFromText(SEED, '第三章 导数与微分')
    const document = createDocument({
      title: ingested.title,
      sourceType: 'text',
      blocks: ingested.blocks,
      ext: 'txt'
    })
    await resources.saveDocument(document)
    report.push(`seeded document: ${document.blocks.length} blocks, ${document.plainText.length} chars`)

    win.webContents.reload()
    await sleep(1800)
    await shot('02-library')

    const clicked = await win.webContents.executeJavaScript(`(() => {
      const buttons = Array.from(document.querySelectorAll('.doc-actions button'));
      const target = buttons.find((b) => b.textContent && b.textContent.includes('生成讲解'));
      if (!target) return 'no-button';
      target.click();
      return 'clicked';
    })()`)
    report.push(`generate click: ${clicked}`)

    let artifact = null
    for (let i = 0; i < 80; i += 1) {
      await sleep(700)
      const list = await resources.listArtifacts()
      const current = list[0]
      if (current && current.status !== 'generating') {
        artifact = current
        break
      }
    }
    await sleep(900)
    await shot('03-lesson')

    if (artifact) {
      report.push(
        `artifact: status=${artifact.status} sections=${artifact.outline.length} explanations=${artifact.explanations.length} keypoints=${artifact.keyPoints.length}`
      )
      try {
        const docx = await buildDocxBuffer(artifact)
        await fs.writeFile(path.join(outDir, 'smoke.docx'), docx)
        report.push(`docx export: ${docx.length} bytes`)
      } catch (error) {
        report.push(`docx export FAILED: ${(error as Error).message}`)
      }
      try {
        await exportPptx(artifact, path.join(outDir, 'smoke.pptx'))
        const stat = await fs.stat(path.join(outDir, 'smoke.pptx'))
        report.push(`pptx export: ${stat.size} bytes`)
      } catch (error) {
        report.push(`pptx export FAILED: ${(error as Error).message}`)
      }
      try {
        const markdown = artifactToMarkdown(artifact)
        await fs.writeFile(path.join(outDir, 'smoke.md'), markdown, 'utf8')
        report.push(`md export: ${markdown.length} chars`)
      } catch (error) {
        report.push(`md export FAILED: ${(error as Error).message}`)
      }
      try {
        await exportPdf(artifact, path.join(outDir, 'smoke.pdf'), (html) => printHtmlToPdf(html))
        const stat = await fs.stat(path.join(outDir, 'smoke.pdf'))
        report.push(`pdf export: ${stat.size} bytes`)
      } catch (error) {
        report.push(`pdf export FAILED: ${(error as Error).message}`)
      }
    } else {
      report.push('artifact NOT produced (timeout)')
    }

    try {
      await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('.sidebar-foot .nav-item');
        if (button) { button.click(); return true }
        return false
      })()`)
      await sleep(900)
      await shot('04-settings')
    } catch (error) {
      report.push(`settings screenshot FAILED: ${(error as Error).message}`)
    }
  } catch (error) {
    report.push(`smoke FAILED: ${(error as Error).message}\n${(error as Error).stack ?? ''}`)
  }

  await fs.writeFile(path.join(outDir, 'smoke-report.txt'), report.join('\n'), 'utf8')
  console.log(`[smoke]\n${report.join('\n')}`)
}
