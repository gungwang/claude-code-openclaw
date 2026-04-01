/**
 * Mode Contract Matrix
 *
 * Defines the contract for each execution mode in OpenClaw:
 * connect/auth/health/teardown states, timeout/retry behavior,
 * error taxonomy, and deterministic user-facing failure messages.
 *
 * This is the single source of truth for mode behavior expectations.
 */

// ── Mode definitions ──

export const EXEC_MODES = ["direct", "sandbox", "gateway", "node"] as const;
export type ExecMode = (typeof EXEC_MODES)[number];

export const SESSION_MODES = ["subagent", "acp:run", "acp:session"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const ALL_MODES = [...EXEC_MODES, ...SESSION_MODES] as const;
export type AnyMode = ExecMode | SessionMode;

// ── Lifecycle states ──

export type ModeLifecycleState =
  | "connecting"
  | "authenticating"
  | "ready"
  | "executing"
  | "teardown"
  | "closed"
  | "error";

// ── Error taxonomy ──

export type ModeErrorCategory =
  | "auth"
  | "network"
  | "policy"
  | "runtime"
  | "timeout"
  | "resource"
  | "config";

export type ModeError = {
  category: ModeErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  userFacingMessage: string;
};

// ── Mode contract ──

export type ModeContract = {
  mode: AnyMode;
  description: string;
  /** Lifecycle states this mode transitions through. */
  lifecycleStates: ModeLifecycleState[];
  /** Whether this mode supports timeout configuration. */
  supportsTimeout: boolean;
  /** Whether this mode supports retry on transient failure. */
  supportsRetry: boolean;
  /** Default timeout in seconds (0 = no timeout). */
  defaultTimeoutSeconds: number;
  /** Maximum retry attempts for transient failures. */
  maxRetries: number;
  /** Known error scenarios with deterministic failure envelopes. */
  errors: ModeError[];
};

// ── Standardized failure envelope ──

export type ModeFailureEnvelope = {
  mode: AnyMode;
  state: ModeLifecycleState;
  error: ModeError;
  timestamp: string;
  context?: Record<string, unknown>;
};

export function createModeFailureEnvelope(
  mode: AnyMode,
  state: ModeLifecycleState,
  error: ModeError,
  context?: Record<string, unknown>,
): ModeFailureEnvelope {
  return {
    mode,
    state,
    error,
    timestamp: new Date().toISOString(),
    ...(context && Object.keys(context).length > 0 && { context }),
  };
}

export function formatModeFailureEnvelope(envelope: ModeFailureEnvelope): string {
  const retryHint = envelope.error.retryable ? " (retryable)" : "";
  const ctx = envelope.context
    ? ` ${JSON.stringify(envelope.context)}`
    : "";
  return `[${envelope.mode}:${envelope.state}] ${envelope.error.category}/${envelope.error.code}: ${envelope.error.userFacingMessage}${retryHint}${ctx}`;
}

// ── Contract definitions ──

function authError(code: string, message: string, userMessage: string): ModeError {
  return { category: "auth", code, message, retryable: false, userFacingMessage: userMessage };
}
function networkError(code: string, message: string, userMessage: string, retryable = true): ModeError {
  return { category: "network", code, message, retryable, userFacingMessage: userMessage };
}
function policyError(code: string, message: string, userMessage: string): ModeError {
  return { category: "policy", code, message, retryable: false, userFacingMessage: userMessage };
}
function runtimeError(code: string, message: string, userMessage: string, retryable = false): ModeError {
  return { category: "runtime", code, message, retryable, userFacingMessage: userMessage };
}
function timeoutError(code: string, message: string, userMessage: string): ModeError {
  return { category: "timeout", code, message, retryable: true, userFacingMessage: userMessage };
}
function configError(code: string, message: string, userMessage: string): ModeError {
  return { category: "config", code, message, retryable: false, userFacingMessage: userMessage };
}

export const MODE_CONTRACTS: Record<AnyMode, ModeContract> = {
  direct: {
    mode: "direct",
    description: "Direct execution on the gateway host process",
    lifecycleStates: ["ready", "executing", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: false,
    defaultTimeoutSeconds: 120,
    maxRetries: 0,
    errors: [
      policyError("exec_denied", "Execution denied by security policy", "Command execution is disabled (security=deny)."),
      policyError("allowlist_miss", "Command not in allowlist", "Command not allowed. Approve or add to allowlist."),
      policyError("approval_required", "User approval required", "This command requires your approval before running."),
      timeoutError("exec_timeout", "Command exceeded timeout", "Command timed out. Try a shorter operation or increase the timeout."),
      runtimeError("exec_failed", "Command returned non-zero exit code", "Command failed. Check output for details."),
    ],
  },

  sandbox: {
    mode: "sandbox",
    description: "Sandboxed execution in an isolated container",
    lifecycleStates: ["connecting", "authenticating", "ready", "executing", "teardown", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: true,
    defaultTimeoutSeconds: 120,
    maxRetries: 1,
    errors: [
      networkError("sandbox_start_failed", "Sandbox container failed to start", "Sandbox environment failed to start. Retrying..."),
      networkError("sandbox_connection_lost", "Lost connection to sandbox", "Lost connection to sandbox. Retrying..."),
      runtimeError("sandbox_oom", "Sandbox ran out of memory", "Sandbox ran out of memory. Try a smaller operation.", false),
      configError("sandbox_not_configured", "Sandbox backend not configured", "Sandbox is not configured. Check your sandbox settings."),
      policyError("sandbox_write_denied", "Write denied in read-only sandbox", "This sandbox is read-only. Writes are not allowed."),
      timeoutError("sandbox_timeout", "Sandbox operation exceeded timeout", "Sandbox operation timed out."),
    ],
  },

  gateway: {
    mode: "gateway",
    description: "Execution delegated to the gateway daemon",
    lifecycleStates: ["connecting", "authenticating", "ready", "executing", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: true,
    defaultTimeoutSeconds: 300,
    maxRetries: 2,
    errors: [
      authError("gateway_auth_failed", "Gateway authentication failed", "Could not authenticate with gateway. Check your token/password."),
      networkError("gateway_unreachable", "Gateway is not reachable", "Gateway is not running or unreachable. Run `openclaw gateway start`."),
      networkError("gateway_connection_lost", "Lost connection to gateway", "Lost connection to gateway. Reconnecting..."),
      timeoutError("gateway_timeout", "Gateway request timed out", "Gateway request timed out. The gateway may be overloaded."),
      runtimeError("gateway_internal_error", "Gateway internal error", "Gateway encountered an internal error. Check gateway logs.", true),
    ],
  },

  node: {
    mode: "node",
    description: "Execution on a paired remote node device",
    lifecycleStates: ["connecting", "authenticating", "ready", "executing", "teardown", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: true,
    defaultTimeoutSeconds: 60,
    maxRetries: 2,
    errors: [
      authError("node_pairing_required", "Node requires pairing", "This node is not paired. Run `openclaw pairing` to connect."),
      authError("node_unauthorized", "Node rejected authorization", "Node rejected the connection. Re-pair the device."),
      networkError("node_unreachable", "Node is not reachable", "Node is offline or unreachable. Check the device connection."),
      networkError("node_connection_lost", "Lost connection to node", "Lost connection to node. Reconnecting..."),
      timeoutError("node_timeout", "Node operation timed out", "Node operation timed out. The device may be slow or disconnected."),
      runtimeError("node_command_failed", "Command failed on node", "Command failed on the remote node. Check node logs."),
    ],
  },

  subagent: {
    mode: "subagent",
    description: "Isolated sub-agent session spawned within the gateway",
    lifecycleStates: ["connecting", "ready", "executing", "teardown", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: false,
    defaultTimeoutSeconds: 0,
    maxRetries: 0,
    errors: [
      policyError("subagent_spawn_denied", "Sub-agent spawn denied by policy", "Cannot spawn sub-agent. Check tool policy or spawn depth limits."),
      policyError("subagent_depth_exceeded", "Maximum spawn depth exceeded", "Cannot spawn: maximum sub-agent nesting depth reached."),
      runtimeError("subagent_failed", "Sub-agent run failed", "Sub-agent encountered an error. Check its output for details."),
      timeoutError("subagent_timeout", "Sub-agent exceeded timeout", "Sub-agent timed out. Try a simpler task or increase the timeout."),
      configError("subagent_agent_not_found", "Target agent not found", "The requested agent ID is not configured."),
    ],
  },

  "acp:run": {
    mode: "acp:run",
    description: "One-shot ACP harness session (Codex, Claude Code, etc.)",
    lifecycleStates: ["connecting", "authenticating", "ready", "executing", "teardown", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: false,
    defaultTimeoutSeconds: 0,
    maxRetries: 0,
    errors: [
      policyError("acp_denied", "ACP spawn denied by policy", "ACP sessions are not enabled. Check acp.allowedAgents config."),
      policyError("acp_sandbox_conflict", "ACP cannot run from sandbox", "Cannot spawn ACP from a sandboxed session. Use runtime=\"subagent\"."),
      configError("acp_agent_not_configured", "ACP agent not configured", "No ACP agent configured. Set acp.defaultAgent or pass agentId."),
      runtimeError("acp_harness_failed", "ACP harness process failed", "The coding agent failed to start. Check that it is installed."),
      runtimeError("acp_harness_crashed", "ACP harness process crashed", "The coding agent crashed unexpectedly. Check its output."),
      timeoutError("acp_timeout", "ACP session exceeded timeout", "ACP session timed out."),
    ],
  },

  "acp:session": {
    mode: "acp:session",
    description: "Persistent ACP harness session (thread-bound)",
    lifecycleStates: ["connecting", "authenticating", "ready", "executing", "teardown", "closed", "error"],
    supportsTimeout: true,
    supportsRetry: false,
    defaultTimeoutSeconds: 0,
    maxRetries: 0,
    errors: [
      policyError("acp_denied", "ACP spawn denied by policy", "ACP sessions are not enabled. Check acp.allowedAgents config."),
      policyError("acp_sandbox_conflict", "ACP cannot run from sandbox", "Cannot spawn ACP from a sandboxed session. Use runtime=\"subagent\"."),
      configError("acp_agent_not_configured", "ACP agent not configured", "No ACP agent configured. Set acp.defaultAgent or pass agentId."),
      runtimeError("acp_harness_failed", "ACP harness process failed", "The coding agent failed to start. Check that it is installed."),
      runtimeError("acp_harness_crashed", "ACP harness process crashed", "The coding agent crashed unexpectedly. Check its output."),
      runtimeError("acp_session_not_found", "ACP session not found for resume", "Cannot resume: the ACP session was not found."),
      timeoutError("acp_timeout", "ACP session exceeded timeout", "ACP session timed out."),
    ],
  },
};

// ── Lookup helpers ──

export function getModeContract(mode: AnyMode): ModeContract {
  return MODE_CONTRACTS[mode];
}

export function findModeError(mode: AnyMode, code: string): ModeError | undefined {
  return MODE_CONTRACTS[mode]?.errors.find((e) => e.code === code);
}

export function listModesWithRetry(): AnyMode[] {
  return ALL_MODES.filter((mode) => MODE_CONTRACTS[mode].supportsRetry);
}

export function listModeErrors(mode: AnyMode): ModeError[] {
  return MODE_CONTRACTS[mode]?.errors ?? [];
}
