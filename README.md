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

1. Create test-wallet accounts for the client identity and merchant. Create a
   payer account too when you're ready to test the full flow, using the
   [Open Payments test-wallet guide](https://openpayments.dev/sdk/before-you-begin/).
2. Create a client key and note its key ID. The public key must be published at
   the configured client wallet address's `jwks.json` endpoint.
3. Copy `.env.example` to `.env` and set:
   - `OP_CLIENT_WALLET_ADDRESS` to the client's test wallet address.
   - `OP_MERCHANT_WALLET_ADDRESS` to the merchant's receiving test wallet.
   - `OP_PRIVATE_KEY_PATH` to the downloaded private key file.
   - `OP_KEY_ID` to the key ID from the test wallet.
4. Enter the payer's test wallet address at checkout. The payer is redirected
   to their wallet provider to authorize the outgoing payment.

Keep `.env` and the private key out of source control. The app never sends
private keys or access tokens to the browser. The payment flow uses test funds
only. This prototype is not production-ready and must not be used to accept
real payments.

## Deploy the test checkout API to Vercel

The API uses Vercel Functions and Upstash Redis for short-lived checkout state.
The API is still testnet-only and is not suitable for real payments.

1. Add an Upstash Redis database to the Vercel project using the Vercel
   Marketplace integration. Confirm it provides
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. In **Project Settings → Environment Variables**, set the following for the
   Production environment:
   - `OP_CLIENT_WALLET_ADDRESS` to the client's test-wallet address.
   - `OP_MERCHANT_WALLET_ADDRESS` to the merchant's test-wallet address.
   - `OP_PRIVATE_KEY` to the private key's PEM contents (not its local file
     path).
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

## Validate

```powershell
npm run test:server
npm run lint
npm run build
```
