# Architecture — Cadence

A durable, idempotent conversational SMS pipeline. An inbound text is accepted over a
webhook, a reply is generated asynchronously, and the reply is sent back — with
**exactly-one reply per inbound message**, **strict per-conversation ordering**, and **no
message loss**, even across crashes and provider retries.

The guiding principle is **boring, reliable technology with the fewest moving parts that
satisfies the guarantees**. The decisive consequence: PostgreSQL is _both_ the system of
record _and_ the durable job queue. There is no Redis, no broker, no second stateful
system to lose data or fall out of sync.

---

## 1. Overview

Two processes over one database:

```
                          POST /webhooks/twilio/sms
                                    │
                          ┌─────────▼──────────┐
   Twilio  ──────────────▶│  api (Fastify)     │   200 text/xml <Response/>
   (or mock simulate)      │  persist-then-ack  │──────────────▶ (ack in one
                          └─────────┬──────────┘                  local txn)
                                    │ one transaction:
                                    │  webhook_events → conversations →
                                    │  messages(inbound) → jobs →
                                    │  pg_notify('job_created')
                                    ▼
                          ╔════════════════════╗
                          ║   PostgreSQL 16    ║  system of record
                          ║  + durable queue   ║  AND job queue
                          ╚═════════╤══════════╝
                                    │ claim (FOR UPDATE SKIP LOCKED + FIFO predicate)
                          ┌─────────▼──────────┐
                          │  worker            │  claim → process → send → commit
                          │  N concurrent slots│  lease + reaper + reconcile poll
                          └─────────┬──────────┘
                                    │ SmsProvider.send (mock | twilio)
                                    ▼
                              reply delivered
                                    │ conversation_changed
                                    ▼
                          ┌────────────────────┐
                          │  admin (React 19)  │  SSE live updates
                          │  list · detail     │  conversation history + status
                          └────────────────────┘
```

- **api** — accepts the webhook, validates it, persists everything in one transaction,
  and acks. Serves the admin REST + SSE surface, and (in the container) the built admin
  SPA itself.
- **worker** — claims jobs, runs the simulated reply generator (3–15 s), sends the
  outbound SMS, and commits the result. Runs `WORKER_CONCURRENCY` claim loops in one
  process and scales horizontally by adding processes.
- **PostgreSQL** — every durable fact and every unit of work. The queue _is_ a table.

The layering is hexagonal-lite and ESLint-enforced: `domain/` (pure, no I/O) →
`application/` (use cases over ports) → `infrastructure/` (adapters) → `http/` (thin
routes) → `entrypoints/` (composition roots). The structure comes from the design, not a
framework.

---

## 2. Delivery semantics and invariants

The honest semantics of a system without distributed transactions are
**at-least-once execution, effectively-once effects**. A job may run more than once (a
crash after sending but before commit, a lease expiry), but every externally visible
effect is deduplicated by a database constraint, so the user receives **at most one
reply per inbound message**.

The invariants the rest of this document defends:

| #   | Invariant                                          | Enforced by                                       |
| --- | -------------------------------------------------- | ------------------------------------------------- |
| I1  | An accepted message always has a durable job       | single ingest transaction (§4)                    |
| I2  | A redelivered webhook produces no new work         | `UNIQUE (provider_sid)` (§5)                      |
| I3  | One inbound is processed at most once              | `UNIQUE (inbound_message_id)` + atomic claim (§5) |
| I4  | A reply is sent at most once                       | `reply:{inboundMessageId}` idempotency key (§5)   |
| I5  | At most one running job per conversation           | partial unique index (§6)                         |
| I6  | Replies within a conversation are strictly ordered | FIFO claim predicate (§6)                         |
| I7  | No accepted message is ever lost                   | persist-then-ack + Twilio retry (§4, §7)          |

Each invariant has a dedicated integration test against real Postgres (§9).

---

## 3. Handling the 5-second webhook timeout

Twilio expects a webhook response within a few seconds; reply generation here takes
**3–15 s** (the simulated model latency). The reply can therefore _never_ be produced
inside the request. The pipeline is split at exactly that seam:

1. The webhook handler does only **durable, local, bounded** work: a single PostgreSQL
   transaction that records the event, upserts the conversation, inserts the inbound
   message, enqueues a job, and fires `NOTIFY`. This is a handful of indexed writes on a
   loopback connection — single-digit milliseconds, with no external call on the path.
2. It immediately returns `200 text/xml <Response/>` — the empty-TwiML ack Twilio
   actually specifies (a JSON body triggers Twilio error 12300 in production).
3. The slow reply generation happens later, in the worker, completely off the request
   path.

So the timeout is met **by construction**: the only work on the hot path is the work that
makes the message durable. The expensive work is deferred to a process whose latency
budget is unrelated to the webhook.

`src/http/routes/webhook.ts` · `src/application/ingest-inbound-message.ts`

---

## 4. Decoupling and the durable queue (no message loss)

The split above only prevents loss if the handoff is durable. It is, because the queue is
a table written in the **same transaction** as the message:

```
BEGIN
  INSERT webhook_events (provider_sid, payload)   ON CONFLICT DO NOTHING
  INSERT/UPDATE conversations
  INSERT messages (inbound, status='received')
  INSERT jobs    (inbound_message_id, status='pending')
  SELECT pg_notify('job_created', …)
COMMIT      ← the message and its job become visible atomically
```

There is no instant where a message is accepted but has no job, and no instant where a
job exists for an unpersisted message. The **outbox pattern is obtained for free** because
there is no second system to write to — the queue and the record are the same database.

This is why a message is never lost. If Postgres is unreachable, the transaction never
commits, the handler returns 5xx, and **Twilio's own retry redelivers** — which is safe
because of idempotency (§5). A message is never accepted into a volatile in-memory buffer
that a crash could drop.

`NOTIFY` is only a **latency optimization**, never a source of work. It is not durable: a
notification emitted while the worker is disconnected is lost forever. So the worker also
runs a wide-interval **reconciliation poll** (5 s) and re-sweeps the table on every
LISTEN (re)connect. The rule is **notify for latency, poll for guarantee** — correctness
never depends on a notification arriving.

`src/infrastructure/worker/worker-runtime.ts` · `src/infrastructure/events/pg-event-bus.ts`

---

## 5. Idempotency in three database constraints

Idempotency lives in **storage constraints, not application discipline** — a constraint
cannot be forgotten under load the way a code path can. Each of the three duplicate
threats is closed at a different layer:

| Threat                              | Mechanism                                                                                    | Behaviour                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Twilio redelivers the webhook       | `UNIQUE (provider_sid)` on `webhook_events`; `INSERT … ON CONFLICT DO NOTHING RETURNING id`  | **Zero rows returned is the duplicate signal** — short-circuit with the identical ack. `DO NOTHING` raises no error. |
| Same inbound enqueued/claimed twice | `UNIQUE (inbound_message_id)` on `jobs`; the claim is one atomic `UPDATE`                    | A second enqueue cannot exist; a second claim cannot win.                                                            |
| A retried job re-sends the reply    | deterministic key `reply:{inboundMessageId}`, partial `UNIQUE` on outbound `idempotency_key` | The reply row is unique; the same key reaches the provider port, and the mock returns the same SID for the same key. |

The deterministic reply key is what makes effects effectively-once: re-running a job
re-derives the _same_ key (`replyIdempotencyKey(inboundMessageId)`), so the outbound
insert and the provider send both collapse onto the prior result instead of duplicating.

`src/infrastructure/db/schema.ts` · `src/domain/idempotency.ts` ·
`src/infrastructure/sms/mock-sms-provider.ts`

---

## 6. Per-conversation ordering and the write-skew analysis

The requirement: within one conversation, message N+1 is not answered before N is
resolved — otherwise the conversation is incoherent. Across _different_ conversations
there is full parallelism.

This is enforced in **two layers**, because one alone is insufficient.

### 6.1 The FIFO predicate (policy)

The claim is a single statement. The inner `SELECT` picks exactly one candidate and the
outer `UPDATE` flips it to `running` and writes the lease:

```sql
UPDATE jobs SET status='running', locked_by=$worker,
  lease_expires_at = now() + $lease, attempts = attempts + 1
WHERE id = (
  SELECT j.id FROM jobs j
  WHERE j.status='pending' AND j.next_run_at <= now()
    AND NOT EXISTS (                              -- FIFO: no older non-terminal sibling
      SELECT 1 FROM jobs r
      WHERE r.conversation_id = j.conversation_id
        AND r.status IN ('pending','running')
        AND (r.created_at, r.id) < (j.created_at, j.id))
  ORDER BY j.created_at, j.id
  FOR UPDATE SKIP LOCKED                          -- non-blocking concurrency
  LIMIT 1)
RETURNING *;
```

One statement does four things at once: **atomic claim**, **non-blocking concurrency**
(`SKIP LOCKED` lets other workers skip a locked candidate instead of queueing behind it),
**per-conversation FIFO** (a job is claimable only when it has no older `pending`/`running`
sibling), and **lease acquisition**. This is the most correctness-sensitive code in the
repo and is written as readable SQL on purpose — it is owned and tested in-repo, not
buried under an ORM.

### 6.2 The partial unique index (guarantee)

The predicate is _policy_; under `READ COMMITTED` it is not enough. Two workers can each
run the `NOT EXISTS` subquery at the same instant, both observe no running sibling, and
both proceed — a classic **write-skew**: each transaction reads a set, the set looks
empty to both, and both write into it. The predicate cannot see the other in-flight
transaction's not-yet-committed row.

The closing guarantee is a storage constraint that makes the bad state
_unrepresentable_:

```sql
CREATE UNIQUE INDEX one_running_per_conversation
  ON jobs (conversation_id) WHERE status = 'running';
```

Now two concurrently-`running` jobs of one conversation **cannot both commit**. The loser
fails with `unique_violation` (SQLSTATE `23505`), which the worker treats as **benign
contention** and simply claims another job. Serialization is a property of the data shape,
not of correctly-ordered reads.

The deterministic race-forcing test (`worker-invariants.test.ts`, "write-skew,
deterministic") proves this without timing dependence: it drives two claims into the exact
interleaving and asserts the second is rejected.

### 6.3 The cost of ordering

FIFO across retries has a real, bounded cost: when a job fails into backoff, its younger
siblings **in the same conversation** wait until it reaches a terminal state —
head-of-line blocking, scoped to one conversation, bounded by the retry budget (~3–6 s at
the shipped defaults). Other conversations are unaffected. This is deliberate: letting a
sibling overtake would answer N+1 before N. We do not "fix" it.

`src/infrastructure/job-queue/pg-worker-queue.ts` · `src/infrastructure/db/schema.ts`

---

## 7. Failure modes

| Failure                           | What happens                                                       | Why it is safe                                      |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| Postgres unreachable at ingest    | txn never commits, handler returns 5xx                             | Twilio retries; idempotent on redelivery (I2)       |
| Duplicate webhook                 | `ON CONFLICT DO NOTHING` returns 0 rows                            | identical ack, no second job (I2)                   |
| Worker crashes mid-process        | lease expires; reaper returns the job to `pending`                 | re-run is effectively-once via the reply key (I4)   |
| Two workers race one conversation | partial unique index rejects the loser (`23505`)                   | benign contention → claim another job (I5)          |
| Provider send fails               | job rescheduled with capped-exponential backoff + jitter           | outbound is not re-inserted; same key on retry (I4) |
| Reply generation throws           | same retry path; attempts counted                                  | bounded by `JOB_MAX_ATTEMPTS`                       |
| Attempts exhausted (poison)       | job `failed`; inbound+outbound marked `failed` with `error_detail` | conversation unblocks immediately; visible in admin |
| `NOTIFY` lost (worker offline)    | reconciliation poll / LISTEN-reconnect sweep finds the job         | poll is the guarantee, notify is the optimization   |

Backoff is a pure domain function: `backoffDelay(attempt, base, cap, jitter)` —
capped exponential with jitter, time and randomness injected as parameters so it is
exhaustively testable with no clock.

Terminal `failed` rows are the v1 stand-in for a dead-letter queue: visible in the admin
with `error_detail`, replayable by hand. A real DLQ/replay tool is a documented
promotion path, not built now.

`src/application/process-job.ts` · `src/domain/backoff.ts`

---

## 8. Data model

Five tables. Message status is modeled **per direction** because a single cross-direction
enum produces nonsense (an inbound message that is `sending`).

```
conversations               messages                         jobs
─────────────               ────────                         ────
id (uuid, pk)               id (uuid, pk)                    id (uuid, pk)
user_phone        ┌────────▶conversation_id (fk)◀──────────┐ inbound_message_id (fk, UNIQUE)
system_phone      │         direction  in|out               │ conversation_id (fk, denorm.)
last_message_at   │         body                             │ status pending|running|
created_at        │         status  (per-direction machine) │        completed|failed
UNIQUE(user,sys)  │         provider_message_sid             │ attempts / max_attempts
recency index ────┘         idempotency_key                  │ next_run_at
                            in_reply_to (self-fk)             │ locked_by / lease_expires_at
                            error_detail                      │ last_error / created_at
                            created/updated_at                │
webhook_events              ───────────────────              │ INDEX (status,next_run_at) WHERE pending
─────────────               UNIQUE(provider_message_sid)     │ INDEX (conv,created) WHERE pending|running
id (uuid, pk)                  WHERE direction='inbound'      │ UNIQUE(conversation_id)  WHERE running
provider_sid (UNIQUE)       UNIQUE(idempotency_key)          └─    = one_running_per_conversation
payload (jsonb)                WHERE direction='outbound'
received_at                                                  worker_heartbeats(worker_id pk, last_beat_at)
```

State machines (enforced by a pure domain function that throws on an invalid edge):

- **Inbound message:** `received → processing → processed | failed`
- **Outbound message:** `queued → sending → sent | failed`
- **Job (operational, separate):** `pending → running → completed | failed`

The job lifecycle is operational metadata and is deliberately _never_ surfaced as a
user-facing message status. `sent` means **provider-accepted**, not carrier-delivered
(delivery-status callbacks are a documented production extension).

`src/infrastructure/db/schema.ts` · `src/domain/status.ts` · `src/domain/job.ts`

---

## 9. Testing the invariants

The test strategy targets **behaviors, not lines**.

- **Domain** (`src/domain/*.test.ts`) — state machines, backoff, conversation key,
  idempotency key. Exhaustive, zero mocks, no Docker; every transition driven by explicit
  input, invalid edges asserted to throw.
- **Integration** (`test/integration/*.test.ts`, real Postgres via Testcontainers) — one
  test per invariant in `worker-invariants.test.ts`:
  - write-skew rejection (deterministic, AC-4)
  - no double-claim under 4 concurrent workers draining 50 jobs
  - same-conversation FIFO order under concurrency
  - younger-sibling blocking during backoff, released on terminal failure
  - different conversations processed in parallel (wall-clock)
  - lease-expiry reclaim delivering exactly one reply
  - poison job → terminal `failed` + immediate conversation unblock
- **Ingestion durability** (`ingestion-durability.test.ts`) — an accepted webhook yields a
  job the _real_ queue can claim.

A primitive proven once in its own test is not re-proven in every consumer.

---

## 10. Capacity

The throughput ceiling is **not** the queue — Postgres `SKIP LOCKED` claims sustain
thousands of ops/s. It is the **simulated reply latency** (3–15 s, mean ~9 s), which is an
artifact of the brief, not the architecture.

A back-of-envelope estimate: one worker with `WORKER_CONCURRENCY=10` busy slots and a ~9 s
mean reply holds ~10⁄9 ≈ **1.1 replies/s ≈ ~95k/day**. Throughput scales linearly by
adding worker processes — `SKIP LOCKED` means N workers contend without blocking, and the
partial unique index keeps per-conversation safety intact regardless of N. The api scales
independently; ingest is a few milliseconds of indexed writes. The first real bottleneck
would be Postgres write throughput, far above this brief's load, and the documented next
step (partitioning / a dedicated queue) is a change of one adapter.

---

## 11. Tradeoffs

- **Postgres as queue vs. a broker (SQS/Redis/Kafka).** Chosen: fewer moving parts, the
  outbox-by-construction property, transactional enqueue. Cost: claim throughput is
  bounded by Postgres, not a purpose-built broker. At this scale, correctness and
  operability win decisively.
- **FIFO ordering vs. throughput.** Chosen: strict per-conversation order. Cost: bounded
  head-of-line blocking within one conversation during retries. Coherent conversations are
  the product requirement; this cost is deliberate and scoped.
- **At-least-once vs. exactly-once.** Exactly-once delivery is unattainable without
  distributed transactions across Postgres and the SMS provider. Chosen: at-least-once
  execution with key-deduplicated effects — honest and provable.
- **First-class SQL vs. ORM abstraction.** The claim query, the FIFO predicate, and
  `ON CONFLICT … RETURNING` are readable Drizzle SQL, not opaque ORM calls — the most
  correctness-sensitive code stays legible and directly testable.
- **Two processes, one package vs. a monorepo.** A single package with two entrypoints;
  the seams for splitting live at the layer boundaries. Less ceremony at this size.
