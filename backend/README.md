# Local OTP Mock Backend

This is a local-only mock authentication service for defensive testing. It
does not generate or send OTPs and has no SMS-provider integration.

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
- `WS /ws` — receive metrics and request events

The default token bucket allows five initial requests and replenishes at five
requests per minute per direct client connection. No real OTP is delivered.
