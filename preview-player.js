// One controller for the entire grid, including cards added by later renders.
class BeatPreviewPlayer {
  constructor(root) {
    this.root = root;
    this.active = null;
    this.request = 0;
    root.addEventListener("click", (event) => {
      const button = event.target.closest(".beat-preview__toggle");
      if (button) this.toggle(button.closest(".beat-preview").querySelector("audio"));
    });
    root.addEventListener("input", (event) => {
      if (!event.target.matches(".beat-preview__seek")) return;
      const audio = event.target.closest(".beat-preview").querySelector("audio");
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Number(event.target.value) / 100 * audio.duration;
        this.update(audio);
      }
    });
    for (const type of ["play", "playing", "pause", "ended", "waiting", "error", "timeupdate", "loadedmetadata", "durationchange"]) {
      root.addEventListener(type, (event) => {
        const audio = event.target;
        if (!audio.matches(".beat-preview__audio")) return;
        if ((type === "play" || type === "playing") && this.active !== audio) {
          audio.pause();
          return;
        }
        const player = audio.closest(".beat-preview");
        if (!player) return;
        if (type === "error") {
          if (!audio.dataset.fallback || audio.dataset.fallbackTried) this.fail(audio);
          return;
        }
        if (type === "waiting" && this.active === audio) player.dataset.state = "loading";
        if (type === "playing") player.dataset.state = "playing";
        if (type === "ended" || (type === "pause" && audio.paused)) {
          if (this.active === audio) {
            this.active = null;
            this.request++;
          }
          if (player.dataset.state !== "error") player.dataset.state = "idle";
        }
        this.update(audio);
      }, true);
    }
  }

  stop() {
    this.request++;
    const audio = this.active;
    this.active = null;
    if (!audio) return;
    audio.pause();
    const player = audio.closest(".beat-preview");
    if (player) player.dataset.state = "idle";
    this.update(audio);
  }

  async toggle(audio) {
    if (this.active === audio) {
      this.stop();
      return;
    }
    this.stop();
    const request = ++this.request;
    this.active = audio;
    const player = audio.closest(".beat-preview");
    if (player) player.dataset.state = "loading";
    this.update(audio);
    try {
      if (audio.error) audio.load();
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
    } catch {
      if (request !== this.request) return;
      if (audio.dataset.fallback && !audio.dataset.fallbackTried) {
        audio.dataset.fallbackTried = "true";
        audio.src = audio.dataset.fallback;
        audio.load();
        try { await audio.play(); } catch { if (request === this.request) this.fail(audio); }
      } else {
        this.fail(audio);
      }
    }
  }

  fail(audio) {
    if (this.active === audio) this.stop();
    const player = audio.closest(".beat-preview");
    if (player) player.dataset.state = "error";
    this.update(audio);
  }

  update(audio) {
    const player = audio.closest(".beat-preview");
    if (!player) return;
    const button = player.querySelector(".beat-preview__toggle");
    const seek = player.querySelector(".beat-preview__seek");
    const active = this.active === audio;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const time = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    const progress = duration ? Math.min(100, current / duration * 100) : 0;
    if (button) {
      button.setAttribute("aria-label", `${active ? "Pause" : "Play"} preview: ${player.dataset.title}`);
      button.setAttribute("aria-pressed", String(active));
    }
    if (seek) {
      seek.disabled = !duration;
      seek.value = progress;
      seek.style.setProperty("--preview-progress", `${progress}%`);
      seek.setAttribute("aria-valuetext", `${time(current)} of ${time(duration)}`);
    }
    const timeEl = player.querySelector(".beat-preview__time");
    if (timeEl) timeEl.textContent = `${time(current)} / ${duration ? time(duration) : "--:--"}`;
    const status = player.dataset.state === "error"
      ? "PREVIEW UNAVAILABLE — TAP TO RETRY"
      : player.dataset.state === "loading" && active ? "LOADING PREVIEW…" : "AUDIO PREVIEW";
    const statusElement = player.querySelector(".beat-preview__status");
    if (statusElement && statusElement.textContent !== status) statusElement.textContent = status;
  }
}
