import { describe, expect, it } from "vitest";
import {
  createRunJournal,
  recordCompactionEnd,
  recordCompactionStart,
  recordInboundMessage,
  recordMemoryFlush,
  recordOutboundMessage,
  recordPolicyDecision,
  recordPolicyDecisions,
  recordRunError,
  recordToolCallEnd,
  recordToolCallStart,
} from "./journal-integration.js";
import type { PolicyDecisionRecord } from "./policy-reason-codes.js";

describe("journal integration helpers", () => {
  it("creates a run journal with session context", () => {
    const journal = createRunJournal({
      sessionKey: "agent:main:main",
      agentId: "main",
      runId: "run-1",
    });
    expect(journal.sessionKey).toBe("agent:main:main");
    expect(journal.events).toHaveLength(0);
  });

  it("records inbound message with preview truncation", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    recordInboundMessage(journal, { prompt: "a".repeat(200), correlationId: "msg-1" });

    expect(journal.events).toHaveLength(1);
    expect(journal.events[0]!.type).toBe("message_in");
    expect(journal.events[0]!.summary.length).toBeLessThan(200);
    expect(journal.events[0]!.summary).toContain("…");
  });

  it("records outbound message", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    recordOutboundMessage(journal, { text: "Hello world" });

    expect(journal.events[0]!.type).toBe("message_out");
    expect(journal.events[0]!.summary).toContain("Hello world");
  });

  it("records tool call start and end with duration", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    const startedAt = Date.now() - 500;
    recordToolCallStart(journal, { toolName: "exec", toolCallId: "tc-1" });
    recordToolCallEnd(journal, {
      toolName: "exec",
      toolCallId: "tc-1",
      startedAt,
      success: true,
    });

    expect(journal.events).toHaveLength(2);
    expect(journal.events[1]!.durationMs).toBeGreaterThanOrEqual(400);
  });

  it("records failed tool call with error payload", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    recordToolCallEnd(journal, {
      toolName: "exec",
      toolCallId: "tc-1",
      startedAt: Date.now(),
      success: false,
      error: "Permission denied",
    });

    expect(journal.events[0]!.severity).toBe("warn");
    expect(journal.events[0]!.payload).toEqual(expect.objectContaining({ error: "Permission denied" }));
  });

  it("records policy decisions from PolicyDecisionRecord", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    const record: PolicyDecisionRecord = {
      code: "exec:allowlist_miss",
      message: "Command not in allowlist",
      toolName: "exec",
    };
    recordPolicyDecision(journal, record);

    expect(journal.events[0]!.type).toBe("policy_decision");
    expect(journal.events[0]!.payload).toEqual({ code: "exec:allowlist_miss", toolName: "exec" });
  });

  it("records multiple policy decisions", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    const records: PolicyDecisionRecord[] = [
      { code: "tool_policy:agent_deny", message: "denied", toolName: "exec" },
      { code: "auth:owner_only", message: "owner only", toolName: "cron" },
    ];
    recordPolicyDecisions(journal, records);

    expect(journal.events).toHaveLength(2);
  });

  it("records compaction start and end", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    recordCompactionStart(journal, { reason: "context overflow", correlationId: "cmp-1" });
    recordCompactionEnd(journal, {
      reason: "context overflow",
      startedAt: Date.now() - 300,
      success: true,
      correlationId: "cmp-1",
    });

    expect(journal.events).toHaveLength(2);
    expect(journal.events[0]!.type).toBe("compaction_start");
    expect(journal.events[1]!.type).toBe("compaction_end");
    expect(journal.events[1]!.durationMs).toBeGreaterThanOrEqual(200);
  });

  it("records memory flush", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    recordMemoryFlush(journal, { path: "memory/2026-04-01.md" });

    expect(journal.events[0]!.type).toBe("memory_flush");
    expect(journal.events[0]!.summary).toContain("memory/2026-04-01.md");
  });

  it("records run errors", () => {
    const journal = createRunJournal({ sessionKey: "test" });
    recordRunError(journal, {
      message: "Provider returned 500",
      provider: "openai",
      model: "gpt-4o",
    });

    expect(journal.events[0]!.type).toBe("error");
    expect(journal.events[0]!.severity).toBe("error");
    expect(journal.events[0]!.payload).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("gracefully no-ops when journal is undefined", () => {
    // All helpers should silently skip when journal is undefined
    expect(() => {
      recordInboundMessage(undefined, { prompt: "hello" });
      recordOutboundMessage(undefined, { text: "hi" });
      recordToolCallStart(undefined, { toolName: "exec", toolCallId: "tc-1" });
      recordToolCallEnd(undefined, { toolName: "exec", toolCallId: "tc-1", startedAt: Date.now(), success: true });
      recordPolicyDecision(undefined, { code: "exec:security_deny", message: "denied" });
      recordPolicyDecisions(undefined, []);
      recordCompactionStart(undefined, { reason: "overflow" });
      recordCompactionEnd(undefined, { reason: "overflow", startedAt: Date.now(), success: true });
      recordMemoryFlush(undefined, {});
      recordRunError(undefined, { message: "oops" });
    }).not.toThrow();
  });
});
