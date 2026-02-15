---
name: android-emulator-debug
description: Launch an Android emulator, build and install the React Native Expo app, take screenshots, and read logcat to debug runtime errors. Use when the user asks to test, run, or debug the mobile app on an emulator.
---

# Android Emulator Debug

Launch a headed Android emulator, build/install the Expo app, and debug via screenshots and logcat.

## Prerequisites

- Android SDK at `$HOME/Android/Sdk`
- Java 17 at `/usr/lib/jvm/java-17-openjdk`
- AVD home at `~/.config/.android/avd` (non-default location on this machine)
- An AVD already created (check with the list command below)
- Project dependencies installed (`npm install` from repo root)

## 1. List Available AVDs

```bash
$HOME/Android/Sdk/cmdline-tools/latest/bin/avdmanager list avd 2>&1
```

If none exist, create one:

```bash
echo "no" | $HOME/Android/Sdk/cmdline-tools/latest/bin/avdmanager create avd \
  --name "Pixel_6_API_34" \
  --package "system-images;android-34;google_apis;x86_64" \
  --device "pixel_6" --force 2>&1
```

## 2. Launch the Emulator (Headed)

Always launch with a visible window so the user can interact. Use `&` and `disown` so the process doesn't block.

```bash
export ANDROID_AVD_HOME=/home/shakdwipeea/.config/.android/avd
$HOME/Android/Sdk/emulator/emulator -avd Pixel_6_API_34 -gpu swiftshader_indirect &>/tmp/emulator.log &
disown
echo "Emulator launched"
```

**Wait for boot** — poll in a loop with a timeout (never use a blocking `adb wait-for-device` without a timeout guard):

```bash
for i in $(seq 1 30); do
  boot=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  if [ "$boot" = "1" ]; then
    echo "BOOTED after ~$((i*3))s"
    adb devices
    exit 0
  fi
  sleep 3
done
echo "TIMEOUT"
```

Verify the process is alive before polling:

```bash
pgrep -f "qemu-system" >/dev/null && echo "Emulator process running" || echo "NOT running"
```

## 3. Build the APK

Build via Gradle directly — **do not** use `npm run android` or `expo run:android` as they start Metro in a blocking foreground process.

```bash
cd apps/mobile/android
JAVA_HOME=/usr/lib/jvm/java-17-openjdk ./gradlew assembleDebug 2>&1 | tail -20
```

The APK lands at: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

If the APK already exists and no native dependencies changed, skip the build.

## 4. Install the APK

```bash
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk 2>&1
```

## 5. Start Metro Bundler

Start in background with `disown`. Use a timeout on the command that waits for readiness.

```bash
cd apps/mobile
npx expo start --port 8081 --localhost &>/tmp/metro.log &
disown
sleep 10
curl -s http://localhost:8081/status  # expect: packager-status:running
```

## 6. Set Up adb Reverse Proxy

**Required** — the emulator can't reach the host's `localhost` without this:

```bash
adb reverse tcp:8081 tcp:8081
```

Without this, the app shows **"Unable to load script"**.

## 7. Launch the App

```bash
adb shell am force-stop com.sumitnarang76.bookmarksmobile
sleep 1
adb shell am start -n com.sumitnarang76.bookmarksmobile/.MainActivity 2>&1
```

Allow 15-20 seconds for the JS bundle to load on first launch.

## 8. Take Screenshots

```bash
adb exec-out screencap -p > /tmp/screenshot.png
```

Then use the `read` tool to view: `read /tmp/screenshot.png`

**Image coordinate mapping:** Screenshots report `"displayed at WxH. Multiply coordinates by N to map to original image."` Always multiply display coordinates by the given factor when computing tap targets.

## 9. Read Logcat for Errors

```bash
# Recent React Native errors
adb logcat -d | grep "ReactNativeJS" | grep -iE "error|warn" | tail -20

# Full recent log (last 100 lines)
adb logcat -d -t 100 | grep -iE "ReactNative|ExpoModules|error|fatal" | tail -30

# Clear and watch for fresh errors after reproducing
adb logcat -c
# ... reproduce the issue ...
adb logcat -d | grep "ReactNativeJS" | tail -20
```

## 10. Simulate User Input

```bash
# Tap at pixel coordinates (original image coordinates)
adb shell input tap <x> <y>

# Android system back button
adb shell input keyevent KEYCODE_BACK

# Type text
adb shell input text "hello"

# Swipe (x1 y1 x2 y2 duration_ms)
adb shell input swipe 540 1800 540 600 300
```

### Tap Coordinate Tips

- Get the **status bar height** (touch targets are offset by this):
  ```bash
  adb shell dumpsys window StatusBar 2>/dev/null | grep "frame=" | head -1
  ```
  Typical value: 128px on Pixel 6 API 34.
- Safe-area content starts **below** the status bar. A button at visual y=50 in the screenshot is likely untappable — it's behind the system UI.
- Use `adb shell input keyevent KEYCODE_BACK` as a reliable alternative to tapping custom back buttons.

## Teardown

```bash
# Kill emulator
pkill -f "qemu-system" 2>/dev/null

# Kill Metro
pkill -f "expo.*start" 2>/dev/null
pkill -f "@expo/cli" 2>/dev/null

# Kill adb server
adb kill-server 2>/dev/null
```

## Quick Full Workflow

```bash
# 1. Launch emulator
export ANDROID_AVD_HOME=/home/shakdwipeea/.config/.android/avd
$HOME/Android/Sdk/emulator/emulator -avd Pixel_6_API_34 -gpu swiftshader_indirect &>/tmp/emulator.log &
disown

# 2. Wait for boot
for i in $(seq 1 30); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3
done

# 3. Build + install (skip build if APK exists and no native changes)
cd apps/mobile/android && JAVA_HOME=/usr/lib/jvm/java-17-openjdk ./gradlew assembleDebug 2>&1 | tail -5
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 4. Start Metro
cd .. && npx expo start --port 8081 --localhost &>/tmp/metro.log & disown
sleep 10

# 5. Reverse proxy + launch
adb reverse tcp:8081 tcp:8081
adb shell am force-stop com.sumitnarang76.bookmarksmobile
adb shell am start -n com.sumitnarang76.bookmarksmobile/.MainActivity

# 6. Screenshot after bundle loads
sleep 20
adb exec-out screencap -p > /tmp/screenshot.png
```

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Unable to load script" red screen | Metro not reachable from emulator | Run `adb reverse tcp:8081 tcp:8081` |
| "Cannot find native module X" | Native dependency added but APK not rebuilt | Rebuild with `./gradlew assembleDebug` and reinstall |
| Back button visible but untappable | Content behind status bar (deprecated `SafeAreaView` from `react-native`) | Use `SafeAreaView` from `react-native-safe-area-context` |
| `npm run android` hangs forever | Metro starts in foreground and blocks | Build via Gradle directly, start Metro separately in background |
| Emulator process dies silently | Check `/tmp/emulator.log` for errors | Verify AVD exists and system image is installed |
| Metro dies between commands | Background process was cleaned up | Re-check with `curl -s http://localhost:8081/status` and restart if needed |
| Node module import fails in RN bundle | Barrel export pulls in Node-only code (`node:sqlite`) | Import from specific submodules, not barrel `index.ts` |
