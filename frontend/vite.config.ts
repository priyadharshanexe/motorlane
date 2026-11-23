import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { HtmlTagDescriptor, Plugin } from 'vite'

/** The public shell and home page are lazy chunks (so the workspace pages never load them, and vice versa), which
 *  normally means the browser only discovers them after the entry script has downloaded and run. This writes
 *  <link rel="modulepreload"> tags for them, their shared dependencies and their CSS into index.html, so they
 *  download in parallel with the entry script on the first visit. */
/** Preloads for the first paint. The shell (OdoLayout and what it imports) is preloaded on every page from
 *  index.html; each public page's own chunks, and the heading font for home, go into preload-manifest.json, which
 *  Django's /app/ view turns into tags for the route being opened (at the `<!--route-hints-->` marker), along with
 *  that page's first image and API data. */
function preloadPublicShell(shell: string, pages: Record<string, string>): Plugin {
  const base = '/static/react/'
  const chunkFor = (bundle: Record<string, { type: string; facadeModuleId?: string | null }>, entry: string) =>
    Object.entries(bundle).find(([, c]) => c.type === 'chunk' && c.facadeModuleId?.replaceAll('\\', '/').endsWith(entry))?.[0]
  const closure = (bundle: Record<string, any>, name: string | undefined, files = new Set<string>(), css = new Set<string>()) => {
    const visit = (n: string) => {
      const chunk = bundle[n]
      if (!chunk || chunk.type !== 'chunk' || files.has(n)) return
      files.add(n)
      chunk.viteMetadata?.importedCss.forEach((file: string) => css.add(file))
      chunk.imports.forEach(visit)
    }
    if (name) visit(name)
    return { files, css }
  }
  return {
    name: 'preload-public-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const all = bundle as Record<string, any>
      const shellSet = closure(all, chunkFor(all, shell))
      const manifest: Record<string, string[]> = {}
      for (const [route, entry] of Object.entries(pages)) {
        const { files } = closure(all, chunkFor(all, entry))
        manifest[route] = [...files].filter(f => !shellSet.files.has(f)).map(f => base + f)
      }
      manifest.fonts = Object.keys(all).filter(f => /archivo-latin-wdth-normal.*\.woff2$/.test(f)).map(f => base + f)
      this.emitFile({ type: 'asset', fileName: 'preload-manifest.json', source: JSON.stringify(manifest) })
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle as Record<string, any> | undefined
        if (!bundle) return []
        const shellSet = closure(bundle, chunkFor(bundle, shell))
        const tags: HtmlTagDescriptor[] = [...shellSet.files].map(file => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: base + file }, injectTo: 'head' }))
        shellSet.css.forEach(file => tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'style', href: base + file }, injectTo: 'head' }))
        return tags
      },
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/react/' : '/app/',
  plugins: [react(), preloadPublicShell('src/odo/OdoLayout.tsx', { home: 'src/odo/Home.tsx', catalog: 'src/odo/Catalog.tsx', detail: 'src/odo/VehicleDetail.tsx' })],
  build: {
    rolldownOptions: {
      output: {
        // Vendor code in its own long-lived chunks: an app change no longer invalidates React or the router in cache.
        advancedChunks: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            { name: 'vendor-app', test: /node_modules[\/](react-router|@tanstack)[\/]/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: Object.fromEntries(['/api', '/auth', '/accounts', '/media', '/download-receipt'].map(prefix => [
      prefix, 'http://127.0.0.1:8000',
    ])),
  },
}))
