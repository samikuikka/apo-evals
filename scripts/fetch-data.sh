#!/usr/bin/env bash
# Download the DABstep data bundle and dev task set into data/dabstep/.
#
# Pinned to a dataset commit (not a branch) so every checkout of this repo
# evaluates against identical data and identical ground-truth answers.
# This file is the single source of truth for the pin: scripts/convert-dabstep.ts
# reads DABSTEP_REV from here and stamps it into every generated task.
# To move the pin: update DABSTEP_REV here, re-fetch, then
#   pnpm convert:dabstep -- --check   # shows which tasks' ground truth moved
#   pnpm convert:dabstep -- --all     # regenerate
#   pnpm verify:fixtures              # re-verify the pipeline, zero tokens
set -euo pipefail

DABSTEP_REV="f6980beb8908f6dbb5056924f020fa49a0bf946b"
BASE="https://huggingface.co/datasets/adyen/DABstep/resolve/${DABSTEP_REV}/data"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT_DIR="${ROOT}/data/dabstep/context"
TASKS_DIR="${ROOT}/data/dabstep/tasks"

mkdir -p "${CONTEXT_DIR}" "${TASKS_DIR}"

CONTEXT_FILES=(
  payments.csv
  payments-readme.md
  fees.json
  merchant_data.json
  merchant_category_codes.csv
  acquirer_countries.csv
  manual.md
)

for f in "${CONTEXT_FILES[@]}"; do
  echo "Fetching ${f}..."
  curl -fsSL "${BASE}/context/${f}" -o "${CONTEXT_DIR}/${f}"
done

echo "Fetching dev task set..."
curl -fsSL "${BASE}/tasks/dev.jsonl" -o "${TASKS_DIR}/dev.jsonl"

echo "Done. Data bundle in ${CONTEXT_DIR}, tasks in ${TASKS_DIR}/dev.jsonl"
