# AGENTS.md

Guide for AI coding agents working in this repository.

## Project Overview

Monorepo workspace for the bookmarks app.

- `apps/mobile`: React Native Expo (SDK 54) app (existing code in **JavaScript**)
- `apps/backend`: Node backend foundation (new code in **TypeScript**)
- `apps/cli`: shared CLI foundation (new code in **TypeScript**)
- `core`, `schema`, `db`: shared persistence foundations (TypeScript)
- Mobile runtime still uses AsyncStorage today; SQLite foundation is being prepared for cutover

## Artifact Naming Rules

- Do **not** use `slice n` naming in any artifact (`Slice 1`, `slice1`, `slice-1`, etc.).
- This applies to filenames, test names, headings, inline comments, commit messages, and PR descriptions.
- Use descriptive names based on behavior/domain instead (e.g., `foundation-schema`, `runtime-smoke`, `preferences-sync`).

## Build & Run Commands

```bash
npm install                         # Install all workspace dependencies
npm start                           # Start Expo Metro (apps/mobile)
npm run android                     # Build + install + run Android app (apps/mobile)
npm run ios                         # Build + run iOS app (apps/mobile)
npm run web                         # Run app in browser (apps/mobile)
npm run backend:start               # Run backend foundation service
npm run cli -- db:init              # Initialize local CLI database
npm run cli -- db:reset             # Reset local CLI database
npm run cli -- db:inspect           # Inspect local CLI database tables
npm run typecheck                   # Type-check TypeScript modules
npm test                            # Run Node integration + runtime smoke tests
```

**Environment requirements:**
- Node.js (via nvm)
- Java 17 (`JAVA_HOME=/usr/lib/jvm/java-17-openjdk` set in mobile `.env`)
- `ANDROID_HOME=$HOME/Android/Sdk` in `~/.bashrc`
- `apps/mobile/.env` file with `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` and `JAVA_HOME`
- Google Maps API key in `apps/mobile/android/app/src/main/AndroidManifest.xml` as `com.google.android.geo.API_KEY` meta-data

See `building.md` for full setup instructions.

## Physical Device Development (Android)

When running against a **physical Android device** (not an emulator), the standard `10.0.2.2` loopback alias does not work. Use ADB reverse proxy so the device can reach the local backend:

```bash
# 1. Connect device via wireless debugging (Developer options > Wireless debugging)
adb connect <device-ip>:<port>

# 2. Set up reverse proxy — forwards device's localhost:8787 → dev machine's localhost:8787
adb reverse tcp:8787 tcp:8787

# 3. Start the backend
npm run backend:start

# 4. In apps/mobile/.env, switch the backend URL to local:
#    EXPO_PUBLIC_BOOKMARKS_BACKEND_URL=http://127.0.0.1:8787

# 5. Start Metro
npm start
```

Re-run `adb reverse tcp:8787 tcp:8787` any time the device reconnects. The reverse tunnel does not persist across ADB daemon restarts.

## Testing

Integration tests exist for schema migrations, CLI/backend runtime smoke checks, and sign-out wipe behavior.

```bash
npm run typecheck
npm test
```

- Test runner: Node built-in test runner
- TS execution: `tsx`
- Current suites:
  - `tests/foundation-schema.test.ts`
  - `tests/runtime-smoke.test.ts` (CLI + backend smoke checks)
  - `tests/mobile-signout-wipe.test.ts` (sign-out local wipe behavior)

## Linting / Formatting

There is **no ESLint or Prettier** configured. No `.eslintrc`, `.prettierrc`, or `.editorconfig` files. Follow the existing code style described below.

## Project Structure

```
apps/
  mobile/                    # Expo React Native app (JS)
    App.js
    index.js
    screens/
    components/
    modals/
    data/
    context/
    navigation/
    styles/
    assets/
  backend/                   # Node backend foundation (TS)
  cli/                       # Shared CLI foundation (TS)
core/                        # Shared primitives (TS)
schema/                      # SQL schema + migrations (TS)
db/                          # SQLite adapters + migrator (TS)
tests/                       # Integration tests (TS)
plans/                       # Architecture and implementation plans
```

## Code Style Guidelines

### Language & Framework
- **Existing mobile app code** remains JavaScript (no TypeScript migration yet)
- **New persistence/backend/CLI foundations** are TypeScript
- Do not migrate existing mobile JS files to TS unless explicitly requested
- **React functional components** with hooks — no class components
- **Expo managed workflow** — use Expo SDK modules where available

### File Naming
- **PascalCase** for screen, component, and modal files: `HomeScreen.js`, `AppModal.js`, `SaveToCollectionModal.js`
- **camelCase** for utility, data, config, and style files: `storage.js`, `placesApi.js`, `haptics.js`
- **PascalCase** for style files that are screen-specific: `HomeStyles.js`, `ModalStyles.js`
- **camelCase** for shared style constants: `colors.js`, `typography.js`
- **TypeScript foundation modules** use descriptive camelCase filenames: `nodeSqliteAdapter.ts`, `migrator.ts`, `contracts.ts`

### Imports — Order Convention
1. React / React Native core
2. Expo modules
3. Third-party libraries (`@react-navigation`, `react-native-maps`, etc.)
4. Local modules: data, config, context (with `../` paths)
5. Styles (with `../styles/` paths)
6. SVG icons and assets (with `../assets/` paths)
7. Local components (with `../components/` paths)

```js
import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { searchPlacesGoogle, getPlaceDetails } from '../data/placesApi';
import { getPlaces } from '../data/storage';
import { SearchStyles as styles } from '../styles/SearchStyles';
import { colors } from '../styles/colors';
import SearchIcon from '../assets/icons/search.svg';
import ImageListWithAction from '../components/ImageListWithAction';
```

### Component Patterns
- **Arrow function components** — not `function` declarations (except `App.js` which uses `export default function App()`)
- Props are **destructured** in the parameter list
- Components are **default exported** at the bottom of the file
- No `React.` prefix — import hooks directly: `import { useState } from 'react'`

```js
const MyComponent = ({ visible, onClose, title, children }) => {
  return ( ... );
};

export default MyComponent;
```

### Naming Conventions
- **Components/Screens/Modals**: PascalCase (`FloatingTabBar`, `PlaceDetailsScreen`)
- **Functions**: camelCase, prefixed with action verbs (`handleSearch`, `loadSavedPlaces`, `formatPlaceType`)
- **Event handlers**: `handle` + action (`handleClearSearch`, `handleResultPress`)
- **Async loaders**: `load` + noun (`loadStoredUser`, `loadSavedPlaces`)
- **State variables**: camelCase descriptive (`isSearching`, `isLoadingDetails`, `searchQuery`)
- **Boolean state**: `is` prefix (`isReady`, `isSearching`, `isAuthenticated`)
- **Refs**: descriptive + `Ref` suffix (`inputRef`, `searchTimeoutRef`)
- **Constants**: camelCase for objects (`colors`, `linking`), UPPER_SNAKE_CASE for string keys (`USER_STORAGE_KEY`, `GOOGLE_PLACES_API_KEY`)

### Styling
- Use `StyleSheet.create()` — defined as `const styles` at the bottom of the file, after the component
- Screen-specific styles are in separate files under `styles/` and imported with alias: `import { SearchStyles as styles } from '../styles/SearchStyles'`
- Shared colors via `styles/colors.js`, typography via `styles/typography.js`
- Dark theme throughout — background `#181818`, cards `#2C2C2E`, text `#FFFFFF`

### Error Handling
- Wrap async operations in `try/catch`
- Log errors with `console.error('Descriptive message:', error)`
- Log warnings with `console.warn('...')`
- Return safe defaults on failure (empty arrays `[]`, `null`, `false`)
- Use `finally` blocks for cleanup (setting loading states to `false`)

```js
try {
  const response = await fetch(url);
  const data = await response.json();
  return data;
} catch (error) {
  console.error('Error fetching data:', error);
  return null;
} finally {
  setIsLoading(false);
}
```

### Comments
- **File-level JSDoc** at the top of every file describing its purpose
- **JSDoc** on exported utility functions with `@param` and `@returns`
- **Inline comments** for non-obvious logic, prefixed with `//`
- Section dividers in JSX: `{/* Header */}`, `{/* Content */}`, `{/* No results state */}`

```js
/**
 * Google Places API helper functions
 * Handles searching for places and fetching details
 */

/**
 * Search for places using Google Places Autocomplete
 * @param {string} query - Search text
 * @returns {Promise<Array>} - Array of place predictions
 */
export const searchPlacesGoogle = async (query) => { ... };
```

### State Management
- **Local state** via `useState` — no Redux, no Zustand, no global store
- **Context API** for auth state (`AuthContext`)
- **AsyncStorage** currently backs mobile persistence (`apps/mobile/data/storage.js`)
- **Sign-out wipe** is centralized in `apps/mobile/data/localPersistence.js`
- Shared SQLite modules live under `schema/` + `db/` and are exercised via CLI/backend/tests
- **Navigation params** for passing data between screens

### Auth & Data Isolation
- On sign out, wipe app-scoped local data (do not only unset in-memory user state)
- Keep wipe logic in one place (`apps/mobile/data/localPersistence.js`) so SQLite file wipe can be added there during cutover

### Exports
- **Components, screens, modals**: `export default` at file bottom
- **Utility functions**: named exports (`export const lightHaptic = ...`)
- **Style objects**: named export + default export (`export const colors = ...; export default colors;`)
- **Config values**: named exports (`export const GOOGLE_PLACES_API_KEY = ...`)

### SVG Icons
- SVGs are imported as React components via `react-native-svg-transformer`
- Sized with `width` and `height` props: `<SearchIcon width={16} height={16} />`
- Stored in `assets/icons/`

### Navigation
- `@react-navigation` v7 with bottom tabs + native stacks
- Screen names are PascalCase strings: `'PlaceDetails'`, `'SharedCollection'`
- Navigate with: `navigation.navigate('ScreenName', { paramKey: value })`
- Access params with: `route.params`
