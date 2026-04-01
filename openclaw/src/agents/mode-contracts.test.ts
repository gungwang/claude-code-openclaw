import { describe, expect, it } from "vitest";
import {
  ALL_MODES,
  createModeFailureEnvelope,
  EXEC_MODES,
  findModeError,
  formatModeFailureEnvelope,
  getModeContract,
  listModeErrors,
  listModesWithRetry,
  MODE_CONTRACTS,
  SESSION_MODES,
  type AnyMode,
} from "./mode-contracts.js";

describe("mode contracts", () => {
  it("defines contracts for all exec modes", () => {
    for (const mode of EXEC_MODES) {
      const contract = getModeContract(mode);
      expect(contract).toBeDefined();
      expect(contract.mode).toBe(mode);
      expect(contract.description).toBeTruthy();
      expect(contract.lifecycleStates.length).toBeGreaterThan(0);
      expect(contract.errors.length).toBeGreaterThan(0);
    }
  });

  it("defines contracts for all session modes", () => {
    for (const mode of SESSION_MODES) {
      const contract = getModeContract(mode);
      expect(contract).toBeDefined();
      expect(contract.mode).toBe(mode);
      expect(contract.description).toBeTruthy();
    }
  });

  it("every mode error has required fields", () => {
    for (const mode of ALL_MODES) {
      const errors = listModeErrors(mode);
      for (const error of errors) {
        expect(error.category).toBeTruthy();
        expect(error.code).toBeTruthy();
        expect(error.message).toBeTruthy();
        expect(typeof error.retryable).toBe("boolean");
        expect(error.userFacingMessage).toBeTruthy();
      }
    }
  });

  it("error codes are unique within each mode", () => {
    for (const mode of ALL_MODES) {
      const errors = listModeErrors(mode);
      const codes = errors.map((e) => e.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("finds errors by mode and code", () => {
    const error = findModeError("direct", "exec_denied");
    expect(error).toBeDefined();
    expect(error!.category).toBe("policy");
    expect(error!.retryable).toBe(false);
  });

  it("returns undefined for unknown error codes", () => {
    expect(findModeError("direct", "nonexistent")).toBeUndefined();
  });

  it("lists modes that support retry", () => {
    const retryModes = listModesWithRetry();
    expect(retryModes).toContain("sandbox");
    expect(retryModes).toContain("gateway");
    expect(retryModes).toContain("node");
    expect(retryModes).not.toContain("direct");
    expect(retryModes).not.toContain("subagent");
  });

  it("creates a failure envelope with context", () => {
    const error = findModeError("node", "node_unreachable")!;
    const envelope = createModeFailureEnvelope("node", "connecting", error, {
      nodeId: "my-phone",
    });

    expect(envelope.mode).toBe("node");
    expect(envelope.state).toBe("connecting");
    expect(envelope.error.code).toBe("node_unreachable");
    expect(envelope.context).toEqual({ nodeId: "my-phone" });
    expect(envelope.timestamp).toBeTruthy();
  });

  it("formats a failure envelope into a diagnostic line", () => {
    const error = findModeError("gateway", "gateway_unreachable")!;
    const envelope = createModeFailureEnvelope("gateway", "connecting", error);

    const formatted = formatModeFailureEnvelope(envelope);
    expect(formatted).toContain("[gateway:connecting]");
    expect(formatted).toContain("network/gateway_unreachable");
    expect(formatted).toContain("(retryable)");
  });

  it("direct mode does not support retry", () => {
    const contract = getModeContract("direct");
    expect(contract.supportsRetry).toBe(false);
    expect(contract.maxRetries).toBe(0);
  });

  it("sandbox mode transitions through full lifecycle", () => {
    const contract = getModeContract("sandbox");
    expect(contract.lifecycleStates).toContain("connecting");
    expect(contract.lifecycleStates).toContain("teardown");
    expect(contract.lifecycleStates).toContain("closed");
  });

  it("ACP modes share common errors but session has resume error", () => {
    const runErrors = listModeErrors("acp:run").map((e) => e.code);
    const sessionErrors = listModeErrors("acp:session").map((e) => e.code);

    expect(runErrors).toContain("acp_denied");
    expect(sessionErrors).toContain("acp_denied");
    expect(sessionErrors).toContain("acp_session_not_found");
    expect(runErrors).not.toContain("acp_session_not_found");
  });
});
