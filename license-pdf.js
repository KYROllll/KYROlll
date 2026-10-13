/* KYROlll — PDF license certificates.
 *
 * Builds and downloads an officially styled certificate with jsPDF (vendored
 * at assets/jspdf.min.js). The grant text is taken from the tier in
 * catalog.js, so every lease prints the rights that were actually purchased. */
(function () {
  "use strict";

  const INK = [8, 8, 9];
  const PAPER = [243, 243, 241];
  const GRAY = [150, 150, 156];

  function wrap(doc, text, maxWidth) {
    return doc.splitTextToSize(String(text || ""), maxWidth);
  }

  function download(license, user) {
    const lib = window.jspdf;
    if (!lib || !lib.jsPDF) {
      window.alert("PDF license engine is unavailable.");
      return;
    }
    const tier = (window.KYROlll_HELPERS && window.KYROlll_HELPERS.licenseById(license.tierId)) || {};
    const doc = new lib.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const W = 210;
    const H = 297;
    const M = 16;

    // Card stock
    doc.setFillColor(INK[0], INK[1], INK[2]);
    doc.rect(0, 0, W, H, "F");
    doc.setDrawColor(PAPER[0], PAPER[1], PAPER[2]);
    doc.setLineWidth(0.5);
    doc.rect(8, 8, W - 16, H - 16);
    doc.setLineWidth(0.2);
    doc.rect(11, 11, W - 22, H - 22);

    // Wordmark
    doc.setTextColor(PAPER[0], PAPER[1], PAPER[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(40);
    doc.text("KYROlll", W / 2, 44, { align: "center", charSpace: 1 });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text("OFFICIAL LICENSE CERTIFICATE", W / 2, 54, { align: "center", charSpace: 3 });

    doc.setDrawColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.setLineWidth(0.2);
    doc.line(M + 14, 62, W - M - 14, 62);

    // Details
    const rows = [
      ["LICENSE ID", String(license.id || "").toUpperCase()],
      ["ISSUED", String(license.date || new Date().toLocaleDateString())],
      ["BEAT", license.beatTitle || "UNTITLED BEAT"],
      ["TIER", license.tier || (tier.name || "STANDARD LICENSE")],
      ["PRICE PAID", license.price || tier.price || ""],
      ["LICENSEE", (user && user.username) || ""],
      ["EMAIL", (user && user.email) || ""]
    ];
    let y = 76;
    doc.setFontSize(11);
    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.text(label, M + 14, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(PAPER[0], PAPER[1], PAPER[2]);
      doc.text(wrap(doc, value, 108).slice(0, 2), M + 66, y);
      y += 9;
    });

    // Granted rights
    y += 4;
    doc.setDrawColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.setLineWidth(0.2);
    doc.line(M + 14, y, W - M - 14, y);
    y += 9;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(PAPER[0], PAPER[1], PAPER[2]);
    doc.setFontSize(12);
    doc.text("GRANT OF RIGHTS", M + 14, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(PAPER[0], PAPER[1], PAPER[2]);
    (tier.rights || ["License granted as described at checkout."]).forEach((line) => {
      doc.text("-", M + 14, y);
      doc.text(wrap(doc, line, 150), M + 20, y);
      y += 3.2 + wrap(doc, line, 150).length * 5;
    });

    // Footer
    doc.setDrawColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.line(M + 14, H - 40, W - M - 14, H - 40);
    doc.setFontSize(8.5);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text("This certificate is non-transferable and is the property of the licensee named above.", W / 2, H - 32, { align: "center" });
    doc.text("All rights not expressly granted remain the property of KYROlll.", W / 2, H - 27, { align: "center" });
    doc.setTextColor(PAPER[0], PAPER[1], PAPER[2]);
    doc.setFont("helvetica", "bold");
    doc.text("KYROlll   -   " + new Date().getFullYear(), W / 2, H - 19, { align: "center", charSpace: 2 });

    const safeId = String(license.id || "license").replace(/[^a-z0-9_-]/gi, "");
    doc.save("KYROlll-License-" + safeId + ".pdf");
  }

  window.KYROlll_LICENSE_PDF = { download };
})();
