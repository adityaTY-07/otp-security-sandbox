export function createRequestController({ state, telemetry }) {
  return {
    create(req, res) {
      const startedAt = performance.now();
      const recipient = req.body?.recipient;
      if (typeof recipient !== "string" || recipient.length < 3 || recipient.length > 64) {
        return res.status(400).json({ error: "recipient must be between 3 and 64 characters." });
      }

      const now = Date.now();
      const client = req.ip ?? "unknown";
      if (
        state.getSecurityConfig().ipBlacklisting &&
        state.isBlacklisted(client, now)
      ) {
        const latencyMs = Number((performance.now() - startedAt).toFixed(1));
        telemetry.recordRequest({ status: 429, latencyMs, event: "blocked" });
        return res.status(429).json({ error: "Sandbox client is temporarily blocked." });
      }

      const backoffUntil = state.getBackoffUntil(client);
      if (state.getSecurityConfig().exponentialBackoff && backoffUntil > now) {
        const latencyMs = Number((performance.now() - startedAt).toFixed(1));
        telemetry.recordRequest({ status: 429, latencyMs, event: "rate-limited" });
        res.setHeader("Retry-After", String(Math.ceil((backoffUntil - now) / 1000)));
        return res.status(429).json({ error: "Retry delay is active. Wait before trying again." });
      }

      if (state.getSecurityConfig().rateLimiting) {
        const result = state.consumeToken(client, now);
        if (!result.allowed) {
          const defense = state.recordDeniedAttempt(client, now);
          const latencyMs = Number((performance.now() - startedAt).toFixed(1));
          telemetry.recordRequest({
            status: 429,
            latencyMs,
            event: defense.blocked ? "blocked" : "rate-limited"
          });
          res.setHeader("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
          return res.status(429).json({ error: defense.reason });
        }
      }

      const latencyMs = Number((performance.now() - startedAt).toFixed(1));
      const simulatedCost = 0.007;
      telemetry.recordRequest({
        status: 202,
        latencyMs,
        event: "otp-simulated",
        cost: simulatedCost
      });
      res.status(202).json({
        message: "Mock OTP request accepted; no message was sent.",
        simulatedCostUsd: simulatedCost
      });
    }
  };
}
