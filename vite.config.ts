import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // pdfjs-dist 的文字层解析 worker 约 1.27MB，仅在用户导入 PDF 时按需加载，
    // 不进入首屏主包。提高阈值以消除构建噪音，其余 chunk 仍受默认告警约束。
    chunkSizeWarningLimit: 1400,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
