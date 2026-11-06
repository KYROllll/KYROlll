(() => {
  "use strict";

  const state = {
    seconds: 0,
    ticks: 40,
    values: {
      lowEnd: -8.4,
      correlation: 0.12,
      lufs: -14.2,
      dr: 6.2,
      truePeak: -0.8
    },
    history: {
      lowEnd: [],
      correlation: [],
      lufs: [],
      dr: []
    }
  };

  const config = {
    lowEnd: { min: -30, max: 0 },
    correlation: { min: -1, max: 1 },
    lufs: { min: -36, max: 0 },
    dr: { min: 0, max: 20 }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const walk = (value, target, spread, min, max) => {
    const drift = (target - value) * 0.035;
    return clamp(value + drift + (Math.random() - 0.5) * spread, min, max);
  };

  const statusLowEnd = (value) => {
    if (state.ticks < 4) return "idle";
    if (value >= -14 && value <= -3) return "good";
    if ((value >= -20 && value < -14) || (value > -3 && value <= 0)) return "warn";
    return "bad";
  };

  const statusCorrelation = (value) => {
    if (state.ticks < 4) return "idle";
    if (value >= 0.3) return "good";
    if (value >= 0) return "warn";
    return "bad";
  };

  const statusLufs = (value) => {
    if (state.ticks < 4) return "idle";
    if (value >= -16 && value <= -12) return "good";
    if ((value >= -20 && value < -16) || (value > -12 && value <= -9)) return "warn";
    return "bad";
  };

  const statusDynamicRange = (value) => {
    if (state.ticks < 30) return "idle";
    if (value >= 8) return "good";
    if (value >= 5) return "warn";
    return "bad";
  };

  const statusText = {
    idle: "IDLE",
    good: "OK",
    warn: "WATCH",
    bad: "FAIL"
  };

  const formatDb = (value, ready) => {
    if (!ready || value <= -60) return "-";
    return value.toFixed(1);
  };

  const formatCorrelation = (value, ready) => {
    if (!ready) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
  };

  const formatClock = (seconds) => {
    const total = Math.floor(seconds);
    const hours = String(Math.floor(total / 3600) % 100).padStart(2, "0");
    const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
    const secs = String(total % 60).padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
  };

  const windowFor = (metric) => document.querySelector(`[data-metric="${metric}"]`);

  const setStatus = (article, status) => {
    article.dataset.status = status;

    article.querySelectorAll("[data-status-label]").forEach((node) => {
      node.textContent = statusText[status];
    });
  };

  const graphPaths = (history, min, max) => {
    if (history.length < 2) {
      return { line: "", fill: "", dot: null };
    }

    const points = history.map((value, index) => {
      const x = (index / (history.length - 1)) * 200;
      const normalised = clamp((value - min) / (max - min), 0, 1);
      const y = 80 - normalised * 80;
      return { x, y };
    });

    const line = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");

    const fill = [
      "M0 80",
      `L${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
      ...points.slice(1).map((point) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
      `L${points[points.length - 1].x.toFixed(2)} 80`,
      "Z"
    ].join(" ");

    return { line, fill, dot: points[points.length - 1] };
  };

  const renderGraph = (article, history, min, max) => {
    const line = article.querySelector("[data-line]");
    const fill = article.querySelector("[data-fill]");
    const dot = article.querySelector("[data-dot]");

    if (!line || !fill || !dot) return;

    const paths = graphPaths(history, min, max);
    line.setAttribute("d", paths.line);
    fill.setAttribute("d", paths.fill);

    if (paths.dot) {
      dot.setAttribute("cx", paths.dot.x.toFixed(2));
      dot.setAttribute("cy", paths.dot.y.toFixed(2));
      dot.style.display = "";
    } else {
      dot.style.display = "none";
    }
  };

  const update = () => {
    const lowReady = state.ticks >= 4;
    const lufsReady = state.ticks >= 4;
    const drReady = state.ticks >= 30;

    const lowStatus = statusLowEnd(state.values.lowEnd);
    const correlationStatus = statusCorrelation(state.values.correlation);
    const lufsStatus = statusLufs(state.values.lufs);
    const drStatus = statusDynamicRange(state.values.dr);

    const lowWindow = windowFor("low-end");
    setStatus(lowWindow, lowStatus);
    lowWindow.querySelector("[data-value]").textContent =
      formatDb(state.values.lowEnd, lowReady);
    renderGraph(lowWindow, state.history.lowEnd, config.lowEnd.min, config.lowEnd.max);

    const correlationWindow = windowFor("correlation");
    setStatus(correlationWindow, correlationStatus);
    correlationWindow.querySelector("[data-value]").textContent =
      formatCorrelation(state.values.correlation, correlationStatus !== "idle");
    correlationWindow.querySelector("[data-detail-a]").textContent =
      correlationStatus === "idle"
        ? "NO SIGNAL"
        : state.values.correlation < -0.1
          ? "OUT OF PHASE"
          : state.values.correlation < 0.3
            ? "DIFFUSE"
            : "IN PHASE";
    renderGraph(correlationWindow, state.history.correlation,
                config.correlation.min, config.correlation.max);

    const lufsWindow = windowFor("lufs");
    setStatus(lufsWindow, lufsStatus);
    lufsWindow.querySelector("[data-value]").textContent =
      formatDb(state.values.lufs, lufsReady);
    lufsWindow.querySelector("[data-detail-a]").textContent =
      lufsReady ? `${(state.values.lufs + Math.sin(state.seconds * 0.9) * 0.4).toFixed(1)} LUFS` : "-";
    lufsWindow.querySelector("[data-detail-b]").textContent =
      lufsReady ? `${(state.values.lufs + Math.sin(state.seconds * 0.23) * 0.8).toFixed(1)} LUFS` : "-";
    renderGraph(lufsWindow, state.history.lufs, config.lufs.min, config.lufs.max);

    const drWindow = windowFor("dynamic-range");
    setStatus(drWindow, drStatus);
    drWindow.querySelector("[data-value]").textContent =
      drReady ? state.values.dr.toFixed(1) : "-";
    drWindow.querySelector("[data-detail-a]").textContent =
      drReady ? `${Math.max(0, state.values.truePeak - state.values.lufs).toFixed(1)} DB` : "-";
    drWindow.querySelector("[data-detail-b]").textContent =
      drReady ? `${state.values.truePeak.toFixed(1)} DBTP` : "-";
    renderGraph(drWindow, state.history.dr, config.dr.min, config.dr.max);

    document.getElementById("session-clock").textContent = formatClock(state.seconds);

    const clipping = state.values.truePeak > -0.1;
    const badge = document.getElementById("clip-badge");
    badge.textContent = clipping ? "CLIP LATCH" : "NO CLIP";
    badge.classList.toggle("is-clipping", clipping);
  };

  const pushHistory = () => {
    state.history.lowEnd.push(state.values.lowEnd);
    state.history.correlation.push(state.values.correlation);
    state.history.lufs.push(state.values.lufs);
    state.history.dr.push(state.values.dr);

    Object.values(state.history).forEach((history) => {
      while (history.length > 90) history.shift();
    });
  };

  const tick = () => {
    state.ticks += 1;
    state.seconds += 0.1;

    state.values.lowEnd = walk(state.values.lowEnd, -8.5, 1.1, -30, 0);
    state.values.correlation = walk(state.values.correlation, 0.34, 0.12, -1, 1);
    state.values.lufs = walk(state.values.lufs, -14.0, 1.1, -36, 0);
    state.values.dr = walk(state.values.dr, 8.6, 1.3, 0, 20);
    state.values.truePeak = walk(state.values.truePeak, -0.7, 0.35, -6, 0);

    pushHistory();
    update();
  };

  const reset = () => {
    state.seconds = 0;
    state.ticks = 0;
    state.values = {
      lowEnd: -8.4,
      correlation: 0.12,
      lufs: -14.2,
      dr: 6.2,
      truePeak: -0.8
    };
    state.history = { lowEnd: [], correlation: [], lufs: [], dr: [] };

    document.getElementById("clip-badge").textContent = "NO CLIP";
    document.getElementById("clip-badge").classList.remove("is-clipping");
    document.getElementById("session-clock").textContent = "00:00:00";
    update();
  };

  const seed = () => {
    for (let i = 0; i < 24; i += 1) {
      pushHistory();
    }
  };

  document.getElementById("reset").addEventListener("click", reset);

  const flowerButton = document.getElementById("flower-button");
  const flower = document.getElementById("flower");

  flowerButton.addEventListener("click", () => {
    const paused = flower.classList.toggle("is-paused");
    flowerButton.setAttribute("aria-label", paused ? "RESUME FLOWER ROTATION" : "PAUSE FLOWER ROTATION");
  });

  seed();
  update();
  window.setInterval(tick, 100);
})();
