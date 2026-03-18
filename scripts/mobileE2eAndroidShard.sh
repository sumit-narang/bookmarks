#!/usr/bin/env bash

set -euo pipefail

mkdir -p "${E2E_ARTIFACT_ROOT}"

cleanup() {
  if [ -n "${METRO_PID:-}" ]; then
    kill "${METRO_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

npm run mobile:e2e:backend:start > "${E2E_ARTIFACT_ROOT}/backend-e2e.log" 2>&1 &
BACKEND_PID=$!

for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:8787/health > /dev/null; then
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "Backend failed to become healthy."
    exit 1
  fi

  sleep 2
done

npm --workspace @bookmarks/mobile run start -- --dev-client --port 8081 --localhost --non-interactive > "${E2E_ARTIFACT_ROOT}/metro.log" 2>&1 &
METRO_PID=$!

for attempt in $(seq 1 90); do
  if curl --silent http://127.0.0.1:8081/status | grep -q "packager-status:running"; then
    break
  fi

  if [ "$attempt" -eq 90 ]; then
    echo "Metro failed to start."
    exit 1
  fi

  sleep 2
done

adb devices # confirm emulator online

# Wait for adb to report a healthy online device without restarting adb server.
# Restarting adb here can race with emulator startup in CI.
timeout 300 bash -c 'until adb get-state 2>/dev/null | grep -q "device"; do adb reconnect offline >/dev/null 2>&1 || true; sleep 2; done'

# Wait for emulator boot completion signal
timeout 300 bash -c 'until adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r" | grep -m 1 "^1$"; do adb reconnect offline >/dev/null 2>&1 || true; sleep 5; done'

# Suppress system ANR/crash dialogs that can cover the app during CI startup.
# Some flags live under secure on certain Android builds, so set both secure/global where possible.
adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true
adb shell settings put global anr_show_background 0 >/dev/null 2>&1 || true
adb shell settings put secure show_first_crash_dialog 0 >/dev/null 2>&1 || true
adb shell settings put global show_first_crash_dialog 0 >/dev/null 2>&1 || true
adb shell settings put global show_first_crash_dialog_dev_option 0 >/dev/null 2>&1 || true
adb shell settings put global show_app_error_dialog 0 >/dev/null 2>&1 || true
adb shell settings put global show_restart_in_crash_dialog 0 >/dev/null 2>&1 || true

adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787

pushd apps/mobile/android > /dev/null
./gradlew assembleDebug --no-daemon
popd > /dev/null

APP_APK_PATH="apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
adb install -r "${APP_APK_PATH}"

case "${E2E_SHARD}" in
  1)
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/auth-session-restart-sync" --flatten "maestro/flows/android/p0/auth-session-restart-sync.yaml"
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/collection-membership-persistence-relaunch" --flatten "maestro/flows/android/p0/collection-membership-persistence-relaunch.yaml"
    ;;
  2)
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/local-place-persistence-relaunch" --flatten "maestro/flows/android/p0/local-place-persistence-relaunch.yaml"
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/offline-write-online-sync-push" --flatten "maestro/flows/android/p0/offline-write-online-sync-push.yaml"
    ;;
  3)
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/preferences-persistence-sync" --flatten "maestro/flows/android/p0/preferences-persistence-sync.yaml"
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/remote-pull-convergence" --flatten "maestro/flows/android/p0/remote-pull-convergence.yaml"
    ;;
  4)
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/saved-state-derived-removal-relaunch" --flatten "maestro/flows/android/p0/saved-state-derived-removal-relaunch.yaml"
    maestro-runner --platform android --app-file "${APP_APK_PATH}" ${CI:+--no-ansi} test --wait-for-idle-timeout "${E2E_WAIT_FOR_IDLE_TIMEOUT:-100}" --output "${E2E_ARTIFACT_ROOT}/signout-wipe-persistence" --flatten "maestro/flows/android/p0/signout-wipe-persistence.yaml"
    ;;
  *)
    echo "Unsupported shard: ${E2E_SHARD}"
    exit 1
    ;;
esac
