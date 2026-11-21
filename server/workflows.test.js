import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createOpenPaymentsWorkflowService } from './workflows.js'

const ownerEmail = 'merchant@example.test'
const payerAddress = 'https://ilp.interledger-test.dev/payer'
const merchantAddress = 'https://ilp.interledger-test.dev/merchant'

function createWorkflowFixture({
  quoteExpiresAt = new Date(Date.now() + 60_000).toISOString(),
  walletCurrencies = {},
} = {}) {
  function createStore(records) {
    return {
      get: (id) => structuredClone(records.get(id)),
      set: (id, value) => records.set(id, structuredClone(value)),
    }
  }

  const pendingPayments = createStore(new Map())
  const workflows = createStore(new Map())
  const incomingPayments = new Map()
  const quotes = new Map()
  const grantRequests = []
  let spent = 0n
  let incomingCount = 0
  let quoteCount = 0
  let outgoingCount = 0

  const client = {
    walletAddress: {
      get: async ({ url }) => {
        const id = url === 'https://alias.interledger-test.dev/merchant'
          ? merchantAddress
          : url
        const currency = walletCurrencies[id] ?? { assetCode: 'USD', assetScale: 2 }
        return {
          id,
          assetCode: currency.assetCode,
          assetScale: currency.assetScale,
          authServer: 'https://auth.interledger-test.dev',
          resourceServer: 'https://ilp.interledger-test.dev/op',
        }
      },
    },
    grant: {
      request: async (args, body) => {
        grantRequests.push(body)
        if (body.interact) {
          return {
            interact: {
              redirect: 'https://auth.interledger-test.dev/authorize?grant=demo',
              finish: 'server-nonce',
            },
            continue: {
              uri: 'https://auth.interledger-test.dev/continue/demo',
              access_token: { value: 'continue-token' },
            },
          }
        }
        return {
          access_token: {
            value: `access-token-${grantRequests.length}`,
            manage: `https://auth.interledger-test.dev/token/${grantRequests.length}`,
            expires_in: 3600,
          },
        }
      },
      continue: async () => ({
        access_token: {
          value: 'recurring-access-token',
          manage: 'https://auth.interledger-test.dev/token/recurring',
          expires_in: 3600,
        },
      }),
    },
    incomingPayment: {
      create: async (request, body) => {
        incomingCount += 1
        const incoming = {
          id: `https://ilp.interledger-test.dev/incoming/${incomingCount}`,
          walletAddress: body.walletAddress,
          incomingAmount: body.incomingAmount,
          receivedAmount: { ...body.incomingAmount, value: '0' },
          metadata: body.metadata,
          completed: false,
        }
        incomingPayments.set(incoming.id, incoming)
        return incoming
      },
      get: async ({ url }) => incomingPayments.get(url),
    },
    quote: {
      create: async (request, body) => {
        quoteCount += 1
        const incoming = incomingPayments.get(body.receiver)
        const received = BigInt(incoming.incomingAmount.value)
        const ratePercent = incoming.incomingAmount.assetCode === 'EUR' ? 120n : 105n
        const debit = (received * ratePercent + 99n) / 100n
        const quote = {
          id: `https://ilp.interledger-test.dev/quotes/${quoteCount}`,
          receiver: body.receiver,
          debitAmount: {
            value: debit.toString(),
            assetCode: 'USD',
            assetScale: 2,
          },
          expiresAt: quoteExpiresAt,
        }
        quotes.set(quote.id, quote)
        return quote
      },
    },
    outgoingPayment: {
      create: async (request, body) => {
        outgoingCount += 1
        const quote = quotes.get(body.quoteId)
        const incoming = incomingPayments.get(quote.receiver)
        spent += BigInt(quote.debitAmount.value)
        incoming.receivedAmount = { ...incoming.incomingAmount }
        incoming.completed = true
        return {
          id: `https://ilp.interledger-test.dev/outgoing/${outgoingCount}`,
          failed: false,
          debitAmount: quote.debitAmount,
          metadata: body.metadata,
        }
      },
      getGrantSpentAmounts: async () => ({
        spentDebitAmount: { value: spent.toString(), assetCode: 'USD', assetScale: 2 },
        spentReceiveAmount: { value: '0', assetCode: 'USD', assetScale: 2 },
      }),
    },
    token: {
      rotate: async () => {
        throw new Error('Unexpected token rotation in this test.')
      },
    },
  }

  const service = createOpenPaymentsWorkflowService({
    client,
    merchantWalletAddress: merchantAddress,
    appOrigin: 'https://monsso.example',
    payments: pendingPayments,
    workflows,
  })

  return {
    service,
    client,
    pendingPayments,
    workflows,
    grantRequests,
    getOutgoingCount: () => outgoingCount,
  }
}

async function finishAuthorization(fixture, state, method) {
  const pending = fixture.pendingPayments.get(state)
  const interactRef = 'approved-interaction'
  const hash = createHash('sha256')
    .update(
      `${pending.clientNonce}\n${pending.authorizationServerNonce}\n${interactRef}\n${pending.grantUri}`,
      'ascii',
    )
    .digest('base64url')
  return fixture.service[method]({ ownerEmail, state, hash, interactRef })
}

const recurringMetadata = {
  description: 'Monthly software usage',
  invoiceReference: 'INV-1001',
  orderReference: 'SUB-1001',
  lineItems: [{
    description: 'Base usage',
    quantity: 1,
    unitAmount: '5.00',
  }],
}

test('creates a bounded variable recurring grant and charges within its remaining interval budget', async () => {
  const fixture = createWorkflowFixture()
  const started = await fixture.service.startRecurring({
    ownerEmail,
    payerWalletAddress: payerAddress,
    maxPerInterval: '15.00',
    initialChargeAmount: '5.00',
    intervalCount: 3,
    metadata: recurringMetadata,
  })

  const outgoingGrant = fixture.grantRequests.find((request) => request.interact)
  const outgoingAccess = outgoingGrant.access_token.access[0]
  assert.equal(outgoingAccess.type, 'outgoing-payment')
  assert.equal(outgoingAccess.limits.debitAmount.value, '1500')
  assert.match(outgoingAccess.limits.interval, /^R3\/.+\/P1M$/)
  assert.equal('receiver' in outgoingAccess.limits, false)
  assert.equal(fixture.pendingPayments.get(started.state).metadata.invoiceReference, 'INV-1001')

  const active = await finishAuthorization(fixture, started.state, 'finishRecurring')
  assert.equal(active.kind, 'recurring')
  assert.equal(active.status, 'active')
  assert.equal(active.payments.length, 1)
  assert.equal(active.payments[0].status, 'completed')
  assert.equal(active.spentDebitAmount.value, '525')

  const charged = await fixture.service.chargeRecurring({
    ownerEmail,
    id: active.id,
    amount: '4.00',
    metadata: {
      description: 'Usage adjustment',
      invoiceReference: 'INV-1002',
      orderReference: 'SUB-1001',
      lineItems: [{
        description: 'Additional usage',
        quantity: 2,
        unitAmount: '2.00',
      }],
    },
  })

  assert.equal(charged.spentDebitAmount.value, '945')
  assert.equal(charged.remainingDebitAmount.value, '555')
  assert.equal(charged.payments.length, 2)
  assert.equal(charged.payments[1].metadata.invoiceReference, 'INV-1002')
  assert.equal(fixture.getOutgoingCount(), 2)
})

test('refuses a recurring charge that would exceed the payer-approved interval cap', async () => {
  const fixture = createWorkflowFixture()
  const started = await fixture.service.startRecurring({
    ownerEmail,
    payerWalletAddress: payerAddress,
    maxPerInterval: '15.00',
    initialChargeAmount: '5.00',
    intervalCount: 3,
    metadata: recurringMetadata,
  })
  const active = await finishAuthorization(fixture, started.state, 'finishRecurring')
  const outgoingCountBefore = fixture.getOutgoingCount()

  await assert.rejects(
    fixture.service.chargeRecurring({
      ownerEmail,
      id: active.id,
      amount: '10.00',
      metadata: { description: 'Over-limit test charge' },
    }),
    /exceed the remaining recurring-grant limit/,
  )
  assert.equal(fixture.getOutgoingCount(), outgoingCountBefore)
})

test('persists a rotated recurring token even when the following status call fails', async () => {
  const fixture = createWorkflowFixture()
  const started = await fixture.service.startRecurring({
    ownerEmail,
    payerWalletAddress: payerAddress,
    maxPerInterval: '15.00',
    initialChargeAmount: '5.00',
    intervalCount: 3,
    metadata: recurringMetadata,
  })
  const active = await finishAuthorization(fixture, started.state, 'finishRecurring')
  const workflow = await fixture.workflows.get(active.id)
  workflow.outgoingToken.expiresAt = Date.now() - 1
  await fixture.workflows.set(active.id, workflow)
  fixture.client.token.rotate = async () => ({
    access_token: {
      value: 'rotated-recurring-token',
      manage: 'https://auth.interledger-test.dev/token/rotated',
      expires_in: 3600,
    },
  })
  fixture.client.outgoingPayment.getGrantSpentAmounts = async () => {
    throw new Error('Temporary payer status failure.')
  }

  await assert.rejects(
    fixture.service.getRecurring(active.id, ownerEmail),
    /Temporary payer status failure/,
  )
  assert.equal(
    (await fixture.workflows.get(active.id)).outgoingToken.value,
    'rotated-recurring-token',
  )
})

test('splits one authorized checkout into two exact recipient allocations with metadata', async () => {
  const fixture = createWorkflowFixture()
  const started = await fixture.service.startSplit({
    ownerEmail,
    payerWalletAddress: payerAddress,
    recipients: [
      { walletAddress: merchantAddress, amount: '7.50' },
      { walletAddress: 'https://wallet.interledger-test.dev/partner', amount: '2.51' },
    ],
    metadata: {
      description: 'Marketplace order',
      invoiceReference: 'INV-SPLIT-1',
      orderReference: 'ORDER-1',
      lineItems: [{
        description: 'Marketplace item',
        quantity: 1,
        unitAmount: '10.01',
      }],
    },
  })
  assert.deepEqual(started.allocations.map(({ incomingAmount }) => incomingAmount.value), ['750', '251'])
  assert.equal(started.maxDebitAmount.value, '1052')

  const outgoingGrant = fixture.grantRequests.find((request) => request.interact)
  assert.equal(outgoingGrant.access_token.access[0].limits.debitAmount.value, '1052')
  assert.equal('receiver' in outgoingGrant.access_token.access[0].limits, false)

  const result = await finishAuthorization(fixture, started.state, 'finishSplit')
  assert.equal(result.kind, 'split')
  assert.equal(result.status, 'completed')
  assert.equal(result.recipients.length, 2)
  assert.deepEqual(result.recipients.map(({ status }) => status), ['completed', 'completed'])
  assert.deepEqual(
    result.recipients.map(({ incomingAmount }) => incomingAmount.value),
    ['750', '251'],
  )
  assert.equal(fixture.getOutgoingCount(), 2)
})

test('quotes mixed-currency recipient amounts into the payer currency', async () => {
  const partnerAddress = 'https://wallet.interledger-test.dev/euro-partner'
  const fixture = createWorkflowFixture({
    walletCurrencies: {
      [partnerAddress]: { assetCode: 'EUR', assetScale: 2 },
    },
  })
  const started = await fixture.service.startSplit({
    ownerEmail,
    payerWalletAddress: payerAddress,
    recipients: [
      { walletAddress: merchantAddress, amount: '10.00' },
      { walletAddress: partnerAddress, amount: '8.00' },
    ],
    metadata: { description: 'Mixed-currency order' },
  })

  assert.deepEqual(
    started.allocations.map(({ incomingAmount }) => (
      [incomingAmount.value, incomingAmount.assetCode]
    )),
    [['1000', 'USD'], ['800', 'EUR']],
  )
  assert.deepEqual(
    started.allocations.map(({ debitAmount }) => (
      [debitAmount.value, debitAmount.assetCode]
    )),
    [['1050', 'USD'], ['960', 'USD']],
  )
  assert.deepEqual(started.maxDebitAmount, {
    value: '2010',
    assetCode: 'USD',
    assetScale: 2,
  })

  const result = await finishAuthorization(fixture, started.state, 'finishSplit')
  assert.deepEqual(
    result.recipients.map(({ incomingAmount, debitAmount }) => (
      [incomingAmount.assetCode, debitAmount.assetCode]
    )),
    [['USD', 'USD'], ['EUR', 'USD']],
  )
})

test('rejects invalid recipient amounts before creating wallet resources', async () => {
  const fixture = createWorkflowFixture()
  await assert.rejects(
    fixture.service.startSplit({
      ownerEmail,
      payerWalletAddress: payerAddress,
      recipients: [
        { walletAddress: merchantAddress, amount: '0' },
        { walletAddress: 'https://wallet.interledger-test.dev/partner', amount: '10.00' },
      ],
      metadata: { description: 'Invalid recipient amount' },
    }),
    /must be greater than zero/,
  )
  assert.equal(fixture.grantRequests.length, 0)
})

test('rejects aliases that resolve both split recipients to the same wallet', async () => {
  const fixture = createWorkflowFixture()
  await assert.rejects(
    fixture.service.startSplit({
      ownerEmail,
      payerWalletAddress: payerAddress,
      recipients: [
        { walletAddress: merchantAddress, amount: '6.00' },
        { walletAddress: 'https://alias.interledger-test.dev/merchant', amount: '4.00' },
      ],
      metadata: { description: 'Duplicate recipient test' },
    }),
    /two different test-wallet recipients/,
  )
})

test('requires a single currency for split line-item metadata', async () => {
  const partnerAddress = 'https://wallet.interledger-test.dev/euro-partner'
  const fixture = createWorkflowFixture({
    walletCurrencies: {
      [partnerAddress]: { assetCode: 'EUR', assetScale: 2 },
    },
  })

  await assert.rejects(
    fixture.service.startSplit({
      ownerEmail,
      payerWalletAddress: payerAddress,
      recipients: [
        { walletAddress: merchantAddress, amount: '10.00' },
        { walletAddress: partnerAddress, amount: '8.00' },
      ],
      metadata: {
        description: 'Mixed-currency order',
        lineItems: [{ description: 'Item', quantity: 1, unitAmount: '18.00' }],
      },
    }),
    /Omit line items for a mixed-currency split/,
  )
  assert.equal(fixture.grantRequests.length, 0)
})

test('rejects line-item metadata whose total differs from the payment amount', async () => {
  const fixture = createWorkflowFixture()
  await assert.rejects(
    fixture.service.startRecurring({
      ownerEmail,
      payerWalletAddress: payerAddress,
      maxPerInterval: '15.00',
      initialChargeAmount: '5.00',
      intervalCount: 3,
      metadata: {
        description: 'Incorrect metadata',
        lineItems: [{
          description: 'Wrong total',
          quantity: 1,
          unitAmount: '4.00',
        }],
      },
    }),
    /line-item totals must match/,
  )
  assert.equal(fixture.grantRequests.length, 0)
})

test('rejects recurring authorization after its initial quote expires', async () => {
  const fixture = createWorkflowFixture({
    quoteExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  })
  const started = await fixture.service.startRecurring({
    ownerEmail,
    payerWalletAddress: payerAddress,
    maxPerInterval: '15.00',
    initialChargeAmount: '5.00',
    intervalCount: 3,
    metadata: recurringMetadata,
  })

  await assert.rejects(
    finishAuthorization(fixture, started.state, 'finishRecurring'),
    /initial quote has expired/,
  )
  assert.equal(fixture.getOutgoingCount(), 0)
})

test('rejects split authorization after its quotes expire', async () => {
  const fixture = createWorkflowFixture({
    quoteExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  })
  const started = await fixture.service.startSplit({
    ownerEmail,
    payerWalletAddress: payerAddress,
    recipients: [
      { walletAddress: merchantAddress, amount: '6.00' },
      { walletAddress: 'https://wallet.interledger-test.dev/partner', amount: '4.00' },
    ],
    metadata: { description: 'Marketplace order' },
  })

  await assert.rejects(
    finishAuthorization(fixture, started.state, 'finishSplit'),
    /split quote has expired/,
  )
  assert.equal(fixture.getOutgoingCount(), 0)
})
