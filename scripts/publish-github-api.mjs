/**
 * 纯 GitHub API 发布（不走 git push、不依赖 github.com）
 *
 * 适用场景：网络能访问 api.github.com / uploads.github.com，但 github.com 连不上。
 * 用法：
 *   $env:GH_TOKEN = "ghp_xxx"          # 需要有 repo 权限
 *   node scripts/publish-github-api.mjs --repo ai-teaching-assistant --visibility public
 * 可选参数：
 *   --version v1.0.0     Release 版本号
 *   --skip-release       只推代码，不建 Release
 *   --dry-run            只打印将要做什么
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] ?? '' : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
if (!token) {
  console.error('缺少 GH_TOKEN 环境变量（需要 Personal Access Token，classic 勾选 repo 即可）')
  process.exit(1)
}
const repoName = arg('repo', 'ai-teaching-assistant')
const visibility = arg('visibility', 'public')
const version = arg('version', 'v1.0.0')
const dryRun = flag('dry-run')

const API = 'https://api.github.com'
const UPLOAD = 'https://uploads.github.com'
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ai-teaching-assistant-publisher'
}

async function api(method, url, body, opts = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: { ...headers, ...(body && !opts.raw ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (opts.raw ? body : JSON.stringify(body)) : undefined
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const message = data?.message || text.slice(0, 200)
    const error = new Error(`${method} ${url} → ${res.status}: ${message}`)
    error.status = res.status
    error.data = data
    throw error
  }
  return data
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function main() {
  const me = await api('GET', '/user')
  console.log(`账号：${me.login}`)

  // 1. 建仓库（已存在则复用）
  let repo
  try {
    repo = await api('GET', `/repos/${me.login}/${repoName}`)
    console.log(`仓库已存在：${repo.html_url}`)
  } catch (error) {
    if (error.status !== 404) throw error
    if (dryRun) {
      console.log(`[dry-run] 将要创建仓库 ${repoName} (${visibility})`)
    } else {
      repo = await api('POST', '/user/repos', {
        name: repoName,
        description: '把课件变成知识点详解 + 重点划分 + 习题练习（Electron + Vue，含手机版 PWA）',
        private: visibility === 'private',
        auto_init: false,
        has_issues: true,
        has_wiki: false
      })
      console.log(`已创建仓库：${repo.html_url}`)
    }
  }

  // 2. 用 Git Data API 推代码
  const files = trackedFiles()
  console.log(`准备推送 ${files.length} 个文件`)

  let parentSha = null
  let baseTree = null
  if (repo) {
    try {
      const ref = await api('GET', `/repos/${me.login}/${repoName}/git/ref/heads/main`)
      parentSha = ref.object.sha
      const parentCommit = await api('GET', `/repos/${me.login}/${repoName}/git/commits/${parentSha}`)
      baseTree = parentCommit.tree.sha
      console.log(`已有提交，将基于 ${parentSha.slice(0, 7)} 追加`)
    } catch {
      // 空仓库不能直接写 blob（409 Git Repository is empty），先用 Contents API 落一个初始提交
      console.log('仓库还是空的，先初始化一个初始提交…')
      await api('PUT', `/repos/${me.login}/${repoName}/contents/README.md`, {
        message: 'chore: 初始化仓库',
        content: Buffer.from('# AI 课堂助手\n\n初始化提交，随后由发布脚本覆盖为正式 README。\n', 'utf8').toString('base64')
      })
      const ref = await api('GET', `/repos/${me.login}/${repoName}/git/ref/heads/main`)
      parentSha = ref.object.sha
      const parentCommit = await api('GET', `/repos/${me.login}/${repoName}/git/commits/${parentSha}`)
      baseTree = parentCommit.tree.sha
      console.log(`初始化完成，基线提交 ${parentSha.slice(0, 7)}`)
    }
  }

  const tree = []
  for (const [index, relative] of files.entries()) {
    const absolute = path.join(root, relative)
    const stat = statSync(absolute)
    if (stat.size > 40 * 1024 * 1024) {
      console.warn(`跳过超大文件（>40MB）：${relative}`)
      continue
    }
    const content = readFileSync(absolute).toString('base64')
    if (dryRun) {
      tree.push({ path: relative, mode: '100644', type: 'blob', sha: 'dry-run' })
      continue
    }
    const blob = await api('POST', `/repos/${me.login}/${repoName}/git/blobs`, {
      content,
      encoding: 'base64'
    })
    tree.push({ path: relative, mode: '100644', type: 'blob', sha: blob.sha })
    if ((index + 1) % 20 === 0 || index + 1 === files.length) {
      console.log(`  已上传 ${index + 1}/${files.length}`)
    }
  }

  if (dryRun) {
    console.log(`[dry-run] 将创建 tree（${tree.length} 项）、commit、更新 main`)
  } else {
    const treeRes = await api('POST', `/repos/${me.login}/${repoName}/git/trees`, {
      tree,
      ...(baseTree ? { base_tree: baseTree } : {})
    })
    const commit = await api('POST', `/repos/${me.login}/${repoName}/git/commits`, {
      message: 'chore: 发布 v1.0.0（讲解闭环 + 习题练习 + 手机版 PWA）',
      tree: treeRes.sha,
      parents: parentSha ? [parentSha] : []
    })
    if (parentSha) {
      await api('PATCH', `/repos/${me.login}/${repoName}/git/refs/heads/main`, { sha: commit.sha, force: true })
    } else {
      await api('POST', `/repos/${me.login}/${repoName}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha })
    }
    console.log(`代码已推送，提交：${commit.sha.slice(0, 7)}`)
  }

  if (flag('skip-release') || dryRun) {
    console.log(dryRun ? '[dry-run] 完成' : '已跳过 Release')
    return
  }

  // 3. 建 Release
  const notes = readFileSync(path.join(root, 'docs', 'release-notes-v1.0.0.md'), 'utf8')
  let release
  try {
    release = await api('GET', `/repos/${me.login}/${repoName}/releases/tags/${version}`)
    console.log(`Release ${version} 已存在，将补传资源`)
  } catch {
    release = await api('POST', `/repos/${me.login}/${repoName}/releases`, {
      tag_name: version,
      name: `AI 课堂助手 ${version}`,
      body: notes,
      draft: false,
      prerelease: false
    })
    console.log(`已创建 Release：${release.html_url}`)
  }

  // 4. 上传安装包（走 uploads.github.com）
  const assets = [
    ['release-e44/AI-Tutor-Assistant-1.0.0-win64.zip', 'AI-Tutor-Assistant-1.0.0-win64.zip'],
    ['release-e44/AI-Tutor-Assistant-1.0.0-portable.exe', 'AI-Tutor-Assistant-1.0.0-portable.exe'],
    ['release-e44/AI-Tutor-Assistant-1.0.0-setup.exe', 'AI-Tutor-Assistant-1.0.0-setup.exe'],
    ['release-mobile/AI课堂助手-手机版.zip', 'AI-Tutor-Assistant-mobile-web.zip']
  ]

  const existing = new Set((release.assets ?? []).map((asset) => asset.name))
  for (const [relative, assetName] of assets) {
    const absolute = path.join(root, relative)
    let stat
    try {
      stat = statSync(absolute)
    } catch {
      console.warn(`缺少文件，跳过：${relative}`)
      continue
    }
    if (existing.has(assetName)) {
      console.log(`已存在同名资源，跳过：${assetName}`)
      continue
    }
    console.log(`上传 ${assetName}（${(stat.size / 1024 / 1024).toFixed(1)} MB）…`)
    const buffer = readFileSync(absolute)
    const uploadUrl = `${UPLOAD}/repos/${me.login}/${repoName}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buffer.length),
        'User-Agent': 'ai-teaching-assistant-publisher'
      },
      body: buffer
    })
    if (!res.ok) {
      const text = await res.text()
      console.warn(`  上传失败（${res.status}）：${text.slice(0, 160)}`)
      continue
    }
    console.log('  完成')
  }

  console.log(`\n仓库：${repo?.html_url ?? `https://github.com/${me.login}/${repoName}`}`)
  console.log(`Release：${release.html_url}`)
}

main().catch((error) => {
  console.error('发布失败：', error.message)
  if (error.status === 401) console.error('提示：Token 无效或已过期')
  if (error.status === 403) console.error('提示：Token 权限不足（需要 repo 权限），或触发了频率限制')
  process.exit(1)
})
