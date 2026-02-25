import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import { isE2eModeEnabled } from './config/e2e';

import App from './App';

if (isE2eModeEnabled) {
  LogBox.ignoreAllLogs(true);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
