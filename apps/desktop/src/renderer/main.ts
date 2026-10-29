import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './App.vue'
import './styles.css'
import 'katex/dist/katex.min.css'

/** 任何启动期异常都直接画在页面上，避免出现"白窗口"，也方便用户截图反馈 */
function showFatal(title: string, detail: string) {
  const root = document.getElementById('app')
  if (!root) return
  if (root.querySelector('.fatal-panel')) return
  root.innerHTML = `
    <div class="fatal-wrap">
      <div class="fatal-panel">
        <h1>${title}</h1>
        <p>把下面这段信息和 %APPDATA%\\AITutorAssistant\\startup.log 一起发给我，就能定位问题。</p>
        <pre>${String(detail).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))}</pre>
        <button onclick="location.reload()">重新加载</button>
      </div>
    </div>`
}

window.addEventListener('error', (event) => {
  showFatal('界面脚本出错', `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`)
})
window.addEventListener('unhandledrejection', (event) => {
  showFatal('界面脚本出错（未处理的 Promise 拒绝）', String(event.reason?.stack ?? event.reason))
})

if (!window.tutor) {
  showFatal(
    '预加载脚本没有生效',
    'window.tutor 不存在：preload 可能被安全软件拦截，或应用的 app.asar 不完整。\n请把安装目录连同 startup.log 一起发给我。'
  )
} else {
  const app = createApp(App)
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[vue error]', error, info)
    showFatal('界面渲染出错', `${(error as Error)?.stack ?? String(error)}\n(${info})`)
  }
  try {
    app.use(naive).mount('#app')
  } catch (error) {
    showFatal('界面初始化失败', String((error as Error)?.stack ?? error))
  }
}
