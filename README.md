# Bookmarks Workspace

Monorepo for the Bookmarks app.

- `apps/mobile`: Expo React Native app
- `apps/backend`: Node backend foundation
- `apps/cli`: Shared CLI foundation

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create mobile env file from template:

   ```bash
   cp apps/mobile/.env.example apps/mobile/.env
   ```

3. Open `apps/mobile/.env` and set at least:

   ```env
   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<your-google-places-api-key>
   JAVA_HOME=/usr/lib/jvm/java-17-openjdk
   ```

4. Start the app:

   ```bash
   npm start
   ```

## Environment templates

- `apps/mobile/.env.example`: primary mobile runtime template (copy to `apps/mobile/.env`)
- `.env.example`: workspace-level reference template

## More setup details

For full Android setup (SDK, ADB, maps key, e2e), see [`building.md`](./building.md).
