/**
 * dabstep-005 — DABstep dev task #5 (easy), converted to apo.
 *
 * Upstream question: "Which issuing country has the highest number of
 * transactions?" — a single grouped count over payments.csv. The ground truth
 * ("NL") ships with the pinned dataset revision (see NOTICE.md); the check
 * below asserts it deterministically, mirroring DABstep's own string scorer
 * (case-insensitive, whitespace-normalized).
 *
 * apo adds the layers the benchmark leaderboard cannot show: the answer is a
 * typed deliverable, the trajectory is logged (did the agent actually run
 * code?), and runs are comparable across models in the dashboard.
 */
import { task, equals, satisfies } from "@apo-ai/sdk/agent-task";
import { dabstepAdapter } from "../../../adapters/dabstep-adapter.ts";

const { test: check } = task("dabstep-005", {
  adapter: dabstepAdapter,
  maxTurns: 2,
  description:
    "DABstep #5 (easy): which issuing country has the highest number of transactions? Grouped count over payments.csv.",
  deliverables: ["answer", "tool_log", "stats"],
  metadata: {
    benchmark: "dabstep",
    benchmark_task: "DABstep dev split, task_id 5",
    benchmark_task_revision: "f6980beb8908f6dbb5056924f020fa49a0bf946b",
    level: "easy",
    executor: "apo-agent",
  },
});

const EXPECTED_ANSWER = "NL";
const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

// ── Layer 1: trajectory — did the agent compute, or answer from memory? ────
check("dabstep-005-computed-via-python", (t, { deliverables }) => {
  t.check(
    deliverables.stats.python_runs,
    satisfies((n: number) => n >= 1, "ran Python at least once before answering"),
  );
  t.check(
    deliverables.stats.tool_calls,
    satisfies((n: number) => n >= 2 && n <= 80, "made a reasonable number of tool calls (2–80)"),
  );
});

check("dabstep-005-answer-submitted", (t, { deliverables }) => {
  t.check(deliverables.answer.submitted, equals(true), "agent called submit_answer");
});

// ── Layer 2: the benchmark's own correctness — deterministic, no judge ─────
check("dabstep-005-upstream-answer", (t, { deliverables }) => {
  t.check(
    normalize(deliverables.answer.value),
    equals(EXPECTED_ANSWER),
    "matches DABstep ground truth (normalized country code)",
  );
});
