import { useEffect, useState } from 'react'
import BrandMark from '../components/Brand.jsx'
import { useAuth } from '../auth/useAuth.js'
import './AuthPages.css'

function ProfilePage() {
  const { user, loading, error, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState('')

  useEffect(() => {
    if (!loading && !error && !user) window.location.replace('/login')
  }, [loading, error, user])

  async function handleSignOut() {
    try {
      setSignOutError('')
      await signOut()
      window.location.assign('/')
    } catch (cause) {
      setSignOutError(cause.message)
    }
  }

  if (loading) {
    return <main className="auth-page"><p className="auth-hint">Loading your profile…</p></main>
  }

  return (
    <main className="auth-page">
      <a className="brand auth-brand" href="/" aria-label="Monsso home">
        <BrandMark />
        <span>monsso</span>
      </a>
      {error ? (
        <section className="auth-card" aria-labelledby="profile-error-title">
          <h1 id="profile-error-title">Profile unavailable</h1>
          <p className="auth-error" role="alert">{error}</p>
          <a className="auth-home-link" href="/login">Return to sign in</a>
        </section>
      ) : user ? (
        <section className="auth-card profile-card" aria-labelledby="profile-title">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR MONSSO ACCOUNT</div>
          <h1 id="profile-title">Your profile</h1>
          {user.picture ? (
            <img className="profile-picture" src={user.picture} alt="" />
          ) : (
            <div className="profile-picture profile-picture-fallback" aria-hidden="true">
              {user.email.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="profile-email">{user.email}</p>
          <div className="profile-actions">
            <a className="button button-primary" href="/login?switch=1">Switch account</a>
            <button className="button button-light" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
          {signOutError && <p className="auth-error" role="alert">{signOutError}</p>}
          <a className="auth-home-link" href="/">Back to Monsso</a>
        </section>
      ) : null}
    </main>
  )
}

export default ProfilePage
