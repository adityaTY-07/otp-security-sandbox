import { Router } from "express";
import { createConfigController } from "../controllers/configController.js";
import { createDemoController } from "../controllers/demoController.js";
import { createRequestController } from "../controllers/requestController.js";

export function createApiRoutes({ state, telemetry, demoService }) {
  const router = Router();
  const configController = createConfigController({ state, telemetry });
  const demoController = createDemoController({ demoService });
  const requestController = createRequestController({ state, telemetry });

  router.get("/config", configController.get);
  router.put("/config", configController.update);
  router.post("/request-otp", requestController.create);
  router.get("/demo/status", demoController.getStatus);
  router.post("/demo/start", demoController.start);
  router.post("/demo/stop", demoController.stop);
  return router;
}
