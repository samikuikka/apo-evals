/**
 * dabstep-1273 — DABstep dev task #1273 (hard), converted to apo.
 *
 * Upstream question: "For credit transactions, what would be the average fee
 * that the card scheme GlobalCard would charge for a transaction value of
 * 10 EUR?" — this is where DABstep's Hard tier earns its name: the fee rules
 * live in manual.md, the fee structures in fees.json, and the agent must read
 * documentation, join it with the data, and compute to six decimals.
 *
 * The check mirrors DABstep's numeric scorer: tolerance-based comparison
 * rather than string equality. Trajectory requires reading manual.md — an
 * agent that skips the documentation layer is the classic Hard-tier failure.
 */
import { task, equals, satisfies } from "@apo-ai/sdk/agent-task";
import { dabstepAdapter } from "../../../adapters/dabstep-adapter.ts";

const { test: check } = task("dabstep-1273", {
  adapter: dabstepAdapter,
  maxTurns: 2,
  description:
    "DABstep #1273 (hard): average GlobalCard fee for a 10 EUR credit transaction. Requires manual.md fee rules + fees.json structures, computed to 6 decimals.",
  deliverables: ["answer", "tool_log", "stats"],
  metadata: {
    benchmark: "dabstep",
    benchmark_task: "DABstep dev split, task_id 1273",
    benchmark_task_revision: "f6980beb8908f6dbb5056924f020fa49a0bf946b",
    level: "hard",
    executor: "apo-agent",
  },
});

const EXPECTED_FEE = 0.120132; // upstream ground truth, EUR
const TOLERANCE = 1e-4;

const parseNumber = (s: string): number => Number(s.replace(/[^0-9.eE+-]/g, ""));

// ── Layer 1: trajectory — Hard tasks are lost in the docs, not the code ────
check("dabstep-1273-computed-via-python", (t, { deliverables }) => {
  t.check(
    deliverables.stats.python_runs,
    satisfies((n: number) => n >= 1, "ran Python at least once before answering"),
  );
});

check("dabstep-1273-read-the-fee-manual", (t, { deliverables }) => {
  t.check(
    deliverables.tool_log.some(
      (e) => e.tool === "read_file" && String(e.input.path ?? "").includes("manual"),
    ),
    satisfies((v: boolean) => v, "read manual.md before answering a fee question"),
  );
});

check("dabstep-1273-answer-submitted", (t, { deliverables }) => {
  t.check(deliverables.answer.submitted, equals(true), "agent called submit_answer");
});

// ── Layer 2: upstream correctness — numeric with tolerance ────────────────
check("dabstep-1273-upstream-answer", (t, { deliverables }) => {
  t.check(
    deliverables.answer.value,
    satisfies(
      (v: string) => {
        const n = parseNumber(v);
        return Number.isFinite(n) && Math.abs(n - EXPECTED_FEE) <= TOLERANCE;
      },
      `average fee equals ${EXPECTED_FEE} EUR within ${TOLERANCE} (6-decimal ground truth)`,
    ),
  );
});
