import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { resolve } from 'node:path'

/**
 * Vite's dev client and the React refresh preamble are inline scripts, so the
 * page has to allow them while the dev server is driving it. The built page
 * never does.
 */
function devCsp(): Plugin {
  return {
    name: 'companion-dev-csp',
    transformIndexHtml(html, context) {
      return html.replace('%CSP_DEV%', context.server ? " 'unsafe-inline'" : '')
    }
  }
}

export default defineConfig({
  main: {
    // The host is a second entry with no Electron in it: Chrome runs it as plain Node.
    build: { rollupOptions: { input: { index: resolve('main/index.ts'), host: resolve('main/host.ts') } } }
  },
  preload: {
    build: { rollupOptions: { input: resolve('preload/index.ts') } }
  },
  renderer: {
    root: resolve('renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('renderer/index.html'),
          settings: resolve('renderer/settings.html')
        }
      }
    },
    plugins: [react(), tailwind(), devCsp()]
  }
})
