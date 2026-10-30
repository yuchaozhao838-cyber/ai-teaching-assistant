import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here)
const repo = path.resolve(here, '..', '..')
const pkgs = ['shared', 'content-ingest', 'ai-core', 'pedagogy', 'resource-service', 'export', 'practice', 'study']

export default defineConfig({
  root,
  // Electron 用 file:// 加载页面，所有资源必须相对路径
  base: './',
  plugins: [vue()],
  resolve: {
    alias: [
      ...pkgs.map((p) => ({
        find: `@tutor/${p}`,
        replacement: path.join(repo, 'packages', p, 'src', 'index.ts')
      })),
      { find: '@', replacement: path.join(root, 'src', 'renderer') }
    ]
  },
  build: {
    outDir: path.join(root, 'out', 'renderer'),
    emptyOutDir: true,
    target: 'chrome122',
    // 把字体等小资源全部内联进 CSS，避免 file:// 下的跨域加载限制
    assetsInlineLimit: 1024 * 256,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        // 单文件 IIFE：file:// 下没有 CORS 限制，打包更稳
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  server: {
    port: 5199,
    strictPort: true
  }
})
