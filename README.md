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
`interledger-test.dev`.

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
only; the in-memory checkout state is temporary and is lost when the server
restarts. This local demo is not production-ready and must not be deployed as a
public payment service.

The checkout creates an incoming payment, obtains a quote, requests the
payer's explicit authorization, and creates the outgoing payment. It polls the
incoming-payment resource to show whether the merchant's wallet has received
the funds; creating an outgoing-payment resource alone is not treated as
settlement.

## Validate

```powershell
npm run test:server
npm run lint
npm run build
```
