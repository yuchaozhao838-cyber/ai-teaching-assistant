/**
 * 导出链路离线自测：不依赖 Electron，验证 docx / pptx / html / markdown 四种产物。
 * 运行：node scripts/run-export-smoke.mjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { LessonArtifact } from '@tutor/shared'
import { artifactToMarkdown, buildDocxBuffer, exportPptx, renderLessonHtml } from '@tutor/export'

const artifact: LessonArtifact = {
  id: 'art_test',
  documentId: 'doc_test',
  documentTitle: '第三章 导数与微分',
  providerId: 'deepseek',
  providerName: 'DeepSeek',
  model: 'deepseek-chat',
  promptVersion: 'v1.0',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: 'done',
  warnings: ['PDF 以文本层提取，公式与图表可能有缺失'],
  stats: { sections: 3, chars: 2100, elapsedMs: 42_000, mocked: false },
  outline: [
    { id: 's1', title: '导数的定义与几何意义', summary: '从平均变化率到瞬时变化率', children: [] },
    { id: 's2', title: '求导法则与链式法则', summary: '四则运算与复合函数', children: [] },
    { id: 's3', title: '高阶导数与微分', summary: '凹凸性与线性近似', children: [] }
  ],
  explanations: [
    {
      sectionId: 's1',
      updatedAt: Date.now(),
      markdown: `### 一句话结论

导数是**瞬时变化率**，几何上是切线斜率。

设 $y=f(x)$，则

$$f'(x_0)=\\lim_{\\Delta x \\to 0}\\frac{f(x_0+\\Delta x)-f(x_0)}{\\Delta x}$$

> ⚠ 易错点：可导必连续，但连续不一定可导，例如 $y=|x|$ 在 $0$ 处。

| 概念 | 含义 |
| --- | --- |
| 平均变化率 | 割线斜率 |
| 瞬时变化率 | 切线斜率 |`
    },
    {
      sectionId: 's2',
      updatedAt: Date.now(),
      markdown: `### 四则运算

- $(u\\pm v)'=u'\\pm v'$
- $(uv)'=u'v+uv'$
- $\\left(\\frac{u}{v}\\right)'=\\frac{u'v-uv'}{v^2}$

### 链式法则

若 $y=f(u)$、$u=g(x)$，则 $\\frac{dy}{dx}=f'(u)g'(x)$。

\`\`\`text
例：y = sin(2x) → y' = 2cos(2x)
\`\`\``
    },
    {
      sectionId: 's3',
      updatedAt: Date.now(),
      manual: true,
      markdown: `二阶导数 $y''$ 描述凹凸性；微分 $dy=f'(x)dx$ 是函数增量的线性主部。

$$f(x_0+\\Delta x)\\approx f(x_0)+f'(x_0)\\Delta x$$`
    }
  ],
  keyPoints: [
    { id: 'k1', sectionId: 's1', level: 'high', text: '导数是函数增量与自变量增量之比的极限', rationale: '定义是一切计算的基础' },
    { id: 'k2', sectionId: 's1', level: 'medium', text: '导数的几何意义是切线斜率', rationale: '帮助建立直观' },
    { id: 'k3', sectionId: 's2', level: 'high', text: '链式法则：复合函数求导要乘以内层导数', rationale: '考试高频' },
    { id: 'k4', sectionId: 's3', level: 'low', text: '二阶导数反映曲线凹凸性', rationale: '了解即可' }
  ]
}

const outDir = path.join(process.cwd(), 'tmp', 'export-smoke')

async function main() {
  await fs.mkdir(outDir, { recursive: true })

  const docx = await buildDocxBuffer(artifact)
  await fs.writeFile(path.join(outDir, 'lesson.docx'), docx)
  console.log('docx:', docx.length, 'bytes')

  await exportPptx(artifact, path.join(outDir, 'lesson.pptx'))
  console.log('pptx:', (await fs.stat(path.join(outDir, 'lesson.pptx'))).size, 'bytes')

  const html = renderLessonHtml(artifact)
  await fs.writeFile(path.join(outDir, 'lesson.html'), html, 'utf8')
  console.log('html:', html.length, 'chars; mathml present:', html.includes('<math'))

  const markdown = artifactToMarkdown(artifact)
  await fs.writeFile(path.join(outDir, 'lesson.md'), markdown, 'utf8')
  console.log('markdown:', markdown.length, 'chars')
}

main().catch((error) => {
  console.error('EXPORT SMOKE FAILED:', error)
  process.exit(1)
})
