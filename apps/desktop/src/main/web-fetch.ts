import { BrowserWindow, session } from 'electron'

export interface RawBlock {
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'table'
  text: string
  level?: number
  ordered?: boolean
}

export interface WebAttachment {
  url: string
  name: string
}

export interface WebArticle {
  title: string
  url: string
  blocks: RawBlock[]
  warnings: string[]
  attachments?: WebAttachment[]
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const EXTRACT_SCRIPT = `(() => {
  const clean = (s) => (s || '').replace(/[ \\t\\u00a0]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();

  // 先收集页面里的附件链接（在删除导航/侧栏之前收集，避免漏掉）
  const FILE_EXT = /\\.(pdf|docx?|pptx?|xlsx?|txt|md|markdown|zip|rar|7z|epub|csv)(\\?|#|$)/i;
  const attachments = [];
  const seen = new Set();
  const addFile = (url, name) => {
    try {
      if (!url || !/^https?:/i.test(url)) return;
      if (!FILE_EXT.test(url)) return;
      const key = url.split('#')[0];
      if (seen.has(key)) return;
      seen.add(key);
      let label = clean(name || '');
      if (!label) { try { label = decodeURIComponent(key.split('/').pop() || ''); } catch (e) { label = key.split('/').pop() || ''; } }
      attachments.push({ url: key, name: label.slice(0, 90) });
    } catch (e) {}
  };
  try {
    for (const a of document.querySelectorAll('a[href]')) addFile(a.href, a.textContent);
    for (const el of document.querySelectorAll('iframe[src], embed[src], object[data]')) {
      addFile(el.src || el.getAttribute('data'), el.getAttribute('title') || '');
    }
  } catch (e) {}

  const dropSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'form', 'nav', 'footer',
    '[class*="ad-"]', '[class*="ads"]', '[class*="comment"]', '[class*="share"]',
    '[class*="related"]', '[class*="recommend"]', '[class*="sidebar"]', '[aria-hidden="true"]'
  ];
  for (const sel of dropSelectors) {
    try { document.querySelectorAll(sel).forEach((el) => el.remove()); } catch (e) {}
  }
  const candidates = ['article', 'main', '[role="main"]', '#content', '.content', '.article-content',
    '.post-content', '.markdown-body', '#js_content', '.rich_media_content', '.entry-content'];
  let best = null;
  let bestLen = 0;
  for (const sel of candidates) {
    for (const el of document.querySelectorAll(sel)) {
      const len = (el.innerText || '').length;
      if (len > bestLen) { bestLen = len; best = el; }
    }
  }
  if (!best || bestLen < 240) best = document.body || document.documentElement;

  const blocks = [];
  const push = (type, text, level, ordered) => {
    const t = clean(text);
    if (t.length < 2) return;
    blocks.push({ type, text: t, level, ordered });
  };
  const walk = (node) => {
    for (const child of node.children) {
      const tag = (child.tagName || '').toLowerCase();
      if (/^h[1-6]$/.test(tag)) push('heading', child.innerText, Number(tag[1]));
      else if (tag === 'p' || tag === 'blockquote' || tag === 'figcaption' || tag === 'dd' || tag === 'dt') push('paragraph', child.innerText);
      else if (tag === 'li') push('list', child.innerText, 0, false);
      else if (tag === 'pre') push('code', child.innerText);
      else if (tag === 'table') {
        const rows = Array.from(child.querySelectorAll('tr'));
        for (const row of rows) {
          const cells = Array.from(row.children).map((c) => clean(c.innerText)).filter(Boolean);
          if (cells.length) push('table', cells.join(' | '));
        }
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of child.querySelectorAll('li')) push('list', li.innerText, 0, tag === 'ol');
      } else if (child.children.length) walk(child);
      else {
        const text = clean(child.innerText || child.textContent || '');
        if (text.length > 20) push('paragraph', text);
      }
    }
  };
  walk(best);

  const h1 = document.querySelector('h1');
  const title = clean((h1 && h1.innerText) || document.title || location.href).slice(0, 120);
  return { title, url: location.href, blocks: blocks.slice(0, 800), attachments: attachments.slice(0, 25) };
})()`

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** 用隐藏窗口加载网页（真实 Chromium DOM）再抽正文，兼容 JS 渲染的页面 */
export async function fetchWebArticle(rawUrl: string): Promise<WebArticle> {
  const url = normalizeHttpUrl(rawUrl)
  if (!url) throw new Error('网址格式不对，请填写完整地址（含 https://）')

  const warnings: string[] = []
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 960,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      images: false,
      javascript: true
    }
  })
  win.webContents.setUserAgent(USER_AGENT)

  try {
    await withTimeout(win.loadURL(url.toString()), 25_000, '网页加载超时（25 秒）')
    await new Promise((resolve) => setTimeout(resolve, 900))
    const result = (await withTimeout(win.webContents.executeJavaScript(EXTRACT_SCRIPT, true), 20_000, '网页正文提取超时')) as {
      title: string
      url: string
      blocks: RawBlock[]
    }
    if (!result?.blocks?.length) throw new Error('没有提取到正文，可能是需要登录或纯图片页面')
    if (result.blocks.length < 3) warnings.push('提取到的正文很短，建议先用浏览器确认页面是否可公开访问')
    return { title: result.title || url.hostname, url: result.url || url.toString(), blocks: result.blocks, warnings }
  } finally {
    win.destroy()
  }
}

/* --------------------------- 可登录的实时抓取窗口 --------------------------- */

// 独立持久化分区：登录状态（cookie/localStorage）会保存在本机，下次抓同一站点免登录
const CAPTURE_PARTITION = 'persist:aitutor-web'
let captureWindow: BrowserWindow | null = null

export function normalizeHttpUrl(rawUrl: string): URL | null {
  const text = (rawUrl ?? '').trim()
  if (!text) return null
  try {
    const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`
    const url = new URL(withScheme)
    if (!/^https?:$/.test(url.protocol)) return null
    return url
  } catch {
    return null
  }
}

export function getCaptureWindow(): BrowserWindow | null {
  return captureWindow && !captureWindow.isDestroyed() ? captureWindow : null
}

/** 打开一个可见的真实浏览器窗口，用户可以登录、翻页、展开内容后再抓取 */
export async function openCaptureWindow(rawUrl: string): Promise<{ ok: boolean; error?: string }> {
  const url = normalizeHttpUrl(rawUrl)
  if (!url) return { ok: false, error: '网址格式不对，请填写完整地址（例如 https://example.com/lesson）' }

  const existing = getCaptureWindow()
  if (existing) {
    existing.show()
    existing.focus()
    try {
      await withTimeout(existing.loadURL(url.toString()), 25_000, '加载超时')
    } catch {
      return { ok: false, error: '页面加载超时，请检查网络或地址' }
    }
    return { ok: true }
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    title: '网页抓取窗口 — 登录/翻页后回到主窗口点「抓取当前页面」',
    autoHideMenuBar: false,
    webPreferences: {
      partition: CAPTURE_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      images: true,
      spellcheck: false
    }
  })
  captureWindow = win
  win.webContents.setUserAgent(USER_AGENT)
  win.on('closed', () => {
    if (captureWindow === win) captureWindow = null
  })
  // 站内新窗口（target=_blank）直接在本窗口打开，避免弹出无法抓取的子窗口
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void win.loadURL(target)
    return { action: 'deny' }
  })

  try {
    await withTimeout(win.loadURL(url.toString()), 30_000, '加载超时')
  } catch {
    return { ok: false, error: '页面加载超时，请检查网络或地址' }
  }
  return { ok: true }
}

export interface CaptureState {
  open: boolean
  url: string
  title: string
}

export function captureState(): CaptureState {
  const win = getCaptureWindow()
  if (!win) return { open: false, url: '', title: '' }
  return { open: true, url: win.webContents.getURL(), title: win.getTitle() }
}

/** 在抓取窗口的“当前页面”上执行正文提取 */
export async function captureCurrentPage(): Promise<{ ok: boolean; article?: WebArticle; error?: string }> {
  const win = getCaptureWindow()
  if (!win) return { ok: false, error: '抓取窗口已关闭，请重新点「打开抓取窗口」' }
  const currentUrl = win.webContents.getURL()
  if (!/^https?:/i.test(currentUrl)) return { ok: false, error: '当前不是网页（可能是空白页），请先打开要抓取的页面' }

  try {
    const result = (await withTimeout(win.webContents.executeJavaScript(EXTRACT_SCRIPT, true), 25_000, '正文提取超时')) as {
      title: string
      url: string
      blocks: RawBlock[]
      attachments?: WebAttachment[]
    }
    if (!result?.blocks?.length) {
      return { ok: false, error: '这一页没提取到正文：可能需要先滚动加载/展开，或换一个页面' }
    }
    return {
      ok: true,
      article: {
        title: result.title || win.getTitle() || currentUrl,
        url: result.url || currentUrl,
        blocks: result.blocks,
        attachments: result.attachments ?? [],
        warnings: ['从可登录的抓取窗口提取，正文可能包含登录后的个人内容；请确认没有敏感信息后再生成为讲解']
      }
    }
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? String(error) }
  }
}

export function closeCaptureWindow(): void {
  const win = getCaptureWindow()
  if (win) win.close()
  captureWindow = null
}

const CP_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/markdown': '.md'
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function pickFileName(url: string, disposition: string | null, contentType: string | null): string {
  const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
  let name = match ? safeDecode(match[1].trim()) : safeDecode((url.split('?')[0].split('/').pop() || 'download').trim())
  name = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const ext = CP_EXT[(contentType ?? '').split(';')[0].trim().toLowerCase()]
    if (ext) name += ext
  }
  return name || 'download'
}

/** 用抓取窗口的登录态下载附件（课上资料经常需要登录才能下载） */
export async function downloadWithCaptureSession(url: string): Promise<{ data: Buffer; fileName: string }> {
  const ses = session.fromPartition(CAPTURE_PARTITION)
  const res = await withTimeout(ses.fetch(url, { credentials: 'include' }), 60_000, '下载超时（60 秒）')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) throw new Error('下载到的文件是空的')
  const fileName = pickFileName(url, res.headers.get('content-disposition'), res.headers.get('content-type'))
  return { data: buffer, fileName }
}
