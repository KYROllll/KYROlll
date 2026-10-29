/* KYROIII — SUPPORT DESK
   -------------------------------------------------------------------------
   The footer's SUPPORT control no longer opens a mail app: it opens this
   dialog, built once on <body> and shared by every page that loads the script
   (index.html, download.html and support.html). support.html also mounts the
   same form inline, so the desk is reachable as a dedicated view as well as a
   modal — one renderer, one validator, one submit path.

   The form is three fields — email, subject, message — with no dropdown or
   category to choose. Every ticket is posted as rich JSON (email, subject,
   message, timestamp, device, page and viewport) with `Accept:
   application/json` to the KYROIII — SUPPORT TICKETS Formspree form, and only
   there. The free-download gates post to their own separate form: this script
   never reads the newsletter endpoint and never posts a ticket into the
   download flow. The card is then replaced by the
   success state. Nothing is stored in the browser: no draft, no address, no
   ticket id.

   The dialog is a phone citizen like the download gate: its sheet scrolls
   inside itself, it pins the page's scroll offset while open, and it is closed
   only by its own CLOSE control or Escape — a stray backdrop tap cannot wipe a
   half-written message.
*/
(function () {
  "use strict";

  /* The desk's own form, hard-wired and never resolved from the catalog: the
     KYROIII — FREE DOWNLOADS form belongs to the download gates and a support
     ticket must never land in it. */
  var SUPPORT_ENDPOINT = "https://formspree.io/f/mrpplrlg";
  var EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  var MIN_SUBJECT = 3;
  var MIN_MESSAGE = 12;

  function endpoint() {
    return SUPPORT_ENDPOINT;
  }

  function formHTML() {
    return ''
      + '<form class="support-form" data-support-form novalidate>'
      + '  <div class="support-grid">'
      + '    <div class="support-field">'
      + '      <label class="support-label" for="support-email">YOUR EMAIL</label>'
      + '      <input class="support-input" id="support-email" name="email" type="email" inputmode="email"'
      + ' autocomplete="email" placeholder="YOU@STUDIO.COM" maxlength="160" required>'
      + "    </div>"
      + '    <div class="support-field">'
      + '      <label class="support-label" for="support-subject">SUBJECT</label>'
      + '      <input class="support-input" id="support-subject" name="subject" type="text"'
      + ' placeholder="WHAT IS THIS ABOUT?" maxlength="120" required>'
      + "    </div>"
      + "  </div>"
      + '  <div class="support-field">'
      + '    <label class="support-label" for="support-message">DETAILED MESSAGE</label>'
      + '    <textarea class="support-input support-textarea" id="support-message" name="message" rows="5"'
      + ' placeholder="TELL US EVERYTHING WE NEED TO KNOW — BEAT, PACKAGE, WHAT WENT WRONG." maxlength="2000" required></textarea>'
      + "  </div>"
      + '  <p class="support-error" data-support-error role="alert" hidden></p>'
      + '  <div class="support-actions">'
      + '    <button type="button" class="support-close" data-support-close>CLOSE</button>'
      + '    <button type="submit" class="support-submit" data-support-submit>OPEN A TICKET</button>'
      + "  </div>"
      + '  <p class="support-note">EVERY MESSAGE IS READ BY THE STUDIO AND ANSWERED BY EMAIL.</p>'
      + "</form>";
  }

  function successHTML() {
    return ''
      + '<div class="support-success" data-support-success role="status">'
      + '  <span class="support-success__tick" aria-hidden="true">'
      + '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>'
      + "  </span>"
      + '  <p class="support-success__title">MESSAGE SENT SUCCESSFULLY // WE WILL GET BACK TO YOU SOON</p>'
      + '  <p class="support-success__sub">YOUR TICKET IS WITH THE STUDIO. REPLIES COME FROM KYROLLL00@GMAIL.COM.</p>'
      + '  <button type="button" class="support-submit" data-support-done>BACK TO THE STORE</button>'
      + "</div>";
  }

  function errorFor(data) {
    if (!EMAIL.test(data.email)) return "THAT EMAIL ADDRESS DOESN'T LOOK RIGHT — CHECK IT AND TRY AGAIN.";
    if (data.subject.length < MIN_SUBJECT) return "ADD A SHORT SUBJECT — AT LEAST " + MIN_SUBJECT + " CHARACTERS.";
    if (data.message.length < MIN_MESSAGE) return "TELL US A LITTLE MORE — AT LEAST " + MIN_MESSAGE + " CHARACTERS.";
    return "";
  }

  function readForm(form) {
    return {
      email: (form.querySelector("#support-email").value || "").trim(),
      subject: (form.querySelector("#support-subject").value || "").trim(),
      message: (form.querySelector("#support-message").value || "").trim(),
    };
  }

  function setError(form, message) {
    var box = form.querySelector("[data-support-error]");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
  }

  function setBusy(form, busy) {
    var submit = form.querySelector("[data-support-submit]");
    form.classList.toggle("is-busy", busy);
    if (submit) {
      submit.disabled = busy;
      submit.textContent = busy ? "SENDING…" : "OPEN A TICKET";
    }
  }

  function payloadFor(data) {
    return {
      form: "KYROIII — SUPPORT DESK",
      email: data.email,
      subject: data.subject,
      message: data.message,
      submittedAt: new Date().toISOString(),
      page: location.pathname + location.search,
      referrer: document.referrer || "DIRECT",
      device: navigator.userAgent,
      viewport: window.innerWidth + "x" + window.innerHeight,
      language: navigator.language || "",
    };
  }

  async function send(form, host) {
    var data = readForm(form);
    var problem = errorFor(data);
    if (problem) {
      setError(form, problem);
      var target = form.querySelector(
        !EMAIL.test(data.email) ? "#support-email" : (data.subject.length < MIN_SUBJECT ? "#support-subject" : "#support-message")
      );
      if (target && target.focus) target.focus();
      return false;
    }
    setError(form, "");
    setBusy(form, true);
    try {
      var response = await fetch(endpoint(), {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payloadFor(data)),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      host.innerHTML = successHTML();
      var done = host.querySelector("[data-support-done]");
      if (done) done.focus();
      return true;
    } catch (err) {
      setError(form, "COULDN'T SEND RIGHT NOW — CHECK YOUR CONNECTION AND TRY AGAIN.");
      return false;
    } finally {
      setBusy(form, false);
    }
  }

  function wireForm(host) {
    var form = host.querySelector("[data-support-form]");
    if (!form) return;
    var email = form.querySelector("#support-email");
    if (email) email.addEventListener("input", function () {
      var valid = EMAIL.test(email.value.trim());
      email.classList.toggle("is-valid", valid);
      setError(form, "");
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      send(form, host);
    });
    form.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && event.target && event.target.tagName === "INPUT") {
        event.preventDefault();
        send(form, host);
      }
    });
  }

  /* One delegated pair for the two buttons the success/close states render, so
     re-opening the desk never stacks listeners on the same node. CLOSE is the
     dialog's only exit (its backdrop carries no dismiss attribute); on the
     inline desk it simply re-arms the form in place. */
  function onDocumentClick(event) {
    if (!event.target || !event.target.closest) return;
    if (event.target.closest("[data-support-close]")) {
      close();
      return;
    }
    if (event.target.closest("[data-support-done]")) {
      if (modal && !modal.hidden) close();
      else mountInline();
    }
  }

  /* ---------------------------------------------------------------- dialog */
  var modal = null;
  var scrollY = 0;

  function lock() {
    scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add("support-open");
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function unlock() {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.documentElement.classList.remove("support-open");
    if (scrollY) window.scrollTo(0, scrollY);
    scrollY = 0;
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "support-modal";
    modal.id = "support-modal";
    modal.hidden = true;
    modal.innerHTML = ''
      + '<div class="support-sheet" role="dialog" aria-modal="true" aria-labelledby="support-title">'
      + '  <div class="support-sheet__head">'
      + '    <span class="support-sheet__kicker">KYROIII SUPPORT</span>'
      + '    <h2 class="support-sheet__title" id="support-title">HOW CAN WE HELP?</h2>'
      + '    <p class="support-sheet__sub">NO ACCOUNT NEEDED — TELL US WHAT YOU NEED, AND WE\'LL REPLY BY EMAIL.</p>'
      + "  </div>"
      + '  <div class="support-sheet__body" data-support-body></div>'
      + "</div>";
    document.body.appendChild(modal);
    return modal;
  }

  function open() {
    var dialog = ensureModal();
    var host = dialog.querySelector("[data-support-body]");
    host.innerHTML = formHTML();
    wireForm(host);
    dialog.hidden = false;
    document.documentElement.classList.add("support-open");
    lock();
    var first = host.querySelector("#support-email");
    if (first) first.focus();
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.removeEventListener("keydown", onKeydown);
    unlock();
    var trigger = document.querySelector("[data-support-open]");
    if (trigger && trigger.focus) trigger.focus();
  }

  function onKeydown(event) {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      close();
    }
  }

  function mountInline() {
    var host = document.querySelector("[data-support-inline]");
    if (!host) return;
    host.innerHTML = formHTML();
    wireForm(host);
  }

  document.addEventListener("click", function (event) {
    if (!event.target || !event.target.closest) return;
    var trigger = event.target.closest("[data-support-open]");
    if (!trigger) return;
    event.preventDefault();
    open();
  });
  document.addEventListener("click", onDocumentClick);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountInline);
  } else {
    mountInline();
  }

  window.KYROlll_SUPPORT = {
    open: open,
    close: close,
    endpoint: SUPPORT_ENDPOINT,
    fields: ["email", "subject", "message"],
  };
})();
