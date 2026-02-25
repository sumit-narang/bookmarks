#!/usr/bin/env bash

set -euo pipefail

FLOW_TARGET="${1:-maestro/flows/android/p0}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_ROOT=".bookmarks/e2e-artifacts/${TIMESTAMP}"

mkdir -p "${ARTIFACT_ROOT}"

if ! command -v maestro-runner >/dev/null 2>&1; then
  echo "maestro-runner is required but was not found in PATH." >&2
  echo "Install from https://github.com/devicelab-dev/maestro-runner and rerun." >&2
  exit 1
fi

EMULATOR_BIN=""
if command -v emulator >/dev/null 2>&1; then
  EMULATOR_BIN="$(command -v emulator)"
elif [ -n "${ANDROID_HOME:-}" ] && [ -x "${ANDROID_HOME}/emulator/emulator" ]; then
  EMULATOR_BIN="${ANDROID_HOME}/emulator/emulator"
fi

if [ -z "${ANDROID_AVD_HOME:-}" ] && [ -d "${HOME}/.config/.android/avd" ]; then
  export ANDROID_AVD_HOME="${HOME}/.config/.android/avd"
fi

if [ ! -e "${FLOW_TARGET}" ]; then
  echo "Flow target does not exist: ${FLOW_TARGET}" >&2
  exit 1
fi

APP_APK_PATH="${E2E_APP_APK_PATH:-apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk}"

if [ ! -f "${APP_APK_PATH}" ]; then
  echo "Android debug APK not found at: ${APP_APK_PATH}" >&2
  echo "Build the app first (for example: cd apps/mobile/android && ./gradlew assembleDebug)" >&2
  exit 1
fi

count_flow_files() {
  if [ -f "${FLOW_TARGET}" ]; then
    echo "1"
    return
  fi

  find "${FLOW_TARGET}" -type f -name '*.yaml' | wc -l | tr -d ' '
}

count_connected_devices() {
  if ! command -v adb >/dev/null 2>&1; then
    echo "0"
    return
  fi

  adb devices | awk 'NR > 1 && $2 == "device" { count++ } END { print count + 0 }'
}

count_running_emulators() {
  if ! command -v adb >/dev/null 2>&1; then
    echo "0"
    return
  fi

  adb devices | awk 'NR > 1 && $1 ~ /^emulator-/ && $2 == "device" { count++ } END { print count + 0 }'
}

count_available_avds() {
  if [ -z "${EMULATOR_BIN}" ]; then
    echo "0"
    return
  fi

  "${EMULATOR_BIN}" -list-avds | awk 'NF { count++ } END { print count + 0 }'
}

resolve_parallelism() {
  local flow_count="${1}"

  if [ -n "${E2E_PARALLEL:-}" ]; then
    echo "${E2E_PARALLEL}"
    return
  fi

  local connected_devices
  connected_devices="$(count_connected_devices)"

  local running_emulators
  running_emulators="$(count_running_emulators)"

  local total_avds
  total_avds="$(count_available_avds)"

  local startable_avds=$(( total_avds - running_emulators ))
  if [ "${startable_avds}" -lt 0 ]; then
    startable_avds=0
  fi

  local max_parallel=$(( connected_devices + startable_avds ))
  if [ "${max_parallel}" -lt 1 ]; then
    max_parallel=1
  fi

  local reliability_cap="${E2E_MAX_PARALLEL:-4}"
  if [ "${reliability_cap}" -lt 1 ]; then
    reliability_cap=1
  fi

  if [ "${max_parallel}" -gt "${reliability_cap}" ]; then
    max_parallel="${reliability_cap}"
  fi

  if [ "${flow_count}" -lt "${max_parallel}" ]; then
    echo "${flow_count}"
  else
    echo "${max_parallel}"
  fi
}

sync_report_aliases() {
  if [ -f "${ARTIFACT_ROOT}/junit-report.xml" ]; then
    cp "${ARTIFACT_ROOT}/junit-report.xml" "${ARTIFACT_ROOT}/junit.xml"
  fi
}

FLOW_COUNT="$(count_flow_files)"
if [ "${FLOW_COUNT}" -lt 1 ]; then
  echo "No .yaml flows found under ${FLOW_TARGET}" >&2
  exit 1
fi

PARALLELISM="$(resolve_parallelism "${FLOW_COUNT}")"

echo "Running Android e2e with maestro-runner"
echo "Flow target: ${FLOW_TARGET}"
echo "Flow count: ${FLOW_COUNT}"
echo "Parallel workers: ${PARALLELISM}"
echo "Emulator binary: ${EMULATOR_BIN:-not-found}"
echo "App APK: ${APP_APK_PATH}"
echo "Artifacts: ${ARTIFACT_ROOT}"

run_suite() {
  maestro-runner \
    --platform android \
    --auto-start-emulator \
    --boot-timeout "${E2E_BOOT_TIMEOUT:-240}" \
    --app-file "${APP_APK_PATH}" \
    ${CI:+--no-ansi} \
    test \
    --parallel "${PARALLELISM}" \
    --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" \
    --output "${ARTIFACT_ROOT}" \
    --flatten \
    "${FLOW_TARGET}"

  sync_report_aliases

  local report_path="${ARTIFACT_ROOT}/report.json"
  if [ -f "${report_path}" ]; then
    local status
    status="$(python3 - "${report_path}" <<'PY'
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    report = json.load(handle)
print(report.get('status', 'unknown'))
PY
)"

    if [ "${status}" != "passed" ]; then
      echo "maestro-runner reported status=${status}" >&2
      return 1
    fi
  fi
}

capture_failure_artifacts() {
  if command -v adb >/dev/null 2>&1; then
    mapfile -t devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

    for device_id in "${devices[@]}"; do
      adb -s "${device_id}" logcat -d > "${ARTIFACT_ROOT}/adb-logcat-${device_id}.txt" || true
    done

    if [ -f "maestro/flows/android/helpers/capture-diagnostics.yaml" ] && [ "${#devices[@]}" -gt 0 ]; then
      maestro-runner \
        --platform android \
        --device "${devices[0]}" \
        --app-file "${APP_APK_PATH}" \
        ${CI:+--no-ansi} \
        test \
        --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" \
        --output "${ARTIFACT_ROOT}/diagnostics" \
        --flatten \
        "maestro/flows/android/helpers/capture-diagnostics.yaml" || true
    fi
  fi
}

if run_suite; then
  echo "Mobile e2e suite passed. Artifacts: ${ARTIFACT_ROOT}"
  exit 0
fi

if [ "${E2E_RETRY_ON_FAILURE:-0}" = "1" ]; then
  echo "Mobile e2e suite failed. Retrying once..."

  if run_suite; then
    echo "Mobile e2e suite passed on retry. Artifacts: ${ARTIFACT_ROOT}"
    exit 0
  fi
fi

echo "Mobile e2e suite failed. Collecting failure artifacts..."
capture_failure_artifacts
sync_report_aliases

echo "Failure artifacts stored in ${ARTIFACT_ROOT}"
exit 1
