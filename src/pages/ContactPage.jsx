import SiteHeader from '../components/layout/SiteHeader.jsx'
import SiteFooter from '../components/layout/SiteFooter.jsx'
import './ContactPage.css'

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m5 7 7 5.5L19 7" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.2 3.8h2.5l1.2 4.1-1.8 1.8a15 15 0 0 0 5.2 5.2l1.8-1.8 4.1 1.2v2.5a2 2 0 0 1-2.2 2A16 16 0 0 1 5.2 6a2 2 0 0 1 2-2.2Z" />
    </svg>
  )
}

function ContactPage() {
  return (
    <div className="contact-page">
      <SiteHeader />
      <main className="contact-main" id="top">
        <div className="contact-layout section-wrap">
          <section className="contact-intro">
            <div className="eyebrow"><span className="eyebrow-dot" /> GET IN TOUCH</div>
            <h1>Let&apos;s make <span>things move.</span></h1>
            <p>
              Have a question, an idea, or want to talk about Monsso? Get in
              touch directly—we&apos;d be glad to hear from you.
            </p>
            <a className="contact-back-link" href="/">Back to Monsso</a>
          </section>

          <section className="contact-card" aria-label="Contact details">
            <div className="contact-card-heading">
              <span className="contact-card-kicker">CONTACT DETAILS</span>
              <h2>Reach out directly</h2>
            </div>
            <a className="contact-method" href="mailto:tammyboy775@gmail.com">
              <span className="contact-method-icon"><MailIcon /></span>
              <span className="contact-method-copy">
                <span>Email</span>
                <strong>tammyboy775@gmail.com</strong>
              </span>
              <span className="contact-method-arrow" aria-hidden="true">↗</span>
            </a>
            <a className="contact-method" href="tel:09048344551">
              <span className="contact-method-icon"><PhoneIcon /></span>
              <span className="contact-method-copy">
                <span>Phone</span>
                <strong>09048344551</strong>
              </span>
              <span className="contact-method-arrow" aria-hidden="true">↗</span>
            </a>
            <div className="contact-card-note">
              Choose whichever way works best for you.
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

export default ContactPage
