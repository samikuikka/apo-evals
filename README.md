# apo-evals

A realistic, externally-sourced test set for [apo](https://github.com/samikuikka/apo)
— public benchmark tasks converted to apo evaluations, runnable on cheap
models for pennies, with no judge-token spend.

Every task here is derived from a public benchmark and re-expressed in apo's
format: **the benchmark owns correctness** (its ground-truth answer, pinned to
a dataset revision), **apo owns the run** — typed deliverables, trajectory
checks, traces, and cross-model comparison in the dashboard.

## Why this exists as its own repo

- apo's repo stays clean of third-party-derived content; this repo carries the
  attribution and pinning obligations.
- Any apo project can use it directly as a **git task source**: set the
  project's task source to this repository's URL and the task tree is
  discovered automatically.
- The set is curated for apo's strengths (structured deliverables,
  deterministic checks) rather than mirroring a benchmark one-to-one.

## Sources

| Source | License | What it contributes |
|---|---|---|
| [DABstep](https://huggingface.co/datasets/adyen/DABstep) (Adyen + Hugging Face) | CC BY 4.0 | Realistic payments-data analysis; typed, deterministically-scored answers |

Details and revision pins in [NOTICE.md](NOTICE.md).

## Quickstart

```bash
pnpm i
pnpm fetch:data        # downloads the ~24 MB DABstep bundle (gitignored)
pnpm setup:python      # optional: local venv with pandas for the agent

export OPENROUTER_API_KEY=...   # any OpenRouter key
export OPENROUTER_MODEL=google/gemini-2.5-flash-lite   # or any cheap model

apo task run dabstep-005 --dir .
```

### Zero-cost mode (no model, no keys)

Every adapter supports fixture replay, the same seam as `APO_HARBOR_FIXTURE`:

```bash
DABSTEP_FIXTURE=fixtures/dabstep/dabstep-005.json apo task run dabstep-005 --dir .
```

The full pipeline — deliverable collection, checks, run recording — executes
against a frozen answer. Wrong-answer fixtures exist to verify the failure
path.

## Task index

| Task | Level | What it exercises |
|---|---|---|
| `dabstep-005` | easy | Grouped count over 139k-row CSV; exact string answer |
| `dabstep-049` | easy | Filtered count; multiple-choice formatted answer |
| `dabstep-1273` | hard | Fee computation from documentation (manual.md) + fees.json, 6-decimal numeric answer with tolerance |

## The conversion rule

When converting a benchmark task to apo, in priority order:

1. **Pin provenance.** Record the benchmark, task id, and dataset revision in
   `metadata`. Re-verify every converted task when the pin moves.
2. **Don't convert the verdict — convert the evidence.** The upstream
   ground-truth answer becomes a deterministic apo check (string-normalized
   equality, numeric with tolerance, per-element lists). No LLM judges on
   answers the benchmark already scores deterministically.
3. **Structurize.** The agent's output becomes a typed deliverable
   (`answer.value`), and the trajectory (did it run code? did it read the
   manual?) becomes deliverable-backed checks that work in both live and
   fixture modes.
4. **Apo adds what the leaderboard can't.** Cross-model comparison on the same
   task, traces of where each model's attempt broke, partial signal (submitted
   vs. not, computed vs. guessed).

## Repo layout

```
adapters/    one adapter per benchmark family (owns the agent + deliverables)
lib/         subprocess/exec helpers
tasks/       <source>/<task-id>/<task-id>.eval.ts + files/question.md
fixtures/    canned runs for zero-cost replay (pass and fail variants)
scripts/     data fetch + python setup
data/        fetched benchmark data (gitignored, pinned by revision)
```

## Adding a source

Copy the DABstep pattern: an adapter in `adapters/`, tasks under
`tasks/<source>/<task-id>/`, a fetch script pinning a revision, and a NOTICE.md
entry with license and attribution. Validate with a fixture before running
live.
