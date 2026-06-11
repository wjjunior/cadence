## What changed

<!-- A narrative summary: what this PR does. -->

## Why

<!-- The motivation, and what was considered and rejected. -->

## How it was verified

<!-- Tests added/run, manual checks, AC mapping. -->

## Review checklist

- [ ] Route handlers contain no business logic (validate → delegate to a use case → serialize)
- [ ] External inputs (webhook bodies, query params, env, DB rows) are validated at the boundary
- [ ] Domain code stays pure (no I/O, no `Date.now()`, no `Math.random()`)
- [ ] Status, direction, event and job-state values come from typed constants, not bare strings
- [ ] No secrets in logs or in the repo
- [ ] One PR per CAD-X task; the migration/schema is touched by at most this one task
