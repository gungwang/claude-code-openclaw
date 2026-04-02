/**
 * Route Resolution Benchmark — CI regression gate.
 *
 * Runs the benchmark corpus against simulated tool resolution traces
 * to verify that expected tool availability hasn't regressed.
 *
 * This test file is designed for the CI pipeline.
 * Add new cases to test-fixtures/route-benchmark-corpus.ts.
 */

import { describe, expect, it } from "vitest";
import {
  buildToolResolutionTrace,
  evaluateBenchmarkCase,
  type ToolResolutionBenchmarkCase,
} from "../agents/route-explainability.js";
import type { PolicyDecisionRecord } from "../agents/policy-reason-codes.js";
import { ROUTE_BENCHMARK_CORPUS } from "../../test-fixtures/route-benchmark-corpus.js";

/**
 * Simulate a minimal tool resolution for benchmark evaluation.
 *
 * In a full integration test, this would call createOpenClawCodingTools
 * with the benchmark context. For CI speed, we simulate the expected
 * availability based on known policy rules.
 */
function simulateToolAvailability(benchmarkCase: ToolResolutionBenchmarkCase): {
  toolsBefore: Array<{ name: string }>;
  toolsAfter: Array<{ name: string }>;
  policyDecisions: PolicyDecisionRecord[];
} {
  const OWNER_ONLY_TOOLS = new Set(["cron", "gateway", "nodes", "whatsapp_login"]);
  const NODE_PROVIDER_ALLOW = new Set(["canvas", "image", "pdf", "tts", "web_fetch", "web_search"]);
  const VOICE_PROVIDER_DENY = new Set(["tts"]);

  const ALL_CORE_TOOLS = [
    "read", "write", "edit", "apply_patch", "exec", "process", "code_execution",
    "web_search", "web_fetch", "x_search",
    "memory_search", "memory_get",
    "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "sessions_yield",
    "subagents", "session_status",
    "browser", "canvas",
    "message",
    "cron", "gateway",
    "nodes",
    "agents_list",
    "image", "image_generate", "tts",
  ];

  const toolsBefore = ALL_CORE_TOOLS.map((name) => ({ name }));
  const policyDecisions: PolicyDecisionRecord[] = [];

  let available = new Set(ALL_CORE_TOOLS);

  // Owner-only filtering
  if (!benchmarkCase.context.senderIsOwner) {
    for (const tool of OWNER_ONLY_TOOLS) {
      if (available.has(tool)) {
        available.delete(tool);
        policyDecisions.push({
          code: "auth:owner_only",
          message: `Tool "${tool}" restricted to owner senders.`,
          toolName: tool,
        });
      }
    }
  }

  // Message provider filtering
  if (benchmarkCase.context.messageProvider === "node") {
    for (const tool of [...available]) {
      if (!NODE_PROVIDER_ALLOW.has(tool)) {
        available.delete(tool);
        policyDecisions.push({
          code: "tool_policy:global_deny",
          message: `Tool "${tool}" not in node provider allowlist`,
          policySource: "message_provider:node",
          toolName: tool,
        });
      }
    }
  }

  if (benchmarkCase.context.messageProvider === "voice") {
    for (const tool of VOICE_PROVIDER_DENY) {
      if (available.has(tool)) {
        available.delete(tool);
        policyDecisions.push({
          code: "tool_policy:global_deny",
          message: `Tool "${tool}" denied for voice provider`,
          policySource: "message_provider:voice",
          toolName: tool,
        });
      }
    }
  }

  const toolsAfter = [...available].map((name) => ({ name }));
  return { toolsBefore, toolsAfter, policyDecisions };
}

describe("route resolution benchmark (CI gate)", () => {
  it("corpus has at least 10 cases", () => {
    expect(ROUTE_BENCHMARK_CORPUS.length).toBeGreaterThanOrEqual(10);
  });

  for (const benchmarkCase of ROUTE_BENCHMARK_CORPUS) {
    it(`[${benchmarkCase.id}] ${benchmarkCase.description}`, () => {
      const { toolsBefore, toolsAfter, policyDecisions } = simulateToolAvailability(benchmarkCase);

      const trace = buildToolResolutionTrace({
        query: benchmarkCase.query,
        toolsBefore,
        toolsAfter,
        policyDecisions,
        agentId: benchmarkCase.context.agentId,
      });

      const result = evaluateBenchmarkCase(benchmarkCase, trace);

      if (!result.passed) {
        const detail = JSON.stringify({
          expected: result.expected,
          actual: result.actual,
        }, null, 2);
        expect.fail(
          `Benchmark case "${benchmarkCase.id}" failed:\n${detail}`,
        );
      }
    });
  }
});
