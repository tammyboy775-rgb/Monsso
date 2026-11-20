import { useCallback, useEffect, useMemo, useState } from 'react'
import BrandMark from '../components/Brand.jsx'
import { useAuth } from '../auth/useAuth.js'
import './AutomationPage.css'

const query = new URLSearchParams(window.location.search)
const callback = {
  state: query.get('state'),
  hash: query.get('hash'),
  interactRef: query.get('interact_ref'),
  workflow: query.get('workflow'),
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: options.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options.headers,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'The workflow request failed.')
  return result
}

function formatAmount(amount) {
  if (!amount) return ''
  const value = BigInt(amount.value).toString().padStart(amount.assetScale + 1, '0')
  const formatted = amount.assetScale
    ? `${value.slice(0, -amount.assetScale)}.${value.slice(-amount.assetScale)}`
    : value
  return `${amount.assetCode} ${formatted}`
}

function createMetadata({ description, invoiceReference, orderReference, lineItemsText }) {
  let lineItems
  try {
    lineItems = JSON.parse(lineItemsText || '[]')
  } catch {
    throw new Error('Line items must be valid JSON.')
  }
  if (!Array.isArray(lineItems)) {
    throw new Error('Line items must be a JSON array.')
  }
  return {
    description,
    invoiceReference,
    orderReference,
    lineItems,
  }
}

function MetadataFields({ value, onChange, prefix }) {
  function update(key, nextValue) {
    onChange({ ...value, [key]: nextValue })
  }

  return (
    <fieldset className="workflow-metadata">
      <legend>Payment metadata</legend>
      <label htmlFor={`${prefix}-description`}>Description</label>
      <input
        id={`${prefix}-description`}
        value={value.description}
        maxLength={200}
        onChange={(event) => update('description', event.target.value)}
        required
      />
      <div className="workflow-field-row">
        <div>
          <label htmlFor={`${prefix}-invoice`}>Invoice reference</label>
          <input
            id={`${prefix}-invoice`}
            value={value.invoiceReference}
            maxLength={100}
            onChange={(event) => update('invoiceReference', event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-order`}>Order reference</label>
          <input
            id={`${prefix}-order`}
            value={value.orderReference}
            maxLength={100}
            onChange={(event) => update('orderReference', event.target.value)}
          />
        </div>
      </div>
      <label htmlFor={`${prefix}-line-items`}>Line items (JSON, optional)</label>
      <textarea
        id={`${prefix}-line-items`}
        value={value.lineItemsText}
        onChange={(event) => update('lineItemsText', event.target.value)}
        rows={3}
        spellCheck="false"
      />
      <p className="workflow-help">
        Use objects with <code>description</code>, <code>quantity</code>, and
        {' '}<code>unitAmount</code>. If provided, line-item totals must match
        the payment. Do not include personal or sensitive data.
      </p>
    </fieldset>
  )
}

const initialMetadata = {
  description: 'Monsso test payment',
  invoiceReference: '',
  orderReference: '',
  lineItemsText: '[]',
}

const workflowTabs = ['recurring', 'metadata', 'split', 'settlement']

function AutomationPage() {
  const { user, loading } = useAuth()
  const callbackActive = window.location.pathname === '/automation/finish'
  const callbackValid = callback.state && callback.hash && callback.interactRef &&
    ['recurring', 'split'].includes(callback.workflow)
  const requestedTab = query.get('tab')
  const signInDestination = workflowTabs.includes(requestedTab)
    ? `/workflows?tab=${requestedTab}`
    : '/workflows'
  const initialTab = callbackActive && callbackValid
    ? 'settlement'
    : workflowTabs.includes(requestedTab)
      ? requestedTab
      : query.has('split') || query.has('plan')
        ? 'settlement'
        : 'recurring'
  const [activeTab, setActiveTab] = useState(initialTab)
  const [busy, setBusy] = useState(callbackActive && Boolean(callbackValid))
  const [error, setError] = useState(
    callbackActive && !callbackValid
      ? 'The wallet authorization callback is incomplete. Start the workflow again.'
      : '',
  )
  const [notice, setNotice] = useState('')
  const [recurringPlan, setRecurringPlan] = useState(null)
  const [splitResult, setSplitResult] = useState(null)
  const [payerWalletAddress, setPayerWalletAddress] = useState('')
  const [maxPerInterval, setMaxPerInterval] = useState('15.00')
  const [initialChargeAmount, setInitialChargeAmount] = useState('5.00')
  const [intervalCount, setIntervalCount] = useState('3')
  const [recurringMetadata, setRecurringMetadata] = useState({
    ...initialMetadata,
    description: 'Monthly test subscription',
  })
  const [chargeAmount, setChargeAmount] = useState('5.00')
  const [chargeMetadata, setChargeMetadata] = useState({
    ...initialMetadata,
    description: 'Variable recurring test charge',
  })
  const [splitTotal, setSplitTotal] = useState('10.00')
  const [recipientOne, setRecipientOne] = useState('')
  const [recipientOnePercent, setRecipientOnePercent] = useState('90')
  const [recipientTwo, setRecipientTwo] = useState('')
  const [splitMetadata, setSplitMetadata] = useState({
    ...initialMetadata,
    description: 'Monsso split test payment',
  })

  const secondRecipientPercent = useMemo(() => {
    const first = Number(recipientOnePercent)
    return Number.isInteger(first) ? Math.max(0, 100 - first) : 0
  }, [recipientOnePercent])

  const refreshRecurring = useCallback(async (id) => {
    const result = await requestJson(`/api/automation/recurring/${encodeURIComponent(id)}`)
    setRecurringPlan(result)
    return result
  }, [])

  const refreshSplit = useCallback(async (id) => {
    const result = await requestJson(`/api/automation/split/${encodeURIComponent(id)}`)
    setSplitResult(result)
    return result
  }, [])

  function selectTab(tab) {
    setActiveTab(tab)
    setError('')
    setNotice('')
    const params = new URLSearchParams(window.location.search)
    params.set('tab', tab)
    window.history.replaceState(null, '', `/workflows?${params}`)
  }

  async function refreshSettlement() {
    setBusy(true)
    setError('')
    try {
      if (splitResult?.id) await refreshSplit(splitResult.id)
      else if (recurringPlan?.id) await refreshRecurring(recurringPlan.id)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (callbackActive) {
      if (!callbackValid) return undefined

      let active = true
      window.history.replaceState(null, '', '/automation/finish')
      const endpoint = `/api/automation/${callback.workflow}/finish`
      requestJson(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          state: callback.state,
          hash: callback.hash,
          interactRef: callback.interactRef,
        }),
      })
        .then((result) => {
          if (!active) return
          if (callback.workflow === 'recurring') {
            setRecurringPlan(result)
          } else {
            setSplitResult(result)
          }
          const resultParam = callback.workflow === 'recurring' ? 'plan' : 'split'
          window.history.replaceState(
            null,
            '',
            `/workflows?tab=settlement&${resultParam}=${encodeURIComponent(result.id)}`,
          )
          setNotice('The wallet authorization was verified.')
        })
        .catch((cause) => {
          if (active) setError(cause.message)
        })
        .finally(() => {
          if (active) setBusy(false)
        })

      return () => { active = false }
    }

    const planId = query.get('plan')
    const splitId = query.get('split')
    if (!planId && !splitId) return undefined

    let active = true
    const loadStatus = planId
      ? requestJson(`/api/automation/recurring/${encodeURIComponent(planId)}`)
          .then(setRecurringPlan)
      : requestJson(`/api/automation/split/${encodeURIComponent(splitId)}`)
          .then(setSplitResult)
    loadStatus.catch((cause) => {
      if (active) setError(cause.message)
    })
    return () => { active = false }
  }, [callbackActive, callbackValid, refreshRecurring, refreshSplit])

  useEffect(() => {
    if (!splitResult?.id || splitResult.status === 'completed') return undefined
    let active = true
    let timer
    const poll = async () => {
      try {
        const result = await requestJson(
          `/api/automation/split/${encodeURIComponent(splitResult.id)}`,
        )
        if (!active) return
        setSplitResult(result)
        const pendingRecipients = result.recipients.some((recipient) => (
          !['completed', 'failed'].includes(recipient.status)
        ))
        if (active && pendingRecipients) timer = window.setTimeout(poll, 2500)
      } catch (cause) {
        if (active) setError(cause.message)
      }
    }
    timer = window.setTimeout(poll, 2500)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [splitResult?.id, splitResult?.status])

  async function beginRecurring(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const metadata = createMetadata(recurringMetadata)
      const result = await requestJson('/api/automation/recurring/start', {
        method: 'POST',
        body: JSON.stringify({
          payerWalletAddress,
          maxPerInterval,
          initialChargeAmount,
          intervalCount: Number(intervalCount),
          metadata,
        }),
      })
      window.location.assign(result.redirectUrl)
    } catch (cause) {
      setError(cause.message)
      setBusy(false)
    }
  }

  async function chargeRecurring(event) {
    event.preventDefault()
    if (!recurringPlan) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const metadata = createMetadata(chargeMetadata)
      const result = await requestJson(
        `/api/automation/recurring/${encodeURIComponent(recurringPlan.id)}/charge`,
        {
          method: 'POST',
          body: JSON.stringify({ amount: chargeAmount, metadata }),
        },
      )
      setRecurringPlan(result)
      setNotice('Test installment submitted. The wallet settlement status is shown below.')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  async function beginSplit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const metadata = createMetadata(splitMetadata)
      const result = await requestJson('/api/automation/split/start', {
        method: 'POST',
        body: JSON.stringify({
          payerWalletAddress,
          totalAmount: splitTotal,
          recipients: [
            { walletAddress: recipientOne, percentage: Number(recipientOnePercent) },
            { walletAddress: recipientTwo, percentage: secondRecipientPercent },
          ],
          metadata,
        }),
      })
      window.location.assign(result.redirectUrl)
    } catch (cause) {
      setError(cause.message)
      setBusy(false)
    }
  }

  if (loading) {
    return <main className="workflow-page"><p className="workflow-loading">Loading your account…</p></main>
  }

  if (!user) {
    return (
      <main className="workflow-page">
        <a className="brand workflow-brand" href="/" aria-label="Monsso home">
          <BrandMark /><span>monsso</span>
        </a>
        <section className="workflow-card workflow-locked">
          <h1>Sign in to manage test workflows</h1>
          <p>Workflow controls are limited to your Monsso account. Payers still authorize every recurring grant in their wallet.</p>
          <a
            className="workflow-primary-link"
            href={`/login?next=${encodeURIComponent(signInDestination)}`}
          >
            Sign in with Google
          </a>
        </section>
      </main>
    )
  }

  return (
    <main className="workflow-page">
      <header className="workflow-header">
        <a className="brand workflow-brand" href="/" aria-label="Monsso home">
          <BrandMark /><span>monsso</span>
        </a>
        <a className="workflow-home-link" href="/">Back to Monsso</a>
      </header>
      <section className="workflow-shell">
        <div className="workflow-overline">OPEN PAYMENTS · TESTNET ONLY</div>
        <h1>Automation &amp; workflows</h1>
        <p className="workflow-intro">
          Authorize bounded recurring spending, attach invoice metadata, and route one payment to multiple wallets.
          Every flow uses test wallets and requires payer approval.
        </p>

        <div className="workflow-tabs" role="tablist" aria-label="Payment workflows">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'recurring'}
            onClick={() => selectTab('recurring')}
          >
            Variable recurring
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'metadata'}
            onClick={() => selectTab('metadata')}
          >
            Payment metadata
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'split'}
            onClick={() => selectTab('split')}
          >
            Split payout
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'settlement'}
            onClick={() => selectTab('settlement')}
          >
            Settlement status
          </button>
        </div>

        {activeTab === 'metadata' ? (
          <section className="workflow-panel" role="tabpanel" aria-labelledby="metadata-title">
            <div className="workflow-panel-heading">
              <span className="workflow-step">02</span>
              <div>
                <h2 id="metadata-title">Payment metadata</h2>
                <p>Keep descriptions, invoice references, order references, and line items attached to real payments.</p>
              </div>
            </div>
            <p className="workflow-notice">
              Metadata is included with a recurring charge or a split payout; it does not create a payment by itself.
              Choose the payment flow first, then fill in its metadata fields before authorizing the test payment.
            </p>
            <button
              className="workflow-secondary"
              type="button"
              onClick={() => selectTab('recurring')}
            >
              Add metadata to a recurring payment
            </button>
            <button
              className="workflow-secondary"
              type="button"
              onClick={() => selectTab('split')}
            >
              Add metadata to a split payout
            </button>
          </section>
        ) : activeTab === 'settlement' ? (
          <section className="workflow-panel" role="tabpanel" aria-labelledby="settlement-title">
            <div className="workflow-panel-heading">
              <span className="workflow-step">04</span>
              <div>
                <h2 id="settlement-title">Settlement status</h2>
                <p>Check whether submitted test payments have been received by the wallet.</p>
              </div>
            </div>
            {splitResult ? (
              <>
                <div className="workflow-result-head">
                  <span className={`workflow-status workflow-status-${splitResult.status}`}>
                    {splitResult.status.replace('_', ' ')}
                  </span>
                  <strong>Total {formatAmount(splitResult.totalAmount)}</strong>
                </div>
                {splitResult.recipients.map((recipient, index) => (
                  <article className="workflow-split-result" key={recipient.walletAddress}>
                    <div className="workflow-split-index">0{index + 1}</div>
                    <div>
                      <strong>{recipient.percentage}% · {formatAmount(recipient.incomingAmount)}</strong>
                      <span>{recipient.metadata?.invoiceReference || recipient.metadata?.description}</span>
                      <small>{recipient.walletAddress}</small>
                      {recipient.receivedAmount && <small>Received {formatAmount(recipient.receivedAmount)}</small>}
                    </div>
                    <span className={`workflow-status workflow-status-${recipient.status}`}>{recipient.status}</span>
                  </article>
                ))}
                <button
                  className="workflow-refresh"
                  type="button"
                  disabled={busy}
                  onClick={refreshSettlement}
                >
                  Refresh recipient settlement status
                </button>
              </>
            ) : recurringPlan ? (
              <>
                <div className="workflow-budget-grid">
                  <div><span>Monthly maximum</span><strong>{formatAmount(recurringPlan.maxPerInterval)}</strong></div>
                  <div><span>Spent this interval</span><strong>{formatAmount(recurringPlan.spentDebitAmount)}</strong></div>
                  <div><span>Remaining this interval</span><strong>{formatAmount(recurringPlan.remainingDebitAmount)}</strong></div>
                </div>
                <div className="workflow-payment-list">
                  <h3>Installment and receipt status</h3>
                  {recurringPlan.payments.map((payment) => (
                    <article className="workflow-payment-row" key={payment.id}>
                      <div>
                        <strong>{formatAmount(payment.amount)}</strong>
                        <span>{payment.metadata?.invoiceReference || payment.metadata?.description}</span>
                      </div>
                      <span className={`workflow-status workflow-status-${payment.status}`}>{payment.status}</span>
                      {payment.receivedAmount && <small>Received {formatAmount(payment.receivedAmount)}</small>}
                    </article>
                  ))}
                </div>
                <button
                  className="workflow-refresh"
                  type="button"
                  disabled={busy}
                  onClick={refreshSettlement}
                >
                  Refresh spend and settlement status
                </button>
              </>
            ) : (
              <>
                <p className="workflow-notice">
                  Settlement details are available after a payer authorizes a recurring payment or split payout.
                  Submitted payments remain pending until the receiving wallet confirms receipt.
                </p>
                <button
                  className="workflow-secondary"
                  type="button"
                  onClick={() => selectTab('recurring')}
                >
                  Start a recurring payment
                </button>
                <button
                  className="workflow-secondary"
                  type="button"
                  onClick={() => selectTab('split')}
                >
                  Create a split payout
                </button>
              </>
            )}
          </section>
        ) : activeTab === 'recurring' ? (
          <section className="workflow-panel" role="tabpanel" aria-labelledby="recurring-title">
            <div className="workflow-panel-heading">
              <span className="workflow-step">01</span>
              <div>
                <h2 id="recurring-title">Variable recurring payment</h2>
                <p>Get consent for variable monthly charges up to a customer-approved cap.</p>
              </div>
            </div>
            {!recurringPlan ? (
              <form className="workflow-form" onSubmit={beginRecurring}>
                <label htmlFor="recurring-payer">Payer test-wallet address</label>
                <input
                  id="recurring-payer"
                  type="url"
                  value={payerWalletAddress}
                  onChange={(event) => setPayerWalletAddress(event.target.value)}
                  placeholder="Copy the payer account’s exact Wallet Address URL"
                  required
                />
                <div className="workflow-field-row">
                  <div>
                    <label htmlFor="recurring-max">Maximum wallet debit per month</label>
                    <input
                      id="recurring-max"
                      inputMode="decimal"
                      value={maxPerInterval}
                      onChange={(event) => setMaxPerInterval(event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="recurring-count">Monthly periods (2–12)</label>
                    <input
                      id="recurring-count"
                      type="number"
                      min="2"
                      max="12"
                      value={intervalCount}
                      onChange={(event) => setIntervalCount(event.target.value)}
                      required
                    />
                  </div>
                </div>
                <label htmlFor="recurring-first-charge">Initial variable charge amount</label>
                <input
                  id="recurring-first-charge"
                  inputMode="decimal"
                  value={initialChargeAmount}
                  onChange={(event) => setInitialChargeAmount(event.target.value)}
                  required
                />
                <MetadataFields
                  prefix="recurring"
                  value={recurringMetadata}
                  onChange={setRecurringMetadata}
                />
                <div className="workflow-notice">
                  The payer approves the maximum monthly debit and duration in their wallet. The grant is not
                  receiver-scoped at the protocol level; this workflow sends charges only to Monsso’s configured
                  merchant wallet. Review the wallet prompt before approving.
                </div>
                <button className="workflow-submit" type="submit" disabled={busy}>
                  {busy ? 'Preparing wallet authorization…' : 'Review recurring authorization'}
                </button>
              </form>
            ) : (
              <div className="workflow-plan">
                <div className="workflow-budget-grid">
                  <div><span>Monthly maximum</span><strong>{formatAmount(recurringPlan.maxPerInterval)}</strong></div>
                  <div><span>Spent this interval</span><strong>{formatAmount(recurringPlan.spentDebitAmount)}</strong></div>
                  <div><span>Remaining this interval</span><strong>{formatAmount(recurringPlan.remainingDebitAmount)}</strong></div>
                </div>
                <p className="workflow-notice">
                  The recurring grant is active for {recurringPlan.intervalCount} monthly periods. The wallet enforces
                  the per-interval cap. Test installments are triggered manually here; this prototype does not run a
                  background billing scheduler.
                </p>
                <form className="workflow-form" onSubmit={chargeRecurring}>
                  <label htmlFor="recurring-charge">Charge amount for this test installment</label>
                  <input
                    id="recurring-charge"
                    inputMode="decimal"
                    value={chargeAmount}
                    onChange={(event) => setChargeAmount(event.target.value)}
                    required
                  />
                  <MetadataFields
                    prefix="charge"
                    value={chargeMetadata}
                    onChange={setChargeMetadata}
                  />
                  <button className="workflow-submit" type="submit" disabled={busy}>
                    {busy ? 'Submitting test installment…' : 'Run test installment'}
                  </button>
                </form>
                <div className="workflow-payment-list">
                  <h3>Installment and reconciliation history</h3>
                  {recurringPlan.payments.map((payment) => (
                    <article className="workflow-payment-row" key={payment.id}>
                      <div><strong>{formatAmount(payment.amount)}</strong><span>{payment.metadata?.invoiceReference || payment.metadata?.description}</span></div>
                      <span className={`workflow-status workflow-status-${payment.status}`}>{payment.status}</span>
                      {payment.receivedAmount && <small>Received {formatAmount(payment.receivedAmount)}</small>}
                    </article>
                  ))}
                </div>
                <button
                  className="workflow-refresh"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    refreshRecurring(recurringPlan.id)
                      .catch((cause) => setError(cause.message))
                      .finally(() => setBusy(false))
                  }}
                >
                  Refresh spend and settlement status
                </button>
                <button
                  className="workflow-secondary"
                  type="button"
                  onClick={() => {
                    setRecurringPlan(null)
                    window.history.replaceState(null, '', '/workflows')
                  }}
                >
                  Set up another recurring grant
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="workflow-panel" role="tabpanel" aria-labelledby="split-title">
            <div className="workflow-panel-heading">
              <span className="workflow-step">02</span>
              <div>
                <h2 id="split-title">Programmable split payout</h2>
                <p>Split one checkout directly across two recipient wallets using one payer authorization.</p>
              </div>
            </div>
            {!splitResult ? (
              <form className="workflow-form" onSubmit={beginSplit}>
                <label htmlFor="split-payer">Payer test-wallet address</label>
                <input
                  id="split-payer"
                  type="url"
                  value={payerWalletAddress}
                  onChange={(event) => setPayerWalletAddress(event.target.value)}
                  placeholder="Copy the payer account’s exact Wallet Address URL"
                  required
                />
                <label htmlFor="split-total">Total payment amount</label>
                <input
                  id="split-total"
                  inputMode="decimal"
                  value={splitTotal}
                  onChange={(event) => setSplitTotal(event.target.value)}
                  required
                />
                <div className="workflow-recipient">
                  <strong>Recipient 1</strong>
                  <label htmlFor="recipient-one-wallet">Test-wallet address</label>
                  <input
                    id="recipient-one-wallet"
                    type="url"
                    value={recipientOne}
                    onChange={(event) => setRecipientOne(event.target.value)}
                    placeholder="Copy recipient 1’s exact Wallet Address URL"
                    required
                  />
                  <div className="workflow-percent-row">
                    <label htmlFor="recipient-one-percent">Allocation</label>
                    <input
                      id="recipient-one-percent"
                      type="number"
                      min="1"
                      max="99"
                      value={recipientOnePercent}
                      onChange={(event) => setRecipientOnePercent(event.target.value)}
                      required
                    />
                    <span>%</span>
                  </div>
                </div>
                <div className="workflow-recipient">
                  <strong>Recipient 2</strong>
                  <label htmlFor="recipient-two-wallet">Test-wallet address</label>
                  <input
                    id="recipient-two-wallet"
                    type="url"
                    value={recipientTwo}
                    onChange={(event) => setRecipientTwo(event.target.value)}
                    placeholder="Copy recipient 2’s exact Wallet Address URL"
                    required
                  />
                  <p className="workflow-help">Remaining allocation: {secondRecipientPercent}%</p>
                </div>
                <MetadataFields
                  prefix="split"
                  value={splitMetadata}
                  onChange={setSplitMetadata}
                />
                <div className="workflow-notice">
                  Both recipients must support the same test currency. Amounts are rounded down to the wallet’s
                  smallest unit, with any remainder assigned to recipient 2. The grant is capped by the combined
                  quoted amount but is not receiver-scoped; verify both recipient wallets and amounts in your wallet
                  before approving. Funds are sent directly to recipients; Monsso does not hold them.
                </div>
                <button className="workflow-submit" type="submit" disabled={busy}>
                  {busy ? 'Preparing split quote…' : 'Review split payment'}
                </button>
              </form>
            ) : (
              <div className="workflow-plan">
                <div className="workflow-result-head">
                  <span className={`workflow-status workflow-status-${splitResult.status}`}>{splitResult.status.replace('_', ' ')}</span>
                  <strong>Total {formatAmount(splitResult.totalAmount)}</strong>
                </div>
                {splitResult.recipients.map((recipient, index) => (
                  <article className="workflow-split-result" key={recipient.walletAddress}>
                    <div className="workflow-split-index">0{index + 1}</div>
                    <div>
                      <strong>{recipient.percentage}% · {formatAmount(recipient.incomingAmount)}</strong>
                      <span>{recipient.metadata?.invoiceReference || recipient.metadata?.description}</span>
                      <small>{recipient.walletAddress}</small>
                      {recipient.receivedAmount && <small>Received {formatAmount(recipient.receivedAmount)}</small>}
                    </div>
                    <span className={`workflow-status workflow-status-${recipient.status}`}>{recipient.status}</span>
                  </article>
                ))}
                <p className="workflow-notice">
                  Each allocation has its own quote and incoming-payment resource. Refreshing below checks settlement
                  separately for each recipient.
                </p>
                <button
                  className="workflow-refresh"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    refreshSplit(splitResult.id)
                      .catch((cause) => setError(cause.message))
                      .finally(() => setBusy(false))
                  }}
                >
                  Refresh recipient settlement status
                </button>
                <button
                  className="workflow-secondary"
                  type="button"
                  onClick={() => {
                    setSplitResult(null)
                    window.history.replaceState(null, '', '/workflows')
                  }}
                >
                  Create another split payment
                </button>
              </div>
            )}
          </section>
        )}

        {notice && <p className="workflow-success" role="status">{notice}</p>}
        {error && <p className="workflow-error" role="alert">{error}</p>}
        <p className="workflow-disclaimer">
          Sandbox prototype only. No real money is used. Do not enter real wallet details or sensitive personal data.
        </p>
      </section>
    </main>
  )
}

export default AutomationPage
