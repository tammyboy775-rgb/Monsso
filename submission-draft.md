# Monsso — Hackathon Submission Draft

Prepared for the [submission form](https://docs.google.com/forms/d/e/1FAIpQLSeNx_VOWC9__eWJr8OrjfL6xIC8imddiCMVMogG5SUWzum_0w/viewform).

## Team details

- **Team name:** [Fill in before submitting]
- **Members and roles:**
  - Banji — Development
  - Ire — Wallet setup and demo video
- **Lead contact:** Enter privately in the submission form.

## Project overview

- **Project name:** Monsso
- **Primary track:** Payment Automation and Financial Workflows
- **Intended users:** Small and local merchants exploring wallet-based digital payments, and customers who want to pay through a supported wallet.
- **Problem statement:** Independent SMEs may lack a straightforward way to accept wallet-based digital payments and confirm that a payment reached their receiving wallet. Monsso focuses on this narrow checkout and receipt-status problem; the prototype does not implement a complete merchant payments platform.
- **Current prototype scope:** The repository working tree now includes a sign-in-protected testnet workflow dashboard for monthly variable recurring grants, manually triggered installments, structured payment metadata, and two-recipient split payouts with per-recipient status. The changes have not yet been pushed or redeployed, and no workflow has been verified end to end with separate payer and recipient test wallets. They must not be presented as a demonstrated live integration until that test succeeds.

## Inclusion case

- **Barrier addressed:** Small businesses can face setup and workflow friction when trying to accept digital payments and verify receipt. Customers may also have different wallet-provider access or preferences. The prototype explores a wallet-based option with explicit payer authorization and a merchant receipt-status check.
- **Expected benefit:** If validated with SMEs and their customers, a wallet-based checkout with clear payment status could offer another way to pay and reduce uncertainty about receipt. This is a hypothesis, not a measured outcome.
- **Evidence:** No user research or impact evidence has been collected yet. The checkout and workflow code implement testnet quote creation, payer authorization, outgoing-payment submission, and receipt-status polling; automated service tests use a mocked Open Payments client and do not prove a live transaction. A successful end-to-end test-wallet checkout and workflow demonstration are still required.
- **Assumptions and limitations:** Users need internet access and compatible Interledger test-wallet accounts. Only the test network and test funds are supported. The prototype has not been validated with merchants or customers, and must not be used for real payments.

## Code repository

- **Repository:** https://github.com/tammyboy775-rgb/Monsso
- **Submitted commit:** `5447b9c888943074e78c6e6bbd1509d801f2b2c3` (`main`, pushed to `origin/main`).
- **Runtime dependencies:** `react` 19.3.1 (MIT), `react-dom` 19.3.1 (MIT), `@interledger/open-payments` 7.4.0 (Apache-2.0), and `@upstash/redis` 1.41.0 (MIT).
- **Development dependencies:** `vite` 8.3.8, `@vitejs/plugin-react` 6.3.0, `@rolldown/plugin-babel` 0.3.1, `@babel/core` 7.29.13, `babel-plugin-react-compiler` 1.0.0, `oxlint` 1.93.0, `@types/react` 19.3.0, and `@types/react-dom` 19.3.0. These packages declare MIT licenses.
- **Project license:** No root `LICENSE` file or `license` field is currently present. The project does not declare a reuse license; confirm whether the event requires one before submitting.
- **Validation:** `npm run test:server`, `npm run lint`, and `npm run build` passed in the current workspace.

## Demo video (maximum 3 minutes)

**Status:** Not recorded yet. Record only after a testnet checkout and at least one workflow (including payer authorization and confirmed recipient receipt) succeed.

**Pitch deck:** [Editable PowerPoint](./submission-pitch-deck.pptx) | [PDF](./submission-pitch-deck.pdf)

Suggested outline:

1. **0:00–0:25 — User problem:** Briefly explain the payment friction Monsso is exploring.
2. **0:25–0:50 — Product:** Show the Monsso site and identify the checkout as a testnet prototype.
3. **0:50–1:50 — Payment flow:** Show a small testnet checkout and payer authorization, or demonstrate a workflow grant with a separate payer test wallet.
4. **1:50–2:25 — Outcome:** Show the workflow metadata and per-recipient status, and distinguish a submitted outgoing payment from confirmed receipt.
5. **2:25–3:00 — Inclusion and next steps:** State the hypothesis, the manual (not scheduled) installment limitation, partial split-failure risk, and what the team will validate next.

Do not show private keys, access tokens, or other credentials in the recording.

## Prototype access

- **Hosted site:** https://monsso.vercel.app/
- **Hosted checkout:** https://monsso.vercel.app/checkout
- **Hosted API health:** https://monsso.vercel.app/api/health
- **Access status:** The currently hosted site may not contain the new workflow changes because they have not yet been pushed or redeployed. The API previously reported that its required environment variables were configured, but a checkout attempt failed during an Open Payments wallet-address request. Correct the wallet setup, deploy the current changes, then complete and verify end-to-end test-wallet checkout and workflow flows before claiming payment processing has been demonstrated.
- **Safe test instructions:** Use only supported `interledger-test.dev` test-wallet addresses and test funds. Start with a small amount. Never enter real wallet details or use real funds.
- **Reproducible local setup:** From the repository root, run `npm ci`; configure `.env` using the exact client and merchant test-wallet address URLs, client key ID and private-key file, Google sign-in values, and a separate payer test-wallet account; run `npm run dev:server` and `npm run dev` in separate terminals; then open `http://localhost:5173/checkout` or sign in and open `http://localhost:5173/workflows`. For split payouts, configure two distinct recipient test wallets. See the README for account roles and setup details. Keep `.env` and private keys out of source control.

## Next steps

1. Deploy the current workflow changes, then complete and record successful testnet checkout, recurring-grant, and split-payout flows.
2. Test the flow with representative merchants and customers; document feedback rather than assuming impact.
3. Conduct keyboard and screen-reader testing and improve any barriers found.
4. Review the security, privacy, reliability, and operational requirements before considering anything beyond the test network.
