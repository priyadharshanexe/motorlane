import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { HtmlTagDescriptor, Plugin } from 'vite'

/** The public shell and home page are lazy chunks (so the workspace pages never load them, and vice versa), which
 *  normally means the browser only discovers them after the entry script has downloaded and run. This writes
 *  <link rel="modulepreload"> tags for them, their shared dependencies and their CSS into index.html, so they
 *  download in parallel with the entry script on the first visit. */
function preloadPublicShell(entries: string[]): Plugin {
  return {
    name: 'preload-public-shell',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return []
        const base = '/static/react/'
        const files = new Set<string>(), css = new Set<string>()
        const visit = (name: string) => {
          const chunk = bundle[name]
          if (!chunk || chunk.type !== 'chunk' || files.has(name)) return
          files.add(name)
          chunk.viteMetadata?.importedCss.forEach(file => css.add(file))
          chunk.imports.forEach(visit)
        }
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.facadeModuleId && entries.some(entry => chunk.facadeModuleId!.replaceAll('\\', '/').endsWith(entry))) visit(chunk.fileName)
        }
        const tags: HtmlTagDescriptor[] = [...files].map(file => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: base + file }, injectTo: 'head' }))
        css.forEach(file => tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'style', href: base + file }, injectTo: 'head' }))
        return tags
      },
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/react/' : '/app/',
  plugins: [react(), preloadPublicShell(['src/odo/OdoLayout.tsx', 'src/odo/Home.tsx'])],
  server: {
    proxy: Object.fromEntries(['/api', '/auth', '/accounts', '/media', '/download-receipt'].map(prefix => [
      prefix, 'http://127.0.0.1:8000',
    ])),
  },
}))
