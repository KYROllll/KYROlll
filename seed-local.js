/* KYROlll — local/demo seed of test licenses for quick verification.
 * No service_role needed; writes into the browser's local library cache
 * (same format as addLicense()) so listLicenses() picks them up instantly.
 * Usage: open index.html (or library.html) and run in console:
 *   seedLocal({ beatId: 'flesh', tiers: ['mp3','wav','exclusive'] })
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  window.seedLocalLicenses = function (opts) {
    opts = opts || {};
    const b = window.KYROlll_BACKEND;
    if (!b || !b.licenses || !b.auth) { console.warn("KYROlll backend not loaded"); return; }
    const user = b.auth.currentUser();
    const beatId = opts.beatId || "flesh";
    const tiers = opts.tiers || ["mp3", "wav", "exclusive"];
    const beat = (window.KYROlll_CATALOG || []).find(function (c) { return c.id === beatId; }) || { id: beatId, title: beatId, img: "assets/flesh.png" };
    const tierDefs = (window.KYROlll_LICENSES || []).filter(function (t) { return tiers.indexOf(t.id) >= 0; });
    if (!user) { console.warn("Not signed in — seed requires an account to bind licenses to."); return; }
    const now = Date.now();
    tierDefs.forEach(function (tier, i) {
      b.licenses.add({
        id: "seed_" + tier.id + "_" + Date.now().toString(36),
        beatId: beatId,
        beatTitle: beat.title || beatId,
        tierId: tier.id,
        tier: tier.name,
        price: tier.price,
        purchasedAt: new Date(now - i * 86400000).toISOString()
      }).then(function () { console.log("Seeded: " + beatId + " / " + tier.id); }).catch(function (e) { console.warn("Seed failed for " + tier.id, e); });
    });
    console.log("Seed started for user " + (user.id || "?") + " — refresh library.html to see.");
  };
})();
