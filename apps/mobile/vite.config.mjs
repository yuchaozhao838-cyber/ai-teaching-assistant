import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

export default defineConfig({
  root: here,
  base: './',
  plugins: [vue()],
  resolve: {
    alias: [
      // 浏览器版的 content-ingest 替身（避开 node:fs / node:path）
      { find: /^@tutor\/content-ingest$/, replacement: path.join(here, 'src/platform/shim.ts') },
      { find: /^@tutor\/shared$/, replacement: path.join(root, 'packages/shared/src/index.ts') },
      { find: /^@tutor\/ai-core$/, replacement: path.join(root, 'packages/ai-core/src/index.ts') },
      { find: /^@tutor\/pedagogy$/, replacement: path.join(root, 'packages/pedagogy/src/index.ts') },
      { find: /^@tutor\/practice$/, replacement: path.join(root, 'packages/practice/src/index.ts') },
      { find: /^@renderer\//, replacement: path.join(root, 'apps/desktop/src/renderer') + '/' }
    ]
  },
  define: {
    'process.env': '{}',
    global: 'globalThis'
  },
  build: {
    outDir: path.join(root, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'naive-ui'],
          pdf: ['pdfjs-dist/build/pdf.js']
        }
      }
    }
  }
})
