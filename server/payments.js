import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
} from '@interledger/open-payments'

const TESTNET_DOMAIN = 'interledger-test.dev'
const PAYMENT_TTL_MS = 15 * 60 * 1000
const MAX_ACTIVE_PAYMENTS = 200

export class PaymentError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'PaymentError'
    this.statusCode = statusCode
  }
}

function isTestnetHostUrl(value, allowQuery = false) {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)
    const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1]

    return (
      url.protocol === 'https:' &&
      authority !== undefined &&
      !authority.includes('@') &&
      !authority.includes(':') &&
      !url.hash &&
      (allowQuery || !url.search) &&
      (url.hostname === TESTNET_DOMAIN || url.hostname.endsWith(`.${TESTNET_DOMAIN}`))
    )
  } catch {
    return false
  }
}

export function isTestnetWalletAddress(value) {
  return isTestnetHostUrl(value)
}

function assertTestnetAuthorizationUrl(value) {
  if (!isTestnetHostUrl(value, true)) {
    throw new PaymentError('The wallet returned an unsupported authorization URL.', 502)
  }
}

function assertTestnetServiceUrl(value) {
  if (!isTestnetHostUrl(value)) {
    throw new PaymentError('The wallet returned an unsupported test-network endpoint.', 502)
  }
}

export function amountToMinorUnits(amount, assetScale) {
  if (!Number.isInteger(assetScale) || assetScale < 0 || assetScale > 18) {
    throw new PaymentError('The merchant wallet returned an unsupported currency scale.', 502)
  }

  if (typeof amount !== 'string' || amount.length > 40) {
    throw new PaymentError('Enter a valid payment amount.')
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(amount)
  if (!match) {
    throw new PaymentError('Enter a positive amount using digits and an optional decimal point.')
  }

  const fraction = match[2] ?? ''
  if (fraction.length > assetScale) {
    throw new PaymentError(`This wallet supports at most ${assetScale} decimal places.`)
  }

  const minorUnits = BigInt(match[1]) * 10n ** BigInt(assetScale) +
    BigInt(fraction.padEnd(assetScale, '0') || '0')

  if (minorUnits <= 0n) {
    throw new PaymentError('The payment amount must be greater than zero.')
  }

  return minorUnits.toString()
}

export function verifyInteractionHash({
  clientNonce,
  authorizationServerNonce,
  interactRef,
  grantUri,
  receivedHash,
}) {
  if (
    !clientNonce ||
    !authorizationServerNonce ||
    !interactRef ||
    !grantUri ||
    typeof receivedHash !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(receivedHash)
  ) {
    return false
  }

  const hashBase = `${clientNonce}\n${authorizationServerNonce}\n${interactRef}\n${grantUri}`
  const expectedHash = createHash('sha256').update(hashBase, 'ascii').digest('base64url')
  const expected = Buffer.from(expectedHash, 'ascii')
  const received = Buffer.from(receivedHash, 'ascii')

  return expected.length === received.length && timingSafeEqual(expected, received)
}

function assertWalletDetails(walletAddress) {
  assertTestnetServiceUrl(walletAddress.id)
  assertTestnetServiceUrl(walletAddress.authServer)
  assertTestnetServiceUrl(walletAddress.resourceServer)

  if (
    typeof walletAddress.assetCode !== 'string' ||
    !Number.isInteger(walletAddress.assetScale)
  ) {
    throw new PaymentError('The wallet address did not provide valid currency details.', 502)
  }
}

async function getWalletAddress(client, url, role) {
  try {
    return await client.walletAddress.get({ url })
  } catch {
    throw new PaymentError(
      `Could not load the ${role} Open Payments wallet address. Verify its exact test-wallet URL and that the wallet is available.`,
      502,
    )
  }
}

async function cleanExpiredPayments(payments, now) {
  if (typeof payments.cleanExpired === 'function') {
    await payments.cleanExpired(now)
    return
  }

  if (payments instanceof Map) {
    for (const [state, payment] of payments) {
      if (payment.expiresAt <= now) payments.delete(state)
    }
  }
}

async function savePayment(payments, payment, now) {
  const ttlSeconds = Math.max(1, Math.ceil((payment.expiresAt - now()) / 1000))
  await payments.set(payment.state, payment, { ex: ttlSeconds })
}

export function createOpenPaymentsService({
  client,
  merchantWalletAddress,
  appOrigin,
  payments,
  now = Date.now,
}) {
  async function startCheckout({ amount, payerWalletAddress }) {
    await cleanExpiredPayments(payments, now())

    if (Number.isFinite(payments.size) && payments.size >= MAX_ACTIVE_PAYMENTS) {
      throw new PaymentError('Too many active test checkouts. Try again shortly.', 503)
    }

    if (!isTestnetWalletAddress(payerWalletAddress)) {
      throw new PaymentError('Enter a valid Open Payments test-wallet address.')
    }

    const merchant = await getWalletAddress(client, merchantWalletAddress, 'merchant')
    assertWalletDetails(merchant)
    const payer = await getWalletAddress(client, payerWalletAddress, 'payer')
    assertWalletDetails(payer)

    const incomingAmount = {
      value: amountToMinorUnits(amount, merchant.assetScale),
      assetCode: merchant.assetCode,
      assetScale: merchant.assetScale,
    }

    const incomingGrant = await client.grant.request(
      { url: merchant.authServer },
      {
        access_token: {
          access: [{ type: 'incoming-payment', actions: ['create', 'read'] }],
        },
      },
    )

    if (!isFinalizedGrantWithAccessToken(incomingGrant)) {
      throw new PaymentError('The merchant wallet did not approve its incoming-payment grant.', 502)
    }

    const incomingPayment = await client.incomingPayment.create(
      {
        url: merchant.resourceServer,
        accessToken: incomingGrant.access_token.value,
      },
      {
        walletAddress: merchant.id,
        incomingAmount,
        metadata: { description: 'Monsso test checkout' },
      },
    )

    const quoteGrant = await client.grant.request(
      { url: payer.authServer },
      {
        access_token: {
          access: [{ type: 'quote', actions: ['create'] }],
        },
      },
    )

    if (!isFinalizedGrantWithAccessToken(quoteGrant)) {
      throw new PaymentError('The payer wallet did not approve its quote grant.', 502)
    }

    const quote = await client.quote.create(
      {
        url: payer.resourceServer,
        accessToken: quoteGrant.access_token.value,
      },
      {
        method: 'ilp',
        walletAddress: payer.id,
        receiver: incomingPayment.id,
      },
    )

    const state = randomUUID()
    const clientNonce = randomUUID()
    const finishUrl = new URL('/payment/finish', appOrigin)
    finishUrl.searchParams.set('state', state)

    const outgoingGrant = await client.grant.request(
      { url: payer.authServer },
      {
        access_token: {
          access: [
            {
              type: 'outgoing-payment',
              actions: ['create'],
              identifier: payer.id,
              limits: {
                debitAmount: quote.debitAmount,
                receiver: incomingPayment.id,
              },
            },
          ],
        },
        interact: {
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri: finishUrl.href,
            nonce: clientNonce,
          },
        },
      },
    )

    if (!isPendingGrant(outgoingGrant)) {
      throw new PaymentError('The payer wallet did not begin its authorization flow.', 502)
    }

    assertTestnetAuthorizationUrl(outgoingGrant.interact.redirect)
    assertTestnetServiceUrl(outgoingGrant.continue.uri)

    const payment = {
      state,
      expiresAt: now() + PAYMENT_TTL_MS,
      status: 'awaiting_authorization',
      incomingPaymentId: incomingPayment.id,
      incomingAccessToken: incomingGrant.access_token.value,
      payerWalletAddress: payer.id,
      payerResourceServer: payer.resourceServer,
      quoteId: quote.id,
      clientNonce,
      authorizationServer: payer.authServer,
      authorizationServerNonce: outgoingGrant.interact.finish,
      grantUri: payer.authServer,
      quoteExpiresAt: quote.expiresAt,
      debitAmount: quote.debitAmount,
      continueUri: outgoingGrant.continue.uri,
      continueAccessToken: outgoingGrant.continue.access_token.value,
      finishAttempted: false,
    }
    await savePayment(payments, payment, now)

    return {
      state,
      redirectUrl: outgoingGrant.interact.redirect,
      incomingAmount,
      debitAmount: quote.debitAmount,
      quoteExpiresAt: quote.expiresAt,
    }
  }

  async function finishCheckout({ state, hash, interactRef }) {
    await cleanExpiredPayments(payments, now())
    const payment = await payments.get(state)
    if (!payment) throw new PaymentError('This test checkout has expired. Start a new one.', 410)
    if (payment.quoteExpiresAt && Date.parse(payment.quoteExpiresAt) <= now()) {
      throw new PaymentError('The quote has expired. Start a new checkout to get a fresh quote.', 410)
    }

    if (
      !verifyInteractionHash({
        clientNonce: payment.clientNonce,
        authorizationServerNonce: payment.authorizationServerNonce,
        interactRef,
        grantUri: payment.grantUri,
        receivedHash: hash,
      })
    ) {
      throw new PaymentError('The wallet authorization could not be verified.', 400)
    }

    if (payment.outgoingPaymentId) return checkoutStatus(payment)

    if (typeof payments.claimFinish === 'function') {
      const ttlSeconds = Math.max(1, Math.ceil((payment.expiresAt - now()) / 1000))
      if (!await payments.claimFinish(state, ttlSeconds)) {
        throw new PaymentError('This authorization is already being processed.', 409)
      }
    } else if (payment.finishAttempted) {
      throw new PaymentError('This authorization is already being processed.', 409)
    }

    payment.finishAttempted = true
    payment.status = 'processing'
    await savePayment(payments, payment, now)

    const outgoingGrant = await client.grant.continue(
      {
        url: payment.continueUri,
        accessToken: payment.continueAccessToken,
      },
      { interact_ref: interactRef },
    )

    if (!isFinalizedGrantWithAccessToken(outgoingGrant)) {
      throw new PaymentError('The payer wallet did not finalize the outgoing-payment grant.', 502)
    }

    const outgoingPayment = await client.outgoingPayment.create(
      {
        url: payment.payerResourceServer,
        accessToken: outgoingGrant.access_token.value,
      },
      {
        walletAddress: payment.payerWalletAddress,
        quoteId: payment.quoteId,
        metadata: { description: 'Monsso test checkout' },
      },
    )

    payment.outgoingPaymentId = outgoingPayment.id
    payment.status = outgoingPayment.failed ? 'failed' : 'submitted'
    await savePayment(payments, payment, now)

    return checkoutStatus(payment)
  }

  async function checkoutStatus(payment) {
    const incomingPayment = await client.incomingPayment.get({
      url: payment.incomingPaymentId,
      accessToken: payment.incomingAccessToken,
    })

    if (incomingPayment.completed) {
      payment.status = 'completed'
      await savePayment(payments, payment, now)
    }

    return {
      state: payment.state,
      status: payment.status,
      completed: incomingPayment.completed,
      incomingAmount: incomingPayment.incomingAmount,
      receivedAmount: incomingPayment.receivedAmount,
      debitAmount: payment.debitAmount,
      outgoingPaymentId: payment.outgoingPaymentId,
    }
  }

  async function getCheckoutStatus(state) {
    await cleanExpiredPayments(payments, now())
    const payment = await payments.get(state)
    if (!payment) throw new PaymentError('This test checkout has expired. Start a new one.', 410)
    return checkoutStatus(payment)
  }

  return { startCheckout, finishCheckout, getCheckoutStatus }
}
