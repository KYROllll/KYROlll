# Base token launch configuration

## Paused on the storefront

Token perks are currently **off by default** in the Worker (`TOKEN_PERKS_ENABLED` must explicitly equal `"true"`). While off, wallet verification returns 503, checkout ignores wallet proofs and charges the regular cart total, and cashback creation/retries are suspended. The beats store and its existing payment methods remain available.

The storefront has no wallet button, token perks strip, holder-discount row, cashback notice or wallet modal. The Base wallet implementation remains in `script.js` behind `TOKEN_PERKS_ENABLED = false`. To relaunch, set that flag to `true`, restore the removed wallet/perks markup in `index.html` (see the required element IDs in `script.js`: `wallet-btn`, `wallet-btn-text`, `wallet-modal`, `wallet-modal-close`, `wallet-modal-title`, `wallet-modal-desc`, `wallet-modal-sub`, `wallet-select-list`, `wallet-inline-state`, `t-holder-row`, `t-holder-discount`), and then set `TOKEN_PERKS_ENABLED = "true"` in the Worker environment. Add the perks strip and cashback notice only when those promotions are ready to be advertised. Verify the UI and checkout end-to-end before publishing.

## Launch integration

The Base wallet flow supports ERC-20 `balanceOf` on Base mainnet (chain 8453). Checkout independently verifies a fresh, wallet-signed message and calculates the 15% holder discount after free-beat picks, regardless of payment coin. The payment rails remain the existing NOWPayments methods; connecting a Base wallet does not change the network of a payment invoice.

After the KYROlll ERC-20 contract deploys, set `BASE_TOKEN_ADDRESS` in the checkout Worker environment to its Base mainnet address. Optionally set `BASE_RPC_URL` to a dedicated Base RPC (default: `https://mainnet.base.org`). No token address is embedded in the storefront. Until the contract is set, holder verification fails closed and checkout without a wallet still works.

Cashback is 10% of the *paid USD total* and is recorded as a `cashback:<orderId>` KV record after the signed, finished payment callback. This is a USD-denominated reward instruction, **not** a token quantity. To distribute rewards, configure `REWARDS_WEBHOOK_URL` and the `REWARDS_WEBHOOK_SECRET` Worker secret for a funded Base distributor that converts the USD amount to the token quantity at fulfillment. It receives JSON `{orderId, walletAddress, usdAmount, tokenAddress, chainId, status}` with `Authorization: Bearer <secret>` and `Idempotency-Key: <orderId>`. It must return `{ "txHash": "0x..." }` only after a Base transfer is submitted. The record moves from `pending` to `submitted` only with a transaction hash; the hourly cron retries pending records, so the distributor **must** deduplicate by order ID. Monitor the KV prefix for pending rewards; this integration does not include a funded distributor or on-chain finality tracking.

Deploy the Worker before updating the storefront so `/api/verify-token` is available. Run `node --test base-token.test.mjs catalog.test.mjs` from `worker/` for the integration checks.
