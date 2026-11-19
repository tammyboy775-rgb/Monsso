import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './auth-context.js'

async function readError(response, fallback) {
  const body = await response.json().catch(() => ({}))
  return new Error(body.error || fallback)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshUser = useCallback(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (response.status === 401) {
      setUser(null)
      setError('')
      return null
    }
    if (!response.ok) throw await readError(response, 'Could not check your sign-in.')

    const body = await response.json()
    setUser(body.user)
    setError('')
    return body.user
  }, [])

  useEffect(() => {
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect -- Bootstrap session state from the API.
    refreshUser()
      .catch((cause) => {
        if (active) setError(cause.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshUser])

  const signIn = useCallback(async (credential) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    })
    if (!response.ok) throw await readError(response, 'Google sign-in failed.')

    const body = await response.json()
    setUser(body.user)
    setError('')
    return body.user
  }, [])

  const signOut = useCallback(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (!response.ok) throw await readError(response, 'Could not sign out.')
    setUser(null)
    setError('')
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    error,
    signIn,
    signOut,
  }), [user, loading, error, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
