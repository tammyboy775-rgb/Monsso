import { ArrowRight, ArrowUpRight, CheckIcon } from '../Icons.jsx'
import './HeroSection.css'

function HeroSection() {
  return (
    <section className="hero section-wrap">
      <div className="hero-shapes" aria-hidden="true">
        <span className="hero-shape shape-large" />
        <span className="hero-shape shape-outline" />
        <span className="hero-shape shape-square" />
        <span className="hero-shape shape-pill" />
        <span className="hero-shape shape-small" />
      </div>
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> THE PAYMENT OPERATING SYSTEM</div>
        <h1>Payments should move your business <span>forward.</span></h1>
        <p className="hero-description">
          Monsso brings billing, payments, reconciliation, and payouts together—so you can spend less time chasing money and more time building what&apos;s next.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href="/checkout">Try a test payment <ArrowUpRight /></a>
          <a className="text-link" href="#platform">Explore the platform <ArrowRight /></a>
        </div>
        <div className="hero-proof">
          <div className="proof-avatars" aria-hidden="true"><span>M</span><span>J</span><span>A</span><b>+</b></div>
          <p><strong>Built for the way money moves.</strong><br />One connected platform. Fewer loose ends.</p>
        </div>
      </div>

      <div className="hero-visual" aria-label="Preview of the Monsso payments dashboard">
        <div className="visual-orbit orbit-one" />
        <div className="visual-orbit orbit-two" />
        <div className="dashboard-card">
          <div className="dashboard-top">
            <div className="dashboard-brand"><span className="mini-mark"><i /><i /><i /></span><span>monsso</span></div>
            <div className="dashboard-profile"><span className="online-dot" /> Live overview <span className="profile-avatar">S</span></div>
          </div>
          <div className="dashboard-content">
            <div className="dash-heading"><div><span className="dash-label">TOTAL PROCESSED</span><h2>$284,392<span>.80</span></h2></div><span className="period-select">Last 30 days⌄</span></div>
            <div className="dash-growth"><span>↗ 12.8%</span> <small>vs. last month</small></div>
            <div className="chart-area">
              <div className="chart-grid"><span>$30k</span><span>$20k</span><span>$10k</span><span>$0</span></div>
              <svg viewBox="0 0 480 130" preserveAspectRatio="none" role="img" aria-label="Payments trending upward over the last 30 days">
                <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8c5cf6" stopOpacity=".2" /><stop offset="100%" stopColor="#8c5cf6" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 104 C22 98 27 72 52 82 S86 101 105 74 134 88 157 62 187 86 209 58 238 73 260 48 292 69 316 38 346 60 369 32 399 43 424 22 S450 38 467 18 S473 18 480 20 L480 130 L0 130Z" fill="url(#chartFill)" />
                <path d="M0 104 C22 98 27 72 52 82 S86 101 105 74 134 88 157 62 187 86 209 58 238 73 260 48 292 69 316 38 346 60 369 32 399 43 424 22 S450 38 467 18 S473 18 480 20" fill="none" stroke="#8054e9" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="chart-dates"><span>May 01</span><span>May 08</span><span>May 15</span><span>May 22</span><span>May 30</span></div>
            </div>
            <div className="dash-transactions">
              <div className="transaction-title"><strong>Recent activity</strong><a href="#platform">View all <ArrowRight /></a></div>
              <div className="transaction-row"><span className="transaction-symbol symbol-purple">$</span><span className="transaction-name">Acme Studio<small>Subscription payment</small></span><strong>+$240.00</strong><span className="status-pill">Paid</span></div>
              <div className="transaction-row"><span className="transaction-symbol symbol-peach">↗</span><span className="transaction-name">Northstar Co.<small>Vendor payout</small></span><strong>−$1,850.00</strong><span className="status-pill">Sent</span></div>
            </div>
          </div>
        </div>
        <div className="floating-note recovery-note"><span className="note-icon"><CheckIcon /></span><div><strong>Payment recovered</strong><small>Retry smartly. Keep customers.</small></div><span className="note-value">+$89</span></div>
        <div className="floating-note sync-note"><span className="sync-icon">↔</span><div><strong>Everything in sync</strong><small>Billing · payments · payouts</small></div></div>
      </div>
    </section>
  )
}

export default HeroSection
