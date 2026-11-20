import { useEffect, useRef, useState } from 'react'
import './CheckoutPage.css'

const callbackQuery = new URLSearchParams(window.location.search)
const initialCallback = {
  state: callbackQuery.get('state'),
  hash: callbackQuery.get('hash'),
  interactRef: callbackQuery.get('interact_ref'),
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  const responseText = await response.text()
  let result

  try {
    result = JSON.parse(responseText)
  } catch {
    const bodyStatus = responseText.trim() ? 'not valid JSON' : 'empty'
    throw new Error(`The payment API response was ${bodyStatus} (HTTP ${response.status}).`)
  }

  if (!response.ok) {
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : `The payment API request failed (HTTP ${response.status}).`,
    )
  }

  return result
}

function formatAmount(amount) {
  if (!amount) return ''

  const scale = amount.assetScale
  const value = BigInt(amount.value).toString().padStart(scale + 1, '0')
  const formatted = scale
    ? `${value.slice(0, -scale)}.${value.slice(-scale)}`
    : value

  return `${amount.assetCode} ${formatted}`
}

function CheckoutPage() {
  const isFinishRoute = window.location.pathname === '/payment/finish'
  const callbackIncomplete = isFinishRoute && (
    !initialCallback.state ||
    !initialCallback.hash ||
    !initialCallback.interactRef
  )
  const [apiState, setApiState] = useState({ checking: true, configured: false, error: '' })
  const [amount, setAmount] = useState('10')
  const [payerWalletAddress, setPayerWalletAddress] = useState('')
  const [preparedCheckout, setPreparedCheckout] = useState(null)
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(isFinishRoute)
  const finishRequest = useRef(null)

  useEffect(() => {
    let active = true

    requestJson('/api/health')
      .then((health) => {
        if (active) setApiState({ checking: false, ...health, error: '' })
      })
      .catch(() => {
        if (active) {
          setApiState({
            checking: false,
            configured: false,
            missing: [],
            error: 'Start the local API server with npm run dev:server.',
          })
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isFinishRoute) return undefined

    window.history.replaceState(null, '', '/payment/finish')
    let active = true

    if (callbackIncomplete) {
      return undefined
    }

    finishRequest.current ??= requestJson('/api/payments/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initialCallback),
    })

    finishRequest.current
      .then((result) => {
        if (active) setPayment(result)
      })
      .catch((finishError) => {
        if (active) setError(finishError.message)
      })
      .finally(() => {
        if (active) setWorking(false)
      })

    return () => {
      active = false
    }
  }, [isFinishRoute, callbackIncomplete])

  useEffect(() => {
    if (!payment?.state || payment.completed || payment.status === 'failed') return undefined

    let active = true
    let timer
    let attempts = 0

    async function checkStatus() {
      try {
        const status = await requestJson(`/api/payments/${encodeURIComponent(payment.state)}`)
        if (!active) return

        setPayment(status)
        attempts += 1
        if (!status.completed && status.status !== 'failed' && attempts < 10) {
          timer = window.setTimeout(checkStatus, 1500)
        }
      } catch (statusError) {
        if (active) setError(statusError.message)
      }
    }

    timer = window.setTimeout(checkStatus, 1000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [payment?.state, payment?.completed, payment?.status])

  async function startCheckout(event) {
    event.preventDefault()
    setError('')
    setWorking(true)

    try {
      const result = await requestJson('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, payerWalletAddress }),
      })
      setPreparedCheckout(result)
    } catch (startError) {
      setError(startError.message)
    } finally {
      setWorking(false)
    }
  }

  function continueToWallet() {
    if (!preparedCheckout) return
    setWorking(true)
    window.location.assign(preparedCheckout.redirectUrl)
  }

  return (
    <main className="checkout-page">
      <header className="checkout-header">
        <a className="checkout-brand" href="/#top">monsso</a>
        <span className="sandbox-label">TESTNET ONLY</span>
      </header>

      <section className="checkout-card" aria-labelledby="checkout-title">
        <div className="checkout-eyebrow">OPEN PAYMENTS · MERCHANT CHECKOUT</div>
        <h1 id="checkout-title">
          {isFinishRoute ? 'Confirming your payment' : 'A simpler wallet checkout for small merchants.'}
        </h1>
        <p className="checkout-intro">
          {isFinishRoute
            ? 'We are verifying the wallet authorization and checking the merchant payment status.'
            : 'Help local businesses accept digital payments while customers keep control in their own wallet provider. This test flow uses participating wallets only.'}
        </p>

        {!isFinishRoute && !preparedCheckout && (
          <form className="checkout-form" onSubmit={startCheckout}>
            <label htmlFor="amount">Amount in the merchant wallet currency</label>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setPreparedCheckout(null)
              }}
              placeholder="10"
              required
            />

            <label htmlFor="payer-wallet">Your Open Payments test-wallet address</label>
            <input
              id="payer-wallet"
              name="payer-wallet"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={payerWalletAddress}
              onChange={(event) => {
                setPayerWalletAddress(event.target.value)
                setPreparedCheckout(null)
              }}
              placeholder="https://ilp.interledger-test.dev/your-wallet"
              required
            />

            <p className="checkout-help">
              You will review and authorize the payment with your wallet provider before any test funds move.
            </p>
            <button type="submit" disabled={working || apiState.checking || !apiState.configured}>
              {working ? 'Getting a secure quote…' : 'Review payment quote'}
            </button>
          </form>
        )}

        {!isFinishRoute && preparedCheckout && (
          <div className="checkout-quote">
            <p>Merchant receives <strong>{formatAmount(preparedCheckout.incomingAmount)}</strong></p>
            <p>Your wallet will be charged <strong>{formatAmount(preparedCheckout.debitAmount)}</strong></p>
            <p>Review and approve the outgoing payment in your wallet provider.</p>
            <button type="button" onClick={continueToWallet} disabled={working}>
              {working ? 'Opening wallet…' : 'Continue to wallet authorization'}
            </button>
            <button
              className="checkout-change"
              type="button"
              onClick={() => setPreparedCheckout(null)}
              disabled={working}
            >
              Change payment details
            </button>
          </div>
        )}

        {apiState.error && <p className="checkout-notice" role="status">{apiState.error}</p>}
        {!apiState.checking && !apiState.error && !apiState.configured && (
          <div className="checkout-notice" role="status">
            <strong>Test wallet setup is needed.</strong>
            <p>Copy .env.example to .env and add your test-wallet address, key ID, and private-key path. Keep the private key local.</p>
            {apiState.missing?.length > 0 && <p>Missing settings: {apiState.missing.join(', ')}</p>}
          </div>
        )}

        {working && isFinishRoute && !callbackIncomplete && (
          <p className="checkout-notice" role="status">Verifying the wallet response…</p>
        )}
        {payment && (
          <div className={`checkout-result ${payment.status === 'failed' ? 'checkout-result-error' : ''}`} role="status">
            <strong>
              {payment.completed
                ? 'Payment received by the merchant wallet.'
                : payment.status === 'failed'
                  ? 'The wallet reported that this payment failed.'
                  : 'Payment submitted; waiting for wallet settlement.'}
            </strong>
            {payment.receivedAmount && (
              <p>
                Received: {formatAmount(payment.receivedAmount)}
                {' · '}Expected: {formatAmount(payment.incomingAmount)}
              </p>
            )}
            {payment.debitAmount && <p>Wallet debit: {formatAmount(payment.debitAmount)}</p>}
            {payment.outgoingPaymentId && <p>Outgoing payment: {payment.outgoingPaymentId}</p>}
          </div>
        )}
        {(error || callbackIncomplete) && (
          <p className="checkout-error" role="alert">
            {error || 'The wallet authorization callback is incomplete. Start a new checkout.'}
          </p>
        )}

        <p className="checkout-disclaimer">
          Sandbox prototype only. It uses test funds, temporary in-memory state, and supported test-wallet accounts.
        </p>
      </section>
    </main>
  )
}

export default CheckoutPage
