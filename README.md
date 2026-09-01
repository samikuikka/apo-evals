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
export OPENROUTER_MODEL=z-ai/glm-5.3-flash   # cheap flash-tier models only — never frontier

apo task run dabstep-005 --dir .
```

### Zero-cost mode (no model, no keys)

Every adapter supports fixture replay, the same seam as `APO_HARBOR_FIXTURE`:

```bash
DABSTEP_FIXTURE=fixtures/dabstep/dabstep-005.json apo task run dabstep-005 --dir .
```

The full pipeline — deliverable collection, checks, run recording — executes
against a frozen answer. Wrong-answer fixtures exist to verify the failure
path. Verify every fixture pair at once with nothing recorded:

```bash
pnpm verify:fixtures    # pass fixtures PASS, wrong fixtures FAIL, zero tokens
```

## The conversion workflow

Tasks are not hand-written: every DABstep task under `tasks/dabstep/` is
generated from the pinned dev split by a dynamic per-test-case workflow.

```bash
pnpm fetch:data                  # dev.jsonl + data bundle at the pinned revision
pnpm convert:dabstep -- --all    # one pass per test case: eval.ts + question.md + fixtures
pnpm convert:dabstep -- 70 1273  # regenerate specific cases
pnpm convert:dabstep -- --check  # verify generated tasks match the dataset
```

Per test case, the converter reads the upstream record (question, guidelines,
ground-truth answer, level), classifies the answer shape (string,
multiple-choice, numeric, list, not-applicable), and emits:

- an `.eval.ts` pinning the ground truth at conversion time (with the dataset
  revision in metadata) and registering the trajectory checks plus the
  upstream answer check,
- a `files/question.md` with the question, guidelines, and a per-case data hint,
- a pass fixture and a wrong fixture — the wrong answer is derived from the
  shape (different option, ~1% off numerically, one list item dropped) and
  proven to fail the scorer before anything is written.

The scorer itself is a port of DABstep's official `question_scorer`, kept in
`lib/dabstep.ts` — one implementation shared by all tasks, no LLM judges on
answers the benchmark already scores deterministically.

**When the dataset pin moves** (see `scripts/fetch-data.sh`, the single source
of truth for the revision): re-fetch, run `pnpm convert:dabstep -- --check` to
see exactly which cases' ground truth moved, regenerate with `--all`, then
`pnpm verify:fixtures`.

## Task index

| Task | Level | What it exercises |
|---|---|---|
| `dabstep-005` | easy | Grouped count over 139k-row CSV; exact string answer |
| `dabstep-049` | easy | Filtered count; multiple-choice formatted answer |
| `dabstep-070` | easy | Fine-threshold lookup; "Not Applicable" answer, manual.md trajectory check |
| `dabstep-1273` | hard | Fee computation from documentation (manual.md) + fees.json, 6-decimal numeric answer with tolerance |
| `dabstep-1305` | hard | Fee computation with account type + MCC joins, numeric with tolerance |
| `dabstep-1464` | hard | Fee-ID applicability filter; 416-value list answer, order-insensitive scoring |
| `dabstep-1681` | hard | Merchant fee-ID window query; 10-value list answer |
| `dabstep-1753` | hard | Merchant fee-ID window query; 34-value list answer |
| `dabstep-1871` | hard | Relative-fee delta (counterfactual what-if), signed numeric with tolerance |
| `dabstep-2697` | hard | ACI-incentive optimization; `{card_scheme}:{fee}` formatted answer |

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
lib/         subprocess/exec helpers + the ported DABstep scorer and checks
tasks/       <source>/<task-id>/<task-id>.eval.ts + files/question.md (generated)
fixtures/    canned runs for zero-cost replay (pass and fail variants, generated)
scripts/     data fetch, python setup, and the per-case conversion workflow
data/        fetched benchmark data (gitignored, pinned by revision)
```

## Adding a source

Copy the DABstep pattern: an adapter in `adapters/`, tasks under
`tasks/<source>/<task-id>/`, a fetch script pinning a revision, and a NOTICE.md
entry with license and attribution. Validate with a fixture before running
live.
