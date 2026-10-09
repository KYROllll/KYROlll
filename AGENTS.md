# AGENTS.md — running the KYROlll store in the Base44 sandbox

Repo-local notes that are not obvious from the manifests. Everything here is
about *running* the app in this sandbox, not about the app's own behaviour.

## Shape of the app

- **Storefront** — plain static files (`index.html`, `style.css`, `script.js`,
  `preview-player.js`, `assets/*.min.js`) served by `server.mjs` on port 8080.
  No bundler, no runtime dependencies: `server.mjs` is pure Node `http`, so
  edits to HTML/CSS/JS show up on a browser reload with no rebuild.
- **Checkout Worker** — `worker/` is a Cloudflare Worker (wrangler) that holds
  the NOWPayments key and the buyer download links. It is the only piece that
  needs secrets. It stores orders in a KV namespace (`ORDERS`), which wrangler
  simulates locally when running `wrangler dev`.

## How the two are wired here

- `docker-compose.base44.yml` runs `web` (`node server.mjs`, host port 3000) and
  `worker` (`npx wrangler dev`, host port 8000). Both bind-mount the checkout and
  run live from source.
- `script.js` picks its backend URL from `window.KYROLLL_WORKER_URL` if it is
  set, otherwise localhost:8787, otherwise the deployed `*.workers.dev` URL.
  `server.mjs` serves `/config.js` and, **only when `BASE44_PREVIEW_MODE=1`**,
  sets that global to `https://8000-$BASE44_PUBLIC_HOST_SUFFIX` (the exposed
  worker port). With the flag unset the route is a no-op and production keeps
  its built-in default.
- The worker's CORS default (`ALLOWED_ORIGIN` unset → `*`) is what lets the
  storefront on port 3000 call the worker on port 8000 cross-origin. No cookies
  or sessions are involved, so no `credentials: 'include'` is needed.

## Secrets

`worker/.dev.vars` is generated at container start from the platform-managed
env file `/run/base44/app.env` (see the compose `command`). The file is
git-ignored. The app **boots without any secrets** — checkout invoices and
delivery emails stay disabled until real NOWPayments / Resend values (and the
`FLESH_*` buyer links) are provided. `/api/catalog` (the healthcheck) touches
only KV, so it works without credentials.

## Verify it works

```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/          # 200 storefront
curl -s http://localhost:8000/api/catalog                                # {"sold":[]}
curl -s http://localhost:3000/config.js                                  # sets KYROLLL_WORKER_URL
```

Tests that ship with the repo:
- `worker/*.test.mjs` (via `worker/verify.mjs`) and the root
  `preview-player.test.mjs` are `node:test` based and need no browser:
  `docker compose -f docker-compose.base44.yml exec -T worker node --test catalog.test.mjs base-token.test.mjs`
- `brand-design.test.mjs` is Playwright-based and needs Chromium + root
  `node_modules`, which the sandbox does not install.

## Deliberate behaviour worth knowing

Order delivery is **email-only**: the payscreen and the success modal never list
download links or license files (see `showSuccessModal` / `completeFreeOrder` in
`script.js`). Everything — links, PDF/TXT licenses — goes out through the
Worker's branded Resend email. That email cannot send until `RESEND_API_KEY` and
`RESEND_FROM` are set, so an un-configured preview legitimately reports
"EMAIL DELIVERY PENDING".
