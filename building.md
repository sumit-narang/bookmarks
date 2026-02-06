# Building & Running Locally (Android)

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

Create a `.env` file in the project root:

```
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<your-google-places-api-key>
JAVA_HOME=/usr/lib/jvm/java-17-openjdk
```

The `JAVA_HOME` entry ensures the Expo/Gradle build uses Java 17 regardless of your system default.

### 3. Add Google Maps API key to Android manifest

Edit `android/app/src/main/AndroidManifest.xml` and add this `<meta-data>` entry inside the `<application>` tag:

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

## Other Run Commands

| Command | Description |
|---|---|
| `npm start` | Start Metro bundler only |
| `npm run android` | Build + install + run on Android device |
| `npm run ios` | Build + run on iOS simulator |
| `npm run web` | Run in browser (note: `react-native-maps` does not support web) |
