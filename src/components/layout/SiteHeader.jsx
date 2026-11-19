import BrandMark from '../Brand.jsx'
import { ArrowUpRight } from '../Icons.jsx'
import { useAuth } from '../../auth/useAuth.js'
import './SiteHeader.css'

function SiteHeader() {
  const { user } = useAuth()

  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Monsso home">
        <BrandMark />
        <span>monsso</span>
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        <a href="#platform">Platform</a>
        <a href="#solutions">Solutions</a>
        <a href="#about">Why Monsso</a>
      </nav>
      <div className="header-actions">
        {user ? (
          <a className="header-profile" href="/profile">
            {user.picture && <img src={user.picture} alt="" />}
            <span>Profile</span>
          </a>
        ) : (
          <a className="login-link" href="/login">Log in</a>
        )}
        <a className="button button-dark button-small" href="#contact">Talk to our team <ArrowUpRight /></a>
      </div>
    </header>
  )
}

export default SiteHeader
