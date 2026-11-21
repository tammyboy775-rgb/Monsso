import { randomUUID } from 'node:crypto'
import {
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
} from '@interledger/open-payments'
import {
  amountToMinorUnits,
  isTestnetWalletAddress,
  PaymentError,
  verifyInteractionHash,
} from './payments.js'

const pendingWorkflowTtlMs = 15 * 60 * 1000
const recurringWorkflowTtlSeconds = 400 * 24 * 60 * 60
const maxMetadataBytes = 4096

function assertWalletDetails(wallet) {
  if (
    !isTestnetWalletAddress(wallet.id) ||
    !isTestnetWalletAddress(wallet.authServer) ||
    !isTestnetWalletAddress(wallet.resourceServer) ||
    typeof wallet.assetCode !== 'string' ||
    !Number.isInteger(wallet.assetScale) ||
    wallet.assetScale < 0 ||
    wallet.assetScale > 18
  ) {
    throw new PaymentError('The wallet returned invalid test-network details.', 502)
  }
}

function isTestnetAuthorizationUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.hostname === 'interledger-test.dev' ||
        url.hostname.endsWith('.interledger-test.dev'))
  } catch {
    return false
  }
}

function requireOwner(ownerEmail) {
  if (typeof ownerEmail !== 'string' || ownerEmail.length > 254 || !ownerEmail.includes('@')) {
    throw new PaymentError('Sign in to Monsso before using payment workflows.', 401)
  }
  return ownerEmail.toLowerCase()
}

function normalizeMetadata(input, amount, assetScale) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PaymentError('Provide metadata as a JSON object.')
  }

  const description = typeof input.description === 'string'
    ? input.description.trim()
    : ''
  if (!description || description.length > 200) {
    throw new PaymentError('Metadata description must be between 1 and 200 characters.')
  }

  const metadata = { description }
  for (const key of ['invoiceReference', 'orderReference']) {
    const value = input[key]
    if (value !== undefined && value !== '') {
      if (typeof value !== 'string' || value.length > 100) {
        throw new PaymentError(`${key} must be 100 characters or fewer.`)
      }
      metadata[key] = value
    }
  }

  const lineItems = input.lineItems ?? []
  if (!Array.isArray(lineItems) || lineItems.length > 20) {
    throw new PaymentError('Metadata can include up to 20 line items.')
  }

  if (lineItems.length) {
    const total = lineItems.reduce((sum, item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new PaymentError('Each line item must be a JSON object.')
      }
      if (
        typeof item.description !== 'string' ||
        item.description.trim().length === 0 ||
        item.description.length > 160 ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 10000
      ) {
        throw new PaymentError('Each line item needs a short description and a quantity from 1 to 10000.')
      }

      const unitAmount = amountToMinorUnits(item.unitAmount, assetScale)
      if (item.reference !== undefined && (
        typeof item.reference !== 'string' || item.reference.length > 80
      )) {
        throw new PaymentError('Line-item references must be 80 characters or fewer.')
      }

      return sum + BigInt(unitAmount) * BigInt(item.quantity)
    }, 0n)

    if (total !== BigInt(amountToMinorUnits(amount, assetScale))) {
      throw new PaymentError('Metadata line-item totals must match the payment amount.')
    }

    metadata.lineItems = lineItems.map((item) => ({
      ...(item.reference ? { reference: item.reference } : {}),
      description: item.description.trim(),
      quantity: item.quantity,
      unitAmount: item.unitAmount,
    }))
  }

  if (Buffer.byteLength(JSON.stringify(metadata)) > maxMetadataBytes) {
    throw new PaymentError('Payment metadata is too large.')
  }
  return metadata
}

function amount(value, wallet) {
  return {
    value: amountToMinorUnits(value, wallet.assetScale),
    assetCode: wallet.assetCode,
    assetScale: wallet.assetScale,
  }
}

function amountFromMinorUnits(value, assetScale) {
  const digits = value.toString().padStart(assetScale + 1, '0')
  return assetScale
    ? `${digits.slice(0, -assetScale)}.${digits.slice(-assetScale)}`
    : digits
}

function sumAmounts(amounts) {
  const first = amounts[0]
  if (amounts.some((value) => (
    value.assetCode !== first.assetCode || value.assetScale !== first.assetScale
  ))) {
    throw new PaymentError('The wallets returned incompatible quote currencies.', 502)
  }
  return {
    value: amounts.reduce((sum, value) => sum + BigInt(value.value), 0n).toString(),
    assetCode: first.assetCode,
    assetScale: first.assetScale,
  }
}

function tokenState(accessToken, now) {
  return {
    value: accessToken.value,
    manage: accessToken.manage ?? null,
    expiresAt: typeof accessToken.expires_in === 'number'
      ? now() + accessToken.expires_in * 1000
      : now() + 10 * 60 * 1000,
  }
}

function quoteHasExpired(expiresAt, now) {
  return typeof expiresAt === 'string' && Date.parse(expiresAt) <= now()
}

async function tokenValue(client, token, now) {
  if (!token.value) throw new PaymentError('A required wallet authorization token is missing.', 502)
  if (token.expiresAt > now() + 30_000) return token.value
  if (!token.manage) {
    throw new PaymentError('A wallet authorization expired and cannot be renewed. Re-authorize the workflow.', 401)
  }

  const rotated = await client.token.rotate({ url: token.manage, accessToken: token.value })
  token.value = rotated.access_token.value
  token.manage = rotated.access_token.manage ?? token.manage
  token.expiresAt = now() + (rotated.access_token.expires_in ?? 600) * 1000
  return token.value
}

async function tokenValueWithPersistence(client, token, now, persist) {
  const previous = token.value
  const value = await tokenValue(client, token, now)
  if (token.value !== previous) await persist()
  return value
}

async function createIncoming(client, wallet, amountValue, metadata) {
  const grant = await client.grant.request(
    { url: wallet.authServer },
    {
      access_token: {
        access: [{ type: 'incoming-payment', actions: ['create', 'read'] }],
      },
    },
  )
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new PaymentError('The receiving wallet did not approve its incoming-payment grant.', 502)
  }

  const incoming = await client.incomingPayment.create(
    { url: wallet.resourceServer, accessToken: grant.access_token.value },
    { walletAddress: wallet.id, incomingAmount: amountValue, metadata },
  )
  return { incoming, accessToken: tokenState(grant.access_token, Date.now) }
}

async function createQuote(client, payer) {
  const grant = await client.grant.request(
    { url: payer.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create'] }] } },
  )
  if (!isFinalizedGrantWithAccessToken(grant)) {
    throw new PaymentError('The payer wallet did not approve its quote grant.', 502)
  }
  return grant.access_token.value
}

function buildFinishUrl(appOrigin, state, workflow) {
  const finishUrl = new URL('/automation/finish', appOrigin)
  finishUrl.searchParams.set('state', state)
  finishUrl.searchParams.set('workflow', workflow)
  return finishUrl.href
}

function assertInteraction(payment, { hash, interactRef }) {
  if (!verifyInteractionHash({
    clientNonce: payment.clientNonce,
    authorizationServerNonce: payment.authorizationServerNonce,
    interactRef,
    grantUri: payment.grantUri,
    receivedHash: hash,
  })) {
    throw new PaymentError('The wallet authorization could not be verified.', 400)
  }
}

function requireWorkflowOwner(workflow, ownerEmail) {
  if (!workflow) throw new PaymentError('This workflow was not found or has expired.', 404)
  if (workflow.ownerEmail !== requireOwner(ownerEmail)) {
    throw new PaymentError('This workflow belongs to another Monsso account.', 403)
  }
}

function publicRecurringStatus(workflow, spent) {
  const max = BigInt(workflow.maxPerInterval.value)
  const used = BigInt(spent.value)
  return {
    id: workflow.id,
    kind: 'recurring',
    status: workflow.status,
    interval: workflow.interval,
    intervalCount: workflow.intervalCount,
    maxPerInterval: workflow.maxPerInterval,
    spentDebitAmount: { ...workflow.maxPerInterval, value: used.toString() },
    remainingDebitAmount: {
      ...workflow.maxPerInterval,
      value: (max > used ? max - used : 0n).toString(),
    },
    payments: workflow.payments.map(({
      id,
      amount: paymentAmount,
      status,
      metadata,
      receivedAmount,
    }) => ({
      id,
      amount: paymentAmount,
      status,
      metadata,
      receivedAmount,
    })),
  }
}

export function createOpenPaymentsWorkflowService({
  client,
  merchantWalletAddress,
  appOrigin,
  payments,
  workflows,
  now = Date.now,
}) {
  async function getWallet(walletAddress) {
    if (!isTestnetWalletAddress(walletAddress)) {
      throw new PaymentError('Enter an HTTPS wallet address on the Interledger test network.')
    }
    const wallet = await client.walletAddress.get({ url: walletAddress })
    assertWalletDetails(wallet)
    return wallet
  }

  async function finishAccessToken(pending, interaction) {
    assertInteraction(pending, interaction)
    if (pending.finalAccessToken) return pending.finalAccessToken

    const grant = await client.grant.continue(
      { url: pending.continueUri, accessToken: pending.continueAccessToken },
      { interact_ref: interaction.interactRef },
    )
    if (!isFinalizedGrantWithAccessToken(grant)) {
      throw new PaymentError('The payer wallet did not finalize the outgoing-payment grant.', 502)
    }
    pending.finalAccessToken = grant.access_token.value
    pending.finalManageUrl = grant.access_token.manage ?? null
    pending.finalTokenExpiresAt = now() + (grant.access_token.expires_in ?? 600) * 1000
    return pending.finalAccessToken
  }

  async function claimFinish(pending) {
    if (pending.finishCompleted) return false
    if (typeof payments.claimFinish === 'function') {
      if (!await payments.claimFinish(pending.state, Math.max(
        1,
        Math.ceil((pending.expiresAt - now()) / 1000),
      ))) {
        throw new PaymentError('This workflow authorization is already being processed.', 409)
      }
    } else if (pending.finishAttempted) {
      throw new PaymentError('This workflow authorization is already being processed.', 409)
    }
    pending.finishAttempted = true
    await payments.set(pending.state, pending, {
      ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)),
    })
    return true
  }

  async function releaseFinish(pending) {
    pending.finishAttempted = false
    await payments.set(pending.state, pending, {
      ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)),
    })
    if (typeof payments.releaseFinish === 'function') {
      await payments.releaseFinish(pending.state)
    }
  }

  async function startRecurring({
    ownerEmail,
    payerWalletAddress,
    maxPerInterval: maxValue,
    initialChargeAmount,
    intervalCount,
    metadata: inputMetadata,
  }) {
    const owner = requireOwner(ownerEmail)
    if (!Number.isInteger(intervalCount) || intervalCount < 2 || intervalCount > 12) {
      throw new PaymentError('Choose between 2 and 12 monthly periods.')
    }

    const [merchant, payer] = await Promise.all([
      getWallet(merchantWalletAddress),
      getWallet(payerWalletAddress),
    ])
    const chargeAmount = amount(initialChargeAmount, merchant)
    const metadata = normalizeMetadata(inputMetadata, initialChargeAmount, merchant.assetScale)
    const maximum = amount(maxValue, payer)
    const { incoming, accessToken: incomingToken } = await createIncoming(
      client,
      merchant,
      chargeAmount,
      { ...metadata, workflow: 'variable-recurring-payment', period: 1 },
    )

    const quoteToken = await createQuote(client, payer)
    const quote = await client.quote.create(
      { url: payer.resourceServer, accessToken: quoteToken },
      { method: 'ilp', walletAddress: payer.id, receiver: incoming.id },
    )
    if (
      quote.debitAmount.assetCode !== payer.assetCode ||
      quote.debitAmount.assetScale !== payer.assetScale ||
      BigInt(quote.debitAmount.value) > BigInt(maximum.value)
    ) {
      throw new PaymentError('The first charge exceeds the payer’s per-month limit.')
    }

    const state = randomUUID()
    const interval = `R${intervalCount}/${new Date(now()).toISOString()}/P1M`
    const clientNonce = randomUUID()
    const pendingGrant = await client.grant.request(
      { url: payer.authServer },
      {
        access_token: {
          access: [{
            type: 'outgoing-payment',
            actions: ['create', 'read'],
            identifier: payer.id,
            limits: { debitAmount: maximum, interval },
          }],
        },
        interact: {
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri: buildFinishUrl(appOrigin, state, 'recurring'),
            nonce: clientNonce,
          },
        },
      },
    )
    if (!isPendingGrant(pendingGrant)) {
      throw new PaymentError('The payer wallet did not begin recurring-grant authorization.', 502)
    }
    if (!isTestnetAuthorizationUrl(pendingGrant.interact.redirect)) {
      throw new PaymentError('The wallet returned an unsupported authorization URL.', 502)
    }

    const pending = {
      state,
      kind: 'recurring',
      ownerEmail: owner,
      expiresAt: now() + pendingWorkflowTtlMs,
      status: 'awaiting_authorization',
      merchantWalletAddress: merchant.id,
      merchantResourceServer: merchant.resourceServer,
      payerWalletAddress: payer.id,
      payerResourceServer: payer.resourceServer,
      payerAssetCode: payer.assetCode,
      payerAssetScale: payer.assetScale,
      initialIncomingPaymentId: incoming.id,
      incomingToken,
      quoteId: quote.id,
      quoteExpiresAt: quote.expiresAt,
      initialChargeAmount: chargeAmount,
      initialDebitAmount: quote.debitAmount,
      maxPerInterval: maximum,
      interval,
      intervalCount,
      metadata,
      clientNonce,
      authorizationServerNonce: pendingGrant.interact.finish,
      grantUri: payer.authServer,
      continueUri: pendingGrant.continue.uri,
      continueAccessToken: pendingGrant.continue.access_token.value,
      finishAttempted: false,
      payments: [],
    }
    await payments.set(state, pending, { ex: Math.ceil(pendingWorkflowTtlMs / 1000) })

    return {
      state,
      redirectUrl: pendingGrant.interact.redirect,
      maxPerInterval: maximum,
      initialChargeAmount: chargeAmount,
      initialDebitAmount: quote.debitAmount,
      interval,
      intervalCount,
    }
  }

  async function finishRecurring({ ownerEmail, state, hash, interactRef }) {
    const owner = requireOwner(ownerEmail)
    const pending = await payments.get(state)
    if (!pending || pending.kind !== 'recurring') {
      throw new PaymentError('This recurring authorization has expired. Start a new workflow.', 410)
    }
    if (pending.ownerEmail !== owner) throw new PaymentError('This workflow belongs to another Monsso account.', 403)
    if (pending.expiresAt <= now()) throw new PaymentError('This recurring authorization has expired.', 410)
    if (quoteHasExpired(pending.quoteExpiresAt, now)) {
      throw new PaymentError('The initial quote has expired. Start a new recurring workflow.', 410)
    }

    const claimed = await claimFinish(pending)
    if (!claimed) {
      const existing = await workflows.get(state)
      if (existing) return getRecurring(state, owner)
    }

    try {
      const value = await finishAccessToken(pending, { hash, interactRef })
      await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })

      if (!pending.initialOutgoingPaymentId) {
        const outgoing = await client.outgoingPayment.create(
          { url: pending.payerResourceServer, accessToken: value },
          {
            walletAddress: pending.payerWalletAddress,
            quoteId: pending.quoteId,
            metadata: {
              ...pending.metadata,
              workflow: 'variable-recurring-payment',
              period: 1,
            },
          },
        )
        pending.initialOutgoingPaymentId = outgoing.id
        pending.status = outgoing.failed ? 'failed' : 'active'
        pending.payments.push({
          id: outgoing.id,
          amount: outgoing.debitAmount ?? pending.initialDebitAmount,
          status: outgoing.failed ? 'failed' : 'submitted',
          metadata: { ...pending.metadata, workflow: 'variable-recurring-payment', period: 1 },
          incomingPaymentId: pending.initialIncomingPaymentId,
        })
        await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })
      }

      const workflow = {
        id: state,
        kind: 'recurring',
        ownerEmail: owner,
        status: pending.status,
        merchantWalletAddress: pending.merchantWalletAddress,
        merchantResourceServer: pending.merchantResourceServer,
        payerWalletAddress: pending.payerWalletAddress,
        payerResourceServer: pending.payerResourceServer,
        payerAssetCode: pending.payerAssetCode,
        payerAssetScale: pending.payerAssetScale,
        maxPerInterval: pending.maxPerInterval,
        interval: pending.interval,
        intervalCount: pending.intervalCount,
        startAt: pending.interval.split('/')[1],
        expiresAt: now() + recurringWorkflowTtlSeconds * 1000,
        outgoingToken: {
          value: pending.finalAccessToken,
          manage: pending.finalManageUrl,
          expiresAt: pending.finalTokenExpiresAt,
        },
        incomingToken: pending.incomingToken,
        metadata: pending.metadata,
        payments: pending.payments,
      }
      await workflows.set(state, workflow, { ex: recurringWorkflowTtlSeconds })
      pending.finishCompleted = true
      pending.status = 'active'
      await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })
      return getRecurring(state, owner)
    } catch (error) {
      await releaseFinish(pending)
      throw error
    }
  }

  async function getRecurring(id, ownerEmail) {
    const owner = requireOwner(ownerEmail)
    const workflow = await workflows.get(id)
    requireWorkflowOwner(workflow, owner)
    const accessToken = await tokenValueWithPersistence(
      client,
      workflow.outgoingToken,
      now,
      () => workflows.set(id, workflow, { ex: recurringWorkflowTtlSeconds }),
    )
    const spent = await client.outgoingPayment.getGrantSpentAmounts({
      url: workflow.payerResourceServer,
      accessToken,
    })
    const incomingToken = await tokenValueWithPersistence(
      client,
      workflow.incomingToken,
      now,
      () => workflows.set(id, workflow, { ex: recurringWorkflowTtlSeconds }),
    )
    for (const payment of workflow.payments) {
      if (payment.status === 'failed') continue
      const incoming = await client.incomingPayment.get({
        url: payment.incomingPaymentId,
        accessToken: incomingToken,
      })
      payment.receivedAmount = incoming.receivedAmount
      if (incoming.completed) payment.status = 'completed'
    }
    await workflows.set(id, workflow, { ex: recurringWorkflowTtlSeconds })
    return publicRecurringStatus(workflow, spent.spentDebitAmount)
  }

  async function chargeRecurring({ ownerEmail, id, amount: chargeValue, metadata: inputMetadata }) {
    const owner = requireOwner(ownerEmail)
    const workflow = await workflows.get(id)
    requireWorkflowOwner(workflow, owner)
    if (workflow.status !== 'active') throw new PaymentError('This recurring workflow is not active.', 409)
    if (workflow.payments.length >= 20) {
      throw new PaymentError('This demo plan has reached its 20-charge limit.', 409)
    }

    if (typeof workflows.claimCharge === 'function' && !await workflows.claimCharge(id, 90)) {
      throw new PaymentError('Another installment is already being processed.', 409)
    }

    try {
      const payer = await getWallet(workflow.payerWalletAddress)
      const merchant = await getWallet(workflow.merchantWalletAddress)
      const receiveAmount = amount(chargeValue, merchant)
      const metadata = normalizeMetadata(inputMetadata, chargeValue, merchant.assetScale)
      const accessToken = await tokenValueWithPersistence(
        client,
        workflow.outgoingToken,
        now,
        () => workflows.set(id, workflow, { ex: recurringWorkflowTtlSeconds }),
      )
      const spent = await client.outgoingPayment.getGrantSpentAmounts({
        url: workflow.payerResourceServer,
        accessToken,
      })
      const remaining = BigInt(workflow.maxPerInterval.value) -
        BigInt(spent.spentDebitAmount.value)
      if (remaining <= 0n) throw new PaymentError('The recurring grant has no budget left in this interval.', 409)

      const incomingToken = await tokenValue(client, workflow.incomingToken, now)
      const incoming = await client.incomingPayment.create(
        { url: workflow.merchantResourceServer, accessToken: incomingToken },
        {
          walletAddress: workflow.merchantWalletAddress,
          incomingAmount: receiveAmount,
          metadata: { ...metadata, workflow: 'variable-recurring-payment' },
        },
      )
      const quoteToken = await createQuote(client, payer)
      const quote = await client.quote.create(
        { url: workflow.payerResourceServer, accessToken: quoteToken },
        { method: 'ilp', walletAddress: workflow.payerWalletAddress, receiver: incoming.id },
      )
      if (
        quote.debitAmount.assetCode !== workflow.maxPerInterval.assetCode ||
        quote.debitAmount.assetScale !== workflow.maxPerInterval.assetScale ||
        BigInt(quote.debitAmount.value) > remaining
      ) {
        throw new PaymentError('This charge would exceed the remaining recurring-grant limit.', 400)
      }

      const outgoing = await client.outgoingPayment.create(
        { url: workflow.payerResourceServer, accessToken },
        {
          walletAddress: workflow.payerWalletAddress,
          quoteId: quote.id,
          metadata: { ...metadata, workflow: 'variable-recurring-payment' },
        },
      )
      workflow.payments.push({
        id: outgoing.id,
        amount: outgoing.debitAmount ?? quote.debitAmount,
        status: outgoing.failed ? 'failed' : 'submitted',
        metadata: { ...metadata, workflow: 'variable-recurring-payment' },
        incomingPaymentId: incoming.id,
        receivedAmount: null,
      })
      await workflows.set(id, workflow, { ex: recurringWorkflowTtlSeconds })
      return getRecurring(id, owner)
    } finally {
      if (typeof workflows.releaseCharge === 'function') {
        await workflows.releaseCharge(id)
      }
    }
  }

  async function startSplit({
    ownerEmail,
    payerWalletAddress,
    recipients,
    metadata: inputMetadata,
  }) {
    const owner = requireOwner(ownerEmail)
    if (!Array.isArray(recipients) || recipients.length !== 2) {
      throw new PaymentError('A split checkout needs exactly two recipients.')
    }
    if (recipients.some((recipient) => (
      !recipient || typeof recipient !== 'object' || Array.isArray(recipient)
    ))) {
      throw new PaymentError('Each split recipient must be a wallet and receive-amount object.')
    }
    if (recipients.some((recipient) => (
      typeof recipient.walletAddress !== 'string' || typeof recipient.amount !== 'string'
    ))) {
      throw new PaymentError('Each split recipient must include a wallet address and receive amount.')
    }
    if (recipients[0].walletAddress === recipients[1].walletAddress) {
      throw new PaymentError('Choose two different test-wallet recipients.')
    }

    const payer = await getWallet(payerWalletAddress)
    const recipientWallets = await Promise.all(
      recipients.map(({ walletAddress }) => getWallet(walletAddress)),
    )
    if (recipientWallets[0].id === recipientWallets[1].id) {
      throw new PaymentError('Choose two different test-wallet recipients.')
    }
    const allocations = recipients.map((recipient, index) => (
      amount(recipient.amount, recipientWallets[index])
    ))
    const sameCurrency = recipientWallets.every((wallet) => (
      wallet.assetCode === recipientWallets[0].assetCode &&
      wallet.assetScale === recipientWallets[0].assetScale
    ))
    const lineItems = inputMetadata?.lineItems
    if (!sameCurrency && Array.isArray(lineItems) && lineItems.length > 0) {
      throw new PaymentError(
        'Line items require both split recipients to use the same currency. Omit line items for a mixed-currency split.',
      )
    }
    const metadataAmount = sameCurrency
      ? amountFromMinorUnits(
        allocations.reduce((sum, allocation) => sum + BigInt(allocation.value), 0n),
        recipientWallets[0].assetScale,
      )
      : null
    const metadata = normalizeMetadata(
      inputMetadata,
      metadataAmount,
      sameCurrency ? recipientWallets[0].assetScale : null,
    )

    const splitPayments = []
    for (let index = 0; index < recipientWallets.length; index += 1) {
      const wallet = recipientWallets[index]
      const allocation = allocations[index]
      const splitMetadata = {
        ...metadata,
        workflow: 'split-payout',
        split: {
          recipientIndex: index + 1,
          recipientCount: recipientWallets.length,
        },
      }
      const { incoming, accessToken } = await createIncoming(client, wallet, allocation, splitMetadata)
      splitPayments.push({
        walletAddress: wallet.id,
        resourceServer: wallet.resourceServer,
        incomingPaymentId: incoming.id,
        incomingToken: accessToken,
        incomingAmount: allocation,
        metadata: splitMetadata,
      })
    }

    const quoteToken = await createQuote(client, payer)
    for (const split of splitPayments) {
      split.quote = await client.quote.create(
        { url: payer.resourceServer, accessToken: quoteToken },
        { method: 'ilp', walletAddress: payer.id, receiver: split.incomingPaymentId },
      )
    }
    if (splitPayments.some(({ quote }) => (
      quote.debitAmount.assetCode !== payer.assetCode ||
      quote.debitAmount.assetScale !== payer.assetScale
    ))) {
      throw new PaymentError('The payer wallet returned a quote in an unexpected currency.', 502)
    }
    const maximumDebit = sumAmounts(splitPayments.map(({ quote }) => quote.debitAmount))

    const state = randomUUID()
    const clientNonce = randomUUID()
    const pendingGrant = await client.grant.request(
      { url: payer.authServer },
      {
        access_token: {
          access: [{
            type: 'outgoing-payment',
            actions: ['create', 'read'],
            identifier: payer.id,
            limits: { debitAmount: maximumDebit },
          }],
        },
        interact: {
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri: buildFinishUrl(appOrigin, state, 'split'),
            nonce: clientNonce,
          },
        },
      },
    )
    if (!isPendingGrant(pendingGrant)) {
      throw new PaymentError('The payer wallet did not begin split-payment authorization.', 502)
    }
    if (!isTestnetAuthorizationUrl(pendingGrant.interact.redirect)) {
      throw new PaymentError('The wallet returned an unsupported authorization URL.', 502)
    }

    const pending = {
      state,
      kind: 'split',
      ownerEmail: owner,
      expiresAt: now() + pendingWorkflowTtlMs,
      maxDebitAmount: maximumDebit,
      metadata,
      payerWalletAddress: payer.id,
      payerResourceServer: payer.resourceServer,
      clientNonce,
      authorizationServerNonce: pendingGrant.interact.finish,
      grantUri: payer.authServer,
      continueUri: pendingGrant.continue.uri,
      continueAccessToken: pendingGrant.continue.access_token.value,
      finalAccessToken: null,
      splits: splitPayments.map((split) => ({
        ...split,
        quoteExpiresAt: split.quote.expiresAt,
        outgoingPaymentId: null,
        status: 'awaiting_authorization',
      })),
      finishAttempted: false,
      finishCompleted: false,
    }
    await payments.set(state, pending, { ex: Math.ceil(pendingWorkflowTtlMs / 1000) })
    return {
      state,
      redirectUrl: pendingGrant.interact.redirect,
      maxDebitAmount: maximumDebit,
      allocations: splitPayments.map(({ incomingAmount, quote }) => ({
        incomingAmount,
        debitAmount: quote.debitAmount,
      })),
    }
  }

  async function finishSplit({ ownerEmail, state, hash, interactRef }) {
    const owner = requireOwner(ownerEmail)
    const pending = await payments.get(state)
    if (!pending || pending.kind !== 'split') {
      throw new PaymentError('This split checkout has expired. Start a new one.', 410)
    }
    if (pending.ownerEmail !== owner) throw new PaymentError('This workflow belongs to another Monsso account.', 403)
    if (pending.expiresAt <= now()) throw new PaymentError('This split checkout has expired.', 410)
    if (pending.splits.some((split) => (
      !split.outgoingPaymentId && quoteHasExpired(split.quoteExpiresAt, now)
    ))) {
      throw new PaymentError('A split quote has expired. Start a new split checkout.', 410)
    }

    const claimed = await claimFinish(pending)
    if (!claimed && !pending.finishCompleted) {
      throw new PaymentError('This workflow authorization is already being processed.', 409)
    }

    try {
      if (!pending.finalAccessToken) {
        await finishAccessToken(pending, { hash, interactRef })
        await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })
      }
      for (const split of pending.splits) {
        if (split.outgoingPaymentId) continue
        const outgoing = await client.outgoingPayment.create(
          { url: pending.payerResourceServer, accessToken: pending.finalAccessToken },
          {
            walletAddress: pending.payerWalletAddress,
            quoteId: split.quote.id,
            metadata: split.metadata,
          },
        )
        split.outgoingPaymentId = outgoing.id
        split.status = outgoing.failed ? 'failed' : 'submitted'
        await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })
      }
      pending.finishCompleted = true
      pending.finishAttempted = false
      await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })
      return getSplitStatus(state, owner)
    } catch (error) {
      await releaseFinish(pending)
      throw error
    }
  }

  async function getSplitStatus(state, ownerEmail) {
    const owner = requireOwner(ownerEmail)
    const pending = await payments.get(state)
    if (!pending || pending.kind !== 'split') {
      throw new PaymentError('This split checkout has expired. Start a new one.', 410)
    }
    if (pending.ownerEmail !== owner) throw new PaymentError('This workflow belongs to another Monsso account.', 403)

    for (const split of pending.splits) {
      if (!split.outgoingPaymentId) continue
      const incomingToken = await tokenValueWithPersistence(
        client,
        split.incomingToken,
        now,
        () => payments.set(state, pending, {
          ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)),
        }),
      )
      const incoming = await client.incomingPayment.get({
        url: split.incomingPaymentId,
        accessToken: incomingToken,
      })
      split.completed = Boolean(incoming.completed)
      split.receivedAmount = incoming.receivedAmount
      if (incoming.completed) split.status = 'completed'
    }
    await payments.set(state, pending, { ex: Math.max(1, Math.ceil((pending.expiresAt - now()) / 1000)) })
    return {
      id: pending.state,
      kind: 'split',
      status: pending.splits.every((split) => split.completed)
        ? 'completed'
        : pending.splits.some((split) => split.status === 'failed')
          ? 'partial_failure'
          : pending.splits.some((split) => split.outgoingPaymentId)
            ? 'submitted'
            : 'awaiting_authorization',
      maxDebitAmount: pending.maxDebitAmount,
      recipients: pending.splits.map((split) => ({
        walletAddress: split.walletAddress,
        incomingAmount: split.incomingAmount,
        debitAmount: split.quote.debitAmount,
        receivedAmount: split.receivedAmount,
        outgoingPaymentId: split.outgoingPaymentId,
        status: split.status,
        completed: Boolean(split.completed),
        metadata: split.metadata,
      })),
    }
  }

  return {
    startRecurring,
    finishRecurring,
    getRecurring,
    chargeRecurring,
    startSplit,
    finishSplit,
    getSplitStatus,
  }
}
