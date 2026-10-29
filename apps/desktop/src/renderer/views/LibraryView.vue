<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import type { DocumentRecord } from '@tutor/shared'
import Icon from '../components/Icon.vue'
import {
  activeProvider,
  artifactOfDocument,
  goSettings,
  importFiles,
  importText,
  importWeb,
  openArtifact,
  openDocument,
  refreshDocs,
  removeDocument,
  state,
  startLesson
} from '../store'
import { formatDateTime, formatNumber } from '../utils/format'

const message = useMessage()

const webOpen = ref(false)
const webUrl = ref('')
const webLoading = ref(false)
const webMode = ref<'direct' | 'login'>('direct')
const captureOpen = ref(false)
const captureTitle = ref('')
const captureLoading = ref(false)
const attachmentOpen = ref(false)
const attachmentLoading = ref(false)
const attachments = ref<Array<{ url: string; name: string; checked: boolean }>>([])
let captureTimer: number | null = null
const textOpen = ref(false)
const textTitle = ref('')
const textBody = ref('')
const textLoading = ref(false)
const importingFiles = ref(false)
const visionBusy = ref(false)
const visionMessage = ref('')
let visionUnsub: (() => void) | null = null
const previewOpen = ref(false)
const previewDoc = ref<DocumentRecord | null>(null)
const startingDocId = ref('')

const provider = computed(() => activeProvider())
const isDemo = computed(() => provider.value?.kind === 'demo')

onMounted(() => {
  visionUnsub = window.tutor.docs.onVisionEvent((event) => {
    if (event.type === 'progress') visionMessage.value = `${event.file}：${event.message}`
  })
})

onUnmounted(() => {
  visionUnsub?.()
})

async function onVisionImport() {
  visionBusy.value = true
  visionMessage.value = '准备中…'
  try {
    const result = await window.tutor.docs.importVisionPdf()
    if (result.canceled) return
    if (result.ok) {
      await refreshDocs()
      message.success(`识图导入完成：${result.documents?.length ?? 0} 份材料`, { duration: 6000 })
    } else {
      message.error(result.error ?? '识图导入失败', { duration: 9000 })
    }
    for (const error of result.errors ?? []) message.error(error, { duration: 9000 })
  } catch (error) {
    message.error((error as Error).message)
  } finally {
    visionBusy.value = false
    visionMessage.value = ''
  }
}

async function refreshCaptureState() {
  try {
    const current = await window.tutor.web.captureState()
    captureOpen.value = current.open
    captureTitle.value = current.title || current.url
  } catch {
    captureOpen.value = false
  }
}

watch(webOpen, (open) => {
  if (captureTimer) {
    window.clearInterval(captureTimer)
    captureTimer = null
  }
  if (open) {
    void refreshCaptureState()
    captureTimer = window.setInterval(() => {
      void refreshCaptureState()
    }, 2000)
  }
})

async function onOpenCapture() {
  const url = webUrl.value.trim()
  if (!url) {
    message.warning('请先填写网址')
    return
  }
  captureLoading.value = true
  try {
    const result = await window.tutor.web.openCapture(url)
    if (!result.ok) {
      message.error(result.error ?? '打开抓取窗口失败', { duration: 7000 })
      return
    }
    await refreshCaptureState()
    message.success('抓取窗口已打开：登录 / 翻页 / 展开内容后，回来点「抓取当前页面」')
  } finally {
    captureLoading.value = false
  }
}

async function onCaptureCurrent() {
  captureLoading.value = true
  try {
    const result = await window.tutor.web.captureCurrent()
    if (result.ok && result.document) {
      await refreshDocs()
      webOpen.value = false
      message.success(`已抓取并导入：${result.document.title}`, { duration: 5000 })
      if (result.attachments?.length) {
        attachments.value = result.attachments.map((item) => ({ ...item, checked: true }))
        attachmentOpen.value = true
      }
    } else {
      message.error(result.error ?? '抓取失败', { duration: 8000 })
    }
  } finally {
    captureLoading.value = false
  }
}

async function onDownloadAttachments() {
  const picked = attachments.value.filter((item) => item.checked)
  if (!picked.length) {
    message.warning('请先勾选要下载的附件')
    return
  }
  attachmentLoading.value = true
  try {
    const result = await window.tutor.web.downloadAttachments(
      picked.map((item) => ({ url: item.url, name: item.name }))
    )
    await refreshDocs()
    if (result.documents.length) {
      message.success(`已导入 ${result.documents.length} 个附件`, { duration: 6000 })
    }
    for (const error of result.errors ?? []) {
      message.error(error, { duration: 9000 })
    }
    if (result.documents.length && !result.errors.length) attachmentOpen.value = false
  } finally {
    attachmentLoading.value = false
  }
}

async function onCloseCapture() {
  await window.tutor.web.closeCapture()
  await refreshCaptureState()
  message.info('已关闭抓取窗口')
}

function sourceLabel(doc: DocumentRecord): string {
  if (doc.sourceType === 'web') return '网页'
  if (doc.sourceType === 'text') return '粘贴文本'
  const ext = doc.meta.ext?.toUpperCase()
  return ext ? `${ext} 文件` : '文件'
}

function extBadge(doc: DocumentRecord): string {
  if (doc.sourceType === 'web') return 'WEB'
  if (doc.sourceType === 'text') return 'TXT'
  return (doc.meta.ext ?? 'file').toUpperCase().slice(0, 4)
}

async function onImportFiles() {
  importingFiles.value = true
  try {
    const result = await importFiles()
    if (result.canceled) return
    if (result.documents.length) {
      message.success(`已导入 ${result.documents.length} 份材料`)
    }
    for (const error of result.errors ?? []) {
      message.error(error, { duration: 7000 })
    }
  } catch (error) {
    message.error((error as Error).message)
  } finally {
    importingFiles.value = false
  }
}

async function onImportWeb() {
  const url = webUrl.value.trim()
  if (!url) {
    message.warning('请先填写网址')
    return
  }
  webLoading.value = true
  try {
    const result = await importWeb(url)
    if (result.ok) {
      message.success('网页正文已导入')
      webOpen.value = false
      webUrl.value = ''
    } else {
      message.error(result.error ?? '抓取失败', { duration: 8000 })
    }
  } finally {
    webLoading.value = false
  }
}

async function onImportText() {
  if (!textBody.value.trim()) {
    message.warning('请先粘贴内容')
    return
  }
  textLoading.value = true
  try {
    const result = await importText(textTitle.value.trim() || '手动粘贴的内容', textBody.value)
    if (result.ok) {
      message.success('文本已导入')
      textOpen.value = false
      textTitle.value = ''
      textBody.value = ''
    } else {
      message.error(result.error ?? '导入失败')
    }
  } finally {
    textLoading.value = false
  }
}

function preview(doc: DocumentRecord) {
  previewDoc.value = doc
  previewOpen.value = true
}

async function onGenerate(doc: DocumentRecord) {
  startingDocId.value = doc.id
  try {
    const result = await startLesson(doc.id)
    if (!result.ok) {
      message.error(result.error ?? '无法开始生成', { duration: 8000 })
    }
  } finally {
    startingDocId.value = ''
  }
}

async function onRemove(doc: DocumentRecord) {
  await removeDocument(doc.id)
  if (previewDoc.value?.id === doc.id) previewOpen.value = false
  message.success('已删除')
}
</script>

<template>
  <div class="page library-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1>资料库</h1>
        <p>导入课件、网页或题目，AI 拆成「知识点详解 + 重点划分」，随时可复习、可导出。</p>
      </div>
      <div class="head-side">
        <button class="model-chip" @click="goSettings">
          <Icon name="zap" :size="15" />
          <span>{{ provider ? (provider.kind === 'demo' ? '本地演示模型' : provider.model || provider.name) : '未配置模型' }}</span>
          <Icon name="arrowRight" :size="14" />
        </button>
      </div>
    </header>

    <n-alert v-if="isDemo && state.docs.length" type="info" :bordered="false" class="demo-alert">
      当前使用<strong>本地演示模型</strong>，生成的是规则化演示内容（不需要联网和密钥）。在「设置」里接入 DeepSeek / 通义千问等模型，即可得到真正的 AI 讲解。
      <template #action>
        <n-button text type="primary" size="small" @click="goSettings">去设置</n-button>
      </template>
    </n-alert>

    <section class="import-grid">
      <button class="import-card import-primary" :disabled="importingFiles" @click="onImportFiles">
        <div class="import-icon"><Icon name="file" :size="22" /></div>
        <div class="import-title">导入文件</div>
        <div class="import-desc">PDF · Word · PPT · Markdown · TXT</div>
        <span class="import-arrow"><Icon name="arrowRight" :size="15" /></span>
      </button>
      <button class="import-card" @click="webOpen = true">
        <div class="import-icon"><Icon name="globe" :size="22" /></div>
        <div class="import-title">网页抓取</div>
        <div class="import-desc">从网址提取正文，自动去掉广告</div>
      </button>
      <button class="import-card" @click="textOpen = true">
        <div class="import-icon"><Icon name="text" :size="22" /></div>
        <div class="import-title">粘贴文本</div>
        <div class="import-desc">课本段落、老师给的题目</div>
      </button>
    </section>

    <div class="vision-row">
      <n-button size="small" secondary :loading="visionBusy" @click="onVisionImport">
        <template #icon><Icon name="sparkles" :size="13" /></template>
        PDF 识图导入（公式更准）
      </n-button>
      <span class="vision-hint">
        {{
          visionBusy
            ? visionMessage
            : '把 PDF 每页渲染成图片交给视觉模型转写，公式上下标/分式不会丢；需要视觉模型（qwen-vl-max、gpt-4o-mini 等）'
        }}
      </span>
    </div>

    <section v-if="state.docs.length" class="doc-section">
      <div class="section-head">
        <h2>全部材料 <span class="count">{{ state.docs.length }}</span></h2>
        <span class="section-hint">共 {{ formatNumber(state.docs.reduce((acc, d) => acc + d.meta.charCount, 0)) }} 字</span>
      </div>

      <article v-for="doc in state.docs" :key="doc.id" class="doc-row">
        <div class="doc-badge">{{ extBadge(doc) }}</div>
        <div class="doc-main" @click="preview(doc)">
          <div class="doc-title">{{ doc.title }}</div>
          <div class="doc-meta">
            <span>{{ sourceLabel(doc) }}</span>
            <span class="dot">·</span>
            <span>{{ formatNumber(doc.meta.charCount) }} 字</span>
            <span class="dot">·</span>
            <span>{{ doc.meta.blockCount }} 个内容块</span>
            <span class="dot">·</span>
            <span>{{ formatDateTime(doc.createdAt) }}</span>
            <n-tooltip v-if="doc.meta.warnings?.length" trigger="hover">
              <template #trigger>
                <span class="warn-badge"><Icon name="alert" :size="13" />{{ doc.meta.warnings.length }}</span>
              </template>
              <div class="warn-list">
                <div v-for="(warning, index) in doc.meta.warnings" :key="index">{{ warning }}</div>
              </div>
            </n-tooltip>
          </div>
        </div>
        <div class="doc-actions">
          <n-button quaternary size="small" @click="preview(doc)">预览</n-button>
          <n-button
            v-if="artifactOfDocument(doc.id)"
            quaternary
            size="small"
            @click="openArtifact(artifactOfDocument(doc.id)!.id)"
          >
            查看讲解
          </n-button>
          <n-button
            size="small"
            type="primary"
            :loading="startingDocId === doc.id"
            :disabled="state.generating"
            @click="onGenerate(doc)"
          >
            <template #icon><Icon name="sparkles" :size="14" /></template>
            {{ artifactOfDocument(doc.id) ? '重新生成' : '生成讲解' }}
          </n-button>
          <n-popconfirm @positive-click="onRemove(doc)">
            <template #trigger>
              <n-button quaternary size="small" class="icon-btn"><Icon name="trash" :size="15" /></n-button>
            </template>
            删除这份材料及其讲解记录？
          </n-popconfirm>
        </div>
      </article>
    </section>

    <section v-else class="empty-state">
      <div class="empty-visual">
        <div class="empty-card card-a"><Icon name="file" :size="18" /></div>
        <div class="empty-card card-b"><Icon name="sparkles" :size="20" /></div>
        <div class="empty-card card-c"><Icon name="book" :size="18" /></div>
      </div>
      <h3>还没有学习材料</h3>
      <p>导入一份 PDF / Word / PPT 课件，或者直接粘贴一段课本内容，30 秒得到逐节讲解。</p>
      <n-button type="primary" size="large" :loading="importingFiles" @click="onImportFiles">
        <template #icon><Icon name="upload" :size="16" /></template>
        导入第一份材料
      </n-button>
      <div class="empty-tip">所有材料只保存在本机，不上传云端</div>
    </section>

    <!-- 网页抓取 -->
    <n-modal v-model:show="webOpen" preset="card" title="网页抓取" :bordered="false" style="width: 620px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="网页地址">
          <n-input
            v-model:value="webUrl"
            placeholder="https://example.com/article"
            @keyup.enter="webMode === 'direct' ? onImportWeb() : onOpenCapture()"
          />
        </n-form-item>
        <n-form-item label="抓取方式">
          <n-radio-group v-model:value="webMode" size="small">
            <n-radio-button value="direct">公开页面（直接抓）</n-radio-button>
            <n-radio-button value="login">需要登录 / 要翻页（打开浏览窗口）</n-radio-button>
          </n-radio-group>
        </n-form-item>
      </n-form>

      <template v-if="webMode === 'direct'">
        <p class="modal-tip">
          适合公开可访问的文章、教材页面。如果提示"没有提取到正文"，多半是需要登录——改用右侧「需要登录」方式即可。
        </p>
      </template>
      <template v-else>
        <div class="capture-box">
          <div class="capture-status">
            <span class="dot-indicator" :class="{ on: captureOpen }" />
            <span v-if="captureOpen">抓取窗口已打开：{{ captureTitle }}</span>
            <span v-else>尚未打开抓取窗口</span>
          </div>
          <div class="capture-actions">
            <n-button size="small" :loading="captureLoading" @click="onOpenCapture">
              ① 打开 / 刷新抓取窗口
            </n-button>
            <n-button
              size="small"
              type="primary"
              :disabled="!captureOpen"
              :loading="captureLoading"
              @click="onCaptureCurrent"
            >
              ② 抓取当前页面
            </n-button>
            <n-button v-if="captureOpen" size="small" quaternary @click="onCloseCapture">关闭窗口</n-button>
          </div>
        </div>
        <p class="modal-tip">
          会弹出一个真实浏览器窗口：在里面登录、翻页、展开"显示更多"，内容加载好后回到这里点「② 抓取当前页面」。
          登录状态保存在本机，下次抓同一网站不用重新登录；抓完一页可以继续翻页再抓。
        </p>
      </template>

      <template #footer>
        <div class="modal-footer">
          <n-button @click="webOpen = false">取消</n-button>
          <n-button
            v-if="webMode === 'direct'"
            type="primary"
            :loading="webLoading"
            @click="onImportWeb"
          >
            抓取正文
          </n-button>
          <n-button
            v-else
            type="primary"
            :disabled="!captureOpen"
            :loading="captureLoading"
            @click="onCaptureCurrent"
          >
            抓取当前页面并导入
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 附件下载 -->
    <n-modal v-model:show="attachmentOpen" preset="card" title="这一页还有附件，要一起导入吗？" :bordered="false" style="width: 620px">
      <p class="modal-tip" style="margin-top: 0; margin-bottom: 12px">
        用抓取窗口的登录态下载，PDF / PPT / Word 会自动解析成学习材料。
      </p>
      <div class="attachment-list">
        <label v-for="(item, index) in attachments" :key="item.url" class="attachment-item">
          <n-checkbox v-model:checked="item.checked" />
          <span class="attachment-name">{{ item.name || item.url }}</span>
          <span class="attachment-ext">{{ (item.name.split('.').pop() || '').toUpperCase().slice(0, 5) }}</span>
          <span class="attachment-url" :title="item.url">{{ item.url.slice(0, 60) }}</span>
        </label>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button quaternary size="small" @click="attachments.forEach((a) => (a.checked = !attachments.every((x) => x.checked)))">
            {{ attachments.every((a) => a.checked) ? '全不选' : '全选' }}
          </n-button>
          <n-button @click="attachmentOpen = false">稍后</n-button>
          <n-button type="primary" :loading="attachmentLoading" @click="onDownloadAttachments">
            下载并导入所选
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 粘贴文本 -->
    <n-modal v-model:show="textOpen" preset="card" title="粘贴文本" :bordered="false" style="width: 680px">
      <n-form label-placement="top" :show-feedback="false">
        <n-form-item label="标题">
          <n-input v-model:value="textTitle" placeholder="例如：第三章 导数与微分（课堂笔记）" />
        </n-form-item>
        <n-form-item label="内容">
          <n-input
            v-model:value="textBody"
            type="textarea"
            :autosize="{ minRows: 10, maxRows: 18 }"
            placeholder="把课件文字、题目、笔记粘贴到这里。Markdown 的 # 标题、- 列表、$$公式$$ 都会被识别。"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="textOpen = false">取消</n-button>
          <n-button type="primary" :loading="textLoading" @click="onImportText">导入文本</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 预览 -->
    <n-drawer v-model:show="previewOpen" :width="720" placement="right">
      <n-drawer-content v-if="previewDoc" :title="previewDoc.title" closable>
        <div class="preview-meta">
          <span>{{ sourceLabel(previewDoc) }}</span>
          <span class="dot">·</span>
          <span>{{ formatNumber(previewDoc.meta.charCount) }} 字</span>
          <span class="dot">·</span>
          <span>{{ previewDoc.meta.blockCount }} 个内容块</span>
          <span class="dot">·</span>
          <span>分 {{ previewDoc.meta.chunkCount }} 块送入模型</span>
        </div>
        <n-alert v-for="(warning, index) in previewDoc.meta.warnings" :key="index" type="warning" :bordered="false" class="preview-warning">
          {{ warning }}
        </n-alert>
        <div class="preview-body">
          <template v-for="block in previewDoc.blocks" :key="block.id">
            <h4 v-if="block.type === 'heading'" :class="`h${block.level ?? 2}`">{{ block.text }}</h4>
            <ul v-else-if="block.type === 'list'" class="preview-list">
              <li>{{ block.text }}</li>
            </ul>
            <pre v-else-if="block.type === 'code'" class="preview-code">{{ block.text }}</pre>
            <p v-else-if="block.type === 'formula'" class="preview-formula">$${{ block.latex ?? block.text }}$$</p>
            <p v-else-if="block.type === 'table'" class="preview-table">{{ block.text }}</p>
            <p v-else class="preview-paragraph">{{ block.text }}</p>
          </template>
        </div>
        <template #footer>
          <div class="modal-footer">
            <n-button @click="previewOpen = false">关闭</n-button>
            <n-button type="primary" @click="onGenerate(previewDoc)">
              <template #icon><Icon name="sparkles" :size="14" /></template>
              生成讲解
            </n-button>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.demo-alert {
  margin-bottom: 18px;
}
.modal-md {
  width: 560px;
}
.modal-lg {
  width: 680px;
}
.modal-tip {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.7;
}

.capture-box {
  background: #f7f9fc;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 4px;
}

.capture-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-regular);
  margin-bottom: 10px;
  line-height: 1.6;
  word-break: break-all;
}

.dot-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
}

.dot-indicator.on {
  background: #1f9d76;
  box-shadow: 0 0 0 3px rgba(31, 157, 118, 0.14);
}

.capture-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: #fbfcfe;
  cursor: pointer;
}

.attachment-name {
  font-size: 12.5px;
  color: var(--text-strong);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-ext {
  font-size: 10px;
  color: #5a6b85;
  background: #eef2fa;
  border-radius: 4px;
  padding: 1px 5px;
}

.attachment-url {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-faint);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vision-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -12px 0 20px;
  flex-wrap: wrap;
}

.vision-hint {
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.6;
  flex: 1;
  min-width: 200px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.preview-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--text-muted);
  font-size: 12.5px;
  margin-bottom: 14px;
}
.preview-warning {
  margin-bottom: 10px;
}
.preview-body {
  font-size: 14px;
  line-height: 1.9;
  color: var(--text-strong);
}
.preview-body h4 {
  margin: 20px 0 8px;
  font-size: 15px;
}
.preview-body h4.h1 {
  font-size: 18px;
}
.preview-body h4.h3 {
  font-size: 14px;
  color: var(--text-muted);
}
.preview-paragraph {
  margin: 0 0 10px;
  text-align: justify;
}
.preview-list {
  margin: 0 0 10px;
  padding-left: 18px;
}
.preview-code {
  background: #f4f6fa;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  white-space: pre-wrap;
}
.preview-formula {
  font-family: Consolas, monospace;
  color: #3355d1;
}
.preview-table {
  font-size: 12.5px;
  color: var(--text-muted);
}
.warn-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #b7791f;
  background: #fdf6e3;
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 11.5px;
}
.warn-list {
  max-width: 320px;
  font-size: 12.5px;
  line-height: 1.7;
}
.icon-btn {
  padding: 4px 7px;
}
</style>
