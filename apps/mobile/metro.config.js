const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const shareRoot = path.resolve(workspaceRoot, 'share');

const config = getDefaultConfig(projectRoot);

const { transformer, resolver, watchFolders } = config;

config.watchFolders = [...new Set([...(watchFolders || []), shareRoot])];

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
};

module.exports = config;
