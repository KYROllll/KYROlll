// Hero intro, scroll storytelling and reveal-on-scroll for the KYROlll storefront.
//
// Everything visual lives in CSS: this file only publishes a single 0 → 1
// scroll progress onto the hero (`--hero-p`) and flips a class on sections as
// they enter the viewport, so the page stays cheap to run on phones.
(() => {
  const hero = document.querySelector(".brand-hero");
  const page = document.documentElement;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = reducedMotion.matches;

  const syncPaused = (next) => {
    paused = reducedMotion.matches || next;
    schedule();
  };
  document.addEventListener("motion-toggle", (event) => syncPaused(event.detail.paused));
  reducedMotion.addEventListener("change", () => syncPaused(false));

  // --- hero parallax: the wordmark and the 3D flower drift apart on scroll ---
  let frame = 0;

  function paintHero() {
    frame = 0;
    const progress = paused || page.classList.contains("beat-page")
      ? 0
      : Math.min(1, Math.max(0, window.scrollY / (hero.offsetHeight || 1)));
    hero.style.setProperty("--hero-p", progress.toFixed(3));
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paintHero);
  }

  if (hero) {
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
    hero.style.setProperty("--hero-p", "0");
    schedule();
  }

  // --- entrance reveals for the sections below the fold ---
  const sections = document.querySelectorAll(
    ".marquee-banner, .promo-banner, .catalog-heading, .beat-navigation, .grid, .footer"
  );

  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    sections.forEach((section) => section.classList.add("reveal"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
    sections.forEach((section) => observer.observe(section));
  }

  // --- the bouncing arrow walks the visitor down to the beat catalog ---
  const cue = document.getElementById("scroll-cue");
  if (cue) {
    cue.addEventListener("click", (event) => {
      const catalog = document.getElementById("grid");
      if (!catalog) return;
      event.preventDefault();
      catalog.scrollIntoView({
        behavior: reducedMotion.matches || paused ? "auto" : "smooth",
        block: "start"
      });
    });
  }
})();
