import { createApplication } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);
const { httpServer, sockets, state, demoService } = createApplication();

const telemetryTimer = setInterval(() => {
  const message = JSON.stringify({
    event: "telemetry",
    status: null,
    latencyMs: null,
    cost: 0,
    source: "service",
    timestamp: new Date().toISOString(),
    metrics: state.getTelemetry(),
    demo: demoService.getStatus()
  });
  for (const socket of sockets.clients) {
    if (socket.readyState === 1) socket.send(message);
  }
}, 1000);
const cleanupTimer = setInterval(() => state.pruneExpiredState(), 60_000);
telemetryTimer.unref();
cleanupTimer.unref();

httpServer.listen(port, host, () => {
  console.log(`OTP sandbox running at http://${host}:${port}`);
  console.log("Requests from the dashboard are handled locally; no OTPs are sent.");
});

function shutdown() {
  demoService.stop("stopped because the service is shutting down");
  clearInterval(telemetryTimer);
  clearInterval(cleanupTimer);
  sockets.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
