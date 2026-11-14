# Local OTP Mock Backend

This is a local-only mock authentication service for defensive testing. It
does not generate or send OTPs and has no SMS-provider integration. Its
synthetic demo mode emits labeled telemetry events in memory; it never
generates HTTP requests.

## MVC structure

```text
src/
├── app.js
├── server.js
├── controllers/
├── middleware/
├── models/
├── routes/
└── services/
```

- **Model** (`models/sandboxState.js`) owns in-memory configuration, metrics,
  token buckets, and client defense state.
- **Controllers** validate HTTP input and coordinate model/service calls.
- **Routes** map API paths to controller methods.
- **Services** implement telemetry delivery and bounded synthetic event timing.
- **App/server** configure Express and WebSockets, then start and stop the
  local process.

The frontend was not modified; it continues to use the existing API and
WebSocket contract.

## Run

Requires Node.js 22 or newer.

```sh
npm install
npm start
```

By default the service listens on `127.0.0.1:8080`. All rate-limit state,
configuration, and telemetry are held in memory and reset when the process
stops.

## Test

```sh
npm test
```

The integration suite starts an isolated temporary backend process for each
test. It checks mock request acceptance, the bounded token-bucket limit, and
WebSocket telemetry.

## Endpoints

- `GET /healthz` — local service status
- `GET /api/config` — retrieve the defensive configuration
- `PUT /api/config` — update the three defensive toggles
- `POST /api/request-otp` — submit a mock recipient ID
- `POST /api/demo/start` — start bounded synthetic telemetry
- `POST /api/demo/stop` — stop synthetic telemetry early
- `GET /api/demo/status` — inspect synthetic demo state
- `WS /ws` — receive metrics and request events

The default token bucket allows five initial requests and replenishes at five
requests per minute per direct client connection. Synthetic demos are capped
at 30 seconds, four events per second, and 120 events total. Every generated
event is marked `source: "synthetic-demo"` and does not change request metrics.
No real OTP is delivered.

Start a demo using the API:

```sh
curl -X POST http://127.0.0.1:8080/api/demo/start \
  -H 'Content-Type: application/json' \
  -d '{"durationSeconds":10,"eventsPerSecond":2}'
```
