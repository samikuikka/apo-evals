/**
 * dabstep adapter — runs an apo-owned analysis agent over a DABstep task.
 *
 * Division of truth (the rule for every conversion in this repo):
 * the benchmark owns correctness — the ground-truth answer ships with the
 * pinned dataset revision, and the task's checks assert against it
 * deterministically. Apo owns everything around it: the typed answer
 * deliverable, the trajectory log, the trace, and cross-model comparison.
 *
 * The agent is a plain Vercel AI SDK tool loop:
 *   read_file   — inspect docs and small reference files
 *   run_python  — compute over the data bundle (this is where the work happens)
 *   submit_answer — terminal action; its argument becomes the answer deliverable
 *
 * Model selection follows apo's rule: the adapter never hardcodes a provider
 * account — it reads OPENROUTER_API_KEY / OPENROUTER_MODEL from the caller's
 * environment and reports the resolved model as the run configuration.
 *
 * Fixture mode: set DABSTEP_FIXTURE=<path to fixtures/dabstep/*.json> to
 * replay a canned run instead of calling a model. The full apo pipeline —
 * initialize → turn → session → deliverables → checks — executes for real
 * against a frozen answer. No network, no provider credentials. Same seam as
 * APO_HARBOR_FIXTURE in the apo example tree.
 */
import { defineAdapter, registerApoTracing } from "@apo-ai/sdk/agent-task";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { resolvePythonBin, runPython } from "../lib/python.ts";

await registerApoTracing();

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
const MAX_STEPS = 40;

/** One line per context file so the agent knows what exists without guessing. */
const CONTEXT_FILES = [
  "payments.csv — ~139k transactions; columns documented in payments-readme.md",
  "payments-readme.md — column documentation for payments.csv",
  "fees.json — card-scheme fee structures keyed by fee id",
  "merchant_data.json — merchant account metadata",
  "merchant_category_codes.csv — MCC code → description",
  "acquirer_countries.csv — acquirer → country",
  "manual.md — payment concepts: MCC, ACI, fee-calculation rules. Read before fee questions.",
] as const;

const SYSTEM_PROMPT = [
  "You are a careful payments-data analyst. You work in a directory containing:",
  ...CONTEXT_FILES.map((line) => `  - ${line}`),
  "",
  "Rules:",
  "1. Never answer from memory or estimation. Every number and lookup must come",
  "   from code you executed via run_python.",
  "2. Never read_file the large CSV (payments.csv) — compute over it with",
  "   run_python instead. read_file is for the docs and small reference files.",
  "3. For fee questions, read manual.md first: the fee rules are documented there.",
  "4. When you have verified the answer, call submit_answer with the answer",
  "   string formatted exactly as the task guidelines specify. That call is your",
  "   final action.",
].join("\n");

type ToolLogEntry = { tool: string; input: Record<string, unknown> };

type DabstepState = {
  model: string;
  fixture: boolean;
  toolLog: ToolLogEntry[];
  pythonRuns: number;
  submittedAnswer: { submitted: true; value: string } | { submitted: false; value: "" };
  startedAt: number;
};

type FixtureFile = {
  answer: { submitted: boolean; value: string };
  tool_log: ToolLogEntry[];
  stats: { model: string; tool_calls: number; python_runs: number; duration_ms: number };
};

const EMPTY_STATE: DabstepState = {
  model: DEFAULT_MODEL,
  fixture: false,
  toolLog: [],
  pythonRuns: 0,
  submittedAnswer: { submitted: false, value: "" },
  startedAt: 0,
};

/** tasks/dabstep/<task>/ → repo root (three levels up). Env override wins. */
function resolveContextDir(taskDir: string): string {
  if (process.env.DABSTEP_DATA_DIR) return join(process.env.DABSTEP_DATA_DIR, "context");
  return resolve(taskDir, "../../..", "data", "dabstep", "context");
}

async function loadFixture(path: string): Promise<FixtureFile> {
  return JSON.parse(await readFile(path, "utf8")) as FixtureFile;
}

export const dabstepAdapter = defineAdapter({
  name: "dabstep",
  deliverables: {
    answer: z.object({
      submitted: z.boolean(),
      value: z.string(),
    }),
    tool_log: z.array(
      z.object({
        tool: z.string(),
        input: z.record(z.string(), z.unknown()),
      }),
    ),
    stats: z.object({
      model: z.string(),
      tool_calls: z.number(),
      python_runs: z.number(),
      duration_ms: z.number(),
      fixture: z.boolean(),
    }),
  },

  turn: async ({ files }) => {
    if (files.length === 0) return null;
    try { return await files.read("question.md"); } catch { return null; }
  },

  async initialize(ctx) {
    const contextDir = resolveContextDir(ctx.taskDir);
    if (!process.env.DABSTEP_FIXTURE && !existsSync(join(contextDir, "payments.csv"))) {
      throw new Error(
        `DABstep data bundle not found at ${contextDir}. Run \`pnpm fetch:data\` first ` +
          "(see README), or set DABSTEP_DATA_DIR.",
      );
    }
    return {
      ...EMPTY_STATE,
      model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
      startedAt: Date.now(),
    };
  },

  async startSession(ctx) {
    const state = (ctx.state ?? EMPTY_STATE) as DabstepState;
    const contextDir = resolveContextDir(ctx.taskDir);
    const pythonBin = resolvePythonBin(resolve(contextDir, "..", "..", ".."));

    const runAgent = async (question: string) => {
      const openai = createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      });

      const submitAnswer = tool({
        description: "Submit your final answer. Format the value exactly as the task guidelines specify.",
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }: { value: string }) => {
          state.submittedAnswer = { submitted: true, value };
          return { received: true };
        },
      });

      const tools = {
        read_file: tool({
          description:
            "Read a file from the data directory. For docs and small reference files only — never for payments.csv.",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }: { path: string }) => {
            state.toolLog.push({ tool: "read_file", input: { path } });
            const content = await readFile(join(contextDir, path), "utf8").catch(
              () => null,
            );
            return content === null
              ? { error: `file not found: ${path}` }
              : { content: content.slice(0, 50_000) };
          },
        }),
        run_python: tool({
          description:
            "Execute Python code in the data directory. Returns stdout and stderr. Use this for all computation over the CSV/JSON files.",
          inputSchema: z.object({ code: z.string() }),
          execute: async ({ code }: { code: string }) => {
            state.toolLog.push({ tool: "run_python", input: { code } });
            state.pythonRuns++;
            return runPython(code, contextDir, pythonBin);
          },
        }),
        submit_answer: submitAnswer,
      };

      const result = await generateText({
        model: openai(state.model),
        system: SYSTEM_PROMPT,
        prompt: question,
        tools,
        stopWhen: [hasToolCall(submitAnswer), stepCountIs(MAX_STEPS)],
        experimental_telemetry: { enabled: true },
      });
      return result.text;
    };

    return {
      runConfiguration: { model: state.model },

      async sendUserTurn(turn: unknown) {
        const question = typeof turn === "string" ? turn : String(turn);

        if (process.env.DABSTEP_FIXTURE) {
          const fixture = await loadFixture(process.env.DABSTEP_FIXTURE);
          state.fixture = true;
          state.model = fixture.stats.model;
          state.toolLog = fixture.tool_log;
          state.pythonRuns = fixture.stats.python_runs;
          state.submittedAnswer = fixture.answer.submitted
            ? { submitted: true, value: fixture.answer.value }
            : { submitted: false, value: "" };
          return { response: `[fixture replay] ${process.env.DABSTEP_FIXTURE}` };
        }

        return { response: await runAgent(question) };
      },
    };
  },

  async collectDeliverables(ctx) {
    const state = (ctx.state ?? EMPTY_STATE) as DabstepState;
    return {
      answer: state.submittedAnswer,
      tool_log: state.toolLog,
      stats: {
        model: state.model,
        tool_calls: state.toolLog.length,
        python_runs: state.pythonRuns,
        duration_ms: Date.now() - state.startedAt,
        fixture: state.fixture,
      },
    };
  },
});
