import { useEffect, useRef, useState } from 'react'
import BrandMark from '../components/Brand.jsx'
import { useAuth } from '../auth/useAuth.js'
import './AuthPages.css'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
const googleScriptUrl = 'https://accounts.google.com/gsi/client'

function LoginPage() {
  const buttonContainer = useRef(null)
  const { user, signIn } = useAuth()
  const [error, setError] = useState('')
  const [scriptReady, setScriptReady] = useState(false)
  const isSwitching = new URLSearchParams(window.location.search).get('switch') === '1'

  useEffect(() => {
    if (!googleClientId) return undefined

    let active = true
    const renderGoogleButton = () => {
      if (!active || !window.google?.accounts?.id || !buttonContainer.current) return

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          try {
            setError('')
            await signIn(credential)
            const requestedDestination = new URLSearchParams(window.location.search).get('next')
            const destination = /^\/workflows(?:\?tab=(?:recurring|metadata|split|settlement))?$/
              .test(requestedDestination || '')
              ? requestedDestination
              : '/profile'
            window.location.assign(destination)
          } catch (cause) {
            setError(cause.message)
          }
        },
        auto_select: false,
        cancel_on_tap_outside: false,
      })
      window.google.accounts.id.renderButton(buttonContainer.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: isSwitching ? 'continue_with' : 'signin_with',
        width: 320,
      })
      setScriptReady(true)
    }

    if (window.google?.accounts?.id) {
      renderGoogleButton()
      return () => { active = false }
    }

    let script = document.getElementById('google-identity-services')
    if (!script) {
      script = document.createElement('script')
      script.id = 'google-identity-services'
      script.src = googleScriptUrl
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', renderGoogleButton)
    script.addEventListener('error', () => {
      if (active) setError('Google sign-in could not load. Check your connection and try again.')
    }, { once: true })

    return () => {
      active = false
      script.removeEventListener('load', renderGoogleButton)
    }
  }, [signIn, isSwitching])

  return (
    <main className="auth-page">
      <a className="brand auth-brand" href="/" aria-label="Monsso home">
        <BrandMark />
        <span>monsso</span>
      </a>
      <section className="auth-card" aria-labelledby="login-title">
        <div className="eyebrow"><span className="eyebrow-dot" /> YOUR MONSSO ACCOUNT</div>
        <h1 id="login-title">{isSwitching ? 'Switch accounts' : 'Welcome to Monsso'}</h1>
        <p className="auth-description">
          {isSwitching
            ? 'Choose the Google account you would like to use.'
            : 'Sign in with Google to access your Monsso profile.'}
        </p>
        {user && (
          <p className="current-account">
            Currently signed in as <strong>{user.email}</strong>
          </p>
        )}
        {googleClientId ? (
          <>
            <div className="google-button-wrap" ref={buttonContainer} />
            {!scriptReady && !error && <p className="auth-hint">Loading Google sign-in…</p>}
          </>
        ) : (
          <p className="auth-error" role="alert">
            Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID in your local environment.
          </p>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <a className="auth-home-link" href="/">Back to Monsso</a>
      </section>
    </main>
  )
}

export default LoginPage
