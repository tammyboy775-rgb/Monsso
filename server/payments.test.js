import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  amountToMinorUnits,
  createOpenPaymentsService,
  isTestnetWalletAddress,
  verifyInteractionHash,
} from './payments.js'

function createAsyncPaymentStore() {
  const payments = new Map()
  const finishLocks = new Set()

  return {
    async get(state) {
      const payment = payments.get(state)
      return payment ? structuredClone(payment) : undefined
    },
    async set(state, payment) {
      payments.set(state, structuredClone(payment))
    },
    async claimFinish(state) {
      if (finishLocks.has(state)) return false
      finishLocks.add(state)
      return true
    },
  }
}

test('converts decimal amounts to integer minor units without floating point', () => {
  assert.equal(amountToMinorUnits('12.34', 2), '1234')
  assert.equal(amountToMinorUnits('12', 2), '1200')
  assert.equal(amountToMinorUnits('12', 0), '12')
})

test('rejects invalid and over-precision payment amounts', () => {
  for (const amount of ['0', '-1', '1e3', '1,000', '1.001', '01.00', '']) {
    assert.throws(() => amountToMinorUnits(amount, 2))
  }
  assert.throws(() => amountToMinorUnits('1', 19))
})

test('accepts only HTTPS wallet addresses on the Open Payments test network', () => {
  assert.equal(isTestnetWalletAddress('https://ilp.interledger-test.dev/alice'), true)
  assert.equal(isTestnetWalletAddress('https://wallet.interledger-test.dev/alice'), true)
  assert.equal(isTestnetWalletAddress('http://ilp.interledger-test.dev/alice'), false)
  assert.equal(isTestnetWalletAddress('https://localhost/alice'), false)
  assert.equal(isTestnetWalletAddress('https://interledger-test.dev.attacker.example/alice'), false)
  assert.equal(isTestnetWalletAddress('https://ilp.interledger-test.dev/alice?x=1'), false)
})

test('identifies which wallet address failed to load during checkout', async () => {
  const merchantUrl = 'https://ilp.interledger-test.dev/merchant'
  const payerUrl = 'https://ilp.interledger-test.dev/payer'
  const merchantWallet = {
    id: merchantUrl,
    assetCode: 'USD',
    assetScale: 2,
    authServer: 'https://auth.interledger-test.dev',
    resourceServer: 'https://ilp.interledger-test.dev',
  }
  const payments = new Map()
  const createService = (walletAddressGet) => createOpenPaymentsService({
    client: { walletAddress: { get: walletAddressGet } },
    merchantWalletAddress: merchantUrl,
    appOrigin: 'http://localhost:5173',
    payments,
  })

  await assert.rejects(
    createService(async () => { throw new Error('request failed') }).startCheckout({
      amount: '10',
      payerWalletAddress: payerUrl,
    }),
    /Could not load the merchant Open Payments wallet address/,
  )

  await assert.rejects(
    createService(async ({ url }) => {
      if (url === payerUrl) throw new Error('request failed')
      return merchantWallet
    }).startCheckout({
      amount: '10',
      payerWalletAddress: payerUrl,
    }),
    /Could not load the payer Open Payments wallet address/,
  )
})

test('identifies the Open Payments operation when a checkout POST fails', async () => {
  const merchantUrl = 'https://ilp.interledger-test.dev/merchant'
  const payerUrl = 'https://ilp.interledger-test.dev/payer'
  const client = {
    walletAddress: {
      get: async ({ url }) => ({
        id: url,
        assetCode: 'USD',
        assetScale: 2,
        authServer: 'https://auth.interledger-test.dev',
        resourceServer: 'https://ilp.interledger-test.dev',
      }),
    },
    grant: {
      request: async () => { throw new Error('request failed') },
    },
  }
  const service = createOpenPaymentsService({
    client,
    merchantWalletAddress: merchantUrl,
    appOrigin: 'http://localhost:5173',
    payments: new Map(),
  })

  await assert.rejects(
    service.startCheckout({ amount: '10', payerWalletAddress: payerUrl }),
    /Open Payments merchant incoming-payment grant request failed: request failed/,
  )
})

test('verifies the Open Payments interaction hash and rejects tampering', () => {
  const values = {
    clientNonce: 'client-nonce',
    authorizationServerNonce: 'server-nonce',
    interactRef: 'interaction-reference',
    grantUri: 'https://auth.interledger-test.dev',
  }
  const receivedHash = createHash('sha256')
    .update(`${values.clientNonce}\n${values.authorizationServerNonce}\n${values.interactRef}\n${values.grantUri}`, 'ascii')
    .digest('base64url')

  assert.equal(verifyInteractionHash({ ...values, receivedHash }), true)
  const changedHash = `${receivedHash[0] === 'A' ? 'B' : 'A'}${receivedHash.slice(1)}`
  assert.equal(verifyInteractionHash({ ...values, receivedHash: changedHash }), false)
})

test('verifies wallet interaction hashes with standard Base64 and endpoint slash variants', () => {
  const values = {
    clientNonce: 'client-nonce',
    authorizationServerNonce: 'server-nonce',
    interactRef: 'interaction-reference',
    grantUri: 'https://auth.interledger-test.dev',
  }
  const receivedHash = createHash('sha256')
    .update(
      `${values.clientNonce}\n${values.authorizationServerNonce}\n${values.interactRef}\n${values.grantUri}/`,
      'ascii',
    )
    .digest('base64')

  assert.equal(verifyInteractionHash({ ...values, receivedHash }), true)
  assert.equal(
    verifyInteractionHash({ ...values, interactRef: 'different-reference', receivedHash }),
    false,
  )
})

test('rejects a checkout whose quote expired before payer authorization completed', async () => {
  const state = '00000000-0000-4000-8000-000000000001'
  const service = createOpenPaymentsService({
    client: {},
    merchantWalletAddress: 'https://ilp.interledger-test.dev/merchant',
    appOrigin: 'http://localhost:5173',
    payments: new Map([[
      state,
      {
        state,
        expiresAt: Date.now() + 60_000,
        quoteExpiresAt: '2000-01-01T00:00:00.000Z',
      },
    ]]),
  })

  await assert.rejects(
    service.finishCheckout({ state, hash: '', interactRef: '' }),
    /quote has expired/,
  )
})

test('creates a scoped test checkout and submits one outgoing payment after authorization', async () => {
  const incomingPayment = {
    id: 'https://ilp.interledger-test.dev/incoming-payments/merchant-order',
    incomingAmount: { value: '1025', assetCode: 'USD', assetScale: 2 },
    receivedAmount: { value: '0', assetCode: 'USD', assetScale: 2 },
    completed: false,
  }
  const quote = {
    id: 'https://ilp.interledger-test.dev/quotes/order',
    debitAmount: { value: '1030', assetCode: 'USD', assetScale: 2 },
    expiresAt: '2027-01-01T00:00:00.000Z',
  }
  const pendingGrant = {
    interact: {
      redirect: 'https://auth.interledger-test.dev/authorize/order?clientName=Monsso',
      finish: 'server-nonce',
    },
    continue: {
      uri: 'https://auth.interledger-test.dev/continue/order',
      access_token: { value: 'continuation-token' },
    },
  }
  const calls = { grants: [], outgoingPayments: 0 }
  const client = {
    walletAddress: {
      get: async ({ url }) => ({
        id: url,
        assetCode: 'USD',
        assetScale: 2,
        authServer: 'https://auth.interledger-test.dev',
        resourceServer: 'https://ilp.interledger-test.dev',
      }),
    },
    grant: {
      request: async (args, body) => {
        calls.grants.push(body)
        return calls.grants.length === 3
          ? pendingGrant
          : { access_token: { value: `grant-token-${calls.grants.length}` } }
      },
      continue: async () => ({ access_token: { value: 'outgoing-token' } }),
    },
    incomingPayment: {
      create: async () => incomingPayment,
      get: async () => incomingPayment,
    },
    quote: {
      create: async () => quote,
    },
    outgoingPayment: {
      create: async () => {
        calls.outgoingPayments += 1
        return { id: 'https://ilp.interledger-test.dev/outgoing-payments/one', failed: false }
      },
    },
  }
  const payments = createAsyncPaymentStore()
  const service = createOpenPaymentsService({
    client,
    merchantWalletAddress: 'https://ilp.interledger-test.dev/merchant',
    appOrigin: 'http://localhost:5173',
    payments,
  })

  const checkout = await service.startCheckout({
    amount: '10.25',
    payerWalletAddress: 'https://ilp.interledger-test.dev/payer',
  })

  assert.equal(checkout.incomingAmount.value, '1025')
  assert.equal(checkout.debitAmount.value, '1030')
  assert.match(checkout.redirectUrl, /^https:\/\/auth\.interledger-test\.dev\//)
  assert.equal('continueAccessToken' in checkout, false)
  assert.equal(calls.grants[2].access_token.access[0].limits.receiver, incomingPayment.id)

  const payment = await payments.get(checkout.state)
  const interactRef = 'approved-reference'
  const hash = createHash('sha256')
    .update(
      `${payment.clientNonce}\n${payment.authorizationServerNonce}\n${interactRef}\n${payment.grantUri}`,
      'ascii',
    )
    .digest('base64url')

  const callbackService = createOpenPaymentsService({
    client,
    merchantWalletAddress: 'https://ilp.interledger-test.dev/merchant',
    appOrigin: 'http://localhost:5173',
    payments,
  })
  const callback = {
    state: checkout.state,
    hash,
    interactRef,
  }
  const attempts = await Promise.allSettled([
    callbackService.finishCheckout(callback),
    service.finishCheckout(callback),
  ])
  const finishedAttempt = attempts.find((attempt) => attempt.status === 'fulfilled')
  const rejectedAttempt = attempts.find((attempt) => attempt.status === 'rejected')
  assert.ok(finishedAttempt)
  assert.ok(rejectedAttempt)
  assert.equal(rejectedAttempt.reason.statusCode, 409)
  const finished = finishedAttempt.value
  const repeated = await service.finishCheckout({
    state: checkout.state,
    hash,
    interactRef,
  })

  assert.equal(finished.status, 'submitted')
  assert.equal(repeated.outgoingPaymentId, finished.outgoingPaymentId)
  assert.equal(calls.outgoingPayments, 1)
})
