/**
 * Journal integration helpers for the agent run loop.
 *
 * These wrap the session-event-journal convenience creators with the
 * specific context shapes used by pi-embedded-runner and hooks.
 * They're designed to be called from existing lifecycle points
 * without changing the run loop's control flow.
 */

import type { PolicyDecisionRecord } from "./policy-reason-codes.js";
import {
  createSessionEventJournal,
  journalCompactionEnd,
  journalCompactionStart,
  journalError,
  journalMemoryFlush,
  journalMessageIn,
  journalMessageOut,
  journalPolicyDecision,
  journalToolCallEnd,
  journalToolCallStart,
  type SessionEventJournal,
} from "./session-event-journal.js";

// ── Per-run journal factory ──

export type RunJournalContext = {
  sessionKey: string;
  agentId?: string;
  runId?: string;
};

/**
 * Create a journal for a single agent run.
 * Call this at the start of runEmbeddedPiAgent or equivalent entry.
 */
export function createRunJournal(ctx: RunJournalContext): SessionEventJournal {
  return createSessionEventJournal(ctx);
}

// ── Inbound message ──

export function recordInboundMessage(
  journal: SessionEventJournal | undefined,
  params: { prompt: string; correlationId?: string },
): void {
  if (!journal) return;
  const preview = params.prompt.length > 100
    ? params.prompt.slice(0, 100) + "…"
    : params.prompt;
  journalMessageIn(journal, {
    summary: `User: ${preview}`,
    correlationId: params.correlationId,
  });
}

// ── Outbound message ──

export function recordOutboundMessage(
  journal: SessionEventJournal | undefined,
  params: { text: string; correlationId?: string },
): void {
  if (!journal) return;
  const preview = params.text.length > 100
    ? params.text.slice(0, 100) + "…"
    : params.text;
  journalMessageOut(journal, {
    summary: `Assistant: ${preview}`,
    correlationId: params.correlationId,
  });
}

// ── Tool call lifecycle ──

export function recordToolCallStart(
  journal: SessionEventJournal | undefined,
  params: { toolName: string; toolCallId: string },
): void {
  if (!journal) return;
  journalToolCallStart(journal, params);
}

export function recordToolCallEnd(
  journal: SessionEventJournal | undefined,
  params: {
    toolName: string;
    toolCallId: string;
    startedAt: number;
    success: boolean;
    error?: string;
  },
): void {
  if (!journal) return;
  journalToolCallEnd(journal, {
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    durationMs: Date.now() - params.startedAt,
    success: params.success,
    payload: params.error ? { error: params.error } : undefined,
  });
}

// ── Policy decisions ──

export function recordPolicyDecision(
  journal: SessionEventJournal | undefined,
  record: PolicyDecisionRecord,
): void {
  if (!journal) return;
  journalPolicyDecision(journal, {
    code: record.code,
    message: record.message,
    toolName: record.toolName,
    correlationId: record.toolName,
  });
}

export function recordPolicyDecisions(
  journal: SessionEventJournal | undefined,
  records: PolicyDecisionRecord[],
): void {
  if (!journal) return;
  for (const record of records) {
    recordPolicyDecision(journal, record);
  }
}

// ── Compaction lifecycle ──

export function recordCompactionStart(
  journal: SessionEventJournal | undefined,
  params: { reason: string; correlationId?: string },
): void {
  if (!journal) return;
  journalCompactionStart(journal, params);
}

export function recordCompactionEnd(
  journal: SessionEventJournal | undefined,
  params: {
    reason: string;
    startedAt: number;
    success: boolean;
    correlationId?: string;
  },
): void {
  if (!journal) return;
  journalCompactionEnd(journal, {
    reason: params.reason,
    durationMs: Date.now() - params.startedAt,
    success: params.success,
    correlationId: params.correlationId,
  });
}

// ── Memory flush ──

export function recordMemoryFlush(
  journal: SessionEventJournal | undefined,
  params: { path?: string },
): void {
  if (!journal) return;
  journalMemoryFlush(journal, {
    summary: params.path
      ? `Memory flushed to ${params.path}`
      : "Session memory flushed",
  });
}

// ── Errors ──

export function recordRunError(
  journal: SessionEventJournal | undefined,
  params: { message: string; provider?: string; model?: string; correlationId?: string },
): void {
  if (!journal) return;
  journalError(journal, {
    summary: params.message,
    correlationId: params.correlationId,
    payload: {
      ...(params.provider && { provider: params.provider }),
      ...(params.model && { model: params.model }),
    },
  });
}
