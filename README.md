# OTP Security Sandbox

A small, local-only mock OTP application. The backend runs in your terminal,
and the React dashboard sends it manual test input and displays live telemetry.
No real OTPs are created or sent.

## Requirements

- Node.js 22 or newer
- npm

## Start the app

From the project directory:

```sh
npm --prefix backend install
npm run dev
```

The backend serves the existing built dashboard and API from one local server.
Open <http://127.0.0.1:8080>. Use the recipient field and **Test request**
button to submit input; the backend handles it locally and streams outcomes to
the dashboard over WebSocket.

Stop both processes with `Ctrl+C`.

## Defensive behavior

- The service binds to `127.0.0.1` by default.
- The in-memory token bucket allows a burst of five requests and replenishes
  at five requests per minute per direct client address.
- Rate limiting, exponential backoff, and temporary blocking can be toggled
  from the dashboard.
- Request metrics and rate-limit state are kept in process memory and reset
  when the backend stops.
- The optional synthetic demo emits labeled fake events locally for the
  dashboard. It sends no requests, changes no request counters, and is capped
  at 30 seconds and four events per second.
- There is no Docker, Redis, or SMS provider.

## Tests

Run the integration tests with:

```sh
npm test
```

Each test starts its own temporary backend process on loopback, giving it fresh
in-memory state. The suite checks accepted mock input, rate limiting, and
WebSocket telemetry.

## API

- `GET /healthz` — backend status
- `GET /api/config` — current defensive configuration
- `PUT /api/config` — update all three defensive settings
- `POST /api/request-otp` — mock request with `{"recipient":"demo-user"}`
- `POST /api/demo/start` — start a bounded local synthetic event stream
- `POST /api/demo/stop` — stop the synthetic stream
- `GET /api/demo/status` — view synthetic demo state
- `WS /ws` — live metrics and event stream
