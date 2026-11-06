import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";
import WebSocket from "ws";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const isolatedRedisUrl = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
isolatedRedisUrl.pathname = "/1";
const redis = createClient({ url: isolatedRedisUrl.toString() });
let apiUrl;
let child;
let childOutput = "";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Test backend exited early: ${childOutput}`);
    }

    try {
      const response = await fetch(`${apiUrl}/healthz`);
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Test backend did not become healthy: ${lastError?.message}\n${childOutput}`);
}

async function requestOtp() {
  return fetch(`${apiUrl}/api/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: "test-user" })
  });
}

describe("OTP sandbox integration", () => {
  before(async () => {
    assert.equal(isolatedRedisUrl.pathname, "/1", "tests must only use Redis database 1");
    await redis.connect();

    const port = await unusedPort();
    apiUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: backendDirectory,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        REDIS_URL: isolatedRedisUrl.toString()
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
    await waitForHealth();
  });

  beforeEach(async () => {
    await redis.flushDb();
  });

  after(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      let timeout;
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => { timeout = setTimeout(resolve, 1000); })
      ]);
      clearTimeout(timeout);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
    if (redis.isOpen) {
      await redis.flushDb();
      await redis.quit();
    }
  });

  it("accepts a mock OTP request without sending a message", async () => {
    const response = await requestOtp();
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(typeof body.simulatedCostUsd, "number");
    assert.match(body.message, /no message was sent/i);
  });

  it("limits the sixth request in a five-token burst", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, requestOtp));
    const statuses = responses.map(({ status }) => status);

    assert.equal(statuses.filter((status) => status === 202).length, 5);
    assert.equal(statuses.filter((status) => status === 429).length, 1);
  });

  it("broadcasts a rate-limit event over WebSocket telemetry", async () => {
    const socket = new WebSocket(`${apiUrl.replace("http", "ws")}/ws`);
    const eventReceived = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for rate-limit telemetry")), 5000);
      socket.on("message", (data) => {
        const payload = JSON.parse(data.toString());
        if (payload.event === "rate-limited" || payload.event === "blocked") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    try {
      await once(socket, "open");
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await requestOtp();
      }

      const event = await eventReceived;
      assert.equal(event.status, 429);
      assert.ok(event.metrics);
    } finally {
      socket.close();
    }
  });
});
