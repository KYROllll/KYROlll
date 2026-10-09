// Cloudflare Worker backend — performs every NOWPayments call, holds the
// download URLs, and dispatches the delivery email after an HMAC-verified
// 'finished' IPN. Nothing order-related is submitted from this file.
// config.js (served by server.mjs) can point this at a locally running checkout
// Worker for the Base44 preview; without it the store falls back to localhost in
// local dev and to the deployed Worker in production.
const WORKER_URL = window.KYROLLL_WORKER_URL
  || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8787"
    : "https://kencarter-checkout.kencarter-store.workers.dev");

const MP3_PRICE = 9.95;
const PRICE = 14.95;
const EXCLUSIVE_PRICE = 299.95;

const LEASES_PER_BEAT = 10;

// Add new releases here with id, title, name, img, bpm, key, leases, left,
// optional public preview, and optional youtube. Newest entries render first.
// Buyer files are configured privately in the Worker, never here.
const CATALOG = [{
  id: "flesh", title: 'Don Toliver type beat - "FLESH"', name: "",
  img: "assets/flesh.png", bpm: 130, key: "Am", leases: 10, left: 10,
  preview: "https://docs.google.com/uc?export=download&id=1cg_0qBDDMu80EqJ90_POL3ekv2k1BJ7Q",
  previewFallback: "assets/previews/flesh.mp3",
  tiers: ["mp3", "wav", "exclusive"]
}];
const money = (n) => "$" + n.toFixed(2);
// Exclusive-sold beats are retired from the catalog entirely (master rights
// transferred). Tracked client-side from the worker's /api/catalog endpoint.
const EXCLUSIVE_SOLD = new Set();
const isExclusiveSold = (b) => EXCLUSIVE_SOLD.has(b.id);
const isSoldOut = (b) => isExclusiveSold(b) || b.soldOut || b.left <= 0;

const byNewest = (a, b) => CATALOG.indexOf(b) - CATALOG.indexOf(a);
function renderOrder(list) {
  return [
    ...list.filter((b) => !isSoldOut(b)).sort(byNewest),
    ...list.filter((b) => isSoldOut(b)).sort(byNewest)
  ];
}

const selected = new Map(); // beat ID → mp3 or wav
const freePicks = new Set();
const exclusiveSelected = new Set();

// The 2+1 bundle only activates with three or more distinct non-exclusive
// leases in the cart. A single beat (or any exclusive lease) never qualifies.
const BUNDLE_MIN_LEASES = 3;
const bundleLeaseCount = () => selected.size;
const bundleActive = () => bundleLeaseCount() >= BUNDLE_MIN_LEASES;

const freeCap = () => (bundleActive() ? Math.floor(bundleLeaseCount() / 3) : 0);

function normalizeFreePicks() {
  const cap = freeCap();
  // Drop any free pick that is no longer part of a qualifying cart.
  [...freePicks].forEach((id) => {
    if (!selected.has(id) || !bundleActive()) freePicks.delete(id);
  });
  while (freePicks.size > cap) freePicks.delete([...freePicks][0]);
  if (!bundleActive()) {
    freePicks.clear();
    return;
  }
  // Apply the offer as soon as every third distinct lease enters the cart.
  for (const id of [...selected.keys()].reverse()) {
    if (freePicks.size >= cap) break;
    freePicks.add(id);
  }
}

function toggleFreePick(id) {
  if (!selected.has(id) || freeCap() === 0) return;
  if (freePicks.has(id)) return;
  if (freePicks.size >= freeCap()) freePicks.delete([...freePicks][0]);
  freePicks.add(id);
  render();
}

const $ = (id) => document.getElementById(id);

function unlockScroll() {
  document.body.style.cssText = '';
  document.documentElement.style.cssText = '';
}

const grid = $("grid");
const previewPlayer = new BeatPreviewPlayer(grid);
window.addEventListener("pagehide", () => previewPlayer.stop());
const cartbar = $("cartbar");
const drawer = $("drawer");
const backdrop = $("backdrop");

const BTC_ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,tether,usd-coin&vs_currencies=usd";

const BASE_CHAIN_ID = "0x2105";
// Token launch paused. Restore the wallet/perks markup before enabling this flow.
const TOKEN_PERKS_ENABLED = false;
let connectedWalletAddress = null;
let isTokenHolder = false;
let walletProvider = null;
let walletProof = null;

const ASSETS = {
  USDT: {
    sym: "USDT", name: "TETHER", id: "tether", np: "usdtsol",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="currentColor" fill-rule="evenodd" d="M6.7 6.9h10.6v2.8h-4.2v1.4c2.75.2 4.8.95 4.8 1.85 0 1.05-2.7 1.9-6 1.9s-6-.85-6-1.9c0-.9 2.05-1.65 4.8-1.85V9.7H6.7Zm5.3 6.15c2.95 0 5.35-.6 5.35-1.15 0-.5-1.75-.95-3.65-1.07v1.1c0 .26-.76.47-1.7.47s-1.7-.21-1.7-.47v-1.1c-1.9.12-3.65.57-3.65 1.07 0 .55 2.4 1.15 5.35 1.15Z"/></svg>`
  },
  USDC: {
    sym: "USDC", name: "USD COIN", id: "usd-coin", np: "usdc",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="12" y="16.6" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12.5" font-weight="700" fill="currentColor">$</text></svg>`
  },
  BTC: {
    sym: "BTC", name: "BITCOIN", id: "bitcoin", np: "btc",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="1.8"/><path stroke-width="1.6" stroke-linecap="round" d="M9.6 7.2h3.5a2.4 2.4 0 0 1 0 4.8H9.6m4 0a2.55 2.55 0 0 1 0 5.1H9.6m0-9.9v9.9m1.6-11.7v1.8m2.2-1.8v1.8m-2.2 9.9v1.8m2.2-1.8v1.8"/></svg>`
  },
  ETH: {
    sym: "ETH", name: "ETHEREUM", id: "ethereum", np: "eth",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.8 5.4 12.2 12 16l6.6-3.8Z"/><path fill="currentColor" d="M12 17.7 5.4 13.9 12 22.6l6.6-8.7Z"/></svg>`
  },
  SOL: {
    sym: "SOL", name: "SOLANA", id: "solana", np: "sol",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.2 4.4h13.2l-2.7 3.2H4.5zM16.8 10.4H3.6l2.7 3.2h13.2zM7.2 16.4h13.2l-2.7 3.2H4.5z"/></svg>`
  },
  LTC: {
    sym: "LTC", name: "LITECOIN", id: null, np: "ltc",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="12" y="16.6" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12.5" font-weight="700" fill="currentColor">\u0141</text></svg>`
  }
};

const FALLBACK_SYMS = ["USDT", "USDC", "LTC"];

const PAYMENT_GROUPS = [
  {
    value: "Stablecoins (USDT/USDC)",
    label: "USDT / USDC",
    sub: "STABLE \u00b7 RECOMMENDED",
    assets: ["USDT", "USDC"],
    icon: ASSETS.USDT.icon
  },
  {
    value: "Bitcoin (BTC)",
    label: "BTC",
    sub: "BITCOIN",
    assets: ["BTC"],
    icon: ASSETS.BTC.icon
  },
  {
    value: "Ethereum / Solana (ETH/SOL)",
    label: "ETH / SOL",
    sub: "ETH OR SOLANA",
    assets: ["ETH", "SOL"],
    icon: ASSETS.ETH.icon
  }
];

let payGroup = null;
let payAssetSym = null;

const CRYPTO_PRICES = {};

let lastBtcUsd = null;

function renderBtc(usd) {
  lastBtcUsd = usd;
  const label = `\u2248 ${(MP3_PRICE / usd).toFixed(6)} BTC`;
  document.querySelectorAll(".btc-price").forEach((el) => (el.textContent = label));
}

function activeAsset() {
  return payAssetSym ? ASSETS[payAssetSym] : null;
}

function renderCryptoTotal() {
  const chip = $("t-crypto");
  if (!chip) return;
  const asset = activeAsset();
  if (!asset) {
    chip.hidden = true;
    chip.classList.remove("is-flash");
    return;
  }
  const { total } = totals();
  const usd = CRYPTO_PRICES[asset.id];
  const stable = asset.sym === "USDT" || asset.sym === "USDC";
  let prefix = "";
  let amount = null;
  if (usd && usd > 0) {
    const qty = total / usd;
    if (stable && Math.abs(usd - 1) < 0.02) {
      prefix = "=";
      amount = total.toFixed(2);
    } else {
      prefix = "\u2248";
      amount = qty.toFixed(usd < 5 ? 2 : 6);
    }
  }
  let outer = asset.icon + `<span>${amount != null ? `${prefix} ${amount} ${asset.sym}` : "\u2014 " + asset.sym}</span>`;
  chip.innerHTML = outer;
  chip.hidden = false;
  chip.classList.remove("is-flash");
  void chip.offsetWidth;
  chip.classList.add("is-flash");
}

function selectPayment(value) {
  const group = PAYMENT_GROUPS.find((g) => g.value === value) || null;
  if (group && isGroupBelowMin(group)) {
    const alt = firstAffordableGroup(value);
    if (!alt) return;
    return selectPayment(alt.value);
  }
  payGroup = group;
  payAssetSym = group ? group.assets[0] : null;
  $("payment").value = group ? group.value : "";
  $("paygrid").classList.remove("invalid");
  document.querySelectorAll(".paygrid__opt").forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle("paygrid__opt--on", on);
    b.setAttribute("aria-checked", String(on));
  });
  renderCryptoTotal();
}

function buildPaygrid() {
  const grid = $("paygrid");
  PAYMENT_GROUPS.forEach((group) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "paygrid__opt";
    btn.dataset.value = group.value;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.innerHTML = `${group.icon}<span>${group.label}</span><span class="paygrid__opt-sub">${group.sub}</span>`;
    grid.appendChild(btn);
  });
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".paygrid__opt");
    if (btn) selectPayment(btn.dataset.value);
  });
}

function startBtc() {
  const update = () => {
    fetch(BTC_ENDPOINT)
      .then((r) => r.json())
      .then((d) => {
        if (!d) return;
        if (d.bitcoin && d.bitcoin.usd) renderBtc(d.bitcoin.usd);
        Object.keys(d).forEach((id) => {
          if (d[id] && d[id].usd) CRYPTO_PRICES[id] = d[id].usd;
        });
        renderCryptoTotal();
      })
      .catch(() => {});
  };
  update();
  setInterval(update, 60000);
}

function specLine(beat) {
  return `${beat.bpm} BPM // ${beat.key}`;
}

function youtubeHTML(beat, show) {
  if (!show || !beat.youtube) return "";
  return `<a href="${beat.youtube}" target="_blank" rel="noopener noreferrer" class="card__youtube-link" aria-label="Watch on YouTube" title="Watch on YouTube" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>`;
}

function previewHTML(beat) {
  if (isExclusiveSold(beat)) return "";
  const attr = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  if (!beat.preview) return beat.youtube
    ? `<a class="beat-preview__unavailable" href="${attr(beat.youtube)}" target="_blank" rel="noopener noreferrer">PREVIEW ON YOUTUBE ↗</a>`
    : '<p class="beat-preview__unavailable">PREVIEW COMING SOON</p>';
  const title = attr(beat.name ? `${beat.title} — ${beat.name}` : beat.title);
  return `<div class="beat-preview" data-title="${title}" data-state="idle">
    <audio class="beat-preview__audio" src="${attr(beat.preview)}"${beat.previewFallback ? ` data-fallback="${attr(beat.previewFallback)}"` : ""} preload="none"></audio>
    <button type="button" class="beat-preview__toggle" aria-label="Play preview: ${title}" aria-pressed="false">
      <svg class="beat-preview__play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      <svg class="beat-preview__pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
    </button>
    <div class="beat-preview__details">
      <input class="beat-preview__seek" type="range" min="0" max="100" step="0.1" value="0" disabled aria-label="Seek preview: ${title}">
      <span class="beat-preview__time">0:00 / --:--</span>
    </div>
    <span class="beat-preview__status" role="status">AUDIO PREVIEW</span>
  </div>`;
}

function beatDetailInner(beat) {
  const sold = isSoldOut(beat);
  const exclusiveGone = isExclusiveSold(beat);
  const mediaTag = exclusiveGone
    ? `<span class="card__tag card__tag--sold">SOLD OUT (EXCLUSIVE)</span>`
    : sold
      ? `<span class="card__tag card__tag--sold">SOLD OUT</span>`
      : "";

  const lease = selected.get(beat.id);
  const isExclusiveOn = exclusiveSelected.has(beat.id);

  const action = exclusiveGone
    ? `<button class="card__btn card__btn--sold" disabled>SOLD OUT (EXCLUSIVE)</button>`
    : sold
    ? `<button class="card__btn card__btn--sold" disabled>SOLD OUT</button>`
    : `<div class="card__actions">
           ${(!beat.tiers || beat.tiers.includes("mp3")) ? `<button class="card__btn card__btn--mp3${lease === "mp3" ? " card__btn--active" : ""}" data-id="${beat.id}" data-type="mp3" aria-pressed="${lease === "mp3"}">
              MP3 LEASE (${money(MP3_PRICE)})${lease === "mp3" ? ' <span class="card__btn-check">&check;</span>' : ""}
           </button>` : ""}
           <button class="card__btn card__btn--wav${lease === "wav" ? " card__btn--active" : ""}" data-id="${beat.id}" data-type="wav" aria-pressed="${lease === "wav"}">
             STANDARD WAV LEASE (${money(PRICE)})${lease === "wav" ? ' <span class="card__btn-check">&check;</span>' : ""}
           </button>
           ${beat.left > 0 ? `
             <button class="card__btn card__btn--exclusive${isExclusiveOn ? " card__btn--active" : ""}" data-id="${beat.id}" data-type="exclusive" aria-pressed="${isExclusiveOn}">
                EXCLUSIVE LEASE ($${EXCLUSIVE_PRICE.toFixed(2)})${isExclusiveOn ? ' <span class="card__btn-check">&check;</span>' : ""}
             </button>
           ` : ""}
          </div>`;

  return `
    <figure class="beat-detail__artwork">
      <img src="${beat.img}" alt="${beat.title} cover art" decoding="async" fetchpriority="high">
      ${mediaTag}
    </figure>
    <section class="beat-detail__content" aria-label="Beat preview and licenses">
      <div class="card__meta">
        <div class="card__name">
          <h2 class="card__title-link">
              <span>${beat.title}${beat.name ? ` <span class="card__name-alt">\u2014 ${beat.name}</span>` : ""}</span>
          </h2>
          ${youtubeHTML(beat, true)}
        </div>
        <div class="card__specs">${specLine(beat)}</div>
      </div>
      ${previewHTML(beat)}
      ${action}
    </section>`;
}

function buildGrid() {
  previewPlayer.stop();
  grid.innerHTML = "";
  const id = new URLSearchParams(location.search).get("beat");
  const detail = id !== null;
  const list = detail ? CATALOG.filter((beat) => beat.id === id) : renderOrder(CATALOG);
  document.documentElement.classList.toggle("beat-page", detail);
  grid.classList.toggle("grid--detail", detail);
  $("beat-navigation").hidden = !detail;
  $("catalog").hidden = detail;
  grid.setAttribute("aria-label", detail ? "Beat details" : "Available beats");
  document.title = detail && list.length ? `${list[0].title} — KYROlll` : "KYROlll — BEATS & ORIGINAL PRODUCTION";

  if (!list.length) {
    const panel = document.createElement("article");
    panel.className = "grid-closed";
    panel.innerHTML = detail
      ? '<div class="grid-closed__box"><div class="grid-closed__title">BEAT NOT FOUND</div><p><a href="index.html#catalog">VIEW ALL BEATS →</a></p></div>'
      : '<div class="grid-closed__box"><div class="grid-closed__title">NO BEATS AVAILABLE</div><p>CHECK BACK FOR NEW BEATS.</p></div>';
    grid.appendChild(panel);
    return;
  }

  list.forEach((beat) => {
    const card = document.createElement("article");
    card.id = "card-" + beat.id;
    if (detail) {
      const isSel = selected.has(beat.id) || exclusiveSelected.has(beat.id);
      card.className = "beat-detail" + (isSoldOut(beat) ? " beat-detail--sold" : "") + (isSel ? " beat-detail--selected" : "");
      card.innerHTML = beatDetailInner(beat);
    } else {
      card.className = "catalog-tile" + (isSoldOut(beat) ? " catalog-tile--sold" : "");
      card.innerHTML = `<a class="catalog-tile__link" href="index.html?beat=${encodeURIComponent(beat.id)}" aria-label="View ${beat.title}">
        <span class="catalog-tile__art"><img src="${beat.img}" alt="" loading="lazy" decoding="async"></span>
        <span class="catalog-tile__title">${beat.title}${beat.name ? ` — ${beat.name}` : ""}</span>
      </a>`;
    }
    grid.appendChild(card);
  });
}

function beatFromAnchor(anchor) {
  const clean = String(anchor || "").replace(/^#/, "");
  const direct = CATALOG.find((beat) => beat.id === clean || `card-${beat.id}` === clean);
  if (direct) return direct.id;
  const m = /^(s2-)?beat-(\d+)$/.exec(clean);
  if (m) {
    const beatId = `${m[1] ? "s2-" : ""}beat${Number(m[2])}`;
    return beatId;
  }
  const lm = /^(?:card-)?(s2-)?beat(\d+)$/.exec(clean);
  if (lm) {
    const beatId = `${lm[1] ? "s2-" : ""}beat${lm[2]}`;
    return beatId;
  }
  return null;
}

function handleDeepHash() {
  if (new URLSearchParams(location.search).has("beat")) return;
  const id = beatFromAnchor(location.hash);
  if (id && CATALOG.some((beat) => beat.id === id)) {
    unlockScroll();
    location.replace(`index.html?beat=${encodeURIComponent(id)}`);
  }
}

function toggle(id, type) {
  const beat = CATALOG.find((b) => b.id === id);
  if (!beat) return;

  if (isExclusiveSold(beat)) {
    alert("This beat has been sold exclusively \u2014 master rights transferred. No longer available.");
    return;
  }

  if (isSoldOut(beat)) {
    if (type === "exclusive") {
      alert("This beat has already been sold exclusively.");
    } else {
      alert("All leases for this beat have been sold.");
    }
    return;
  }

  if (type === "exclusive") {
    if (exclusiveSelected.has(id)) {
      exclusiveSelected.delete(id);
    } else {
      exclusiveSelected.add(id);
      selected.delete(id);
      freePicks.delete(id);
    }
  } else {
    if (selected.get(id) === type) {
      selected.delete(id);
    } else {
      selected.set(id, type);
      exclusiveSelected.delete(id);
    }
  }
  render();
}

const VALID_PROMO_CODES = new Set(["KYROTEST", "TEST100", "100OFF", "KYRO100"]);
const PROMO_STORAGE_KEY = "kyrolll:promo";
let appliedPromoCode = null;

// The applied promo code lives outside the drawer session: it survives closing
// and reopening the cart, SPA navigation, and full page reloads.
function persistPromo(code) {
  try {
    if (code) localStorage.setItem(PROMO_STORAGE_KEY, code);
    else localStorage.removeItem(PROMO_STORAGE_KEY);
  } catch { /* storage unavailable (private mode) — keep it in memory only */ }
}

function restorePromo() {
  try {
    const stored = (localStorage.getItem(PROMO_STORAGE_KEY) || "").trim().toUpperCase();
    if (stored && VALID_PROMO_CODES.has(stored)) appliedPromoCode = stored;
  } catch { /* ignore */ }
}

// Drives the applied-coupon tag badge in the cart summary. The promo input
// stays visible at all times so customers can add or swap codes on demand.
function syncPromoUI(animate = false) {
  const tag = $("promo-tag");
  const on = !!appliedPromoCode && VALID_PROMO_CODES.has(appliedPromoCode);

  const input = $("promo-code");
  if (input) {
    if (on) input.value = "";
    input.placeholder = on ? "Enter another promo code" : "Enter promo code";
  }
  const label = document.querySelector('label[for="promo-code"]');
  if (label) label.textContent = on ? "ADD ANOTHER PROMO CODE (OPTIONAL)" : "PROMO CODE (OPTIONAL)";

  if (!tag) return;
  tag.hidden = !on;
  if (!on) {
    tag.classList.remove("is-visible");
    return;
  }
  $("promo-tag-code").textContent = appliedPromoCode;
  const amount = totals().promoDiscount;
  $("promo-tag-amount").textContent = amount > 0 ? "\u2212" + money(amount) : "100% OFF";
  if (animate) {
    tag.classList.remove("is-visible");
    void tag.offsetWidth;
  }
  tag.classList.add("is-visible");
}

function totals() {
  const basicCount = selected.size;
  const exclusiveCount = exclusiveSelected.size;
  const n = basicCount + exclusiveCount;
  const subtotal = [...selected.values()].reduce((sum, tier) => sum + (tier === "mp3" ? MP3_PRICE : PRICE), 0) + exclusiveCount * EXCLUSIVE_PRICE;
  const freeCount = [...freePicks].filter((id) => selected.has(id)).length;
  // The 2+1 bundle discount activates strictly when the cart holds
  // three or more non-exclusive leases — never for a single beat or
  // an exclusive lease.
  const bundleDiscount = bundleActive()
    ? [...freePicks].filter((id) => selected.has(id)).reduce((sum, id) => sum + (selected.get(id) === "mp3" ? MP3_PRICE : PRICE), 0)
    : 0;
  let afterBundle = Math.max(0, subtotal - bundleDiscount);
  if (TOKEN_PERKS_ENABLED && isTokenHolder) {
    afterBundle = Math.round(afterBundle * 85) / 100;
  }
  let promoDiscount = 0;
  let total = afterBundle;
  if (appliedPromoCode && VALID_PROMO_CODES.has(appliedPromoCode)) {
    promoDiscount = afterBundle;
    total = 0;
  }
  const discount = bundleDiscount + promoDiscount;
  return { n, exclusiveN: exclusiveCount, basicCount, exclusiveCount, subtotal, freeCount, discount, total, promoDiscount, bundleDiscount };
}

function render() {
  normalizeFreePicks();
  const { n, subtotal, discount, total, bundleDiscount } = totals();

  // The bundle callout appears only once three distinct leases qualify.
  const offerUnlocked = bundleActive() && !new URLSearchParams(location.search).has("beat");
  $("offer").hidden = !offerUnlocked;
  $("catalog").classList.toggle("catalog-heading--empty", !offerUnlocked);

  updatePaygridLocks();
  if (n > 0 && payGroup && isGroupBelowMin(payGroup)) {
    const alt = firstAffordableGroup();
    if (alt) selectPayment(alt.value);
    else {
      payGroup = null;
      payAssetSym = null;
      $("payment").value = "";
      document.querySelectorAll(".paygrid__opt").forEach((b) => b.classList.remove("paygrid__opt--on"));
    }
  }

  CATALOG.forEach((b) => {
    if (isSoldOut(b)) return;
    const card = $("card-" + b.id);
    if (!card) return;
    const lease = selected.get(b.id);
    const isExclusiveOn = exclusiveSelected.has(b.id);

    card.classList.toggle("beat-detail--selected", !!lease || isExclusiveOn);

    for (const [tier, label, price] of [["mp3", "MP3 LEASE", MP3_PRICE], ["wav", "STANDARD WAV LEASE", PRICE]]) {
      const btn = card.querySelector(".card__btn--" + tier);
      if (!btn) continue;
      const on = lease === tier;
      btn.classList.toggle("card__btn--active", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.innerHTML = `${label} (${money(price)})${on ? ' <span class="card__btn-check">&check;</span>' : ""}`;
    }

    const exclusiveBtn = card.querySelector(".card__btn--exclusive");
    if (exclusiveBtn) {
      exclusiveBtn.classList.toggle("card__btn--active", isExclusiveOn);
      exclusiveBtn.setAttribute("aria-pressed", isExclusiveOn ? "true" : "false");
      exclusiveBtn.innerHTML = isExclusiveOn
        ? `EXCLUSIVE LEASE ($${EXCLUSIVE_PRICE.toFixed(2)}) <span class="card__btn-check">&check;</span>`
        : `EXCLUSIVE LEASE ($${EXCLUSIVE_PRICE.toFixed(2)})`;
    }
  });

  cartbar.disabled = n === 0;
  $("cartbar-label").textContent =
    n === 0 ? "CART (0)" : `CART (${n}) \u2014 ${money(total)}`;

  $("drawer-count").textContent = n;
  $("t-subtotal").textContent = money(subtotal);
  // The "2+1 BUNDLE DISCOUNT" row reflects only the bundle discount (never a
  // promo discount), and stays hidden unless three non-exclusive leases qualify.
  $("t-discount-row").hidden = bundleDiscount === 0;
  $("t-discount").textContent = "\u2212" + money(bundleDiscount);

  syncPromoUI();

  const isZero = total === 0;
  const paygridLabel = $("paygrid-label");
  const paygrid = $("paygrid");
  if (paygridLabel) paygridLabel.style.display = isZero ? "none" : "";
  if (paygrid) paygrid.style.display = isZero ? "none" : "";

  if (TOKEN_PERKS_ENABLED && $("t-holder-row")) {
    $("t-holder-row").hidden = !isTokenHolder;
    $("t-holder-discount").textContent = "\u2212" + money(Math.max(0, subtotal - discount - total));
  }
  $("t-total-usd").textContent = money(total);

  const hint = $("free-hint");
  const cap = freeCap();
  const moreAvailable = CATALOG.some(
    (b) => !isSoldOut(b) && !selected.has(b.id) && !exclusiveSelected.has(b.id)
  );
  if (n === 0) {
    hint.hidden = true;
  } else if (selected.size % 3 === 2 && moreAvailable) {
    hint.hidden = false;
    hint.textContent = "ONE MORE \u2014 YOUR NEXT BEAT COMES FREE.";
  } else if (freePicks.size > 0) {
    hint.hidden = false;
    hint.textContent = `FREE BEAT${cap > 1 ? "S" : ""} APPLIED \u2014 CHANGE YOUR PICK BELOW.`;
  } else {
    hint.hidden = true;
  }

  const list = $("cart-items");
  list.innerHTML = "";

  // Basic lease items
  CATALOG.filter((b) => selected.has(b.id)).forEach((b) => {
    const picked = freePicks.has(b.id);
    const li = document.createElement("li");
    if (picked) li.className = "cart-item--free";
    const tier = selected.get(b.id);
    const price = tier === "mp3" ? MP3_PRICE : PRICE;
    li.innerHTML = `
      <img src="${b.img}" alt="">
      <span class="cart-items__name">${b.title} <span class="cart-items__name-alt">${b.name ? `\u2014 ${b.name} ` : ""}(${tier.toUpperCase()} LEASE)</span><span class="cart-items__specs">${specLine(b)}</span></span>
      <span class="cart-items__price${picked ? " cart-items__price--free" : ""}">${picked ? "FREE" : money(price)}</span>
      ${picked ? `<span class="cart-items__free-label">FREE PICK</span>` : cap > 0 ? `<button class="cart-items__free" data-free="${b.id}">MAKE FREE</button>` : ""}
      <button class="cart-items__remove" data-id="${b.id}" data-type="${tier}">REMOVE</button>`;
    list.appendChild(li);
  });

  // Exclusive items
  CATALOG.filter((b) => exclusiveSelected.has(b.id)).forEach((b) => {
    const li = document.createElement("li");
    li.className = "cart-item--exclusive";
    li.innerHTML = `
      <img src="${b.img}" alt="">
      <span class="cart-items__name">${b.title} <span class="cart-items__name-alt">${b.name ? `\u2014 ${b.name} ` : ""}(EXCLUSIVE)</span><span class="cart-items__specs">${specLine(b)} \u2014 EXCLUSIVE LICENSE</span></span>
      <span class="cart-items__price">${money(EXCLUSIVE_PRICE)}</span>
      <button class="cart-items__remove" data-id="${b.id}" data-type="exclusive">REMOVE</button>`;
    list.appendChild(li);
  });

  $("cart-empty").hidden = n !== 0;

  if (lastBtcUsd) renderBtc(lastBtcUsd);
  renderCryptoTotal();
}

function openDrawer() {
  drawer.classList.add("drawer--open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
  // Body scrolling stays unlocked at all times — the drawer is a fixed overlay.
  // Reopen with the same promo state: the tag badge stays active and the input
  // collapses whenever a code is already applied.
  syncPromoUI();
  loadMins();
}

function updateCashbackNotice() {
  const el = $("cashback-notice");
  if (!el) return;
  if (connectedWalletAddress) {
    el.hidden = false;
    el.textContent = "BASE WALLET LINKED · 10% KYROlll CASHBACK QUEUED AFTER PAYMENT (WHEN REWARDS GO LIVE).";
  } else {
    el.hidden = false;
    el.textContent = "CONNECT A BASE WALLET FOR KYROlll REWARDS · HOLDERS GET 15% OFF.";
  }
}

function closeDrawer() {
  drawer.classList.remove("drawer--open");
  drawer.setAttribute("aria-hidden", "true");
  backdrop.hidden = true;
  unlockScroll();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let lastOrder = null;

function applyPromoCode() {
  const input = $("promo-code");
  const errEl = $("promo-error");
  const code = (input.value || "").trim().toUpperCase();

  errEl.hidden = true;

  if (!code) {
    return;
  }

  if (VALID_PROMO_CODES.has(code)) {
    appliedPromoCode = code;
    persistPromo(code);
    input.classList.remove("invalid");
    // syncPromoUI clears the field and swaps the placeholder/label; the tag
    // badge represents the active discount in the summary above.
    syncPromoUI(true);
  } else {
    if (!appliedPromoCode) {
      appliedPromoCode = null;
      persistPromo(null);
    }
    errEl.textContent = "INVALID PROMO CODE";
    errEl.hidden = false;
    input.classList.add("invalid");
    syncPromoUI();
  }
  render();
}

// Clears the applied promo (also wired to the tag's remove button).
function clearPromo() {
  appliedPromoCode = null;
  persistPromo(null);
  const input = $("promo-code");
  if (input) {
    input.value = "";
    input.classList.remove("invalid");
  }
  $("promo-error").hidden = true;
  syncPromoUI();
  render();
}

function submitOrder(e) {
  e.preventDefault();

  const emailInput = $("email");
  const errorEl = $("form-error");
  const email = emailInput.value.trim();
  normalizeFreePicks();
  const { n, subtotal, discount, total } = totals();
  // A $0.00 cart (e.g. a 100% off promo like KYROTEST) skips every crypto
  // gateway requirement — no payment method is needed for a free/test checkout.
  const isFreeOrder = total <= 0;

  errorEl.hidden = true;
  emailInput.classList.remove("invalid");

  if (!EMAIL_RE.test(email)) {
    emailInput.classList.add("invalid");
    errorEl.textContent = "ENTER A VALID EMAIL ADDRESS.";
    errorEl.hidden = false;
    return;
  }

  if (isFreeOrder) {
    if (!CATALOG.length) {
      errorEl.textContent = "NO BEATS AVAILABLE.";
      errorEl.hidden = false;
      return;
    }

    const chosen = CATALOG.filter((b) => selected.has(b.id));
    const exclusiveChosen = CATALOG.filter((b) => exclusiveSelected.has(b.id));

    const items = [
      ...chosen.map((b) => ({ id: b.id, title: b.title, type: selected.get(b.id) })),
      ...exclusiveChosen.map((b) => ({ id: b.id, title: b.title, type: "exclusive" }))
    ];

    const labeled = [
      ...chosen.map((b) => `${b.title} ${selected.get(b.id).toUpperCase()} LEASE`),
      ...exclusiveChosen.map((b) => `${b.title} EXCLUSIVE`)
    ];

    lastOrder = {
      email,
      group: null,
      labeled,
      subtotal,
      discount,
      total: 0,
      items,
      freePicks: [...freePicks],
      exclusivePicks: exclusiveChosen.map((b) => b.id),
      exclusiveTitles: exclusiveChosen.map((b) => b.title),
      walletAddress: TOKEN_PERKS_ENABLED ? connectedWalletAddress : null,
      promoCode: appliedPromoCode
    };

    selected.clear();
    exclusiveSelected.clear();
    freePicks.clear();
    render();
    closeDrawer();

    completeFreeOrder(lastOrder);
    return;
  }

  if (!isFreeOrder && payGroup && isGroupBelowMin(payGroup)) {
    const alt = firstAffordableGroup();
    if (alt) {
      selectPayment(alt.value);
    } else {
      errorEl.textContent = "CART TOTAL IS BELOW THE MINIMUM FOR EVERY SUPPORTED COIN.";
      errorEl.hidden = false;
      return;
    }
  }

  if (!isFreeOrder && !payGroup) {
    errorEl.textContent = "PLEASE SELECT A PAYMENT METHOD.";
    errorEl.hidden = false;
    return;
  }

  if (!CATALOG.length) {
    errorEl.textContent = "NO BEATS AVAILABLE.";
    errorEl.hidden = false;
    return;
  }

  const chosen = CATALOG.filter((b) => selected.has(b.id));
  const exclusiveChosen = CATALOG.filter((b) => exclusiveSelected.has(b.id));

  const items = [
    ...chosen.map((b) => ({ id: b.id, title: b.title, type: selected.get(b.id) })),
    ...exclusiveChosen.map((b) => ({ id: b.id, title: b.title, type: "exclusive" }))
  ];

  const labeled = [
    ...chosen.map((b) => `${b.title} ${selected.get(b.id).toUpperCase()} LEASE`),
    ...exclusiveChosen.map((b) => `${b.title} EXCLUSIVE`)
  ];

  lastOrder = {
    email,
    group: payGroup,
    labeled,
    subtotal,
    discount,
    total,
    items,
    freePicks: [...freePicks],
    exclusivePicks: exclusiveChosen.map((b) => b.id),
    exclusiveTitles: exclusiveChosen.map((b) => b.title),
    walletAddress: TOKEN_PERKS_ENABLED ? connectedWalletAddress : null,
    promoCode: appliedPromoCode
  };

  finishOrder();
}

function finishOrder() {
  selected.clear();
  exclusiveSelected.clear();
  freePicks.clear();
  render();
  closeDrawer();
  showPayscreen(lastOrder);
}

const payscreen = $("payscreen");

let payScreenOrder = null;
let payScreenSym = null;

let npPayment = null;
let npPollTimer = null;

const NP_STATUS_COPY = {
  waiting: "WAITING FOR YOUR PAYMENT",
  confirming: "CONFIRMING ON BLOCKCHAIN",
  confirmed: "PAYMENT VERIFIED \u2014 FILES UNLOCKED",
  sending: "PAYMENT VERIFIED \u2014 FILES UNLOCKED",
  finished: "PAYMENT VERIFIED \u2014 FILES UNLOCKED",
  partially_paid: "UNDERPAID \u2014 SEND THE MISSING AMOUNT",
  failed: "PAYMENT FAILED \u2014 PICK ANOTHER COIN TO RETRY",
  refunded: "PAYMENT REFUNDED",
  expired: "PAYMENT EXPIRED \u2014 PICK ANOTHER COIN TO RETRY",
  exclusive: "EXCLUSIVE MASTER RIGHTS — BEAT RETIRED FROM CATALOG"
};

function setNpStatus(text, mode) {
  const el = $("np-status");
  if (!el) return;
  el.textContent = text;
  const cls = ["np-status"];
  if (mode) cls.push("np-status--" + mode);
  if (mode === "ok" || mode === "exclusive") cls.push("visible");
  el.className = cls.join(" ");
}

async function workerRequest(path, opts = {}) {
  if (!WORKER_URL) throw new Error("WORKER URL NOT CONFIGURED \u2014 SEE TOP OF SCRIPT.JS");
  const res = await fetch(WORKER_URL.replace(/\/+$/, "") + path, Object.assign({}, opts, {
    headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {})
  }));
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data && data.error) || "CHECKOUT ERROR " + res.status);
  return data;
}

function npOrderId() {
  return "KC-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

let npMins = null;

const isBelowMinSym = (sym, usdTotal) =>
  !!npMins && typeof npMins[sym] === "number" && usdTotal < npMins[sym];

async function loadMins() {
  try {
    const syms = Object.keys(ASSETS).join(",");
    const d = await workerRequest("/api/mins?coins=" + encodeURIComponent(syms));
    npMins = d.mins || null;
    refreshChipLocks();
    updatePaygridLocks();
  } catch {}
}

const isBelowMin = (sym) => isBelowMinSym(sym, payScreenOrder ? payScreenOrder.total : 0);

function showMinAlert(sym) {
  const el = $("payscreen-alert");
  if (el) {
    const name = (ASSETS[sym] || {}).name || sym;
    el.textContent = `Minimum purchase for ${name} is higher due to network fees. Please select USDT/USDC or Litecoin instead.`;
    el.hidden = false;
  }
  appendFallbackChips();
}

function buildCoinChip(sym) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "payscreen__tab";
  b.textContent = sym;
  b.dataset.sym = sym;
  b.addEventListener("click", () => {
    if (b.disabled || b.classList.contains("payscreen__tab--off") || isBelowMin(sym)) return;
    startNpPayment(sym);
  });
  return b;
}

function refreshChipLocks() {
  if (!npMins || !payScreenOrder) return;
  document.querySelectorAll(".payscreen__tab").forEach((b) => {
    const blocked = isBelowMin(b.dataset.sym);
    b.classList.toggle("payscreen__tab--off", blocked);
    b.disabled = blocked;
    if (blocked) {
      b.setAttribute("aria-disabled", "true");
      b.title = `MINIMUM ~${money(npMins[b.dataset.sym])} FOR THIS COIN`;
    } else {
      b.removeAttribute("aria-disabled");
      b.title = "";
    }
  });
  const active = document.querySelector(".payscreen__tab--on");
  if (active && active.classList.contains("payscreen__tab--off")) showMinAlert(active.dataset.sym);
}

function isGroupBelowMin(group) {
  const { n, total } = totals();
  if (!npMins || n === 0) return false;
  return group.assets.every((s) => isBelowMinSym(s, total));
}

function firstAffordableGroup(excludeValue) {
  return (
    PAYMENT_GROUPS.find((g) => g.value !== excludeValue && !isGroupBelowMin(g)) || null
  );
}

function updatePaygridLocks() {
  const { n, total } = totals();
  const enforce = n > 0 && !!npMins;
  document.querySelectorAll(".paygrid__opt").forEach((b) => {
    const group = PAYMENT_GROUPS.find((g) => g.value === b.dataset.value);
    if (!group) return;
    const blocked =
      enforce &&
      npMins &&
      group.assets.every((s) => typeof npMins[s] === "number" && total < npMins[s]);
    b.classList.toggle("paygrid__opt--off", blocked);
    b.disabled = blocked;
    if (blocked) {
      const cheapest = Math.min(
        ...group.assets.map((s) => npMins[s]).filter(Number.isFinite)
      );
      b.setAttribute("aria-disabled", "true");
      b.title = `MINIMUM ~${money(cheapest)} FOR THIS METHOD \u2014 NETWORK FEES`;
    } else {
      b.removeAttribute("aria-disabled");
      b.title = "";
    }
  });
}

function appendFallbackChips() {
  const tabs = $("payscreen-tabs");
  tabs.hidden = false;
  FALLBACK_SYMS.forEach((sym) => {
    if (!tabs.querySelector(`[data-sym="${sym}"]`)) tabs.appendChild(buildCoinChip(sym));
  });
  refreshChipLocks();
}

// Internal server validation text (e.g. "INVALID TOTAL") is never shown to the
// buyer — it maps to clear, actionable copy instead.
const CHECKOUT_ERROR_COPY = {
  "INVALID TOTAL": "CHECKOUT COULD NOT START \u2014 PLEASE TRY ANOTHER PAYMENT METHOD.",
  "EMPTY CART": "YOUR CART IS EMPTY.",
  "INVALID FREE PICKS": "PLEASE RESELECT YOUR FREE LEASE."
};

async function startNpPayment(sym) {
  const asset = ASSETS[sym];
  if (!asset || !payScreenOrder) return;
  payScreenSym = sym;
  markActiveTab(sym);
  stopNpPolling();
  npPayment = null;
  $("payscreen-payblock").hidden = true;
  setNpStatus("GENERATING SECURE " + asset.sym + " ADDRESS\u2026");

  try {
    if (TOKEN_PERKS_ENABLED && payScreenOrder.walletAddress) {
      if (connectedWalletAddress?.toLowerCase() !== payScreenOrder.walletAddress.toLowerCase()) throw new Error("WALLET CHANGED — START CHECKOUT AGAIN");
      walletProof = await signWalletProof();
      const verification = await workerRequest("/api/verify-token", { method: "POST", body: JSON.stringify({ walletAddress: connectedWalletAddress, proof: walletProof }) });
      isTokenHolder = verification.holder;
      updateWalletButton();
      payScreenOrder.total = Math.round((payScreenOrder.subtotal - payScreenOrder.discount) * (isTokenHolder ? 85 : 100)) / 100;
      $("payscreen-total").textContent = money(payScreenOrder.total);
    }
    npPayment = await workerRequest("/api/checkout", {
      method: "POST",
      body: JSON.stringify({
        order_id: npPayment && npPayment.order_id,
        email: payScreenOrder.email,
        coinSym: sym,
        total: payScreenOrder.total,
        labeled: payScreenOrder.labeled,
        subtotal: payScreenOrder.subtotal,
        discount: payScreenOrder.discount,
        items: payScreenOrder.items,
        freePicks: payScreenOrder.freePicks,
        exclusivePicks: payScreenOrder.exclusivePicks || [],
        walletAddress: TOKEN_PERKS_ENABLED ? payScreenOrder.walletAddress : null,
        proof: TOKEN_PERKS_ENABLED && payScreenOrder.walletAddress ? walletProof : null
      })
    });
    const alertEl = $("payscreen-alert");
    if (alertEl) alertEl.hidden = true;
    renderNpPayment();
    startNpPolling(String(npPayment.order_id));
  } catch (err) {
    console.error("Checkout failed:", err);
    const msg = String((err && err.message) || "");
    if (/less than minimal|minimum|minimal/i.test(msg)) {
      showMinAlert(sym);
      setNpStatus("AMOUNT BELOW " + sym + " MINIMUM \u2014 PICK ANOTHER COIN", "warn");
    } else {
      setNpStatus(CHECKOUT_ERROR_COPY[msg.trim()] || msg.toUpperCase() || "CHECKOUT ERROR \u2014 PICK A COIN TO RETRY", "warn");
    }
  }
}

function renderNpPayment() {
  if (!npPayment) return;
  $("payscreen-equiv").textContent = `${npPayment.pay_amount} ${String(npPayment.pay_currency).toUpperCase()}`;
  const network = { usdtsol: "SOLANA", sol: "SOLANA", btc: "BITCOIN", eth: "ETHEREUM", ltc: "LITECOIN" }[String(npPayment.pay_currency).toLowerCase()];
  $("payscreen-network").textContent = network ? `SEND VIA ${network} NETWORK` : "FOLLOW THE INVOICE NETWORK";
  $("payscreen-address").textContent = npPayment.pay_address;
  renderPayQr(npPayment.pay_address);
  $("payscreen-payblock").hidden = false;
  const btn = $("copy-address");
  btn.disabled = false;
  btn.textContent = "COPY ADDRESS";
}

function renderPayQr(address) {
  const host = $("payscreen-qr");
  if (!host || !address || typeof qrcode !== "function") return;
  host.innerHTML = "";
  try {
    const qr = qrcode(0, "M");
    qr.addData(address);
    qr.make();
    host.innerHTML = qr.createImgTag(5, 8);
  } catch (err) {
    console.error("QR render failed:", err);
  }
}

function startNpPolling(orderId) {
  stopNpPolling();
  npPollTimer = setInterval(async () => {
    try {
      const s = await workerRequest("/api/status?order_id=" + encodeURIComponent(orderId));
      if (s.released) {
        // Payment verified — the email is the delivery channel, so close the
        // payment screen and show the clean order-confirmed modal.
        stopNpPolling();
        const order = payScreenOrder || lastOrder;
        const hasExclusive = (s.links || []).some((l) => l.isExclusive);
        (s.links || []).forEach((l) => { if (l.isExclusive && l.id) EXCLUSIVE_SOLD.add(l.id); });
        hidePayscreen();
        showSuccessModal(order, hasExclusive
          ? "EXCLUSIVE MASTER RIGHTS \u2014 FILES & LICENSES EMAILED"
          : "PAYMENT VERIFIED \u2014 FILES & LICENSES EMAILED");
        return;
      }
      const st = String(s.status || "").toLowerCase();
      if (["confirmed", "sending", "finished"].includes(st)) {
        setNpStatus("PAYMENT CONFIRMED \u2014 RELEASING FILES\u2026", "warn");
      } else {
        const mode = st === "waiting" ? undefined : "warn";
        setNpStatus(NP_STATUS_COPY[st] || st.toUpperCase(), mode);
        if (["failed", "refunded", "expired"].includes(st)) stopNpPolling();
      }
    } catch {}
  }, 5000);
}

function stopNpPolling() {
  if (npPollTimer) {
    clearInterval(npPollTimer);
    npPollTimer = null;
  }
}

// Email-only delivery: this modal is a clean confirmation, never a download
// list. Every secure link, PDF/TXT license, and file reaches the buyer by email.
function showSuccessModal(order, statusText) {
  payScreenOrder = order;
  const emailEl = $("success-email");
  if (emailEl) emailEl.textContent = (order && order.email) || "";
  const totalEl = $("success-total");
  if (totalEl) totalEl.textContent = money(order && Number.isFinite(order.total) ? order.total : 0);
  const errorEl = $("form-error");
  if (errorEl) errorEl.hidden = true;
  const alertEl = $("payscreen-alert");
  if (alertEl) alertEl.hidden = true;
  setSuccessStatus(statusText || "ORDER CONFIRMED — EMAIL DISPATCHED");

  const modal = $("success-modal");
  if (modal) modal.hidden = false;
}

function setSuccessStatus(text) {
  const statusEl = $("success-status");
  if (statusEl) statusEl.textContent = text;
}

// Free / 100%-off checkout: persists the $0 order so the branded delivery email
// goes out, then reflects the real dispatch outcome in the confirmation modal.
async function completeFreeOrder(order) {
  showSuccessModal(order, "ORDER CONFIRMED — PREPARING EMAIL…");
  try {
    const res = await workerRequest("/api/checkout", {
      method: "POST",
      body: JSON.stringify({
        email: order.email,
        coinSym: "USDT",
        total: 0,
        items: order.items,
        freePicks: order.freePicks,
        exclusivePicks: order.exclusivePicks || [],
        promoCode: order.promoCode
      })
    });
    const hasExclusive = (res.links || []).some((l) => l.isExclusive);
    const prefix = hasExclusive ? "EXCLUSIVE MASTER RIGHTS" : "ORDER CONFIRMED";
    setSuccessStatus(res.delivery && res.delivery.status === "sent"
      ? `${prefix} — FILES & LICENSES EMAILED`
      : `${prefix} — EMAIL DELIVERY PENDING`);
  } catch (err) {
    console.error("Free order dispatch failed:", err);
    setSuccessStatus("ORDER CONFIRMED — EMAIL DELIVERY PENDING");
  }
}

function showPayscreen(order) {
  if (!order || !payscreen) return;
  if (order.total <= 0) {
    completeFreeOrder(order);
    return;
  }
  payScreenOrder = order;
  const titleEl = payscreen.querySelector(".payscreen__title");
  if (titleEl) titleEl.textContent = "COMPLETE YOUR PAYMENT";
  $("payscreen-total").textContent = money(order.total);
  const tabs = $("payscreen-tabs");
  tabs.innerHTML = "";
  if ($("payscreen-payblock")) $("payscreen-payblock").hidden = false;
  const syms = order.group ? order.group.assets : ["USDT"];
  syms.forEach((sym) => tabs.appendChild(buildCoinChip(sym)));
  tabs.hidden = syms.length < 2;
  payscreen.hidden = false;
  selectInitialCoin(syms);
}

async function selectInitialCoin(syms) {
  setNpStatus("CHECKING NETWORK MINIMUMS\u2026");
  await loadMins();
  const available = syms.filter((s) => !isBelowMin(s));
  if (!available.length) {
    showMinAlert(syms[0]);
    setNpStatus("AMOUNT BELOW MINIMUM \u2014 PICK A SUPPORTED COIN", "warn");
    return;
  }
  startNpPayment(available[0]);
}

// Polls the worker's catalog endpoint so exclusive-sold beats flip to SOLD OUT
// on the grid moments after an IPN fulfillment — no manual refresh needed.
// Diff-gated: only triggers a re-render when the sold set actually changes.
let exclusiveRefreshTimer = null;
async function refreshExclusiveStatus() {
  if (exclusiveRefreshTimer) clearTimeout(exclusiveRefreshTimer);
  if (!WORKER_URL) return;
  try {
    const data = await workerRequest("/api/catalog");
    const sold = new Set(data && Array.isArray(data.sold) ? data.sold : []);
    let changed = false;
    sold.forEach((id) => { if (!EXCLUSIVE_SOLD.has(id)) { EXCLUSIVE_SOLD.add(id); changed = true; } });
    EXCLUSIVE_SOLD.forEach((id) => { if (!sold.has(id)) { EXCLUSIVE_SOLD.delete(id); changed = true; } });
    if (changed) {
      sold.forEach((id) => { selected.delete(id); exclusiveSelected.delete(id); freePicks.delete(id); });
      buildGrid();
      render();
    }
  } catch {}
  exclusiveRefreshTimer = setTimeout(refreshExclusiveStatus, 60000);
}

function markActiveTab(sym) {
  document.querySelectorAll(".payscreen__tab").forEach((b) => {
    b.classList.toggle("payscreen__tab--on", b.dataset.sym === sym);
  });
}

async function copyPayAddress() {
  const addr = npPayment && npPayment.pay_address;
  if (!addr) return;
  try {
    await navigator.clipboard.writeText(addr);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = addr;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const btn = $("copy-address");
  btn.disabled = true;
  btn.textContent = "COPIED";
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "COPY ADDRESS";
  }, 1600);
}

function hidePayscreen() {
  if (!payscreen || payscreen.hidden) return false;
  stopNpPolling();
  payscreen.hidden = true;
  payScreenOrder = null;
  payScreenSym = null;
  npPayment = null;
  const qrHost = $("payscreen-qr");
  if (qrHost) qrHost.innerHTML = "";
  return true;
}

function resetDrawer() {
  $("email").value = "";
  $("payment").value = "";
  $("promo-code").value = "";
  $("promo-error").hidden = true;
  appliedPromoCode = null;
  persistPromo(null);
  document.querySelectorAll(".paygrid__opt").forEach((b) => {
    b.classList.remove("paygrid__opt--on");
    b.setAttribute("aria-checked", "false");
  });
  $("paygrid").classList.remove("invalid");
  closeDrawer();
  render();
}

function rebuildCatalog() {
  const isHome = !new URLSearchParams(location.search).has("beat");
  if (isHome) {
    closeDrawer();
    hidePayscreen();
    const successModal = $("success-modal");
    if (successModal) successModal.hidden = true;
    const walletModal = $("wallet-modal");
    if (walletModal) walletModal.hidden = true;
    unlockScroll();
  }
  buildGrid();
  render();
}

buildPaygrid();
restorePromo();
rebuildCatalog();
startBtc();
loadMins();
refreshExclusiveStatus();
window.addEventListener("hashchange", handleDeepHash);
window.addEventListener("popstate", () => {
  unlockScroll();
  rebuildCatalog();
});
handleDeepHash();

if (!WORKER_URL) $("config-warning").hidden = false;

cartbar.addEventListener("click", openDrawer);
$("close").addEventListener("click", closeDrawer);
backdrop.addEventListener("click", () => {
  closeDrawer();
  hidePayscreen();
  const successModal = $("success-modal");
  if (successModal) successModal.hidden = true;
  unlockScroll();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const walletModal = $("wallet-modal");
  if (walletModal && !walletModal.hidden) {
    walletModal.hidden = true;
    unlockScroll();
    return;
  }
  const successModal = $("success-modal");
  if (successModal && !successModal.hidden) {
    successModal.hidden = true;
    unlockScroll();
    resetDrawer();
    window.scrollTo({ top: 0 });
    return;
  }
  if (hidePayscreen()) window.scrollTo({ top: 0 });
  else closeDrawer();
});
$("cart-items").addEventListener("click", (e) => {
  const free = e.target.closest(".cart-items__free");
  if (free) {
    toggleFreePick(free.dataset.free);
    return;
  }
  const btn = e.target.closest(".cart-items__remove");
  if (btn) {
    const id = btn.dataset.id;
    const type = btn.dataset.type;
    if (type === "exclusive") {
      exclusiveSelected.delete(id);
    } else {
      selected.delete(id);
      freePicks.delete(id);
    }
    render();
  }
});
$("order-form").addEventListener("submit", submitOrder);
$("apply-promo-btn")?.addEventListener("click", applyPromoCode);
$("promo-tag-remove")?.addEventListener("click", clearPromo);
$("promo-code")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applyPromoCode();
  }
});
$("payscreen-close").addEventListener("click", () => {
  hidePayscreen();
  resetDrawer();
  window.scrollTo({ top: 0 });
});
$("success-close")?.addEventListener("click", () => {
  const successModal = $("success-modal");
  if (successModal) successModal.hidden = true;
  unlockScroll();
  resetDrawer();
  window.scrollTo({ top: 0 });
});
$("copy-address").addEventListener("click", copyPayAddress);

grid.addEventListener("click", (e) => {
  const link = e.target.closest(".catalog-tile__link");
  if (link) {
    e.preventDefault();
    unlockScroll();
    history.pushState(null, "", link.href);
    rebuildCatalog();
    window.scrollTo({ top: 0 });
    return;
  }
  const btn = e.target.closest(".card__btn");
  if (!btn || btn.disabled) return;
  toggle(btn.dataset.id, btn.dataset.type);
});
$("all-beats-link").addEventListener("click", (e) => {
  e.preventDefault();
  unlockScroll();
  history.pushState(null, "", e.currentTarget.href);
  rebuildCatalog();
  $("grid").scrollIntoView({ block: "start" });
});

const walletModal = $("wallet-modal");
const walletModalClose = $("wallet-modal-close");
const walletModalTitle = $("wallet-modal-title");
const walletModalDesc = $("wallet-modal-desc");
const walletModalSub = $("wallet-modal-sub");
const walletSelectList = $("wallet-select-list");
const walletInlineState = $("wallet-inline-state");

async function disconnectWalletSession() {
  connectedWalletAddress = null;
  isTokenHolder = false;
  walletProof = null;
  walletProvider?.removeListener?.("accountsChanged", onWalletAccountsChanged);
  walletProvider?.removeListener?.("chainChanged", onWalletChainChanged);
  walletProvider = null;
  updateCashbackNotice();
  updateWalletButton();
  render();
  openWalletModal();
}

function openWalletModal() {
  if (!walletModal) return;
  if (walletModalTitle) walletModalTitle.textContent = connectedWalletAddress ? "BASE WALLET LINKED" : "CONNECT BASE WALLET";
  if (walletModalDesc) walletModalDesc.textContent = connectedWalletAddress
    ? `${connectedWalletAddress.slice(0, 6)}…${connectedWalletAddress.slice(-4)} · ${isTokenHolder ? "HOLDER · 15% OFF" : "NO HOLDER BALANCE DETECTED"}`
    : "Verify KYROlll holdings on Base for 15% off. Link a wallet for future rewards.";
  if (walletModalSub) walletModalSub.hidden = false;
  if (walletSelectList) {
    walletSelectList.hidden = false;
    walletSelectList.innerHTML = connectedWalletAddress
      ? '<button class="wallet-option-btn" id="recheck-wallet" type="button">RECHECK BALANCE</button><button class="wallet-option-btn" id="disconnect-wallet" type="button">DISCONNECT</button>'
      : '<button class="wallet-option-btn" id="connect-base" type="button">CONNECT EVM WALLET</button>';
    $("connect-base")?.addEventListener("click", connectBaseWallet);
    $("recheck-wallet")?.addEventListener("click", verifyConnectedWallet);
    $("disconnect-wallet")?.addEventListener("click", disconnectWalletSession);
  }
  if (walletInlineState) {
    walletInlineState.hidden = true;
    walletInlineState.innerHTML = "";
  }
  walletModal.hidden = false;
}

function closeWalletModal() {
  if (!walletModal) return;
  walletModal.hidden = true;
  unlockScroll();
}

function updateWalletButton() {
  $("wallet-btn-text").textContent = connectedWalletAddress
    ? `${connectedWalletAddress.slice(0, 6)}…${connectedWalletAddress.slice(-4)}${isTokenHolder ? " · 15% OFF" : " · BASE"}`
    : "CONNECT WALLET";
  $("wallet-btn").classList.toggle("wallet-btn--holder", isTokenHolder);
}

async function signWalletProof() {
  if (!walletProvider || !connectedWalletAddress) throw new Error("CONNECT YOUR BASE WALLET AGAIN");
  const accounts = await walletProvider.request({ method: "eth_accounts" });
  if (!accounts.some((account) => account.toLowerCase() === connectedWalletAddress.toLowerCase())) {
    await disconnectWalletSession();
    throw new Error("WALLET ACCOUNT CHANGED — RECONNECT");
  }
  const timestamp = Date.now();
  const message = `KYROlll Base holder verification\nWallet: ${connectedWalletAddress}\nTimestamp: ${timestamp}`;
  const signature = await walletProvider.request({ method: "personal_sign", params: ["0x" + Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, "0")).join(""), connectedWalletAddress] });
  return { timestamp, signature };
}

async function verifyConnectedWallet() {
  walletModalTitle.textContent = "CHECKING BASE BALANCE";
  walletModalDesc.textContent = "Sign a free message to verify wallet ownership.";
  walletSelectList.hidden = true;
  walletInlineState.hidden = false;
  walletInlineState.textContent = "VERIFYING…";
  try {
    walletProof = await signWalletProof();
    const result = await workerRequest("/api/verify-token", { method: "POST", body: JSON.stringify({ walletAddress: connectedWalletAddress, proof: walletProof }) });
    if (!connectedWalletAddress) return;
    isTokenHolder = result.holder === true;
    updateWalletButton();
    updateCashbackNotice();
    render();
    walletModalTitle.textContent = isTokenHolder ? "HOLDER VERIFIED" : "WALLET CONNECTED";
    walletModalDesc.textContent = isTokenHolder ? "15% off applied to your cart." : "No KYROlll tokens detected on Base yet.";
    walletInlineState.textContent = isTokenHolder ? "BASE · 15% OFF ACTIVE" : "RECHECK AFTER THE TOKEN DEPLOYS OR YOUR BALANCE UPDATES.";
  } catch (err) {
    isTokenHolder = false;
    updateWalletButton();
    render();
    walletModalTitle.textContent = "VERIFICATION UNAVAILABLE";
    walletModalDesc.textContent = err.message || "Try again later.";
    walletInlineState.textContent = "HOLDER DISCOUNT IS NOT ACTIVE.";
  }
  if (!connectedWalletAddress) return;
  walletSelectList.hidden = false;
  walletSelectList.innerHTML = '<button class="wallet-option-btn" id="recheck-wallet" type="button">RECHECK BALANCE</button><button class="wallet-option-btn" id="disconnect-wallet" type="button">DISCONNECT</button>';
  $("recheck-wallet").addEventListener("click", verifyConnectedWallet);
  $("disconnect-wallet").addEventListener("click", disconnectWalletSession);
}

async function connectBaseWallet() {
  walletProvider = window.ethereum;
  if (!walletProvider) {
    walletInlineState.hidden = false;
    walletInlineState.textContent = "INSTALL A BASE-COMPATIBLE WALLET TO CONTINUE.";
    return;
  }
  try {
    await walletProvider.request({ method: "eth_requestAccounts" });
    try {
      await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] });
    } catch (err) {
      if (err.code !== 4902) throw err;
      await walletProvider.request({ method: "wallet_addEthereumChain", params: [{ chainId: BASE_CHAIN_ID, chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }] });
    }
    const accounts = await walletProvider.request({ method: "eth_accounts" });
    if (!accounts[0]) throw new Error("NO WALLET ACCOUNT AVAILABLE");
    connectedWalletAddress = accounts[0];
    walletProvider.on?.("accountsChanged", onWalletAccountsChanged);
    walletProvider.on?.("chainChanged", onWalletChainChanged);
    await verifyConnectedWallet();
  } catch (err) {
    walletModalTitle.textContent = "CONNECTION FAILED";
    walletModalDesc.textContent = err.message || "Wallet request declined.";
  }
}

function onWalletAccountsChanged() { disconnectWalletSession(); }
function onWalletChainChanged(chainId) { if (chainId !== BASE_CHAIN_ID) disconnectWalletSession(); }

const walletBtn = $("wallet-btn");
if (TOKEN_PERKS_ENABLED && walletBtn) {
  walletBtn.addEventListener("click", openWalletModal);
}

if (TOKEN_PERKS_ENABLED && walletModalClose) {
  walletModalClose.addEventListener("click", closeWalletModal);
}

if (TOKEN_PERKS_ENABLED && walletModal) {
  walletModal.addEventListener("click", (e) => {
    if (e.target === walletModal) closeWalletModal();
  });
}
