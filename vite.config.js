import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo>/, not from the domain root,
// so every asset URL needs that prefix. The workflow sets VITE_BASE; locally it
// is unset and '/' is correct.
// GitHub Pages serves index.html with a ten-minute cache, so after a deploy you
// can be looking at the old build without knowing it. Stamping the commit into
// the header turns "did it deploy?" into something you can read off the screen.
// GITHUB_SHA is set automatically by Actions; locally it is absent, hence 'dev'.
const BUILD = (process.env.GITHUB_SHA || '').slice(0, 7) || 'dev'

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __BUILT_AT__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  plugins: [react()],
  server: { port: 5173, open: true },
  build: { outDir: 'dist', sourcemap: true },
})
