export function createConfigController({ state, telemetry }) {
  return {
    get(_req, res) {
      res.json(state.getSecurityConfig());
    },

    update(req, res) {
      const keys = ["rateLimiting", "exponentialBackoff", "ipBlacklisting"];
      const valid = req.body &&
        Object.keys(req.body).length === keys.length &&
        keys.every((key) => typeof req.body[key] === "boolean");

      if (!valid) {
        return res.status(400).json({ error: "Provide all three security settings as booleans." });
      }

      const config = state.updateSecurityConfig(req.body);
      telemetry.broadcast({
        event: "configuration-updated",
        status: 200,
        latencyMs: 0,
        cost: 0,
        source: "configuration"
      });
      res.json(config);
    }
  };
}
