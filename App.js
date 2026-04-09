/**
 * Monorepo re-export for expo/AppEntry.js compatibility.
 * EAS builds hoist node_modules to the repo root, so expo/AppEntry's
 * `import App from '../../App'` resolves here instead of apps/mobile/.
 */
export { default } from './apps/mobile/App';
