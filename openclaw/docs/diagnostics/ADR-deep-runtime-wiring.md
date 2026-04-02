# ADR: Deep Runtime Wiring — Run Loop Journal, Full Pipeline Explain, Journal Export (Phase 4b)

- **Status:** Accepted
- **Date:** 2026-04-01
- **Scope:** Wire journal into agent run loop, full policy pipeline in tools.explain, session.journal gateway endpoint

## Context

Phase 4 (dev.7) added gateway API stubs and journal integration helpers. This phase wires them into actual runtime paths for live use.

## Changes

### 1. Run Loop Journal Wiring

`RunEmbeddedPiAgentParams` now accepts an optional `journal` field. When provided, the run loop records:

- **Inbound message** — at prompt receipt (with preview truncation)
- **Compaction start/end** — around timeout-recovery compaction
- **Run errors** — on retry-limit exhaustion
- **Outbound payloads** — before returning results

All journal calls are no-op when journal is `undefined`, so existing callers are unaffected.

### 2. Full Pipeline `policyDecisions` in `tools.explain`

The `tools.explain` handler now:
1. Builds the "before" tool list from the catalog
2. Runs the **real** policy pipeline (`createOpenClawTools` → `applyToolPolicyPipeline`) with `policyDecisions[]` accumulator
3. Applies owner-only filtering with reason tracking
4. Builds a resolution trace from real before/after tool lists with real policy decision records

This replaces the stub that used the effective inventory (which couldn't distinguish before/after).

### 3. `session.journal` Gateway Endpoint

New RPC method `session.journal`:
- Params: `sessionKey` (required), `format` (json|timeline), `types`, `severity`, `correlationId` (all optional filters)
- Returns filtered journal events or formatted timeline text
- Backed by in-memory journal registry (`registerSessionJournal` / `getSessionJournal`)
- Registry is bounded (100 entries, LRU eviction)

### Integration guide for callers

To enable journaling for a run:

```ts
import { createRunJournal } from "./agents/journal-integration.js";
import { registerSessionJournal } from "./gateway/server-methods/tools-diagnostics.js";

const journal = createRunJournal({ sessionKey, agentId, runId });
registerSessionJournal(sessionKey, journal);

// Pass to run loop:
await runEmbeddedPiAgent({ ...params, journal });
```

## Follow-up

- Wire journal into `runEmbeddedAttempt` for per-tool-call start/end events
- Wire journal into memory flush and session start/end hooks
- Persist journals to session store for historical access
- Stream journal events via WebSocket to live dashboards
