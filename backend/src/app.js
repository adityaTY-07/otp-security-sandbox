import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { errorHandler } from "./middleware/errorHandler.js";
import { createSandboxState } from "./models/sandboxState.js";
import { createApiRoutes } from "./routes/apiRoutes.js";
import { createDemoService } from "./services/demoService.js";
import { createTelemetryService } from "./services/telemetryService.js";

const allowedOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const frontendDist = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
const frontendIndex = fileURLToPath(new URL("../../frontend/dist/index.html", import.meta.url));

export function createApplication() {
  const state = createSandboxState();
  const app = express();
  const httpServer = createServer(app);
  const sockets = new WebSocketServer({ server: httpServer, path: "/ws" });
  const telemetry = createTelemetryService({ state, sockets });
  const demoService = createDemoService({ state, telemetry });

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "4kb" }));
  const corsMiddleware = cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(new Error("CORS_ORIGIN_DENIED"));
    },
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  });
  app.use((req, res, next) => {
    const origin = req.get("origin");
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    if (origin && origin === requestOrigin) return next();
    corsMiddleware(req, res, next);
  });
  app.get("/healthz", (_req, res) => res.json({ status: "ok", storage: "in-memory" }));
  app.use("/api", createApiRoutes({ state, telemetry, demoService }));
  // Serve the checked-in frontend build from the same origin as the API.
  app.use(express.static(frontendDist, { index: false }));
  app.get("/", (_req, res, next) => {
    res.sendFile(frontendIndex, (error) => {
      if (error) next(error);
    });
  });
  app.use(errorHandler);

  sockets.on("connection", (socket, request) => {
    const origin = request.headers.origin;
    const requestOrigin = `http://${request.headers.host}`;
    if (origin && origin !== requestOrigin && !allowedOrigins.has(origin)) {
      socket.close(1008, "Origin is not allowed");
      return;
    }
    telemetry.sendSnapshot(socket);
  });

  return { app, httpServer, sockets, state, telemetry, demoService };
}
