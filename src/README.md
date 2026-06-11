# `src/` — layer boundaries

Single package, two process entrypoints, four layers. The dependency direction
is one-way and enforced as a lint boundary in `eslint.config.js`
(scoped `no-restricted-imports`).

```
entrypoints/   composition roots (api.ts, worker.ts) — may import any layer
   │
   ├── http/             thin Fastify routes + SSE — delegates to application; no infrastructure
   ├── application/      use cases — depends on domain + ports only
   ├── infrastructure/   Drizzle repos, PgJobQueue, providers, NOTIFY bus — implements ports
   └── domain/           pure: status state machines, idempotency keys, backoff, conversation key
                         no framework, no I/O, no Date.now(), no Math.random()
```

Allowed import directions:

- `domain/` → nothing
- `application/` → `domain/` (+ ports)
- `http/` → `application/` (+ `domain/` types)
- `infrastructure/` → `domain/`, `application/` (implements their ports)
- `entrypoints/` → everything (the only place that wires concrete adapters)

Module system is Node ESM with `NodeNext` resolution: **relative imports use the
`.js` extension** (e.g. `import { x } from './backoff.js'`), even though the
source file is `.ts`.
