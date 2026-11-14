const MAX_DURATION_SECONDS = 30;
const MAX_EVENTS_PER_SECOND = 4;
const MAX_EVENTS = MAX_DURATION_SECONDS * MAX_EVENTS_PER_SECOND;

export function createDemoService({ state, telemetry }) {
  function getStatus() {
    return state.getDemoStatus(MAX_EVENTS);
  }

  function stop(reason = "stopped") {
    const currentDemo = state.getDemoState();
    if (!currentDemo.running) return false;
    clearInterval(currentDemo.interval);
    clearTimeout(currentDemo.timeout);
    state.updateDemo({ running: false, interval: null, timeout: null });
    telemetry.broadcast({
      event: "synthetic-demo-stopped",
      status: null,
      latencyMs: null,
      cost: 0,
      source: "synthetic-demo",
      label: `Synthetic demo ${reason}; no requests were sent.`
    });
    return true;
  }

  function emitEvent() {
    const currentDemo = state.getDemoState();
    if (!currentDemo.running || currentDemo.generated >= MAX_EVENTS) {
      stop("completed its event limit");
      return;
    }

    const sequence = currentDemo.generated;
    state.updateDemo({ generated: sequence + 1 });
    const limited = sequence % 4 === 3;
    telemetry.broadcast({
      event: limited ? "synthetic-demo-limited" : "synthetic-demo-accepted",
      status: limited ? 429 : 202,
      latencyMs: Number((8 + (sequence % 13) * 2.4).toFixed(1)),
      cost: 0,
      source: "synthetic-demo",
      synthetic: true,
      label: "SYNTHETIC ONLY — no request or OTP was sent."
    });

    if (sequence + 1 >= MAX_EVENTS) stop("completed its event limit");
  }

  function start({ durationSeconds = 10, eventsPerSecond = 2 } = {}) {
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > MAX_DURATION_SECONDS ||
      !Number.isInteger(eventsPerSecond) ||
      eventsPerSecond < 1 ||
      eventsPerSecond > MAX_EVENTS_PER_SECOND
    ) {
      return { error: "durationSeconds must be 1–30 and eventsPerSecond must be 1–4." };
    }
    if (state.getDemoState().running) return { error: "A synthetic demo is already running." };

    state.startDemo({
      running: true,
      generated: 0,
      interval: null,
      timeout: null,
      durationSeconds,
      eventsPerSecond
    });
    telemetry.broadcast({
      event: "synthetic-demo-started",
      status: null,
      latencyMs: null,
      cost: 0,
      source: "synthetic-demo",
      label: "SYNTHETIC ONLY — no request or OTP will be sent."
    });

    const interval = setInterval(emitEvent, 1000 / eventsPerSecond);
    const timeout = setTimeout(() => stop("reached its time limit"), durationSeconds * 1000);
    state.updateDemo({ interval, timeout });
    return { status: getStatus() };
  }

  return { getStatus, start, stop };
}
