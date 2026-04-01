# ADR: Mode Contract Test Matrix (P4)

- **Status:** Accepted
- **Date:** 2026-04-01
- **Scope:** Codified mode contracts with error taxonomy and failure envelopes

## Context

OpenClaw supports multiple execution modes (direct, sandbox, gateway, node) and session orchestration modes (subagent, acp:run, acp:session). Each mode has distinct lifecycle semantics — connect/auth/health/teardown states, timeout/retry behavior, and failure scenarios.

Without explicit contracts, mode complexity risks drift:
- Inconsistent error messages across modes
- Missing retry logic where transient failures are common
- Unclear lifecycle expectations for contributors

## Decision

### Mode Contract Schema

Define `ModeContract` for each mode:

```ts
{
  mode: AnyMode;
  description: string;
  lifecycleStates: ModeLifecycleState[];
  supportsTimeout: boolean;
  supportsRetry: boolean;
  defaultTimeoutSeconds: number;
  maxRetries: number;
  errors: ModeError[];
}
```

### Error Taxonomy

Each mode error has:
- `category`: auth | network | policy | runtime | timeout | resource | config
- `code`: unique within mode (e.g. `gateway_unreachable`, `acp_sandbox_conflict`)
- `message`: internal diagnostic text
- `retryable`: boolean
- `userFacingMessage`: deterministic, user-friendly text

### Standardized Failure Envelope

```ts
{
  mode: AnyMode;
  state: ModeLifecycleState;
  error: ModeError;
  timestamp: string;
  context?: Record<string, unknown>;
}
```

### Modes Covered

| Mode | Lifecycle | Retry | Errors |
|------|-----------|-------|--------|
| direct | ready→executing→closed | No | 5 |
| sandbox | connecting→auth→ready→executing→teardown→closed | Yes (1) | 6 |
| gateway | connecting→auth→ready→executing→closed | Yes (2) | 5 |
| node | connecting→auth→ready→executing→teardown→closed | Yes (2) | 6 |
| subagent | connecting→ready→executing→teardown→closed | No | 5 |
| acp:run | connecting→auth→ready→executing→teardown→closed | No | 6 |
| acp:session | connecting→auth→ready→executing→teardown→closed | No | 7 |

### Contract Tests

Tests verify:
- All modes have contracts with required fields
- Error codes are unique within each mode
- Retry/timeout semantics are consistent
- Failure envelope creation and formatting
- Mode-specific errors (e.g. `acp_session_not_found` only on `acp:session`)

## Non-goals (this PR)

- No wiring into existing error paths (future: map existing errors to contract codes)
- No CI enforcement of contract coverage against runtime errors
- No mode health-check endpoint

## Follow-up

- Map existing runtime errors to contract error codes
- Add mode health-check probes (gateway/node connectivity)
- CI gate: every mode error path must map to a contract error code
