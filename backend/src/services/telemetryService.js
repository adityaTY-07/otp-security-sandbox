export function createTelemetryService({ state, sockets }) {
  function broadcast(event) {
    const message = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
      metrics: state.getTelemetry(),
      demo: state.getDemoStatus(120)
    });

    for (const socket of sockets.clients) {
      if (socket.readyState === 1) socket.send(message);
    }
  }

  function recordRequest({ status, latencyMs, event, cost = 0 }) {
    if (event === "blocked") state.recordBlockedRequest(latencyMs);
    else state.recordRequest({ status, latencyMs, cost });

    broadcast({
      event,
      status,
      latencyMs,
      cost,
      source: "manual-mock-request"
    });
  }

  function sendSnapshot(socket) {
    socket.send(JSON.stringify({
      event: "snapshot",
      timestamp: new Date().toISOString(),
      config: state.getSecurityConfig(),
      metrics: state.getTelemetry(),
      demo: state.getDemoStatus(120)
    }));
  }

  return { broadcast, recordRequest, sendSnapshot };
}
