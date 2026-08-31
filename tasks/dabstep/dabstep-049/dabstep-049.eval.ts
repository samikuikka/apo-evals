/**
 * dabstep-049 — DABstep dev task #49 (easy), converted to apo.
 *
 * Upstream question: "What is the top country (ip_country) for fraud?
 * A. NL, B. BE, C. ES, D. FR" — a filtered grouped count over payments.csv,
 * answered in the benchmark's multiple-choice format ("B. BE").
 *
 * The ground truth ships with the pinned dataset revision (NOTICE.md); the
 * check normalizes whitespace/case and compares exactly, mirroring DABstep's
 * string scorer.
 */
import { task, equals, satisfies } from "@apo-ai/sdk/agent-task";
import { dabstepAdapter } from "../../../adapters/dabstep-adapter.ts";

const { test: check } = task("dabstep-049", {
  adapter: dabstepAdapter,
  maxTurns: 2,
  description:
    "DABstep #49 (easy): top ip_country for fraud, answered as a multiple-choice option. Filtered grouped count over payments.csv.",
  deliverables: ["answer", "tool_log", "stats"],
  metadata: {
    benchmark: "dabstep",
    benchmark_task: "DABstep dev split, task_id 49",
    benchmark_task_revision: "f6980beb8908f6dbb5056924f020fa49a0bf946b",
    level: "easy",
    executor: "apo-agent",
  },
});

const EXPECTED_ANSWER = "B. BE";
const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

// ── Layer 1: trajectory ───────────────────────────────────────────────────
check("dabstep-049-computed-via-python", (t, { deliverables }) => {
  t.check(
    deliverables.stats.python_runs,
    satisfies((n: number) => n >= 1, "ran Python at least once before answering"),
  );
  t.check(
    deliverables.stats.tool_calls,
    satisfies((n: number) => n >= 2 && n <= 80, "made a reasonable number of tool calls (2–80)"),
  );
});

check("dabstep-049-answer-submitted", (t, { deliverables }) => {
  t.check(deliverables.answer.submitted, equals(true), "agent called submit_answer");
});

// ── Layer 2: upstream correctness ─────────────────────────────────────────
check("dabstep-049-upstream-answer", (t, { deliverables }) => {
  t.check(
    normalize(deliverables.answer.value),
    equals(EXPECTED_ANSWER),
    "matches DABstep ground truth ('B. BE')",
  );
});
