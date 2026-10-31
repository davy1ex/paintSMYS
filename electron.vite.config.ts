import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      lib: {
        entry: resolve(process.cwd(), 'src/app/desktop/main.ts'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(process.cwd(), 'src/app/desktop/preload.ts'),
      },
    },
  },
  renderer: {
    root: process.cwd(),
    build: {
      outDir: resolve(process.cwd(), 'dist/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(process.cwd(), 'index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@editor': resolve(process.cwd(), 'src/editor'),
      },
    },
    plugins: [react()],
  },
})
