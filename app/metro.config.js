// Metro config — the app shares ONE simulation module with the server,
// which lives outside the app root at ../shared/sim.js (by design: the
// game's physics and the server's replay verification must never drift).
// The standard Expo monorepo recipe lets Metro watch and resolve the
// workspace root so `../../shared/sim.js` resolves in bundles.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
