import BrandMark from '../Brand.jsx'
import { ArrowRight, CheckIcon } from '../Icons.jsx'
import './ConnectedSection.css'

function ConnectedSection() {
  return (
    <section className="connected-section section-wrap" id="about">
      <div className="connected-art" aria-hidden="true">
        <div className="connected-circle circle-back" />
        <div className="connected-circle circle-front"><BrandMark /></div>
        <span className="integration-tag tag-invoice">Invoices <b>✓</b></span>
        <span className="integration-tag tag-tax">Tax <b>✓</b></span>
        <span className="integration-tag tag-api"><b>&lt;/&gt;</b> API</span>
        <span className="integration-tag tag-payout">Payouts <b>✓</b></span>
      </div>
      <div className="connected-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> ONE PLATFORM. NOT ONE MORE PATCH.</div>
        <h2>Your payment stack,<br /><span>minus the stitching.</span></h2>
        <p>Invoicing, recurring billing, tax, payments, and payouts—connected from day one. One dependable foundation for your team and the tools you already use.</p>
        <ul>
          <li><span><CheckIcon /></span> Less brittle, more reliable workflows</li>
          <li><span><CheckIcon /></span> A clearer view of your money, end to end</li>
          <li><span><CheckIcon /></span> Built to fit your existing systems</li>
        </ul>
        <a className="text-link" href="/contact">See how it fits together <ArrowRight /></a>
      </div>
    </section>
  )
}

export default ConnectedSection
