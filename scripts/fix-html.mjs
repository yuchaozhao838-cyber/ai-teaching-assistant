import { promises as fs } from 'node:fs'
import path from 'node:path'

const htmlPath = path.resolve(process.argv[2] ?? 'apps/desktop/out/renderer/index.html')
let html = await fs.readFile(htmlPath, 'utf8')
const before = html

// 1. IIFE 产物不需要 module 语义
html = html.replace(/<script type="module"([^>]*)>/g, '<script$1>')
// 2. file:// 下 crossorigin 会触发 CORS，导致 CSS/字体被拦
html = html.replace(/\s+crossorigin(?=[\s>])/g, '')
// 3. 经典脚本放到 head 会早于 <div id="app">，必须 defer
html = html.replace(/<script src="([^"]+)"(?!\s+defer)/g, '<script defer src="$1"')
// 4. modulepreload 对 IIFE 无意义
html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '')

await fs.writeFile(htmlPath, html, 'utf8')
console.log(before === html ? 'index.html unchanged' : 'index.html rewritten for file:// loading')
console.log(html.match(/<(?:script|link)[^>]*>/g)?.join('\n') ?? 'no assets')
