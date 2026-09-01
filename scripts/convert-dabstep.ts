/**
 * convert-dabstep — the dynamic per-test-case conversion workflow.
 *
 * Every DABstep task in tasks/dabstep/ is GENERATED from the pinned dev
 * split (data/dabstep/tasks/dev.jsonl) by this script. The script reads a
 * case, classifies its answer shape, and emits the full task:
 *
 *   tasks/dabstep/dabstep-<id>/dabstep-<id>.eval.ts   apo task + checks
 *   tasks/dabstep/dabstep-<id>/files/question.md       the agent's prompt
 *   fixtures/dabstep/dabstep-<id>.json                 pass fixture
 *   fixtures/dabstep/dabstep-<id>-wrong.json           fail fixture
 *
 * The ground-truth answer is pinned into the generated eval at conversion
 * time (with the dataset revision in metadata), so fixture replay stays
 * zero-setup. Generation time invariants: the ported DABstep scorer
 * (lib/dabstep.ts) must accept the ground truth and reject the wrong
 * fixture's answer — the pass and fail paths are proven before anything is
 * written.
 *
 * Usage:
 *   node scripts/convert-dabstep.ts --all          convert every dev case
 *   node scripts/convert-dabstep.ts 70 1273        convert specific cases
 *   node scripts/convert-dabstep.ts --check        verify generated == disk
 *
 * `--check` is the re-verification half of the pin-move workflow in
 * AGENTS.md: bump DABSTEP_REV in scripts/fetch-data.sh, re-fetch, run
 * --check to see exactly which cases moved, regenerate, re-verify fixtures.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyAnswer,
  dabstepAnswer,
  loadDevCases,
  questionScorer,
  type AnswerShape,
  type DabstepCase,
} from "../lib/dabstep.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The dataset pin, read from scripts/fetch-data.sh — that script is the
 * single source of truth for the revision. Moving the pin is: bump it there,
 * re-fetch, `pnpm convert:dabstep -- --check` to see which cases moved,
 * regenerate, `pnpm verify:fixtures`.
 */
async function loadDabstepRev(): Promise<string> {
  const fetchScript = await readFile(join(REPO_ROOT, "scripts", "fetch-data.sh"), "utf8");
  const match = fetchScript.match(/^DABSTEP_REV="([0-9a-f]{40})"$/m);
  if (!match) {
    throw new Error("could not read DABSTEP_REV from scripts/fetch-data.sh");
  }
  return match[1];
}

const DABSTEP_REV = await loadDabstepRev();

const DEV_JSONL =
  process.env.DABSTEP_DATA_DIR
    ? join(process.env.DABSTEP_DATA_DIR, "tasks", "dev.jsonl")
    : join(REPO_ROOT, "data", "dabstep", "tasks", "dev.jsonl");

const TASKS_DIR = join(REPO_ROOT, "tasks", "dabstep");
const FIXTURES_DIR = join(REPO_ROOT, "fixtures", "dabstep");

// ── Per-case conversion knowledge the dataset does not carry ──────────────

type CaseConfig = {
  /** "Data:" paragraph of question.md — what the agent should know exists. */
  dataHint: string;
  /** True when the question's rules exist only in manual.md. */
  requireManual: boolean;
  /** Realistic wrong answer for the fail fixture (derived when absent). */
  wrongAnswer?: string;
  /** Realistic computation for the fixture's run_python call (per-shape default when absent). */
  fixtureCode?: string;
};

const DATA_HINT_CSV =
  "the files in your working directory (payments.csv and its README). " +
  "Compute the answer with code; do not guess.";
const DATA_HINT_FEES =
  "the files in your working directory. The fee calculation rules are " +
  "documented in manual.md — read them first — and the fee structures are " +
  "in fees.json. Compute the answer with code; do not guess.";
const DATA_HINT_FEE_IDS =
  "the files in your working directory. The fee structures (fee_id, " +
  "account_type, aci, and validity dates) are in fees.json; fee and ACI " +
  "concepts are documented in manual.md. Compute the answer with code; do " +
  "not guess.";

const CASE_CONFIG: Record<string, CaseConfig> = {
  "5": { dataHint: DATA_HINT_CSV, requireManual: false, wrongAnswer: "BE" },
  "49": { dataHint: DATA_HINT_CSV, requireManual: false },
  "70": {
    dataHint:
      "the files in your working directory. The high-fraud-rate fine " +
      "thresholds are documented in manual.md — read it first — and the " +
      "merchant account metadata is in merchant_data.json. Compute the " +
      "answer with code; do not guess.",
    requireManual: true,
    wrongAnswer: "Yes",
  },
  "1273": { dataHint: DATA_HINT_FEES, requireManual: true },
  "1305": { dataHint: DATA_HINT_FEES, requireManual: true },
  "1464": { dataHint: DATA_HINT_FEE_IDS, requireManual: false },
  "1681": { dataHint: DATA_HINT_FEE_IDS, requireManual: false },
  "1753": { dataHint: DATA_HINT_FEE_IDS, requireManual: false },
  "1871": {
    dataHint:
      "the files in your working directory. The fee calculation rules — " +
      "including relative fees — are documented in manual.md — read them " +
      "first — and the fee structures are in fees.json. Compute the answer " +
      "with code; do not guess.",
    requireManual: true,
  },
  "2697": {
    dataHint:
      "the files in your working directory. The Authorization " +
      "Characteristics Indicator (ACI) values and fee rules are documented " +
      "in manual.md — read it first — and the fee structures are in " +
      "fees.json. Compute the answer with code; do not guess.",
    requireManual: true,
    wrongAnswer: "D:9.12",
  },
};

// ── Answer-shape helpers ──────────────────────────────────────────────────

/** Realistic wrong answer for the fail fixture, derived from the shape. */
function deriveWrongAnswer(c: DabstepCase, config: CaseConfig): string {
  if (config.wrongAnswer) return config.wrongAnswer;
  switch (classifyAnswer(c.answer)) {
    case "numeric": {
      const decimals = c.answer.includes(".")
        ? c.answer.trim().split(".")[1].length
        : 0;
      // ~1% off: plausible-looking, comfortably outside the 1e-4 tolerance.
      return (Number.parseFloat(c.answer) * 1.01).toFixed(Math.max(decimals, 2));
    }
    case "list": {
      const items = c.answer.split(",").map((s) => s.trim()).filter(Boolean);
      if (items.length <= 1) throw new Error(`case ${c.task_id}: cannot derive wrong list answer`);
      return items.slice(0, -1).join(", "); // the classic failure: one fee ID missed
    }
    case "choice": {
      // Pick the first offered option that is not the correct one.
      const options = [...c.question.matchAll(/([A-E])\.\s*([A-Za-z]{2,})/g)].map(
        (m) => ({ letter: m[1], value: m[2] }),
      );
      const correct = c.answer.trim().split(/[.\s]/)[0];
      const wrong = options.find((o) => o.letter !== correct);
      if (!wrong) throw new Error(`case ${c.task_id}: cannot derive wrong choice answer`);
      return `${wrong.letter}. ${wrong.value}`;
    }
    case "not-applicable":
      return "Yes";
    default:
      throw new Error(`case ${c.task_id}: no wrong-answer derivation for shape string — set wrongAnswer`);
  }
}

const FIXTURE_CODE_BY_SHAPE: Record<AnswerShape, string> = {
  string:
    "import csv\nfrom collections import Counter\nc = Counter(r['issuing_country'] for r in csv.DictReader(open('payments.csv')))\nprint(c.most_common(1)[0][0])",
  choice:
    "import csv\nfrom collections import Counter\nfraud = [r for r in csv.DictReader(open('payments.csv')) if r['is_fraud'] == '1']\nprint(Counter(r['ip_country'] for r in fraud).most_common(1))",
  numeric:
    "import json\nfees = json.load(open('fees.json'))\n# average fee per the manual.md rules for the requested segment\nprint(round(total / count, 6))",
  list: "import json\nfees = json.load(open('fees.json'))\n# fee ids applicable to the requested merchant/date window\nprint(', '.join(str(fee_id) for fee_id in ids))",
  "not-applicable":
    "import json\nmerchant = json.load(open('merchant_data.json'))['Martinis_Fine_Steakhouse']\n# fraud rate vs the manual.md high-fraud-rate fine threshold\nprint('Not Applicable')",
};

// ── Generation ────────────────────────────────────────────────────────────

/** Greedy word wrap, matching the width used by the hand-written originals. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Wrap paragraphs to comment width; empty strings pass through as separators. */
function wrapBlock(paragraphs: string[]): string[] {
  return paragraphs.flatMap((p) => (p === "" ? [""] : wrap(p, 77)));
}

function padTaskId(upstreamId: string): string {
  return `dabstep-${upstreamId.padStart(3, "0")}`;
}

function questionMarkdown(c: DabstepCase, config: CaseConfig): string {
  const guidelines = /[.!?]$/.test(c.guidelines.trim()) ? c.guidelines.trim() : `${c.guidelines.trim()}.`;
  const lines = [
    `# Task: DABstep #${c.task_id} (${c.level})`,
    "",
    ...wrap(c.question, 78),
    "",
    ...wrap(`Guidelines: ${guidelines}`, 78),
    "",
    ...wrap(`Data: ${config.dataHint}`, 78),
    "",
  ];
  return lines.join("\n");
}

/** String literal(s) for the pinned ground truth. Lists become item arrays. */
function expectedLiteral(answer: string, shape: AnswerShape): string {
  const suffix =
    shape === "list"
      ? ` // ground truth from the pinned dev split (${answer.split(",").length} values)`
      : " // ground truth from the pinned dev split";
  if (shape === "list") {
    const items = answer.split(",").map((item) => item.trim());
    const rows: string[][] = [];
    let row: string[] = [];
    for (const item of items) {
      if (row && [...row, item].join(", ").length + 8 > 78) {
        rows.push(row);
        row = [];
      }
      row.push(item);
    }
    if (row) rows.push(row);
    const body = rows.map((r) => `  ${r.map((i) => JSON.stringify(i)).join(", ")},`).join("\n");
    return `[\n${body}\n].join(", ");${suffix}`;
  }
  if (answer.length <= 88) return `${JSON.stringify(answer)};${suffix}`;
  const chunks: string[] = [];
  for (let i = 0; i < answer.length; i += 76) {
    chunks.push(JSON.stringify(answer.slice(i, i + 76)));
  }
  return `(\n  ${chunks.join(" +\n  ")},\n);${suffix}`;
}

function evalSource(c: DabstepCase, config: CaseConfig): string {
  const taskId = padTaskId(c.task_id);
  const shape = classifyAnswer(c.answer);
  const shownAnswer =
    c.answer.length > 60 ? `${c.answer.slice(0, 57)}… (${c.answer.split(",").length} values)` : c.answer;
  const workflowNote = config.requireManual
    ? "compute via Python, read manual.md, and submit"
    : "compute via Python and submit";

  const header = wrapBlock([
    `${taskId} — DABstep dev task #${c.task_id} (${c.level}), converted to apo.`,
    "",
    `Upstream question: "${c.question}"`,
    `Upstream ground truth: ${shownAnswer}`,
    "",
    `GENERATED by scripts/convert-dabstep.ts from data/dabstep/tasks/dev.jsonl @ ${DABSTEP_REV} — regenerate, do not hand-edit.`,
    "",
    `Correctness is graded by the ported DABstep scorer (lib/dabstep.ts): for this answer shape, ${shapeNote(shape)}. The other checks ask the agent to ${workflowNote}.`,
  ])
    .map((line) => ` * ${line}`.trimEnd())
    .join("\n");

  const manualCheck = [
    `check("read-the-manual", (t, { deliverables }) => {`,
    `  t.check(`,
    `    deliverables.tool_log.some(`,
    `      (e) => e.tool === "read_file" && String(e.input.path ?? "").includes("manual"),`,
    `    ),`,
    `    equals(true),`,
    `    "read manual.md before answering a documentation-backed question",`,
    `  );`,
    `});`,
    ``,
  ];

  const body = [
    `import { equals, satisfies, task } from "@apo-ai/sdk/agent-task";`,
    `import { dabstepAdapter } from "../../../adapters/dabstep-adapter.ts";`,
    `import { dabstepAnswer } from "../../../lib/dabstep.ts";`,
    ``,
    `const EXPECTED_ANSWER = ${expectedLiteral(c.answer, shape)}`,
    ``,
    `const { test: check } = task(${JSON.stringify(taskId)}, {`,
    `  adapter: dabstepAdapter,`,
    `  maxTurns: 2,`,
    `  description: ${JSON.stringify(`DABstep #${c.task_id} (${c.level}): ${c.question}`)},`,
    `  deliverables: ["answer", "tool_log", "stats"],`,
    `  metadata: {`,
    `    benchmark: "dabstep",`,
    `    benchmark_task: ${JSON.stringify(`DABstep dev split, task_id ${c.task_id}`)},`,
    `    benchmark_task_revision: ${JSON.stringify(DABSTEP_REV)},`,
    `    level: ${JSON.stringify(c.level)},`,
    `    executor: "apo-agent",`,
    `  },`,
    `});`,
    ``,
    `check("computed-via-python", (t, { deliverables }) => {`,
    `  t.check(`,
    `    deliverables.stats.python_runs,`,
    `    satisfies((n: number) => n >= 1, "ran Python at least once before answering"),`,
    `  );`,
    `  t.check(`,
    `    deliverables.stats.tool_calls,`,
    `    satisfies((n: number) => n >= 2 && n <= 80, "made a reasonable number of tool calls (2–80)"),`,
    `  );`,
    `});`,
    ``,
    ...(config.requireManual ? manualCheck : []),
    `check("answer-submitted", (t, { deliverables }) => {`,
    `  t.check(deliverables.answer.submitted, equals(true), "agent called submit_answer");`,
    `});`,
    ``,
    `check("answer-matches-benchmark", (t, { deliverables }) => {`,
    `  t.check(deliverables.answer.value, dabstepAnswer(EXPECTED_ANSWER));`,
    `});`,
    ``,
  ];

  return `/**\n${header}\n */\n${body.join("\n")}`;
}

function shapeNote(shape: AnswerShape): string {
  switch (shape) {
    case "numeric":
      return "numeric comparison with the benchmark's tolerance (rel/abs 1e-4), sign-sensitive";
    case "list":
      return "an order-insensitive list comparison, each item re-scored by the same scorer";
    case "choice":
      return "normalized string comparison, including the benchmark's option-letter leniency";
    case "not-applicable":
      return "normalized string comparison";
    default:
      return "normalized string comparison";
  }
}

type FixtureFile = {
  answer: { submitted: boolean; value: string };
  tool_log: { tool: string; input: Record<string, unknown> }[];
  stats: { model: string; tool_calls: number; python_runs: number; duration_ms: number };
};

function buildFixture(c: DabstepCase, config: CaseConfig, answerValue: string): FixtureFile {
  const code = config.fixtureCode ?? FIXTURE_CODE_BY_SHAPE[classifyAnswer(c.answer)];
  const tool_log: FixtureFile["tool_log"] = [];
  if (config.requireManual) tool_log.push({ tool: "read_file", input: { path: "manual.md" } });
  tool_log.push({ tool: "run_python", input: { code } });
  tool_log.push({ tool: "submit_answer", input: { value: answerValue } });
  return {
    answer: { submitted: true, value: answerValue },
    tool_log,
    stats: { model: "fixture", tool_calls: tool_log.length, python_runs: 1, duration_ms: 1500 },
  };
}

// ── Invariants: prove the pass/fail paths before writing anything ─────────

function goldenScorerAsserts(): void {
  const cases: [string, string, boolean][] = [
    // string normalization
    ["nl", "NL", true],
    [" NL ", "NL", true],
    ["Netherlands", "NL", false],
    // choice: option-letter leniency comes from the single-word subset rule
    ["B. BE", "b. be", true],
    ["BE", "B. BE", true],
    ["A. NL", "B. BE", false],
    // not-applicable
    ["not applicable", "Not Applicable", true],
    ["Yes", "Not Applicable", false],
    // numeric tolerance (both < 1 → rel/abs 1e-4)
    ["0.1201", "0.120132", true],
    ["0.1202", "0.120132", true],
    ["0.12", "0.120132", false], // 1.3e-4 off, just outside tolerance
    ["0.11", "0.120132", false],
    // ≥1 numbers: shared-rounding then isclose
    ["13.6", "13.57", true],
    ["14.1", "13.57", false],
    // sign sensitivity — deliberate deviation from upstream
    ["-0.9481030", "-0.94810300000017", true],
    ["0.94810300000017", "-0.94810300000017", false],
    // lists: order-insensitive, per-item rescoring, comma/semicolon split
    ["741, 709", "709, 741", true],
    ["741; 709", "709, 741", true],
    ["741, 709", "709, 741, 454", false],
    ["741, 708", "709, 741", false],
    // special format {card_scheme}:{fee} — mirrored upstream laxity: the
    // numeric branch extracts 13.57 from both sides, so a wrong scheme with
    // the same fee scores correct exactly as it would on the leaderboard.
    ["E:13.57", "e: 13.57", true],
    ["D:13.57", "E:13.57", true],
    ["D:9.12", "E:13.57", false],
  ];
  for (const [given, expected, want] of cases) {
    const got = questionScorer(given, expected);
    if (got !== want) {
      throw new Error(
        `scorer golden failed: questionScorer(${JSON.stringify(given)}, ${JSON.stringify(expected)}) = ${got}, want ${want}`,
      );
    }
  }
}

function caseAsserts(c: DabstepCase, config: CaseConfig): void {
  if (!questionScorer(c.answer, c.answer)) {
    throw new Error(`case ${c.task_id}: scorer rejects its own ground truth`);
  }
  const wrong = deriveWrongAnswer(c, config);
  if (questionScorer(wrong, c.answer)) {
    throw new Error(
      `case ${c.task_id}: derived wrong answer ${JSON.stringify(wrong)} scores as correct — pick a different wrongAnswer`,
    );
  }
  if (classifyAnswer(c.answer) === "string" && !config.wrongAnswer) {
    throw new Error(`case ${c.task_id}: string-shape answers need an explicit wrongAnswer override`);
  }
}

// ── File emission ─────────────────────────────────────────────────────────

type GeneratedFiles = { eval: string; question: string; pass: string; wrong: string };

function generate(c: DabstepCase): { taskId: string; files: GeneratedFiles } {
  const config = CASE_CONFIG[c.task_id];
  if (!config) throw new Error(`case ${c.task_id}: no CASE_CONFIG entry`);
  caseAsserts(c, config);
  return {
    taskId: padTaskId(c.task_id),
    files: {
      eval: evalSource(c, config),
      question: questionMarkdown(c, config),
      pass: `${JSON.stringify(buildFixture(c, config, c.answer), null, 2)}\n`,
      wrong: `${JSON.stringify(buildFixture(c, config, deriveWrongAnswer(c, config)), null, 2)}\n`,
    },
  };
}

async function writeTask(generated: { taskId: string; files: GeneratedFiles }): Promise<string[]> {
  const taskDir = join(TASKS_DIR, generated.taskId);
  const targets: [string, string][] = [
    [join(taskDir, `${generated.taskId}.eval.ts`), generated.files.eval],
    [join(taskDir, "files", "question.md"), generated.files.question],
    [join(FIXTURES_DIR, `${generated.taskId}.json`), generated.files.pass],
    [join(FIXTURES_DIR, `${generated.taskId}-wrong.json`), generated.files.wrong],
  ];
  const written: string[] = [];
  for (const [path, content] of targets) {
    const current = existsSync(path) ? await readFile(path, "utf8") : undefined;
    if (current !== content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      written.push(path);
    }
  }
  return written;
}

// ── CLI ───────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  // pnpm hands script flags through with a literal "--"; drop it, and let a
  // bare --check (the documented pin-move gate) cover every case.
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const checkOnly = args.includes("--check");
  const all = args.includes("--all");
  const ids = args.filter((a) => !a.startsWith("--"));

  if (!checkOnly && !all && ids.length === 0) {
    console.error("usage: node scripts/convert-dabstep.ts [--check] [--all | <task_id>...]");
    return 1;
  }

  goldenScorerAsserts();

  const cases = await loadDevCases(DEV_JSONL);
  const selected = all || (checkOnly && ids.length === 0) ? cases : cases.filter((c) => ids.includes(c.task_id));
  const missing = ids.filter((id) => !cases.some((c) => c.task_id === id));
  for (const id of missing) {
    console.error(`no dev case with task_id ${id} in ${DEV_JSONL}`);
  }
  if (selected.length === 0) {
    console.error("nothing to convert");
    return 1;
  }

  let drift = false;
  for (const c of selected) {
    const generated = generate(c);
    if (checkOnly) {
      const taskDir = join(TASKS_DIR, generated.taskId);
      const targets: [string, string][] = [
        [join(taskDir, `${generated.taskId}.eval.ts`), generated.files.eval],
        [join(taskDir, "files", "question.md"), generated.files.question],
        [join(FIXTURES_DIR, `${generated.taskId}.json`), generated.files.pass],
        [join(FIXTURES_DIR, `${generated.taskId}-wrong.json`), generated.files.wrong],
      ];
      for (const [path, content] of targets) {
        const current = existsSync(path) ? await readFile(path, "utf8") : undefined;
        if (current !== content) {
          drift = true;
          console.error(`DRIFT ${path}`);
        }
      }
      console.log(`ok ${generated.taskId} (upstream #${c.task_id}, ${classifyAnswer(c.answer)})`);
    } else {
      const written = await writeTask(generated);
      for (const path of written) console.log(`wrote ${path}`);
      console.log(`ok ${generated.taskId} (upstream #${c.task_id}, ${classifyAnswer(c.answer)})`);
    }
  }

  if (checkOnly) {
    console.log(
      drift
        ? "--check found drift: regenerate with `pnpm convert:dabstep -- --all`"
        : "--check clean: generated tasks match the pinned dev split",
    );
    return drift ? 1 : 0;
  }
  return 0;
}

process.exitCode = await main();
