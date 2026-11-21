# Monsso

Hackathon prototype for an accessible, wallet-based merchant checkout using the
Interledger Open Payments test network.

## Run the local prototype

The React app and API server run in separate terminals:

```powershell
npm run dev:server
npm run dev
```

Open `http://localhost:5173` and choose **Try a test payment**. The API server
listens only on `127.0.0.1` and only accepts wallet addresses on
`interledger-test.dev`. Local checkout state is held in memory and is lost
when the API server restarts.

## Configure Google sign-in

1. Create a Google OAuth client ID for a **Web application** in Google Cloud.
   Add `http://localhost:5173` as an authorized JavaScript origin for local
   development and your deployed site origin for production.
2. Set `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` to that client ID in
   `.env`. The `VITE_` value is public and is used by the browser; the server
   checks Google credentials against `GOOGLE_CLIENT_ID`.
3. Set `AUTH_SESSION_SECRET` to a private random value of at least 32
   characters. For example, generate one with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.

Google verifies each sign-in on the server. Monsso stores only a signed,
HTTP-only session cookie and the user's verified email and profile picture.
The profile is available at `/profile`; choose **Switch account** to sign in
with another Google account.

## Configure the Interledger test wallet

1. Create three separate test-wallet accounts using the
   [Open Payments test-wallet guide](https://openpayments.dev/sdk/before-you-begin/):
   - **Client:** Monsso's server identity. Its key signs authenticated API
     requests.
   - **Merchant:** the receiving wallet configured for checkout.
   - **Payer:** the wallet you control and authorize payment from in the
     checkout flow.
2. Copy the exact **Wallet Address URL** shown for each account. Do not use
   example placeholders, manually build a URL, or substitute one account's
   address for another.
3. Create a client key and note its key ID. The matching public key must be
   published at the client wallet address's `jwks.json` endpoint.
4. Copy `.env.example` to `.env` and set:
   - `OP_CLIENT_WALLET_ADDRESS` to the exact client account Wallet Address URL.
   - `OP_MERCHANT_WALLET_ADDRESS` to the exact merchant account Wallet Address URL.
   - `OP_PRIVATE_KEY_PATH` to the downloaded private key file.
   - `OP_KEY_ID` to the key ID from the test wallet.
5. Enter the payer account's exact Wallet Address URL at checkout. The payer
   is redirected to their wallet provider to review and authorize the outgoing
   payment.

Keep `.env` and the private key out of source control. The app never sends
private keys or access tokens to the browser. The payment flow uses test funds
only. This prototype is not production-ready and must not be used to accept
real payments.

## Deploy the test checkout API to Vercel

The API is served through one catch-all Vercel Function to fit the Hobby plan's
function limit, and uses Upstash Redis for short-lived checkout state.
The API is still testnet-only and is not suitable for real payments.

1. Add an Upstash Redis database to the Vercel project using the Vercel
   Marketplace integration. Confirm it provides
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. In **Project Settings → Environment Variables**, set the following for the
   Production environment:
   - `OP_CLIENT_WALLET_ADDRESS` to the exact client account Wallet Address URL.
   - `OP_MERCHANT_WALLET_ADDRESS` to the exact merchant account Wallet Address URL.
   - `OP_PRIVATE_KEY` to the complete, unencrypted PEM contents of the
     downloaded client private-key file, preserving line breaks (not its local
     file path). It must match `OP_KEY_ID` and the public key at the client's
     `jwks.json` endpoint.
   - `OP_KEY_ID` to the client's test-wallet key ID.
   - `MONSSO_APP_ORIGIN` to `https://monsso.vercel.app` with no trailing slash.
   - `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` to the Google Web OAuth
     client ID whose authorized JavaScript origin is `https://monsso.vercel.app`.
   - `AUTH_SESSION_SECRET` to a private random value of at least 32 characters.
3. Keep the client's public key available at its wallet address's `jwks.json`
   endpoint. Never paste the private key into source control, chat, or issue
   trackers.
4. Redeploy after adding the variables. Open
   `https://monsso.vercel.app/api/health`; it should return JSON with
   `"configured": true`. Do not test with real funds.

The checkout creates an incoming payment, obtains a quote, requests the
payer's explicit authorization, and creates the outgoing payment. It polls the
incoming-payment resource to show whether the merchant's wallet has received
the funds; creating an outgoing-payment resource alone is not treated as
settlement. Vercel checkout records are stored in Upstash with a 15-minute TTL. The public
test API limits payment-start requests to 20 per IP per minute and status
requests to 120 per IP per minute.

## Test payment workflows

The signed-in **Workflows** page at `/workflows` contains testnet prototypes for
variable recurring payments and split payouts. These workflows require the
same client and merchant configuration as checkout, a signed-in Monsso
account, and payer/recipient wallet accounts on the Interledger test network.
Local workflow state is held in memory; Vercel stores it in Upstash. The API
binds each workflow to the Monsso account that started it.

- **Variable recurring payments:** authorize a monthly outgoing-payment grant
  for 2–12 periods with a maximum debit amount per period. The initial payment
  is submitted after wallet authorization. Later installments are triggered
  manually with **Run test installment**; there is no scheduler or automatic
  billing. The payer's wallet enforces the recurring grant limit. This demo
  caps each workflow at 20 recorded charges. The grant is not receiver-scoped
  at the protocol level; the current workflow implementation directs charges
  only to the configured merchant. Review the wallet authorization prompt.
- **Split payouts:** choose two different recipient test wallets and enter
  the amount each should receive in that wallet's currency. Monsso quotes each
  amount into the payer's currency, then shows the individual and combined
  payer debit before authorization. Currency conversion depends on the test
  wallets supporting the currency pair. The payer authorizes one grant capped
  to the combined quote amount, then Monsso submits one outgoing payment to
  each recipient. The dashboard reports each recipient's payment and receipt
  status separately; Monsso does not custody or route funds. The grant is
  amount-capped but not protocol-bound to those recipients; verify both
  recipient wallets and amounts in the payer's authorization flow. For
  mixed-currency splits, omit line items because their amounts cannot represent
  multiple currencies.
- **Payment metadata:** each payment carries a required description, optional
  invoice and order references, and up to 20 optional line items. A line item
  has a description, quantity, unit amount, and optional reference; when line
  items are provided, their total must equal the payment amount. Metadata is
  size-limited. Do not include personal or sensitive information.

Quotes expire. If a quote expires while wallet authorization is pending, the
workflow must be started again. Split settlement is not atomic: one recipient
may receive funds even if the other recipient's payment fails. Check the
per-recipient statuses and do not treat submission as settlement; receipt is
confirmed by polling each recipient's incoming payment. These are testnet-only
flows and have not been verified end to end until a payer and recipient test
wallet demonstration succeeds. Never use real funds.

## Validate

```powershell
npm run test:server
npm run lint
npm run build
```
