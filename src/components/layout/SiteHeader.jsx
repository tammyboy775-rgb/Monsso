import BrandMark from '../Brand.jsx'
import { ArrowUpRight } from '../Icons.jsx'
import './SiteHeader.css'

function SiteHeader() {
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
        <a className="login-link" href="mailto:hello@monsso.com">Log in</a>
        <a className="button button-dark button-small" href="#contact">Talk to our team <ArrowUpRight /></a>
      </div>
    </header>
  )
}

export default SiteHeader
