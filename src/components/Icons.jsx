export function ArrowUpRight() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.5 14.5 14 6m0 0H7m7 0v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ArrowRight() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 10h13m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m5 10.2 3.2 3.2L15.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FeatureIcon({ type }) {
  const icons = {
    retry: <><path d="M16.5 8A6.5 6.5 0 0 0 5 5.2L3.5 7" /><path d="M3.5 3.5V7H7" /><path d="M3.5 12a6.5 6.5 0 0 0 11.5 2.8l1.5-1.8" /><path d="M16.5 16.5V13H13" /></>,
    reconcile: <><path d="M4 5.5h12M4 10h7M4 14.5h5" /><path d="m13 13 1.5 1.5L18 11" /></>,
    payout: <><rect x="3.5" y="4.5" width="13" height="11" rx="2" /><path d="M3.5 8h13M7 12h2" /><path d="m12 12 1.5 1.5L16 11" /></>,
    billing: <><path d="M5 3.5h10v13l-2.5-1.8L10 16.5l-2.5-1.8L5 16.5v-13Z" /><path d="M7.5 7.5h5M7.5 11h5" /></>,
  }

  return (
    <span className="feature-icon">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icons[type]}
      </svg>
    </span>
  )
}
