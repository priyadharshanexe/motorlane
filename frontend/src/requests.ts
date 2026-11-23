import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { api, ApiError } from './api'
import type { Session } from './api'

export const useSession = () => useQuery({ queryKey: ['session'], queryFn: () => api<Session>('session/') })
export const formData = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault()
  return new FormData(event.currentTarget)
}

export function useWrite<Result = unknown>() {
  const session = useSession()
  const cache = useQueryClient()
  return useMutation({
    mutationFn: async ({ path, method = 'POST', body }: { path: string; method?: string; body?: FormData | Record<string, unknown> }) => {
      const headers = new Headers({ 'X-CSRFToken': session.data?.csrf_token ?? '' })
      if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
      return api<Result>(path, { method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body) })
    },
    onSuccess: () => cache.invalidateQueries({ predicate: query => query.queryKey[0] !== 'session' }),
    onError: error => {
      if (error instanceof ApiError && error.status === 403) {
        void cache.invalidateQueries({ queryKey: ['session'] })
      }
    },
  })
}

// One channel per tab: a BroadcastChannel never receives its own messages, so this tab is not told about its own change.
const authChannel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('motorlane-auth')

/** Tell every other open tab that this browser signed in or out, so they drop (or reload) account data at once. */
export function announceAuth(change: 'in' | 'out') {
  authChannel?.postMessage(change)  // old browsers: other tabs catch up when focused
}

/** Run when another tab signs in or out. */
export function onAuthElsewhere(listener: () => void) {
  if (authChannel) authChannel.onmessage = listener
}

/** Sign out through the API, then tell the other tabs (only once the server has ended the session) and go home. */
export async function signOut(csrfToken: string) {
  await fetch('/auth/browser/v1/auth/session', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRFToken': csrfToken } })
  announceAuth('out')
  window.location.assign('/app/')
}
