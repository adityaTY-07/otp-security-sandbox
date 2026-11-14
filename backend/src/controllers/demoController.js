export function createDemoController({ demoService }) {
  return {
    getStatus(_req, res) {
      res.json(demoService.getStatus());
    },

    start(req, res) {
      const input = req.body ?? {};
      const allowedKeys = ["durationSeconds", "eventsPerSecond"];
      if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
        return res.status(400).json({ error: "Only durationSeconds and eventsPerSecond are accepted." });
      }

      const result = demoService.start(input);
      if (result.error) {
        return res.status(demoService.getStatus().running ? 409 : 400).json({ error: result.error });
      }
      res.status(202).json({
        message: "Synthetic telemetry started; no HTTP requests or OTPs are generated.",
        ...result.status
      });
    },

    stop(_req, res) {
      const stopped = demoService.stop();
      res.json({ stopped, ...demoService.getStatus() });
    }
  };
}
