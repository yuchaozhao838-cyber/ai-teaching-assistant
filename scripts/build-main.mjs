import { build } from 'esbuild'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pkgs = ['shared', 'content-ingest', 'ai-core', 'pedagogy', 'resource-service', 'export', 'practice', 'study']
const alias = Object.fromEntries(pkgs.map((p) => [`@tutor/${p}`, path.join(root, 'packages', p, 'src', 'index.ts')]))

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  alias,
  outdir: path.join(root, 'apps', 'desktop', 'out'),
  outbase: path.join(root, 'apps', 'desktop', 'src'),
  external: ['electron', 'canvas'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  legalComments: 'none',
  loader: { '.node': 'copy' },
  define: { 'process.env.NODE_ENV': '"production"' }
}

// Write a log line before any module initialisation, so we can tell how far the
// process got even if a bundled dependency fails to initialise.
const banner = [
  ';(function(){try{',
  'var fs=require("fs"),p=require("path");',
  'var d=p.join(process.env.APPDATA||process.env.HOME||".","AITutorAssistant");',
  'fs.mkdirSync(d,{recursive:true});',
  'fs.appendFileSync(p.join(d,"boot.log"),new Date().toISOString()+" bundle loaded electron="+process.versions.electron+',
  '" chrome="+process.versions.chrome+" runAsNode="+String(process.env.ELECTRON_RUN_AS_NODE)+"\\n");',
  '}catch(e){}})();'
].join('')

await build({
  ...shared,
  banner: { js: banner },
  entryPoints: [path.join(root, 'apps', 'desktop', 'src', 'main', 'index.ts')]
})

await build({
  ...shared,
  entryPoints: [path.join(root, 'apps', 'desktop', 'src', 'preload', 'index.ts')]
})

// pdfjs 在 Node 环境下会退化成「假 worker」，并 require 同目录的 ./pdf.worker.js，
// 这里把它复制到主进程产物的旁边，否则导入 PDF 会报 Cannot find module './pdf.worker.js'
const workerSrc = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.js')
const workerDst = path.join(root, 'apps', 'desktop', 'out', 'main', 'pdf.worker.js')
await mkdir(path.dirname(workerDst), { recursive: true })
await copyFile(workerSrc, workerDst)
const workerStat = await stat(workerDst)
console.log(`[build-main] pdf.worker.js copied (${(workerStat.size / 1024 / 1024).toFixed(2)} MB)`)

// PDF 页面渲染器：隐藏窗口里用 pdf.js 把每页画到 canvas，供视觉模型识别
const pdfRendererOut = path.join(root, 'apps', 'desktop', 'out', 'pdf-renderer')
await mkdir(pdfRendererOut, { recursive: true })
await build({
  entryPoints: [path.join(root, 'apps', 'desktop', 'src', 'pdf-renderer', 'render.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  outfile: path.join(pdfRendererOut, 'pdfRender.js'),
  legalComments: 'none',
  logLevel: 'warning'
})
await copyFile(path.join(root, 'apps', 'desktop', 'src', 'pdf-renderer', 'index.html'), path.join(pdfRendererOut, 'index.html'))
await copyFile(workerSrc, path.join(pdfRendererOut, 'pdf.worker.js'))
console.log('[build-main] pdf renderer bundled')

console.log('[build-main] done')
