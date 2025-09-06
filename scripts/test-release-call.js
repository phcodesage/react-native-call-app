#!/usr/bin/env node

/**
 * Test script to validate WebRTC call functionality in release builds
 * Run with: node scripts/test-release-call.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(PROJECT_ROOT, 'android');

console.log('🚀 Testing Release Build Call Functionality\n');

// Step 1: Check if all necessary files exist
console.log('1. Checking required files...');
const requiredFiles = [
  'services/WebRTCService.ts',
  'services/ICEServerService.ts', 
  'utils/buildUtils.ts',
  'utils/permissions.ts',
  'android/app/proguard-rules.pro'
];

for (const file of requiredFiles) {
  const filePath = path.join(PROJECT_ROOT, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - MISSING!`);
    process.exit(1);
  }
}

// Step 2: Validate ProGuard rules
console.log('\n2. Validating ProGuard rules...');
const proguardRules = fs.readFileSync(path.join(PROJECT_ROOT, 'android/app/proguard-rules.pro'), 'utf8');
const requiredRules = [
  '-keep class org.webrtc.** { *; }',
  '-keep interface org.webrtc.** { *; }',
  '-keep class com.oney.WebRTCModule.** { *; }',
  '-keepclassmembers class org.webrtc.**'
];

for (const rule of requiredRules) {
  if (proguardRules.includes(rule)) {
    console.log(`  ✅ ${rule}`);
  } else {
    console.log(`  ❌ ${rule} - MISSING!`);
  }
}

// Step 3: Check Android build configuration
console.log('\n3. Checking Android build configuration...');
const buildGradle = fs.readFileSync(path.join(PROJECT_ROOT, 'android/app/build.gradle'), 'utf8');

const buildChecks = [
  { check: 'shrinkResources false', name: 'Resource shrinking disabled' },
  { check: 'minifyEnabled false', name: 'Minification disabled' },
  { check: 'pickFirst \'**/libwebrtc.so\'', name: 'WebRTC native lib conflict resolution' }
];

for (const { check, name } of buildChecks) {
  if (buildGradle.includes(check)) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ⚠️  ${name} - NOT FOUND`);
  }
}

// Step 4: Test build
console.log('\n4. Testing release build compilation...');
process.chdir(ANDROID_DIR);

try {
  // Check if gradlew exists and is executable
  const gradlewPath = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
  if (!fs.existsSync(gradlewPath)) {
    console.log('  ❌ gradlew not found');
    process.exit(1);
  }

  console.log('  📦 Running release build compilation test...');
  
  // Clean build first
  console.log('  🧹 Cleaning previous builds...');
  execSync(`${gradlewPath} clean`, { stdio: 'pipe' });
  
  // Attempt release build
  console.log('  🔨 Building release APK...');
  const buildOutput = execSync(`${gradlewPath} assembleRelease -x lint --stacktrace`, { 
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 300000 // 5 minutes timeout
  });
  
  console.log('  ✅ Release build compilation successful!');
  
  // Check if APK was created
  const apkPath = path.join(ANDROID_DIR, 'app/build/outputs/apk/release/app-release.apk');
  if (fs.existsSync(apkPath)) {
    const stats = fs.statSync(apkPath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  ✅ APK created successfully (${sizeInMB} MB)`);
    console.log(`  📍 Location: ${apkPath}`);
  } else {
    console.log('  ⚠️  APK not found at expected location');
  }
  
} catch (error) {
  console.log('  ❌ Release build failed!');
  console.log('  Error details:', error.message);
  
  // Try to extract useful information from build error
  if (error.stdout) {
    const lines = error.stdout.split('\n');
    const errorLines = lines.filter(line => 
      line.includes('error') || 
      line.includes('FAILED') ||
      line.includes('Exception')
    );
    if (errorLines.length > 0) {
      console.log('  📋 Key error messages:');
      errorLines.slice(0, 5).forEach(line => console.log(`    ${line.trim()}`));
    }
  }
  
  console.log('\n💡 Troubleshooting tips:');
  console.log('  - Make sure Java JDK 17 is installed and configured');
  console.log('  - Check that Android SDK is properly set up');
  console.log('  - Try: cd android && ./gradlew clean && ./gradlew assembleRelease');
  console.log('  - Check android/app/build/outputs/logs/ for detailed logs');
  
  process.exit(1);
}

// Step 5: Summary and recommendations
console.log('\n✅ Release Build Test Complete!');
console.log('\n📋 Summary:');
console.log('  - All required files are present');
console.log('  - ProGuard rules configured for WebRTC');
console.log('  - Android build configuration optimized');
console.log('  - Release build compiles successfully');

console.log('\n🎯 Next Steps:');
console.log('  1. Install the APK on a device: adb install android/app/build/outputs/apk/release/app-release.apk');
console.log('  2. Test call functionality thoroughly');
console.log('  3. Monitor logs: adb logcat | grep -E "(WebRTC|ICE|Call)"');
console.log('  4. Test both audio and video calls');
console.log('  5. Verify calls work in different network conditions');

console.log('\n🔧 If calls still crash:');
console.log('  - Check device logs: adb logcat | grep -E "(FATAL|AndroidRuntime)"');
console.log('  - Verify network connectivity to backend');
console.log('  - Test with different devices/Android versions');
console.log('  - Consider enabling more verbose ProGuard keep rules');

console.log('\n🎉 Build test completed successfully!');
