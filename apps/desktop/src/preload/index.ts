import { contextBridge, ipcRenderer } from 'electron'
import type { ExportFormat, LessonEvent, TutorApi } from '@tutor/shared'

const api: TutorApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    setMiniWindow: (enabled: boolean) => ipcRenderer.invoke('app:setMiniWindow', enabled)
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
  study: {
    events: () => ipcRenderer.invoke('study:events'),
    stats: () => ipcRenderer.invoke('study:stats'),
    addEvent: (input) => ipcRenderer.invoke('study:addEvent', input),
    removeEvent: (id: string) => ipcRenderer.invoke('study:removeEvent', id),
    quote: () => ipcRenderer.invoke('study:quote')
  },
  focus: {
    presets: () => ipcRenderer.invoke('focus:presets'),
    savePreset: (preset) => ipcRenderer.invoke('focus:savePreset', preset),
    removePreset: (id: string) => ipcRenderer.invoke('focus:removePreset', id),
    sessions: () => ipcRenderer.invoke('focus:sessions'),
    finish: (session) => ipcRenderer.invoke('focus:finish', session)
  },
  calendar: {
    events: () => ipcRenderer.invoke('calendar:events'),
    saveEvent: (event) => ipcRenderer.invoke('calendar:saveEvent', event),
    removeEvent: (id: string) => ipcRenderer.invoke('calendar:removeEvent', id),
    rules: () => ipcRenderer.invoke('calendar:rules'),
    saveRule: (rule) => ipcRenderer.invoke('calendar:saveRule', rule),
    removeRule: (id: string) => ipcRenderer.invoke('calendar:removeRule', id),
    importIcs: (text: string) => ipcRenderer.invoke('calendar:importIcs', text),
    exportIcs: () => ipcRenderer.invoke('calendar:exportIcs')
  },
  prep: {
    list: () => ipcRenderer.invoke('prep:list'),
    save: (goal) => ipcRenderer.invoke('prep:save', goal),
    remove: (id: string) => ipcRenderer.invoke('prep:remove', id),
    generate: (input) => ipcRenderer.invoke('prep:generate', input),
    advise: (goalId: string) => ipcRenderer.invoke('prep:advise', goalId)
  },
  ideas: {
    list: () => ipcRenderer.invoke('ideas:list'),
    save: (idea) => ipcRenderer.invoke('ideas:save', idea),
    remove: (id: string) => ipcRenderer.invoke('ideas:remove', id),
    polish: (input) => ipcRenderer.invoke('ideas:polish', input)
  },
  timetable: {
    list: () => ipcRenderer.invoke('timetable:list'),
    save: (slots) => ipcRenderer.invoke('timetable:save', slots),
    importCsv: (text: string) => ipcRenderer.invoke('timetable:importCsv', text),
    openCrawler: (url: string) => ipcRenderer.invoke('timetable:openCrawler', url),
    capture: () => ipcRenderer.invoke('timetable:capture'),
    applyMapping: (candidateId: string, mapping) => ipcRenderer.invoke('timetable:applyMapping', candidateId, mapping),
    meta: () => ipcRenderer.invoke('timetable:meta'),
    saveMeta: (meta) => ipcRenderer.invoke('timetable:saveMeta', meta),
    diagnostics: () => ipcRenderer.invoke('timetable:diagnostics'),
    closeCrawler: () => ipcRenderer.invoke('timetable:closeCrawler')
  },
  mistakes: {
    list: () => ipcRenderer.invoke('mistakes:list'),
    add: (items) => ipcRenderer.invoke('mistakes:add', items),
    update: (id: string, patch) => ipcRenderer.invoke('mistakes:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('mistakes:remove', id),
    clearMastered: () => ipcRenderer.invoke('mistakes:clearMastered')
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
