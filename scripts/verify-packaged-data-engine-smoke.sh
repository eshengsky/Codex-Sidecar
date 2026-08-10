#!/bin/bash

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <packaged-executable> <isolated-app-data-path>" >&2
  exit 64
fi

packaged_executable="$1"
smoke_app_data_path="$2"

if [[ ! -x "$packaged_executable" ]]; then
  echo "Packaged executable is missing or not executable: $packaged_executable" >&2
  exit 66
fi

mkdir -p "$smoke_app_data_path"
smoke_log="$(mktemp "${TMPDIR:-/tmp}/sidecar-engine-smoke.XXXXXX")"

cleanup() {
  rm -f "$smoke_log"
}
trap cleanup EXIT

# Capture both streams without command substitution: `set -e` would otherwise
# terminate the CI step before the persisted diagnostics can be printed.
set +e
SIDECAR_SMOKE_APP_DATA_PATH="$smoke_app_data_path" \
  "$packaged_executable" \
  --sidecar-engine-smoke >"$smoke_log" 2>&1
smoke_status="$?"
set -e

cat "$smoke_log"

if [[ "$smoke_status" -ne 0 ]]; then
  diagnostics_path="$smoke_app_data_path/Codex Sidecar/diagnostics/events.jsonl"
  echo "Packaged data-engine smoke exited with code $smoke_status."

  if [[ -f "$diagnostics_path" ]]; then
    echo "Last persisted Sidecar diagnostics:"
    tail -n 200 "$diagnostics_path"
  else
    echo "No persisted Sidecar diagnostics were created at $diagnostics_path."
  fi

  exit "$smoke_status"
fi

if ! grep -Fq '"status":"ready"' "$smoke_log"; then
  echo "Packaged data-engine smoke did not report ready."
  exit 1
fi

database_path="$smoke_app_data_path/Codex Sidecar/sidecar-v2.sqlite"
if [[ ! -f "$database_path" ]]; then
  echo "Packaged data-engine smoke did not create sidecar-v2.sqlite."
  exit 1
fi
