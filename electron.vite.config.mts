import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@intellij': resolve(import.meta.dirname, 'resources/intellij-community'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // forked by src/main/eslint/index.ts as out/main/eslintWorker.js
          eslintWorker: resolve(import.meta.dirname, 'src/main/eslint/worker.ts'),
        },
        // native module: loaded from node_modules at runtime, never bundled
        external: ['@lydell/node-pty'],
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // sandboxed preloads must be a single CommonJS file
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
  },
})
