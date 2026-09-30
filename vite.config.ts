import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Entry pages: the primitive-based v2 studio at /, the classic v1 studio at /v1/,
// and a redirect at /v2/ that keeps old links working.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        v1: 'v1/index.html',
        v2: 'v2/index.html',
      },
    },
  },
})
