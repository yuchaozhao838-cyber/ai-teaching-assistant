<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { PROVIDER_PRESETS } from '@tutor/shared'
import type { ProviderConfig } from '@tutor/shared'
import Icon from '../components/Icon.vue'
import { removeProvider, saveProvider, setActiveProvider, state, testProvider } from '../store'

const message = useMessage()

const form = reactive({
  id: '',
  name: '',
  kind: 'openai' as 'openai' | 'demo',
  baseUrl: '',
  model: '',
  temperature: 0.6,
  apiKey: '',
  hasKey: false
})
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const presetId = ref<string | null>(null)
const advanced = ref(false)

const providers = computed(() => state.settings?.providers ?? [])
const activeId = computed(() => state.settings?.activeProviderId ?? '')
const isNew = computed(() => !form.id)
const presetOptions = PROVIDER_PRESETS.map((preset) => ({
  label: `${preset.name} — ${preset.note}`,
  value: preset.id
}))

function loadProvider(provider: ProviderConfig) {
  Object.assign(form, {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    temperature: provider.temperature,
    apiKey: '',
    hasKey: provider.hasKey
  })
  presetId.value = null
  testResult.value = null
}

watch(
  providers,
  (list) => {
    if (!form.id && list.length) loadProvider(list[0])
  },
  { immediate: true }
)

function addProvider() {
  Object.assign(form, {
    id: '',
    name: '新供应商',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.6,
    apiKey: '',
    hasKey: false
  })
  presetId.value = null
  testResult.value = null
}

function applyPreset(id: string | null) {
  const preset = PROVIDER_PRESETS.find((item) => item.id === id)
  if (!preset) return
  Object.assign(form, {
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model: preset.model,
    name: preset.name
  })
  testResult.value = null
}

async function onSave() {
  if (form.kind === 'openai') {
    if (!form.baseUrl.trim()) {
      message.warning('请填写 Base URL，例如 https://api.deepseek.com/v1')
      return
    }
    if (!form.model.trim()) {
      message.warning('请填写模型名称')
      return
    }
  }
  saving.value = true
  try {
    const settings = await saveProvider({
      id: form.id || undefined,
      name: form.name.trim() || '自定义供应商',
      kind: form.kind,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      temperature: form.temperature,
      apiKey: form.apiKey
    })
    const saved = form.id
      ? settings.providers.find((item) => item.id === form.id)
      : settings.providers[settings.providers.length - 1]
    if (saved) {
      form.id = saved.id
      form.hasKey = saved.hasKey
      form.apiKey = ''
      await setActiveProvider(saved.id)
    }
    message.success('配置已保存，并设为当前使用')
    testResult.value = null
  } catch (error) {
    message.error((error as Error).message)
  } finally {
    saving.value = false
  }
}

async function onTest() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await testProvider({
      id: form.id || undefined,
      name: form.name,
      kind: form.kind,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      temperature: form.temperature,
      apiKey: form.apiKey || undefined
    })
  } catch (error) {
    testResult.value = { ok: false, message: (error as Error).message }
  } finally {
    testing.value = false
  }
}

async function onRemove() {
  if (!form.id) return
  await removeProvider(form.id)
  message.success('已删除该供应商')
  form.id = ''
  const first = providers.value[0]
  if (first) loadProvider(first)
}

async function onUse(provider: ProviderConfig) {
  await setActiveProvider(provider.id)
  message.success(`已切换为「${provider.name}」`)
}

async function openDataDir() {
  await window.tutor.app.openDataDir()
}
</script>

<template>
  <div class="page settings-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1>设置</h1>
        <p>接入任意 OpenAI 兼容的大模型服务（DeepSeek / 通义千问 / 华为云 / OpenAI）。密钥只保存在本机。</p>
      </div>
    </header>

    <div class="settings-grid">
      <section class="panel provider-panel">
        <div class="panel-title">
          <span>模型供应商</span>
          <n-button text size="tiny" @click="addProvider">
            <template #icon><Icon name="plus" :size="13" /></template>
            添加
          </n-button>
        </div>
        <div class="provider-list">
          <button
            v-for="provider in providers"
            :key="provider.id"
            class="provider-item"
            :class="{ selected: provider.id === form.id }"
            @click="loadProvider(provider)"
          >
            <div class="provider-row">
              <span class="provider-name">{{ provider.name }}</span>
              <span v-if="provider.id === activeId" class="in-use">使用中</span>
            </div>
            <div class="provider-meta">
              {{ provider.kind === 'demo' ? '无需密钥' : provider.model || '未设置模型' }}
              <span class="dot">·</span>
              <span :class="provider.hasKey ? 'ok' : 'warn'">{{ provider.hasKey ? '已配置密钥' : '未配置密钥' }}</span>
            </div>
            <button
              v-if="provider.id !== activeId && provider.hasKey"
              class="use-btn"
              @click.stop="onUse(provider)"
            >
              设为当前
            </button>
          </button>
        </div>
        <div class="panel-tip">共 {{ providers.length }} 个供应商，生成时使用「使用中」的那一个。</div>
      </section>

      <section class="panel form-panel">
        <div class="panel-title">
          <span>{{ isNew ? '新增供应商' : `编辑「${form.name}」` }}</span>
          <n-tag v-if="form.id === activeId" size="tiny" type="success" :bordered="false">当前使用</n-tag>
        </div>

        <n-form label-placement="top" :show-feedback="false" class="settings-form">
          <n-form-item label="快速填充（预设）">
            <n-select
              v-model:value="presetId"
              :options="presetOptions"
              placeholder="选择供应商即可自动填入 Base URL 与模型名"
              clearable
              @update:value="applyPreset"
            />
          </n-form-item>

          <n-form-item label="显示名称">
            <n-input v-model:value="form.name" placeholder="例如 DeepSeek" />
          </n-form-item>

          <template v-if="form.kind === 'openai'">
            <n-form-item label="Base URL（需包含 /v1）">
              <n-input v-model:value="form.baseUrl" placeholder="https://api.deepseek.com/v1" />
            </n-form-item>
            <n-form-item label="模型名称">
              <n-input v-model:value="form.model" placeholder="deepseek-chat" />
            </n-form-item>
            <n-form-item label="API Key">
              <n-input
                v-model:value="form.apiKey"
                type="password"
                show-password-on="click"
                :placeholder="form.hasKey ? '已保存（留空表示不修改）' : 'sk-...'"
              />
            </n-form-item>
            <n-form-item label="温度（越低越稳，越高越发散）">
              <div class="slider-row">
                <n-slider v-model:value="form.temperature" :min="0" :max="1.2" :step="0.1" class="slider" />
                <span class="slider-value">{{ form.temperature.toFixed(1) }}</span>
              </div>
            </n-form-item>
          </template>
          <n-alert v-else type="info" :bordered="false" class="demo-note">
            本地演示模型不联网、不需要密钥：它会按材料结构生成「原文摘录 + 结构提示」的演示讲解，用于先把流程跑通。
          </n-alert>

          <div class="form-actions">
            <n-button :loading="testing" @click="onTest">
              <template #icon><Icon name="zap" :size="14" /></template>
              测试连接
            </n-button>
            <n-button type="primary" :loading="saving" @click="onSave">保存配置</n-button>
            <n-button v-if="!isNew && providers.length > 1" quaternary type="error" @click="onRemove">删除</n-button>
          </div>

          <n-alert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" :bordered="false" class="test-result">
            {{ testResult.message }}
          </n-alert>
        </n-form>

        <div class="callout">
          <div class="callout-title"><Icon name="alert" :size="13" /> 常见配置问题</div>
          <ul>
            <li>Base URL 要带 <code>/v1</code>，例如 <code>https://api.deepseek.com/v1</code>，程序会自动拼 <code>/chat/completions</code>。</li>
            <li>通义千问用「百炼」的 OpenAI 兼容地址；华为云请在控制台复制 MaaS 的接口地址。</li>
            <li>若提示 401，说明密钥不对或额度耗尽；提示 404，多半是 Base URL 或模型名写错。</li>
          </ul>
        </div>
      </section>
    </div>

    <section class="panel info-panel">
      <div class="panel-title"><span>数据与版本</span></div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">本地数据目录</div>
          <div class="info-value mono">{{ state.info?.dataDir || '—' }}</div>
          <n-button size="tiny" quaternary @click="openDataDir">
            <template #icon><Icon name="folder" :size="13" /></template>
            打开目录
          </n-button>
        </div>
        <div class="info-item">
          <div class="info-label">密钥存储</div>
          <div class="info-value">
            {{ state.info?.encryptionAvailable ? '已用系统 DPAPI 加密（仅当前 Windows 用户可解）' : '未启用系统加密，密钥以本地文件保存' }}
          </div>
        </div>
        <div class="info-item">
          <div class="info-label">版本</div>
          <div class="info-value mono">
            应用 v{{ state.info?.version }} · Electron {{ state.info?.electron }} · Chromium {{ state.info?.chrome }}
          </div>
        </div>
        <div class="info-item">
          <div class="info-label">数据说明</div>
          <div class="info-value">材料与讲解都保存在本机；仅在你点击「生成讲解」时，把材料片段发送给你选择的模型服务。</div>
        </div>
      </div>
    </section>

    <section class="panel help-panel">
      <div class="panel-title"><span>三步上手</span></div>
      <div class="help-steps">
        <div class="help-step">
          <span class="help-idx">1</span>
          <div><strong>导入材料</strong><p>资料库 → 导入文件 / 网页抓取 / 粘贴文本</p></div>
        </div>
        <div class="help-step">
          <span class="help-idx">2</span>
          <div><strong>生成讲解</strong><p>点「生成讲解」，AI 先出大纲再逐节讲解，可随时取消</p></div>
        </div>
        <div class="help-step">
          <span class="help-idx">3</span>
          <div><strong>复习与导出</strong><p>左侧跳转知识点，右侧看重点，右上角导出 Word / PPT / PDF</p></div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.panel {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
}
.panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 14px;
  color: var(--text-strong);
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.provider-item {
  position: relative;
  text-align: left;
  border: 1px solid var(--border-soft);
  background: #fbfcfe;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.provider-item:hover {
  border-color: #c9d4ee;
}
.provider-item.selected {
  border-color: var(--primary);
  background: #f4f7ff;
  box-shadow: 0 0 0 2px rgba(51, 85, 209, 0.08);
}
.provider-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.provider-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.in-use {
  font-size: 10.5px;
  color: #1f9d76;
  background: #e8f7f1;
  border-radius: 5px;
  padding: 0 5px;
}
.provider-meta {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.provider-meta .ok {
  color: #1f9d76;
}
.provider-meta .warn {
  color: #c98a1b;
}
.use-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid var(--border-soft);
  background: #fff;
  border-radius: 6px;
  font-size: 10.5px;
  color: var(--text-muted);
  padding: 1px 6px;
  cursor: pointer;
}
.panel-tip {
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.settings-form :deep(.n-form-item) {
  margin-bottom: 14px;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}
.slider {
  flex: 1;
}
.slider-value {
  font-size: 12.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  width: 26px;
}
.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
.test-result {
  margin-top: 14px;
}
.demo-note {
  margin-bottom: 14px;
}
.callout {
  margin-top: 18px;
  background: #f8fafc;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 12px 14px;
}
.callout-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 8px;
}
.callout ul {
  margin: 0;
  padding-left: 16px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.8;
}
.callout code {
  background: #eef1f6;
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 11.5px;
}
.info-panel {
  margin-top: 16px;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
}
.info-label {
  font-size: 11.5px;
  color: var(--text-faint);
  margin-bottom: 4px;
}
.info-value {
  font-size: 12.5px;
  color: var(--text-regular);
  line-height: 1.7;
  margin-bottom: 6px;
  word-break: break-all;
}
.mono {
  font-family: Consolas, "SF Mono", monospace;
}
.help-panel {
  margin-top: 16px;
}
.help-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.help-step {
  display: flex;
  gap: 10px;
  background: #f8fafc;
  border-radius: 10px;
  padding: 12px 14px;
}
.help-idx {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #e8edff;
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.help-step strong {
  font-size: 12.5px;
}
.help-step p {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
