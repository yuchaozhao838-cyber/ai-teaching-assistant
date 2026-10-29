/**
 * 手机版构建：复制 pdf.js worker → vite build → 校验产物
 */
import { build } from 'vite'
import { copyFile, mkdir, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const mobileDir = path.join(root, 'apps', 'mobile')

const workerSrc = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js')
const workerDst = path.join(mobileDir, 'public', 'pdf.worker.min.js')
await mkdir(path.dirname(workerDst), { recursive: true })
await copyFile(workerSrc, workerDst)
const workerStat = await stat(workerDst)
console.log(`[mobile] pdf.worker.min.js 已复制 (${(workerStat.size / 1024 / 1024).toFixed(2)} MB)`)

await build({ configFile: path.join(mobileDir, 'vite.config.mjs') })

const outDir = path.join(root, 'dist-mobile')
const files = await readdir(outDir, { withFileTypes: true })
const top = files.map((entry) => entry.name)
console.log('[mobile] 产物:', top.join(', '))
const assetsDir = path.join(outDir, 'assets')
const assets = await readdir(assetsDir)
const total = await Promise.all(assets.map(async (name) => (await stat(path.join(assetsDir, name))).size))
console.log(`[mobile] assets: ${assets.length} 个文件, ${(total.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(2)} MB`)
