# AGENTS.md

Guide for AI coding agents working in this repository.

## Project Overview

React Native Expo (SDK 54) mobile app for saving and organizing places/bookmarks with Google Maps integration. Written in **JavaScript** (no TypeScript). Fully client-side — no backend server. Data persisted locally via AsyncStorage.

## Build & Run Commands

```bash
npm install                 # Install dependencies
npm start                   # Start Metro bundler only
npm run android             # Build + install + run on Android device
npm run ios                 # Build + run on iOS simulator
npm run web                 # Run in browser (react-native-maps unsupported)
```

**Environment requirements:**
- Node.js (via nvm)
- Java 17 (`JAVA_HOME=/usr/lib/jvm/java-17-openjdk` set in `.env`)
- `ANDROID_HOME=$HOME/Android/Sdk` in `~/.bashrc`
- `.env` file with `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` and `JAVA_HOME`
- Google Maps API key in `android/app/src/main/AndroidManifest.xml` as `com.google.android.geo.API_KEY` meta-data

See `building.md` for full setup instructions.

## Testing

There is **no test infrastructure** in this project. No test files, no test runner, no testing libraries in dependencies.

## Linting / Formatting

There is **no ESLint or Prettier** configured. No `.eslintrc`, `.prettierrc`, or `.editorconfig` files. Follow the existing code style described below.

## Project Structure

```
App.js                  # Entry point, providers, deep linking
index.js                # Expo entry registration
config/api.js           # API keys and endpoint URLs
context/AuthContext.js   # Auth state (Google/Apple sign-in)
navigation/AppNavigator.js  # Tab + stack navigation setup
screens/                # Full-page screen components (8 files)
components/             # Reusable UI components (6 files)
modals/                 # Modal dialogs (10 files)
data/                   # Storage, API helpers, mock data (4 files)
utils/                  # Utility functions (1 file)
styles/                 # StyleSheet definitions and color/typography constants
assets/icons/           # SVG and PNG icon assets
```

## Code Style Guidelines

### Language & Framework
- **JavaScript only** — no TypeScript, no Flow
- **React functional components** with hooks — no class components
- **Expo managed workflow** — use Expo SDK modules where available

### File Naming
- **PascalCase** for screen, component, and modal files: `HomeScreen.js`, `AppModal.js`, `SaveToCollectionModal.js`
- **camelCase** for utility, data, config, and style files: `storage.js`, `placesApi.js`, `haptics.js`
- **PascalCase** for style files that are screen-specific: `HomeStyles.js`, `ModalStyles.js`
- **camelCase** for shared style constants: `colors.js`, `typography.js`

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
- **AsyncStorage** for persistence (`data/storage.js`)
- **Navigation params** for passing data between screens

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
