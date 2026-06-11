# Cadence — Claude Code Guide

A durable, idempotent conversational SMS pipeline with per-conversation ordering guarantees and an admin interface for conversation history.

For the complete system design (architecture, decisions, rationale, acceptance criteria), consult the Notion page **System Design — SMS Pipeline** and its child **Parallel Execution Plan — Cadence (CAD)**. This file covers the day-to-day conventions you need at hand while coding.

The guiding principle behind every decision: **boring, reliable technology with the minimum number of moving parts that satisfies the guarantees.** Where two designs satisfy the same invariant, the one with fewer stateful systems wins.

## Stack

**Backend:** TypeScript 5.4+ (strict), Node 24 LTS (the project tracks the latest Node LTS), Fastify, Drizzle ORM over PostgreSQL 16 via the **postgres.js** driver (the `postgres` package, wired through `drizzle-orm/postgres-js`), `pino` for structured JSON logs. Zod for all boundary validation. PostgreSQL is **both** the system of record **and** the durable job queue — there is no Redis, no broker, no second stateful system.

**Frontend:** React 19, Vite, TanStack Query v5, native `EventSource` for SSE. Minimal and structured — the brief deprioritizes UI polish; status clarity and live updates only.

**Tooling:** pnpm, ESLint 9 flat config, Prettier, Vitest, Testcontainers (or a disposable compose Postgres) for integration tests. GitHub Actions for CI (typecheck, lint, unit, integration).

Versions are pinned via `.nvmrc` (Node) and the `engines` field in `package.json`; deviations fail install.

## Repository structure

Single package, two entrypoints. A full apps/packages monorepo would be ceremony at this size; the seams for splitting later live in the layer boundaries.

```
cadence/
├── src/
│   ├── domain/          # pure: status state machines, idempotency keys, backoff, conversation key
│   ├── application/      # use cases: ingest-inbound-message, process-job, list-conversations
│   ├── infrastructure/   # Drizzle repos, PgJobQueue, SmsProvider/ReplyGenerator adapters, NOTIFY bus
│   ├── http/             # thin Fastify routes + SSE handler
│   └── entrypoints/
│       ├── api.ts        # Fastify server: webhooks, admin REST, SSE
│       └── worker.ts     # claim → process loop, LISTEN wake-up, reconciliation poll, lease reaper
├── drizzle/             # migrations + schema (§4 of the design)
├── admin/               # React + Vite admin frontend
├── test/                # integration tests against real Postgres
├── docker-compose.yml   # Postgres + api + worker
└── .env.example         # every variable documented; mock provider is the zero-config default
```

The exact layout is finalized by the bootstrap task (CAD-7); keep folder boundaries as above so later waves' imports resolve.

## Backend: layered, hexagonal-lite

The structure should visibly come from the design, not from a framework. Fastify was chosen over NestJS precisely so the layering is explicit rather than decorator-driven.

### Dependency rule (enforced by ESLint)

- `domain/` depends on nothing. Pure TS, no framework, no I/O, no `Date.now()`, no `Math.random()`. 100% unit-testable with zero mocks.
- `application/` depends on `domain/` and on ports only — never on a concrete adapter.
- `infrastructure/` implements the ports `domain`/`application` declare (Drizzle repositories, `PgJobQueue`, providers, the NOTIFY bus).
- `http/` is thin: validate → delegate to a use case → serialize. Zero business logic in route handlers (enforced by the PR review checklist).
- `entrypoints/` are composition roots — the only place that wires concrete adapters to use cases.

Reverse imports are forbidden by scoped `no-restricted-imports` rules per layer in the ESLint flat config (a lint boundary kept deliberately free of an extra import-resolver plugin — fewer moving parts).

## The reliability core

This is where correctness is won or lost — the part of the system reviewers look at first. Treat every item here as load-bearing.

### Persist-then-ack in a single transaction

Webhook ingestion is one atomic transaction: ledger insert → conversation upsert → inbound message insert → job insert → `NOTIFY job_created` on commit. There is no state where a message is accepted but has no job, or a job exists for an unpersisted message. The outbox pattern is obtained by construction because the queue **is** the database. Never accept a message into a volatile buffer before it is durable — if Postgres is down, the webhook returns 5xx and Twilio's own retry redelivers.

### The claim query is the single source of truth

The worker claims jobs with a single statement of the shape `UPDATE jobs SET status='running', lease… WHERE id = (SELECT j.id FROM jobs j WHERE … ORDER BY (created_at, id) FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` (design §5.1). `FOR UPDATE SKIP LOCKED LIMIT 1` is a clause of the inner **SELECT**, not of the UPDATE — the subselect locks and picks exactly one candidate row, and the outer UPDATE flips it to `running` and writes the lease. That one statement does four things at once: atomic claim, non-blocking concurrency (`SKIP LOCKED`), per-conversation FIFO (the candidate is claimable only when it has no older non-terminal sibling — a sibling with `status IN ('pending','running')` and `(created_at, id) < (j.created_at, j.id)`), and lease acquisition. This SQL is the most correctness-sensitive code in the repo — it is owned and tested in-repo deliberately (CAD-19). Keep it first-class and readable; do not bury it behind an ORM abstraction.

### Per-conversation serialization is a storage constraint, not predicate reasoning

The FIFO predicate is policy; the partial unique index `one_running_per_conversation` is the **guarantee**. It makes two concurrently `running` jobs of one conversation unrepresentable, closing the `READ COMMITTED` write-skew that the predicate alone cannot (design §5.1.1). A second concurrent runner fails with `unique_violation` (23505), which the worker treats as benign contention and simply claims another job. The deterministic race-forcing test (CAD-24 / AC-4) exists to prove this — never weaken it into a timing-dependent test.

### Idempotency lives in three DB constraints, never in application discipline

| Layer | Threat | Mechanism |
| --- | --- | --- |
| Ingestion | Twilio redelivers the webhook | `UNIQUE (provider_sid)` on `webhook_events`; `ON CONFLICT DO NOTHING RETURNING id` — **zero rows returned is the duplicate signal** (DO NOTHING raises no error), short-circuit with the identical ack |
| Processing | Same inbound enqueued/claimed twice | `UNIQUE (inbound_message_id)` on `jobs`; claim is a single atomic `UPDATE` |
| Sending | A retried job re-sends the reply | deterministic key `reply:{inboundMessageId}`, `UNIQUE` on outbound messages; the provider port receives the key |

### Ports

Every external dependency enters behind a port (`SmsProvider`, `ReplyGenerator`, `JobQueue`). `JobQueue.enqueueInTx(tx, job)` taking the transaction handle is deliberate — it makes acceptance-plus-enqueue atomicity part of the interface contract, not an implementation accident.

### Direction-specific status state machine

A single status enum across both directions produces nonsense (an inbound message that is `sending`). Model per direction, transitions enforced by a pure domain function that throws on an invalid edge:

- **Inbound:** `received → processing → processed | failed`
- **Outbound:** `queued → sending → sent | failed`

The job's own state (`pending → running → completed | failed`) is operational metadata, kept distinct from user-facing message status.

## Frontend: minimal admin

The admin is read-heavy and deliberately scoped to three screens: conversation list (paginated by recency), conversation detail (full inbound/outbound history with per-message status badges, including `failed` with error detail), and — in mock mode only — a simulate form that drives the full pipeline end-to-end from the browser. It lives as its own package in `admin/` (React 19 + Vite + TanStack Query v5 + Tailwind v4 + shadcn-ui), built and tested independently of the backend.

- Live updates via SSE (`GET /api/events`) feeding TanStack Query cache invalidation, keyed by `conversationId`.
- A wide-interval refetch (30 s) stays as **graceful degradation** if the stream drops — documented as fallback, not the primary mechanism.
- No business logic in components: components render, hooks orchestrate, status/derived state comes from pure functions (e.g. `statusBadge`) or shared contracts.
- **FSD-lite architecture** (`app → pages → widgets → features → entities → shared`), with the import direction enforced by ESLint (`import/no-restricted-paths`) the same way the backend layers are. A layer imports only from layers strictly below it; same-layer cross-imports go through a slice's public `index.ts`. Collapse empty layers rather than add ceremony — this is FSD-lite for a small admin, not full FSD. (This supersedes the earlier "no FSD" guidance.)
- The design system is **token-driven**: brand tokens live once in `app/styles/globals.css` (`@theme`), every shadcn semantic variable maps onto them, and swapping the accent reskins the app with no per-component edits. Wire types are re-declared as Zod schemas in `shared/api` and every response is parsed — the inferred type is the truth, no parallel interfaces.

## Shared contracts

All types crossing the HTTP/SSE boundary are Zod schemas. The inferred type **is** the type — do not maintain a parallel hand-written interface.

- **HTTP surface** (design §A.1): `POST /webhooks/twilio/sms` (form payload → `200 text/xml <Response/>`), `GET /api/conversations?cursor=&limit=`, `GET /api/conversations/:id/messages`, `GET /api/events` (SSE), `GET /health`, `POST /dev/simulate-inbound` (mock mode only).
- **NOTIFY channels** (design §A.2): `job_created` (payload: jobId, worker wake-up) and `conversation_changed` (payload: conversationId, SSE fan-out). **Payloads are advisory only** — never a work source. The claim query is the single source of truth; the conversation id only invalidates the right client cache.
- **Status vocabulary** (design §A.3) is the **user-facing message** status only: `received | processing | processed | queued | sending | sent | failed` (inbound walks `received → processing → processed | failed`; outbound walks `queued → sending → sent | failed`). The **job** has its own separate lifecycle — `pending | running | completed | failed` — which is operational metadata and is never surfaced as a message status. Do not conflate the two enums.

Schemas are the contract. If a layer needs a different shape internally, transform at the boundary — never mutate a contract schema for internal convenience.

---

## Coding rules

These are non-negotiable conventions. Apply them from the first commit.

### 1. No `any` without justification

`any` is forbidden unless accompanied by a comment explaining why no better type works. Prefer `unknown` for genuinely unknown input, narrowed via Zod parse or type guard. Enforced with `@typescript-eslint/no-explicit-any`.

### 2. Named constants for domain-meaningful numbers

Numbers carrying domain meaning or appearing more than once become named constants. The lease duration `60_000` becomes `LEASE_DURATION_MS` (deliberately 4× the 15 s worst-case processing). The reconciliation interval `5_000` becomes `RECONCILE_POLL_MS`. Trivial single-use numbers in tests stay inline. The rule is about communication, not constant fetishism.

### 3. No hardcoded strings for status, directions, events, or job states

State machine states, message directions, NOTIFY channel names, and job statuses come from Zod literals or `const` objects with `as const`. Direct comparisons like `if (status === "running")` use the typed constant, never a bare string.

### 4. Constants live near the domain that uses them

No `shared/constants.ts` dumping ground. Backoff parameters live in `domain/backoff.ts`. Lease and poll timings live with the queue in `infrastructure/`. Runtime configuration comes from a single config module that parses env via Zod at boot.

### 5. Validate at boundaries; trust types inside

Every external input passes Zod parse before becoming a TypeScript type: webhook form bodies, REST query params, env vars, and database rows that come back as `unknown`. Inside the domain, trust the type. `as` assertions are a code smell — if you write `value as Foo`, ask whether the schema is wrong or whether this is a boundary that should run a parse. Legitimate uses are narrow (`as const`, `satisfies`).

### 6. Explicit signatures on public APIs

Use cases, ports, repository methods, and anything exported across a layer have explicit return types. Internal helpers can rely on inference when obvious. The rule is about contract clarity at boundaries.

### 7. One function does one thing

If the name needs "and" or "then", split it. The orchestration belongs in the caller, not folded into a helper.

### 8. No business logic in React components

Components render. Hooks orchestrate. Status-badge logic, derived state, and formatting live in pure functions, not inside JSX.

### 9. Early return over nested conditions

Guard clauses at the top, happy path at the bottom. The duplicate short-circuit in ingest (zero rows → return identical ack) and the benign-contention path in claim (unique_violation → claim another) are exactly this shape.

### 10. Test signal, not coverage

Aim for 100% coverage of **behaviors**, not lines.

- `domain/` (state machines, backoff, key derivation): exhaustive, zero mocks, runs in under 2 s with no Docker. Every transition driven by an explicit input; invalid edges asserted to throw; backoff as an (attempt) → bounded-range table.
- **Integration suite (real Postgres) proves the invariants in design §5.4** — one test per invariant. The deterministic write-skew race (AC-4), per-conversation FIFO across failures, no double-claim under concurrent workers, lease-expiry reclaim, retry without duplicate send, poison message terminal + conversation unblocking.
- **Do not re-prove composition.** A primitive proven once in its own test is not re-proven in every consumer.

Test files colocated as `*.test.ts`. Integration tests under `pnpm test:integration`, separate from default `pnpm test`.

### 11. `process.env` only in the config module

No `process.env.FOO` scattered across the codebase. A single config module reads env, validates with Zod, and exports a typed config object. The app fails to boot if required vars are missing or invalid. Mock provider is the default with **zero configuration**.

### 12. No secrets in logs or in the repo

Twilio credentials are never logged and never hardcoded — the application runs end-to-end with none set. Note: phone numbers, message bodies, conversation/message/job ids, and statuses **are** logged — they are the operational record the design depends on for lifecycle reconstruction. The line is around credentials, not the operational data.

### 13. Zod schemas are the contract; the inferred type is the truth

Every cross-boundary payload is a Zod schema, and its inferred type **is** the type — never maintain a parallel hand-written interface. Placement follows ownership:

- **Transport/wire shapes** (the Twilio webhook form, the SSE envelope) live in `http/schemas/`, next to the route that owns them.
- **Use-case input/output contracts** (the ingest command, the admin DTOs) live in `application/contracts/`.

The `http/` layer transforms transport ↔ use-case contract at the boundary (rule 5), so a route never leaks a third party's wire shape into a use case. **Domain entity types** (`Message`, `Job`, `Conversation`) stay plain TS in `domain/` — the DB schema is their source, mapped by the repositories; the domain never imports Zod-derived transport types.

### 14. Adapters for external integrations

Every external integration (the postgres.js driver, Twilio SDK, the simulated/real reply generator) enters as an adapter in `infrastructure/`, implementing a port. Domain and application code never import a client library directly. `MockSmsProvider` and `SimulatedReplyGenerator` are the defaults; `TwilioSmsProvider` is fully implemented but inert unless `SMS_PROVIDER=twilio` and credentials are present.

### 15. Code speaks for itself; comments are rare exceptions

**The default is ZERO comments.** Names, types, and test descriptions carry the spec. Writing a comment is the exception you must justify, not the norm — when in doubt, delete it. A file with no comments is the expected, healthy state.

A comment earns its place only when **both** hold: the reader could not recover the meaning from the code in 5 seconds, **and** it explains *why* (a constraint, a non-obvious consequence, a decision that prevents a real mistake) — never *what* the code does. Apply the **delete test**: if removing the comment loses nothing a competent reader couldn't recover from the code, delete it. Keep the survivors to one line.

These are all banned — they restate the code or belong elsewhere:

- **Tag markers** echoing the signature: `// tx1`, `// read`, `// tx2`, `// status = received`. The parameter (`tx: Tx`) or the name already says it.
- **File/role headers**: `// Output contracts of the read use cases, serialized by http`. The folder and layer say it.
- **Field/line restatements**: `// message text (may be empty)` on `z.string()`, `// user phone` on `from`.
- **Rule citations**: `// single source of truth (rule 3)`. The code shows it; the rule lives here.
- **JSDoc `/** @param ... @returns ... */`** templates on anything.

Design rationale and cross-cutting context belong in ARCHITECTURE.md / the design doc / the PR description, not scattered through code. Good *why* comments are rare and load-bearing — e.g. "zero rows is the duplicate signal", "60 s = 4× worst-case processing", "claim already incremented attempts (§5.1)".

### 16. Domain layer is pure

`domain/` imports nothing from framework, I/O, or async. No Promises (return synchronous results), no client libraries, no `Date.now()`, no `Math.random()`. Time and randomness (backoff jitter) enter as parameters. This is what enables exhaustive behavioral coverage with no mocks.

### 17. Composition over inheritance

No `class X extends Y` for code reuse. Compose via functions, ports, and strategy. There is no `BaseProvider` even though there are two `SmsProvider` implementations — each implements the port independently.

### 18. Rule of three before extracting

Duplication twice is acceptable. On the third occurrence, extract. Premature abstraction shaped against two cases resists the third. Prefer controlled duplication.

### 19. Errors are typed, not strings

In the domain and application layers, errors are class instances compared via `instanceof`, never by `.includes()` on a message. Define types like `InvalidStatusTransitionError`. The one place to read a Postgres error **code** (not message) is benign-contention handling: branch on SQLSTATE `23505` (unique_violation), not on the error text.

### 20. Log levels carry semantics

- `debug`: granular detail for reproducing a problem; off in production by default.
- `info`: lifecycle and state transitions an operator may correlate later — message accepted, job claimed/completed, status transitions, worker startup/shutdown, lease reaped.
- `warn`: recoverable boundary failures — malformed webhook dropped (400), provider send failure with retry scheduled, NOTIFY missed (reconciliation will catch it). The system kept working.
- `error`: unhandled exceptions, terminal `failed` after max attempts, anything that would page someone.

Every line carries `service`, `event`, and — where context exists — `conversationId`, `messageId`, `jobId`. One grep across both processes reconstructs a message's full lifecycle. Bind static context once per scope with `pino` child loggers rather than repeating fields.

---

## Naming conventions

- Files: kebab-case (`process-job.ts`, `ingest-inbound-message.ts`)
- Types and classes: PascalCase
- Functions and variables: camelCase
- Constants: `SCREAMING_SNAKE_CASE` only for truly immutable globals (timings, env names, channel names). Module-level `const` object literals stay camelCase.
- Test files: `*.test.ts` colocated with source; integration tests under `test/`.

## Git and PR conventions

- Commits in imperative mood: "Add claim query", not "Added claim query"
- One concern per commit
- PR descriptions narrative: what changed, why, what was considered and rejected
- One PR per CAD-X task; the task's Jira Context + Scope + Acceptance Criteria are the spec
- **Route handlers contain no business logic** — this is an explicit PR review-checklist item (AC-8)
- Any task touching the Drizzle schema or migrations must not run concurrently with another that does (only CAD-8 edits the schema)

## Operational quirks

- **The webhook ack is `200`, `Content-Type: text/xml`, body `<Response/>` (empty TwiML)** — not JSON. JSON bodies trigger Twilio error 12300 in production. This is the contract Twilio actually specifies.
- **`NOTIFY` is not durable.** A notification emitted while the worker is disconnected is lost forever. That is why a wide-interval reconciliation poll (5 s) always runs as the safety net: **notify for latency, poll for guarantee.** Never trust a notification payload as a work source.
- **The Postgres driver is postgres.js (`postgres`), never node-postgres (`pg`) — do not mix the two.** It is pinned because the design leans on LISTEN/NOTIFY: `sql.listen(channel, cb, onlisten)` maintains a dedicated, auto-reconnecting connection per channel (the worker holds `job_created`, the api holds `conversation_changed`), and the `onlisten` callback fires on every (re)connect — the natural hook to kick a reconciliation sweep and close the "NOTIFY lost while disconnected" gap. `NOTIFY` is emitted from inside the ingest transaction via `SELECT pg_notify('job_created', $jobId)` so it fires exactly on commit. Drizzle wires to the same client through `drizzle-orm/postgres-js`. CAD-15, CAD-20 and CAD-26 all build on this one driver.
- **At-least-once execution, effectively-once effects.** A job may run more than once (crash, lease expiry); every side effect is key-deduplicated, so the user receives at most one reply per inbound message. This is the honest semantics for a system without distributed transactions — the whole design exists to make it hold.
- **FIFO across retries has a real, bounded cost.** When a job fails into backoff, its younger siblings in the **same conversation** wait until it reaches a terminal state — head-of-line blocking, scoped to one conversation, bounded by the retry budget — ~3–6 s with the shipped config defaults (`BACKOFF_BASE_MS=1s`, `BACKOFF_CAP_MS=60s`, `JOB_MAX_ATTEMPTS=3`; the 60 s cap never binds at these small attempts), tuned up in production (the formula and tunings are in design §8.1.1). Other conversations are never affected. This cost is deliberate (design §3.4): replying to message N+1 while N is unresolved produces incoherent conversations. Do not "fix" it by letting siblings overtake.
- **`sent` means provider-accepted, not carrier-delivered.** Twilio delivery-status callbacks are a documented production extension (§9), not in scope here.
- **Mock by default, zero config.** The system runs end-to-end with no env set. Real Twilio is opt-in via `SMS_PROVIDER=twilio` + credentials. The mock honors idempotency keys (same key → same provider SID) and supports failure injection for tests.
- **Twilio signature validation is intentionally absent** in v1 — it is meaningful only with real Twilio traffic and lands as a Fastify `preHandler` (§9). The seam exists; the implementation does not yet.
- **Terminal `failed` rows are the v1 stand-in for a DLQ.** They are visible in the admin with `error_detail`; the replay/DLQ tooling is a documented promotion path (§9), not built now.
- **The first-class SQL escapes the ORM on purpose.** `FOR UPDATE SKIP LOCKED`, the oldest-non-terminal-sibling FIFO predicate, and `ON CONFLICT … RETURNING` are written as readable Drizzle SQL — Drizzle over Prisma precisely because these would become opaque `$queryRaw` strings in Prisma, obscuring the code under evaluation.

## Library and integration documentation

Before implementing against any third-party library, framework, SDK, API, or CLI tool — even well-known ones (Fastify, Drizzle, Vite, React, TanStack Query, Zod, `pino`, Vitest, Testcontainers, the `postgres` (postgres.js) driver, the Twilio SDK) — fetch current documentation via the **Context7 MCP server**. Training data lags releases; Context7 returns the version-correct API surface, configuration shape, and migration notes. The pattern is `resolve-library-id` → `query-docs`. Prefer it over web search and over your own recall, even when confident.

Do **not** use Context7 for refactoring, writing scripts from scratch, debugging our own business logic, code review, or general programming concepts.

## Engineering process

The build follows the **Parallel Execution Plan** (Notion child page): tasks CAD-7 → CAD-31 grouped into eight dependency-ordered waves, each task on its own branch/worktree off the integration branch. Merge a whole wave before starting the next — later waves assume the prior wave's code is present. Within a wave, always staff the critical-path task first (CAD-7 → CAD-13 → CAD-14 → CAD-19 → CAD-23 → CAD-24 → CAD-28 → CAD-31). Highest review scrutiny goes to CAD-19 (the claim) and CAD-24 (the race tests).

Per task: implement against the Acceptance Criteria → self-check against §5.4 invariants and the task's AC → refactor commits removing over-abstraction → smoke test against the local stack (`docker compose up`) → PR.

## When in doubt

Consult **System Design — SMS Pipeline** in Notion. It has the full rationale for every architectural decision, including alternatives considered and rejected. The §7 Acceptance Criteria (AC-1 through AC-8) are the definition of done.
