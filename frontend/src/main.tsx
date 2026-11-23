import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { onAuthElsewhere } from './requests'
import archivo from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'

// The hero headline (the largest paint) is set in Archivo: fetch it now rather than after the page's CSS chunk.
document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'preload', as: 'font', type: 'font/woff2', href: archivo, crossOrigin: 'anonymous' }))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
// Sign-in or sign-out in another tab: forget every cached response and refetch, so private pages go back to the
// sign-in page (RequireSession) without waiting for the tab to be focused.
onAuthElsewhere(() => { void queryClient.resetQueries() })
// A page restored from the back-forward cache shows what it had in memory; check the session again first.
window.addEventListener('pageshow', event => { if (event.persisted) void queryClient.resetQueries() })

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing')

// The server's static first paint (headline and first photo, see rental/views.py) stays on screen as an overlay until
// the real page has its headline and the static photo has loaded, so the page never flashes blank while JS starts.
const staticFirst = root.querySelector<HTMLElement>('.static-first')
if (staticFirst) {
  document.body.appendChild(staticFirst)
  staticFirst.classList.add('static-overlay')
  const photo = staticFirst.querySelector('img')
  const started = performance.now()
  const release = () => {
    observer.disconnect()
    staticFirst.classList.add('out')
    window.setTimeout(() => staticFirst.remove(), 260)
  }
  const check = () => {
    const pageReady = Boolean(root.querySelector('h1'))
    const photoReady = !photo || photo.complete
    if (pageReady && (photoReady || performance.now() - started > 2500)) release()
  }
  const observer = new MutationObserver(check)
  observer.observe(root, { childList: true, subtree: true })
  photo?.addEventListener('load', check)
  photo?.addEventListener('error', check)
  window.setTimeout(release, 8000)  // never leave it up
}
createRoot(root).render(
  <StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>,
)
