#!/usr/bin/env bash
# Create a local Python environment with pandas for the run_python tool.
#
# The agent can solve every task with the standard library alone (csv, json),
# but pandas makes short work of payments.csv. The adapter uses this venv
# automatically when it exists; otherwise it falls back to python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found — skipping venv. The agent will use plain python3 (stdlib only)." >&2
  exit 0
fi

uv venv .venv
uv pip install --python .venv/bin/python pandas
echo "Done. .venv/bin/python now has pandas; the adapter picks it up automatically."
