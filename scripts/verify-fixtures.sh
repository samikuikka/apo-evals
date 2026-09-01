#!/usr/bin/env bash
# Zero-cost verification of every DABstep fixture pair: the pass fixture must
# PASS and the -wrong fixture must FAIL. Runs with --no-record — no model
# call, no tokens, nothing written to the backend. This is the gate to run
# before pushing, and after regenerating tasks or moving the dataset pin.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
for pass_fixture in fixtures/dabstep/dabstep-*.json; do
  case "$pass_fixture" in *-wrong.json) continue ;; esac
  task_id="$(basename "$pass_fixture" .json)"
  wrong_fixture="fixtures/dabstep/${task_id}-wrong.json"

  if DABSTEP_FIXTURE="$pass_fixture" apo task run "$task_id" --dir . --no-record >/dev/null 2>&1; then
    echo "PASS  $task_id (pass fixture passes)"
  else
    echo "FAIL  $task_id: pass fixture did not pass — run it without --no-record to inspect"
    fail=1
  fi

  if [ ! -f "$wrong_fixture" ]; then
    echo "WARN  $task_id: no -wrong fail fixture"
    continue
  fi
  if DABSTEP_FIXTURE="$wrong_fixture" apo task run "$task_id" --dir . --no-record >/dev/null 2>&1; then
    echo "FAIL  $task_id: wrong fixture passed — the answer check is not load-bearing"
    fail=1
  else
    echo "PASS  $task_id (wrong fixture fails as designed)"
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "all fixtures verified — no model, no tokens, nothing recorded"
fi
exit "$fail"
