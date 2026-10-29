import { contextBridge, ipcRenderer } from 'electron'
import type { ExportFormat, LessonEvent, TutorApi } from '@tutor/shared'

const api: TutorApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url)
  },
  docs: {
    list: () => ipcRenderer.invoke('docs:list'),
    get: (id: string) => ipcRenderer.invoke('docs:get', id),
    importFiles: () => ipcRenderer.invoke('docs:importFiles'),
    importText: (title: string, text: string) => ipcRenderer.invoke('docs:importText', title, text),
    importWeb: (url: string) => ipcRenderer.invoke('docs:importWeb', url),
    importVisionPdf: () => ipcRenderer.invoke('docs:importVisionPdf'),
    onVisionEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload as never)
      ipcRenderer.on('vision:event', listener)
      return () => {
        ipcRenderer.removeListener('vision:event', listener)
      }
    },
    remove: (id: string) => ipcRenderer.invoke('docs:remove', id)
  },
  web: {
    openCapture: (url: string) => ipcRenderer.invoke('web:openCapture', url),
    captureState: () => ipcRenderer.invoke('web:captureState'),
    captureCurrent: () => ipcRenderer.invoke('web:captureCurrent'),
    downloadAttachments: (items) => ipcRenderer.invoke('web:downloadAttachments', items),
    closeCapture: () => ipcRenderer.invoke('web:closeCapture')
  },
  practice: {
    list: () => ipcRenderer.invoke('practice:list'),
    get: (id: string) => ipcRenderer.invoke('practice:get', id),
    generate: (input) => ipcRenderer.invoke('practice:generate', input),
    createManual: (title: string) => ipcRenderer.invoke('practice:createManual', title),
    update: (set) => ipcRenderer.invoke('practice:update', set),
    remove: (id: string) => ipcRenderer.invoke('practice:remove', id)
  },
  lesson: {
    list: () => ipcRenderer.invoke('lesson:list'),
    get: (id: string) => ipcRenderer.invoke('lesson:get', id),
    generate: (documentId: string) => ipcRenderer.invoke('lesson:generate', documentId),
    regenerateSection: (artifactId: string, sectionId: string) =>
      ipcRenderer.invoke('lesson:regenerateSection', artifactId, sectionId),
    cancel: () => ipcRenderer.invoke('lesson:cancel'),
    updateSection: (artifactId: string, sectionId: string, markdown: string) =>
      ipcRenderer.invoke('lesson:updateSection', artifactId, sectionId, markdown),
    updateKeyPoint: (artifactId: string, keyPointId: string, text: string, level: string) =>
      ipcRenderer.invoke('lesson:updateKeyPoint', artifactId, keyPointId, text, level),
    remove: (id: string) => ipcRenderer.invoke('lesson:remove', id),
    onEvent: (callback: (event: LessonEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: LessonEvent) => callback(payload)
      ipcRenderer.on('lesson:event', listener)
      return () => {
        ipcRenderer.removeListener('lesson:event', listener)
      }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    saveProvider: (provider) => ipcRenderer.invoke('settings:saveProvider', provider),
    removeProvider: (id: string) => ipcRenderer.invoke('settings:removeProvider', id),
    setActive: (id: string) => ipcRenderer.invoke('settings:setActive', id),
    test: (provider) => ipcRenderer.invoke('settings:test', provider)
  },
  exporter: {
    run: (artifactId: string, format: ExportFormat) => ipcRenderer.invoke('exporter:run', artifactId, format)
  }
}

contextBridge.exposeInMainWorld('tutor', api)
