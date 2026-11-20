import { ArrowUpRight, FeatureIcon } from '../Icons.jsx'
import './SolutionsSection.css'

const solutions = [
  {
    icon: 'retry',
    tab: 'recurring',
    number: '01 / VARIABLE RECURRING',
    title: 'Authorize a recurring budget, not a fixed bill.',
    description: 'Payers approve a maximum amount per interval. Monsso can submit variable test charges within that wallet-enforced limit.',
    label: 'Open variable recurring workflows',
  },
  {
    icon: 'reconcile',
    tab: 'metadata',
    number: '02 / PAYMENT METADATA',
    title: 'Keep invoice context with each payment.',
    description: 'Attach descriptions, invoice and order references, and structured line items to incoming and outgoing payment resources.',
    label: 'Open payment metadata workflows',
  },
  {
    icon: 'payout',
    tab: 'split',
    number: '03 / SPLIT PAYOUTS',
    title: 'Route one payment across recipients.',
    description: 'Configure two recipient shares and send each allocation directly to its wallet under one payer authorization.',
    label: 'Open split payout workflows',
  },
  {
    icon: 'billing',
    tab: 'settlement',
    number: '04 / SETTLEMENT STATUS',
    title: 'Reconcile against wallet receipt.',
    description: 'Track each recipient’s incoming payment independently; a submitted payment is not reported as settled until the wallet confirms receipt.',
    label: 'Open settlement workflows',
  },
]

function SolutionsSection() {
  return (
    <section className="solutions-section section-wrap" id="solutions">
      <div className="section-intro">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> LESS PAYMENT FRICTION</div>
          <h2>All the moving parts.<br /><span>Moving together.</span></h2>
        </div>
        <p>From the first charge to the final payout, Monsso takes the busywork out of getting paid—and helps your business keep growing.</p>
      </div>

      <div className="feature-grid">
        {solutions.map((solution) => (
          <article className="feature-card" key={solution.number}>
            <FeatureIcon type={solution.icon} />
            <span className="feature-number">{solution.number}</span>
            <h3>{solution.title}</h3>
            <p>{solution.description}</p>
            <a href={`/workflows?tab=${solution.tab}`} aria-label={solution.label}><ArrowUpRight /></a>
          </article>
        ))}
      </div>
    </section>
  )
}

export default SolutionsSection
