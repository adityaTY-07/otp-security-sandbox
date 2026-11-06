# OTP Security Benchmarking Sandbox

A local-only teaching sandbox for observing defensive behavior against a mock
OTP request endpoint. It never creates or sends a real OTP and has no SMS
provider integration or automated traffic generator.

See [CHAT_HISTORY.md](./CHAT_HISTORY.md) for a chronological summary of the project conversation.

## Run locally

Requires Docker Engine with the Compose plugin.

```sh
docker compose up --build
```

Open <http://127.0.0.1:5173>. The API and UI host ports bind to loopback only.
Redis has no published host port and uses ephemeral storage. Stop with `Ctrl+C`.

## API

- `GET /healthz` — backend and Redis health
- `GET /api/config` — current defensive configuration
- `PUT /api/config` — update all three security switches as booleans
- `POST /api/request-otp` — process a mock request; JSON body:
  `{"recipient":"demo-user"}`
- `WS /ws` — stream request events, aggregate metrics, and resource telemetry

The Redis-backed token bucket allows a burst of five requests and replenishes
at five requests per minute per direct client connection. Backoff and temporary
blocking apply after rate-limit responses. Counters and configuration are held
in backend memory; rate-limit state uses Redis.

The configuration endpoint is intentionally unauthenticated for this isolated
local demo. Do not expose the service outside the sandbox or use it for real
authentication, recipients, or SMS delivery.

## Run integration tests

Start the Compose services, then run the Node.js built-in test runner inside
the backend container:

```sh
docker compose up -d
docker compose exec backend npm test
```

The suite starts a temporary API process configured to use Redis database 1
and clears only that database between tests. The normal sandbox uses database
0, which these tests do not flush or modify.
