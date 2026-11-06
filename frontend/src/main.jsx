import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8080";
const WS = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8080";
const initialConfig = { rateLimiting: true, exponentialBackoff: true, ipBlacklisting: true };
const initialMetrics = {
  total: 0,
  accepted: 0,
  limited: 0,
  blocked: 0,
  averageLatencyMs: 0,
  memoryRssMb: 0,
  uptimeSeconds: 0,
  simulatedCostUsd: 0
};

const labels = {
  rateLimiting: "Rate limiting",
  exponentialBackoff: "Exponential backoff",
  ipBlacklisting: "Temporary client blocking"
};
const descriptions = {
  rateLimiting: "Allow up to five requests per minute per sandbox client.",
  exponentialBackoff: "Apply a temporary retry delay after a limited request.",
  ipBlacklisting: "Temporarily block clients after repeated limit responses."
};

function App() {
  const [config, setConfig] = useState(initialConfig);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [logs, setLogs] = useState([]);
  const [recipient, setRecipient] = useState("demo-user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    let socket;
    let reconnectTimer;
    let stableTimer;
    let flushTimer;
    let reconnectDelay = 500;
    let pendingMetrics;
    let pendingConfig;
    let pendingEvents = [];

    // Coalesce bursts into at most four UI updates per second.
    flushTimer = setInterval(() => {
      if (pendingMetrics) {
        setMetrics(pendingMetrics);
        pendingMetrics = undefined;
      }
      if (pendingConfig) {
        setConfig(pendingConfig);
        pendingConfig = undefined;
      }
      if (pendingEvents.length) {
        const batch = pendingEvents;
        pendingEvents = [];
        setLogs((current) => [...batch, ...current].slice(0, 40));
      }
    }, 250);

    fetch(`${API}/api/config`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load security configuration.");
        return response.json();
      })
      .then((value) => { if (active) setConfig(value); })
      .catch((cause) => { if (active) setError(cause.message); });

    function connect() {
      if (!active) return;
      const currentSocket = new WebSocket(`${WS}/ws`);
      socket = currentSocket;
      currentSocket.onopen = () => {
        setConnected(true);
        stableTimer = setTimeout(() => { reconnectDelay = 500; }, 10_000);
      };
      currentSocket.onclose = () => {
        setConnected(false);
        clearTimeout(stableTimer);
        if (!active) return;

        const delay = reconnectDelay + Math.random() * reconnectDelay * 0.2;
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        reconnectTimer = setTimeout(connect, delay);
      };
      currentSocket.onerror = () => currentSocket.close();
      currentSocket.onmessage = ({ data }) => {
        try {
          const entry = JSON.parse(data);
          if (entry.metrics) pendingMetrics = entry.metrics;
          if (entry.config) pendingConfig = entry.config;
          if (entry.event !== "snapshot" && entry.event !== "telemetry") {
            pendingEvents.push({ ...entry, key: crypto.randomUUID() });
            if (pendingEvents.length > 100) pendingEvents.shift();
          }
        } catch {
          setError("Received invalid telemetry data.");
        }
      };
    }

    connect();
    return () => {
      active = false;
      clearInterval(flushTimer);
      clearTimeout(reconnectTimer);
      clearTimeout(stableTimer);
      socket.close();
    };
  }, []);

  async function updateConfig(key, value) {
    const next = { ...config, [key]: value };
    setError("");
    try {
      const response = await fetch(`${API}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update configuration.");
      setConfig(body);
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function requestOtp(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">LOCAL DEFENSE LAB</div>
          <h1>OTP Security Sandbox</h1>
          <p>Mock authentication requests, defensive controls, and live telemetry.</p>
        </div>
        <span className={`connection ${connected ? "online" : ""}`}>
          <i /> {connected ? "LIVE TELEMETRY" : "CONNECTING"}
        </span>
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      <section className="metrics" aria-label="Live service metrics">
        <Metric label="Total requests" value={metrics.total} />
        <Metric label="Accepted" value={metrics.accepted} color="green" />
        <Metric label="Rate limited" value={metrics.limited} color="amber" />
        <Metric label="Blocked" value={metrics.blocked} color="red" />
        <Metric label="Avg latency" value={`${metrics.averageLatencyMs} ms`} />
        <Metric label="Simulated SMS cost" value={`$${Number(metrics.simulatedCostUsd).toFixed(4)}`} />
      </section>

      <div className="columns">
        <section className="panel controls">
          <div className="panel-heading">
            <div><span className="eyebrow">DEFENSE</span><h2>Security controls</h2></div>
            <span className="enabled">{Object.values(config).filter(Boolean).length} ACTIVE</span>
          </div>
          <div className="control-list">
            {Object.entries(labels).map(([key, label]) => (
              <label className="control" key={key}>
                <span><strong>{label}</strong><small>{descriptions[key]}</small></span>
                <input type="checkbox" checked={Boolean(config[key])}
                  onChange={(event) => updateConfig(key, event.target.checked)} aria-label={label} />
              </label>
            ))}
          </div>

          <form className="simulator" onSubmit={requestOtp}>
            <span className="eyebrow">MANUAL TEST</span>
            <h2>Request a mock OTP</h2>
            <p>This endpoint never sends a message or contacts an SMS provider.</p>
            <label htmlFor="recipient">Sandbox recipient ID</label>
            <div className="request-row">
              <input id="recipient" value={recipient} minLength="3" maxLength="64"
                onChange={(event) => setRecipient(event.target.value)} />
              <button disabled={busy || recipient.length < 3}>{busy ? "Sending…" : "Test request"}</button>
            </div>
          </form>

          <section className="resource" aria-label="Backend memory usage">
            <div><strong>Backend memory</strong><span>{metrics.memoryRssMb} MB RSS</span></div>
            <div className="resource-track"><i style={{ width: `${Math.min(100, metrics.memoryRssMb / 5.12)}%` }} /></div>
          </section>
        </section>

        <section className="panel telemetry">
          <div className="panel-heading">
            <div><span className="eyebrow">EVENT STREAM</span><h2>Live telemetry</h2></div>
            <span className="stream-label">WEBSOCKET</span>
          </div>
          <div className="chart" aria-label="Recent accepted and limited request counts">
            <div className="chart-title"><span>Request outcomes</span><small>Recent events</small></div>
            <div className="bars">
              {logs.filter((entry) => entry.status !== null).slice(0, 18).reverse().map((entry) => (
                <div className="bar-track" key={entry.key} title={`${entry.event}: HTTP ${entry.status}`}>
                  <i className={`bar ${entry.status === 429 ? "limited" : "accepted"}`}
                    style={{ height: `${entry.status === 429 ? 74 : 42}%` }} />
                </div>
              ))}
              {logs.length === 0 && <span className="empty-chart">Make a manual request to begin.</span>}
            </div>
            <div className="legend"><span><i className="green-dot" />Accepted</span><span><i className="amber-dot" />Limited</span></div>
          </div>
          <div className="log-heading"><strong>Request log</strong><small>Newest first · up to 40 events</small></div>
          <div className="logs" aria-live="polite">
            {logs.length === 0 && <p className="empty">Waiting for sandbox events…</p>}
            {logs.map((entry) => (
              <div className="log" key={entry.key}>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                <span className={`status ${entry.status === 429 ? "warn" : "ok"}`}>{entry.status ?? "—"}</span>
                <span className="event">{entry.event}</span>
                <span className="latency">{entry.latencyMs ?? "—"}{entry.latencyMs === null ? "" : " ms"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <footer>All requests remain in this local mock service. No real OTPs or SMS messages are generated.</footer>
    </main>
  );
}

function Metric({ label, value, color = "" }) {
  return <article className="metric"><span>{label}</span><strong className={color}>{value}</strong></article>;
}

createRoot(document.getElementById("root")).render(<App />);
