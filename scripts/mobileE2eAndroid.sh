#!/usr/bin/env bash

set -euo pipefail

FLOW_DIR="${1:-maestro/flows/android/p0}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_ROOT=".bookmarks/e2e-artifacts/${TIMESTAMP}"

mkdir -p "${ARTIFACT_ROOT}"

if ! command -v maestro >/dev/null 2>&1; then
  echo "maestro CLI is required but was not found in PATH." >&2
  echo "Install from https://maestro.mobile.dev/ and rerun." >&2
  exit 1
fi

run_suite() {
  maestro test "${FLOW_DIR}" \
    --format junit \
    --output "${ARTIFACT_ROOT}/junit.xml" \
    --test-output-dir "${ARTIFACT_ROOT}"
}

capture_failure_artifacts() {
  if command -v adb >/dev/null 2>&1; then
    adb logcat -d > "${ARTIFACT_ROOT}/adb-logcat.txt" || true
  fi

  if [ -f "maestro/flows/android/helpers/capture-diagnostics.yaml" ]; then
    maestro test "maestro/flows/android/helpers/capture-diagnostics.yaml" \
      --test-output-dir "${ARTIFACT_ROOT}/diagnostics" || true
  fi
}

if run_suite; then
  echo "Mobile e2e suite passed. Artifacts: ${ARTIFACT_ROOT}"
  exit 0
fi

echo "Mobile e2e suite failed. Retrying once..."
if run_suite; then
  echo "Mobile e2e suite passed on retry. Artifacts: ${ARTIFACT_ROOT}"
  exit 0
fi

echo "Mobile e2e suite failed after retry. Collecting failure artifacts..."
capture_failure_artifacts

echo "Failure artifacts stored in ${ARTIFACT_ROOT}"
exit 1
