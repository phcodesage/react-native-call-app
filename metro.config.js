const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add WebRTC support
config.resolver.assetExts.push('db');

// Handle WebRTC native modules
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

module.exports = config;
