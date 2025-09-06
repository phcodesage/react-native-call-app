import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Build utilities for handling debug vs release build differences
 */
export class BuildUtils {
  
  /**
   * Check if this is a release build
   */
  static isReleaseBuild(): boolean {
    try {
      // Check various indicators of release builds
      const isDev = __DEV__;
      const isExpoGo = Constants.appOwnership === 'expo';
      const buildType = Constants.executionEnvironment;
      
      // In release builds, __DEV__ should be false
      // In standalone builds, appOwnership should be 'standalone'
      const isRelease = !isDev && !isExpoGo && buildType === 'standalone';
      
      console.log('[BUILD] Build detection:', {
        __DEV__: isDev,
        appOwnership: Constants.appOwnership,
        executionEnvironment: buildType,
        isRelease
      });
      
      return isRelease;
    } catch (error) {
      console.warn('[BUILD] Error detecting build type, assuming release:', error);
      return true; // Default to release build safety
    }
  }
  
  /**
   * Check if this is a debug build
   */
  static isDebugBuild(): boolean {
    return !this.isReleaseBuild();
  }
  
  /**
   * Get logging configuration based on build type
   */
  static getLogConfig() {
    const isRelease = this.isReleaseBuild();
    return {
      enableVerboseLogging: !isRelease,
      enableErrorReporting: isRelease,
      logLevel: isRelease ? 'warn' : 'debug'
    };
  }
  
  /**
   * Get WebRTC configuration optimized for the current build type
   */
  static getWebRTCConfig() {
    const isRelease = this.isReleaseBuild();
    return {
      // More conservative settings for release builds
      enableDtx: isRelease, // Discontinuous transmission for better performance
      enableHighpassFilter: isRelease,
      enableNoiseSuppression: isRelease,
      enableEchoCancellation: isRelease,
      enableAutoGainControl: isRelease,
      // Less aggressive ICE gathering in release
      iceTransportPolicy: isRelease ? 'all' : 'all',
      bundlePolicy: isRelease ? 'max-bundle' : 'balanced',
      rtcpMuxPolicy: 'require',
      // Timeout settings
      connectionTimeout: isRelease ? 30000 : 15000,
      iceGatheringTimeout: isRelease ? 10000 : 5000,
    };
  }
  
  /**
   * Get network configuration optimized for the current build type
   */
  static getNetworkConfig() {
    const isRelease = this.isReleaseBuild();
    return {
      // More retries and longer timeouts for release builds
      maxRetries: isRelease ? 5 : 3,
      baseTimeout: isRelease ? 10000 : 5000,
      maxTimeout: isRelease ? 30000 : 15000,
      enableCaching: true,
      cacheTimeout: isRelease ? 3600000 : 300000, // 1 hour vs 5 minutes
    };
  }
  
  /**
   * Get error handling configuration
   */
  static getErrorConfig() {
    const isRelease = this.isReleaseBuild();
    return {
      // More graceful error handling in release
      throwOnError: !isRelease,
      enableFallbacks: isRelease,
      enableRetries: isRelease,
      silentFailures: isRelease,
    };
  }
  
  /**
   * Get platform-specific configuration
   */
  static getPlatformConfig() {
    return {
      platform: Platform.OS,
      isAndroid: Platform.OS === 'android',
      isIOS: Platform.OS === 'ios',
      platformVersion: Platform.Version,
      // Android-specific
      ...(Platform.OS === 'android' && {
        minSdkVersion: 21,
        targetSdkVersion: 34,
        compileSdkVersion: 34,
      })
    };
  }
  
  /**
   * Log build information for debugging
   */
  static logBuildInfo() {
    const logConfig = this.getLogConfig();
    if (!logConfig.enableVerboseLogging) return;
    
    console.log('[BUILD] Build Information:', {
      isRelease: this.isReleaseBuild(),
      platform: this.getPlatformConfig(),
      webrtcConfig: this.getWebRTCConfig(),
      networkConfig: this.getNetworkConfig(),
      errorConfig: this.getErrorConfig(),
    });
  }
}

// Helper function for conditional logging
export function debugLog(message: string, ...args: any[]) {
  if (BuildUtils.isDebugBuild()) {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

export function releaseLog(message: string, ...args: any[]) {
  // Always log warnings and errors in release builds
  console.warn(`[RELEASE] ${message}`, ...args);
}

export function errorLog(message: string, error?: any) {
  console.error(`[ERROR] ${message}`, error);
}
