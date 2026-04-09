const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const sharedModuleRoots = [
  'core',
  'schema',
  'db',
  'preferences',
  'places',
  'collections',
  'share',
  'sync',
  'http',
  'auth',
].map((directory) => path.resolve(workspaceRoot, directory));

const config = getDefaultConfig(projectRoot);

const { transformer, resolver, watchFolders } = config;

config.watchFolders = [...new Set([...(watchFolders || []), workspaceRoot, ...sharedModuleRoots])];

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
  nodeModulesPaths: [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ],
};

module.exports = config;
