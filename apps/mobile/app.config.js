const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Load .env so EXPO_PUBLIC_* vars are available during `expo prebuild`
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Plugin: inject react-native-maps Google Maps subspecs into Podfile
const withGoogleMapsPod = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      const podLine = "  pod 'react-native-maps', :path => '../../../node_modules/react-native-maps', :subspecs => ['Generated', 'Maps', 'Google']";

      if (!podfile.includes(podLine)) {
        podfile = podfile.replace(
          '  use_expo_modules!',
          `  use_expo_modules!\n${podLine}`
        );
        fs.writeFileSync(podfilePath, podfile);
      }

      return config;
    },
  ]);
};

// Plugin: initialise Google Maps SDK in AppDelegate before React Native starts
const withGoogleMapsAppDelegate = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        'AppDelegate.swift'
      );
      let contents = fs.readFileSync(appDelegatePath, 'utf8');

      if (!contents.includes('import GoogleMaps')) {
        contents = contents.replace('import Expo', 'import Expo\nimport GoogleMaps');
      }

      if (!contents.includes('GMSServices.provideAPIKey')) {
        contents = contents.replace(
          '    let delegate = ReactNativeDelegate()',
          `    if let apiKey = Bundle.main.object(forInfoDictionaryKey: "GMSApiKey") as? String {\n      GMSServices.provideAPIKey(apiKey)\n    }\n\n    let delegate = ReactNativeDelegate()`
        );
      }

      fs.writeFileSync(appDelegatePath, contents);
      return config;
    },
  ]);
};

module.exports = ({ config }) => {
  let result = {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        GMSApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY ?? '',
      },
    },
  };

  result = withGoogleMapsPod(result);
  result = withGoogleMapsAppDelegate(result);

  return result;
};
