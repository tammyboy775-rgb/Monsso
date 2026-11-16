import { ArrowUpRight, FeatureIcon } from '../Icons.jsx'
import './SolutionsSection.css'

const solutions = [
  {
    icon: 'retry',
    number: '01 / REVENUE RECOVERY',
    title: 'Turn failed payments into second chances.',
    description: 'Smart retries and clear customer updates help recover more recurring revenue before a missed payment becomes a lost customer.',
    label: 'Learn about revenue recovery',
  },
  {
    icon: 'reconcile',
    number: '02 / RECONCILIATION',
    title: 'Know what every payment is for.',
    description: 'Automatically match payments to invoices—even partial payments and bank transfers—without the spreadsheet detective work.',
    label: 'Learn about reconciliation',
  },
  {
    icon: 'payout',
    number: '03 / MULTI-PARTY PAYOUTS',
    title: 'Get everyone paid, right on time.',
    description: 'Split funds across vendors, partners, or teams with transparent payout rules and a clear view of where every dollar goes.',
    label: 'Learn about multi-party payouts',
  },
  {
    icon: 'billing',
    number: '04 / FLEXIBLE BILLING',
    title: 'Billing that bends with your business.',
    description: 'Handle usage-based pricing, prorated plan changes, and custom billing schedules without building workarounds.',
    label: 'Learn about flexible billing',
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
            <a href="#contact" aria-label={solution.label}><ArrowUpRight /></a>
          </article>
        ))}
      </div>
    </section>
  )
}

export default SolutionsSection
