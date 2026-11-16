import { ArrowUpRight } from '../Icons.jsx'
import './ContactSection.css'

function ContactSection() {
  return (
    <section className="cta-section section-wrap" id="contact">
      <div className="cta-card">
        <div className="cta-decoration cta-decoration-one" />
        <div className="cta-decoration cta-decoration-two" />
        <div className="cta-content">
          <div className="eyebrow cta-eyebrow"><span className="eyebrow-dot" /> READY WHEN YOU ARE</div>
          <h2>Make payments the easy part.</h2>
          <p>Let&apos;s make your money movement work a little harder.</p>
          <a className="button button-light" href="mailto:hello@monsso.com">Let&apos;s talk <ArrowUpRight /></a>
        </div>
        <div className="cta-aside"><span>One platform.</span><span>Fewer workarounds.</span><span>More momentum.</span></div>
      </div>
    </section>
  )
}

export default ContactSection
