import BrandMark from '../Brand.jsx'
import './SiteFooter.css'

function SiteFooter() {
  return (
    <footer className="site-footer section-wrap">
      <a className="brand" href="/" aria-label="Monsso home">
        <BrandMark />
        <span>monsso</span>
      </a>
      <p>Payments, all moving in the right direction.</p>
      <span className="footer-note">© 2025 Monsso. Built for what&apos;s next.</span>
    </footer>
  )
}

export default SiteFooter
