# Cadence

A durable, idempotent conversational SMS pipeline: inbound texts are accepted over a
webhook, replies are generated asynchronously, and each reply is sent back with
**exactly-one reply per inbound message**, **strict per-conversation ordering**, and **no
message loss** across crashes and provider retries — plus an admin UI for conversation
history and live status.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node 24 LTS](https://img.shields.io/badge/Node-24%20LTS-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v5-000000?style=flat&logo=fastify&logoColor=white)](https://fastify.dev/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)

The design principle throughout: **boring, reliable technology with the fewest moving
parts that satisfies the guarantees.** PostgreSQL is _both_ the system of record _and_ the
durable job queue — no Redis, no broker, no second stateful system. The full reasoning is
in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## The problem

An SMS arrives. A reply takes 3–15 seconds to generate, but the provider needs a webhook
response in a few seconds — so the reply can never be produced inside the request. Naively
deferring the work to memory loses messages on a crash; processing concurrently answers
message N+1 before N; retrying after a partial failure double-texts the user. Cadence
closes each of these with a database constraint rather than application discipline: persist
**then** ack in one transaction, claim with `FOR UPDATE SKIP LOCKED` under a FIFO
predicate, and deduplicate every effect by a deterministic key.

## Architecture at a glance

```
  POST /webhooks/twilio/sms                              GET /api/events (SSE)
            │                                                      ▲
            ▼                                                      │
   ┌──────────────────┐      ┌────────────────────┐     ┌──────────────────┐
   │  api (Fastify)   │─────▶│   PostgreSQL 16    │◀────│  worker          │
   │  persist-then-ack│      │  record + queue    │     │  claim→process→  │
   │  200 <Response/> │◀─────│  (one stateful sys)│────▶│  send→commit     │
   └────────┬─────────┘      └────────────────────┘     └──────────────────┘
            │ serves the built SPA + REST + SSE                  │
            ▼                                                    ▼
   ┌──────────────────┐                                  SmsProvider.send
   │  admin (React 19)│  list · detail · simulate          (mock | twilio)
   └──────────────────┘
```

**Stack.** TypeScript 5 (strict), Node 24 LTS, Fastify v5, Drizzle ORM over PostgreSQL 16
via the postgres.js driver, Zod at every boundary, pino logs. Admin: React 19 + Vite +
TanStack Query v5 + native `EventSource` + Tailwind v4 + shadcn-ui. Mock SMS provider is
the **zero-config default** — the system runs end-to-end with no secrets.

## Running locally

**Prerequisites:** Docker, and (for host dev only) Node 24 LTS + pnpm 11.

```bash
make up        # build + start the full stack (Postgres, api, worker, admin)
```

Open **<http://localhost:3000>** — the api container serves the admin UI, REST, and SSE on
one port. No environment variables are required; mock SMS is the default.

```bash
make help      # list every target with a description
make down      # stop the stack, keep the Postgres volume
make reset     # stop the stack and drop the volume
make logs      # follow logs from every service
```

For host-based development (Postgres in Docker, api/worker/admin on the host with reload):

```bash
make dev-db        # start Postgres + apply migrations
make dev-api       # api with watch reload   (terminal 1)
make dev-worker    # worker with watch reload (terminal 2)
make dev-admin     # admin Vite dev server    (terminal 3)
```

Every variable is documented in [`.env.example`](./.env.example) and validated by a single
Zod config module at boot; the app fails fast on an invalid value. Copy it to `.env` only
to override a default — `make` includes and exports it automatically.

## Demo (drives the full pipeline from the browser)

In mock mode the admin exposes a **simulate** form that injects an inbound SMS through the
exact same path Twilio would, so you can exercise the whole system with no phone:

1. `make up`, then open <http://localhost:3000>.
2. In the **Simulate inbound** panel, enter a from-number (e.g. `+15551230001`) and a
   message body, then submit. (The system number is supplied server-side, so each distinct
   from-number is its own conversation.)
3. The conversation appears in the list. Open it: the inbound message shows
   `received → processing`, and within 3–15 s a reply appears walking
   `queued → sending → sent`. Updates arrive **live over SSE** — no refresh.
4. Send a second message in the same conversation _before_ the first reply lands to watch
   per-conversation ordering: the second is answered only after the first resolves.
5. Submit from a different from-number to see independent conversations processed in
   parallel.

The same flow is available headlessly:

```bash
curl -X POST http://localhost:3000/dev/simulate-inbound \
  -H 'content-type: application/json' \
  -d '{"from":"+15551230001","body":"hello"}'
```

## Testing

```bash
make test               # backend unit tests (domain + contracts, no Docker)
make test-integration   # integration tests against real Postgres (Testcontainers)
make test-admin         # admin frontend tests
make lint && make typecheck
```

The unit suite covers the pure domain exhaustively (state machines, backoff, keys) with
zero mocks. The integration suite proves each reliability invariant against a real
database — one test per invariant, including the deterministic write-skew race. CI runs
typecheck, lint, unit, and integration on every PR.

## Repository layout

```
src/
  domain/          pure: status machines, backoff, idempotency & conversation keys
  application/     use cases over ports (ingest, process-job, reads)
  infrastructure/  Drizzle repos, PgWorkerQueue, SMS providers, NOTIFY bus, config
  http/            thin Fastify routes + SSE
  entrypoints/     api.ts · worker.ts (composition roots)
drizzle/           migrations + schema
admin/             React 19 + Vite admin (FSD-lite)
test/integration/  invariant tests against real Postgres
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the delivery semantics, the 5-second-timeout
handling, the write-skew analysis, the failure-mode matrix, the data model, the capacity
estimate, and the tradeoffs.
