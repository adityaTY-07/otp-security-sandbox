import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
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
    if (child.exitCode !== null) throw new Error(`Backend exited early: ${childOutput}`);
    try {
      const response = await fetch(`${apiUrl}/healthz`);
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Backend did not become healthy: ${lastError?.message}\n${childOutput}`);
}

async function requestOtp() {
  return fetch(`${apiUrl}/api/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: "test-user" })
  });
}

describe("OTP sandbox integration", () => {
  beforeEach(async () => {
    const port = await unusedPort();
    apiUrl = `http://127.0.0.1:${port}`;
    childOutput = "";
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: backendDirectory,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
    await waitForHealth();
  });

  afterEach(async () => {
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
    child = undefined;
  });

  it("serves the existing frontend dashboard from the backend origin", async () => {
    const response = await fetch(apiUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /OTP Security Sandbox/);

    const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(scriptPath, "dashboard JavaScript bundle is referenced");
    const scriptResponse = await fetch(new URL(scriptPath, apiUrl));
    assert.equal(scriptResponse.status, 200);

    const sameOriginAsset = await fetch(new URL("/assets/index-CykDSvl0.css", apiUrl), {
      headers: { Origin: apiUrl }
    });
    assert.equal(sameOriginAsset.status, 200);
  });

  it("rejects cross-origin browser requests outside the local frontend", async () => {
    const response = await fetch(`${apiUrl}/api/config`, {
      headers: { Origin: "https://example.invalid" }
    });
    assert.equal(response.status, 403);
  });

  it("accepts mock frontend input without sending a message", async () => {
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

  it("rejects synthetic demo limits above the configured safety caps", async () => {
    const response = await fetch(`${apiUrl}/api/demo/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationSeconds: 31, eventsPerSecond: 5 })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "durationSeconds must be 1–30 and eventsPerSecond must be 1–4.");
  });

  it("streams clearly labeled synthetic telemetry without changing real request counters", async () => {
    const socket = new WebSocket(`${apiUrl.replace("http", "ws")}/ws`);
    const samplePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for synthetic telemetry")), 3000);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString());
        if (event.source === "synthetic-demo" && event.synthetic === true) {
          clearTimeout(timeout);
          resolve(event);
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    try {
      await once(socket, "open");
      const response = await fetch(`${apiUrl}/api/demo/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationSeconds: 1, eventsPerSecond: 2 })
      });
      assert.equal(response.status, 202);
      const event = await samplePromise;
      assert.match(event.label, /no request or OTP was sent/i);
      assert.equal(event.metrics.total, 0);
      const stopResponse = await fetch(`${apiUrl}/api/demo/stop`, { method: "POST" });
      assert.equal(stopResponse.status, 200);
    } finally {
      socket.close();
    }
  });
});
