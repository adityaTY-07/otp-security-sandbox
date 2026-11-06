import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createClient } from "redis";
import { WebSocketServer } from "ws";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8080);
const redis = createClient({ url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" });
const allowedOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);

redis.on("error", (error) => console.error("Redis client error:", error.message));
await redis.connect();

const app = express();
const httpServer = createServer(app);
const sockets = new WebSocketServer({ server: httpServer, path: "/ws" });

let securityConfig = {
  rateLimiting: true,
  exponentialBackoff: true,
  ipBlacklisting: true
};

const metrics = {
  total: 0,
  accepted: 0,
  limited: 0,
  blocked: 0,
  totalLatencyMs: 0,
  simulatedCostUsd: 0
};

// Redis TIME and a single script keep refill and token consumption atomic.
const tokenBucketScript = `
  local values = redis.call("HMGET", KEYS[1], "tokens", "updatedAt")
  local tokens = tonumber(values[1])
  local updatedAt = tonumber(values[2])
  local time = redis.call("TIME")
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local capacity = tonumber(ARGV[1])
  local refillPerMs = tonumber(ARGV[2])

  if tokens == nil then
    tokens = capacity
  else
    tokens = math.min(capacity, tokens + math.max(0, now - updatedAt) * refillPerMs)
  end

  local allowed = 0
  local retryAfterMs = 0
  if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
  else
    retryAfterMs = math.ceil((1 - tokens) / refillPerMs)
  end

  redis.call("HSET", KEYS[1], "tokens", tokens, "updatedAt", now)
  redis.call("PEXPIRE", KEYS[1], math.ceil(capacity / refillPerMs) * 2)
  return {allowed, tokens, retryAfterMs}
`;

function serverTelemetry() {
  return {
    ...metrics,
    averageLatencyMs: metrics.total
      ? Number((metrics.totalLatencyMs / metrics.total).toFixed(1))
      : 0,
    memoryRssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
    uptimeSeconds: Math.floor(process.uptime())
  };
}

function sendTelemetry(event) {
  const message = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
    metrics: serverTelemetry()
  });
  for (const socket of sockets.clients) {
    if (socket.readyState === 1) socket.send(message);
  }
}

function clientKey(req) {
  return (req.ip ?? "unknown").replaceAll(":", "_");
}

async function recordDeniedAttempt(ipKey) {
  const violationsKey = `otp:violations:${ipKey}`;
  const attemptKey = `otp:backoff-attempts:${ipKey}`;
  // Batch counter increments and first-hit expirations into one Redis transaction.
  const [count, , attempts] = await redis.multi()
    .incr(violationsKey)
    .expire(violationsKey, 300, "NX")
    .incr(attemptKey)
    .expire(attemptKey, 300, "NX")
    .exec();

  if (securityConfig.ipBlacklisting && count >= 5) {
    await redis.multi()
      .set(`otp:blacklist:${ipKey}`, "1", { EX: 300 })
      .exec();
    return { reason: "Client temporarily blocked after repeated rate-limit responses.", blocked: true };
  }

  if (securityConfig.exponentialBackoff) {
    const delaySeconds = Math.min(2 ** Math.min(attempts, 6), 60);
    await redis.multi()
      .set(`otp:backoff:${ipKey}`, "1", { EX: delaySeconds })
      .exec();
    return { reason: `Retry delay applied for ${delaySeconds} seconds.`, blocked: false };
  }

  return { reason: "Request limit exceeded.", blocked: false };
}

function recordRequest({ status, latencyMs, event, cost = 0 }) {
  metrics.total += 1;
  if (status >= 200 && status < 300) metrics.accepted += 1;
  if (status === 429) metrics.limited += 1;
  if (event === "blocked") metrics.blocked += 1;
  metrics.totalLatencyMs += latencyMs;
  metrics.simulatedCostUsd = Number((metrics.simulatedCostUsd + cost).toFixed(4));
  sendTelemetry({ event, status, latencyMs, cost });
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "4kb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) callback(null, true);
    else callback(new Error("CORS_ORIGIN_DENIED"));
  },
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.get("/healthz", async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok", redis: "connected" });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(503).json({ status: "unavailable", redis: "disconnected" });
  }
});

app.get("/api/config", (_req, res) => res.json(securityConfig));

app.put("/api/config", (req, res) => {
  const keys = ["rateLimiting", "exponentialBackoff", "ipBlacklisting"];
  const valid = req.body &&
    Object.keys(req.body).length === keys.length &&
    keys.every((key) => typeof req.body[key] === "boolean");

  if (!valid) return res.status(400).json({ error: "Provide all three security settings as booleans." });

  securityConfig = { ...req.body };
  sendTelemetry({ event: "configuration-updated", status: 200, latencyMs: 0, cost: 0 });
  res.json(securityConfig);
});

app.post("/api/request-otp", async (req, res) => {
  const startedAt = performance.now();
  const recipient = req.body?.recipient;
  if (typeof recipient !== "string" || recipient.length < 3 || recipient.length > 64) {
    return res.status(400).json({ error: "recipient must be between 3 and 64 characters." });
  }

  const ipKey = clientKey(req);
  const blacklistKey = `otp:blacklist:${ipKey}`;
  const backoffKey = `otp:backoff:${ipKey}`;

  try {
    if (securityConfig.ipBlacklisting && await redis.exists(blacklistKey)) {
      const latencyMs = Number((performance.now() - startedAt).toFixed(1));
      recordRequest({ status: 429, latencyMs, event: "blocked" });
      return res.status(429).json({ error: "Sandbox client is temporarily blocked." });
    }

    if (securityConfig.exponentialBackoff && await redis.exists(backoffKey)) {
      const latencyMs = Number((performance.now() - startedAt).toFixed(1));
      recordRequest({ status: 429, latencyMs, event: "rate-limited" });
      return res.status(429).json({ error: "Retry delay is active. Wait before trying again." });
    }

    if (securityConfig.rateLimiting) {
      const [allowed, , retryAfterMs] = await redis.eval(tokenBucketScript, {
        keys: [`otp:bucket:${ipKey}`],
        arguments: ["5", String(5 / 60_000)]
      });

      if (Number(allowed) !== 1) {
        const defense = await recordDeniedAttempt(ipKey);
        const latencyMs = Number((performance.now() - startedAt).toFixed(1));
        recordRequest({
          status: 429,
          latencyMs,
          event: defense.blocked ? "blocked" : "rate-limited"
        });
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(Number(retryAfterMs) / 1000))));
        return res.status(429).json({ error: defense.reason });
      }
    }

    const latencyMs = Number((performance.now() - startedAt).toFixed(1));
    const simulatedCost = 0.007;
    recordRequest({ status: 202, latencyMs, event: "otp-simulated", cost: simulatedCost });
    res.status(202).json({
      message: "Mock OTP request accepted; no message was sent.",
      simulatedCostUsd: simulatedCost
    });
  } catch (error) {
    console.error("OTP simulation failed:", error.message);
    res.status(503).json({ error: "Sandbox dependencies are unavailable; request was not processed." });
  }
});

app.use((error, _req, res, _next) => {
  if (error.message === "CORS_ORIGIN_DENIED") {
    return res.status(403).json({ error: "Origin is not allowed in this sandbox." });
  }
  console.error("Request parsing failed:", error.message);
  res.status(400).json({ error: "Invalid request." });
});

sockets.on("connection", (socket, request) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    socket.close(1008, "Origin is not allowed");
    return;
  }
  socket.send(JSON.stringify({
    event: "snapshot",
    timestamp: new Date().toISOString(),
    config: securityConfig,
    metrics: serverTelemetry()
  }));
});

const telemetryTimer = setInterval(() => {
  sendTelemetry({ event: "telemetry", status: null, latencyMs: null, cost: 0 });
}, 1000);
telemetryTimer.unref();

httpServer.listen(port, host, () => {
  console.log(`Local OTP sandbox listening on ${host}:${port}`);
});

async function shutdown() {
  clearInterval(telemetryTimer);
  sockets.close();
  httpServer.close();
  await redis.quit();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
