// One controller for the entire grid, including cards added by later renders.
//
// While a preview plays, the player's soft white halo breathes with the track:
// one shared AudioContext feeds an analyser on the playing element, and a rAF
// loop writes the smoothed low-band spectral flux into the player's
// `--beat-level` custom property (the halo's opacity/scale are calc()-ed from
// it in style.css). It is opt-out, never required: if Web Audio is unavailable
// the halo simply holds one gentle static bloom, and under reduced motion the
// loop never starts.
class BeatPreviewPlayer {
  constructor(root) {
    this.root = root;
    this.active = null;
    this.request = 0;
    this.audioContext = undefined;  // undefined = not built yet, null = unsupported
    this.glowFrame = 0;
    this.glowPlayer = null;
    this.level = 0;
    root.addEventListener("click", (event) => {
      const button = event.target.closest(".beat-preview__toggle");
      if (button) this.toggle(button.closest(".beat-preview").querySelector("audio"));
    });
    root.addEventListener("input", (event) => {
      if (!event.target.matches(".beat-preview__seek")) return;
      const player = event.target.closest(".beat-preview");
      const audio = player && player.querySelector("audio");
      if (!audio || !(Number.isFinite(audio.duration) && audio.duration > 0)) return;
      const percent = Number(event.target.value);
      const target = Math.min(audio.duration, Math.max(0, percent / 100 * audio.duration));
      /* The thumb is already where the visitor put it; keep the range's own
         value (and its painted fill) while the audio catches up, so a
         `timeupdate` in the same frame can never snap it backwards under the
         finger. The actual seek is still written synchronously — deferring it
         to a frame made the first scrub feel detached. */
      audio.__kyrolllScrubbing = true;
      if (Math.abs(audio.currentTime - target) > 0.01) audio.currentTime = target;
      this.writeProgress(player, event.target, percent);
      this.scheduleScrubUpdate(audio);
    });
    /* Releasing the thumb ends the scrub and settles the readout on the frame
       the browser actually landed on. */
    root.addEventListener("change", (event) => {
      if (!event.target.matches(".beat-preview__seek")) return;
      const player = event.target.closest(".beat-preview");
      const audio = player && player.querySelector("audio");
      if (!audio) return;
      audio.__kyrolllScrubbing = false;
      this.update(audio, { forceSeek: true });
    });
    /* Warm the file inside the visitor's first intent — hover, focus or touch —
       so the click's `play()` starts from a buffered track instead of a cold
       range request. It never downloads on a metered/save-data connection. */
    const warm = (event) => {
      const target = event.target;
      const player = target && target.closest && target.closest(".beat-preview");
      if (player) this.warm(player.querySelector("audio"));
    };
    root.addEventListener("pointerover", warm, true);
    root.addEventListener("focusin", warm, true);
    root.addEventListener("touchstart", warm, { capture: true, passive: true });
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
        if (type === "playing") {
          player.dataset.state = "playing";
          this.startGlow(audio);
        }
        if (type === "ended" || (type === "pause" && audio.paused)) {
          if (this.active === audio) {
            this.active = null;
            this.request++;
          }
          audio.__kyrolllScrubbing = false;
          this.stopGlow();
          if (player.dataset.state !== "error") player.dataset.state = "idle";
        }
        this.update(audio);
      }, true);
    }
  }

  /* Start the file's fetch before the play tap. `preload="metadata"` only reads
     the header, so the first tap used to pay for the rest of the range request;
     warming on hover/focus/touch moves that cost ahead of the gesture. The file
     is not fetched again on a metered connection or when the visitor has asked
     the browser to save data. */
  warm(audio) {
    if (!audio || audio.__kyrolllWarmed || !audio.paused || audio.currentTime > 0) return;
    audio.__kyrolllWarmed = true;
    const connection = typeof navigator !== "undefined" && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
    if (connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || ""))) return;
    if (audio.readyState >= 2) return;
    try {
      if (audio.preload !== "auto") audio.preload = "auto";
      audio.load();
    } catch (error) { /* a warm-up is optional; play() still retries */ }
  }

  /* One progress value drives both the range's painted fill and the glow line
     that traces it. The value is written on the details column (the glow's
     parent) as well as the range itself, so the halo and the fill can never
     disagree by a frame. */
  writeProgress(player, seek, percent) {
    const value = percent + "%";
    if (seek && seek.style && seek.style.setProperty) seek.style.setProperty("--preview-progress", value);
    const details = player && player.querySelector ? player.querySelector(".beat-preview__details") : null;
    if (details && details.style && details.style.setProperty) details.style.setProperty("--preview-progress", value);
  }

  /* The scrub UI is coalesced to one write per frame, so a fast drag does not
     force a layout/readout write for every pointer sample. The seek itself is
     already applied synchronously in the input handler. */
  scheduleScrubUpdate(audio) {
    if (audio.__kyrolllScrubFrame) return;
    const run = () => {
      audio.__kyrolllScrubFrame = 0;
      this.update(audio);
    };
    if (typeof requestAnimationFrame === "function") audio.__kyrolllScrubFrame = requestAnimationFrame(run);
    else run();
  }

  stop() {
    this.request++;
    this.stopGlow();
    const audio = this.active;
    this.active = null;
    if (!audio) return;
    audio.__kyrolllScrubbing = false;
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
    // Warm the analyser inside the click gesture, so the shared AudioContext
    // starts running before the first `playing` frame needs it. The media file
    // itself was already warmed on hover/focus/touch where possible.
    this.warm(audio);
    this.audioGraph(audio);
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
    this.stopGlow();
    if (this.active === audio) this.stop();
    const player = audio.closest(".beat-preview");
    if (player) player.dataset.state = "error";
    this.update(audio);
  }

  /* ---------------------------------------------------------- the halo clock
     One AudioContext for the whole grid. `createMediaElementSource` may only be
     called once per element, so the graph (and its analyser) is cached on the
     element itself; a browser that refuses Web Audio simply leaves the halo at
     its resting level. `resume()` is safe to call repeatedly and is what makes
     the context start from the play tap on iOS. */
  audioGraph(audio) {
    if (this.audioContext === null || typeof window === "undefined") return null;
    if (!this.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { this.audioContext = null; return null; }
      try { this.audioContext = new Ctx(); } catch { this.audioContext = null; return null; }
    }
    if (this.audioContext.state === "suspended") this.audioContext.resume().catch(() => {});
    if (audio.__kyrolllAnalyser) return audio.__kyrolllAnalyser;
    try {
      const source = this.audioContext.createMediaElementSource(audio);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      // Light smoothing: the halo wants the transient, not a loudness average.
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(this.audioContext.destination);
      audio.__kyrolllAnalyser = analyser;
      return analyser;
    } catch {
      return null;
    }
  }

  startGlow(audio) {
    const player = audio.closest(".beat-preview");
    if (!player || !player.style || typeof player.style.setProperty !== "function") return;
    this.stopGlow();
    this.glowPlayer = player;
    const analyser = this.audioGraph(audio);
    const reduced = typeof window !== "undefined" && window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!analyser || reduced) {
      // No analyser, or motion is off: one soft, static bloom — no clock.
      player.style.setProperty("--beat-level", analyser ? "0.5" : "0.34");
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    let prev = null;
    this.level = 0;
    const tick = () => {
      if (this.glowPlayer !== player || this.active !== audio) return;
      this.glowFrame = requestAnimationFrame(tick);
      if (typeof document === "undefined" || document.hidden) return;
      if (document.documentElement.classList.contains("motion-paused")) return;
      analyser.getByteFrequencyData(data);
      if (!prev) prev = new Uint8Array(data.length);
      /* Spectral flux, not loudness: the first bins carry the kick, the snare
         and the low end of the melody, and the positive frame-to-frame rise in
         them is the beat itself. A plain energy average sat at ~0.85 for a
         whole track and never visibly moved; flux spikes on each hit and the
         slow release makes the halo breathe back out between them. */
      const bins = Math.min(24, data.length);
      let flux = 0;
      for (let i = 0; i < bins; i += 1) {
        const delta = data[i] - prev[i];
        if (delta > 0) flux += delta;
        prev[i] = data[i];
      }
      const target = Math.min(1, flux / 340);
      this.level += (target - this.level) * (target > this.level ? 0.5 : 0.08);
      player.style.setProperty("--beat-level", this.level.toFixed(3));
    };
    this.glowFrame = requestAnimationFrame(tick);
  }

  stopGlow() {
    if (this.glowFrame) {
      cancelAnimationFrame(this.glowFrame);
      this.glowFrame = 0;
    }
    this.level = 0;
    if (!this.glowPlayer) return;
    this.glowPlayer.style.setProperty("--beat-level", "0");
    this.glowPlayer = null;
  }

  update(audio, options) {
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
      /* While the thumb is being dragged the range owns its own value and
         painted fill; writing `currentTime`'s progress back here is what made
         the handle fight the finger. The `change` handler clears the flag and
         writes the settled frame. */
      const scrubbing = !!audio.__kyrolllScrubbing && !(options && options.forceSeek);
      if (!scrubbing) {
        seek.value = progress;
        this.writeProgress(player, seek, progress);
      }
      seek.setAttribute("aria-valuetext", `${time(current)} of ${time(duration)}`);
    }
    const timeEl = player.querySelector(".beat-preview__time");
    if (timeEl) {
      const clock = `${time(current)} / ${duration ? time(duration) : "--:--"}`;
      // `timeupdate` fires several times a second, but the clock only changes once
      // a second: never rewrite identical text (each write is a style/paint the
      // player no longer has to absorb).
      if (timeEl.textContent !== clock) timeEl.textContent = clock;
    }
    const status = player.dataset.state === "error"
      ? "PREVIEW UNAVAILABLE — TAP TO RETRY"
      : player.dataset.state === "loading" && active ? "LOADING PREVIEW…" : "AUDIO PREVIEW";
    const statusElement = player.querySelector(".beat-preview__status");
    if (statusElement && statusElement.textContent !== status) statusElement.textContent = status;
  }
}
