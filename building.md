# Building & Running Locally (Android)

This repository is now a workspace monorepo. Mobile app lives in `apps/mobile`, but all commands below are run from the repository root.

## Prerequisites

- **Node.js** (via nvm)
- **Java 17** — the project requires JDK 17. If you have a newer version (e.g. Java 25), install JDK 17:
  ```bash
  sudo pacman -S jdk17-openjdk
  ```
- **Android SDK** — install via Android Studio or standalone SDK tools

## Environment Setup

### 1. Set ANDROID_HOME

Add to `~/.bashrc`:

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

Then reload:

```bash
source ~/.bashrc
```

### 2. Create `.env` file

Copy the template and fill in your values:

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Required entries:

```
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<your-google-places-api-key>
JAVA_HOME=/usr/lib/jvm/java-17-openjdk
```

Additional optional entries are documented in `apps/mobile/.env.example`.

The `JAVA_HOME` entry ensures the Expo/Gradle build uses Java 17 regardless of your system default.

### 3. Add Google Maps API key to Android manifest

Edit `apps/mobile/android/app/src/main/AndroidManifest.xml` and add this `<meta-data>` entry inside the `<application>` tag:

```xml
<meta-data android:name="com.google.android.geo.API_KEY" android:value="<your-google-maps-api-key>"/>
```

This is required by `react-native-maps` to render Google Maps.

## Install Dependencies

```bash
npm install
```

## Connect Android Device (Wireless Debugging)

1. Enable **Developer Options** and **Wireless Debugging** on your phone
2. Tap **Pair device with pairing code**
3. On your machine:
   ```bash
   adb pair <phone-ip>:<pairing-port> <pairing-code>
   ```
4. Then connect using the port shown on the **Wireless debugging** screen (not the pairing port):
   ```bash
   adb connect <phone-ip>:<connection-port>
   ```
5. Verify:
   ```bash
   adb devices
   ```

## Build & Run

```bash
npm run android
```

This will:
1. Build the native Android app via Gradle
2. Install the APK on the connected device
3. Start Metro bundler and launch the app

### If install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

An existing version with a different signing key is on the device. Uninstall it first:

```bash
adb uninstall com.sumitnarang76.bookmarksmobile
```

Then run `npm run android` again.

### If the app shows "Unable to load script"

Metro bundler needs to be reachable from the device. Set up reverse port forwarding:

```bash
adb reverse tcp:8081 tcp:8081
```

Then reopen the app.

## Release Build (Physical Device)

To install a standalone release APK that works without a USB/ADB connection or Metro bundler:

1. **Temporarily restrict architectures** to your device's ABI to speed up the build and avoid NDK compiler issues on other ABIs. In `apps/mobile/android/gradle.properties`, change:

   ```properties
   reactNativeArchitectures=arm64-v8a
   ```

   (Check your device's ABI with `adb shell getprop ro.product.cpu.abi`.)

2. **Ensure `.env` points to your deployed backend** — the release build embeds env vars at build time, so `EXPO_PUBLIC_BOOKMARKS_BACKEND_URL` must be the production/deployed URL (not `127.0.0.1`).

3. **Build and install:**

   ```bash
   npx expo run:android --variant release --no-bundler
   ```

   This bundles JavaScript via Hermes, builds a release APK signed with the debug keystore, installs it on the connected device, and launches it.

   The resulting APK is at:
   ```
   apps/mobile/android/app/build/outputs/apk/release/app-release.apk
   ```

4. **Restore architectures** in `gradle.properties` for future emulator/debug builds:

   ```properties
   reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64
   ```

> **Note:** The release build uses the debug keystore for signing (`android/app/debug.keystore`). For Play Store distribution, generate a dedicated release keystore — see [React Native signed APK docs](https://reactnative.dev/docs/signed-apk-android).

## Other Run Commands

| Command | Description |
|---|---|
| `npm start` | Start Metro bundler only |
| `npm run android` | Build + install + run on Android device |
| `npm run ios` | Build + run on iOS simulator |
| `npm run web` | Run in browser (note: `react-native-maps` does not support web) |

## Dev Test Auth (No Google)

When running the local backend in development (`npm run backend:start`), test auth is enabled automatically.

- In the mobile app (dev build), Profile and Library sign-in screens show a **Continue as Test User** button.
- Optional: set `EXPO_PUBLIC_BOOKMARKS_DEV_TEST_USER` in `apps/mobile/.env` to pick a custom test user ID.
- Optional: set `EXPO_PUBLIC_BOOKMARKS_DEV_TEST_AUTH=0` to hide the dev test-auth button.
- Production remains protected: backend rejects test auth when `NODE_ENV=production`.

## Mobile E2E (maestro-runner, Android)

1. Enable e2e mode in `apps/mobile/.env`:

```bash
EXPO_PUBLIC_BOOKMARKS_E2E_MODE=1
EXPO_PUBLIC_BOOKMARKS_BACKEND_URL=http://127.0.0.1:8787
```

2. Start seeded backend (test auth provider + stable e2e users):

```bash
npm run mobile:e2e:backend:start
```

3. Run Android e2e flows:

```bash
npm run mobile:e2e:android
```

The runner uses `maestro-runner` with a reliability-first parallelism cap.

By default, worker count is capped at `4` via `E2E_MAX_PARALLEL` to reduce emulator instability, while still auto-scaling up to available/startable devices.

Optional overrides:

```bash
E2E_MAX_PARALLEL=4 npm run mobile:e2e:android   # default reliability cap
E2E_PARALLEL=6 npm run mobile:e2e:android       # force exact worker count
E2E_WAIT_FOR_IDLE_TIMEOUT=100 npm run mobile:e2e:android
E2E_BOOT_TIMEOUT=300 npm run mobile:e2e:android
```

Artifacts (report JSON/HTML/JUnit, logs, diagnostics capture on failure) are written under:

```bash
.bookmarks/e2e-artifacts/
```
