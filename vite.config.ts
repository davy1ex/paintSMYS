import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: process.cwd(),
  resolve: {
    alias: {
      '@editor': resolve(process.cwd(), 'src/editor'),
    },
  },
  plugins: [react()],
  build: {
    outDir: resolve(process.cwd(), 'dist/web'),
    emptyOutDir: true,
  },
})
