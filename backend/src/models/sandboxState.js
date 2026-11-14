const BUCKET_CAPACITY = 5;
const REFILL_PER_MS = BUCKET_CAPACITY / 60_000;
const STATE_TTL_MS = 5 * 60_000;

export function createSandboxState() {
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
  const buckets = new Map();
  const deniedAttempts = new Map();
  const backoffAttempts = new Map();
  const backoffs = new Map();
  const blacklistedClients = new Map();
  let demo = {
    running: false,
    generated: 0,
    interval: null,
    timeout: null,
    durationSeconds: 0,
    eventsPerSecond: 0
  };

  function getSecurityConfig() {
    return { ...securityConfig };
  }

  function updateSecurityConfig(config) {
    securityConfig = { ...config };
    return getSecurityConfig();
  }

  function getTelemetry() {
    return {
      ...metrics,
      averageLatencyMs: metrics.total
        ? Number((metrics.totalLatencyMs / metrics.total).toFixed(1))
        : 0,
      memoryRssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      uptimeSeconds: Math.floor(process.uptime())
    };
  }

  function getDemoStatus(maxEvents) {
    const { running, generated, durationSeconds, eventsPerSecond } = demo;
    return { running, generated, durationSeconds, eventsPerSecond, maxEvents };
  }

  function getDemoState() {
    return { ...demo };
  }

  function startDemo(state) {
    demo = { ...state };
  }

  function updateDemo(patch) {
    demo = { ...demo, ...patch };
  }

  function consumeToken(client, now) {
    const previous = buckets.get(client);
    const elapsedMs = previous ? Math.max(0, now - previous.updatedAt) : 0;
    const tokens = previous
      ? Math.min(BUCKET_CAPACITY, previous.tokens + elapsedMs * REFILL_PER_MS)
      : BUCKET_CAPACITY;

    if (tokens < 1) {
      buckets.set(client, { tokens, updatedAt: now });
      return {
        allowed: false,
        retryAfterMs: Math.ceil((1 - tokens) / REFILL_PER_MS)
      };
    }

    buckets.set(client, { tokens: tokens - 1, updatedAt: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  function isBlacklisted(client, now) {
    return (blacklistedClients.get(client) ?? 0) > now;
  }

  function getBackoffUntil(client) {
    return backoffs.get(client) ?? 0;
  }

  function recordDeniedAttempt(client, now) {
    const previous = deniedAttempts.get(client);
    const count = previous && previous.expiresAt > now ? previous.count + 1 : 1;
    deniedAttempts.set(client, { count, expiresAt: now + STATE_TTL_MS });

    if (securityConfig.ipBlacklisting && count >= 5) {
      blacklistedClients.set(client, now + 300_000);
      return {
        reason: "Client temporarily blocked after repeated rate-limit responses.",
        blocked: true
      };
    }

    if (securityConfig.exponentialBackoff) {
      const previousAttempt = backoffAttempts.get(client);
      const attempts = previousAttempt && previousAttempt.expiresAt > now
        ? previousAttempt.count + 1
        : 1;
      backoffAttempts.set(client, { count: attempts, expiresAt: now + STATE_TTL_MS });
      const delaySeconds = Math.min(2 ** Math.min(attempts, 6), 60);
      backoffs.set(client, now + delaySeconds * 1000);
      return { reason: `Retry delay applied for ${delaySeconds} seconds.`, blocked: false };
    }

    return { reason: "Request limit exceeded.", blocked: false };
  }

  function recordRequest({ status, latencyMs, cost = 0 }) {
    metrics.total += 1;
    if (status >= 200 && status < 300) metrics.accepted += 1;
    if (status === 429) metrics.limited += 1;
    metrics.totalLatencyMs += latencyMs;
    metrics.simulatedCostUsd = Number((metrics.simulatedCostUsd + cost).toFixed(4));
  }

  function recordBlockedRequest(latencyMs) {
    metrics.blocked += 1;
    recordRequest({ status: 429, latencyMs });
  }

  function pruneExpiredState(now = Date.now()) {
    for (const [client, expiresAt] of blacklistedClients) {
      if (expiresAt <= now) blacklistedClients.delete(client);
    }
    for (const [client, expiresAt] of backoffs) {
      if (expiresAt <= now) backoffs.delete(client);
    }
    for (const [client, state] of deniedAttempts) {
      if (state.expiresAt <= now) deniedAttempts.delete(client);
    }
    for (const [client, state] of backoffAttempts) {
      if (state.expiresAt <= now) backoffAttempts.delete(client);
    }
    for (const [client, bucket] of buckets) {
      if (now - bucket.updatedAt > STATE_TTL_MS) buckets.delete(client);
    }
  }

  return {
    getSecurityConfig,
    updateSecurityConfig,
    getTelemetry,
    getDemoStatus,
    getDemoState,
    startDemo,
    updateDemo,
    consumeToken,
    isBlacklisted,
    getBackoffUntil,
    recordDeniedAttempt,
    recordRequest,
    recordBlockedRequest,
    pruneExpiredState
  };
}
