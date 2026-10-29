/// <reference types="vite/client" />

import type { TutorApi } from '@tutor/shared'

declare global {
  interface Window {
    tutor: TutorApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

export {}
