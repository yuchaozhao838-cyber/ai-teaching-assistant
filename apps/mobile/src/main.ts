import { installBrowserTutor } from './platform/tutor'
import './mobile.css'

// 先把 window.tutor 装好，再启动桌面端那套界面（复用同一份 Vue 组件）
installBrowserTutor()

import('@renderer/main').catch((error) => {
  const root = document.getElementById('app')
  if (root) {
    root.innerHTML =
      '<pre style="padding:20px;color:#b42318;white-space:pre-wrap">界面加载失败：' +
      String((error as Error)?.stack ?? error).replace(/[<>&]/g, '') +
      '</pre>'
  }
})

// PWA：注册 service worker（离线可用）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => undefined)
  })
}
