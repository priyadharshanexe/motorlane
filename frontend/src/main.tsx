import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import archivo from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'

// The hero headline (the largest paint) is set in Archivo: fetch it now rather than after the page's CSS chunk.
document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'preload', as: 'font', type: 'font/woff2', href: archivo, crossOrigin: 'anonymous' }))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing')
createRoot(root).render(
  <StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>,
)
