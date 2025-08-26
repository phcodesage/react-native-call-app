const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

function ensurePermission(manifest, permission) {
  const perms = manifest.manifest['uses-permission'] ?? [];
  const exists = perms.some((p) => p.$['android:name'] === permission);
  if (!exists) {
    perms.push({ $: { 'android:name': permission } });
    manifest.manifest['uses-permission'] = perms;
  }
}

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
    ensurePermission(manifest, 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    ensurePermission(manifest, 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE');

    // Ensure the library's service is declared with types for Android 14+
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const services = app.service ?? [];
    const SERVICE_CLASS = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    const exists = services.some((s) => s.$['android:name'] === SERVICE_CLASS);
    if (!exists) {
      services.push({
        $: {
          'android:name': SERVICE_CLASS,
          'android:exported': 'false',
          // Types relevant for calls; you can trim if you prefer
          'android:foregroundServiceType': 'microphone|camera|mediaProjection|mediaPlayback|connectedDevice',
        },
      });
      app.service = services;
    }

    return config;
  });
};

module.exports = withCallForegroundService;
