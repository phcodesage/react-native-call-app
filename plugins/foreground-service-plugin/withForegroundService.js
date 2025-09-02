const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const ensurePermission = (manifest, permission) => {
  const perms = manifest.manifest['uses-permission'] ?? [];
  const exists = perms.some((p) => p.$['android:name'] === permission);
  if (!exists) {
    perms.push({ $: { 'android:name': permission } });
    manifest.manifest['uses-permission'] = perms;
  }
};

const withCallForegroundService = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // Required permissions for foreground service
    ensurePermission(manifest, 'android.permission.FOREGROUND_SERVICE');
    ensurePermission(manifest, 'android.permission.WAKE_LOCK');
    // Optional specific foreground service type permissions for Android 14+
    ensurePermission(manifest, 'android.permission.FOREGROUND_SERVICE_MICROPHONE');
    ensurePermission(manifest, 'android.permission.FOREGROUND_SERVICE_CAMERA');
    ensurePermission(manifest, 'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');

    // No hardcoded <service> registration here; the library manages it.

    return config;
  });
};

module.exports = withCallForegroundService;
